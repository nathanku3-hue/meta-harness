"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const { ensureDeclaredProjectWorld } = require("../lib/project-world");
const { readCurrentWorldState } = require("../lib/world-transition");

function git(root, args) {
  const result = spawnSync("git", args, {
    cwd: root,
    encoding: "utf8",
    windowsHide: true,
  });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout);
  return String(result.stdout || "").trim();
}

function writeJson(root, relativePath, value) {
  const target = path.join(root, ...relativePath.split("/"));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, JSON.stringify(value, null, 2) + "\n", "utf8");
}

function productMd() {
  return [
    "# Test product",
    "",
    "## Version",
    "",
    "v1",
    "",
    "## Endgame",
    "",
    "Deliver the requested behavior.",
    "",
    "## Target user",
    "",
    "A test user.",
    "",
    "## Core user journey",
    "",
    "State a result and receive working code.",
    "",
    "## Taste — prefer",
    "",
    "Small reversible changes.",
    "",
    "## Taste — reject",
    "",
    "Unbounded changes.",
    "",
    "## Non-negotiables",
    "",
    "Keep repository truth explicit.",
    "",
    "## Shipping definition",
    "",
    "Relevant validation passes.",
    "",
    "## Change rule",
    "",
    "Only the owner changes product direction.",
    "",
  ].join("\n");
}

function fixture(t, { sourceTime = "2026-09-23T00:00:00.000Z" } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mh-project-world-"));
  fs.mkdirSync(path.join(root, "docs"), { recursive: true });
  fs.writeFileSync(path.join(root, "PRODUCT.md"), productMd(), "utf8");
  writeJson(root, "docs/state.json", {
    updated_at_utc: sourceTime,
    state: "one",
  });
  writeJson(root, ".meta-harness-project.json", {
    schemaVersion: "meta-harness-project/v1",
    startupContext: {
      sources: [{
        id: "state",
        path: "docs/state.json",
        required: true,
        freshness: {
          jsonPointer: "/updated_at_utc",
          maxAgeDays: 7,
        },
      }],
      projection: [{
        label: "State",
        source: "state",
        jsonPointer: "/state",
      }],
    },
  });
  git(root, ["init"]);
  git(root, ["config", "user.email", "project-world@example.test"]);
  git(root, ["config", "user.name", "Project World Test"]);
  git(root, ["add", "."]);
  git(root, ["commit", "-m", "baseline"]);
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

test("declared startup context bootstraps and refreshes authoritative World without pointer repair", (t) => {
  const root = fixture(t);
  const first = ensureDeclaredProjectWorld(root, {
    now: () => new Date("2026-09-23T01:00:00.000Z"),
  });
  assert.equal(first.head.schemaVersion, "world-head/v2");
  assert.equal(first.head.generation, 1);
  assert.deepEqual(first.world.payload.declaredStartup.lines, ["State: one"]);

  const unchanged = ensureDeclaredProjectWorld(root, {
    now: () => new Date("2026-09-23T02:00:00.000Z"),
  });
  assert.equal(unchanged.head.headDigest, first.head.headDigest);
  assert.equal(unchanged.head.generation, 1);

  writeJson(root, "docs/state.json", {
    updated_at_utc: "2026-09-23T03:00:00.000Z",
    state: "two",
  });
  const refreshed = ensureDeclaredProjectWorld(root, {
    now: () => new Date("2026-09-23T04:00:00.000Z"),
  });
  assert.equal(refreshed.head.generation, 2);
  assert.notEqual(refreshed.head.headDigest, first.head.headDigest);
  assert.equal(refreshed.head.productCommit, first.head.productCommit);
  assert.deepEqual(refreshed.world.payload.declaredStartup.lines, ["State: two"]);
  assert.equal(
    readCurrentWorldState(root, { now: new Date("2026-09-23T04:00:00.000Z") }).head.headDigest,
    refreshed.head.headDigest,
  );
});

test("declared startup refresh repairs attestation drift even when projected lines are unchanged", (t) => {
  const root = fixture(t);
  const first = ensureDeclaredProjectWorld(root, {
    now: () => new Date("2026-09-23T01:00:00.000Z"),
  });

  writeJson(root, "docs/state.json", {
    updated_at_utc: "2026-09-23T00:00:00.000Z",
    state: "one",
    nonProjectedEvidence: "changed",
  });
  const refreshed = ensureDeclaredProjectWorld(root, {
    now: () => new Date("2026-09-23T02:00:00.000Z"),
  });
  assert.equal(refreshed.head.generation, 2);
  assert.equal(refreshed.head.worldDigest, first.head.worldDigest);
  assert.notEqual(refreshed.head.attestationDigest, first.head.attestationDigest);
});

test("stale required startup context fails closed without creating a current World", (t) => {
  const root = fixture(t, { sourceTime: "2026-08-01T00:00:00.000Z" });
  assert.throws(
    () => ensureDeclaredProjectWorld(root, {
      now: () => new Date("2026-09-23T01:00:00.000Z"),
    }),
    (error) => error.code === "MH_PROJECT_WORLD_STARTUP",
  );
  assert.equal(
    fs.existsSync(path.join(root, ".git", "meta-harness", "decision-plane-v2", "current-world.json")),
    false,
  );
});
