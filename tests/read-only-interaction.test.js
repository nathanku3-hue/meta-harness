"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const { runAutomaticProductResult } = require("../lib/commands/work");
const { createOutcome, persistOutcome } = require("../lib/outcome");
const { acquireOutcomeClaim } = require("../lib/outcome-claim");
const { readOwnerObjectiveState, replaceOwnerObjectiveState } = require("../lib/owner-objective-state");
const {
  READ_ONLY_INTERACTION_RESPONSE_SCHEMA,
  buildReadOnlyInteractionPrompt,
  buildReadOnlyInteractionSnapshot,
  runReadOnlyInteraction,
  validateReadOnlyInteractionResponse,
} = require("../lib/read-only-interaction");
const { protocolRoot } = require("../lib/world-authority");
const { persistInitial, repository } = require("./helpers/linear-product-head");

function fileTree(root) {
  if (!fs.existsSync(root)) return [];
  const rows = [];
  function walk(directory, relative = "") {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const rel = relative ? `${relative}/${entry.name}` : entry.name;
      const target = path.join(directory, entry.name);
      const stat = fs.lstatSync(target);
      if (stat.isSymbolicLink()) {
        rows.push([rel, "L", fs.readlinkSync(target)]);
      } else if (stat.isDirectory()) {
        rows.push([rel, "D"]);
        walk(target, rel);
      } else if (stat.isFile()) {
        rows.push([rel, "F", fs.readFileSync(target).toString("base64")]);
      } else {
        rows.push([rel, "O"]);
      }
    }
  }
  walk(root);
  return rows;
}

function outputContext(root, responder) {
  let stdout = "";
  return {
    context: {
      cwd: root,
      env: {},
      platform: process.platform,
      signal: new AbortController().signal,
      stdout: { write(chunk) { stdout += String(chunk); } },
      stderr: { write() {} },
      readOnlyInteractionRunner: responder,
    },
    read: () => stdout,
  };
}

test("pure interaction snapshot reads current truth without creating or changing control-plane bytes", (t) => {
  const { root } = repository(t);
  const current = persistInitial(root, "world-transition/v2");
  const objective = replaceOwnerObjectiveState(root, "repair the parser without overstating impact");
  const outcome = createOutcome({
    id: "parser-repair",
    desiredState: "The reversible parser branch accepts the valid input shape.",
    preconditions: ["The current semantic projection remains current."],
    evidenceRequirement: "The focused parser regression passes.",
  });
  persistOutcome(root, outcome);
  const claim = acquireOutcomeClaim({
    repositoryPath: root,
    outcomeDigest: outcome.outcomeDigest,
    originWorldHeadDigest: current.head.headDigest,
    executionBoundary: { writePaths: ["src/a"] },
    now: new Date("2026-09-05T12:00:00.000Z"),
  });

  const authorityRoot = path.dirname(protocolRoot(root, { create: false }));
  const before = fileTree(authorityRoot);
  const snapshot = buildReadOnlyInteractionSnapshot(root);
  const after = fileTree(authorityRoot);

  assert.deepEqual(after, before);
  assert.equal(snapshot.objective.revision, objective.revision);
  assert.equal(snapshot.objective.content, objective.content);
  assert.equal(snapshot.objective.contentDigest, objective.contentDigest);
  assert.equal(snapshot.productCommit, current.head.productCommit);
  assert.equal(snapshot.currentProjection.schemaVersion, "repo-world/v2");
  assert.equal(snapshot.activeWork.length, 1);
  assert.equal(snapshot.activeWork[0].desiredState, outcome.desiredState);
  assert.equal(Object.hasOwn(snapshot.activeWork[0], "runKey"), false);
  assert.equal(Object.hasOwn(snapshot.activeWork[0], "claimDigest"), false);
  assert.deepEqual(snapshot.unresolvedWork, []);
  assert.deepEqual(snapshot.promotedEvidence, []);
});

test("disposable responder gets only the bounded packet in a neutral cwd and strips host capability env", async (t) => {
  const { root } = repository(t);
  persistInitial(root, "world-transition/v2");
  replaceOwnerObjectiveState(root, "explain the current evidence before changing anything");
  let captured = null;

  const result = await runReadOnlyInteraction({
    repositoryPath: root,
    turn: "monitor",
    env: {
      META_HARNESS_INTERNAL_DEVSPACE_PROPOSAL_ENDPOINT: "http://127.0.0.1:9/",
      META_HARNESS_INTERNAL_DEVSPACE_PROPOSAL_TOKEN: "secret-capability-token-value",
      META_HARNESS_INTERNAL_HOST_RESULT: "1",
      SAFE_VALUE: "kept",
    },
    modelRunner: async (options) => {
      captured = options;
      return {
        model: "fake-read-only-responder",
        result: { answer: "The mission is unchanged; there is no active claimed work in this fixture." },
      };
    },
  });

  assert.equal(result.answer, "The mission is unchanged; there is no active claimed work in this fixture.");
  assert.ok(captured);
  assert.equal(captured.skipGitRepoCheck, true);
  assert.equal(captured.outputSchema, READ_ONLY_INTERACTION_RESPONSE_SCHEMA);
  assert.equal(captured.env.SAFE_VALUE, "kept");
  assert.equal(captured.env.META_HARNESS_INTERNAL_DEVSPACE_PROPOSAL_ENDPOINT, undefined);
  assert.equal(captured.env.META_HARNESS_INTERNAL_DEVSPACE_PROPOSAL_TOKEN, undefined);
  assert.equal(captured.env.META_HARNESS_INTERNAL_HOST_RESULT, undefined);
  assert.notEqual(path.resolve(captured.cwd).toLowerCase(), path.resolve(root).toLowerCase());
  assert.equal(captured.prompt.includes(path.resolve(root)), false);
  assert.match(captured.prompt, /"rawTurn":"monitor"/u);
  assert.match(captured.prompt, /explain the current evidence before changing anything/u);
});

test("read-only prompt answers the raw turn directly without an intent taxonomy", (t) => {
  const { root } = repository(t);
  persistInitial(root, "world-transition/v2");
  replaceOwnerObjectiveState(root, "mission M");
  const snapshot = buildReadOnlyInteractionSnapshot(root);

  for (const rawTurn of ["why is this blocking us?", "monitor", "does this matter?", "explain this from ground up"]) {
    const prompt = buildReadOnlyInteractionPrompt(rawTurn, snapshot);
    assert.match(prompt, new RegExp(JSON.stringify({ rawTurn }).replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"));
    assert.doesNotMatch(prompt, /STATUS\s*\||CAUSAL_EXPLANATION|DEEP_EXPLANATION|COMPARE\s*\|/u);
  }

  assert.deepEqual(validateReadOnlyInteractionResponse({ answer: "Grounded answer." }), { answer: "Grounded answer." });
  assert.throws(
    () => validateReadOnlyInteractionResponse({ answer: "Grounded answer.", mode: "STATUS" }),
    (error) => error.code === "MH_READ_ONLY_INTERACTION_RESULT",
  );
});

test("established-mission questions return answers without objective or authority mutation", async (t) => {
  const { root } = repository(t);
  persistInitial(root, "world-transition/v2");
  const objective = replaceOwnerObjectiveState(root, "mission M");
  const authorityRoot = path.dirname(protocolRoot(root, { create: false }));
  const beforeTree = fileTree(authorityRoot);
  const calls = [];
  const { context, read } = outputContext(root, async ({ repositoryPath, turn }) => {
    calls.push({ repositoryPath, turn });
    return { answer: `Answer for ${turn}` };
  });

  for (const turn of ["why?", "monitor", "does this matter?", "explain from ground up"]) {
    assert.deepEqual(await runAutomaticProductResult(turn, context), { exitCode: 0 });
    assert.deepEqual(readOwnerObjectiveState(root), objective);
    assert.deepEqual(fileTree(authorityRoot), beforeTree);
  }

  assert.deepEqual(calls.map((entry) => entry.turn), ["why?", "monitor", "does this matter?", "explain from ground up"]);
  assert.equal(calls.every((entry) => entry.repositoryPath === root), true);
  assert.equal(read(), "Answer for why?\nAnswer for monitor\nAnswer for does this matter?\nAnswer for explain from ground up\n");
});

test("responder failure fails closed without objective or control-plane mutation", async (t) => {
  const { root } = repository(t);
  persistInitial(root, "world-transition/v2");
  const objective = replaceOwnerObjectiveState(root, "mission M");
  const authorityRoot = path.dirname(protocolRoot(root, { create: false }));
  const beforeTree = fileTree(authorityRoot);
  const { context } = outputContext(root, async () => {
    const error = new Error("synthetic responder failure");
    error.code = "SYNTHETIC_READ_ONLY_FAILURE";
    throw error;
  });

  await assert.rejects(
    () => runAutomaticProductResult("why?", context),
    (error) => error.code === "SYNTHETIC_READ_ONLY_FAILURE",
  );
  assert.deepEqual(readOwnerObjectiveState(root), objective);
  assert.deepEqual(fileTree(authorityRoot), beforeTree);
});
