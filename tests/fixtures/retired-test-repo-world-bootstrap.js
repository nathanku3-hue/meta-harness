"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  ensureDeclaredStartupWorld,
} = require("../lib/repo-world-bootstrap");
const { readCurrentWorldState } = require("../lib/world-transition");
const { repository } = require("./helpers/linear-product-head");

function writeJson(root, relativePath, value) {
  const filePath = path.join(root, ...relativePath.split("/"));
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function declareStartup(root, phase) {
  writeJson(root, "state.json", { phase });
  writeJson(root, ".meta-harness-project.json", {
    schemaVersion: "meta-harness-project/v1",
    startupContext: {
      sources: [{
        id: "state",
        path: "state.json",
        required: true,
      }],
      projection: [{
        label: "Phase",
        source: "state",
        jsonPointer: "/phase",
      }],
    },
  });
}

function fixedNow(value) {
  const instant = new Date(value);
  return () => new Date(instant);
}

test("declared startup context bootstraps the first authoritative WorldHead", (t) => {
  const { root, baseline } = repository(t);
  declareStartup(root, "A");

  const current = ensureDeclaredStartupWorld(root, {
    now: fixedNow("2026-09-23T10:00:00.000Z"),
  });

  assert.equal(current.head.schemaVersion, "world-head/v2");
  assert.equal(current.head.generation, 1);
  assert.equal(current.head.productCommit, baseline);
  assert.deepEqual(current.world.payload.declaredStartup.lines, ["Phase: A"]);
  assert.equal(
    fs.existsSync(path.join(root, ".git", "meta-harness", "decision-plane-v2", "current-world.json")),
    true,
  );
});

test("declared startup projector refreshes source drift and stays idempotent when unchanged", (t) => {
  const { root } = repository(t);
  declareStartup(root, "A");
  const first = ensureDeclaredStartupWorld(root, {
    now: fixedNow("2026-09-23T10:00:00.000Z"),
  });

  writeJson(root, "state.json", { phase: "B" });
  const second = ensureDeclaredStartupWorld(root, {
    now: fixedNow("2026-09-23T10:01:00.000Z"),
  });
  assert.equal(second.head.generation, 2);
  assert.notEqual(second.head.headDigest, first.head.headDigest);
  assert.deepEqual(second.world.payload.declaredStartup.lines, ["Phase: B"]);

  const third = ensureDeclaredStartupWorld(root, {
    now: fixedNow("2026-09-23T10:02:00.000Z"),
  });
  assert.equal(third.head.headDigest, second.head.headDigest);
  assert.equal(third.head.generation, 2);
  assert.equal(
    readCurrentWorldState(root, { now: new Date("2026-09-23T10:02:00.000Z") }).head.headDigest,
    second.head.headDigest,
  );
});
