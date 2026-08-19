"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const { automaticRequest } = require("../lib/commands/work");
const {
  objectivePath,
  readOwnerObjectiveState,
  replaceOwnerObjectiveState,
} = require("../lib/owner-objective-state");
const { protocolRoot } = require("../lib/world-authority");
const { ROOT, runRaw } = require("./helpers/cli");
const { git, persistInitial, repository } = require("./helpers/linear-product-head");

const FAKE_WORKER = path.join(ROOT, "tests", "fixtures", "fake-coding-worker.js");

test("normal planner-enabled owner input changes only Git-common objective state", (t) => {
  const { root } = repository(t);
  fs.writeFileSync(path.join(root, "src", "a", "baseline.txt"), "owner tracked dirt\n", "utf8");
  fs.writeFileSync(path.join(root, "owner-untracked.tmp"), "owner untracked bytes\n", "utf8");

  const before = {
    head: git(root, ["rev-parse", "HEAD"]),
    status: git(root, ["status", "--porcelain=v1", "--untracked-files=all"]),
    index: git(root, ["diff", "--cached", "--binary"]),
    tracked: fs.readFileSync(path.join(root, "src", "a", "baseline.txt"), "utf8"),
    untracked: fs.readFileSync(path.join(root, "owner-untracked.tmp"), "utf8"),
  };

  const request = automaticRequest(root, "fastest honest decision-changing evidence");
  assert.deepEqual(request, { type: "REPO_WAVE" });
  const state = readOwnerObjectiveState(root);
  assert.equal(state.revision, 1);
  assert.equal(state.content, "fastest honest decision-changing evidence");
  assert.match(state.contentDigest, /^sha256:[a-f0-9]{64}$/u);
  assert.equal(objectivePath(root), path.join(protocolRoot(root), "owner-objective.json"));
  assert.equal(fs.existsSync(path.join(root, ".meta-harness", "owner-directive.md")), false);

  const continuation = automaticRequest(root, null);
  assert.deepEqual(continuation, { type: "REPO_WAVE" });
  assert.equal(readOwnerObjectiveState(root).revision, 1);

  assert.equal(git(root, ["rev-parse", "HEAD"]), before.head);
  assert.equal(git(root, ["status", "--porcelain=v1", "--untracked-files=all"]), before.status);
  assert.equal(git(root, ["diff", "--cached", "--binary"]), before.index);
  assert.equal(fs.readFileSync(path.join(root, "src", "a", "baseline.txt"), "utf8"), before.tracked);
  assert.equal(fs.readFileSync(path.join(root, "owner-untracked.tmp"), "utf8"), before.untracked);
});

test("product-surface objective capture leaves checkout unchanged end to end", (t) => {
  const { root } = repository(t);
  persistInitial(root, "world-transition/v2");
  fs.writeFileSync(path.join(root, "src", "a", "baseline.txt"), "owner tracked dirt\n", "utf8");
  fs.writeFileSync(path.join(root, "owner-untracked.tmp"), "owner untracked bytes\n", "utf8");
  const before = {
    head: git(root, ["rev-parse", "HEAD"]),
    status: git(root, ["status", "--porcelain=v1", "--untracked-files=all"]),
    index: git(root, ["diff", "--cached", "--binary"]),
    tracked: fs.readFileSync(path.join(root, "src", "a", "baseline.txt"), "utf8"),
    untracked: fs.readFileSync(path.join(root, "owner-untracked.tmp"), "utf8"),
  };

  const result = runRaw(root, ["fastest honest decision-changing evidence"], {
    env: {
      ...process.env,
      META_HARNESS_TEST_MODE: "1",
      META_HARNESS_WORKER_COMMAND_JSON: JSON.stringify([process.execPath, FAKE_WORKER]),
    },
  });
  assert.equal(result.status, 1, result.stderr || result.stdout);
  assert.match(result.stdout, /^Replan:/mu);
  const state = readOwnerObjectiveState(root);
  assert.equal(state.revision, 1);
  assert.equal(state.content, "fastest honest decision-changing evidence");
  assert.equal(git(root, ["rev-parse", "HEAD"]), before.head);
  assert.equal(git(root, ["status", "--porcelain=v1", "--untracked-files=all"]), before.status);
  assert.equal(git(root, ["diff", "--cached", "--binary"]), before.index);
  assert.equal(fs.readFileSync(path.join(root, "src", "a", "baseline.txt"), "utf8"), before.tracked);
  assert.equal(fs.readFileSync(path.join(root, "owner-untracked.tmp"), "utf8"), before.untracked);
});

test("objective revision advances across ABA even when final bytes match the original", (t) => {
  const { root } = repository(t);
  const first = replaceOwnerObjectiveState(root, "D1");
  const second = replaceOwnerObjectiveState(root, "D2");
  const third = replaceOwnerObjectiveState(root, "D1");

  assert.equal(first.revision, 1);
  assert.equal(second.revision, 2);
  assert.equal(third.revision, 3);
  assert.equal(first.contentDigest, third.contentDigest);
  assert.notEqual(first.revision, third.revision);
  assert.deepEqual(readOwnerObjectiveState(root), third);
});
