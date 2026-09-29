"use strict";

const fs = require("node:fs");
const path = require("node:path");

const { domainDigest, isDigest } = require("./contracts/digest");
const { ConfigError } = require("./errors");
const {
  initializeIntegrationHead,
  readIntegrationHead,
} = require("./optimistic-integration");
const {
  assertExecutionClosureReferences,
  closureWorkspaceId,
  findExecutionClosureForDecision,
  readExecutionWorkResult,
  validateExecutionClosure,
} = require("./execution-closure");
const {
  readOutcomeClaim,
  readOutcomeClaimRelease,
  releaseOutcomeClaimUnderAuthority,
} = require("./outcome-claim");
const {
  admissionForHead,
  commonGitDirectory,
  persistImmutableJson,
  readCurrentWorldPointer,
  readImmutableBytes,
  readImmutableJson,
  writePointerAtomic,
} = require("./world-authority");
const {
  appendRunEvent,
  readRunJournal,
  runIdForExecution,
  runIdForSession,
} = require("./run-journal");
const { runGit } = require("./work-git");
const {
  computeRepoWorldDigest,
  validateRepoWorld,
  validateWorldAttestation,
} = require("./world-attestation");
const {
  LEGACY_WORLD_HEAD_SCHEMA,
  LEGACY_WORLD_TRANSITION_SCHEMA,
  WORLD_HEAD_DOMAIN,
  WORLD_HEAD_SCHEMA,
  WORLD_PROJECTION_DOMAIN,
  WORLD_TRANSITION_DOMAIN,
  WORLD_TRANSITION_SCHEMA,
  computeWorldHeadDigest,
  computeWorldProjectionDigest,
  computeWorldTransitionDigest,
  validateWorldHead,
  validateWorldTransition,
} = require("./world-contract");

const REPO_INTERPRETATION_DOMAIN = "meta-harness-repo-interpretation/v1";
const REPO_WORLD_RELATIVE_PATH = path.join(".meta-harness", "repo-world.json");
const WORLD_ATTESTATION_RELATIVE_PATH = path.join(".meta-harness", "world-attestation.json");
const WORLD_TRANSITION_RELATIVE_PATH = path.join(".meta-harness", "world-transition.json");
const REPO_INTERPRETATION_RELATIVE_PATH = path.join(".meta-harness", "repo-interpretation.json");
const MAX_PROTOCOL_BYTES = 512 * 1024;

function fail(code, message, details) {
  throw new ConfigError(message, { code, details });
}

function readCurrentWorldHead(repositoryPath, { optional = false } = {}) {
  const pointer = readCurrentWorldPointer(repositoryPath, { optional });
  if (!pointer) return null;
  const head = validateWorldHead(readImmutableJson(repositoryPath, "heads", pointer.headDigest));
  if (head.headDigest !== pointer.headDigest) {
    fail("MH_WORLD_POINTER", "current-world pointer does not resolve to its declared immutable WorldHead");
  }
  return { pointer, head };
}

function readCurrentWorldState(repositoryPath, { now = new Date(), optional = false } = {}) {
  const current = readCurrentWorldHead(repositoryPath, { optional });
  if (!current) return null;
  if (current.head.schemaVersion === WORLD_HEAD_SCHEMA) {
    require("./work-base").assertBaseCommitAvailable(repositoryPath, current.head.productCommit);
  }
  const world = validateRepoWorld(readImmutableJson(repositoryPath, "worlds", current.head.worldDigest));
  if (computeRepoWorldDigest(world) !== current.head.worldDigest) {
    fail("MH_WORLD_HEAD_DIGEST", "current WorldHead worldDigest does not match immutable World bytes");
  }
  const attestation = validateWorldAttestation(
    readImmutableJson(repositoryPath, "attestations", current.head.attestationDigest),
    { repositoryPath, worldDigest: current.head.worldDigest, now },
  );
  if (attestation.attestationDigest !== current.head.attestationDigest) {
    fail("MH_WORLD_HEAD_DIGEST", "current WorldHead attestationDigest does not match immutable Attestation bytes");
  }
  return { ...current, world, attestation };
}

function successorHeadFor(repositoryPath, transition) {
  const predecessor = transition.predecessorHeadDigest === null
    ? null
    : validateWorldHead(readImmutableJson(repositoryPath, "heads", transition.predecessorHeadDigest));
  if (predecessor && predecessor.headDigest !== transition.predecessorHeadDigest) {
    fail("MH_WORLD_TRANSITION_PREDECESSOR", "immutable predecessor WorldHead path identity does not match its body");
  }
  const legacyTransition = transition.schemaVersion === LEGACY_WORLD_TRANSITION_SCHEMA;
  if (legacyTransition && predecessor?.schemaVersion === WORLD_HEAD_SCHEMA) {
    fail("MH_WORLD_TRANSITION_SCHEMA", "legacy world-transition/v1 cannot advance an active world-head/v2");
  }
  if (!legacyTransition && predecessor?.schemaVersion === LEGACY_WORLD_HEAD_SCHEMA
      && transition.cause.type !== "PRODUCT_HEAD_MIGRATION") {
    fail("MH_WORLD_TRANSITION_PRODUCT", "world-head/v1 may advance to v2 only through PRODUCT_HEAD_MIGRATION");
  }
  if (!legacyTransition && predecessor === null && transition.cause.type === "PRODUCT_HEAD_MIGRATION") {
    fail("MH_WORLD_TRANSITION_PRODUCT", "PRODUCT_HEAD_MIGRATION requires a legacy predecessor Head");
  }
  const body = legacyTransition ? {
    schemaVersion: LEGACY_WORLD_HEAD_SCHEMA,
    generation: predecessor ? predecessor.generation + 1 : 1,
    worldDigest: transition.successorWorldDigest,
    attestationDigest: transition.successorAttestationDigest,
    lastTransitionDigest: transition.transitionDigest,
  } : {
    schemaVersion: WORLD_HEAD_SCHEMA,
    generation: predecessor ? predecessor.generation + 1 : 1,
    worldDigest: transition.successorWorldDigest,
    attestationDigest: transition.successorAttestationDigest,
    productCommit: transition.successorProductCommit,
    lastTransitionDigest: transition.transitionDigest,
  };
  return validateWorldHead({ ...body, headDigest: computeWorldHeadDigest(body) });
}

function assertClosureDispositionForTransition(transition, closure) {
  if (transition.cause.type === "ATTEMPT_LEARNING" && closure.workResultDigest === null) {
    fail("MH_WORLD_TRANSITION_CLOSURE", "ATTEMPT_LEARNING requires a durable operational work result");
  }
  if (transition.cause.type === "ATTEMPT_ABORTED" && closure.workResultDigest !== null) {
    fail("MH_WORLD_TRANSITION_CLOSURE", "ATTEMPT_ABORTED is permitted only when no durable operational work result exists");
  }
}

function outcomeClosureForTransition(repositoryPath, transition) {
  const closure = validateExecutionClosure(
    readImmutableJson(repositoryPath, "execution-closures", transition.cause.executionClosureDigest),
  );
  if (closure.closureDigest !== transition.cause.executionClosureDigest
      || !["REPO_RUN", "REPO_OUTCOME"].includes(closure.origin.type)) {
    fail("MH_WORLD_TRANSITION_CLOSURE", "ATTEMPT_* without legacy Decision admission must reference a repository Outcome execution closure");
  }
  assertExecutionClosureReferences(repositoryPath, closure);
  if (closure.origin.type === "REPO_OUTCOME") {
    const claim = readOutcomeClaim(repositoryPath, closure.origin.claimDigest);
    if (claim.outcomeDigest !== closure.origin.outcomeDigest) {
      fail("MH_WORLD_TRANSITION_CLOSURE", "legacy Outcome claim does not own the referenced execution Outcome");
    }
    if (readOutcomeClaimRelease(repositoryPath, claim.claimDigest, { optional: true })) {
      fail("MH_OUTCOME_CLAIM_RELEASED", "legacy Outcome claim was already resolved by a committed semantic-projection transition");
    }
  }
  return closure;
}

function assertRunClosureNotAlreadyApplied(repositoryPath, transition, closure) {
  if (closure.origin.type !== "REPO_RUN") return;
  let headDigest = transition.predecessorHeadDigest;
  while (headDigest !== null) {
    const head = validateWorldHead(readImmutableJson(repositoryPath, "heads", headDigest));
    const prior = validateWorldTransition(readImmutableJson(repositoryPath, "transitions", head.lastTransitionDigest));
    if (["ATTEMPT_LEARNING", "ATTEMPT_ABORTED"].includes(prior.cause.type)) {
      const priorClosure = validateExecutionClosure(
        readImmutableJson(repositoryPath, "execution-closures", prior.cause.executionClosureDigest),
      );
      if (priorClosure.closureDigest === closure.closureDigest
          || (priorClosure.origin.type === "REPO_RUN" && priorClosure.sessionDigest === closure.sessionDigest)) {
        fail("MH_RUN_CLOSURE_ALREADY_APPLIED", "the logical repository run is already present in committed semantic history", {
          sessionDigest: closure.sessionDigest,
          closureDigest: closure.closureDigest,
          priorClosureDigest: priorClosure.closureDigest,
          transitionDigest: prior.transitionDigest,
        });
      }
    }
    headDigest = prior.predecessorHeadDigest;
  }
}

function assertDelegationLearningTransition(repositoryPath, transition) {
  const { readDelegationLearning } = require("./delegation-round3-learning");
  const learning = readDelegationLearning(repositoryPath, transition.cause.delegationLearningDigest);
  if (learning.learningDigest !== transition.cause.delegationLearningDigest) {
    fail("MH_DELEGATION_R3_TRANSITION", "DELEGATION_LEARNING does not bind its immutable compact lane learning");
  }

  let headDigest = transition.predecessorHeadDigest;
  while (headDigest !== null) {
    const head = validateWorldHead(readImmutableJson(repositoryPath, "heads", headDigest));
    if (head.headDigest !== headDigest) {
      fail("MH_DELEGATION_R3_TRANSITION", "delegation-learning predecessor lineage contains a mismatched WorldHead identity");
    }
    const prior = validateWorldTransition(readImmutableJson(repositoryPath, "transitions", head.lastTransitionDigest));
    if (prior.transitionDigest !== head.lastTransitionDigest) {
      fail("MH_DELEGATION_R3_TRANSITION", "delegation-learning predecessor lineage contains a mismatched WorldTransition identity");
    }
    if (prior.cause.type === "DELEGATION_LEARNING") {
      const priorLearning = readDelegationLearning(repositoryPath, prior.cause.delegationLearningDigest);
      if (priorLearning.resultDigest === learning.resultDigest) {
        fail("MH_DELEGATION_R3_REPLAY", "the compact lane result was already accepted into committed semantic-projection lineage", {
          resultDigest: learning.resultDigest,
          transitionDigest: prior.transitionDigest,
        });
      }
    }
    headDigest = prior.predecessorHeadDigest;
  }
}

function assertMigrationProductChain(repositoryPath, transition) {
  const { readProductIntegration } = require("./repo-product-integration");
  let productCommit = transition.cause.seedProductCommit;
  for (const integrationDigest of transition.cause.integrationDigests) {
    const receipt = readProductIntegration(repositoryPath, integrationDigest);
    if (receipt.predecessorProductCommit !== productCommit) {
      fail("MH_WORLD_TRANSITION_PRODUCT", "migration integration chain does not continue from the declared seed product commit");
    }
    productCommit = receipt.integratedCommit;
  }
  if (productCommit !== transition.successorProductCommit) {
    fail("MH_WORLD_TRANSITION_PRODUCT", "migration integration chain does not determine successorProductCommit");
  }
}

function assertV2ProductTransition(repositoryPath, transition) {
  if (transition.schemaVersion === LEGACY_WORLD_TRANSITION_SCHEMA) return;
  const predecessor = transition.predecessorHeadDigest === null
    ? null
    : validateWorldHead(readImmutableJson(repositoryPath, "heads", transition.predecessorHeadDigest));
  if (predecessor === null) {
    if (transition.cause.type !== "REALITY_REFRESH") {
      fail("MH_WORLD_TRANSITION_PRODUCT", "initial world-transition/v2 must be REALITY_REFRESH");
    }
    return;
  }
  if (predecessor.schemaVersion === LEGACY_WORLD_HEAD_SCHEMA) {
    if (transition.cause.type !== "PRODUCT_HEAD_MIGRATION") {
      fail("MH_WORLD_TRANSITION_PRODUCT", "legacy Head migration requires PRODUCT_HEAD_MIGRATION");
    }
    assertMigrationProductChain(repositoryPath, transition);
    return;
  }
  if (transition.cause.type === "PRODUCT_HEAD_MIGRATION") {
    fail("MH_WORLD_TRANSITION_PRODUCT", "PRODUCT_HEAD_MIGRATION cannot advance world-head/v2");
  }
  if (transition.cause.type !== "ATTEMPT_LEARNING") {
    if (transition.successorProductCommit !== predecessor.productCommit) {
      fail("MH_WORLD_TRANSITION_PRODUCT", "no-code World transition must preserve predecessor productCommit");
    }
    return;
  }

  const closure = validateExecutionClosure(
    readImmutableJson(repositoryPath, "execution-closures", transition.cause.executionClosureDigest),
  );
  const workResult = closure.workResultDigest === null
    ? null
    : readExecutionWorkResult(repositoryPath, closure.workResultDigest);
  const integrationDigest = transition.cause.integrationDigest;
  if (!isDigest(integrationDigest)) {
    if (transition.successorProductCommit !== predecessor.productCommit) {
      fail("MH_WORLD_TRANSITION_PRODUCT", "semantic learning without landed integration evidence may not advance product code");
    }
    return;
  }
  if (workResult?.result?.outcome !== "DONE") {
    fail("MH_WORLD_TRANSITION_PRODUCT", "landed product integration evidence requires a DONE durable work result");
  }
  const { readProductIntegration } = require("./repo-product-integration");
  const receipt = readProductIntegration(repositoryPath, integrationDigest);
  if (receipt.closureDigest !== closure.closureDigest
      || receipt.workResultDigest !== closure.workResultDigest) {
    fail("MH_WORLD_TRANSITION_PRODUCT", "product integration receipt does not bind the transition execution fact");
  }
  const directProjection = predecessor.productCommit === receipt.predecessorProductCommit
    && transition.successorProductCommit === receipt.integratedCommit;
  const lateProjection = transition.successorProductCommit === predecessor.productCommit
    && isCommitAncestor(repositoryPath, receipt.integratedCommit, predecessor.productCommit);
  if (!directProjection && !lateProjection) {
    fail("MH_WORLD_TRANSITION_PRODUCT", "semantic projection must describe an already-landed product integration without republishing it", {
      predecessorProductCommit: predecessor.productCommit,
      successorProductCommit: transition.successorProductCommit,
      integrationPredecessor: receipt.predecessorProductCommit,
      integratedCommit: receipt.integratedCommit,
    });
  }
}

function assertAttemptTransition(repositoryPath, transition, admission) {
  if (transition.cause.type === "PRODUCT_HEAD_MIGRATION") return;
  if (!admission) {
    if (transition.cause.type === "REALITY_REFRESH") return;
    if (transition.cause.type === "DELEGATION_LEARNING") {
      assertDelegationLearningTransition(repositoryPath, transition);
      return;
    }
    const closure = outcomeClosureForTransition(repositoryPath, transition);
    assertRunClosureNotAlreadyApplied(repositoryPath, transition, closure);
    assertClosureDispositionForTransition(transition, closure);
    return;
  }
  if (["REALITY_REFRESH", "DELEGATION_LEARNING"].includes(transition.cause.type)) {
    fail("MH_WORLD_HEAD_FROZEN", "WorldHead cannot accept external truth while a legacy Repo Decision admission remains unbanked", {
      decisionDigest: admission.decisionDigest,
    });
  }
  const decision = admission.decision || readImmutableJson(repositoryPath, "decisions", admission.decisionDigest);
  if (decision.worldHeadDigest !== transition.predecessorHeadDigest) {
    fail("MH_WORLD_TRANSITION_PREDECESSOR", "admitted Decision does not bind the transition predecessor WorldHead");
  }
  const closure = findExecutionClosureForDecision(repositoryPath, admission.decisionDigest);
  if (!closure || closure.closureDigest !== transition.cause.executionClosureDigest) {
    fail("MH_WORLD_TRANSITION_CLOSURE", "ATTEMPT_* transition must reference the unique aggregate ExecutionClosure for the admitted Decision");
  }
  assertClosureDispositionForTransition(transition, closure);
}

function validateSuccessorWorldObject(repositoryPath, transition) {
  const world = validateRepoWorld(readImmutableJson(repositoryPath, "worlds", transition.successorWorldDigest));
  if (computeRepoWorldDigest(world) !== transition.successorWorldDigest) {
    fail("MH_WORLD_TRANSITION_WORLD", "successor World digest does not match immutable World bytes");
  }
  return world;
}

function validateSuccessorAttestationObject(repositoryPath, transition) {
  const attestation = validateWorldAttestation(
    readImmutableJson(repositoryPath, "attestations", transition.successorAttestationDigest),
    { repositoryPath, worldDigest: transition.successorWorldDigest },
  );
  if (attestation.attestationDigest !== transition.successorAttestationDigest) {
    fail("MH_WORLD_TRANSITION_ATTESTATION", "successor Attestation digest does not match immutable Attestation bytes");
  }
  return attestation;
}

function validateInterpretationObject(repositoryPath, transition) {
  if (!["ATTEMPT_LEARNING", "DELEGATION_LEARNING"].includes(transition.cause.type)) return;
  const bytes = readImmutableBytes(repositoryPath, "interpretations", transition.cause.interpretationDigest);
  if (computeInterpretationDigest(bytes) !== transition.cause.interpretationDigest) {
    fail("MH_WORLD_TRANSITION_INTERPRETATION", "interpretation digest does not match immutable repo interpretation bytes");
  }
}

function releaseOutcomeClaimForTransition(repositoryPath, transition) {
  if (!new Set(["ATTEMPT_LEARNING", "ATTEMPT_ABORTED"]).has(transition.cause.type)) return null;
  const closure = validateExecutionClosure(
    readImmutableJson(repositoryPath, "execution-closures", transition.cause.executionClosureDigest),
  );
  if (closure.closureDigest !== transition.cause.executionClosureDigest || closure.origin.type !== "REPO_OUTCOME") {
    return null;
  }
  return releaseOutcomeClaimUnderAuthority(repositoryPath, closure.origin.claimDigest);
}

function isCommitAncestor(repositoryPath, ancestor, descendant) {
  if (ancestor === descendant) return true;
  const result = runGit(repositoryPath, ["merge-base", "--is-ancestor", ancestor, descendant], { allowFailure: true });
  return result.status === 0;
}

function assertProductPublicationVisible(repositoryPath, transition, successorHead) {
  if (transition.schemaVersion === LEGACY_WORLD_TRANSITION_SCHEMA) return null;
  let observed = readIntegrationHead(repositoryPath, { optional: true });
  if (transition.predecessorHeadDigest === null && observed === null) {
    const initialized = initializeIntegrationHead({
      repositoryPath,
      baseCommit: successorHead.productCommit,
    });
    if (initialized.state === "CONFLICT") {
      fail("MH_PRODUCT_HEAD_CONFLICT", "initial semantic projection does not match the Git product head", {
        requested: successorHead.productCommit,
        observed: initialized.observedHead,
      });
    }
    observed = initialized.observedHead;
  }
  if (!observed) {
    fail("MH_PRODUCT_HEAD_REQUIRED", "semantic projection requires an initialized Git product head");
  }
  if (!isCommitAncestor(repositoryPath, successorHead.productCommit, observed)) {
    fail("MH_PRODUCT_HEAD_CONFLICT", "semantic projection references product bytes that have not landed in the Git product ref", {
      projectedProductCommit: successorHead.productCommit,
      observedProductCommit: observed,
    });
  }
  return observed;
}

function recordIntegrationResult(repositoryPath, transition, successorHead, status) {
  if (!["ATTEMPT_LEARNING", "ATTEMPT_ABORTED"].includes(transition.cause.type)) return null;
  const closure = validateExecutionClosure(
    readImmutableJson(repositoryPath, "execution-closures", transition.cause.executionClosureDigest),
  );
  const workspaceId = closureWorkspaceId(repositoryPath, closure);
  const runId = closure.origin.type === "REPO_RUN" && workspaceId
    ? runIdForExecution(closure.sessionDigest, workspaceId)
    : runIdForSession(closure.sessionDigest);
  const gitCommonDirectory = commonGitDirectory(repositoryPath);
  const existing = readRunJournal({ gitCommonDirectory, runId }).find((event) =>
    event.type === "integration/result"
      && event.data?.transitionDigest === transition.transitionDigest
      && event.data?.productCommit === successorHead.productCommit,
  );
  if (existing) return existing;
  return appendRunEvent({
    gitCommonDirectory,
    runId,
    type: "integration/result",
    data: {
      sessionDigest: closure.sessionDigest,
      transitionDigest: transition.transitionDigest,
      integrationDigest: transition.cause.integrationDigest || null,
      productCommit: successorHead.productCommit,
      headDigest: successorHead.headDigest,
      status,
    },
  });
}

function commitTransition(repositoryPath, transitionInput) {
  const transition = validateWorldTransition(transitionInput);
  validateSuccessorWorldObject(repositoryPath, transition);
  validateSuccessorAttestationObject(repositoryPath, transition);
  validateInterpretationObject(repositoryPath, transition);
  assertV2ProductTransition(repositoryPath, transition);
  const current = readCurrentWorldPointer(repositoryPath, { optional: true });
  const successorHead = successorHeadFor(repositoryPath, transition);
  assertProductPublicationVisible(repositoryPath, transition, successorHead);
  if (current?.headDigest === successorHead.headDigest) {
    recordIntegrationResult(repositoryPath, transition, successorHead, "ALREADY_APPLIED");
    releaseOutcomeClaimForTransition(repositoryPath, transition);
    return { status: "ALREADY_APPLIED", transition, head: successorHead };
  }
  const currentDigest = current?.headDigest || null;
  if (currentDigest !== transition.predecessorHeadDigest) {
    fail("MH_WORLD_CONFLICT", "WorldTransition predecessor does not match the current semantic-projection Head", {
      expected: transition.predecessorHeadDigest,
      actual: currentDigest,
    });
  }
  const admission = currentDigest ? admissionForHead(repositoryPath, currentDigest) : null;
  assertAttemptTransition(repositoryPath, transition, admission);
  persistImmutableJson(repositoryPath, "transitions", transition.transitionDigest, transition, "MH_WORLD_TRANSITION_WRITE");
  persistImmutableJson(repositoryPath, "heads", successorHead.headDigest, successorHead, "MH_WORLD_HEAD_WRITE");
  writePointerAtomic(repositoryPath, transition.predecessorHeadDigest, successorHead.headDigest);
  recordIntegrationResult(repositoryPath, transition, successorHead, "APPLIED");
  releaseOutcomeClaimForTransition(repositoryPath, transition);
  return { status: "APPLIED", transition, head: successorHead };
}

function readProtocolBytes(repositoryPath, relativePath, { optional = false } = {}) {
  const filePath = path.resolve(repositoryPath, relativePath);
  let stat;
  try {
    stat = fs.lstatSync(filePath);
  } catch (error) {
    if (optional && error?.code === "ENOENT") return null;
    fail("MH_WORLD_PROTOCOL_READ", `${relativePath} is missing or unreadable: ${error.message}`);
  }
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_PROTOCOL_BYTES) {
    fail("MH_WORLD_PROTOCOL_READ", `${relativePath} must be a regular non-symlink file no larger than ${MAX_PROTOCOL_BYTES} bytes`);
  }
  return fs.readFileSync(filePath);
}

function readProtocolJson(repositoryPath, relativePath, options) {
  const bytes = readProtocolBytes(repositoryPath, relativePath, options);
  if (bytes === null) return null;
  try {
    return { bytes, value: JSON.parse(bytes.toString("utf8")) };
  } catch (error) {
    fail("MH_WORLD_PROTOCOL_JSON", `${relativePath} is invalid JSON: ${error.message}`);
  }
}

function computeInterpretationDigest(bytes) {
  const content = Buffer.isBuffer(bytes) ? bytes.toString("utf8") : String(bytes);
  return domainDigest(REPO_INTERPRETATION_DOMAIN, { content });
}

module.exports = {
  LEGACY_WORLD_HEAD_SCHEMA,
  LEGACY_WORLD_TRANSITION_SCHEMA,
  REPO_INTERPRETATION_DOMAIN,
  REPO_INTERPRETATION_RELATIVE_PATH,
  REPO_WORLD_RELATIVE_PATH,
  WORLD_ATTESTATION_RELATIVE_PATH,
  WORLD_HEAD_DOMAIN,
  WORLD_HEAD_SCHEMA,
  WORLD_PROJECTION_DOMAIN,
  WORLD_TRANSITION_DOMAIN,
  WORLD_TRANSITION_RELATIVE_PATH,
  WORLD_TRANSITION_SCHEMA,
  commitTransition,
  computeInterpretationDigest,
  computeWorldHeadDigest,
  computeWorldProjectionDigest,
  computeWorldTransitionDigest,
  readCurrentWorldHead,
  readCurrentWorldState,
  readProtocolBytes,
  readProtocolJson,
  validateWorldHead,
  validateWorldTransition,
};
