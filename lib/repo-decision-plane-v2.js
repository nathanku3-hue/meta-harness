"use strict";

const fs = require("node:fs");
const path = require("node:path");

const { ConfigError } = require("./errors");
const { findExecutionClosureForDecision, recoverExecutionClosure } = require("./execution-closure");
const repoDecision = require("./repo-decision");
const {
  admissionForHead,
  persistImmutableBytes,
  persistImmutableJson,
  workspaceExecutionLeaseAppearsActive,
} = require("./world-authority");
const worldAttestation = require("./world-attestation");
const worldTransition = require("./world-transition");

const PROTECTED_CONTROL_PATHS = new Set([
  ".meta-harness/repo-charter.json",
  ".meta-harness/repo-world.json",
  ".meta-harness/world-attestation.json",
  ".meta-harness/world-transition.json",
  ".meta-harness/repo-interpretation.json",
  ".meta-harness/repo-decision.json",
  ".meta-harness/owner-directive.md",
]);

function fail(code, message, details) {
  throw new ConfigError(message, { code, details });
}

function normalizedControlPath(relativePath) {
  return String(relativePath || "").replace(/\\/gu, "/").replace(/^\.\//u, "");
}

function isProtectedRepoDecisionPlanePath(relativePath) {
  return PROTECTED_CONTROL_PATHS.has(normalizedControlPath(relativePath));
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
  return recoverExecutionClosure(repositoryPath, admittedSession(admission), now);
}

function bankAbortedAdmission(repositoryPath, head, admission, closure) {
  if (!closure || closure.workResultDigest !== null) return null;
  const body = {
    schemaVersion: worldTransition.WORLD_TRANSITION_SCHEMA,
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
    fail("MH_WORLD_POINTER", "no authoritative WorldHead exists; repo intelligence must commit an initial REALITY_REFRESH transition first");
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
  if (admission) fail("MH_WORLD_HEAD_FROZEN", "authoritative WorldHead remains admitted after recovery");
  return worldTransition.readCurrentWorldState(repositoryPath, { now });
}

function compileRepoDecisionWork(repositoryPath, { now = new Date() } = {}) {
  return repoDecision.compileRepoDecision(repositoryPath, prepareAuthoritativeWorld(repositoryPath, now));
}

function compileRepoDecisionSession(repositoryPath, options) {
  const compiled = compileRepoDecisionWork(repositoryPath, options);
  if (compiled.type !== "DISPATCH") {
    fail("MH_REPO_NO_DISPATCH", `current repo decision is NO_DISPATCH: ${compiled.reason}`, compiled);
  }
  return compiled.session;
}

function assertRepoDecisionSessionCurrent(repositoryPath, session) {
  if (session?.origin?.type !== "REPO_DECISION") return session;
  const compiled = compileRepoDecisionWork(repositoryPath);
  if (compiled.type !== "DISPATCH"
      || compiled.decisionDigest !== session.origin.decisionDigest
      || compiled.session.sessionDigest !== session.sessionDigest) {
    fail("MH_REPO_DECISION_STALE", "resumable work session no longer matches current Repo Decision authority");
  }
  return session;
}

function requireRepoDecisionPlaneWork(repositoryPath, options = {}) {
  if (!decisionPlaneEnabled(repositoryPath)) return null;
  if (options.goal !== undefined || options.session !== undefined || options.allow !== undefined) {
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
