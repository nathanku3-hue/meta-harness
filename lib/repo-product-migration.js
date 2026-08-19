"use strict";

const fs = require("node:fs");
const path = require("node:path");

const { ConfigError } = require("./errors");
const { findExecutionWorkResultForOrigin, validateExecutionClosure } = require("./execution-closure");
const { listActiveOutcomeClaims, readOutcomeClaim, readOutcomeClaimSession } = require("./outcome-claim");
const {
  discardProductIntegration,
  prepareProductIntegration,
  repairProductHeadRef,
} = require("./repo-product-integration");
const { OID_RE, requireOid } = require("./repo-product-integration-record");
const { repositoryRoot, runGit } = require("./work-git");
const { readImmutableJson } = require("./world-authority");

function fail(code, message, details) {
  throw new ConfigError(message, { code, details });
}

function legacyTransitionLineage(repositoryPath, currentHead) {
  const reversed = [];
  let cursor = currentHead;
  const seen = new Set();
  while (cursor) {
    if (seen.has(cursor.headDigest)) fail("MH_PRODUCT_MIGRATION_LINEAGE", "legacy WorldHead lineage contains a cycle");
    seen.add(cursor.headDigest);
    const transition = readImmutableJson(repositoryPath, "transitions", cursor.lastTransitionDigest);
    reversed.push({ head: cursor, transition });
    if (!transition.predecessorHeadDigest) break;
    cursor = readImmutableJson(repositoryPath, "heads", transition.predecessorHeadDigest);
  }
  return reversed.reverse();
}

function exactWorkResult(repositoryPath, closure) {
  const result = findExecutionWorkResultForOrigin(repositoryPath, closure.origin);
  if (!result || result.workResultDigest !== closure.workResultDigest) {
    fail("MH_PRODUCT_MIGRATION_EVIDENCE", "legacy accepted Outcome learning has no exact durable work result");
  }
  return result;
}

function legacyAcceptedCodeLearnings(repositoryPath, currentHead) {
  const learnings = [];
  for (const { transition } of legacyTransitionLineage(repositoryPath, currentHead)) {
    if (transition.cause?.type !== "ATTEMPT_LEARNING") continue;
    const closure = validateExecutionClosure(
      readImmutableJson(repositoryPath, "execution-closures", transition.cause.executionClosureDigest),
    );
    if (closure.origin.type !== "REPO_OUTCOME" || closure.workResultDigest === null) continue;
    const workResult = exactWorkResult(repositoryPath, closure);
    if (workResult.result?.outcome !== "DONE") continue;
    const claim = readOutcomeClaim(repositoryPath, closure.origin.claimDigest);
    const session = readOutcomeClaimSession(repositoryPath, claim.claimDigest, { optional: true });
    if (!session) {
      fail("MH_PRODUCT_MIGRATION_EVIDENCE", "accepted legacy Outcome learning has no durable Claim→session evidence");
    }
    learnings.push({ transition, closure, workResult, claim, session });
  }
  return learnings;
}

function legacyProposalBases(repositoryPath) {
  const filePath = path.join(repositoryRoot(repositoryPath), ".meta-harness", "repo-proposals.json");
  let value;
  try {
    value = JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    fail("MH_PRODUCT_MIGRATION_EVIDENCE", `legacy repo proposal file is unreadable: ${error.message}`);
  }
  if (value?.schemaVersion !== "repo-proposal-set/v1" || !Array.isArray(value.proposals)) return [];
  return value.proposals.map((proposal) => proposal?.base?.commit).filter((commit) => OID_RE.test(String(commit || "")));
}

function migrationSeed(repositoryPath, learnings) {
  if (learnings.length > 0) return learnings[0].session.base.commit;
  const activeBases = listActiveOutcomeClaims(repositoryPath)
    .map((claim) => readOutcomeClaimSession(repositoryPath, claim.claimDigest, { optional: true })?.base?.commit)
    .filter(Boolean);
  const proposalBases = legacyProposalBases(repositoryPath);
  const unique = [...new Set(activeBases.length > 0 ? activeBases : proposalBases)];
  if (unique.length === 0) {
    return requireOid(String(runGit(repositoryPath, ["rev-parse", "--verify", "HEAD^{commit}"]).stdout || "").trim(), "legacy no-code migration HEAD");
  }
  if (unique.length !== 1) {
    fail("MH_PRODUCT_MIGRATION_EVIDENCE", "legacy product head seed is ambiguous; exact durable base evidence must agree", {
      activeBases, proposalBases,
    });
  }
  runGit(repositoryPath, ["cat-file", "-e", `${unique[0]}^{commit}`]);
  return unique[0];
}

function migrationTransition(worldTransition, current, seedProductCommit, integrationDigests, productCommit) {
  const body = {
    schemaVersion: worldTransition.WORLD_TRANSITION_SCHEMA,
    predecessorHeadDigest: current.head.headDigest,
    cause: { type: "PRODUCT_HEAD_MIGRATION", seedProductCommit, integrationDigests },
    successorWorldDigest: current.head.worldDigest,
    successorAttestationDigest: current.head.attestationDigest,
    successorProductCommit: productCommit,
  };
  return worldTransition.validateWorldTransition({
    ...body,
    transitionDigest: worldTransition.computeWorldTransitionDigest(body),
  });
}

function ensureLinearProductHead(repositoryPath, { now = () => new Date(), env = process.env } = {}) {
  const worldTransition = require("./world-transition");
  const current = worldTransition.readCurrentWorldState(repositoryPath, { now: now() });
  if (current.head.schemaVersion === "world-head/v2") {
    repairProductHeadRef(repositoryPath, current.head.productCommit);
    return current;
  }
  if (current.head.schemaVersion !== "world-head/v1") fail("MH_PRODUCT_MIGRATION_SCHEMA", "current WorldHead schema is not migratable");

  const learnings = legacyAcceptedCodeLearnings(repositoryPath, current.head);
  const seedProductCommit = migrationSeed(repositoryPath, learnings);
  let productCommit = seedProductCommit;
  let retainedObligations = [];
  const candidates = [];
  const integrationDigests = [];
  try {
    for (const learning of learnings) {
      const candidate = prepareProductIntegration({
        repositoryPath,
        predecessorProductCommit: productCommit,
        currentHead: current.head,
        claim: learning.claim,
        closure: learning.closure,
        workResult: learning.workResult,
        retainedObligations,
        now: now(),
        env,
      });
      if (candidate.status !== "ACCEPTED") {
        discardProductIntegration(candidate);
        fail("MH_PRODUCT_MIGRATION_PROOF", "legacy accepted Outcome cannot be reconstructed into cumulative product code", {
          reason: candidate.reason,
          detail: candidate.detail,
          closureDigest: learning.closure.closureDigest,
        });
      }
      candidates.push(candidate);
      integrationDigests.push(candidate.receipt.integrationDigest);
      retainedObligations = candidate.receipt.retainedObligations;
      productCommit = candidate.receipt.integratedCommit;
    }
    const transition = migrationTransition(worldTransition, current, seedProductCommit, integrationDigests, productCommit);
    const committed = worldTransition.commitTransition(repositoryPath, transition);
    repairProductHeadRef(repositoryPath, committed.head.productCommit);
    candidates.forEach(discardProductIntegration);
    return worldTransition.readCurrentWorldState(repositoryPath, { now: now() });
  } catch (error) {
    candidates.forEach(discardProductIntegration);
    throw error;
  }
}

module.exports = {
  ensureLinearProductHead,
  _test: { legacyAcceptedCodeLearnings, legacyTransitionLineage, migrationSeed },
};
