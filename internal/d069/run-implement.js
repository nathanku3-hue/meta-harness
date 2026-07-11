"use strict";

/**
 * D069 private post-claim implementation path (not packaged).
 */

const path = require("node:path");

const {
  sealImplementationFacts,
} = require("../../lib/contracts/implementation-facts");
const {
  evaluateImplementationFacts,
} = require("../../lib/contracts/implementation-assessment");
const { commandIdFromSpecCommand } = require("../../lib/contracts/run-spec");
const { checkScope } = require("../../lib/contracts/scope");

const {
  codedError,
  writeJsonReplace,
  writeTextFile,
  revalidateProgram,
  spawnProgram,
  artifactDigest,
  sealJournal,
} = require("./support");
const {
  CONTROLLER_AUTHOR_NAME,
  sanitizedGitEnv,
  runGit,
  isDetachedHead,
  createOnlyRef,
  refExists,
  removeWorktreeVerified,
  removeWorktreeBestEffort,
} = require("./git-ops");

const JOURNAL_SCHEMA = "d069-journal/v1";
const FIXTURE_RELATIVE = "src/fixture.txt";

function journalBase(receipt, claim, startCheck, workspaceRef, invocationNonce, clock, state, extra = {}) {
  return sealJournal({
    schemaVersion: JOURNAL_SCHEMA,
    authorizationRequestDigest: receipt.authorizationRequestDigest,
    claimDigest: claim.claimDigest,
    authorizationReceiptDigest: receipt.receiptDigest,
    startCheckDigest: startCheck.startCheckDigest,
    workspaceRef,
    invocationNonce,
    state,
    terminal: false,
    updatedAt: clock(),
    ...extra,
  });
}

function writeTerminalFailure(journalPath, receipt, claim, startCheck, workspaceRef, invocationNonce, clock, err) {
  const code = (err && err.code) || "D069_CONTROLLER_FAILED";
  const journal = sealJournal({
    schemaVersion: JOURNAL_SCHEMA,
    authorizationRequestDigest: receipt.authorizationRequestDigest,
    claimDigest: claim.claimDigest,
    authorizationReceiptDigest: receipt.receiptDigest,
    startCheckDigest: startCheck.startCheckDigest,
    workspaceRef,
    invocationNonce,
    state: "controller_failed",
    terminal: true,
    updatedAt: clock(),
    failureCode: String(code),
    failureMessage: String((err && err.message) || "controller failed"),
  });
  try {
    writeJsonReplace(journalPath, journal);
  } catch {
    // still throw original
  }
  return journal;
}

/**
 * Full post-validation re-attestation of worktree + primary ref absence.
 */
function reattestAfterValidation(gitExecutablePath, worktreePath, repositoryPath, runSpec, commitHead, durableRef, gitHome) {
  const head = String(
    runGit(gitExecutablePath, worktreePath, ["rev-parse", "HEAD"], gitHome).stdout,
  ).trim();
  if (head !== commitHead) {
    throw codedError(
      "D069_HEAD_MUTATION",
      `post-validation HEAD ${head} != controller commit ${commitHead}`,
    );
  }
  if (!isDetachedHead(gitExecutablePath, worktreePath, gitHome)) {
    throw codedError("D069_NOT_DETACHED", "post-validation worktree HEAD must be detached");
  }

  const status = String(
    runGit(gitExecutablePath, worktreePath, ["status", "--porcelain", "-uall"], gitHome).stdout,
  );
  if (status.trim() !== "") {
    throw codedError("D069_POST_DIRTY", "worktree must be clean after validation (including untracked)");
  }

  let objectFormat = "sha1";
  try {
    const fmt = String(
      runGit(gitExecutablePath, worktreePath, ["rev-parse", "--show-object-format"], gitHome).stdout,
    ).trim();
    if (fmt === "sha1" || fmt === "sha256") objectFormat = fmt;
  } catch {
    objectFormat = head.length === 64 ? "sha256" : "sha1";
  }
  if (objectFormat !== runSpec.repository.objectFormat) {
    throw codedError("D069_OBJECT_FORMAT", "post-validation objectFormat mismatch");
  }

  const topLevel = String(
    runGit(gitExecutablePath, worktreePath, ["rev-parse", "--show-toplevel"], gitHome).stdout,
  ).trim();
  if (path.resolve(topLevel) !== path.resolve(worktreePath)) {
    throw codedError("D069_TOPLEVEL", "worktree top-level identity mismatch after validation");
  }

  const mergeBase = String(
    runGit(
      gitExecutablePath,
      worktreePath,
      ["merge-base", runSpec.repository.expectedBaseRevision, commitHead],
      gitHome,
    ).stdout,
  ).trim();
  if (mergeBase !== runSpec.repository.expectedBaseRevision) {
    throw codedError("D069_BASE_ANCESTOR", "expected base must be ancestor of commit");
  }

  if (refExists(gitExecutablePath, repositoryPath, durableRef, gitHome)) {
    throw codedError(
      "D069_REF_EXISTS",
      `durable attempt ref must not exist before create-only publication: ${durableRef}`,
    );
  }

  return { headAfter: head, objectFormat };
}

/**
 * Winner path after immutable claim publication.
 */
async function implementAfterClaim(ctx, args) {
  const {
    repositoryPath,
    stateRoot,
    boundPolicy,
    boundWorker,
    boundValidation,
    gitHome,
    gitExecutablePath,
    clock,
    fixedTimeoutSeconds,
  } = ctx;

  const {
    runSpec,
    receipt,
    attestation,
    startCheck,
    claim,
    worktreePath: initialWorktree,
    authReqHex,
    workspaceRef,
    invocationNonce,
    attemptDir,
  } = args;

  let worktreePath = initialWorktree;
  const journalPath = path.join(attemptDir, "journal.json");
  let claimedForFailure = true;

  try {
    let journal = journalBase(
      receipt, claim, startCheck, workspaceRef, invocationNonce, clock, "claimed",
    );
    writeJsonReplace(journalPath, journal);

    revalidateProgram(boundWorker);
    journal = journalBase(
      receipt, claim, startCheck, workspaceRef, invocationNonce, clock, "worker_started",
    );
    writeJsonReplace(journalPath, journal);

    const workerResult = spawnProgram(
      boundWorker.executablePath,
      boundWorker.scriptPath,
      worktreePath,
      fixedTimeoutSeconds,
      sanitizedGitEnv(gitHome),
    );
    const artDir = path.join(stateRoot, "artifacts", authReqHex);
    writeTextFile(path.join(artDir, "worker.stdout"), String(workerResult.stdout || ""));
    writeTextFile(path.join(artDir, "worker.stderr"), String(workerResult.stderr || ""));
    if (workerResult.error) {
      throw codedError("D069_WORKER_SPAWN_FAILED", workerResult.error.message);
    }
    if (workerResult.status !== 0) {
      throw codedError(
        "D069_WORKER_FAILED",
        `fixture worker exited ${workerResult.status}: ${String(workerResult.stderr || "").trim()}`,
        { status: workerResult.status },
      );
    }

    runGit(
      gitExecutablePath,
      worktreePath,
      ["reset", "--mixed", runSpec.repository.expectedBaseRevision],
      gitHome,
    );
    const postResetHead = String(
      runGit(gitExecutablePath, worktreePath, ["rev-parse", "HEAD"], gitHome).stdout,
    ).trim();
    if (postResetHead !== runSpec.repository.expectedBaseRevision) {
      throw codedError("D069_RESET_HEAD", "after reset --mixed HEAD must equal expected base");
    }
    if (!isDetachedHead(gitExecutablePath, worktreePath, gitHome)) {
      throw codedError("D069_NOT_DETACHED", "worktree HEAD must be detached");
    }

    const nameStatusOut = String(
      runGit(gitExecutablePath, worktreePath, ["diff", "--name-status", "HEAD"], gitHome).stdout,
    );
    writeTextFile(path.join(artDir, "git.name-status"), nameStatusOut);
    const patchOut = String(
      runGit(gitExecutablePath, worktreePath, ["diff", "HEAD"], gitHome).stdout,
    );
    writeTextFile(path.join(artDir, "git.patch"), patchOut);

    const changedFiles = [];
    for (const line of nameStatusOut.split(/\r?\n/)) {
      if (!line.trim()) continue;
      const parts = line.split(/\t/);
      const status = parts[0];
      const filePath = parts[parts.length - 1];
      if (status && filePath) {
        changedFiles.push({ status: status.charAt(0), path: filePath.replace(/\\/g, "/") });
      }
    }
    if (changedFiles.length !== 1
      || changedFiles[0].status !== "M"
      || changedFiles[0].path !== FIXTURE_RELATIVE) {
      throw codedError(
        "D069_SCOPE_CHANGE",
        `expected exactly M ${FIXTURE_RELATIVE}, got ${JSON.stringify(changedFiles)}`,
      );
    }
    const scopeResult = checkScope(runSpec.scope, changedFiles);
    if (!scopeResult.ok) {
      throw codedError("D069_SCOPE_VIOLATION", scopeResult.detail, { scopeResult });
    }

    runGit(gitExecutablePath, worktreePath, ["add", "--", FIXTURE_RELATIVE], gitHome);
    runGit(
      gitExecutablePath,
      worktreePath,
      ["commit", "-m", `d069 verified attempt ${authReqHex}`],
      gitHome,
    );
    const commitHead = String(
      runGit(gitExecutablePath, worktreePath, ["rev-parse", "HEAD"], gitHome).stdout,
    ).trim();
    const parents = String(
      runGit(
        gitExecutablePath,
        worktreePath,
        ["rev-list", "--parents", "-n", "1", "HEAD"],
        gitHome,
      ).stdout,
    ).trim().split(/\s+/);
    if (parents.length < 2 || parents[1] !== runSpec.repository.expectedBaseRevision) {
      throw codedError(
        "D069_COMMIT_PARENT",
        `controller commit parent must equal expected base; got ${parents.join(" ")}`,
      );
    }
    const authorName = String(
      runGit(gitExecutablePath, worktreePath, ["show", "-s", "--format=%an", "HEAD"], gitHome).stdout,
    ).trim();
    const committerName = String(
      runGit(gitExecutablePath, worktreePath, ["show", "-s", "--format=%cn", "HEAD"], gitHome).stdout,
    ).trim();
    if (authorName !== CONTROLLER_AUTHOR_NAME || committerName !== CONTROLLER_AUTHOR_NAME) {
      throw codedError(
        "D069_COMMIT_IDENTITY",
        `controller author/committer required; got author=${authorName} committer=${committerName}`,
      );
    }

    journal = journalBase(
      receipt, claim, startCheck, workspaceRef, invocationNonce, clock, "validating",
    );
    writeJsonReplace(journalPath, journal);

    revalidateProgram(boundValidation);
    const validationCmd = boundValidation.expectedCommand;
    const valStartedAt = clock();
    const valResult = spawnProgram(
      boundValidation.executablePath,
      boundValidation.scriptPath,
      worktreePath,
      validationCmd.timeoutSeconds,
      sanitizedGitEnv(gitHome),
    );
    const valEndedAt = clock();
    writeTextFile(path.join(artDir, "validation.stdout"), String(valResult.stdout || ""));
    writeTextFile(path.join(artDir, "validation.stderr"), String(valResult.stderr || ""));
    if (valResult.error) {
      throw codedError("D069_VALIDATION_SPAWN_FAILED", valResult.error.message);
    }
    if (valResult.status !== 0) {
      throw codedError(
        "D069_VALIDATION_FAILED",
        `validation exited ${valResult.status}: ${String(valResult.stderr || "").trim()}`,
        { status: valResult.status },
      );
    }

    const durableRef = `refs/meta-harness/attempts/${authReqHex}`;
    const reattested = reattestAfterValidation(
      gitExecutablePath,
      worktreePath,
      repositoryPath,
      runSpec,
      commitHead,
      durableRef,
      gitHome,
    );
    const gitCollectedAt = clock();

    const valSpecCmd = runSpec.validation.commands[0];
    const trustedFacts = sealImplementationFacts({
      schemaVersion: "implementation-facts/v1",
      bindings: {
        runSpecDigest: receipt.runSpecDigest,
        authorizationReceiptDigest: receipt.receiptDigest,
        workspaceAttestationDigest: attestation.attestationDigest,
        startCheckDigest: startCheck.startCheckDigest,
        attemptId: receipt.attemptId,
        repositoryId: ctx.repositoryId,
      },
      git: {
        repositoryId: ctx.repositoryId,
        objectFormat: runSpec.repository.objectFormat,
        baseRevision: runSpec.repository.expectedBaseRevision,
        headRevision: commitHead,
        baseIsAncestor: true,
        clean: true,
        changedFiles: [{ status: "M", path: FIXTURE_RELATIVE }],
        collectedAt: gitCollectedAt,
        nameStatusArtifact: artifactDigest("git.name-status", nameStatusOut),
        patchArtifact: artifactDigest("git.patch", patchOut),
      },
      commands: [
        {
          commandId: commandIdFromSpecCommand(valSpecCmd),
          argv: valSpecCmd.argv.slice(),
          cwdRelative: valSpecCmd.cwdRelative,
          timeoutSeconds: valSpecCmd.timeoutSeconds,
          networkPolicy: valSpecCmd.networkPolicy,
          environmentPolicy: { allow: valSpecCmd.environmentPolicy.allow.slice() },
          startedAt: valStartedAt,
          endedAt: valEndedAt,
          exitCode: 0,
          timedOut: false,
          headBefore: commitHead,
          headAfter: reattested.headAfter,
          networkAttempted: false,
          stdoutArtifact: artifactDigest("validation.stdout", String(valResult.stdout || "")),
          stderrArtifact: artifactDigest("validation.stderr", String(valResult.stderr || "")),
        },
      ],
      collectedAt: clock(),
    });

    const impl = evaluateImplementationFacts({
      runSpec,
      authorizationReceipt: receipt,
      workspaceAttestation: attestation,
      startCheck,
      trustedImplementationFacts: trustedFacts,
      workspacePolicy: boundPolicy.workspacePolicy,
    });
    if (!impl.ok || impl.verdict !== "IMPLEMENTATION_VERIFIED") {
      throw codedError(
        "D069_ASSESSMENT_FAILED",
        `IMPLEMENTATION_VERIFIED required: ${JSON.stringify(impl.reasons)}`,
        { reasons: impl.reasons, verdict: impl.verdict },
      );
    }
    const assessment = impl.implementationAssessment;

    createOnlyRef(
      gitExecutablePath,
      repositoryPath,
      durableRef,
      commitHead,
      runSpec.repository.objectFormat,
      gitHome,
    );
    writeJsonReplace(path.join(attemptDir, "assessment.json"), assessment);

    removeWorktreeVerified(gitExecutablePath, repositoryPath, worktreePath, gitHome);
    worktreePath = null;

    const refValue = String(
      runGit(gitExecutablePath, repositoryPath, ["rev-parse", durableRef], gitHome).stdout,
    ).trim();
    if (refValue !== commitHead) {
      throw codedError(
        "D069_REF_MISMATCH",
        `durable ref ${durableRef} does not equal assessed commit`,
      );
    }
    const primaryStatus = String(
      runGit(gitExecutablePath, repositoryPath, ["status", "--porcelain", "-uall"], gitHome).stdout,
    );
    if (primaryStatus.trim() !== "") {
      throw codedError("D069_PRIMARY_DIRTY", "primary worktree must remain clean at base");
    }
    const primaryHead = String(
      runGit(gitExecutablePath, repositoryPath, ["rev-parse", "HEAD"], gitHome).stdout,
    ).trim();
    if (primaryHead !== runSpec.repository.expectedBaseRevision) {
      throw codedError("D069_PRIMARY_HEAD", "primary HEAD must remain at expected base");
    }

    journal = sealJournal({
      schemaVersion: JOURNAL_SCHEMA,
      authorizationRequestDigest: receipt.authorizationRequestDigest,
      claimDigest: claim.claimDigest,
      authorizationReceiptDigest: receipt.receiptDigest,
      startCheckDigest: startCheck.startCheckDigest,
      workspaceRef,
      invocationNonce,
      state: "verified",
      terminal: true,
      updatedAt: clock(),
      implementationAssessmentDigest: assessment.implementationAssessmentDigest,
      factsDigest: trustedFacts.factsDigest,
      verifiedHeadRevision: commitHead,
      durableRef,
    });
    writeJsonReplace(journalPath, journal);
    claimedForFailure = false;

    return {
      ok: true,
      disposition: "VERIFIED",
      terminal: true,
      restart: false,
      won: true,
      verdict: "IMPLEMENTATION_VERIFIED",
      authorizationRequestDigest: receipt.authorizationRequestDigest,
      claimDigest: claim.claimDigest,
      factsDigest: trustedFacts.factsDigest,
      implementationAssessmentDigest: assessment.implementationAssessmentDigest,
      verifiedHeadRevision: commitHead,
      durableRef,
      assessment,
    };
  } catch (err) {
    if (claimedForFailure) {
      writeTerminalFailure(
        journalPath, receipt, claim, startCheck, workspaceRef, invocationNonce, clock, err,
      );
    }
    throw err;
  } finally {
    if (worktreePath) {
      try {
        removeWorktreeVerified(gitExecutablePath, repositoryPath, worktreePath, gitHome);
      } catch {
        removeWorktreeBestEffort(gitExecutablePath, repositoryPath, worktreePath, gitHome);
      }
    }
  }
}

module.exports = {
  implementAfterClaim,
};
