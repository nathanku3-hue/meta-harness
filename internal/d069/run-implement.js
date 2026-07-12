"use strict";

/**
 * D070-A1 private post-claim implementation path (lineage: internal/d069).
 * Not packaged.
 *
 * AO :read-only → post-AO custody gate → validate artifact → controller materialize
 * → commit → validation → IMPLEMENTATION_VERIFIED → create-only durable ref.
 */

const fs = require("node:fs");
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
  sha256File,
  sealJournal,
  sameCanonicalExistingPath,
} = require("./support");
const {
  CONTROLLER_AUTHOR_NAME,
  runGit,
  isDetachedHead,
  createOnlyRef,
  refExists,
  removeWorktreeVerified,
  removeWorktreeBestEffort,
} = require("./git-ops");
const {
  requireSingleLiteralScopePath,
  buildChangeArtifactSchema,
  parseCodexJsonl,
  extractChangeArtifact,
  validateChangeArtifact,
  materializeChangeArtifact,
  summarizeEvents,
} = require("./ao-artifact");
const { spawnAoProcess } = require("./ao-process");
const {
  captureWorktreeCustody,
  assertPostAoCleanCustody,
} = require("./ao-custody");

const JOURNAL_SCHEMA = "d069-journal/v1";

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
  if (!sameCanonicalExistingPath(topLevel, worktreePath)) {
    throw codedError(
      "D069_TOPLEVEL",
      `worktree top-level identity mismatch after validation: git=${topLevel} worktree=${worktreePath}`,
    );
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

function persistAoMeta(artDir, processResult, eventSummary, spawnOrdinal) {
  const meta = {
    schemaVersion: "d070-ao-process-meta/v1",
    spawnOrdinal,
    exitCode: processResult.meta.exitCode,
    timedOut: processResult.meta.timedOut,
    capBreached: processResult.meta.capBreached,
    stdoutSha256: processResult.meta.stdoutSha256,
    stderrSha256: processResult.meta.stderrSha256,
    stdoutBytes: processResult.meta.stdoutBytes,
    stderrBytes: processResult.meta.stderrBytes,
    eventCount: eventSummary ? eventSummary.eventCount : null,
    eventTypeCounts: eventSummary ? eventSummary.eventTypeCounts : null,
    terminalType: eventSummary ? eventSummary.terminalType : null,
    promptSha256: processResult.meta.promptSha256,
    identity: processResult.meta.identity,
    argv: processResult.meta.argv,
    killInfo: processResult.meta.killInfo,
    // Bounded redacted failure diagnostic only (no raw model streams).
    failureCode: processResult.ok ? null : processResult.code,
  };
  writeJsonReplace(path.join(artDir, "ao-process-meta.json"), meta);
  return meta;
}

/**
 * Winner path after immutable claim publication.
 */
async function implementAfterClaim(ctx, args) {
  const {
    repositoryPath,
    stateRoot,
    boundPolicy,
    boundCodex,
    boundValidation,
    gitHome,
    gitExecutablePath,
    clock,
    fixedTimeoutSeconds,
    aoTimeoutSeconds,
    recordAoSpawn,
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

    const allowedPath = requireSingleLiteralScopePath(runSpec.scope);

    journal = journalBase(
      receipt, claim, startCheck, workspaceRef, invocationNonce, clock, "worker_started",
    );
    writeJsonReplace(journalPath, journal);

    const artDir = path.join(stateRoot, "artifacts", authReqHex);
    fs.mkdirSync(artDir, { recursive: true });

    const schema = buildChangeArtifactSchema(allowedPath);
    const schemaPath = path.join(artDir, "change-artifact.schema.json");
    writeJsonReplace(schemaPath, schema);
    const changeArtifactSchemaSha256 = sha256File(schemaPath);

    // Capture custody BEFORE AO so we can prove no mutation after.
    const custodyBefore = captureWorktreeCustody(
      gitExecutablePath,
      worktreePath,
      repositoryPath,
      gitHome,
    );
    if (custodyBefore.head !== runSpec.repository.expectedBaseRevision) {
      throw codedError(
        "D070_PRE_AO_HEAD",
        "pre-AO HEAD must equal expected base",
      );
    }
    if (!custodyBefore.detached || custodyBefore.status.trim() !== "") {
      throw codedError("D070_PRE_AO_CLEAN", "pre-AO worktree must be clean and detached");
    }

    const spawnOrdinal = typeof recordAoSpawn === "function" ? recordAoSpawn() : 1;
    const processResult = await spawnAoProcess(boundCodex, {
      worktreePath,
      schemaPath,
      allowedPath,
      objective: runSpec.objective,
      timeoutSeconds: aoTimeoutSeconds || 120,
    });

    // Never persist raw AO stdout/stderr by default.
    let eventSummary = null;
    if (!processResult.ok) {
      persistAoMeta(artDir, processResult, null, spawnOrdinal);
      if (processResult.meta.timedOut) {
        throw codedError("D070_AO_TIMEOUT", "AO process timed out; process tree terminated");
      }
      if (processResult.meta.capBreached) {
        throw codedError(
          "D070_AO_OUTPUT_CAP",
          `AO ${processResult.meta.capBreached} exceeded cap; process tree terminated`,
        );
      }
      throw codedError(
        "D070_AO_EXIT",
        `AO process exited ${processResult.meta.exitCode}`,
        { exitCode: processResult.meta.exitCode },
      );
    }

    const events = parseCodexJsonl(processResult.stdout);
    eventSummary = summarizeEvents(events);
    const aoMetaPath = path.join(artDir, "ao-process-meta.json");
    persistAoMeta(artDir, processResult, eventSummary, spawnOrdinal);
    const aoProcessMetaSha256 = sha256File(aoMetaPath);

    const extracted = extractChangeArtifact(events);
    // Post-AO clean custody gate BEFORE materialization (proves AO stayed read-only).
    assertPostAoCleanCustody({
      gitExecutablePath,
      worktreePath,
      repositoryPath,
      gitHome,
      expectedBaseRevision: runSpec.repository.expectedBaseRevision,
      before: custodyBefore,
    });

    const validated = validateChangeArtifact(extracted.artifact, allowedPath);
    const changeArtifactPath = path.join(artDir, "change-artifact.json");
    writeJsonReplace(changeArtifactPath, {
      path: validated.path,
      content: validated.content,
      contentBytes: validated.contentBytes,
    });
    const changeArtifactSha256 = sha256File(changeArtifactPath);

    materializeChangeArtifact(worktreePath, validated);

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
      || changedFiles[0].path !== allowedPath) {
      throw codedError(
        "D069_SCOPE_CHANGE",
        `expected exactly M ${allowedPath}, got ${JSON.stringify(changedFiles)}`,
      );
    }
    const scopeResult = checkScope(runSpec.scope, changedFiles);
    if (!scopeResult.ok) {
      throw codedError("D069_SCOPE_VIOLATION", scopeResult.detail, { scopeResult });
    }

    runGit(gitExecutablePath, worktreePath, ["add", "--", allowedPath], gitHome);
    runGit(
      gitExecutablePath,
      worktreePath,
      ["commit", "-m", `d070 verified attempt ${authReqHex}`],
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
      validationCmd.argv,
      worktreePath,
      validationCmd.timeoutSeconds,
      boundValidation.validationEnv,
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
        changedFiles: [{ status: "M", path: allowedPath }],
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
      aoProcessMetaSha256,
      changeArtifactSha256,
      changeArtifactSchemaSha256,
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
      aoProcessMetaSha256,
      changeArtifactSha256,
      changeArtifactSchemaSha256,
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
