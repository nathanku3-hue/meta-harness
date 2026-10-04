"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const { run, runRaw, tempDir, writeFile } = require("./helpers/cli");
const { writeProductMd } = require("./helpers/product-direction");
const {
  ensureProjectHooks,
  inspectProjectStartup,
} = require("../lib/project-init");

function declaration(overrides = {}) {
  return {
    schemaVersion: "meta-harness-project/v1",
    startupContext: {
      sources: [{
        id: "loop",
        path: "docs/context/state.json",
        required: true,
        freshness: { jsonPointer: "/updated_at", maxAgeDays: 7 },
      }],
      projection: [
        { label: "Loop", source: "loop", jsonPointer: "/process/loop_phase" },
        { label: "Next", source: "loop", jsonPointer: "/process/next_phase" },
      ],
    },
    ...overrides,
  };
}

function writeDeclaration(root, value = declaration()) {
  writeFile(root, ".meta-harness-project.json", `${JSON.stringify(value, null, 2)}\n`);
}

function writeState(root, updatedAt = new Date().toISOString()) {
  writeFile(root, "docs/context/state.json", `${JSON.stringify({
    updated_at: updatedAt,
    process: { loop_phase: "ANALYZE", next_phase: "WAIT" },
  }, null, 2)}\n`);
}

function fileFingerprint(target) {
  const bytes = fs.readFileSync(target);
  return {
    sizeBytes: bytes.length,
    sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
  };
}

test("fresh project hook completion is atomic-facing and installs only runtime structural hooks", () => {
  const root = tempDir("meta-harness-project-init-");
  writeDeclaration(root);
  writeState(root);

  const result = ensureProjectHooks({ cwd: root });
  assert.equal(result.initialized, true);
  assert.equal(result.reconciled, false);
  assert.equal(fs.existsSync(path.join(root, ".meta-harness", "status.md")), true);
  assert.equal(fs.existsSync(path.join(root, ".meta-harness", "events.jsonl")), true);
  assert.equal(fs.existsSync(path.join(root, ".meta-harness", "repos.json")), true);
  assert.equal(fs.existsSync(path.join(root, ".meta-harness", "workers", "worker-report-template.md")), true);
  assert.equal(fs.existsSync(path.join(root, ".meta-harness", "streams", "coding.md")), true);
  assert.equal(fs.existsSync(path.join(root, ".meta-harness", "templates")), false);

  const again = ensureProjectHooks({ cwd: root });
  assert.equal(again.initialized, false);
  assert.equal(again.reconciled, false);
});

test("repo registration silently completes the same child runtime hooks", () => {
  const parent = tempDir("meta-harness-parent-init-");
  const child = tempDir("meta-harness-child-init-");
  run(parent, ["init", "Parent"]);
  assert.equal(fs.existsSync(path.join(child, ".meta-harness")), false);

  const registered = runRaw(parent, ["repos", "add", "child", child]);

  assert.equal(registered.status, 0, registered.stderr || registered.stdout);
  assert.equal(fs.existsSync(path.join(child, ".meta-harness", "status.md")), true);
  assert.equal(fs.existsSync(path.join(child, ".meta-harness", "events.jsonl")), true);
  assert.equal(fs.existsSync(path.join(child, ".meta-harness", "templates")), false);
});

test("normal bare journey silently completes fresh repository hooks without an init command", () => {
  const root = tempDir("meta-harness-normal-init-");
  assert.equal(spawnSync("git", ["init"], { cwd: root, encoding: "utf8", shell: false }).status, 0);
  writeProductMd(root);
  assert.equal(fs.existsSync(path.join(root, ".meta-harness")), false);

  const result = runRaw(root, []);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(result.stdout, [
    "No current product gap.",
    "Next — Use the product and continue only when new friction or a new desired result appears.",
    "",
  ].join("\n"));
  assert.equal(fs.existsSync(path.join(root, ".meta-harness", "status.md")), true);
  assert.equal(fs.existsSync(path.join(root, ".meta-harness", "events.jsonl")), true);
  assert.equal(fs.existsSync(path.join(root, ".meta-harness", "templates")), false);
});

test("existing starter state silently receives missing runtime hooks without rewriting status or templates", () => {
  const root = tempDir("meta-harness-project-reconcile-");
  writeDeclaration(root);
  writeState(root);
  writeFile(root, ".meta-harness/status.md", "# Existing status\n");
  writeFile(root, ".meta-harness/events.jsonl", "");
  const beforeStatus = fs.readFileSync(path.join(root, ".meta-harness", "status.md"), "utf8");

  const result = ensureProjectHooks({ cwd: root });

  assert.equal(result.initialized, false);
  assert.equal(result.reconciled, true);
  assert.equal(fs.readFileSync(path.join(root, ".meta-harness", "status.md"), "utf8"), beforeStatus);
  assert.equal(fs.existsSync(path.join(root, ".meta-harness", "workers", "worker-report-template.md")), true);
  assert.equal(fs.existsSync(path.join(root, ".meta-harness", "streams", "coding.md")), true);
  assert.equal(fs.existsSync(path.join(root, ".meta-harness", "templates")), false);

  const again = ensureProjectHooks({ cwd: root });
  assert.equal(again.reconciled, false);
});

test("silent reconcile rejects hard-linked runtime hooks instead of following aliased files", () => {
  const root = tempDir("meta-harness-project-linked-hook-");
  const externalRoot = tempDir("meta-harness-project-linked-hook-external-");
  writeDeclaration(root);
  writeState(root);
  writeFile(root, ".meta-harness/events.jsonl", "");
  const externalStatus = writeFile(externalRoot, "status.md", "external sentinel\n");
  const linkedStatus = path.join(root, ".meta-harness", "status.md");
  fs.linkSync(externalStatus, linkedStatus);

  assert.throws(
    () => ensureProjectHooks({ cwd: root }),
    /hard-linked|multiply linked/i,
  );
  assert.equal(fs.readFileSync(externalStatus, "utf8"), "external sentinel\n");
  assert.equal(fs.existsSync(path.join(root, ".meta-harness", "workers", "worker-report-template.md")), false);
});

test("inspect silently completes fresh hooks and returns declared startup context without a bootstrap command", () => {
  const root = tempDir("meta-harness-inspect-init-");
  assert.equal(spawnSync("git", ["init"], { cwd: root, encoding: "utf8", shell: false }).status, 0);
  writeDeclaration(root);
  writeState(root);
  assert.equal(fs.existsSync(path.join(root, ".meta-harness")), false);

  const inspected = runRaw(root, ["inspect", "--json"]);
  assert.equal(inspected.status, 0, inspected.stderr);
  const payload = JSON.parse(inspected.stdout);
  assert.equal(payload.schemaVersion, "meta-entry/v2");
  assert.equal(payload.action, "IDLE");
  assert.equal(payload.startupContext.status, "READY");
  assert.deepEqual(payload.startupContext.lines, ["Loop: ANALYZE", "Next: WAIT"]);
  assert.equal(fs.existsSync(path.join(root, ".meta-harness", "status.md")), true);
  assert.equal(fs.existsSync(path.join(root, ".meta-harness", "templates")), false);
});

test("project startup projection validates declared canonical sources and freshness", () => {
  const root = tempDir("meta-harness-project-context-");
  writeDeclaration(root);
  writeState(root, "2026-09-07T14:01:05Z");

  const startup = inspectProjectStartup(root, { nowMs: Date.parse("2026-09-07T15:00:00Z") });
  const fingerprint = fileFingerprint(path.join(root, "docs/context/state.json"));
  assert.deepEqual(startup, {
    schemaVersion: "project-startup-context/v1",
    status: "READY",
    lines: ["Loop: ANALYZE", "Next: WAIT"],
    sources: [{
      id: "loop",
      path: "docs/context/state.json",
      status: "fresh",
      sizeBytes: fingerprint.sizeBytes,
      sha256: fingerprint.sha256,
      observedAt: "2026-09-07T14:01:05.000Z",
    }],
    blockers: [],
  });
});

test("declared startup source byte budget rejects bloated current-truth surfaces", () => {
  const root = tempDir("meta-harness-project-budget-");
  writeDeclaration(root, declaration({
    startupContext: {
      sources: [{
        id: "loop",
        path: "docs/context/state.json",
        required: true,
        maxBytes: 64,
      }],
      projection: [{ label: "Loop", source: "loop", jsonPointer: "/process/loop_phase" }],
    },
  }));
  writeState(root, "2026-09-07T14:01:05Z");

  const startup = inspectProjectStartup(root, { nowMs: Date.parse("2026-09-07T15:00:00Z") });
  assert.equal(startup.status, "BLOCKED");
  assert.equal(startup.sources[0].status, "invalid");
  assert.ok(startup.sources[0].sizeBytes > 64);
  assert.match(startup.blockers.join("\n"), /source exceeds declared maxBytes 64/);
});

test("stale required source blocks startup instead of falling back to chat or another file", () => {
  const root = tempDir("meta-harness-project-stale-");
  writeDeclaration(root);
  writeState(root, "2026-08-01T00:00:00Z");

  const startup = inspectProjectStartup(root, { nowMs: Date.parse("2026-09-07T15:00:00Z") });
  assert.equal(startup.status, "BLOCKED");
  assert.match(startup.blockers.join("\n"), /required startup source stale: docs\/context\/state\.json/);
  assert.deepEqual(startup.lines, ["Loop: ANALYZE", "Next: WAIT"]);
});

test("unsafe project source paths are rejected without reading outside the repository", () => {
  const root = tempDir("meta-harness-project-escape-");
  writeDeclaration(root, declaration({
    startupContext: {
      sources: [{ id: "loop", path: "C:\\outside\\state.json", required: true }],
      projection: [{ label: "Loop", source: "loop", jsonPointer: "/process/loop_phase" }],
    },
  }));

  const startup = inspectProjectStartup(root);
  assert.equal(startup.status, "BLOCKED");
  assert.match(startup.blockers[0], /path must be repository-relative/);
  assert.deepEqual(startup.sources, []);
});
