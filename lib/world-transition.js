"use strict";

const fs = require("node:fs");
const path = require("node:path");

const { domainDigest, isDigest } = require("./contracts/digest");
const { ConfigError } = require("./errors");
const {
  findExecutionClosureForDecision,
  findExecutionClosureForOrigin,
  findExecutionWorkResultForOrigin,
  validateExecutionClosure,
} = require("./execution-closure");
const {
  readOutcomeClaim,
  readOutcomeClaimRelease,
  releaseOutcomeClaimUnderAuthority,
} = require("./outcome-claim");
const {
  admissionForHead,
  persistImmutableJson,
  readCurrentWorldPointer,
  readImmutableBytes,
  readImmutableJson,
  withWorldAuthorityLock,
  writePointerAtomic,
} = require("./world-authority");
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
  if (closure.closureDigest !== transition.cause.executionClosureDigest || closure.origin.type !== "REPO_OUTCOME") {
    fail("MH_WORLD_TRANSITION_CLOSURE", "ATTEMPT_* without legacy Decision admission must reference an Outcome ExecutionClosure");
  }
  const canonical = findExecutionClosureForOrigin(repositoryPath, closure.origin);
  if (!canonical || canonical.closureDigest !== closure.closureDigest) {
    fail("MH_WORLD_TRANSITION_CLOSURE", "ATTEMPT_* must reference the unique aggregate ExecutionClosure for the claimed Outcome");
  }
  const claim = readOutcomeClaim(repositoryPath, closure.origin.claimDigest);
  if (claim.outcomeDigest !== closure.origin.outcomeDigest) {
    fail("MH_WORLD_TRANSITION_CLOSURE", "Outcome claim does not own the referenced ExecutionClosure Outcome");
  }
  if (readOutcomeClaimRelease(repositoryPath, claim.claimDigest, { optional: true })) {
    fail("MH_OUTCOME_CLAIM_RELEASED", "Outcome claim was already resolved by an authoritative World transition");
  }
  return canonical;
}

function interpretationDisposition(repositoryPath, transition) {
  try {
    return JSON.parse(
      readImmutableBytes(repositoryPath, "interpretations", transition.cause.interpretationDigest).toString("utf8"),
    )?.disposition || null;
  } catch (error) {
    fail("MH_WORLD_TRANSITION_INTERPRETATION", `learning interpretation disposition is unreadable: ${error.message}`);
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
    : findExecutionWorkResultForOrigin(repositoryPath, closure.origin);
  const codeAccepted = workResult?.result?.outcome === "DONE"
    && interpretationDisposition(repositoryPath, transition) === "APPLIED";
  if (!codeAccepted) {
    if (transition.cause.integrationDigest !== null
        || transition.successorProductCommit !== predecessor.productCommit) {
      fail("MH_WORLD_TRANSITION_PRODUCT", "non-DONE or non-APPLIED learning may not advance canonical product code");
    }
    return;
  }
  if (!isDigest(transition.cause.integrationDigest)) {
    fail("MH_WORLD_TRANSITION_PRODUCT", "DONE learning requires exact product integration evidence");
  }
  const { readProductIntegration } = require("./repo-product-integration");
  const receipt = readProductIntegration(repositoryPath, transition.cause.integrationDigest);
  if (receipt.predecessorProductCommit !== predecessor.productCommit
      || receipt.integratedCommit !== transition.successorProductCommit
      || receipt.closureDigest !== closure.closureDigest
      || receipt.workResultDigest !== closure.workResultDigest) {
    fail("MH_WORLD_TRANSITION_PRODUCT", "product integration receipt does not bind the transition product advance");
  }
}

function assertAttemptTransition(repositoryPath, transition, admission) {
  if (transition.cause.type === "PRODUCT_HEAD_MIGRATION") return;
  if (!admission) {
    if (transition.cause.type === "REALITY_REFRESH") return;
    const closure = outcomeClosureForTransition(repositoryPath, transition);
    assertClosureDispositionForTransition(transition, closure);
    return;
  }
  if (transition.cause.type === "REALITY_REFRESH") {
    fail("MH_WORLD_HEAD_FROZEN", "WorldHead cannot reality-refresh while a legacy Repo Decision admission remains unbanked", {
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
  if (transition.cause.type !== "ATTEMPT_LEARNING") return;
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

function commitTransition(repositoryPath, transitionInput) {
  const transition = validateWorldTransition(transitionInput);
  validateSuccessorWorldObject(repositoryPath, transition);
  validateSuccessorAttestationObject(repositoryPath, transition);
  validateInterpretationObject(repositoryPath, transition);
  assertV2ProductTransition(repositoryPath, transition);
  return withWorldAuthorityLock(repositoryPath, () => {
    const current = readCurrentWorldPointer(repositoryPath, { optional: true });
    const successorHead = successorHeadFor(repositoryPath, transition);
    if (current?.headDigest === successorHead.headDigest) {
      releaseOutcomeClaimForTransition(repositoryPath, transition);
      return { status: "ALREADY_APPLIED", transition, head: successorHead };
    }
    const currentDigest = current?.headDigest || null;
    if (currentDigest !== transition.predecessorHeadDigest) {
      fail("MH_WORLD_CONFLICT", "WorldTransition predecessor does not match authoritative current WorldHead", {
        expected: transition.predecessorHeadDigest,
        actual: currentDigest,
      });
    }
    const admission = currentDigest ? admissionForHead(repositoryPath, currentDigest) : null;
    assertAttemptTransition(repositoryPath, transition, admission);
    persistImmutableJson(repositoryPath, "transitions", transition.transitionDigest, transition, "MH_WORLD_TRANSITION_WRITE");
    persistImmutableJson(repositoryPath, "heads", successorHead.headDigest, successorHead, "MH_WORLD_HEAD_WRITE");
    writePointerAtomic(repositoryPath, transition.predecessorHeadDigest, successorHead.headDigest);
    releaseOutcomeClaimForTransition(repositoryPath, transition);
    return { status: "APPLIED", transition, head: successorHead };
  });
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
