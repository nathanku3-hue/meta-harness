"use strict";

const fs = require("node:fs");
const path = require("node:path");

const { ConfigError } = require("../../lib/errors");
const { findExecutionClosureForDecision, recoverExecutionClosure } = require("../../lib/execution-closure");
const { isProtectedRepoDecisionPlanePath } = require("../../lib/repo-control-paths");
const { readOutcomeClaim, readOutcomeClaimRelease } = require("../../lib/outcome-claim");
const repoDecision = require("./legacy-repo-decision");
const { claimWorkSessionState, recoverBankedExecutionResult, runWorkSessionState } = require("../../lib/work-git");
const {
  admissionForHead,
  persistImmutableBytes,
  persistImmutableJson,
} = require("../../lib/world-authority");
const { readWorkspaceExecutionLease } = require("../helpers/legacy-workspace-lease");
const worldAttestation = require("../../lib/world-attestation");
const worldTransition = require("../../lib/world-transition");

function fail(code, message, details) {
  throw new ConfigError(message, { code, details });
}

function decisionPlaneEnabled(repositoryPath) {
  const charterPath = path.resolve(repositoryPath, repoDecision.REPO_CHARTER_RELATIVE_PATH);
  try {
    const stat = fs.lstatSync(charterPath);
    return stat.isFile() && !stat.isSymbolicLink();
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    fail("MH_REPO_CHARTER_READ", `repo charter is unreadable: ${error.message}`);
  }
}

function workspaceExecutionLeaseAppearsActive(repositoryPath, workspaceId) {
  const registryDir = path.join(path.resolve(repositoryPath, ".git"), "meta-harness", "workspaces");
  let lease;
  try {
    lease = readWorkspaceExecutionLease(registryDir, workspaceId);
  } catch (error) {
    if (/unreadable/u.test(String(error?.message || ""))) return false;
    throw error;
  }
  try {
    process.kill(lease.pid, 0);
    return true;
  } catch (error) {
    return error?.code !== "ESRCH";
  }
}

function transitionAlreadyApplied(repositoryPath, transition) {
  const current = worldTransition.readCurrentWorldHead(repositoryPath, { optional: true });
  if (!current || current.head.lastTransitionDigest !== transition.transitionDigest) return null;
  if (current.head.worldDigest !== transition.successorWorldDigest
      || current.head.attestationDigest !== transition.successorAttestationDigest) {
    fail("MH_WORLD_TRANSITION_CONFLICT", "current WorldHead names the transition digest with different successor objects");
  }
  return { status: "ALREADY_APPLIED", transition, head: current.head };
}

function admittedSession(admission) {
  return {
    sessionDigest: admission.entry.sessionDigest,
    origin: { type: "REPO_DECISION", decisionDigest: admission.decisionDigest },
  };
}

function recoverAdmissionClosure(repositoryPath, admission, now = new Date()) {
  const existing = findExecutionClosureForDecision(repositoryPath, admission.decisionDigest);
  if (existing) return existing;
  if (workspaceExecutionLeaseAppearsActive(repositoryPath, admission.entry.workspaceId, now)) {
    fail(
      "MH_WORKSPACE_BUSY",
      "the admitted Repo Decision still has a live controller execution lease; recovery cannot classify it as interrupted",
      { decisionDigest: admission.decisionDigest, workspaceId: admission.entry.workspaceId },
    );
  }
  const session = admittedSession(admission);
  const recoveredBankResult = recoverBankedExecutionResult({
    repositoryPath,
    sessionDigest: session.sessionDigest,
    workspaceId: admission.entry.workspaceId,
  });
  return recoverExecutionClosure(repositoryPath, session, now, { workResult: recoveredBankResult });
}

function bankAbortedAdmission(repositoryPath, head, admission, closure) {
  if (!closure || closure.workResultDigest !== null) return null;
  const body = {
    schemaVersion: worldTransition.LEGACY_WORLD_TRANSITION_SCHEMA,
    predecessorHeadDigest: head.headDigest,
    cause: { type: "ATTEMPT_ABORTED", executionClosureDigest: closure.closureDigest },
    successorWorldDigest: head.worldDigest,
    successorAttestationDigest: head.attestationDigest,
  };
  const transition = worldTransition.validateWorldTransition({
    ...body,
    transitionDigest: worldTransition.computeWorldTransitionDigest(body),
  });
  return worldTransition.commitTransition(repositoryPath, transition);
}

function prepareAuthoritativeWorld(repositoryPath, now = new Date()) {
  let current = worldTransition.readCurrentWorldHead(repositoryPath, { optional: true });
  if (!current) {
    fail("MH_WORLD_POINTER", "no current semantic-projection Head exists; repo intelligence must commit an initial REALITY_REFRESH transition first");
  }
  let admission = admissionForHead(repositoryPath, current.head.headDigest);
  if (admission) {
    const closure = recoverAdmissionClosure(repositoryPath, admission, now);
    if (!closure) fail("MH_EXECUTION_CLOSURE_MISSING", "admitted Repo Decision has no recoverable execution closure");
    if (closure.workResultDigest === null) {
      bankAbortedAdmission(repositoryPath, current.head, admission, closure);
      current = worldTransition.readCurrentWorldHead(repositoryPath);
      admission = admissionForHead(repositoryPath, current.head.headDigest);
    } else {
      fail(
        "MH_WORLD_HEAD_FROZEN",
        "the admitted Repo Decision has a durable operational result that must be banked by ATTEMPT_LEARNING before more dispatch",
        { decisionDigest: admission.decisionDigest, executionClosureDigest: closure.closureDigest },
      );
    }
  }
  if (admission) fail("MH_WORLD_HEAD_FROZEN", "current semantic-projection Head remains tied to a legacy admission after recovery");
  return worldTransition.readCurrentWorldState(repositoryPath, { now });
}

function compileRepoDecisionWork(repositoryPath, { now = new Date() } = {}) {
  const compiled = repoDecision.compileRepoDecision(repositoryPath, prepareAuthoritativeWorld(repositoryPath, now));
  if (compiled.type !== "DISPATCH") return compiled;
  const stored = compiled.session.origin.type === "REPO_RUN"
    ? runWorkSessionState(repositoryPath, compiled.session)
    : claimWorkSessionState(repositoryPath, compiled.claimDigest);
  if (stored.state === "NONE" || stored.state === "PENDING") return compiled;
  if (stored.state !== "ACTIVE") {
    fail("MH_REPO_RUN_TERMINAL", "the compiled repository run is already terminal and will not be redispatched");
  }
  if (stored.session.sessionDigest !== compiled.session.sessionDigest) {
    fail("MH_REPO_RUN_BINDING", "persisted run session differs from the session compiled for the current Outcome");
  }
  return Object.freeze({ ...compiled, session: stored.session });
}

function compileRepoDecisionSession(repositoryPath, options) {
  const compiled = compileRepoDecisionWork(repositoryPath, options);
  if (compiled.type !== "DISPATCH") {
    fail("MH_REPO_NO_DISPATCH", `current repo decision is NO_DISPATCH: ${compiled.reason}`, compiled);
  }
  return compiled.session;
}

function assertRepoDecisionSessionCurrent(repositoryPath, session) {
  if (session?.origin?.type === "REPO_RUN") {
    const stored = runWorkSessionState(repositoryPath, session);
    if (stored.state === "TERMINAL") {
      fail("MH_REPO_RUN_TERMINAL", "repository run is already terminal");
    }
    if (stored.session?.sessionDigest && stored.session.sessionDigest !== session.sessionDigest) {
      fail("MH_REPO_RUN_BINDING", "resumable repository run differs from its durable session identity");
    }
    return stored.session || session;
  }
  if (session?.origin?.type !== "REPO_OUTCOME") return session;
  const claim = readOutcomeClaim(repositoryPath, session.origin.claimDigest);
  if (claim.outcomeDigest !== session.origin.outcomeDigest
      || readOutcomeClaimRelease(repositoryPath, claim.claimDigest, { optional: true })) {
    fail("MH_OUTCOME_CLAIM_STALE", "resumable work session no longer has active Outcome claim authority");
  }
  const stored = claimWorkSessionState(repositoryPath, claim.claimDigest);
  if (stored.state === "ACTIVE" && stored.session.sessionDigest !== session.sessionDigest) {
    fail("MH_OUTCOME_CLAIM_BINDING", "resumable work session differs from the claim-addressed persisted session");
  }
  if (stored.state === "TERMINAL") {
    fail("MH_OUTCOME_CLAIM_TERMINAL", "claim workspace is already terminal");
  }
  return session;
}

function requireRepoDecisionPlaneWork(repositoryPath, options = {}) {
  if (!decisionPlaneEnabled(repositoryPath)) return null;
  if (options.goal !== undefined || options.session !== undefined || options.allow !== undefined || options.base !== undefined) {
    fail(
      "MH_REPO_DECISION_REQUIRED",
      "this repository has opted into repo decision authority; material work must come from current .meta-harness/repo-decision.json",
    );
  }
  if (options.resume !== undefined) return "resume";
  return "decision";
}

module.exports = {
  ...repoDecision,
  ...worldAttestation,
  ...worldTransition,
  assertRepoDecisionSessionCurrent,
  compileRepoDecisionSession,
  compileRepoDecisionWork,
  decisionPlaneEnabled,
  isProtectedRepoDecisionPlanePath,
  prepareAuthoritativeWorld,
  requireRepoDecisionPlaneWork,
};
