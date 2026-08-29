"use strict";

const path = require("node:path");

const { domainDigest } = require("./contracts/digest");
const { ConfigError } = require("./errors");
const { isExternalOpenResult } = require("./devspace-proposal-host");
const { throwIfDrainRequested } = require("./ephemeral-structured-model");
const {
  assertEnteredPermitCapability,
  assertExecutionPermitCurrent,
  dirtyManifestDigest,
  enterExecutionAttempt,
  issueExecutionPermit,
  readAttemptEntriesForSession,
  readEnteredAttemptPermit,
} = require("./execution-permit");
const { recordExecutionClosure } = require("./execution-closure");
const { writeJsonAtomic } = require("./paths");
const {
  assertProposalDispatchBinding,
  assertProposalDispatchReceiptBinding,
  proposalDispatchIntentExists,
  readProposalDispatchIntent,
  readProposalDispatchReceipt,
} = require("./proposal-dispatch");
const { runCodingWorker } = require("./coding-worker");
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
  deliverValidatedChanges,
  pathAllowed,
  persistWorkSession,
  prepareWorkspace,
  proveBankedCandidate,
  publishBankedChanges,
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

function recoverExternalOpenEvidence({ workspace, session, attemptEntry, executionPermit, boundary }) {
  const intent = readProposalDispatchIntent({
    workspaceRegistryDir: workspace.registryDir,
    workspaceId: workspace.workspaceId,
    generation: attemptEntry.generation,
    optional: false,
  });
  const validatedIntent = assertProposalDispatchBinding({
    intent,
    session,
    custody: readWorkspaceCustody(workspace.registryDir, workspace.workspaceId),
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
  return Object.freeze({
    intent: validatedIntent,
    receipt: assertProposalDispatchReceiptBinding(validatedIntent, receipt),
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
    outcome: "BLOCKED",
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
    nextAction: "Add a supported project manifest and retry.",
    attempts: 0,
    sessionDigest: session.sessionDigest,
    executionPermits: [],
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
    executionPermits: [],
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
  try {
    state = persistWorkSession(repositoryPath, session, workspace);
    before = captureBoundary(workspace.workspacePath, session.allowedPaths);
  } catch (error) {
    releaseWorkspaceExecutionLease({ registryDir: workspace.registryDir, lease: workspaceLease });
    throw error;
  }
  let agentResult = null;
  let validations = [];
  let verification = null;
  let candidateAcceptance = null;
  let productProof = null;
  let priorFailure = "";
  let attempts = 0;
  let candidateSeal = null;
  let forwardMotionProof = null;
  let interruptedNoSeal = false;
  const attemptEntries = [...readAttemptEntriesForSession({
    repositoryPath: workspace.repositoryRoot,
    session,
    workspaceId: workspace.workspaceId,
  })];
  const executionPermits = attemptEntries.map((entry) => {
    const permit = readEnteredAttemptPermit(state.directory, entry);
    return {
      permitId: permit.permitId,
      attemptId: permit.attemptId,
      generation: permit.generation,
      permitDigest: permit.permitDigest,
      attemptEntryDigest: entry.entryDigest,
      state: "ENTERED",
    };
  });
  const attemptMetrics = [];

  function setCustody(custody) {
    workspace = { ...workspace, custody, generation: custody.generation };
    return custody;
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

  function terminalOutcomeForProof(proof) {
    if (proof.disposition === "OWNER_REQUIRED") return "OWNER_REQUIRED";
    if (proof.disposition === "HARD_BLOCKED") return "BLOCKED";
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
    if (["BASELINE", "SEALED_CANDIDATE", "WORKER_STOP"].includes(continuation.kind)) {
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
    if (startingContinuation.kind === "ENTERED_NO_SEAL") {
      attempts = startingContinuation.custody.generation;
      if (externalDispatchExists(workspace)) {
        const executionPermit = readEnteredAttemptPermit(state.directory, startingContinuation.attemptEntry);
        const boundary = assertWorkerBoundaryPreserved(before, workspace.workspacePath, session.allowedPaths);
        const evidence = recoverExternalOpenEvidence({
          workspace,
          session,
          attemptEntry: startingContinuation.attemptEntry,
          executionPermit,
          boundary,
        });
        return externalOpenControl({ workspace, session, evidence });
      }
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
        executionPermit = readEnteredAttemptPermit(state.directory, continuation.attemptEntry);
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
          priorFailure = alternativeGuidance(forwardMotionProof);
          advanceAfterWorkerStop(continuation.workerStop);
          continue;
        }
        break;
      }

      if (continuation.kind === "SEALED_CANDIDATE") {
        executionPermit = readEnteredAttemptPermit(state.directory, continuation.attemptEntry);
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
        assertEnteredPermitCapability({
          stateDirectory: state.directory,
          permit: executionPermit,
          attemptEntry,
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
        assertExecutionPermitCurrent({
          permit: executionPermit,
          session,
          repositoryRoot: workspace.repositoryRoot,
          workspacePath: workspace.workspacePath,
          workspaceCustody: custody,
          workspaceLease,
          workspaceRegistryDir: workspace.registryDir,
          boundary: attemptBoundary,
          requireInitialDirtyManifest: true,
        });
        attemptEntry = enterExecutionAttempt({
          stateDirectory: state.directory,
          permit: executionPermit,
          session,
          entryCapability: "CODE_PROPOSE",
        });
        attemptEntries.push(attemptEntry);
        executionPermits.push({
          permitId: executionPermit.permitId,
          attemptId: executionPermit.attemptId,
          generation: executionPermit.generation,
          permitDigest: executionPermit.permitDigest,
          attemptEntryDigest: attemptEntry.entryDigest,
          state: "ENTERED",
        });

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
          timeoutSeconds,
          model,
          env,
          signal,
        });
        if (isExternalOpenResult(run)) {
          const afterWorker = assertWorkerBoundaryPreserved(attemptBoundary, workspace.workspacePath, session.allowedPaths);
          const liveCustodyAfterWorker = readWorkspaceCustody(workspace.registryDir, workspace.workspaceId);
          assertExecutionPermitCurrent({
            permit: executionPermit,
            session,
            repositoryRoot: workspace.repositoryRoot,
            workspacePath: workspace.workspacePath,
            workspaceCustody: liveCustodyAfterWorker,
            workspaceLease,
            workspaceRegistryDir: workspace.registryDir,
            boundary: afterWorker,
            requireInitialDirtyManifest: true,
          });
          const evidence = recoverExternalOpenEvidence({
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
        const proposal = operationMetrics(agentResult.operations);
        attemptMetric = {
          attempt,
          generation: executionPermit.generation,
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
        assertExecutionPermitCurrent({
          permit: executionPermit,
          session,
          repositoryRoot: workspace.repositoryRoot,
          workspacePath: workspace.workspacePath,
          workspaceCustody: liveCustodyAfterWorker,
          workspaceLease,
          workspaceRegistryDir: workspace.registryDir,
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
            priorFailure = alternativeGuidance(forwardMotionProof);
            advanceAfterWorkerStop(workerStop);
            continue;
          }
          break;
        }

        throwIfDrainRequested(signal);
        assertEnteredPermitCapability({
          stateDirectory: state.directory,
          permit: executionPermit,
          attemptEntry,
          capability: "CONTROLLER_MATERIALIZE",
        });
        const materializedPaths = [...new Set([
          ...(continuation.retainedCandidatePaths || []),
          ...materializeWorkerOperations(workspace.workspacePath, agentResult.operations, session.allowedPaths),
        ])].sort();
        after = assertBoundaryPreserved(before, workspace.workspacePath, session.allowedPaths);
        candidateSeal = sealCandidate({
          stateDirectory: state.directory,
          session,
          workspace,
          boundary: after,
          materializedPaths,
        });
        liveCustodyAfterMaterialize = readWorkspaceCustody(workspace.registryDir, workspace.workspaceId);
        assertExecutionPermitCurrent({
          permit: executionPermit,
          session,
          repositoryRoot: workspace.repositoryRoot,
          workspacePath: workspace.workspacePath,
          workspaceCustody: liveCustodyAfterMaterialize,
          workspaceLease,
          workspaceRegistryDir: workspace.registryDir,
          boundary: after,
        });
        assertEnteredPermitCapability({
          stateDirectory: state.directory,
          permit: executionPermit,
          attemptEntry,
          capability: "CONTROLLER_VALIDATE",
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
          priorFailure = productProofFailureText(productProof);
          if (attempt < session.maxAttempts) {
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
        assertEnteredPermitCapability({
          stateDirectory: state.directory,
          permit: executionPermit,
          attemptEntry,
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
          assertEnteredPermitCapability({
            stateDirectory: state.directory,
            permit: executionPermit,
            attemptEntry,
            capability: "CONTROLLER_PUSH",
          });
        }
        delivery = {
          ...delivery,
          push: publishBankedChanges({
            workspacePath: workspace.workspacePath,
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
          executionPermits,
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
        const finalBoundary = captureBoundary(workspace.workspacePath, session.allowedPaths);
        terminalizeResult(result, delivery, finalBoundary);
        writeJsonAtomic(state.resultPath, result);
        return result;
      }

      priorFailure = validationFailureText(validations);
      if (attempt < session.maxAttempts) {
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
      const stopRequirement = agentResult?.stop?.unsatisfiedRequirement || "The current execution means stopped.";
      blocker = forwardMotionProof.disposition === "HARD_BLOCKED"
        ? forwardMotionProof.hardConstraint
        : stopRequirement;
      nextAction = outcome === "OWNER_REQUIRED"
        ? forwardMotionProof.ownerRequest.question
        : outcome === "REPLAN_REQUIRED"
          ? "Replan the Outcome autonomously from the durable forward-motion evidence."
          : "Wait for new evidence or a changed hard constraint before retrying the Outcome.";
    } else if (interruptedNoSeal) {
      outcome = "BLOCKED";
      blocker = "The coding generation was admitted but produced neither a durable candidate seal nor a durable worker STOP; replay is refused.";
      nextAction = "Start a new product result if the interrupted work is still required.";
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
      executionPermits,
      forwardMotionProofDigest: forwardMotionProof?.proofDigest || null,
      startedAt,
      completedAt: new Date(completedMs).toISOString(),
    };
    recordExecutionClosure({
      repositoryPath,
      session,
      attemptEntries,
      disposition: "BLOCKED",
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
        const terminalState = bankProof
          ? "TERMINAL_COMMITTED"
          : finalBoundary.inspected.entries.length > 0
            ? "TERMINAL_BLOCKED_DIRTY"
            : "TERMINAL_BLOCKED";
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
  runWork,
};
