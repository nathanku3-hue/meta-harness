"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const { runAutomaticProductResult } = require("../lib/commands/work");
const { createOutcome } = require("../lib/outcome");
const { readOwnerObjectiveState, replaceOwnerObjectiveState } = require("../lib/owner-objective-state");
const {
  READ_ONLY_INTERACTION_RESPONSE_SCHEMA,
  buildReadOnlyInteractionPrompt,
  buildReadOnlyInteractionSnapshot,
  runReadOnlyInteraction,
  validateReadOnlyInteractionResponse,
} = require("../lib/read-only-interaction");
const { protocolRoot } = require("../lib/protocol-store");
const {
  historicalRepoRunSession,
  persistInitial,
  repository,
} = require("./helpers/linear-product-head");

function fileTree(root) {
  if (!fs.existsSync(root)) return [];
  const rows = [];
  function walk(directory, relative = "") {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const rel = relative ? `${relative}/${entry.name}` : entry.name;
      const target = path.join(directory, entry.name);
      const stat = fs.lstatSync(target);
      if (stat.isSymbolicLink()) rows.push([rel, "L", fs.readlinkSync(target)]);
      else if (stat.isDirectory()) { rows.push([rel, "D"]); walk(target, rel); }
      else if (stat.isFile()) rows.push([rel, "F", fs.readFileSync(target).toString("base64")]);
      else rows.push([rel, "O"]);
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

test("pure interaction snapshot reads PRODUCT/Git/run facts without creating control bytes", (t) => {
  const { root } = repository(t);
  const initial = persistInitial(root);
  const objective = replaceOwnerObjectiveState(root, "repair the parser without overstating impact");
  const outcome = createOutcome({
    id: "parser-repair",
    desiredState: "The reversible parser branch accepts the valid input shape.",
    preconditions: ["The parser repair is not delivered."],
    evidenceRequirement: "The focused parser regression passes.",
  });
  const session = historicalRepoRunSession(root, outcome, "parser-repair");

  const stateRoot = path.dirname(protocolRoot(root, { create: false }));
  const before = fileTree(stateRoot);
  const snapshot = buildReadOnlyInteractionSnapshot(root);
  const after = fileTree(stateRoot);

  assert.deepEqual(after, before);
  assert.equal(snapshot.schemaVersion, "read-only-interaction-snapshot/v2");
  assert.equal(snapshot.objective.revision, objective.revision);
  assert.equal(snapshot.objective.content, objective.content);
  assert.equal(snapshot.productCommit, initial.head.productCommit);
  assert.equal(snapshot.activeWork.length, 1);
  assert.equal(snapshot.activeWork[0].desiredState, session.productResult);
  assert.equal(snapshot.activeWork[0].evidenceRequirement, session.doneWhen);
  assert.deepEqual(snapshot.observations, []);
  assert.deepEqual(snapshot.promotedEvidence, []);
  for (const retired of ["currentProjection", "unresolvedWork", "claimDigest", "worldHeadDigest"]) {
    assert.equal(Object.hasOwn(snapshot, retired), false, retired);
  }
});

test("disposable responder gets only the bounded packet in a neutral cwd and strips host capability env", async (t) => {
  const { root } = repository(t);
  persistInitial(root);
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
        result: { answer: "The mission is unchanged; there is no active work in this fixture." },
      };
    },
  });

  assert.equal(result.answer, "The mission is unchanged; there is no active work in this fixture.");
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
  persistInitial(root);
  replaceOwnerObjectiveState(root, "mission M");
  const snapshot = buildReadOnlyInteractionSnapshot(root);

  for (const rawTurn of ["why is this blocking us?", "monitor", "does this matter?", "explain this from ground up"]) {
    const prompt = buildReadOnlyInteractionPrompt(rawTurn, snapshot);
    assert.equal(prompt.includes(JSON.stringify({ rawTurn })), true);
    assert.doesNotMatch(prompt, /STATUS\s*\||CAUSAL_EXPLANATION|DEEP_EXPLANATION|COMPARE\s*\|/u);
  }

  assert.deepEqual(validateReadOnlyInteractionResponse({ answer: "Grounded answer." }), { answer: "Grounded answer." });
  assert.throws(
    () => validateReadOnlyInteractionResponse({ answer: "Grounded answer.", mode: "STATUS" }),
    (error) => error.code === "MH_READ_ONLY_INTERACTION_RESULT",
  );
});

test("established-mission questions return answers without objective or protocol mutation", async (t) => {
  const { root } = repository(t);
  persistInitial(root);
  const objective = replaceOwnerObjectiveState(root, "mission M");
  const stateRoot = path.dirname(protocolRoot(root, { create: false }));
  const beforeTree = fileTree(stateRoot);
  const calls = [];
  const { context, read } = outputContext(root, async ({ repositoryPath, turn }) => {
    calls.push({ repositoryPath, turn });
    return { answer: `Answer for ${turn}` };
  });

  for (const turn of ["why?", "monitor", "does this matter?", "explain from ground up"]) {
    assert.deepEqual(await runAutomaticProductResult(turn, context), { exitCode: 0 });
    assert.deepEqual(readOwnerObjectiveState(root), objective);
    assert.deepEqual(fileTree(stateRoot), beforeTree);
  }

  assert.deepEqual(calls.map((entry) => entry.turn), ["why?", "monitor", "does this matter?", "explain from ground up"]);
  assert.equal(calls.every((entry) => entry.repositoryPath === root), true);
  assert.equal(read(), "Answer for why?\nAnswer for monitor\nAnswer for does this matter?\nAnswer for explain from ground up\n");
});

test("read-only responder cannot return executable mutation", () => {
  assert.throws(
    () => validateReadOnlyInteractionResponse({
      answer: "I can explain the current state.",
      proposedExperiment: { question: "invented mutation" },
    }),
    (error) => error.code === "MH_READ_ONLY_INTERACTION_RESULT",
  );
});

test("responder failure fails closed without objective or protocol mutation", async (t) => {
  const { root } = repository(t);
  persistInitial(root);
  const objective = replaceOwnerObjectiveState(root, "mission M");
  const stateRoot = path.dirname(protocolRoot(root, { create: false }));
  const beforeTree = fileTree(stateRoot);
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
  assert.deepEqual(fileTree(stateRoot), beforeTree);
});
