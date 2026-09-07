"use strict";

const path = require("node:path");

const { domainDigest } = require("./contracts/digest");
const { ConfigError } = require("./errors");
const {
  attemptInputKey,
  toolSurfaceDigest,
  validationEnvironmentDigest,
  validationKey,
} = require("./execution-identity");
const {
  assertPlanBinding,
  compileCandidateMaterialization,
  reconcileCandidateMaterialization,
} = require("./candidate-materialization");
const { isExternalOpenResult } = require("./devspace-proposal-host");
const { throwIfDrainRequested } = require("./ephemeral-structured-model");
const {
  assertEnteredPermitCapability,
  assertExecutionPermitCurrent,
  dirtyManifestDigest,
  enterExecutionAttempt,
  enterRunAttempt,
  issueExecutionPermit,
  readAttemptEntriesForSession,
  readEnteredAttemptPermit,
  validateAttemptEntry,
} = require("./execution-permit");
const { recordExecutionClosure } = require("./execution-closure");
const { assertProductDirectionUnchanged } = require("./product-direction");
const { writeJsonAtomic } = require("./paths");
const { recordMeansFailure } = require("./means-circuit");
const { appendRunEvent, readRunJournal, runIdForSession } = require("./run-journal");
const { ensureRepositoryIdentity, runtimeCapabilityDigest } = require("./runtime-identity");
const {
  assertProposalDispatchBinding,
  assertProposalDispatchReceiptBinding,
  assertProposalDispatchResultBinding,
  assertRecoveredProposalDispatchBinding,
  proposalDispatchIntentExists,
  readProposalDispatchIntent,
  readProposalDispatchReceipt,
  readProposalDispatchResult,
} = require("./proposal-dispatch");
const { prepareCodingModelRequest, runCodingWorker } = require("./coding-worker");
const { validateWorkerResult } = require("./worker-result");
const { runForwardMotionChallenger } = require("./work-forward-motion");
const {
  assertWorkerStopBoundaryCurrent,
  recordForwardMotionProof,
  recordWorkerStop,
  stopBoundaryEvidence,
} = require("./work-forward-motion-record");
const { materializeWorkerOperations } = require("./work-materializer");
const {
  persistProductProof,
  productProofFailureText,
  readProductProof,
} = require("./work-product-proof");
const { assertVerifierAvailable, verifyCandidate, verifyProductProof } = require("./work-verifier");
const { assertProductProofSpecAuthority } = require("./work-proof-compiler");
const {
  assertCandidateSealCurrent,
  captureWorkspaceBoundary,
  commonGitDirectory,
  createImmutableRunSnapshot,
  deliverValidatedChanges,
  pathAllowed,
  persistWorkSession,
  prepareWorkspace,
  proveBankedCandidate,
  publishBankedChangesJournaled,
  resolveActiveWorkspaceContinuation,
  sealCandidate,
  acceptCandidate,
  worktreePlan,
} = require("./work-git");
const {
  acquireWorkspaceExecutionLease,
  advanceWorkspaceGeneration,
  assertWorkspaceCustodyExecutable,
  assertWorkspaceExecutionLease,
  readWorkspaceCustody,
  releaseWorkspaceExecutionLease,
  terminalizeWorkspaceCustody,
} = require("./workspace-custody");

const DRAIN_COMPLETE = Object.freeze({ control: "DRAIN_COMPLETE" });

function isDrainCompleteResult(value) {
  return value?.control === DRAIN_COMPLETE.control;
}

function externalDispatchExists(workspace) {
  return proposalDispatchIntentExists({
    workspaceRegistryDir: workspace.registryDir,
    workspaceId: workspace.workspaceId,
    generation: workspace.generation,
  });
}

function fail(code, message, details) {
  throw new ConfigError(message, { code, details });
}

function captureBoundary(workspacePath, allowedPaths) {
  return captureWorkspaceBoundary(workspacePath, allowedPaths);
}

function persistMutationCheckpoint({
  snapshotter,
  journalAppender,
  journalReader,
  journalGitDirectory,
  runId,
  repositoryIdentity,
  runtimeDigest,
  workspace,
  session,
  boundary,
  materializedPaths,
  attemptEntry = null,
  source,
  env = process.env,
}) {
  const snapshot = snapshotter({
    repositoryPath: workspace.repositoryRoot,
    workspacePath: workspace.workspacePath,
    sessionDigest: session.sessionDigest,
    workspaceId: workspace.workspaceId,
    generation: workspace.generation,
    treeOid: boundary.treeOid,
    parentOid: session.base.commit,
    env,
  });
  const existing = journalReader({ gitCommonDirectory: journalGitDirectory, runId })
    .find((entry) => entry.type === "mutation/result"
      && entry.data?.generation === workspace.generation
      && entry.data?.treeOid === snapshot.treeOid
      && entry.data?.snapshotOid === snapshot.snapshotOid);
  const event = existing || journalAppender({
    gitCommonDirectory: journalGitDirectory,
    runId,
    type: "mutation/result",
    data: {
      repositoryId: repositoryIdentity.repositoryId,
      runtimeCapabilityDigest: runtimeDigest,
      sessionDigest: session.sessionDigest,
      workspaceId: workspace.workspaceId,
      generation: workspace.generation,
      attemptEntryDigest: attemptEntry?.entryDigest || null,
      source,
      materializedPaths: [...materializedPaths],
      snapshotOid: snapshot.snapshotOid,
      snapshotDigest: snapshot.snapshotDigest,
      treeOid: snapshot.treeOid,
    },
  });
  if (event.data.snapshotOid !== snapshot.snapshotOid) {
    fail("MH_RUN_JOURNAL_SNAPSHOT", "journaled mutation does not reference the durable snapshot");
  }
  return Object.freeze({ snapshot, event });
}

function assertBoundaryPreserved(before, workspacePath, allowedPaths) {
  const after = captureBoundary(workspacePath, allowedPaths);
  if (after.head !== before.head) {
    fail("MH_WORK_BOUNDARY_HEAD", "coding worker changed HEAD; commits and resets are not authorized");
  }
  if (after.branch !== before.branch) {
    fail("MH_WORK_BOUNDARY_BRANCH", "coding worker changed the current branch");
  }
  if (after.indexDiff !== before.indexDiff) {
    fail("MH_WORK_BOUNDARY_INDEX", "coding worker changed the Git index; staging is not authorized");
  }
  const outside = after.inspected.entries.filter((entry) => {
    if (!pathAllowed(entry.path, allowedPaths)) return true;
    return entry.originalPath ? !pathAllowed(entry.originalPath, allowedPaths) : false;
  });
  if (outside.length > 0) {
    fail("MH_WORK_BOUNDARY_PATH", "coding worker changed files outside the accepted path boundary", {
      paths: outside.map((entry) => entry.path),
    });
  }
  return after;
}

function assertWorkerBoundaryPreserved(before, workspacePath, allowedPaths) {
  const after = assertBoundaryPreserved(before, workspacePath, allowedPaths);
  if (after.dirtyManifestDigest !== before.dirtyManifestDigest || after.treeOid !== before.treeOid) {
    fail("MH_WORK_BOUNDARY_BYTES", "coding worker changed workspace bytes; the worker is read-only and may only return typed operations");
  }
  return after;
}

function validationFailureText(results) {
  return results
    .filter((result) => !result.passed)
    .map((result) => `${JSON.stringify(result.argv)} exited ${result.exitCode}: ${result.output || "no output"}`)
    .join("\n");
}

function changedPaths(inspected) {
  return [...new Set(inspected.entries.flatMap((entry) => [entry.path, entry.originalPath].filter(Boolean)))].sort();
}

function validationDigest(verification, results) {
  return verification?.verificationDigest || domainDigest("meta-harness-work-validation/v1", results);
}

function jsonEventCount(text) {
  let count = 0;
  for (const line of String(text || "").split(/\r?\n/u)) {
    if (!line.trim()) continue;
    try {
      JSON.parse(line);
      count += 1;
    } catch (_) {}
  }
  return count;
}

function operationMetrics(operations) {
  const types = { WRITE: 0, DELETE: 0, MOVE: 0 };
  let writeBytes = 0;
  for (const operation of operations || []) {
    if (Object.prototype.hasOwnProperty.call(types, operation.type)) types[operation.type] += 1;
    if (operation.type === "WRITE") writeBytes += Buffer.byteLength(operation.content || "", "utf8");
  }
  return { operationCount: (operations || []).length, writeBytes, operationTypes: types };
}

function verificationEvidence(verification) {
  if (!verification) return null;
  return {
    schemaVersion: verification.schemaVersion,
    isolation: verification.isolation,
    candidateTreeOid: verification.candidateTreeOid,
    verificationDigest: verification.verificationDigest,
  };
}

function acceptanceEvidence(acceptance) {
  if (!acceptance) return null;
  return {
    schemaVersion: acceptance.schemaVersion,
    candidateTreeOid: acceptance.candidateTreeOid,
    verificationDigest: acceptance.verificationDigest,
    acceptanceDigest: acceptance.acceptanceDigest,
  };
}

function workMetrics(workspace, attemptMetrics, startedMs, completedMs) {
  return {
    schemaVersion: "work-metrics/v1",
    continuation: workspace.created ? "NEW" : "RESUME",
    elapsedMs: Math.max(0, completedMs - startedMs),
    firstProposalMs: attemptMetrics[0]?.proposalMs ?? null,
    workerMs: attemptMetrics.reduce((sum, item) => sum + item.proposalMs, 0),
    verifierMs: attemptMetrics.reduce((sum, item) => sum + item.verifierMs, 0),
    validationCommandMs: attemptMetrics.reduce((sum, item) => sum + item.validationCommandMs, 0),
    repairAttempts: Math.max(0, workspace.generation - 1),
    workerJsonEvents: attemptMetrics.reduce((sum, item) => sum + item.workerJsonEvents, 0),
    workerOutputBytes: attemptMetrics.reduce((sum, item) => sum + item.workerStdoutBytes + item.workerStderrBytes, 0),
    attempts: attemptMetrics.map((item) => ({ ...item })),
  };
}

function workResultDigest(result) {
  return domainDigest("meta-harness-work-result/v2", result);
}

function terminalStateFor({ outcome, delivery, finalBoundary }) {
  const banked = outcome === "DONE" || outcome === "BANKED_UNPROVEN";
  if (banked && ["committed", "no_changes"].includes(delivery?.commit?.status)) {
    return "TERMINAL_COMMITTED";
  }
  if (banked) return "TERMINAL_SEALED_DIRTY";
  if (outcome === "REPLAN_REQUIRED") return "TERMINAL_ABANDONED";
  return finalBoundary.inspected.entries.length > 0 ? "TERMINAL_BLOCKED_DIRTY" : "TERMINAL_BLOCKED";
}

function refreshExecutableCustody(workspace, session) {
  const custody = readWorkspaceCustody(workspace.registryDir, workspace.workspaceId);
  const boundary = captureBoundary(workspace.workspacePath, session.allowedPaths);
  assertWorkspaceCustodyExecutable({
    custody,
    sessionDigest: session.sessionDigest,
    repositoryRoot: workspace.repositoryRoot,
    workspacePath: workspace.workspacePath,
    branch: boundary.branch,
    baseHead: custody.baseHead,
    generation: custody.generation,
    dirtyManifestDigest: dirtyManifestDigest(boundary),
  });
  return { custody, boundary };
}

function recoverExternalProposalEvidence({
  workspace,
  session,
  attemptEntry,
  executionPermit = null,
  boundary,
  recovered = false,
}) {
  const intent = readProposalDispatchIntent({
    workspaceRegistryDir: workspace.registryDir,
    workspaceId: workspace.workspaceId,
    generation: attemptEntry.generation,
    optional: false,
  });
  const custody = readWorkspaceCustody(workspace.registryDir, workspace.workspaceId);
  const validatedIntent = recovered
    ? assertRecoveredProposalDispatchBinding({ intent, session, custody, attemptEntry, boundary })
    : assertProposalDispatchBinding({
        intent,
        session,
        custody,
        attemptEntry,
        executionPermit,
        boundary,
      });
  const receipt = readProposalDispatchReceipt({
    workspaceRegistryDir: workspace.registryDir,
    workspaceId: workspace.workspaceId,
    generation: attemptEntry.generation,
    optional: true,
  });
  const validatedReceipt = assertProposalDispatchReceiptBinding(validatedIntent, receipt);
  const result = readProposalDispatchResult({
    workspaceRegistryDir: workspace.registryDir,
    workspaceId: workspace.workspaceId,
    generation: attemptEntry.generation,
    optional: true,
  });
  return Object.freeze({
    intent: validatedIntent,
    receipt: validatedReceipt,
    result: assertProposalDispatchResultBinding(validatedIntent, validatedReceipt, result),
  });
}

function recoverMaterializingExternalEvidence({ workspace, session, continuation, workspaceLease }) {
  const attemptEntry = continuation.attemptEntry;
  const intent = readProposalDispatchIntent({
    workspaceRegistryDir: workspace.registryDir,
    workspaceId: workspace.workspaceId,
    generation: attemptEntry.generation,
    optional: false,
  });
  const receipt = readProposalDispatchReceipt({
    workspaceRegistryDir: workspace.registryDir,
    workspaceId: workspace.workspaceId,
    generation: attemptEntry.generation,
    optional: false,
  });
  const result = readProposalDispatchResult({
    workspaceRegistryDir: workspace.registryDir,
    workspaceId: workspace.workspaceId,
    generation: attemptEntry.generation,
    optional: false,
  });
  const validatedReceipt = assertProposalDispatchReceiptBinding(intent, receipt);
  const validatedResult = assertProposalDispatchResultBinding(intent, validatedReceipt, result);
  const expectedClaimDigest = session?.origin?.type === "REPO_OUTCOME" ? session.origin.claimDigest : null;
  const executionIdentityMismatch = session?.origin?.type === "REPO_RUN"
    ? intent.authority.attemptInputKey !== attemptEntry.attemptInputKey
    : intent.authority.permitDigest !== attemptEntry.permitDigest;
  if (!["REPO_RUN", "REPO_OUTCOME"].includes(session?.origin?.type)
      || intent.authority.sessionDigest !== session.sessionDigest
      || intent.authority.claimDigest !== expectedClaimDigest
      || intent.authority.outcomeDigest !== session.origin.outcomeDigest
      || intent.authority.workspaceId !== workspace.workspaceId
      || intent.authority.generation !== continuation.custody.generation
      || intent.authority.attemptEntryDigest !== attemptEntry.entryDigest
      || executionIdentityMismatch) {
    fail("MH_PROPOSAL_DISPATCH_STALE", "materializing external proposal no longer matches the active run/session/workspace identity");
  }
  assertWorkspaceExecutionLease({
    registryDir: workspace.registryDir,
    lease: workspaceLease,
    workspaceId: workspace.workspaceId,
  });
  const materialization = assertPlanBinding(continuation.materialization, {
    resultRecordDigest: validatedResult.resultRecordDigest,
    sessionDigest: session.sessionDigest,
    workspaceId: workspace.workspaceId,
    generation: continuation.custody.generation,
    attemptEntryDigest: attemptEntry.entryDigest,
    baselineTreeOid: intent.request.packet.baseline.treeOid,
  });
  return Object.freeze({
    intent,
    receipt: validatedReceipt,
    result: validatedResult,
    materialization,
  });
}

function externalOpenControl({ workspace, session, evidence, hostError = null }) {
  return Object.freeze({
    control: "EXTERNAL_OPEN",
    sessionDigest: session.sessionDigest,
    workspaceId: workspace.workspaceId,
    generation: evidence.intent.authority.generation,
    packetDigest: evidence.intent.request.packet.packetDigest,
    intentDigest: evidence.intent.intentDigest,
    receiptDigest: evidence.receipt?.receiptDigest || null,
    hostError,
  });
}

function missingValidationResult(session, repositoryPath) {
  return {
    schemaVersion: "work-result/v2",
    outcome: "REPLAN_REQUIRED",
    productResult: session.productResult,
    currentState: session.journeyState,
    observableResult: "No controller-owned validation command is sealed for this work session.",
    workspace: {
      mode: "not_created",
      path: path.resolve(repositoryPath),
      branch: null,
      created: false,
    },
    changedPaths: [],
    validation: [],
    verification: null,
    acceptance: null,
    metrics: null,
    delivery: {
      validation: "unavailable",
      commit: { status: "not_attempted" },
      push: { status: "not_attempted" },
    },
    blocker: "No deterministic validation command could be derived from the sealed base tree.",
    nextAction: "Derive or select a supported validation route, then retry this same product result.",
    attempts: 0,
    sessionDigest: session.sessionDigest,
    executionAttempts: [],
    forwardMotionProofDigest: null,
  };
}

function dryRunResult(session, plan) {
  return {
    schemaVersion: "work-result/v2",
    outcome: "READY",
    productResult: session.productResult,
    currentState: plan.reason,
    observableResult: "The coding session is bound and ready to execute.",
    workspace: {
      mode: plan.mode,
      path: plan.workspacePath,
      branch: plan.branch,
      wouldCreate: plan.wouldCreate,
    },
    changedPaths: [],
    validation: [],
    verification: null,
    acceptance: null,
    metrics: null,
    delivery: {
      validation: "not_run",
      commit: { status: "automatic" },
      push: { status: session.delivery.push ? "authorized" : "not_authorized" },
    },
    blocker: "none",
    nextAction: "Run the same command without --dry-run.",
    attempts: 0,
    sessionDigest: session.sessionDigest,
    executionAttempts: [],
    forwardMotionProofDigest: null,
  };
}

async function runWork({
  repositoryPath,
  session,
  dryRun = false,
  timeoutSeconds,
  model,
  env = process.env,
  runner = runCodingWorker,
  forwardMotionRunner = runForwardMotionChallenger,
  snapshotter = createImmutableRunSnapshot,
  journalAppender = appendRunEvent,
  journalReader = readRunJournal,
  repositoryIdentityProvider = ensureRepositoryIdentity,
  runtimeDigestProvider = runtimeCapabilityDigest,
  onProgress = () => {},
  signal,
}) {
  if (signal?.aborted) return DRAIN_COMPLETE;
  if (session.validation.length === 0) {
    return missingValidationResult(session, repositoryPath);
  }
  const plan = worktreePlan(repositoryPath, session);
  if (dryRun) return dryRunResult(session, plan);
  throwIfDrainRequested(signal);
  assertVerifierAvailable();
  assertProductProofSpecAuthority({ repositoryPath, session, env });
  throwIfDrainRequested(signal);

  const startedMs = Date.now();
  const startedAt = new Date(startedMs).toISOString();
  let workspace = prepareWorkspace(repositoryPath, session, plan);
  const workspaceLease = acquireWorkspaceExecutionLease({
    registryDir: workspace.registryDir,
    workspaceId: workspace.workspaceId,
  });
  let state;
  let before;
  const runId = runIdForSession(session.sessionDigest);
  const journalGitDirectory = commonGitDirectory(workspace.repositoryRoot);
  const repositoryIdentity = repositoryIdentityProvider(journalGitDirectory);
  const runtimeDigest = runtimeDigestProvider(env);
  const surfaceDigest = toolSurfaceDigest(session, workspace.mode);
  const validationEnvDigest = validationEnvironmentDigest(runtimeDigest);
  try {
    state = persistWorkSession(repositoryPath, session, workspace);
    before = captureBoundary(workspace.workspacePath, session.allowedPaths);
    if (!journalReader({ gitCommonDirectory: journalGitDirectory, runId })
      .some((event) => event.type === "run/started")) {
      journalAppender({
        gitCommonDirectory: journalGitDirectory,
        runId,
        type: "run/started",
        data: {
          repositoryId: repositoryIdentity.repositoryId,
          runtimeCapabilityDigest: runtimeDigest,
          toolSurfaceDigest: surfaceDigest,
          startingAttemptInputKey: attemptInputKey({
            session,
            snapshotTreeOid: before.treeOid,
            runtimeCapabilityDigest: runtimeDigest,
            workspaceMode: workspace.mode,
          }),
          validationEnvironmentDigest: validationEnvDigest,
          sessionDigest: session.sessionDigest,
          workspaceId: workspace.workspaceId,
          baseSnapshotOid: session.base.commit,
          baseTreeOid: before.treeOid,
        },
      });
    }
  } catch (error) {
    releaseWorkspaceExecutionLease({ registryDir: workspace.registryDir, lease: workspaceLease });
    throw error;
  }
  let agentResult = null;
  let validations = [];
  let verification = null;
  let candidateAcceptance = null;
  let productProof = null;
  const repairContextEvent = [...journalReader({ gitCommonDirectory: journalGitDirectory, runId })]
    .reverse()
    .find((event) => event.type === "integration/repair-context") || null;
  let priorFailure = repairContextEvent
    ? `Previous integration against the current product state failed (${repairContextEvent.data.reason}): ${repairContextEvent.data.detail}. Repair the same product result while preserving already-landed behavior.`
    : "";
  let attempts = 0;
  let candidateSeal = null;
  let forwardMotionProof = null;
  let interruptedNoSeal = false;
  let lastValidationKey = null;
  const attemptEntries = [...readAttemptEntriesForSession({
    repositoryPath: workspace.repositoryRoot,
    session,
    workspaceId: workspace.workspaceId,
  })];
  const runCapabilityForNewAttempts = ["REPO_RUN", "OWNER_GOAL"].includes(session.origin.type);

  function isRunCapabilityAttempt(entry) {
    return entry?.schemaVersion === "attempt-entry/v2" && entry?.mechanism === "RUN_CAPABILITY";
  }

  function permitForAttempt(entry) {
    return isRunCapabilityAttempt(entry) ? null : readEnteredAttemptPermit(state.directory, entry);
  }

  function attemptProjection(entry) {
    const validatedEntry = validateAttemptEntry(entry);
    if (isRunCapabilityAttempt(validatedEntry)) {
      return {
        mechanism: "RUN_CAPABILITY",
        permitId: null,
        attemptId: validatedEntry.attemptId,
        generation: validatedEntry.generation,
        permitDigest: null,
        attemptInputKey: validatedEntry.attemptInputKey,
        attemptEntryDigest: validatedEntry.entryDigest,
        state: "ENTERED",
      };
    }
    const permit = readEnteredAttemptPermit(state.directory, validatedEntry);
    return {
      mechanism: "EXECUTION_PERMIT",
      permitId: permit.permitId,
      attemptId: permit.attemptId,
      generation: permit.generation,
      permitDigest: permit.permitDigest,
      attemptInputKey: null,
      attemptEntryDigest: validatedEntry.entryDigest,
      state: "ENTERED",
    };
  }

  function assertAttemptCurrent({
    executionPermit,
    attemptEntry,
    custody,
    boundary,
    capability = null,
    checkCurrent = false,
    requireInitialDirtyManifest = false,
  }) {
    const entry = validateAttemptEntry(attemptEntry);
    if (!isRunCapabilityAttempt(entry)) {
      if (capability) {
        assertEnteredPermitCapability({
          stateDirectory: state.directory,
          permit: executionPermit,
          attemptEntry: entry,
          capability,
        });
      }
      if (checkCurrent || requireInitialDirtyManifest) {
        return assertExecutionPermitCurrent({
          permit: executionPermit,
          session,
          repositoryRoot: workspace.repositoryRoot,
          workspacePath: workspace.workspacePath,
          workspaceCustody: custody,
          workspaceLease,
          workspaceRegistryDir: workspace.registryDir,
          boundary,
          requireInitialDirtyManifest,
        });
      }
      return entry;
    }

    assertProductDirectionUnchanged(session.productDirection, workspace.repositoryRoot);
    assertWorkspaceExecutionLease({
      registryDir: workspace.registryDir,
      lease: workspaceLease,
      workspaceId: workspace.workspaceId,
    });
    if (entry.sessionDigest !== session.sessionDigest
        || entry.workspaceId !== workspace.workspaceId
        || entry.generation !== workspace.generation
        || custody.state !== "ACTIVE"
        || custody.sessionDigest !== session.sessionDigest
        || custody.workspaceId !== workspace.workspaceId
        || custody.generation !== workspace.generation
        || boundary.head !== session.base.commit
        || boundary.branch !== custody.branch) {
      fail("MH_RUN_CAPABILITY_STALE", "claimless run capability no longer matches the active session/workspace boundary");
    }
    if (capability === "CONTROLLER_PUSH" && !session.delivery.push) {
      fail("MH_RUN_CAPABILITY_DENIED", "claimless run does not include publication capability");
    }
    if (requireInitialDirtyManifest) {
      const observedInputKey = attemptInputKey({
        session,
        snapshotTreeOid: boundary.treeOid,
        runtimeCapabilityDigest: runtimeDigest,
        workspaceMode: workspace.mode,
      });
      if (observedInputKey !== entry.attemptInputKey) {
        fail("MH_RUN_CAPABILITY_STALE", "claimless run input changed before model execution");
      }
    }
    return entry;
  }

  const executionAttempts = attemptEntries.map(attemptProjection);
  const attemptMetrics = [];

  function setCustody(custody) {
    workspace = { ...workspace, custody, generation: custody.generation };
    return custody;
  }

  function checkpointMutation({ boundary, materializedPaths, attemptEntry, source }) {
    return persistMutationCheckpoint({
      snapshotter,
      journalAppender,
      journalReader,
      journalGitDirectory,
      runId,
      repositoryIdentity,
      runtimeDigest,
      workspace,
      session,
      boundary,
      materializedPaths,
      attemptEntry,
      source,
      env,
    });
  }

  function recordFailedMeans({ meansKind, failureClass, seal = candidateSeal, exactInput = null }) {
    let input = exactInput;
    if (input === null) {
      if (!seal?.candidateTreeOid) {
        fail("MH_MEANS_CIRCUIT", "failed means must bind an exact candidate tree or explicit exact input");
      }
      input = meansKind === "VALIDATE_CANDIDATE"
        ? { candidateTreeOid: seal.candidateTreeOid, validation: session.validation }
        : { candidateTreeOid: seal.candidateTreeOid, productProofSpecDigest: session.productProofSpec.specDigest };
    }
    return recordMeansFailure({
      gitCommonDirectory: journalGitDirectory,
      runId,
      meansKind,
      exactInput: input,
      runtimeCapabilityDigest: runtimeDigest,
      failureClass,
    });
  }

  function recordStoppedMeans(workerStop) {
    return recordFailedMeans({
      meansKind: "WORKER_STOP",
      failureClass: "WORKER_STOP",
      exactInput: {
        treeOid: workerStop.endBoundary.treeOid,
        unsatisfiedRequirement: workerStop.workerResult.stop.unsatisfiedRequirement,
        failedMeans: workerStop.workerResult.stop.failedMeans,
        assertedConstraint: workerStop.workerResult.stop.assertedConstraint,
      },
    });
  }

  function fallbackForwardMotionCandidate(workerStop, error) {
    const stop = workerStop.workerResult.stop;
    return {
      disposition: "REPLAN_REQUIRED",
      failedMeans: stop.failedMeans,
      alternatives: stop.alternativesConsidered.map((entry) => ({ ...entry, requiredPaths: [] })),
      hardConstraint: null,
      ownerRequest: null,
      disprovedAssertions: [`Forward-motion challenger did not establish terminal authority (${error?.code || "invalid challenger output"}); autonomous replan is required.`],
    };
  }

  async function resolveForwardMotion(workerStop, existingProof = null) {
    if (existingProof) return existingProof;
    throwIfDrainRequested(signal);
    const stem = `${session.sessionDigest.slice("sha256:".length)}.${workspace.workspaceId}.generation-${workerStop.generation}`;
    let candidate;
    try {
      const challenged = await forwardMotionRunner({
        workspacePath: workspace.workspacePath,
        session,
        workerStop,
        schemaPath: path.join(state.directory, `${stem}.forward-motion.schema.json`),
        outputPath: path.join(state.directory, `${stem}.forward-motion.json`),
        timeoutSeconds: Math.min(timeoutSeconds || 300, 300),
        model,
        env,
        signal,
      });
      throwIfDrainRequested(signal);
      candidate = challenged?.candidate || challenged;
      return recordForwardMotionProof({ repositoryPath: workspace.repositoryRoot, workerStop, session, candidate });
    } catch (error) {
      if (error?.code === "MH_DRAIN_REQUESTED") throw error;
      candidate = fallbackForwardMotionCandidate(workerStop, error);
      return recordForwardMotionProof({ repositoryPath: workspace.repositoryRoot, workerStop, session, candidate });
    }
  }

  function alternativeGuidance(proof) {
    const alternative = proof.alternatives.find((entry) => entry.disposition === "AVAILABLE");
    return `The previous route failed but is not a hard blocker. Continue the same sealed Outcome using this permissible alternative: ${alternative.means}. Evidence: ${alternative.evidence.join("; ")}`;
  }

  function terminalOutcomeForProof() {
    // Forward-motion proofs are execution observations, including legacy terminal labels.
    // Owner/product terminal conclusions require deterministic controller/effect evidence.
    return "REPLAN_REQUIRED";
  }

  function advanceAfterWorkerStop(workerStop) {
    const currentBoundary = captureBoundary(workspace.workspacePath, session.allowedPaths);
    assertWorkerStopBoundaryCurrent(workerStop, stopBoundaryEvidence(currentBoundary));
    const current = readWorkspaceCustody(workspace.registryDir, workspace.workspaceId);
    return setCustody(advanceWorkspaceGeneration({
      registryDir: workspace.registryDir,
      custody: current,
      workspaceLease,
      expectedDirtyManifestDigest: workerStop.endBoundary.dirtyManifestDigest,
    }));
  }

  function terminalizeResult(result, delivery, finalBoundary) {
    const current = readWorkspaceCustody(workspace.registryDir, workspace.workspaceId);
    if (current.state !== "ACTIVE") {
      fail("MH_WORKSPACE_CUSTODY_CONFLICT", `workspace terminalized unexpectedly as ${current.state}`);
    }
    const terminalState = terminalStateFor({ outcome: result.outcome, delivery, finalBoundary });
    result.workspace.state = terminalState;
    const terminal = terminalizeWorkspaceCustody({
      registryDir: workspace.registryDir,
      custody: current,
      workspaceLease,
      terminalState,
      resultDigest: workResultDigest(result),
      validationDigest: validationDigest(verification, validations),
      finalDirtyManifestDigest: dirtyManifestDigest(finalBoundary),
      changedPathHashes: {},
      commitSha: delivery?.commit?.sha || (terminalState === "TERMINAL_COMMITTED" ? finalBoundary.head : null),
    });
    setCustody(terminal);
    persistWorkSession(repositoryPath, session, workspace);
    return terminal;
  }

  function settleControlledDrain() {
    const current = readWorkspaceCustody(workspace.registryDir, workspace.workspaceId);
    if (current.state !== "ACTIVE") return DRAIN_COMPLETE;
    const continuation = resolveActiveWorkspaceContinuation(workspace.repositoryRoot, session, current);
    if (["BASELINE", "SEALED_CANDIDATE", "WORKER_STOP", "MATERIALIZING"].includes(continuation.kind)) {
      return DRAIN_COMPLETE;
    }
    if (continuation.kind === "ENTERED_NO_SEAL" && externalDispatchExists(workspace)) {
      return DRAIN_COMPLETE;
    }
    if (continuation.kind !== "ENTERED_NO_SEAL") {
      fail("MH_WORK_DRAIN_STATE", `unsupported controlled-drain continuation: ${continuation.kind}`);
    }
    const finalBoundary = captureBoundary(workspace.workspacePath, session.allowedPaths);
    const closure = recordExecutionClosure({
      repositoryPath,
      session,
      attemptEntries,
      disposition: "INTERRUPTED_AFTER_ENTRY",
      workResult: null,
    });
    const terminal = terminalizeWorkspaceCustody({
      registryDir: workspace.registryDir,
      custody: current,
      workspaceLease,
      terminalState: "TERMINAL_ABANDONED",
      resultDigest: domainDigest("meta-harness-work-drain-abandon/v1", {
        sessionDigest: session.sessionDigest,
        workspaceId: workspace.workspaceId,
        generation: current.generation,
        closureDigest: closure?.closureDigest || null,
      }),
      validationDigest: validationDigest(verification, validations),
      finalDirtyManifestDigest: dirtyManifestDigest(finalBoundary),
      changedPathHashes: {},
      commitSha: finalBoundary.head !== current.baseHead ? finalBoundary.head : null,
    });
    setCustody(terminal);
    persistWorkSession(repositoryPath, session, workspace);
    return DRAIN_COMPLETE;
  }

  try {
    onProgress("working");
    const startingContinuation = resolveActiveWorkspaceContinuation(
      workspace.repositoryRoot,
      session,
      readWorkspaceCustody(workspace.registryDir, workspace.workspaceId),
    );
    assertWorkspaceExecutionLease({
      registryDir: workspace.registryDir,
      lease: workspaceLease,
      workspaceId: workspace.workspaceId,
    });
    if (startingContinuation.kind === "ENTERED_NO_SEAL" && !externalDispatchExists(workspace)) {
      attempts = startingContinuation.custody.generation;
      interruptedNoSeal = true;
      agentResult = {
        observableResult: "No durable candidate or STOP was sealed before the controller interruption.",
      };
    } else for (let attempt = startingContinuation.custody.generation; attempt <= session.maxAttempts; attempt += 1) {
      attempts = attempt;
      const continuation = resolveActiveWorkspaceContinuation(
        workspace.repositoryRoot,
        session,
        readWorkspaceCustody(workspace.registryDir, workspace.workspaceId),
      );
      let custody = setCustody(continuation.custody);
      assertWorkspaceExecutionLease({
        registryDir: workspace.registryDir,
        lease: workspaceLease,
        workspaceId: workspace.workspaceId,
      });
      let executionPermit;
      let attemptEntry;
      let attemptMetric;
      let after;
      let liveCustodyAfterMaterialize;

      throwIfDrainRequested(signal);
      if (continuation.kind === "WORKER_STOP") {
        executionPermit = permitForAttempt(continuation.attemptEntry);
        attemptEntry = continuation.attemptEntry;
        agentResult = continuation.workerStop.workerResult;
        attemptMetric = {
          attempt,
          generation: custody.generation,
          proposalMs: 0,
          verifierMs: 0,
          validationCommandMs: 0,
          worker: "recovered-worker-stop",
          workerStdoutBytes: 0,
          workerStderrBytes: 0,
          workerJsonEvents: 0,
          ...operationMetrics([]),
        };
        attemptMetrics.push(attemptMetric);
        forwardMotionProof = await resolveForwardMotion(continuation.workerStop, continuation.forwardMotionProof);
        if (forwardMotionProof.disposition === "CONTINUE_WITH_ALTERNATIVE" && attempt < session.maxAttempts) {
          const circuit = recordStoppedMeans(continuation.workerStop);
          if (!circuit.open) {
            priorFailure = alternativeGuidance(forwardMotionProof);
            advanceAfterWorkerStop(continuation.workerStop);
            continue;
          }
        }
        break;
      }

      if (continuation.kind === "SEALED_CANDIDATE") {
        executionPermit = permitForAttempt(continuation.attemptEntry);
        attemptEntry = continuation.attemptEntry;
        candidateSeal = continuation.candidateSeal;
        productProof = continuation.productProof;
        agentResult = agentResult || {
          observableResult: "Recovered and completed the exact sealed candidate after controller interruption.",
        };
        attemptMetric = {
          attempt,
          generation: custody.generation,
          proposalMs: 0,
          verifierMs: 0,
          validationCommandMs: 0,
          worker: "recovered-sealed-candidate",
          workerStdoutBytes: 0,
          workerStderrBytes: 0,
          workerJsonEvents: 0,
          ...operationMetrics([]),
        };
        attemptMetrics.push(attemptMetric);
        after = captureBoundary(workspace.workspacePath, session.allowedPaths);
        liveCustodyAfterMaterialize = custody;
        if (isRunCapabilityAttempt(attemptEntry)) {
          assertAttemptCurrent({ executionPermit, attemptEntry, custody, boundary: after, capability: "CONTROLLER_VALIDATE" });
        } else {
          assertEnteredPermitCapability({ stateDirectory: state.directory, permit: executionPermit, attemptEntry, capability: "CONTROLLER_VALIDATE" });
        }
      } else if (["ENTERED_NO_SEAL", "MATERIALIZING"].includes(continuation.kind) && externalDispatchExists(workspace)) {
        productProof = null;
        candidateAcceptance = null;
        verification = null;
        validations = [];
        executionPermit = permitForAttempt(continuation.attemptEntry);
        attemptEntry = continuation.attemptEntry;
        let evidence;
        let attemptBoundary = null;
        let materialization = null;
        if (continuation.kind === "MATERIALIZING") {
          evidence = recoverMaterializingExternalEvidence({
            workspace,
            session,
            continuation,
            workspaceLease,
          });
          materialization = evidence.materialization;
        } else {
          attemptBoundary = captureBoundary(workspace.workspacePath, session.allowedPaths);
          evidence = recoverExternalProposalEvidence({
            workspace,
            session,
            attemptEntry,
            boundary: attemptBoundary,
            recovered: true,
          });
          if (!evidence.result) {
            return externalOpenControl({ workspace, session, evidence });
          }
        }
        if (!evidence.result) {
          fail("MH_PROPOSAL_DISPATCH_SETTLEMENT", "materialization requires the exact captured proposal result");
        }
        agentResult = validateWorkerResult(evidence.result.workerResult);
        const proposal = operationMetrics(agentResult.operations);
        attemptMetric = {
          attempt,
          generation: custody.generation,
          proposalMs: 0,
          verifierMs: 0,
          validationCommandMs: 0,
          worker: continuation.kind === "MATERIALIZING" ? "recovered-external-materialization" : "recovered-external-proposal",
          workerStdoutBytes: 0,
          workerStderrBytes: 0,
          workerJsonEvents: 0,
          ...proposal,
        };
        attemptMetrics.push(attemptMetric);

        if (agentResult.status === "STOP") {
          if (continuation.kind === "MATERIALIZING" || !attemptBoundary) {
            fail("MH_PROPOSAL_DISPATCH_SETTLEMENT", "worker STOP cannot coexist with a candidate materialization target");
          }
          throwIfDrainRequested(signal);
          const workerStop = recordWorkerStop({
            repositoryPath: workspace.repositoryRoot,
            session,
            workspace,
            attemptEntry,
            startBoundary: stopBoundaryEvidence(attemptBoundary),
            endBoundary: stopBoundaryEvidence(attemptBoundary),
            workerResult: agentResult,
          });
          forwardMotionProof = await resolveForwardMotion(workerStop);
          if (forwardMotionProof.disposition === "CONTINUE_WITH_ALTERNATIVE" && attempt < session.maxAttempts) {
            const circuit = recordStoppedMeans(workerStop);
            if (!circuit.open) {
              priorFailure = alternativeGuidance(forwardMotionProof);
              advanceAfterWorkerStop(workerStop);
              continue;
            }
          }
          break;
        }

        throwIfDrainRequested(signal);
        assertWorkspaceExecutionLease({
          registryDir: workspace.registryDir,
          lease: workspaceLease,
          workspaceId: workspace.workspaceId,
        });
        assertAttemptCurrent({
          executionPermit,
          attemptEntry,
          custody,
          boundary: captureBoundary(workspace.workspacePath, session.allowedPaths),
          capability: "CONTROLLER_MATERIALIZE",
        });
        if (!materialization) {
          materialization = compileCandidateMaterialization({
            stateDirectory: state.directory,
            workspacePath: workspace.workspacePath,
            allowedPaths: session.allowedPaths,
            sessionDigest: session.sessionDigest,
            workspaceId: workspace.workspaceId,
            generation: custody.generation,
            attemptEntryDigest: attemptEntry.entryDigest,
            resultRecordDigest: evidence.result.resultRecordDigest,
            baselineTreeOid: evidence.intent.request.packet.baseline.treeOid,
            operations: agentResult.operations,
          });
        }
        let newlyMaterialized = [];
        if (materialization) {
          const reconciled = reconcileCandidateMaterialization({
            workspacePath: workspace.workspacePath,
            stateDirectory: state.directory,
            plan: materialization,
          });
          newlyMaterialized = reconciled.materializedPaths;
        }
        const materializedPaths = [...new Set([
          ...(continuation.retainedCandidatePaths || []),
          ...newlyMaterialized,
        ])].sort();
        after = assertBoundaryPreserved(before, workspace.workspacePath, session.allowedPaths);
        checkpointMutation({
          boundary: after,
          materializedPaths,
          attemptEntry,
          source: "external-proposal",
        });
        candidateSeal = sealCandidate({
          stateDirectory: state.directory,
          session,
          workspace,
          boundary: after,
          materializedPaths,
        });
        if (materialization && candidateSeal.candidateTreeOid !== materialization.targetTreeOid) {
          fail("MH_CANDIDATE_MATERIALIZATION_TARGET", "sealed candidate tree does not equal the durable materialization target tree");
        }
        liveCustodyAfterMaterialize = readWorkspaceCustody(workspace.registryDir, workspace.workspaceId);
        assertWorkspaceExecutionLease({
          registryDir: workspace.registryDir,
          lease: workspaceLease,
          workspaceId: workspace.workspaceId,
        });
        assertAttemptCurrent({
          executionPermit,
          attemptEntry,
          custody: liveCustodyAfterMaterialize,
          boundary: after,
          capability: "CONTROLLER_VALIDATE",
        });
      } else {
        productProof = null;
        candidateAcceptance = null;
        verification = null;
        validations = [];
        if (continuation.kind !== "BASELINE") {
          fail("MH_WORK_RESUME", `unsupported ACTIVE continuation state: ${continuation.kind}`);
        }
        if (!priorFailure && continuation.priorSeal) {
          const previousProof = readProductProof(
            state.directory,
            session.sessionDigest,
            workspace.workspaceId,
            custody.generation - 1,
            { optional: true },
          );
          priorFailure = productProofFailureText(previousProof)
            || "The previous sealed candidate failed controller validation; repair from the retained exact candidate bytes.";
        }
        const refreshed = refreshExecutableCustody(workspace, session);
        custody = setCustody(refreshed.custody);
        const attemptBoundary = refreshed.boundary;
        throwIfDrainRequested(signal);
        const currentAttemptInputKey = attemptInputKey({
          session,
          snapshotTreeOid: attemptBoundary.treeOid,
          runtimeCapabilityDigest: runtimeDigest,
          workspaceMode: workspace.mode,
        });
        if (runCapabilityForNewAttempts) {
          executionPermit = null;
          attemptEntry = enterRunAttempt({
            repositoryPath: workspace.repositoryRoot,
            session,
            workspaceId: workspace.workspaceId,
            generation: custody.generation,
            attemptInputKey: currentAttemptInputKey,
          });
          assertAttemptCurrent({
            executionPermit: null,
            attemptEntry,
            custody,
            boundary: attemptBoundary,
            requireInitialDirtyManifest: true,
          });
        } else {
          executionPermit = issueExecutionPermit({
            repositoryRoot: workspace.repositoryRoot,
            workspacePath: workspace.workspacePath,
            session,
            attempt,
            boundary: attemptBoundary,
            workspaceCustody: custody,
            workspaceLease,
            workspaceRegistryDir: workspace.registryDir,
            stateDirectory: state.directory,
          });
          attemptEntry = enterExecutionAttempt({
            stateDirectory: state.directory,
            permit: executionPermit,
            session,
            entryCapability: "CODE_PROPOSE",
          });
          assertAttemptCurrent({
            executionPermit,
            attemptEntry,
            custody,
            boundary: attemptBoundary,
            requireInitialDirtyManifest: true,
          });
        }
        attemptEntries.push(attemptEntry);
        executionAttempts.push(attemptProjection(attemptEntry));
        const preparedModelRequest = runner === runCodingWorker
          ? prepareCodingModelRequest({
              session,
              attempt,
              priorFailure,
              workspaceMode: workspace.mode,
              timeoutSeconds,
              model,
              env,
              runtimeCapabilityDigest: runtimeDigest,
              snapshotTreeOid: attemptBoundary.treeOid,
            })
          : null;
        const existingModelRequest = journalReader({ gitCommonDirectory: journalGitDirectory, runId })
          .find((event) => event.type === "model/request"
            && event.data?.attemptEntryDigest === attemptEntry.entryDigest);
        if (!existingModelRequest) {
          journalAppender({
            gitCommonDirectory: journalGitDirectory,
            runId,
            type: "model/request",
            data: {
              repositoryId: repositoryIdentity.repositoryId,
              runtimeCapabilityDigest: runtimeDigest,
              toolSurfaceDigest: surfaceDigest,
              capabilityProjectionDigest: preparedModelRequest?.capabilityProjectionDigest || null,
              attemptInputKey: currentAttemptInputKey,
              modelCommandDigest: preparedModelRequest?.modelCommandDigest || null,
              modelRequestKey: preparedModelRequest?.modelRequestKey || null,
              modelInvocation: preparedModelRequest?.invocation || null,
              sessionDigest: session.sessionDigest,
              workspaceId: workspace.workspaceId,
              generation: workspace.generation,
              attemptEntryDigest: attemptEntry.entryDigest,
              baselineTreeOid: attemptBoundary.treeOid,
              priorFailure: priorFailure || null,
            },
          });
        }
        const proposalStartedMs = Date.now();
        const run = await runner({
          repositoryPath: workspace.repositoryRoot,
          stateDirectory: state.directory,
          workspace,
          workspaceLease,
          attemptBoundary,
          workspacePath: workspace.workspacePath,
          session,
          schemaPath: state.schemaPath,
          outputPath: state.agentOutputPath,
          attempt,
          priorFailure,
          workspaceMode: workspace.mode,
          executionPermit,
          attemptEntry,
          runtimeCapabilityDigest: runtimeDigest,
          timeoutSeconds,
          model,
          env,
          signal,
          preparedModelRequest,
        });
        if (isExternalOpenResult(run)) {
          const afterWorker = assertWorkerBoundaryPreserved(attemptBoundary, workspace.workspacePath, session.allowedPaths);
          const liveCustodyAfterWorker = readWorkspaceCustody(workspace.registryDir, workspace.workspaceId);
          assertAttemptCurrent({
            executionPermit,
            attemptEntry,
            custody: liveCustodyAfterWorker,
            boundary: afterWorker,
            capability: "CODE_PROPOSE",
            requireInitialDirtyManifest: true,
          });
          const evidence = recoverExternalProposalEvidence({
            workspace,
            session,
            attemptEntry,
            executionPermit,
            boundary: afterWorker,
          });
          if (run.packetDigest !== evidence.intent.request.packet.packetDigest
              || run.intentDigest !== evidence.intent.intentDigest
              || (run.receiptDigest || null) !== (evidence.receipt?.receiptDigest || null)) {
            fail("MH_PROPOSAL_DISPATCH_SETTLEMENT", "external proposal runner control does not match durable dispatch evidence");
          }
          return externalOpenControl({
            workspace,
            session,
            evidence,
            hostError: run.hostError || null,
          });
        }
        throwIfDrainRequested(signal);
        agentResult = validateWorkerResult(run.result);
        if (!journalReader({ gitCommonDirectory: journalGitDirectory, runId })
          .some((event) => event.type === "model/response"
            && event.data?.attemptEntryDigest === attemptEntry.entryDigest)) {
          journalAppender({
            gitCommonDirectory: journalGitDirectory,
            runId,
            type: "model/response",
            data: {
              repositoryId: repositoryIdentity.repositoryId,
              runtimeCapabilityDigest: runtimeDigest,
              toolSurfaceDigest: surfaceDigest,
              capabilityProjectionDigest: preparedModelRequest?.capabilityProjectionDigest || null,
              attemptInputKey: currentAttemptInputKey,
              modelCommandDigest: preparedModelRequest?.modelCommandDigest || null,
              modelRequestKey: preparedModelRequest?.modelRequestKey || null,
              sessionDigest: session.sessionDigest,
              workspaceId: workspace.workspaceId,
              generation: workspace.generation,
              attemptEntryDigest: attemptEntry.entryDigest,
              worker: run.worker || "custom-runner",
              result: agentResult,
            },
          });
        }
        const proposal = operationMetrics(agentResult.operations);
        attemptMetric = {
          attempt,
          generation: attemptEntry.generation,
          proposalMs: Date.now() - proposalStartedMs,
          verifierMs: 0,
          validationCommandMs: 0,
          worker: run.worker || "custom-runner",
          workerStdoutBytes: Buffer.byteLength(String(run.stdout || ""), "utf8"),
          workerStderrBytes: Buffer.byteLength(String(run.stderr || ""), "utf8"),
          workerJsonEvents: jsonEventCount(run.stdout),
          ...proposal,
        };
        attemptMetrics.push(attemptMetric);
        const afterWorker = assertWorkerBoundaryPreserved(attemptBoundary, workspace.workspacePath, session.allowedPaths);
        const liveCustodyAfterWorker = readWorkspaceCustody(workspace.registryDir, workspace.workspaceId);
        assertAttemptCurrent({
          executionPermit,
          attemptEntry,
          custody: liveCustodyAfterWorker,
          boundary: afterWorker,
          requireInitialDirtyManifest: true,
        });
        if (agentResult.status === "STOP") {
          throwIfDrainRequested(signal);
          const workerStop = recordWorkerStop({
            repositoryPath: workspace.repositoryRoot,
            session,
            workspace,
            attemptEntry,
            startBoundary: stopBoundaryEvidence(attemptBoundary),
            endBoundary: stopBoundaryEvidence(afterWorker),
            workerResult: agentResult,
          });
          forwardMotionProof = await resolveForwardMotion(workerStop);
          if (forwardMotionProof.disposition === "CONTINUE_WITH_ALTERNATIVE" && attempt < session.maxAttempts) {
            const circuit = recordStoppedMeans(workerStop);
            if (!circuit.open) {
              priorFailure = alternativeGuidance(forwardMotionProof);
              advanceAfterWorkerStop(workerStop);
              continue;
            }
          }
          break;
        }

        throwIfDrainRequested(signal);
        assertAttemptCurrent({
          executionPermit,
          attemptEntry,
          custody: liveCustodyAfterWorker,
          boundary: afterWorker,
          capability: "CONTROLLER_MATERIALIZE",
        });
        const materializedPaths = [...new Set([
          ...(continuation.retainedCandidatePaths || []),
          ...materializeWorkerOperations(workspace.workspacePath, agentResult.operations, session.allowedPaths),
        ])].sort();
        after = assertBoundaryPreserved(before, workspace.workspacePath, session.allowedPaths);
        checkpointMutation({
          boundary: after,
          materializedPaths,
          attemptEntry,
          source: "coding-worker",
        });
        candidateSeal = sealCandidate({
          stateDirectory: state.directory,
          session,
          workspace,
          boundary: after,
          materializedPaths,
        });
        liveCustodyAfterMaterialize = readWorkspaceCustody(workspace.registryDir, workspace.workspaceId);
        assertAttemptCurrent({
          executionPermit,
          attemptEntry,
          custody: liveCustodyAfterMaterialize,
          boundary: after,
          capability: "CONTROLLER_VALIDATE",
          checkCurrent: true,
        });
      }
      onProgress("validating");
      throwIfDrainRequested(signal);
      const verifierStartedMs = Date.now();
      verification = verifyCandidate({
        workspacePath: workspace.workspacePath,
        dependencySourcePath: workspace.repositoryRoot,
        candidateSeal,
        commands: session.validation,
        env,
      });
      attemptMetric.verifierMs = Date.now() - verifierStartedMs;
      validations = verification.commands;
      attemptMetric.validationCommandMs = validations.reduce((sum, item) => sum + item.durationMs, 0);
      lastValidationKey = validationKey({
        candidateTreeOid: candidateSeal.candidateTreeOid,
        validation: session.validation,
        validationEnvironmentDigest: validationEnvDigest,
      });
      journalAppender({
        gitCommonDirectory: journalGitDirectory,
        runId,
        type: "validation/result",
        data: {
          repositoryId: repositoryIdentity.repositoryId,
          runtimeCapabilityDigest: runtimeDigest,
          validationEnvironmentDigest: validationEnvDigest,
          validationKey: lastValidationKey,
          sessionDigest: session.sessionDigest,
          workspaceId: workspace.workspaceId,
          generation: workspace.generation,
          candidateTreeOid: candidateSeal.candidateTreeOid,
          verificationDigest: verification.verificationDigest,
          passed: validations.length > 0 && validations.every((item) => item.passed),
          commands: validations.map((item) => ({
            argv: item.argv,
            cwd: item.cwd,
            passed: item.passed,
            exitCode: item.exitCode,
          })),
        },
      });
      const postValidationBoundary = assertBoundaryPreserved(before, workspace.workspacePath, session.allowedPaths);
      assertCandidateSealCurrent({
        workspacePath: workspace.workspacePath,
        stateDirectory: state.directory,
        seal: candidateSeal,
        code: "MH_WORK_VALIDATION_MUTATION",
      });
      const validationPassed = validations.length > 0 && validations.every((item) => item.passed);
      if (validationPassed) {
        if (!productProof) {
          const productProofStartedMs = Date.now();
          productProof = verifyProductProof({
            workspacePath: workspace.workspacePath,
            dependencySourcePath: workspace.repositoryRoot,
            session,
            candidateSeal,
            env,
          });
          attemptMetric.verifierMs += Date.now() - productProofStartedMs;
          persistProductProof(state.directory, productProof);
        }
        if (productProof.state === "FAILED") {
          const circuit = recordFailedMeans({
            meansKind: "PRODUCT_PROOF",
            failureClass: "PRODUCT_PROOF_FAILED",
          });
          priorFailure = productProofFailureText(productProof);
          if (circuit.open) {
            priorFailure = `${priorFailure}\nThis exact candidate/proof route failed repeatedly and is now exhausted; choose materially different means.`;
          } else if (attempt < session.maxAttempts) {
            onProgress("repairing");
            const advanced = advanceWorkspaceGeneration({
              registryDir: workspace.registryDir,
              custody: liveCustodyAfterMaterialize,
              workspaceLease,
              expectedDirtyManifestDigest: dirtyManifestDigest(postValidationBoundary),
            });
            setCustody(advanced);
            continue;
          }
          break;
        }

        candidateAcceptance = acceptCandidate({
          session,
          candidateSeal,
          verification,
        });
        const outcome = productProof.state === "PROVEN" ? "DONE" : "BANKED_UNPROVEN";
        assertAttemptCurrent({
          executionPermit,
          attemptEntry,
          custody: liveCustodyAfterMaterialize,
          boundary: postValidationBoundary,
          capability: "CONTROLLER_COMMIT",
        });
        let delivery = deliverValidatedChanges({
          repositoryRoot: workspace.repositoryRoot,
          workspacePath: workspace.workspacePath,
          session,
          workspaceCustody: liveCustodyAfterMaterialize,
          candidateSeal,
          candidateAcceptance,
          stateDirectory: state.directory,
          delivery: { commit: true, push: false },
          productResult: session.productResult,
        });
        if (session.delivery.push) {
          assertAttemptCurrent({
            executionPermit,
            attemptEntry,
            custody: liveCustodyAfterMaterialize,
            boundary: postValidationBoundary,
            capability: "CONTROLLER_PUSH",
          });
        }
        delivery = {
          ...delivery,
          push: publishBankedChangesJournaled({
            workspacePath: workspace.workspacePath,
            sessionDigest: session.sessionDigest,
            commit: delivery.commit,
            push: session.delivery.push,
          }),
        };
        const delivered = outcome === "BANKED_UNPROVEN"
          ? "Retain the banked candidate, but do not claim the requested product result complete while material product-proof claims remain unresolved."
          : delivery.push.status === "remote_equal"
            ? "Use the delivered result."
            : delivery.push.status === "failed"
              ? "Use the banked local result; publication did not complete."
              : delivery.commit.status === "committed"
                ? "Use the committed result as an immutable candidate base for subsequent work."
                : delivery.commit.status === "no_changes"
                  ? "Use the validated result; no new commit was required."
                  : null;
        const predictedTerminalState = terminalStateFor({ outcome, delivery, finalBoundary: captureBoundary(workspace.workspacePath, session.allowedPaths) });
        const completedMs = Date.now();
        const result = {
          schemaVersion: "work-result/v2",
          outcome,
          productResult: session.productResult,
          currentState: session.journeyState,
          observableResult: agentResult.observableResult,
          workspace: {
            mode: workspace.mode,
            workspaceId: workspace.workspaceId,
            path: workspace.workspacePath,
            branch: workspace.branch,
            baseHead: workspace.baseHead,
            generation: workspace.generation,
            state: predictedTerminalState,
            created: workspace.created,
          },
          changedPaths: candidateSeal?.candidatePaths || changedPaths(after.inspected),
          validation: validations,
          verification: verificationEvidence(verification),
          productProof,
          acceptance: acceptanceEvidence(candidateAcceptance),
          metrics: workMetrics(workspace, attemptMetrics, startedMs, completedMs),
          delivery,
          blocker: outcome === "DONE" ? "none" : "One or more material product-proof claims remain unresolved.",
          nextAction: delivered || "Use the retained validated result.",
          attempts,
          sessionDigest: session.sessionDigest,
          executionAttempts,
          forwardMotionProofDigest: null,
          startedAt,
          completedAt: new Date(completedMs).toISOString(),
        };
        recordExecutionClosure({
          repositoryPath,
          session,
          attemptEntries,
          disposition: outcome === "DONE" ? "COMPLETED" : "PARTIAL",
          workResult: result,
        });
        journalAppender({
          gitCommonDirectory: journalGitDirectory,
          runId,
          type: "run/completed",
          data: {
            repositoryId: repositoryIdentity.repositoryId,
            runtimeCapabilityDigest: runtimeDigest,
            sessionDigest: session.sessionDigest,
            workspaceId: workspace.workspaceId,
            generation: workspace.generation,
            outcome,
            candidateTreeOid: candidateSeal.candidateTreeOid,
            productProofDigest: productProof?.productProofDigest || null,
            validationKey: lastValidationKey,
            commitSha: delivery.commit?.sha || null,
            pushStatus: delivery.push?.status || null,
          },
        });
        const finalBoundary = captureBoundary(workspace.workspacePath, session.allowedPaths);
        terminalizeResult(result, delivery, finalBoundary);
        writeJsonAtomic(state.resultPath, result);
        return result;
      }

      const circuit = recordFailedMeans({
        meansKind: "VALIDATE_CANDIDATE",
        failureClass: "VALIDATION_FAILED",
      });
      priorFailure = validationFailureText(validations);
      if (circuit.open) {
        priorFailure = `${priorFailure}\nThis exact candidate/validation route failed repeatedly and is now exhausted; choose materially different means.`;
      } else if (attempt < session.maxAttempts) {
        onProgress("repairing");
        const advanced = advanceWorkspaceGeneration({
          registryDir: workspace.registryDir,
          custody: liveCustodyAfterMaterialize,
          workspaceLease,
          expectedDirtyManifestDigest: dirtyManifestDigest(postValidationBoundary),
        });
        setCustody(advanced);
        continue;
      }
      break;
    }

    const after = assertBoundaryPreserved(before, workspace.workspacePath, session.allowedPaths);
    const validationText = validationFailureText(validations);
    const executionFailure = productProofFailureText(productProof) || validationText || "The coding worker did not produce a verifiable candidate.";
    const delivery = {
      validation: validations.length > 0 ? "failed" : "not_completed",
      commit: { status: "not_attempted" },
      push: { status: "not_attempted" },
    };
    let outcome;
    let blocker;
    let nextAction;
    if (forwardMotionProof) {
      outcome = terminalOutcomeForProof(forwardMotionProof);
      blocker = agentResult?.stop?.unsatisfiedRequirement || "The current execution means stopped.";
      nextAction = "Replan the Outcome autonomously from the durable forward-motion evidence.";
    } else if (interruptedNoSeal) {
      outcome = "REPLAN_REQUIRED";
      blocker = "The coding generation was admitted but produced neither a durable candidate seal nor a durable worker STOP; replay of that exact generation is refused.";
      nextAction = "Start a fresh execution route for this same product result from the latest durable snapshot.";
    } else {
      outcome = "REPLAN_REQUIRED";
      blocker = executionFailure;
      nextAction = "Replan the Outcome autonomously; exhausted implementation or validation means do not create owner authority.";
    }
    const terminalState = terminalStateFor({ outcome, delivery, finalBoundary: after });
    const completedMs = Date.now();
    const result = {
      schemaVersion: "work-result/v2",
      outcome,
      productResult: session.productResult,
      currentState: session.journeyState,
      observableResult: agentResult?.observableResult || "No completed product result was produced.",
      workspace: {
        mode: workspace.mode,
        workspaceId: workspace.workspaceId,
        path: workspace.workspacePath,
        branch: workspace.branch,
        baseHead: workspace.baseHead,
        generation: workspace.generation,
        state: terminalState,
        created: workspace.created,
      },
      changedPaths: changedPaths(after.inspected),
      validation: validations,
      verification: verificationEvidence(verification),
      productProof,
      acceptance: null,
      metrics: workMetrics(workspace, attemptMetrics, startedMs, completedMs),
      delivery,
      blocker,
      nextAction,
      attempts,
      sessionDigest: session.sessionDigest,
      executionAttempts,
      forwardMotionProofDigest: forwardMotionProof?.proofDigest || null,
      startedAt,
      completedAt: new Date(completedMs).toISOString(),
    };
    recordExecutionClosure({
      repositoryPath,
      session,
      attemptEntries,
      disposition: "INCOMPLETE",
      workResult: result,
    });
    terminalizeResult(result, delivery, after);
    writeJsonAtomic(state.resultPath, result);
    return result;
  } catch (error) {
    if (error?.code === "MH_DRAIN_REQUESTED") {
      return settleControlledDrain();
    }
    if (externalDispatchExists(workspace)) {
      throw error;
    }
    if (attemptEntries.length > 0) {
      recordExecutionClosure({
        repositoryPath,
        session,
        attemptEntries,
        disposition: "CONTROLLER_REJECTED",
        workResult: null,
      });
    }
    try {
      const current = readWorkspaceCustody(workspace.registryDir, workspace.workspaceId);
      if (current.state === "ACTIVE") {
        const finalBoundary = captureBoundary(workspace.workspacePath, session.allowedPaths);
        let bankProof = null;
        if (candidateSeal && finalBoundary.head !== current.baseHead) {
          try {
            bankProof = proveBankedCandidate({ workspacePath: workspace.workspacePath, seal: candidateSeal });
          } catch (_) {
            bankProof = null;
          }
        }
        const terminalState = bankProof ? "TERMINAL_COMMITTED" : "TERMINAL_ABANDONED";
        const terminal = terminalizeWorkspaceCustody({
          registryDir: workspace.registryDir,
          custody: current,
          workspaceLease,
          terminalState,
          resultDigest: domainDigest("meta-harness-work-failure/v1", {
            sessionDigest: session.sessionDigest,
            workspaceId: workspace.workspaceId,
            code: error?.code || "ERROR",
            message: String(error?.message || error),
            recoveredBankProof: Boolean(bankProof),
          }),
          validationDigest: validationDigest(verification, validations),
          finalDirtyManifestDigest: dirtyManifestDigest(finalBoundary),
          changedPathHashes: {},
          commitSha: finalBoundary.head !== current.baseHead ? finalBoundary.head : null,
        });
        setCustody(terminal);
        persistWorkSession(repositoryPath, session, workspace);
      }
    } catch (_) {
      // Preserve the original failure. Custody repair is deliberately not inferred.
    }
    throw error;
  } finally {
    releaseWorkspaceExecutionLease({ registryDir: workspace.registryDir, lease: workspaceLease });
  }
}

module.exports = {
  DRAIN_COMPLETE,
  assertBoundaryPreserved,
  captureBoundary,
  isDrainCompleteResult,
  missingValidationResult,
  persistMutationCheckpoint,
  runWork,
};
