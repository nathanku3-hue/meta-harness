"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const {
  compileCandidateMaterialization,
  reconcileCandidateMaterialization,
} = require("../lib/candidate-materialization");
const { captureWorkspaceBoundary } = require("../lib/work-git");
const { tempDir } = require("./helpers/cli");

function git(cwd, args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", windowsHide: true });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return String(result.stdout || "").trim();
}

function fixture(t) {
  const parent = tempDir("candidate-materialization-");
  const root = path.join(parent, "repo");
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  git(root, ["init"]);
  git(root, ["config", "user.name", "Materialization Test"]);
  git(root, ["config", "user.email", "materialization@example.invalid"]);
  fs.writeFileSync(path.join(root, "src", "write.txt"), "before\n", "utf8");
  fs.writeFileSync(path.join(root, "src", "delete.txt"), "delete\n", "utf8");
  fs.writeFileSync(path.join(root, "src", "move-from.txt"), "move\n", "utf8");
  git(root, ["add", "."]);
  git(root, ["commit", "-m", "baseline"]);
  t.after(() => fs.rmSync(parent, { recursive: true, force: true }));
  return { root, stateDirectory: path.join(root, ".git", "meta-harness-test") };
}

function identities() {
  return {
    sessionDigest: `sha256:${"1".repeat(64)}`,
    workspaceId: "workspace-test",
    generation: 1,
    attemptEntryDigest: `sha256:${"2".repeat(64)}`,
    resultRecordDigest: `sha256:${"3".repeat(64)}`,
  };
}

test("Git target tree is durable before mutation and mixed baseline/target paths converge exactly after restart", (t) => {
  const { root, stateDirectory } = fixture(t);
  const baseline = captureWorkspaceBoundary(root, ["src"]);
  const plan = compileCandidateMaterialization({
    stateDirectory,
    workspacePath: root,
    allowedPaths: ["src"],
    ...identities(),
    baselineTreeOid: baseline.treeOid,
    operations: [
      { type: "WRITE", path: "src/write.txt", content: "after\n" },
      { type: "WRITE", path: "src/new.txt", content: "new\n" },
      { type: "DELETE", path: "src/delete.txt" },
      { type: "MOVE", from: "src/move-from.txt", to: "src/move-to.txt" },
    ],
  });

  assert.ok(plan);
  assert.equal(captureWorkspaceBoundary(root, ["src"]).treeOid, baseline.treeOid, "target compilation must not mutate the worktree");
  assert.notEqual(plan.targetTreeOid, plan.baselineTreeOid);
  assert.deepEqual(plan.touchedPaths, [
    "src/delete.txt",
    "src/move-from.txt",
    "src/move-to.txt",
    "src/new.txt",
    "src/write.txt",
  ]);

  fs.writeFileSync(path.join(root, "src", "new.txt"), "new\n", "utf8");
  fs.writeFileSync(path.join(stateDirectory, ".materialize-file.crash-leftover"), "orphan\n", "utf8");
  const recovered = reconcileCandidateMaterialization({ workspacePath: root, stateDirectory, plan });
  assert.equal(recovered.targetTreeOid, plan.targetTreeOid);
  assert.equal(recovered.boundary.treeOid, plan.targetTreeOid);
  assert.equal(fs.readFileSync(path.join(root, "src", "write.txt"), "utf8"), "after\n");
  assert.equal(fs.readFileSync(path.join(root, "src", "new.txt"), "utf8"), "new\n");
  assert.equal(fs.existsSync(path.join(root, "src", "delete.txt")), false);
  assert.equal(fs.existsSync(path.join(root, "src", "move-from.txt")), false);
  assert.equal(fs.readFileSync(path.join(root, "src", "move-to.txt"), "utf8"), "move\n");

  const replay = reconcileCandidateMaterialization({ workspacePath: root, stateDirectory, plan });
  assert.equal(replay.boundary.treeOid, plan.targetTreeOid);
});

test("materialization recovery fails closed on an unexplained touched-path state", (t) => {
  const { root, stateDirectory } = fixture(t);
  const baseline = captureWorkspaceBoundary(root, ["src"]);
  const plan = compileCandidateMaterialization({
    stateDirectory,
    workspacePath: root,
    allowedPaths: ["src"],
    ...identities(),
    baselineTreeOid: baseline.treeOid,
    operations: [{ type: "WRITE", path: "src/write.txt", content: "after\n" }],
  });
  fs.writeFileSync(path.join(root, "src", "write.txt"), "foreign\n", "utf8");
  assert.throws(
    () => reconcileCandidateMaterialization({ workspacePath: root, stateDirectory, plan }),
    (error) => error?.code === "MH_CANDIDATE_MATERIALIZATION_FOREIGN",
  );
  assert.equal(fs.readFileSync(path.join(root, "src", "write.txt"), "utf8"), "foreign\n");
});

test("materialization recovery rejects foreign state outside the durable touched-path set", (t) => {
  const { root, stateDirectory } = fixture(t);
  const baseline = captureWorkspaceBoundary(root, ["src"]);
  const plan = compileCandidateMaterialization({
    stateDirectory,
    workspacePath: root,
    allowedPaths: ["src"],
    ...identities(),
    baselineTreeOid: baseline.treeOid,
    operations: [{ type: "WRITE", path: "src/write.txt", content: "after\n" }],
  });
  fs.writeFileSync(path.join(root, "src", "unrelated.txt"), "foreign\n", "utf8");
  assert.throws(
    () => reconcileCandidateMaterialization({ workspacePath: root, stateDirectory, plan }),
    (error) => error?.code === "MH_CANDIDATE_MATERIALIZATION_FOREIGN",
  );
  assert.equal(fs.readFileSync(path.join(root, "src", "write.txt"), "utf8"), "before\n");
});
