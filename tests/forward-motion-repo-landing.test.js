"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { findExecutionClosureForOrigin } = require("../lib/execution-closure");
const {
  admitPreparedRepoProposal,
  loadRepoProposalSet,
  outcomeForProposal,
  prepareRepoProposal,
} = require("../lib/repo-proposal-set");
const { landOutcomeClosure } = require("../lib/repo-outcome-landing");
const { runWork } = require("../lib/work-loop");
const { computeRepoWorldDigest, computeWorldAttestationDigest } = require("../lib/world-attestation");
const { readCurrentWorldState } = require("../lib/world-transition");
const {
  monotonicNow,
  persistInitial,
  proposal,
  repository,
  writeProposalSet,
} = require("./helpers/linear-product-head");

function stopResult() {
  return {
    worker: "forward-motion-repo-test-worker",
    stdout: "",
    stderr: "",
    result: {
      schemaVersion: "worker-result/v2",
      status: "STOP",
      observableResult: "Preferred source is incomplete.",
      operations: [],
      validation: ["preferred source inspected"],
      stop: {
        unsatisfiedRequirement: "The preferred source does not establish the requested result.",
        failedMeans: [{ means: "preferred source", evidence: ["coverage is incomplete"] }],
        alternativesConsidered: [],
        assertedConstraint: "A fictional librarian approval might be needed.",
      },
    },
  };
}

function replanCandidate() {
  return {
    challenger: "forward-motion-repo-test-challenger",
    stdout: "",
    stderr: "",
    candidate: {
      disposition: "REPLAN_REQUIRED",
      failedMeans: [{ means: "preferred source", evidence: ["coverage is incomplete"] }],
      alternatives: [{
        means: "different evidence decomposition",
        disposition: "AVAILABLE",
        evidence: ["autonomous evidence work remains possible outside this sealed decomposition"],
        requiredPaths: [],
      }],
      hardConstraint: null,
      ownerRequest: null,
      disprovedAssertions: ["librarian approval is not constitutional owner authority"],
    },
  };
}

function replanInterpretation({ input, now }) {
  assert.equal(input.workResult.result.outcome, "REPLAN_REQUIRED");
  assert.equal(input.forwardMotionProof.proofDigest, input.workResult.result.forwardMotionProofDigest);
  assert.equal(input.forwardMotionProof.disposition, "REPLAN_REQUIRED");
  const replans = Array.isArray(input.currentWorld.payload.replans) ? input.currentWorld.payload.replans : [];
  const successorWorld = {
    schemaVersion: "repo-world/v2",
    productDirectionDigest: input.currentWorld.productDirectionDigest,
    payload: { ...input.currentWorld.payload, replans: [...replans, input.outcome.id] },
  };
  const worldDigest = computeRepoWorldDigest(successorWorld);
  const body = {
    schemaVersion: "world-attestation/v1",
    worldDigest,
    projectorDigest: input.currentAttestation.projectorDigest,
    sources: input.currentAttestation.sources,
    generatedAt: now.toISOString(),
  };
  return {
    schemaVersion: "repo-closure-interpretation/v1",
    disposition: "APPLIED",
    interpretation: { replannedOutcome: input.outcome.id, forwardMotionProofDigest: input.forwardMotionProof.proofDigest },
    successorWorld,
    successorAttestation: { ...body, attestationDigest: computeWorldAttestationDigest(body) },
  };
}

test("repo-owned REPLAN_REQUIRED lands exact forward-motion proof without integrating code", async (t) => {
  const { root } = repository(t);
  const initial = persistInitial(root, "world-transition/v2");
  writeProposalSet(root, initial.head.headDigest, [proposal("a")]);
  const current = readCurrentWorldState(root);
  const proposalSet = loadRepoProposalSet(root, current);
  const value = proposalSet.value.proposals[0];
  const outcome = outcomeForProposal(root, value);
  const prepared = prepareRepoProposal(root, proposalSet, value, { outcome });
  const admitted = admitPreparedRepoProposal(root, proposalSet, prepared);

  const result = await runWork({
    repositoryPath: root,
    session: admitted.session,
    runner: async () => stopResult(),
    forwardMotionRunner: async () => replanCandidate(),
    timeoutSeconds: 30,
  });
  assert.equal(result.outcome, "REPLAN_REQUIRED");
  assert.deepEqual(result.changedPaths, []);
  assert.match(result.forwardMotionProofDigest, /^sha256:[a-f0-9]{64}$/u);

  const closure = findExecutionClosureForOrigin(root, admitted.session.origin);
  const landing = landOutcomeClosure({
    repositoryPath: root,
    claim: admitted.claim,
    closure,
    interpret: replanInterpretation,
    now: monotonicNow(),
  });
  assert.equal(landing.state, "REPLAN_REQUIRED");
  const final = readCurrentWorldState(root);
  assert.equal(final.head.productCommit, initial.head.productCommit);
  assert.deepEqual(final.world.payload.learned, []);
  assert.deepEqual(final.world.payload.replans, ["a"]);
});
