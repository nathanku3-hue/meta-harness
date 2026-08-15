"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  MAX_FILE_BYTES,
  materializeWorkerOperations,
} = require("../lib/work-materializer");
const { tempDir } = require("./helpers/cli");

function workspace(t) {
  const parent = tempDir("work-materializer-");
  const root = path.join(parent, "workspace");
  fs.mkdirSync(root);
  t.after(() => fs.rmSync(parent, { recursive: true, force: true }));
  return { parent, root };
}

test("materializer applies WRITE to new and existing files inside the allowed boundary", (t) => {
  const { root } = workspace(t);
  const existingPath = path.join(root, "existing.txt");
  fs.writeFileSync(existingPath, "before\n", "utf8");

  const changedPaths = materializeWorkerOperations(root, [
    { type: "WRITE", path: "src/result.txt", content: "delivered\n" },
    { type: "WRITE", path: "existing.txt", content: "after\n" },
  ], ["src", "existing.txt"]);

  assert.deepEqual(changedPaths, ["existing.txt", "src/result.txt"]);
  assert.equal(fs.readFileSync(path.join(root, "src", "result.txt"), "utf8"), "delivered\n");
  assert.equal(fs.readFileSync(existingPath, "utf8"), "after\n");
});

test("materializer applies DELETE and MOVE as explicit typed operations", (t) => {
  const { root } = workspace(t);
  fs.mkdirSync(path.join(root, "src"));
  fs.writeFileSync(path.join(root, "src", "delete-me.txt"), "delete\n", "utf8");
  fs.writeFileSync(path.join(root, "src", "before.txt"), "move\n", "utf8");

  const changedPaths = materializeWorkerOperations(root, [
    { type: "DELETE", path: "src/delete-me.txt" },
    { type: "MOVE", from: "src/before.txt", to: "src/after.txt" },
  ], ["src"]);

  assert.deepEqual(changedPaths, ["src/after.txt", "src/before.txt", "src/delete-me.txt"]);
  assert.equal(fs.existsSync(path.join(root, "src", "delete-me.txt")), false);
  assert.equal(fs.existsSync(path.join(root, "src", "before.txt")), false);
  assert.equal(fs.readFileSync(path.join(root, "src", "after.txt"), "utf8"), "move\n");
});

test("materializer rejects duplicate touched paths before writing", (t) => {
  const { root } = workspace(t);

  assert.throws(
    () => materializeWorkerOperations(root, [
      { type: "WRITE", path: "src/result.txt", content: "first\n" },
      { type: "WRITE", path: "src/result.txt", content: "second\n" },
    ], ["src"]),
    (error) => error.code === "MH_WORK_OPERATIONS" && /same path/.test(error.message),
  );
  assert.equal(fs.existsSync(path.join(root, "src", "result.txt")), false);
});

test("materializer rejects path traversal", (t) => {
  const { parent, root } = workspace(t);

  assert.throws(
    () => materializeWorkerOperations(root, [
      { type: "WRITE", path: "../escape.txt", content: "escaped\n" },
    ], ["."]),
    (error) => error.code === "MH_WORK_OPERATION_PATH",
  );
  assert.equal(fs.existsSync(path.join(parent, "escape.txt")), false);
});

test("materializer rejects files outside the allowed boundary", (t) => {
  const { root } = workspace(t);

  assert.throws(
    () => materializeWorkerOperations(root, [
      { type: "WRITE", path: "docs/outside.txt", content: "outside\n" },
    ], ["src"]),
    (error) => error.code === "MH_WORK_BOUNDARY_PATH",
  );
  assert.equal(fs.existsSync(path.join(root, "docs", "outside.txt")), false);
});

test("materializer rejects Decision Plane control-state mutations even under broad scope", (t) => {
  const { root } = workspace(t);

  for (const controlPath of [
    ".meta-harness/repo-charter.json",
    ".meta-harness/repo-world.json",
    ".meta-harness/repo-decision.json",
    ".META-HARNESS/REPO-DECISION.JSON",
    ".meta-harness/owner-directive.md",
  ]) {
    assert.throws(
      () => materializeWorkerOperations(root, [{ type: "WRITE", path: controlPath, content: "mutated\n" }], ["."]),
      (error) => error.code === "MH_REPO_DECISION_PROTECTED" && /Decision Plane control state/.test(error.message),
    );
    assert.equal(fs.existsSync(path.join(root, ...controlPath.split("/"))), false);
  }
});

test("materializer rejects harness state and PRODUCT.md for every mutation type", (t) => {
  const { root } = workspace(t);
  fs.writeFileSync(path.join(root, "PRODUCT.md"), "owner\n", "utf8");
  assert.throws(
    () => materializeWorkerOperations(root, [{ type: "WRITE", path: ".meta-harness/status.md", content: "changed\n" }], ["."]),
    (error) => error.code === "MH_WORK_CONTROL_PATH",
  );
  assert.throws(
    () => materializeWorkerOperations(root, [{ type: "DELETE", path: "PRODUCT.md" }], ["."]),
    (error) => error.code === "MH_PRODUCT_DIRECTION_PROTECTED",
  );
  assert.equal(fs.readFileSync(path.join(root, "PRODUCT.md"), "utf8"), "owner\n");
});

test("materializer rejects oversized WRITE content before writing", (t) => {
  const { root } = workspace(t);

  assert.throws(
    () => materializeWorkerOperations(root, [
      { type: "WRITE", path: "src/oversized.txt", content: "x".repeat(MAX_FILE_BYTES + 1) },
    ], ["src"]),
    (error) => error.code === "MH_WORK_OPERATION_SIZE" && /exceeds/.test(error.message),
  );
  assert.equal(fs.existsSync(path.join(root, "src", "oversized.txt")), false);
});

test("materializer rejects DELETE missing source and MOVE existing target", (t) => {
  const { root } = workspace(t);
  fs.mkdirSync(path.join(root, "src"));
  fs.writeFileSync(path.join(root, "src", "source.txt"), "source\n", "utf8");
  fs.writeFileSync(path.join(root, "src", "target.txt"), "target\n", "utf8");

  assert.throws(
    () => materializeWorkerOperations(root, [{ type: "DELETE", path: "src/missing.txt" }], ["src"]),
    (error) => error.code === "MH_WORK_OPERATION_MISSING",
  );
  assert.throws(
    () => materializeWorkerOperations(root, [{ type: "MOVE", from: "src/source.txt", to: "src/target.txt" }], ["src"]),
    (error) => error.code === "MH_WORK_OPERATION_EXISTS",
  );
  assert.equal(fs.readFileSync(path.join(root, "src", "source.txt"), "utf8"), "source\n");
  assert.equal(fs.readFileSync(path.join(root, "src", "target.txt"), "utf8"), "target\n");
});
