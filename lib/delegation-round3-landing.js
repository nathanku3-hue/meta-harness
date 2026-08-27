"use strict";

const {
  acceptDelegationRound2FanIn,
  validateDelegationRound2Contract,
} = require("./delegation-round2-contract");
const {
  delegationLearningFromAcceptance,
  persistDelegationLearning,
  readDelegationLearning,
} = require("./delegation-round3-learning");
const { ConfigError } = require("./errors");
const { readOutcome } = require("./outcome");
const {
  REPO_CLOSURE_INTERPRETATION_SCHEMA,
  runRepositoryClosureInterpreter,
  validateRepositoryInterpretation,
} = require("./repo-closure-interpreter");
const { persistImmutableBytes, persistImmutableJson, readImmutableJson } = require("./world-authority");
const { computeRepoWorldDigest } = require("./world-attestation");
const {
  WORLD_TRANSITION_SCHEMA,
  commitTransition,
  computeInterpretationDigest,
  computeWorldTransitionDigest,
  readCurrentWorldState,
  validateWorldHead,
  validateWorldTransition,
} = require("./world-transition");

const REPO_DELEGATION_LANDING_INPUT_SCHEMA = "repo-delegation-landing-input/v1";
const MAX_DELEGATION_LANDING_ATTEMPTS = 3;

function fail(code, message, details) {
  throw new ConfigError(message, { code, details });
}

function interpretationBytes(interpretation) {
  return Buffer.from(`${JSON.stringify({
    schemaVersion: REPO_CLOSURE_INTERPRETATION_SCHEMA,
    disposition: interpretation.disposition,
    interpretation: interpretation.interpretation,
  }, null, 2)}\n`, "utf8");
}

function validateInterpretation(repositoryPath, current, produced, now) {
  return validateRepositoryInterpretation({
    schemaVersion: produced?.schemaVersion,
    disposition: produced?.disposition,
    interpretation: produced?.interpretation,
    successorWorld: produced?.successorWorld,
    successorAttestation: produced?.successorAttestation,
  }, { repositoryPath, currentWorld: current.world, now });
}

function landingInput(repositoryPath, current, learning) {
  return Object.freeze({
    schemaVersion: REPO_DELEGATION_LANDING_INPUT_SCHEMA,
    currentHead: current.head,
    currentWorld: current.world,
    currentAttestation: current.attestation,
    outcome: readOutcome(repositoryPath, learning.outcomeDigest),
    delegationLearning: learning,
  });
}

function delegationTransition(repositoryPath, current, learning, interpretation) {
  const worldDigest = computeRepoWorldDigest(interpretation.successorWorld);
  if (worldDigest !== interpretation.successorWorldDigest) {
    fail("MH_DELEGATION_R3_WORLD", "delegation interpretation World digest changed before persistence");
  }
  persistImmutableJson(repositoryPath, "worlds", worldDigest, interpretation.successorWorld, "MH_DELEGATION_R3_WORLD_WRITE");
  persistImmutableJson(
    repositoryPath,
    "attestations",
    interpretation.successorAttestation.attestationDigest,
    interpretation.successorAttestation,
    "MH_DELEGATION_R3_ATTESTATION_WRITE",
  );
  const bytes = interpretationBytes(interpretation);
  const interpretationDigest = computeInterpretationDigest(bytes);
  persistImmutableBytes(repositoryPath, "interpretations", interpretationDigest, bytes, "MH_DELEGATION_R3_INTERPRETATION_WRITE");
  const body = {
    schemaVersion: WORLD_TRANSITION_SCHEMA,
    predecessorHeadDigest: current.head.headDigest,
    cause: {
      type: "DELEGATION_LEARNING",
      delegationLearningDigest: learning.learningDigest,
      interpretationDigest,
    },
    successorWorldDigest: worldDigest,
    successorAttestationDigest: interpretation.successorAttestation.attestationDigest,
    successorProductCommit: current.head.productCommit,
  };
  return validateWorldTransition({ ...body, transitionDigest: computeWorldTransitionDigest(body) });
}

function findDelegationLanding(repositoryPath, current, resultDigest) {
  let head = current?.head || null;
  while (head) {
    const transition = validateWorldTransition(readImmutableJson(repositoryPath, "transitions", head.lastTransitionDigest));
    if (transition.transitionDigest !== head.lastTransitionDigest) {
      fail("MH_DELEGATION_R3_LINEAGE", "authoritative World lineage has a mismatched transition identity");
    }
    if (transition.cause.type === "DELEGATION_LEARNING") {
      const learning = readDelegationLearning(repositoryPath, transition.cause.delegationLearningDigest);
      if (learning.resultDigest === resultDigest) {
        return Object.freeze({ head, transition, learning });
      }
    }
    if (transition.predecessorHeadDigest === null) break;
    head = validateWorldHead(readImmutableJson(repositoryPath, "heads", transition.predecessorHeadDigest));
    if (head.headDigest !== transition.predecessorHeadDigest) {
      fail("MH_DELEGATION_R3_LINEAGE", "authoritative World lineage has a mismatched predecessor Head identity");
    }
  }
  return null;
}

function landedResult(repositoryPath, landing, { attempts = 0, status = "ALREADY_LANDED" } = {}) {
  const interpretation = readImmutableJson(
    repositoryPath,
    "interpretations",
    landing.transition.cause.interpretationDigest,
  );
  const state = interpretation.disposition === "INVALIDATED_REPLAN" ? "INVALIDATED_REPLAN" : "LANDED";
  return Object.freeze({
    status,
    state,
    laneKey: landing.learning.laneKey,
    outcomeDigest: landing.learning.outcomeDigest,
    resultDigest: landing.learning.resultDigest,
    learningDigest: landing.learning.learningDigest,
    transitionDigest: landing.transition.transitionDigest,
    headDigest: landing.head.headDigest,
    productCommit: landing.head.productCommit,
    acceptance: landing.learning.acceptance,
    disposition: interpretation.disposition,
    attempts,
  });
}

function landDelegationLearning({
  repositoryPath,
  learning,
  interpret = runRepositoryClosureInterpreter,
  now = () => new Date(),
  maxAttempts = MAX_DELEGATION_LANDING_ATTEMPTS,
}) {
  const persisted = persistDelegationLearning(repositoryPath, learning);
  const before = readCurrentWorldState(repositoryPath, { now: now() });
  const already = findDelegationLanding(repositoryPath, before, persisted.resultDigest);
  if (already) return landedResult(repositoryPath, already);

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const currentNow = now();
    const current = readCurrentWorldState(repositoryPath, { now: currentNow });
    if (current.head.schemaVersion !== "world-head/v2") {
      fail("MH_DELEGATION_R3_WORLD", "delegation learning requires authoritative world-head/v2 product authority");
    }
    const replay = findDelegationLanding(repositoryPath, current, persisted.resultDigest);
    if (replay) return landedResult(repositoryPath, replay, { attempts: attempt - 1 });
    const input = landingInput(repositoryPath, current, persisted);
    const interpretation = validateInterpretation(
      repositoryPath,
      current,
      interpret({ repositoryPath, input, now: currentNow }),
      currentNow,
    );
    const transition = delegationTransition(repositoryPath, current, persisted, interpretation);
    try {
      const committed = commitTransition(repositoryPath, transition);
      return Object.freeze({
        status: committed.status,
        state: interpretation.disposition === "APPLIED" ? "LANDED" : "INVALIDATED_REPLAN",
        laneKey: persisted.laneKey,
        outcomeDigest: persisted.outcomeDigest,
        resultDigest: persisted.resultDigest,
        learningDigest: persisted.learningDigest,
        transitionDigest: transition.transitionDigest,
        headDigest: committed.head.headDigest,
        productCommit: committed.head.productCommit,
        acceptance: persisted.acceptance,
        disposition: interpretation.disposition,
        attempts: attempt,
      });
    } catch (error) {
      if (error?.code === "MH_DELEGATION_R3_REPLAY") {
        const latest = readCurrentWorldState(repositoryPath, { now: now() });
        const replayed = findDelegationLanding(repositoryPath, latest, persisted.resultDigest);
        if (replayed) return landedResult(repositoryPath, replayed, { attempts: attempt });
      }
      if (error?.code !== "MH_WORLD_CONFLICT" || attempt === maxAttempts) throw error;
    }
  }
  fail("MH_WORLD_CONFLICT", "delegation learning exhausted bounded current-World CAS retries");
}

function landDelegationLaneResult({
  repositoryPath,
  contract,
  snapshot,
  laneKey,
  interpret = runRepositoryClosureInterpreter,
  now = () => new Date(),
  maxAttempts = MAX_DELEGATION_LANDING_ATTEMPTS,
}) {
  const sealed = validateDelegationRound2Contract(contract);
  const acceptance = acceptDelegationRound2FanIn({ contract: sealed, snapshot });
  const learning = delegationLearningFromAcceptance({ contract: sealed, acceptance, laneKey });
  return landDelegationLearning({ repositoryPath, learning, interpret, now, maxAttempts });
}

module.exports = {
  MAX_DELEGATION_LANDING_ATTEMPTS,
  REPO_DELEGATION_LANDING_INPUT_SCHEMA,
  findDelegationLanding,
  landDelegationLaneResult,
  landDelegationLearning,
};
