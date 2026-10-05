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
  ATTEMPT_ENTRY_SCHEMA,
  dirtyManifestDigest,
  enterRunAttempt,
  readAttemptEntriesForSession,
  validateAttemptEntry,
} = require("./execution-attempt");
const { recordExecutionClosure } = require("./execution-closure");
const { assertProductDirectionUnchanged } = require("./product-direction");
const { professionalSkillQuery, renderProfessionalSkillBodies } = require("./professional-skill-catalog");
const {
  descriptor: meansDescriptor,
  recordFailureBasin,
  recordMeansFailure,
  state: meansCircuitState,
} = require("./means-circuit");
const { validationFailureObservation } = require("./model-observation");
const {
  appendRunEvent,
  readRunEventsForSession,
  readRunJournal,
  runIdForExecution,
} = require("./run-journal");
const { ensureRepositoryIdentity, runtimeCapabilityDigest } = require("./runtime-identity");
const {
  compileRepositoryContractBindings,
  protectedRepositoryContractPaths,
  renderRepositoryContractBindings,
} = require("./repository-contract-binding");
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
const {
  assertWorkerStopBoundaryCurrent,
  recordWorkerStop,
  stopBoundaryEvidence,
} = require("./work-forward-motion-record");
const { materializeWorkerOperations } = require("./work-materializer");
const { resolveGoalValidation } = require("./work-validation");
const { assertVerifierAvailable, verifyCandidate } = require("./work-verifier");
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
  advanceWorkspaceGeneration,
  assertWorkspaceCustodyExecutable,
  readWorkspaceCustody,
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
    fail("MH_WORK_BOUNDARY_HEAD", "coding worker changed HEAD; worker mutation of Git history violates the execution invariant");
  }
  if (after.branch !== before.branch) {
    fail("MH_WORK_BOUNDARY_BRANCH", "coding worker changed the current branch");
  }
  if (after.indexDiff !== before.indexDiff) {
    fail("MH_WORK_BOUNDARY_INDEX", "coding worker changed the Git index; worker mutation of the index violates the execution invariant");
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
    candidateSealDigest: acceptance.candidateSealDigest,
    candidateTreeOid: acceptance.candidateTreeOid,
    verificationDigest: acceptance.verificationDigest,
    validation: acceptance.validation,
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
  const banked = outcome === "DONE";
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

function recoverMaterializingExternalEvidence({ workspace, session, continuation }) {
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
  if (session?.origin?.type !== "REPO_RUN"
      || intent.runBinding.sessionDigest !== session.sessionDigest
      || intent.runBinding.outcomeDigest !== session.origin.outcomeDigest
      || intent.runBinding.workspaceId !== workspace.workspaceId
      || intent.runBinding.generation !== continuation.custody.generation
      || intent.runBinding.attemptEntryDigest !== attemptEntry.entryDigest
      || intent.runBinding.attemptInputKey !== attemptEntry.attemptInputKey) {
    fail("MH_PROPOSAL_DISPATCH_STALE", "materializing external proposal no longer matches the active run/session/workspace identity");
  }
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
    generation: evidence.intent.runBinding.generation,
    packetDigest: evidence.intent.request.packet.packetDigest,
    intentDigest: evidence.intent.intentDigest,
    receiptDigest: evidence.receipt?.receiptDigest || null,
    hostError,
  });
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
      push: { status: session.delivery.push ? "requested" : "not_requested" },
    },
    blocker: "none",
    nextAction: "Run the same command without --dry-run.",
    attempts: 0,
    sessionDigest: session.sessionDigest,
    executionAttempts: [],
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
  snapshotter = createImmutableRunSnapshot,
  journalAppender = appendRunEvent,
  journalReader = readRunJournal,
  repositoryIdentityProvider = ensureRepositoryIdentity,
  runtimeDigestProvider = runtimeCapabilityDigest,
  onProgress = () => {},
  initialPriorFailure = "",
  signal,
}) {
  if (signal?.aborted) return DRAIN_COMPLETE;
  if (!["OWNER_GOAL", "REPO_RUN"].includes(session?.origin?.type)) {
    fail("MH_WORK_ORIGIN", "normal execution accepts only OWNER_GOAL or REPO_RUN sessions; legacy repository origins must normalize at the recovery boundary");
  }
  const plan = worktreePlan(repositoryPath, session);
  if (dryRun) return dryRunResult(session, plan);
  throwIfDrainRequested(signal);

  const startedMs = Date.now();
  const startedAt = new Date(startedMs).toISOString();
  let workspace = prepareWorkspace(repositoryPath, session, plan);
  let state;
  let before;
  const runId = runIdForExecution(session.sessionDigest, workspace.workspaceId);
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
    throw error;
  }
  let agentResult = null;
  let validations = [];
  let verification = null;
  let candidateAcceptance = null;
  const repairContextEvent = [...readRunEventsForSession({
    gitCommonDirectory: journalGitDirectory,
    sessionDigest: session.sessionDigest,
  })]
    .reverse()
    .find((event) => event.type === "integration/repair-context") || null;
  let priorFailure = initialPriorFailure || (repairContextEvent
    ? `Previous integration against the current product state failed (${repairContextEvent.data.reason}): ${repairContextEvent.data.detail}. Repair the same product result while preserving already-landed behavior.`
    : "");
  let attempts = 0;
  let candidateSeal = null;
  let interruptedNoSeal = false;
  let activeValidation = [...session.validation];
  let validationUnavailableAfterCandidate = false;
  let validationCapabilityBlocker = null;
  let lastValidationKey = null;
  const attemptEntries = [...readAttemptEntriesForSession({
    repositoryPath: workspace.repositoryRoot,
    session,
    workspaceId: workspace.workspaceId,
  })];
  function isRunCapabilityAttempt(entry) {
    return entry?.schemaVersion === ATTEMPT_ENTRY_SCHEMA && entry?.mechanism === "RUN_CAPABILITY";
  }

  function requireRunCapabilityAttempt(entry) {
    const validatedEntry = validateAttemptEntry(entry);
    if (!isRunCapabilityAttempt(validatedEntry)) {
      fail("MH_LEGACY_EXECUTION_RECOVERY", "legacy execution attempts must normalize before entering the normal work loop");
    }
    return validatedEntry;
  }

  function attemptProjection(entry) {
    const validatedEntry = requireRunCapabilityAttempt(entry);
    return {
      mechanism: "RUN_CAPABILITY",
      attemptId: validatedEntry.attemptId,
      generation: validatedEntry.generation,
      attemptInputKey: validatedEntry.attemptInputKey,
      attemptEntryDigest: validatedEntry.entryDigest,
      state: "ENTERED",
    };
  }

  function assertAttemptCurrent({
    attemptEntry,
    custody,
    boundary,
    capability = null,
    requireInitialDirtyManifest = false,
  }) {
    const entry = requireRunCapabilityAttempt(attemptEntry);
    assertProductDirectionUnchanged(session.productDirection, workspace.repositoryRoot);
    if (entry.sessionDigest !== session.sessionDigest
        || entry.workspaceId !== workspace.workspaceId
        || entry.generation !== workspace.generation
        || custody.sessionDigest !== session.sessionDigest
        || custody.workspaceId !== workspace.workspaceId
        || custody.generation !== workspace.generation
        || boundary.head !== session.base.commit
        || boundary.branch !== custody.branch) {
      fail("MH_RUN_CAPABILITY_STALE", "run capability no longer matches the exact session/workspace/Git boundary");
    }
    if (capability === "CONTROLLER_PUSH" && !session.delivery.push) {
      fail("MH_EXTERNAL_EFFECT_NOT_REQUESTED", "publication is an external effect and was not requested by this session");
    }
    if (requireInitialDirtyManifest) {
      const observedInputKey = attemptInputKey({
        session,
        snapshotTreeOid: boundary.treeOid,
        runtimeCapabilityDigest: runtimeDigest,
        workspaceMode: workspace.mode,
      });
      if (observedInputKey !== entry.attemptInputKey) {
        fail("MH_RUN_CAPABILITY_STALE", "recorded run input changed before model execution");
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

  function candidateValidationInput(seal = candidateSeal) {
    if (!seal?.candidateTreeOid) {
      fail("MH_MEANS_CIRCUIT", "candidate validation means require an exact candidate tree");
    }
    return {
      candidateTreeOid: seal.candidateTreeOid,
      validation: activeValidation,
      validationEnvironmentDigest: validationEnvDigest,
    };
  }

  function validationMeansState(seal = candidateSeal) {
    const value = meansDescriptor({
      meansKind: "VALIDATE_CANDIDATE",
      exactInput: candidateValidationInput(seal),
      runtimeCapabilityDigest: runtimeDigest,
      failureClass: "VALIDATION_FAILED",
    });
    return meansCircuitState({ gitCommonDirectory: journalGitDirectory, runId, value, failureLimit: 1 });
  }

  function recordFailedMeans({ meansKind, failureClass, seal = candidateSeal, exactInput = null, failureLimit = undefined }) {
    let input = exactInput;
    if (input === null) {
      input = meansKind === "VALIDATE_CANDIDATE"
        ? candidateValidationInput(seal)
        : (() => {
            if (!seal?.candidateTreeOid) {
              fail("MH_MEANS_CIRCUIT", "failed means must bind an exact candidate tree or explicit exact input");
            }
            return { candidateTreeOid: seal.candidateTreeOid };
          })();
    }
    return recordMeansFailure({
      gitCommonDirectory: journalGitDirectory,
      runId,
      meansKind,
      exactInput: input,
      runtimeCapabilityDigest: runtimeDigest,
      failureClass,
      ...(failureLimit === undefined ? {} : { failureLimit }),
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

  function stopRetryGuidance(workerStop) {
    const stop = workerStop.workerResult.stop;
    const failed = stop.failedMeans
      .map((entry) => `${entry.means}: ${entry.evidence.join("; ")}`)
      .join(" | ");
    const available = stop.alternativesConsidered
      .filter((entry) => entry.disposition === "AVAILABLE")
      .map((entry) => `${entry.means}: ${entry.evidence.join("; ")}`)
      .join(" | ");
    const alternative = available
      ? `Known in-scope alternatives: ${available}.`
      : "Search for a materially different reversible in-scope means; do not repeat the failed route.";
    return `The previous coding generation stopped without mutating the workspace. Unsatisfied requirement: ${stop.unsatisfiedRequirement}. Failed means: ${failed}. ${alternative}`;
  }

  function advanceAfterWorkerStop(workerStop) {
    const currentBoundary = captureBoundary(workspace.workspacePath, session.allowedPaths);
    assertWorkerStopBoundaryCurrent(workerStop, stopBoundaryEvidence(currentBoundary));
    const current = readWorkspaceCustody(workspace.registryDir, workspace.workspaceId);
    return setCustody(advanceWorkspaceGeneration({
      registryDir: workspace.registryDir,
      custody: current,
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
      let attemptEntry;
      let attemptMetric;
      let after;
      let liveCustodyAfterMaterialize;

      throwIfDrainRequested(signal);
      if (continuation.kind === "WORKER_STOP") {
        attemptEntry = requireRunCapabilityAttempt(continuation.attemptEntry);
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
        if (attempt < session.maxAttempts) {
          const circuit = recordStoppedMeans(continuation.workerStop);
          if (!circuit.open) {
            priorFailure = stopRetryGuidance(continuation.workerStop);
            advanceAfterWorkerStop(continuation.workerStop);
            continue;
          }
        }
        break;
      }

      if (continuation.kind === "SEALED_CANDIDATE") {
        attemptEntry = requireRunCapabilityAttempt(continuation.attemptEntry);
        candidateSeal = continuation.candidateSeal;
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
        assertAttemptCurrent({ attemptEntry, custody, boundary: after, capability: "CONTROLLER_VALIDATE" });
      } else if (["ENTERED_NO_SEAL", "MATERIALIZING"].includes(continuation.kind) && externalDispatchExists(workspace)) {
        candidateAcceptance = null;
        verification = null;
        validations = [];
        attemptEntry = requireRunCapabilityAttempt(continuation.attemptEntry);
        let evidence;
        let attemptBoundary = null;
        let materialization = null;
        if (continuation.kind === "MATERIALIZING") {
          evidence = recoverMaterializingExternalEvidence({
            workspace,
            session,
            continuation,
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
          if (attempt < session.maxAttempts) {
            const circuit = recordStoppedMeans(workerStop);
            if (!circuit.open) {
              priorFailure = stopRetryGuidance(workerStop);
              advanceAfterWorkerStop(workerStop);
              continue;
            }
          }
          break;
        }

        throwIfDrainRequested(signal);
        assertAttemptCurrent({
          attemptEntry,
          custody,
          boundary: captureBoundary(workspace.workspacePath, session.allowedPaths),
          capability: "CONTROLLER_MATERIALIZE",
        });
        if (!materialization) {
          const repositoryContracts = compileRepositoryContractBindings({
            repositoryPath: workspace.workspacePath,
            baseCommit: session.base.commit,
          });
          materialization = compileCandidateMaterialization({
            stateDirectory: state.directory,
            workspacePath: workspace.workspacePath,
            allowedPaths: session.allowedPaths,
            protectedPaths: protectedRepositoryContractPaths(repositoryContracts),
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
        assertAttemptCurrent({
          attemptEntry,
          custody: liveCustodyAfterMaterialize,
          boundary: after,
          capability: "CONTROLLER_VALIDATE",
        });
      } else {
        candidateAcceptance = null;
        verification = null;
        validations = [];
        if (continuation.kind !== "BASELINE") {
          fail("MH_WORK_RESUME", `unsupported ACTIVE continuation state: ${continuation.kind}`);
        }
        if (!priorFailure && continuation.priorSeal) {
          priorFailure = "The previous sealed candidate failed controller validation; repair from the retained exact candidate bytes.";
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
        attemptEntry = enterRunAttempt({
          repositoryPath: workspace.repositoryRoot,
          session,
          workspaceId: workspace.workspaceId,
          generation: custody.generation,
          attemptInputKey: currentAttemptInputKey,
        });
        assertAttemptCurrent({
          attemptEntry,
          custody,
          boundary: attemptBoundary,
          requireInitialDirtyManifest: true,
        });
        attemptEntries.push(attemptEntry);
        executionAttempts.push(attemptProjection(attemptEntry));
        const repositoryContracts = compileRepositoryContractBindings({
          repositoryPath: workspace.workspacePath,
          baseCommit: session.base.commit,
        });
        const repositoryContractsProjection = [
          renderRepositoryContractBindings(repositoryContracts),
          renderProfessionalSkillBodies(workspace.workspacePath, {
            productCommit: session.base.commit,
            query: professionalSkillQuery(session),
          }),
        ].filter(Boolean).join("\n\n");
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
              repositoryContractsProjection,
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
          attemptBoundary,
          workspacePath: workspace.workspacePath,
          session,
          schemaPath: state.schemaPath,
          outputPath: state.agentOutputPath,
          attempt,
          priorFailure,
          workspaceMode: workspace.mode,
          attemptEntry,
          runtimeCapabilityDigest: runtimeDigest,
          timeoutSeconds,
          model,
          env,
          signal,
          preparedModelRequest,
          repositoryContractsProjection,
        });
        if (isExternalOpenResult(run)) {
          const afterWorker = assertWorkerBoundaryPreserved(attemptBoundary, workspace.workspacePath, session.allowedPaths);
          const liveCustodyAfterWorker = readWorkspaceCustody(workspace.registryDir, workspace.workspaceId);
          assertAttemptCurrent({
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
          if (attempt < session.maxAttempts) {
            const circuit = recordStoppedMeans(workerStop);
            if (!circuit.open) {
              priorFailure = stopRetryGuidance(workerStop);
              advanceAfterWorkerStop(workerStop);
              continue;
            }
          }
          break;
        }

        throwIfDrainRequested(signal);
        assertAttemptCurrent({
          attemptEntry,
          custody: liveCustodyAfterWorker,
          boundary: afterWorker,
          capability: "CONTROLLER_MATERIALIZE",
        });
        const materializedPaths = [...new Set([
          ...(continuation.retainedCandidatePaths || []),
          ...materializeWorkerOperations(
            workspace.workspacePath,
            agentResult.operations,
            session.allowedPaths,
            protectedRepositoryContractPaths(repositoryContracts),
          ),
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
          attemptEntry,
          custody: liveCustodyAfterMaterialize,
          boundary: after,
          capability: "CONTROLLER_VALIDATE",
        });
      }
      const resolvedCandidateValidation = resolveGoalValidation(
        workspace.repositoryRoot,
        session.base.commit,
        candidateSeal.candidatePaths.length > 0 ? candidateSeal.candidatePaths : session.allowedPaths,
      );
      activeValidation = resolvedCandidateValidation.supported && resolvedCandidateValidation.validation.length > 0
        ? [...resolvedCandidateValidation.validation]
        : [...session.validation];
      if (activeValidation.length === 0) {
        validationUnavailableAfterCandidate = true;
        validationCapabilityBlocker = "Implementation produced a durable candidate, but no deterministic validation command is available from the sealed base for the actual candidate paths.";
        break;
      }
      try {
        assertVerifierAvailable();
      } catch (error) {
        if (error?.code !== "MH_WORK_VERIFIER_SANDBOX_UNAVAILABLE") throw error;
        validationUnavailableAfterCandidate = true;
        validationCapabilityBlocker = "The durable candidate is ready for validation, but the required isolated verifier capability is unavailable on this host.";
        break;
      }
      const priorExactFailure = validationMeansState(candidateSeal);
      if (priorExactFailure.open) {
        priorFailure = `CIRCUIT_BROKEN: candidate tree ${candidateSeal.candidateTreeOid} with this exact validation contract and runtime was already empirically falsified. Do not resubmit the same state; produce a materially different in-scope hypothesis.`;
        if (attempt < session.maxAttempts) {
          onProgress("repairing");
          const repeatedBoundary = captureBoundary(workspace.workspacePath, session.allowedPaths);
          const advanced = advanceWorkspaceGeneration({
            registryDir: workspace.registryDir,
            custody: liveCustodyAfterMaterialize,
            expectedDirtyManifestDigest: dirtyManifestDigest(repeatedBoundary),
          });
          setCustody(advanced);
          continue;
        }
        break;
      }
      onProgress("validating");
      throwIfDrainRequested(signal);
      const verifierStartedMs = Date.now();
      verification = verifyCandidate({
        workspacePath: workspace.workspacePath,
        dependencySourcePath: workspace.repositoryRoot,
        candidateSeal,
        commands: activeValidation,
        env,
      });
      attemptMetric.verifierMs = Date.now() - verifierStartedMs;
      validations = verification.commands;
      attemptMetric.validationCommandMs = validations.reduce((sum, item) => sum + item.durationMs, 0);
      lastValidationKey = validationKey({
        candidateTreeOid: candidateSeal.candidateTreeOid,
        validation: activeValidation,
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
            output: item.output,
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
        candidateAcceptance = acceptCandidate({
          session,
          candidateSeal,
          verification,
          validation: activeValidation,
        });
        const outcome = "DONE";
        assertAttemptCurrent({
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
            workspaceId: workspace.workspaceId,
            commit: delivery.commit,
            push: session.delivery.push,
          }),
        };
        const delivered = delivery.push.status === "remote_equal"
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
          acceptance: acceptanceEvidence(candidateAcceptance),
          metrics: workMetrics(workspace, attemptMetrics, startedMs, completedMs),
          delivery,
          blocker: "none",
          nextAction: delivered || "Use the retained validated result.",
          attempts,
          sessionDigest: session.sessionDigest,
          executionAttempts,
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
            validationKey: lastValidationKey,
            commitSha: delivery.commit?.sha || null,
            pushStatus: delivery.push?.status || null,
          },
        });
        const finalBoundary = captureBoundary(workspace.workspacePath, session.allowedPaths);
        terminalizeResult(result, delivery, finalBoundary);
        return result;
      }

      const circuit = recordFailedMeans({
        meansKind: "VALIDATE_CANDIDATE",
        failureClass: "VALIDATION_FAILED",
        failureLimit: 1,
      });
      const basin = recordFailureBasin({
        gitCommonDirectory: journalGitDirectory,
        runId,
        meansKind: "VALIDATE_CANDIDATE",
        validationResults: validations,
        runtimeCapabilityDigest: runtimeDigest,
        validationEnvironmentDigest: validationEnvDigest,
      });
      priorFailure = validationFailureObservation(validations);
      if (circuit.open) {
        priorFailure = `${priorFailure}\nCIRCUIT_BROKEN: this exact candidate/validation/runtime fingerprint is empirically falsified. Do not resubmit identical candidate state.`;
      }
      if (basin.open) {
        priorFailure = `${priorFailure}\nFAILURE_BASIN: ${basin.failureCount} attempts reached the same deterministic ${basin.errorClass} locus (${basin.locus}). Search orthogonally across callers, interfaces, dependencies, or data shape instead of mutating only the local symptom.`;
      }
      if (attempt < session.maxAttempts) {
        onProgress("repairing");
        const advanced = advanceWorkspaceGeneration({
          registryDir: workspace.registryDir,
          custody: liveCustodyAfterMaterialize,
          expectedDirtyManifestDigest: dirtyManifestDigest(postValidationBoundary),
        });
        setCustody(advanced);
        continue;
      }
      break;
    }

    const after = assertBoundaryPreserved(before, workspace.workspacePath, session.allowedPaths);
    const validationText = validationFailureObservation(validations);
    const executionFailure = validationText || "The coding worker did not produce a verifiable candidate.";
    const delivery = {
      validation: validations.length > 0 ? "failed" : "not_completed",
      commit: { status: "not_attempted" },
      push: { status: "not_attempted" },
    };
    let outcome;
    let blocker;
    let nextAction;
    if (interruptedNoSeal) {
      outcome = "REPLAN_REQUIRED";
      blocker = "The coding generation was recorded but produced neither a durable candidate seal nor a durable worker STOP; replay of that exact generation is refused.";
      nextAction = "Start a fresh execution route for this same product result from the latest durable snapshot.";
    } else if (validationUnavailableAfterCandidate) {
      outcome = "REPLAN_REQUIRED";
      blocker = validationCapabilityBlocker || "Implementation produced a durable candidate, but validation cannot yet certify and bank it.";
      nextAction = "Keep the durable candidate and satisfy the missing validation capability before banking; do not redo the implementation merely to satisfy validation setup.";
    } else {
      outcome = "REPLAN_REQUIRED";
      blocker = agentResult?.stop?.unsatisfiedRequirement || executionFailure;
      nextAction = "Replan the Outcome autonomously; exhausted implementation or validation means do not create an owner-only decision.";
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
      acceptance: null,
      metrics: workMetrics(workspace, attemptMetrics, startedMs, completedMs),
      delivery,
      blocker,
      nextAction,
      attempts,
      sessionDigest: session.sessionDigest,
      executionAttempts,
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
  }
}

module.exports = {
  DRAIN_COMPLETE,
  assertBoundaryPreserved,
  captureBoundary,
  isDrainCompleteResult,
  persistMutationCheckpoint,
  runWork,
};