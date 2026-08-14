"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  MAX_FILE_BYTES,
  materializeWorkerChanges,
} = require("../lib/work-materializer");
const { tempDir } = require("./helpers/cli");

function workspace(t) {
  const parent = tempDir("work-materializer-");
  const root = path.join(parent, "workspace");
  fs.mkdirSync(root);
  t.after(() => fs.rmSync(parent, { recursive: true, force: true }));
  return { parent, root };
}

test("materializer writes new and existing files inside the allowed boundary", (t) => {
  const { root } = workspace(t);
  const existingPath = path.join(root, "existing.txt");
  fs.writeFileSync(existingPath, "before\n", "utf8");

  const changedPaths = materializeWorkerChanges(root, [
    { path: "src/result.txt", content: "delivered\n" },
    { path: "existing.txt", content: "after\n" },
  ], ["src", "existing.txt"]);

  assert.deepEqual(changedPaths, ["src/result.txt", "existing.txt"]);
  assert.equal(fs.readFileSync(path.join(root, "src", "result.txt"), "utf8"), "delivered\n");
  assert.equal(fs.readFileSync(existingPath, "utf8"), "after\n");
});

test("materializer rejects duplicate paths before writing", (t) => {
  const { root } = workspace(t);

  assert.throws(
    () => materializeWorkerChanges(root, [
      { path: "src/result.txt", content: "first\n" },
      { path: "src/result.txt", content: "second\n" },
    ], ["src"]),
    (error) => error.code === "MH_WORK_CHANGES" && /duplicate path/.test(error.message),
  );
  assert.equal(fs.existsSync(path.join(root, "src", "result.txt")), false);
});

test("materializer rejects path traversal", (t) => {
  const { parent, root } = workspace(t);

  assert.throws(
    () => materializeWorkerChanges(root, [
      { path: "../escape.txt", content: "escaped\n" },
    ], ["."]),
    (error) => error.code === "MH_WORK_CHANGE_PATH",
  );
  assert.equal(fs.existsSync(path.join(parent, "escape.txt")), false);
});

test("materializer rejects files outside the allowed boundary", (t) => {
  const { root } = workspace(t);

  assert.throws(
    () => materializeWorkerChanges(root, [
      { path: "docs/outside.txt", content: "outside\n" },
    ], ["src"]),
    (error) => error.code === "MH_WORK_BOUNDARY_PATH",
  );
  assert.equal(fs.existsSync(path.join(root, "docs", "outside.txt")), false);
});

test("materializer rejects Decision Plane control-state mutations even under a broad allowed path", (t) => {
  const { root } = workspace(t);

  for (const controlPath of [
    ".meta-harness/repo-charter.json",
    ".meta-harness/repo-world.json",
    ".meta-harness/repo-decision.json",
    ".META-HARNESS/REPO-DECISION.JSON",
    ".meta-harness/owner-directive.md",
  ]) {
    assert.throws(
      () => materializeWorkerChanges(root, [{ path: controlPath, content: "mutated\n" }], ["."]),
      (error) => error.code === "MH_REPO_DECISION_PROTECTED" && /Decision Plane control state/.test(error.message),
    );
    assert.equal(fs.existsSync(path.join(root, ...controlPath.split("/"))), false);
  }
});

test("materializer rejects harness state under repository-wide scope", (t) => {
  const { root } = workspace(t);
  assert.throws(
    () => materializeWorkerChanges(root, [{ path: ".meta-harness/status.md", content: "changed\n" }], ["."]),
    (error) => error.code === "MH_WORK_CONTROL_PATH",
  );
});

test("materializer rejects oversized content before writing", (t) => {
  const { root } = workspace(t);

  assert.throws(
    () => materializeWorkerChanges(root, [
      { path: "src/oversized.txt", content: "x".repeat(MAX_FILE_BYTES + 1) },
    ], ["src"]),
    (error) => error.code === "MH_WORK_CHANGE_SIZE" && /exceeds/.test(error.message),
  );
  assert.equal(fs.existsSync(path.join(root, "src", "oversized.txt")), false);
});
