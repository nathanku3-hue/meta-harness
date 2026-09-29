"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");

const { automaticRequest } = require("../lib/commands/work");
const { objectivePath, readOwnerObjectiveState, replaceOwnerObjectiveState } = require("../lib/owner-objective-state");
const { parseExplicitGoalChange } = require("../lib/owner-turn");
const { repository } = require("./helpers/linear-product-head");

test("continuation commands stop cleanly when no active slice exists", (t) => {
  const { root } = repository(t);

  assert.deepEqual(automaticRequest(root, null), { type: "STOP" });
  assert.equal(fs.existsSync(objectivePath(root)), false);

  for (const turn of ["go", "go:", "go：", "go next", "continue"]) {
    assert.deepEqual(automaticRequest(root, turn), { type: "STOP" }, turn);
  }
  assert.equal(fs.existsSync(objectivePath(root)), false);
});

test("literal GO activates an established mission without rewriting it", (t) => {
  const { root } = repository(t);
  const before = replaceOwnerObjectiveState(root, "mission M", {
    ingressDigest: `sha256:${"a".repeat(64)}`,
  });

  for (const turn of ["go", "go:", "go：", "go next", "continue", " GO "]) {
    assert.deepEqual(automaticRequest(root, turn), { type: "REPO_WAVE" }, turn);
    assert.deepEqual(readOwnerObjectiveState(root), before);
  }
});

test("close is a deterministic detach that never rewrites or dispatches product state", (t) => {
  const { root } = repository(t);
  assert.deepEqual(automaticRequest(root, "close"), { type: "CLOSE" });
  assert.equal(readOwnerObjectiveState(root, { optional: true }), null);

  const before = replaceOwnerObjectiveState(root, "mission M", {
    ingressDigest: `sha256:${"b".repeat(64)}`,
  });
  for (const turn of ["close", " CLOSE "]) {
    assert.deepEqual(automaticRequest(root, turn), { type: "CLOSE" }, turn);
    assert.deepEqual(readOwnerObjectiveState(root), before);
  }
});

test("explicit goal replacement parser is narrow and has no conversational intent model", () => {
  assert.deepEqual(parseExplicitGoalChange("change the goal to ship parser v2"), {
    replacementObjective: "ship parser v2",
    advance: false,
  });
  assert.deepEqual(parseExplicitGoalChange("change the goal to ship parser v2 and go"), {
    replacementObjective: "ship parser v2",
    advance: true,
  });
  assert.deepEqual(parseExplicitGoalChange("change the goal to ship parser v2 then go"), {
    replacementObjective: "ship parser v2 then go",
    advance: false,
  });
  assert.equal(parseExplicitGoalChange("why?"), null);
  assert.equal(parseExplicitGoalChange("go"), null);
  assert.throws(
    () => parseExplicitGoalChange("change the goal to"),
    (error) => error.code === "MH_OWNER_TURN",
  );
});
