"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const test = require("node:test");

const {
  createExternalProposalRunner,
  extractInternalDevSpaceProposalHost,
} = require("../lib/devspace-proposal-host");
const { findExecutionClosureForOrigin } = require("../lib/execution-closure");
const { listActiveOutcomeClaims } = require("../lib/outcome-claim");
const {
  admitPreparedPlannerCandidate,
  preparePlannerCandidate,
} = require("../lib/repo-planner-admission");
const { recoverClaimCommitment, runRepoWorkWave } = require("../lib/repo-work-wave");
const {
  claimWorkSessionState,
  workspaceRegistryDirectory,
} = require("../lib/work-git");
const { runWork } = require("../lib/work-loop");
const { readWorkspaceCustody, workspaceExecutionLeasesOwnedByPid } = require("../lib/workspace-custody");
const { readCurrentWorldState } = require("../lib/world-transition");
const {
  fakeInterpretation,
  monotonicNow,
  persistInitial,
  proposal,
  repository,
} = require("./helpers/linear-product-head");

function candidate(id, paths = [`src/${id}`]) {
  const value = proposal(id, { allowedPaths: paths });
  return {
    id: value.id,
    productResult: value.productResult,
    objectRefs: [],
    hypothesisRef: null,
    criterionRefs: [],
    metricRefs: [],
    journeyState: value.journeyState,
    doNow: value.doNow,
    newlyTrueBehavior: value.newlyTrueBehavior,
    doneWhen: value.doneWhen,
    stopOnlyIf: value.stopOnlyIf,
    expectedWritePaths: paths,
    continuesFromTransitionDigests: [],
  };
}

function admittedClaim(t, id = "a") {
  const { root } = repository(t);
  persistInitial(root, "world-transition/v2");
  const current = readCurrentWorldState(root);
  const prepared = preparePlannerCandidate(root, current, candidate(id));
  const admitted = admitPreparedPlannerCandidate(root, current, prepared);
  return { root, ...admitted };
}

function hostBinding(request, digit = "7") {
  return {
    schemaVersion: "meta-proposal-activation/v1",
    packetDigest: request.packet.packetDigest,
    taskId: `proposal_${digit.repeat(8)}`,
    taskDigest: `sha256:${digit.repeat(64)}`,
    activationEstablished: true,
  };
}

async function startFakeProposalBridge(token, onEnsure) {
  const server = http.createServer(async (request, response) => {
    try {
      assert.equal(request.method, "POST");
      assert.equal(request.url, "/ensure");
      assert.equal(request.headers.authorization, `Bearer ${token}`);
      const chunks = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      const binding = await onEnsure(body);
      const text = JSON.stringify(binding);
      response.statusCode = 200;
      response.setHeader("content-type", "application/json");
      response.end(text);
    } catch (error) {
      response.statusCode = 500;
      response.end(JSON.stringify({ error: error?.message || String(error) }));
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  return {
    endpoint: `http://127.0.0.1:${address.port}/ensure`,
    close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}

test("external proposal runner persists intent before host effect and leaves the entered Claim EXTERNAL_OPEN", async (t) => {
  const fixture = admittedClaim(t);
  const requests = [];
  const proposalHost = {
    ensureActivation: async (request) => {
      const dispatchDir = path.join(workspaceRegistryDirectory(fixture.root), "proposal-dispatch");
      const intents = fs.readdirSync(dispatchDir).filter((name) => name.endsWith(".intent.json"));
      assert.equal(intents.length, 1, "durable dispatch intent must exist before the external host effect");
      const durable = JSON.parse(fs.readFileSync(path.join(dispatchDir, intents[0]), "utf8"));
      assert.equal(durable.request.packet.packetDigest, request.packet.packetDigest);
      requests.push(request);
      return hostBinding(request);
    },
  };
  const result = await runWork({
    repositoryPath: fixture.root,
    session: fixture.session,
    runner: createExternalProposalRunner(proposalHost),
  });

  assert.equal(result.control, "EXTERNAL_OPEN");
  assert.match(result.packetDigest, /^sha256:[a-f0-9]{64}$/u);
  assert.match(result.intentDigest, /^sha256:[a-f0-9]{64}$/u);
  assert.match(result.receiptDigest, /^sha256:[a-f0-9]{64}$/u);
  assert.equal(result.hostError, null);
  assert.equal(requests.length, 1);
  assert.deepEqual(Object.keys(requests[0]).sort(), ["packet", "prompt", "schemaVersion", "workerResultSchema", "workspaceRoot"]);
  assert.equal(requests[0].schemaVersion, "meta-proposal-ensure/v1");
  assert.equal(requests[0].packet.packetDigest, result.packetDigest);
  assert.equal(Object.hasOwn(requests[0], "dispatchId"), false);
  assert.equal(Object.hasOwn(requests[0], "requestId"), false);
  assert.match(requests[0].prompt, /Delegated proposal authority/u);
  assert.match(requests[0].prompt, /LIVE_PERMIT\s+the originating process-owned ExecutionPermit is provenance only/u);
  assert.doesNotMatch(requests[0].prompt, /Execution authority \(compiled by the controller; valid for this attempt only\)/u);
  assert.doesNotMatch(requests[0].prompt, /Treat the ExecutionPermit as the complete authority/u);

  const state = claimWorkSessionState(fixture.root, fixture.claim.claimDigest);
  assert.equal(state.state, "ACTIVE");
  const custody = readWorkspaceCustody(workspaceRegistryDirectory(fixture.root), state.workspaceId);
  assert.equal(custody.state, "ACTIVE");
  assert.equal(workspaceExecutionLeasesOwnedByPid(workspaceRegistryDirectory(fixture.root), process.pid).length, 0);
  assert.equal(findExecutionClosureForOrigin(fixture.root, fixture.session.origin), null);
  assert.equal(listActiveOutcomeClaims(fixture.root).length, 1);

  const recovered = recoverClaimCommitment(fixture.root, fixture.claim);
  assert.equal(recovered.type, "EXTERNAL_OPEN");
  assert.equal(recovered.intent.intentDigest, result.intentDigest);
  assert.equal(recovered.receipt.receiptDigest, result.receiptDigest);
  assert.equal(recovered.intent.request.packet.packetDigest, result.packetDigest);
});

test("host failure after durable intent stays EXTERNAL_OPEN and next repo invocation reconciles the same packet once", async (t) => {
  const fixture = admittedClaim(t);
  let failedCalls = 0;
  const failedHost = {
    ensureActivation: async () => {
      failedCalls += 1;
      const error = new Error("host unavailable after intent");
      error.code = "HOST_DOWN";
      throw error;
    },
  };
  const first = await runWork({
    repositoryPath: fixture.root,
    session: fixture.session,
    runner: createExternalProposalRunner(failedHost),
  });
  assert.equal(first.control, "EXTERNAL_OPEN");
  assert.equal(first.receiptDigest, null);
  assert.equal(first.hostError, "HOST_DOWN");
  assert.equal(failedCalls, 1);
  assert.equal(recoverClaimCommitment(fixture.root, fixture.claim).type, "EXTERNAL_OPEN");
  assert.equal(findExecutionClosureForOrigin(fixture.root, fixture.session.origin), null);

  const healthyRequests = [];
  const healthyHost = {
    ensureActivation: async (request) => {
      healthyRequests.push(request);
      return hostBinding(request, "8");
    },
  };
  const result = await runRepoWorkWave({
    repositoryPath: fixture.root,
    proposalHost: healthyHost,
    plannerRunner: async ({ plannerInput }) => {
      assert.equal(plannerInput.activeCommitments.length, 1);
      assert.equal(plannerInput.activeCommitments[0].state, "external_open");
      assert.equal(plannerInput.unresolvedHandoffs.length, 0);
      return { batch: { schemaVersion: "planner-candidate-batch/v3", proposals: [] } };
    },
    runner: async () => { throw new Error("local coding runner must never replay EXTERNAL_OPEN"); },
    interpret: fakeInterpretation,
    now: monotonicNow(),
  });
  assert.equal(healthyRequests.length, 1);
  assert.equal(healthyRequests[0].packet.packetDigest, first.packetDigest);
  assert.equal(result.externalOpen, 1);
  assert.equal(result.runningElsewhere, 0);
  assert.deepEqual(result.outcomes.map((entry) => entry.state), ["EXTERNAL_OPEN"]);
  assert.equal(result.endgameCoverage, null);
  assert.equal(findExecutionClosureForOrigin(fixture.root, fixture.session.origin), null);
  assert.equal(listActiveOutcomeClaims(fixture.root).length, 1);
});

test("controlled drain after durable external intent preserves the route instead of manufacturing ATTEMPT_ABORTED", async (t) => {
  const fixture = admittedClaim(t);
  const controller = new AbortController();
  const proposalHost = {
    ensureActivation: async () => {
      controller.abort();
      const error = new Error("parent continuation drained after external intent");
      error.code = "MH_DRAIN_REQUESTED";
      throw error;
    },
  };
  const result = await runWork({
    repositoryPath: fixture.root,
    session: fixture.session,
    runner: createExternalProposalRunner(proposalHost),
    signal: controller.signal,
  });
  assert.equal(result.control, "EXTERNAL_OPEN");
  assert.equal(result.receiptDigest, null);
  assert.equal(recoverClaimCommitment(fixture.root, fixture.claim).type, "EXTERNAL_OPEN");
  assert.equal(findExecutionClosureForOrigin(fixture.root, fixture.session.origin), null);
  assert.equal(listActiveOutcomeClaims(fixture.root).length, 1);
});

test("internal bridge secrets are stripped before any planner or model environment can receive them", () => {
  const extracted = extractInternalDevSpaceProposalHost({
    PATH: "safe-path",
    META_HARNESS_INTERNAL_DEVSPACE_PROPOSAL_ENDPOINT: "http://127.0.0.1:4567/ensure",
    META_HARNESS_INTERNAL_DEVSPACE_PROPOSAL_TOKEN: "b".repeat(64),
  });
  assert.ok(extracted.proposalHost);
  assert.equal(extracted.modelEnv.PATH, "safe-path");
  assert.equal(Object.hasOwn(extracted.modelEnv, "META_HARNESS_INTERNAL_DEVSPACE_PROPOSAL_ENDPOINT"), false);
  assert.equal(Object.hasOwn(extracted.modelEnv, "META_HARNESS_INTERNAL_DEVSPACE_PROPOSAL_TOKEN"), false);
  assert.equal(Object.hasOwn(extracted.proposalHost, "token"), false);
});

test("private bridge environment drives the Meta HTTP client while planner/model env stays sanitized", async (t) => {
  const fixture = admittedClaim(t, "a");
  const token = "c".repeat(64);
  const requests = [];
  const bridge = await startFakeProposalBridge(token, async (request) => {
    requests.push(request);
    return hostBinding(request, "3");
  });
  try {
    const result = await runRepoWorkWave({
      repositoryPath: fixture.root,
      env: {
        ...process.env,
        R3_SAFE_ENV_SENTINEL: "present",
        META_HARNESS_INTERNAL_DEVSPACE_PROPOSAL_ENDPOINT: bridge.endpoint,
        META_HARNESS_INTERNAL_DEVSPACE_PROPOSAL_TOKEN: token,
      },
      plannerRunner: async ({ plannerInput, env }) => {
        assert.equal(plannerInput.activeCommitments.length, 1);
        assert.ok(["running_elsewhere", "external_open"].includes(plannerInput.activeCommitments[0].state));
        assert.equal(env.R3_SAFE_ENV_SENTINEL, "present");
        assert.equal(Object.hasOwn(env, "META_HARNESS_INTERNAL_DEVSPACE_PROPOSAL_ENDPOINT"), false);
        assert.equal(Object.hasOwn(env, "META_HARNESS_INTERNAL_DEVSPACE_PROPOSAL_TOKEN"), false);
        return { batch: { schemaVersion: "planner-candidate-batch/v3", proposals: [] } };
      },
      runner: async () => { throw new Error("internal bridge capability must replace the local coding runner"); },
      interpret: fakeInterpretation,
      now: monotonicNow(),
    });
    assert.equal(result.externalOpen, 1);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].schemaVersion, "meta-proposal-ensure/v1");
    assert.match(requests[0].packet.packetDigest, /^sha256:[a-f0-9]{64}$/u);
    assert.equal(findExecutionClosureForOrigin(fixture.root, fixture.session.origin), null);
  } finally {
    await bridge.close();
  }
});

test("repo wave fills independent Claim capacity with distinct external packets and re-entry never duplicates them", async (t) => {
  const fixture = admittedClaim(t, "a");
  const firstHost = {
    ensureActivation: async (request) => hostBinding(request, "4"),
  };
  const seeded = await runWork({
    repositoryPath: fixture.root,
    session: fixture.session,
    runner: createExternalProposalRunner(firstHost),
  });
  assert.equal(seeded.control, "EXTERNAL_OPEN");

  const firstWavePackets = [];
  const taskDigitByPacket = new Map([[seeded.packetDigest, "4"]]);
  let localCalls = 0;
  const bindingFor = (request) => {
    let digit = taskDigitByPacket.get(request.packet.packetDigest);
    if (!digit) {
      digit = String(4 + taskDigitByPacket.size);
      taskDigitByPacket.set(request.packet.packetDigest, digit);
    }
    return hostBinding(request, digit);
  };
  const waveHost = {
    ensureActivation: async (request) => {
      firstWavePackets.push(request.packet.packetDigest);
      return bindingFor(request);
    },
  };
  const firstWave = await runRepoWorkWave({
    repositoryPath: fixture.root,
    proposalHost: waveHost,
    plannerRunner: async ({ plannerInput }) => {
      assert.equal(plannerInput.activeCommitments.some((entry) => entry.outcome.id === "a" && entry.state === "external_open"), true);
      const active = new Set(plannerInput.activeCommitments.map((entry) => entry.outcome.id));
      const proposals = ["b", "c"].filter((id) => !active.has(id)).map((id) => candidate(id));
      return { batch: { schemaVersion: "planner-candidate-batch/v3", proposals } };
    },
    runner: async () => {
      localCalls += 1;
      throw new Error("local coding worker must not run when the internal proposal host is present");
    },
    interpret: fakeInterpretation,
    now: monotonicNow(),
  });
  assert.equal(localCalls, 0);
  assert.equal(firstWave.admitted, 2);
  assert.equal(firstWave.externalOpen, 3);
  assert.equal(listActiveOutcomeClaims(fixture.root).length, 3);
  assert.equal(firstWavePackets.length, 3);
  assert.equal(new Set(firstWavePackets).size, 3);

  const retainedPacketDigests = new Set(firstWavePackets);
  const secondWavePackets = [];
  const secondWave = await runRepoWorkWave({
    repositoryPath: fixture.root,
    proposalHost: {
      ensureActivation: async (request) => {
        secondWavePackets.push(request.packet.packetDigest);
        return bindingFor(request);
      },
    },
    plannerRunner: async ({ plannerInput }) => {
      assert.equal(plannerInput.capacity.availableSlots, 0);
      return { batch: { schemaVersion: "planner-candidate-batch/v3", proposals: [] } };
    },
    runner: async () => {
      localCalls += 1;
      throw new Error("local coding worker must never replay retained external work");
    },
    interpret: fakeInterpretation,
    now: monotonicNow(),
  });
  assert.equal(secondWave.admitted, 0);
  assert.equal(secondWave.externalOpen, 3);
  assert.equal(listActiveOutcomeClaims(fixture.root).length, 3);
  assert.equal(secondWavePackets.length, 3);
  assert.deepEqual(new Set(secondWavePackets), retainedPacketDigests);
  assert.equal(localCalls, 0);
});

test("receipt task substitution fails closed without aborting or releasing the external Claim", async (t) => {
  const fixture = admittedClaim(t);
  const firstHost = {
    ensureActivation: async (request) => hostBinding(request, "9"),
  };
  const first = await runWork({
    repositoryPath: fixture.root,
    session: fixture.session,
    runner: createExternalProposalRunner(firstHost),
  });
  assert.match(first.receiptDigest, /^sha256:/u);

  await assert.rejects(
    runRepoWorkWave({
      repositoryPath: fixture.root,
      proposalHost: {
        ensureActivation: async (request) => hostBinding(request, "a"),
      },
      plannerRunner: async () => ({ batch: { schemaVersion: "planner-candidate-batch/v3", proposals: [] } }),
      interpret: fakeInterpretation,
      now: monotonicNow(),
    }),
    (error) => error?.code === "MH_PROPOSAL_DISPATCH_RECEIPT_CONFLICT",
  );

  assert.equal(recoverClaimCommitment(fixture.root, fixture.claim).type, "EXTERNAL_OPEN");
  assert.equal(findExecutionClosureForOrigin(fixture.root, fixture.session.origin), null);
  assert.equal(listActiveOutcomeClaims(fixture.root).length, 1);
});
