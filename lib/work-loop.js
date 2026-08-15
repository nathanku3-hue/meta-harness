"use strict";

const path = require("node:path");

const { domainDigest } = require("./contracts/digest");
const { ConfigError } = require("./errors");
const {
  assertEnteredPermitCapability,
  assertExecutionPermitCurrent,
  dirtyManifestDigest,
  enterExecutionAttempt,
  issueExecutionPermit,
} = require("./execution-permit");
const { recordExecutionClosure } = require("./execution-closure");
const { writeJsonAtomic } = require("./paths");
const { runCodingWorker } = require("./coding-worker");
const { materializeWorkerOperations } = require("./work-materializer");
const { assertVerifierAvailable, verifyCandidate } = require("./work-verifier");
const {
  assertCandidateSealCurrent,
  deliverValidatedChanges,
  inspectWorkspace,
  pathAllowed,
  persistWorkSession,
  prepareWorkspace,
  proveBankedCandidate,
  publishBankedChanges,
  runGit,
  sealCandidate,
  acceptCandidate,
  worktreePlan,
} = require("./work-git");
const {
  acquireWorkspaceExecutionLease,
  advanceWorkspaceGeneration,
  assertWorkspaceCustodyExecutable,
  readWorkspaceCustody,
  releaseWorkspaceExecutionLease,
  terminalizeWorkspaceCustody,
} = require("./workspace-custody");

function fail(code, message, details) {
  throw new ConfigError(message, { code, details });
}

function indexDigest(workspacePath) {
  return String(runGit(workspacePath, ["diff", "--cached", "--binary"]).stdout || "");
}

function captureBoundary(workspacePath, allowedPaths) {
  const inspected = inspectWorkspace(workspacePath, allowedPaths);
  return {
    head: inspected.head,
    branch: inspected.branch,
    indexDiff: indexDigest(workspacePath),
    inspected,
  };
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
    repairAttempts: Math.max(0, attemptMetrics.length - 1),
    workerJsonEvents: attemptMetrics.reduce((sum, item) => sum + item.workerJsonEvents, 0),
    workerOutputBytes: attemptMetrics.reduce((sum, item) => sum + item.workerStdoutBytes + item.workerStderrBytes, 0),
    attempts: attemptMetrics.map((item) => ({ ...item })),
  };
}

function workResultDigest(result) {
  return domainDigest("meta-harness-work-result/v1", result);
}

function terminalStateFor({ outcome, delivery, finalBoundary }) {
  if (outcome === "DONE" && ["committed", "no_changes"].includes(delivery?.commit?.status)) {
    return "TERMINAL_COMMITTED";
  }
  if (outcome === "DONE") return "TERMINAL_SEALED_DIRTY";
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

function missingValidationResult(session, repositoryPath) {
  return {
    schemaVersion: "work-result/v1",
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
  };
}

function dryRunResult(session, plan) {
  return {
    schemaVersion: "work-result/v1",
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
  onProgress = () => {},
}) {
  if (session.validation.length === 0) {
    return missingValidationResult(session, repositoryPath);
  }
  const plan = worktreePlan(repositoryPath, session);
  if (dryRun) return dryRunResult(session, plan);
  assertVerifierAvailable();

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
  let priorFailure = "";
  let attempts = 0;
  let materializedPaths = [];
  let candidateSeal = null;
  const executionPermits = [];
  const attemptEntries = [];
  const attemptMetrics = [];

  function setCustody(custody) {
    workspace = { ...workspace, custody, generation: custody.generation };
    return custody;
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

  try {
    onProgress("working");
    for (let attempt = 1; attempt <= session.maxAttempts; attempt += 1) {
      attempts = attempt;
      const refreshed = refreshExecutableCustody(workspace, session);
      const custody = setCustody(refreshed.custody);
      const attemptBoundary = refreshed.boundary;
      const executionPermit = issueExecutionPermit({
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
      const attemptEntry = enterExecutionAttempt({
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
        workspacePath: workspace.workspacePath,
        session,
        schemaPath: state.schemaPath,
        outputPath: state.agentOutputPath,
        attempt,
        priorFailure,
        workspaceMode: workspace.mode,
        executionPermit,
        timeoutSeconds,
        model,
        env,
      });
      agentResult = run.result;
      const proposal = operationMetrics(agentResult.operations);
      const attemptMetric = {
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
      const afterWorker = assertBoundaryPreserved(before, workspace.workspacePath, session.allowedPaths);
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
      if (agentResult.status === "blocked") {
        if (agentResult.operations.length > 0) {
          fail("MH_WORKER_RESULT", "a blocked coding worker must not return mutation operations");
        }
        break;
      }

      assertEnteredPermitCapability({
        stateDirectory: state.directory,
        permit: executionPermit,
        attemptEntry,
        capability: "CONTROLLER_MATERIALIZE",
      });
      materializedPaths = [...new Set([
        ...materializedPaths,
        ...materializeWorkerOperations(workspace.workspacePath, agentResult.operations, session.allowedPaths),
      ])].sort();
      const after = assertBoundaryPreserved(before, workspace.workspacePath, session.allowedPaths);
      candidateSeal = sealCandidate({
        stateDirectory: state.directory,
        session,
        workspace,
        boundary: after,
        materializedPaths,
      });
      const liveCustodyAfterMaterialize = readWorkspaceCustody(workspace.registryDir, workspace.workspaceId);
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
      onProgress("validating");
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
        candidateAcceptance = acceptCandidate({
          session,
          candidateSeal,
          verification,
        });
        const outcome = "DONE";
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
          schemaVersion: "work-result/v1",
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
          executionPermits,
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
    const blocker = validationText || agentResult?.blocker || "The coding worker did not produce a verifiable candidate.";
    const delivery = {
      validation: validations.length > 0 ? "failed" : "not_completed",
      commit: { status: "not_attempted" },
      push: { status: "not_attempted" },
    };
    const outcome = after.inspected.entries.length > 0 ? "PARTIAL" : "BLOCKED";
    const terminalState = terminalStateFor({ outcome, delivery, finalBoundary: after });
    const completedMs = Date.now();
    const result = {
      schemaVersion: "work-result/v1",
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
      nextAction: agentResult?.nextAction || "Resolve the named blocker before retrying.",
      attempts,
      sessionDigest: session.sessionDigest,
      executionPermits,
      startedAt,
      completedAt: new Date(completedMs).toISOString(),
    };
    recordExecutionClosure({
      repositoryPath,
      session,
      attemptEntries,
      disposition: outcome === "PARTIAL" ? "PARTIAL" : "BLOCKED",
      workResult: result,
    });
    terminalizeResult(result, delivery, after);
    writeJsonAtomic(state.resultPath, result);
    return result;
  } catch (error) {
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
  assertBoundaryPreserved,
  captureBoundary,
  missingValidationResult,
  runWork,
};
