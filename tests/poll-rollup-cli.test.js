"use strict";

const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const BIN = path.join(__dirname, "..", "bin", "meta-harness.js");

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "meta-harness-poll-rollup-"));
}

function ensureHarness(root) {
  fs.mkdirSync(path.join(root, ".meta-harness"), { recursive: true });
}

function writeFile(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf8");
}

function writeJson(filePath, value) {
  writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function run(cwd, args) {
  return childProcess.spawnSync(process.execPath, [BIN, ...args], {
    cwd,
    encoding: "utf8",
  });
}

function readSnapshot(paths) {
  return Object.fromEntries(paths.map((filePath) => [
    filePath,
    fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : null,
  ]));
}

function setupParentChild() {
  const parent = tempDir();
  const child = tempDir();
  ensureHarness(parent);
  ensureHarness(child);

  const watched = [
    path.join(parent, ".meta-harness", "status.md"),
    path.join(parent, ".meta-harness", "events.jsonl"),
    path.join(parent, ".meta-harness", "poll.md"),
    path.join(child, ".meta-harness", "status.md"),
    path.join(child, ".meta-harness", "events.jsonl"),
    path.join(child, ".meta-harness", "ready.json"),
    path.join(child, "package.json"),
  ];

  writeFile(watched[0], "# Status\n\nParent status must not change\n");
  writeFile(watched[1], "{\"event\":\"parent\"}\n");
  writeFile(watched[2], "parent poll must not change\n");
  writeFile(watched[3], "# Status\n\nPhase: closed\n\nUpdated: 2026-06-30\n");
  writeFile(watched[4], "{\"event\":\"child\"}\n");
  writeJson(watched[5], { ok: true, passed: 3, failed: 0, warned: 0, generated_at: "2026-06-30T00:00:00.000Z" });
  writeJson(watched[6], { name: "child-app" });
  writeJson(path.join(parent, ".meta-harness", "repos.json"), {
    repos: [{ name: "child-app", path: child, role: "child" }],
  });

  return { parent, child, watched };
}

test("poll --rollup --json emits read-only local file rollup without mutating files", () => {
  const { parent, watched } = setupParentChild();
  const before = readSnapshot(watched);

  const result = run(parent, ["poll", "--rollup", "--json"]);
  const after = readSnapshot(watched);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, "");
  const rollup = JSON.parse(result.stdout);
  assert.equal(rollup.schema_version, "1.0.0");
  assert.equal(rollup.generated_from, "local_files");
  assert.equal(rollup.ok, true);
  assert.deepEqual(rollup.summary, {
    total: 1,
    ready: 1,
    warned: 0,
    failed: 0,
    unknown: 0,
    missing: 0,
    invalid: 0,
  });
  assert.deepEqual(rollup.not_changed, [
    "child_repos",
    "child_status",
    "child_events",
    "parent_status",
    "parent_events",
  ]);
  assert.equal(rollup.repos[0].name, "child-app");
  assert.equal(rollup.repos[0].state, "ready");
  assert.equal(rollup.repos[0].source, ".meta-harness/ready.json");
  assert.deepEqual(after, before);
});

test("poll --rollup emits deterministic Markdown without mutating files", () => {
  const { parent, watched } = setupParentChild();
  const before = readSnapshot(watched);

  const result = run(parent, ["poll", "--rollup"]);
  const after = readSnapshot(watched);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^# Repo Rollup\n/);
  assert.match(result.stdout, /Generated from: local_files/);
  assert.match(result.stdout, /Read-only: child_repos, child_status, child_events, parent_status, parent_events/);
  assert.match(result.stdout, /ROLLUP: 1\/1 repos ready/);
  assert.match(result.stdout, /child-app\tready\tchild/);
  assert.deepEqual(after, before);
});

test("poll --rollup --write is rejected and still does not mutate parent or child files", () => {
  const { parent, watched } = setupParentChild();
  const before = readSnapshot(watched);

  const result = run(parent, ["poll", "--rollup", "--write"]);
  const after = readSnapshot(watched);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /poll --rollup is read-only/);
  assert.deepEqual(after, before);
});
