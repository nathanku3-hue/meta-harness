"use strict";

/**
 * D069 private attempt preparation + claim (not packaged).
 * Duplicate/replay dispositions are bound to digest-keyed durable state.
 */

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const { validateRunSpecApproval } = require("../../lib/contracts/run-spec-approval");
const {
  sealExecutionReadinessFacts,
} = require("../../lib/contracts/execution-readiness-facts");
const { authorizeAttempt } = require("../../lib/contracts/authorize");
const {
  computeWorkspacePolicyDigest,
} = require("../../lib/contracts/attempt-authorization");
const {
  sealWorkspaceAttestation,
  isPathUnderRoot,
} = require("../../lib/contracts/workspace-attestation");
const { evaluateWorkspaceStart } = require("../../lib/contracts/workspace-start");

const {
  validateAttemptAuthorization,
} = require("../../lib/contracts/attempt-authorization");

const {
  codedError,
  isPlainObject,
  isNonEmptyString,
  hostRealPath,
  sha256Utf8,
  digestHex,
  writeJsonNoReplace,
  sealClaim,
  readJsonIfExists,
  assertExactValidationCommandBinding,
  assertClaimDigest,
  assertJournalDigest,
  assertAssessmentDigest,
} = require("./support");
const {
  runGit,
  removeWorktreeBestEffort,
  liveRepositoryFacts,
  refExists,
} = require("./git-ops");
const { implementAfterClaim } = require("./run-implement");

const CLAIM_SCHEMA = "d069-claim/v1";
const DETACHED_BRANCH_SENTINEL = "(detached)";

function publishReceipt(stateRoot, receipt) {
  const key = sha256Utf8(receipt.authorizationId);
  const dest = path.join(stateRoot, "authorizations", `auth-${key}.json`);
  try {
    writeJsonNoReplace(dest, receipt);
  } catch (err) {
    if (err && (err.code === "EEXIST" || err.code === "EPERM")) {
      let existing;
      try {
        existing = JSON.parse(fs.readFileSync(dest, "utf8"));
      } catch (readErr) {
        throw codedError(
          "D069_RECEIPT_CONFLICT",
          `authorization receipt exists but unreadable: ${readErr.message}`,
        );
      }
      const sealed = validateAttemptAuthorization(existing);
      if (!sealed.ok) {
        throw codedError(
          "D069_RECEIPT_CONFLICT",
          `stored authorization receipt failed validation: ${JSON.stringify(sealed.reasons)}`,
          { reasons: sealed.reasons },
        );
      }
      if (existing.receiptDigest !== receipt.receiptDigest) {
        throw codedError(
          "D069_RECEIPT_CONFLICT",
          "authorization receipt exists with different content",
        );
      }
      return dest;
    }
    throw err;
  }
  return dest;
}

function attemptPaths(stateRoot, authReqHex) {
  const attemptDir = path.join(stateRoot, "attempts", authReqHex);
  return {
    attemptDir,
    claimPath: path.join(attemptDir, "claim.json"),
    journalPath: path.join(attemptDir, "journal.json"),
    assessmentPath: path.join(attemptDir, "assessment.json"),
  };
}

/**
 * Inspect digest-keyed durable state before creating a worktree.
 * Stored digests are recomputed; never trusted as opaque fields alone.
 * @returns {null|object} disposition result or null to continue fresh start
 */
function inspectExistingAttempt(ctx, receipt, authReqHex) {
  const paths = attemptPaths(ctx.stateRoot, authReqHex);
  const claimRead = readJsonIfExists(paths.claimPath);
  const journalRead = readJsonIfExists(paths.journalPath);

  if (!claimRead.exists && !journalRead.exists) {
    return null;
  }
  if (!claimRead.exists && journalRead.exists) {
    throw codedError(
      "D069_STATE_CORRUPT",
      "journal present without claim for authorization-request digest",
    );
  }

  const claim = claimRead.value;
  if (!isPlainObject(claim)
    || claim.authorizationRequestDigest !== receipt.authorizationRequestDigest
    || claim.authorizationReceiptDigest !== receipt.receiptDigest) {
    throw codedError("D069_STATE_CORRUPT", "claim bindings invalid for this request");
  }
  assertClaimDigest(claim);

  if (!journalRead.exists) {
    return {
      ok: true,
      disposition: "CLAIMED_INCOMPLETE",
      terminal: false,
      restart: false,
      authorizationRequestDigest: receipt.authorizationRequestDigest,
      claimDigest: claim.claimDigest,
    };
  }

  const journal = journalRead.value;
  if (!isPlainObject(journal)
    || journal.authorizationRequestDigest !== receipt.authorizationRequestDigest
    || journal.claimDigest !== claim.claimDigest) {
    throw codedError("D069_STATE_CORRUPT", "journal bindings invalid for claim");
  }
  assertJournalDigest(journal);

  if (journal.terminal === true && journal.state === "verified") {
    return replayVerified(ctx, receipt, claim, journal, paths, authReqHex);
  }

  if (journal.terminal === true) {
    return {
      ok: false,
      disposition: "controller_failed",
      terminal: true,
      restart: false,
      code: "D069_PRIOR_TERMINAL_FAILURE",
      authorizationRequestDigest: receipt.authorizationRequestDigest,
      journalState: journal.state,
      failureCode: journal.failureCode || null,
    };
  }

  return {
    ok: true,
    disposition: "ALREADY_CLAIMED",
    terminal: false,
    restart: false,
    authorizationRequestDigest: receipt.authorizationRequestDigest,
    claimDigest: claim.claimDigest,
    journalState: journal.state,
  };
}

function replayVerified(ctx, receipt, claim, journal, paths, authReqHex) {
  const { repositoryId, repositoryPath, gitHome, gitExecutablePath } = ctx;
  if (!isNonEmptyString(journal.verifiedHeadRevision)
    || !isNonEmptyString(journal.durableRef)
    || !isNonEmptyString(journal.implementationAssessmentDigest)
    || !isNonEmptyString(journal.factsDigest)
    || !isNonEmptyString(journal.startCheckDigest)) {
    throw codedError("D069_STATE_CORRUPT", "verified journal missing required terminal fields");
  }

  const expectedRef = `refs/meta-harness/attempts/${authReqHex}`;
  if (journal.durableRef !== expectedRef) {
    throw codedError(
      "D069_STATE_CORRUPT",
      `journal.durableRef must equal ${expectedRef}`,
    );
  }

  const assessmentRead = readJsonIfExists(paths.assessmentPath);
  if (!assessmentRead.exists || !isPlainObject(assessmentRead.value)) {
    throw codedError("D069_STATE_CORRUPT", "verified journal without assessment.json");
  }
  const assessment = assessmentRead.value;
  assertAssessmentDigest(assessment);

  if (assessment.verdict !== "IMPLEMENTATION_VERIFIED"
    || assessment.implementationAssessmentDigest !== journal.implementationAssessmentDigest
    || assessment.verifiedHeadRevision !== journal.verifiedHeadRevision
    || assessment.factsDigest !== journal.factsDigest
    || assessment.runSpecDigest !== receipt.runSpecDigest
    || assessment.attemptId !== receipt.attemptId
    || assessment.authorizationReceiptDigest !== receipt.receiptDigest
    || assessment.startCheckDigest !== journal.startCheckDigest
    || assessment.repositoryId !== repositoryId) {
    throw codedError(
      "D069_STATE_CORRUPT",
      "assessment bindings do not match current request/journal",
    );
  }

  if (!refExists(gitExecutablePath, repositoryPath, journal.durableRef, gitHome)) {
    throw codedError(
      "D069_REF_MISSING",
      `terminal replay failed: durable ref missing: ${journal.durableRef}`,
    );
  }
  const refValue = String(
    runGit(gitExecutablePath, repositoryPath, ["rev-parse", journal.durableRef], gitHome).stdout,
  ).trim();
  if (refValue !== journal.verifiedHeadRevision) {
    throw codedError(
      "D069_REF_MISMATCH",
      "terminal replay failed: durable ref does not match verifiedHeadRevision",
    );
  }

  return {
    ok: true,
    disposition: "REPLAY",
    terminal: true,
    restart: false,
    won: false,
    verdict: "IMPLEMENTATION_VERIFIED",
    authorizationRequestDigest: receipt.authorizationRequestDigest,
    claimDigest: claim.claimDigest,
    factsDigest: journal.factsDigest,
    implementationAssessmentDigest: journal.implementationAssessmentDigest,
    verifiedHeadRevision: journal.verifiedHeadRevision,
    durableRef: journal.durableRef,
    assessment,
  };
}

/**
 * Execute one attempt (fresh start, disposition, or terminal replay).
 */
async function executeAttempt(ctx, request) {
  const {
    repositoryId,
    repositoryPath,
    stateRoot,
    workspaceRoot,
    boundPolicy,
    boundValidation,
    gitHome,
    gitExecutablePath,
    clock,
  } = ctx;

  let worktreePath = null;

  try {
    if (!isPlainObject(request)
      || !isPlainObject(request.runSpecApproval)
      || !isPlainObject(request.authorizationRequest)) {
      throw codedError(
        "D069_REQUEST_SHAPE",
        "request must be { runSpecApproval, authorizationRequest }",
      );
    }

    const approvalCheck = validateRunSpecApproval(request.runSpecApproval, {
      maxCommandTimeoutSeconds: boundPolicy.maxCommandTimeoutSeconds,
    });
    if (!approvalCheck.ok) {
      throw codedError(
        "D069_APPROVAL_INVALID",
        `runSpecApproval invalid: ${JSON.stringify(approvalCheck.reasons)}`,
        { reasons: approvalCheck.reasons },
      );
    }
    const runSpecApproval = request.runSpecApproval;
    const runSpec = runSpecApproval.runSpec;
    const authRequest = request.authorizationRequest;
    if (!isNonEmptyString(authRequest.authorizationId)
      || !isNonEmptyString(authRequest.attemptId)
      || Object.keys(authRequest).sort().join(",") !== "attemptId,authorizationId") {
      throw codedError(
        "D069_AUTH_REQUEST_SHAPE",
        "authorizationRequest must be exactly { authorizationId, attemptId }",
      );
    }

    if (runSpec.repository.repositoryId !== repositoryId) {
      throw codedError(
        "D069_REPOSITORY_ID_MISMATCH",
        "runSpec.repository.repositoryId must equal trustedRepository.repositoryId",
      );
    }

    assertExactValidationCommandBinding(runSpec, boundValidation.expectedCommand);

    const live = liveRepositoryFacts(gitExecutablePath, repositoryPath, gitHome);
    if (live.objectFormat !== runSpec.repository.objectFormat) {
      throw codedError("D069_OBJECT_FORMAT", "live objectFormat does not match runSpec");
    }
    if (live.head !== runSpec.repository.expectedBaseRevision) {
      throw codedError(
        "D069_BASE_REVISION",
        "live HEAD must equal runSpec.repository.expectedBaseRevision",
      );
    }
    if (!live.clean) {
      throw codedError("D069_REPO_DIRTY", "trusted repository primary worktree must be clean");
    }

    const now = clock();
    const readiness = sealExecutionReadinessFacts({
      schemaVersion: "execution-readiness-facts/v1",
      runSpecDigest: runSpecApproval.runSpecDigest,
      repositoryId,
      objectFormat: live.objectFormat,
      observedHeadRevision: live.head,
      clean: true,
      inspectedAt: now,
      workspacePolicyDigest: computeWorkspacePolicyDigest(boundPolicy.workspacePolicy),
    });

    const authResult = authorizeAttempt(
      runSpecApproval,
      readiness,
      { authorizationId: authRequest.authorizationId, attemptId: authRequest.attemptId },
      { now, policy: boundPolicy },
    );
    if (!authResult.ok || !authResult.authorizationReceipt) {
      throw codedError(
        "D069_AUTHORIZE_FAILED",
        `authorizeAttempt failed: ${JSON.stringify(authResult.reasons)}`,
        { reasons: authResult.reasons, verdict: authResult.verdict },
      );
    }
    const receipt = authResult.authorizationReceipt;
    publishReceipt(stateRoot, receipt);

    const authReqHex = digestHex(receipt.authorizationRequestDigest);
    const existing = inspectExistingAttempt(ctx, receipt, authReqHex);
    if (existing) {
      return existing;
    }

    const invocationNonce = crypto.randomBytes(8).toString("hex");
    worktreePath = path.join(workspaceRoot, "workspaces", authReqHex, invocationNonce);
    fs.mkdirSync(path.dirname(worktreePath), { recursive: true });

    runGit(
      gitExecutablePath,
      repositoryPath,
      ["worktree", "add", "--detach", worktreePath, runSpec.repository.expectedBaseRevision],
      gitHome,
    );

    const worktreeCanon = hostRealPath(worktreePath);
    worktreePath = worktreeCanon;
    if (!isPathUnderRoot(worktreeCanon, workspaceRoot)) {
      throw codedError(
        "D069_WORKTREE_OUTSIDE_ROOT",
        "worktree path is outside approved workspaceRoot",
      );
    }

    const wtHead = String(
      runGit(gitExecutablePath, worktreePath, ["rev-parse", "HEAD"], gitHome).stdout,
    ).trim();
    if (wtHead !== runSpec.repository.expectedBaseRevision) {
      throw codedError("D069_WORKTREE_HEAD", "detached worktree HEAD must equal expected base");
    }
    const wtStatus = String(
      runGit(gitExecutablePath, worktreePath, ["status", "--porcelain", "-uall"], gitHome).stdout,
    );
    if (wtStatus.trim() !== "") {
      throw codedError("D069_WORKTREE_DIRTY", "worktree must be clean at base before start");
    }

    const collectedAt = clock();
    const workspaceRef = `${authReqHex}/${invocationNonce}`;
    const attestation = sealWorkspaceAttestation({
      schemaVersion: "workspace-attestation/v1",
      runId: runSpec.runId,
      attemptId: receipt.attemptId,
      provider: receipt.provider.id,
      repositoryId,
      objectFormat: runSpec.repository.objectFormat,
      workspaceRef,
      repositoryRoot: worktreeCanon,
      branch: DETACHED_BRANCH_SENTINEL,
      baseRevision: runSpec.repository.expectedBaseRevision,
      currentHead: runSpec.repository.expectedBaseRevision,
      clean: true,
      runSpecDigest: receipt.runSpecDigest,
      authorizationReceiptDigest: receipt.receiptDigest,
      workspacePolicyDigest: receipt.workspacePolicyDigest,
      collectedAt,
    });

    const startResult = evaluateWorkspaceStart({
      runSpec,
      authorizationReceipt: receipt,
      attestation,
      workspacePolicy: boundPolicy.workspacePolicy,
      now: clock(),
    });
    if (!startResult.ok || startResult.verdict !== "START_ALLOWED") {
      throw codedError(
        "D069_START_BLOCKED",
        `START_ALLOWED required: ${JSON.stringify(startResult.reasons)}`,
        { reasons: startResult.reasons, verdict: startResult.verdict },
      );
    }
    const startCheck = startResult.startCheck;

    const claimedAt = clock();
    const claim = sealClaim({
      schemaVersion: CLAIM_SCHEMA,
      authorizationRequestDigest: receipt.authorizationRequestDigest,
      authorizationReceiptDigest: receipt.receiptDigest,
      startCheckDigest: startCheck.startCheckDigest,
      workspaceRef,
      invocationNonce,
      claimedAt,
    });

    const paths = attemptPaths(stateRoot, authReqHex);
    try {
      writeJsonNoReplace(paths.claimPath, claim);
    } catch (err) {
      if (err && (err.code === "EEXIST" || err.code === "EPERM")) {
        removeWorktreeBestEffort(gitExecutablePath, repositoryPath, worktreePath, gitHome);
        worktreePath = null;
        const disposition = inspectExistingAttempt(ctx, receipt, authReqHex);
        if (disposition) return disposition;
        throw codedError(
          "D069_CLAIM_PUBLISH_FAILED",
          "claim exists but attempt state could not be classified",
        );
      }
      throw codedError(
        "D069_CLAIM_PUBLISH_FAILED",
        `claim publication failed: ${err.message}`,
        { causeCode: err && err.code },
      );
    }

    const ownedWorktree = worktreePath;
    worktreePath = null;
    return implementAfterClaim(ctx, {
      runSpec,
      receipt,
      attestation,
      startCheck,
      claim,
      worktreePath: ownedWorktree,
      authReqHex,
      workspaceRef,
      invocationNonce,
      attemptDir: paths.attemptDir,
    });
  } finally {
    if (worktreePath) {
      removeWorktreeBestEffort(gitExecutablePath, repositoryPath, worktreePath, gitHome);
    }
  }
}

module.exports = {
  executeAttempt,
  DETACHED_BRANCH_SENTINEL,
};
