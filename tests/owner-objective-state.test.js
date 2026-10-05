"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const { automaticRequest } = require("../lib/commands/work");
const { ensureProjectHooks } = require("../lib/project-init");
const {
  clearOwnerObjectiveState,
  objectivePath,
  readOwnerObjectiveState,
  replaceOwnerObjectiveState,
} = require("../lib/owner-objective-state");
const { persistOwnerGoalIngress, readOwnerGoalIngress } = require("../lib/work-git");
const { protocolRoot } = require("../lib/protocol-store");
const { ROOT, runRaw } = require("./helpers/cli");
const { git, persistInitial, repository } = require("./helpers/linear-product-head");

const FAKE_WORKER = path.join(ROOT, "tests", "fixtures", "fake-coding-worker.js");

test("owner objective and owner-goal ingress do not require a World publication lock", (t) => {
  const { root } = repository(t);
  const result = {
    objective: replaceOwnerObjectiveState(root, "mission can advance independently"),
    ingress: persistOwnerGoalIngress(root, "deliver the next useful result"),
  };
  assert.equal(result.objective.revision, 1);
  assert.equal(readOwnerObjectiveState(root).content, "mission can advance independently");
  assert.equal(result.ingress.content, "deliver the next useful result");
  assert.equal(readOwnerGoalIngress(root, { optional: false }).content, "deliver the next useful result");
  assert.equal(fs.existsSync(path.join(protocolRoot(root), "world-authority.lock")), false);
});

test("pre-aborted normal work cannot revise owner objective state", (t) => {
  const { root } = repository(t);
  const controller = new AbortController();
  controller.abort();
  assert.equal(fs.existsSync(objectivePath(root)), false);
  assert.throws(
    () => automaticRequest(root, "must not become durable", { signal: controller.signal }),
    (error) => error.code === "MH_DRAIN_REQUESTED",
  );
  assert.equal(fs.existsSync(objectivePath(root)), false);
});

test("plain planner-enabled mission establishes only Git-common objective state", (t) => {
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

test("product-surface no-candidate completion clears temporary objective and leaves checkout unchanged", (t) => {
  const { root } = repository(t);
  persistInitial(root, "world-transition/v2");
  ensureProjectHooks({ cwd: root });
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
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(result.stdout, "No current product gap.\n");
  assert.equal(readOwnerObjectiveState(root, { optional: true }), null);
  assert.equal(git(root, ["rev-parse", "HEAD"]), before.head);
  assert.equal(git(root, ["status", "--porcelain=v1", "--untracked-files=all"]), before.status);
  assert.equal(git(root, ["diff", "--cached", "--binary"]), before.index);
  assert.equal(fs.readFileSync(path.join(root, "src", "a", "baseline.txt"), "utf8"), before.tracked);
  assert.equal(fs.readFileSync(path.join(root, "owner-untracked.tmp"), "utf8"), before.untracked);
});

test("unknown conversational turns leave durable objective state bit-identical and route read-only", (t) => {
  const { root } = repository(t);
  const initial = replaceOwnerObjectiveState(root, "mission M", {
    ingressDigest: `sha256:${"a".repeat(64)}`,
  });
  const before = {
    revision: initial.revision,
    content: initial.content,
    contentDigest: initial.contentDigest,
    ingressDigest: initial.ingressDigest,
  };

  for (const rawTurn of ["why?", "monitor", "does this matter?", "explain from ground up"]) {
    assert.deepEqual(automaticRequest(root, rawTurn), { type: "READ_ONLY_INTERACTION", turn: rawTurn });
    const current = readOwnerObjectiveState(root);
    assert.deepEqual({
      revision: current.revision,
      content: current.content,
      contentDigest: current.contentDigest,
      ingressDigest: current.ingressDigest,
    }, before);
  }
});

test("explicit mission replacement persists only owner-authored mission bytes and revises exactly once", (t) => {
  const { root } = repository(t);
  const before = replaceOwnerObjectiveState(root, "mission M");

  assert.deepEqual(
    automaticRequest(root, "change the goal to mission M3"),
    { type: "NO_DISPATCH" },
  );
  const after = readOwnerObjectiveState(root);
  assert.equal(after.revision, before.revision + 1);
  assert.equal(after.content, "mission M3");
  assert.match(after.contentDigest, /^sha256:[a-f0-9]{64}$/u);
  assert.notEqual(after.contentDigest, before.contentDigest);
});

test("mission change may independently authorize existing-mission dispatch", (t) => {
  const { root } = repository(t);
  const before = replaceOwnerObjectiveState(root, "mission M");

  assert.deepEqual(
    automaticRequest(root, "change the goal to mission M4 and go"),
    { type: "REPO_WAVE" },
  );
  const after = readOwnerObjectiveState(root);
  assert.equal(after.revision, before.revision + 1);
  assert.equal(after.content, "mission M4");
});

test("terminal objective cleanup is compare-and-delete by exact revision", (t) => {
  const { root } = repository(t);
  const first = replaceOwnerObjectiveState(root, "mission M");
  const second = replaceOwnerObjectiveState(root, "mission M2");

  assert.throws(
    () => clearOwnerObjectiveState(root, { expectedRevision: first.revision }),
    (error) => error.code === "MH_OWNER_OBJECTIVE_STALE",
  );
  assert.deepEqual(readOwnerObjectiveState(root), second);
  assert.equal(clearOwnerObjectiveState(root, { expectedRevision: second.revision }), true);
  assert.equal(readOwnerObjectiveState(root, { optional: true }), null);
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

test("source-bearing objective adoption is exactly idempotent by ingress digest", (t) => {
  const { root } = repository(t);
  const ingressA = `sha256:${"a".repeat(64)}`;
  const ingressB = `sha256:${"b".repeat(64)}`;

  const first = replaceOwnerObjectiveState(root, "normalized objective", { ingressDigest: ingressA });
  const replay = replaceOwnerObjectiveState(root, "normalized objective", { ingressDigest: ingressA });
  const next = replaceOwnerObjectiveState(root, "next objective", { ingressDigest: ingressB });

  assert.equal(first.schemaVersion, "owner-objective-state/v2");
  assert.equal(first.revision, 1);
  assert.equal(first.ingressDigest, ingressA);
  assert.deepEqual(replay, first);
  assert.equal(replay.revision, 1);
  assert.equal(next.revision, 2);
  assert.equal(next.ingressDigest, ingressB);

  assert.throws(
    () => replaceOwnerObjectiveState(root, "different content", { ingressDigest: ingressB }),
    (error) => error.code === "MH_OWNER_OBJECTIVE_STATE",
  );
});
