"use strict";

const path = require("node:path");
const { spawnSync } = require("node:child_process");

const { domainDigest } = require("./contracts/digest");
const { ConfigError } = require("./errors");
const {
  assertConsumedPermitCapability,
  assertExecutionPermitCurrent,
  consumeExecutionPermit,
  dirtyManifestDigest,
  issueExecutionPermit,
} = require("./execution-permit");
const { writeJsonAtomic } = require("./paths");
const { runCodingWorker } = require("./coding-worker");
const { materializeWorkerChanges } = require("./work-materializer");
const {
  deliverValidatedChanges,
  hashAcceptedPaths,
  inspectWorkspace,
  pathAllowed,
  persistWorkSession,
  prepareWorkspace,
  runGit,
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

function validationInvocation(command, platform = process.platform, env = process.env) {
  const [executable, ...args] = command.argv;
  if (platform === "win32" && /^(?:npm|npx|pnpm|yarn)(?:\.cmd)?$/i.test(executable)) {
    return {
      executable: env.ComSpec || env.COMSPEC || "cmd.exe",
      args: ["/d", "/s", "/c", executable, ...args],
    };
  }
  return { executable, args };
}

function runValidationCommand(workspacePath, command, env = process.env) {
  const cwd = command.cwd === "." ? workspacePath : path.resolve(workspacePath, command.cwd);
  const invocation = validationInvocation(command, process.platform, env);
  const startedAt = Date.now();
  const validationEnv = { ...env };
  delete validationEnv.NODE_TEST_CONTEXT;
  delete validationEnv.JEST_WORKER_ID;
  delete validationEnv.VITEST_POOL_ID;
  const result = spawnSync(invocation.executable, invocation.args, {
    cwd,
    env: validationEnv,
    encoding: "utf8",
    shell: false,
    windowsHide: true,
    timeout: command.timeoutSeconds * 1000,
    maxBuffer: 16 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const passed = !result.error && result.status === 0;
  return {
    argv: command.argv,
    cwd: command.cwd,
    passed,
    exitCode: result.status,
    durationMs: Date.now() - startedAt,
    output: String(result.stderr || result.stdout || result.error?.message || "").trim().slice(-4000),
  };
}

function runValidation(workspacePath, commands, env) {
  return commands.map((command) => runValidationCommand(workspacePath, command, env));
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

function validationDigest(results) {
  return domainDigest("meta-harness-work-validation/v1", results);
}

function workResultDigest(result) {
  return domainDigest("meta-harness-work-result/v1", result);
}

function terminalStateFor({ outcome, delivery, finalBoundary }) {
  if (outcome === "DONE" && delivery?.commit?.status && delivery.commit.status !== "not_authorized" && delivery.commit.status !== "not_attempted") {
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
    delivery: {
      validation: "unavailable",
      commit: { status: "not_attempted" },
      push: { status: "not_attempted" },
    },
    blocker: "External validation is required. Standalone --goal supports a root package.json scripts.test; otherwise provide an explicit work-session/v2 with exact validation argv.",
    nextAction: "Provide exact controller validation through work-session/v2.",
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
    delivery: {
      validation: "not_run",
      commit: { status: session.delivery.commit ? "authorized" : "not_authorized" },
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
}) {
  if (session.validation.length === 0) {
    return missingValidationResult(session, repositoryPath);
  }
  const plan = worktreePlan(repositoryPath, session);
  if (dryRun) return dryRunResult(session, plan);

  const startedAt = new Date().toISOString();
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
  let priorFailure = "";
  let attempts = 0;
  let acceptedPaths = [];
  const executionPermits = [];

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
    const changedPathHashes = acceptedPaths.length > 0
      ? hashAcceptedPaths(workspace.workspacePath, acceptedPaths)
      : {};
    const terminal = terminalizeWorkspaceCustody({
      registryDir: workspace.registryDir,
      custody: current,
      workspaceLease,
      terminalState,
      resultDigest: workResultDigest(result),
      validationDigest: validationDigest(validations),
      finalDirtyManifestDigest: dirtyManifestDigest(finalBoundary),
      changedPathHashes,
      commitSha: delivery?.commit?.sha || (terminalState === "TERMINAL_COMMITTED" ? finalBoundary.head : null),
    });
    setCustody(terminal);
    persistWorkSession(repositoryPath, session, workspace);
    return terminal;
  }

  try {
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
      consumeExecutionPermit({
        stateDirectory: state.directory,
        permit: executionPermit,
        entryCapability: "CODE_PROPOSE",
      });
      executionPermits.push({
        permitId: executionPermit.permitId,
        attemptId: executionPermit.attemptId,
        generation: executionPermit.generation,
        permitDigest: executionPermit.permitDigest,
        state: "CONSUMED",
      });

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
        if (agentResult.changes.length > 0) {
          fail("MH_WORKER_RESULT", "a blocked coding worker must not return file changes");
        }
        break;
      }

      assertConsumedPermitCapability({
        stateDirectory: state.directory,
        permit: executionPermit,
        capability: "CONTROLLER_MATERIALIZE",
      });
      acceptedPaths = [...new Set([
        ...acceptedPaths,
        ...materializeWorkerChanges(workspace.workspacePath, agentResult.changes, session.allowedPaths),
      ])].sort();
      const after = assertBoundaryPreserved(before, workspace.workspacePath, session.allowedPaths);
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
      assertConsumedPermitCapability({
        stateDirectory: state.directory,
        permit: executionPermit,
        capability: "CONTROLLER_VALIDATE",
      });
      validations = runValidation(workspace.workspacePath, session.validation, env);
      const postValidationBoundary = assertBoundaryPreserved(before, workspace.workspacePath, session.allowedPaths);
      const validationPassed = validations.length > 0 && validations.every((item) => item.passed);
      if (validationPassed) {
        if (agentResult.status === "partial" && attempt < session.maxAttempts) {
          priorFailure = [
            "Every controller-owned validation command passed after materialization.",
            "Your result was marked partial despite that evidence.",
            "Re-read the accepted product result and the current materialized files.",
            "Return status done when the accepted result is complete; otherwise name a stated stop condition.",
            "Do not repeat a validation failure or writable-workspace blocker contradicted by controller evidence.",
          ].join("\n");
          const advanced = advanceWorkspaceGeneration({
            registryDir: workspace.registryDir,
            custody: liveCustodyAfterMaterialize,
            workspaceLease,
            expectedDirtyManifestDigest: dirtyManifestDigest(postValidationBoundary),
          });
          setCustody(advanced);
          continue;
        }
        const outcome = agentResult.status === "done" ? "DONE" : "PARTIAL";
        if (outcome === "DONE" && session.delivery.commit) {
          assertConsumedPermitCapability({
            stateDirectory: state.directory,
            permit: executionPermit,
            capability: "CONTROLLER_COMMIT",
          });
        }
        if (outcome === "DONE" && session.delivery.push) {
          assertConsumedPermitCapability({
            stateDirectory: state.directory,
            permit: executionPermit,
            capability: "CONTROLLER_PUSH",
          });
        }
        const delivery = outcome === "DONE"
          ? deliverValidatedChanges({
            workspacePath: workspace.workspacePath,
            acceptedPathHashes: hashAcceptedPaths(workspace.workspacePath, acceptedPaths),
            delivery: session.delivery,
            productResult: session.productResult,
          })
          : {
            validation: "passed",
            commit: { status: "not_attempted" },
            push: { status: "not_attempted" },
          };
        const delivered = delivery.push.status === "remote_equal"
          ? "Use the delivered result."
          : delivery.commit.status === "committed"
            ? "Use the committed result as an immutable candidate base for subsequent work."
            : null;
        const predictedTerminalState = terminalStateFor({ outcome, delivery, finalBoundary: captureBoundary(workspace.workspacePath, session.allowedPaths) });
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
          changedPaths: changedPaths(after.inspected),
          validation: validations,
          delivery,
          blocker: agentResult.blocker || "none",
          nextAction: delivered || agentResult.nextAction || (outcome === "DONE" ? "Use the retained validated result." : "Start a new session if further work is authorized."),
          attempts,
          sessionDigest: session.sessionDigest,
          executionPermits,
          startedAt,
          completedAt: new Date().toISOString(),
        };
        const finalBoundary = captureBoundary(workspace.workspacePath, session.allowedPaths);
        terminalizeResult(result, delivery, finalBoundary);
        writeJsonAtomic(state.resultPath, result);
        return result;
      }

      priorFailure = validationFailureText(validations);
      if (attempt < session.maxAttempts) {
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
    const blocker = agentResult?.blocker || validationText || "The coding worker did not complete the accepted result.";
    const delivery = {
      validation: validations.length > 0 ? "failed" : "not_completed",
      commit: { status: "not_attempted" },
      push: { status: "not_attempted" },
    };
    const outcome = agentResult?.status === "partial" ? "PARTIAL" : "BLOCKED";
    const terminalState = terminalStateFor({ outcome, delivery, finalBoundary: after });
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
      delivery,
      blocker,
      nextAction: "Start a new session after resolving the named blocker; terminal workspace authority will not be reused.",
      attempts,
      sessionDigest: session.sessionDigest,
      executionPermits,
      startedAt,
      completedAt: new Date().toISOString(),
    };
    terminalizeResult(result, delivery, after);
    writeJsonAtomic(state.resultPath, result);
    return result;
  } catch (error) {
    try {
      const current = readWorkspaceCustody(workspace.registryDir, workspace.workspaceId);
      if (current.state === "ACTIVE") {
        const finalBoundary = captureBoundary(workspace.workspacePath, session.allowedPaths);
        const terminalState = finalBoundary.head !== current.baseHead
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
          }),
          validationDigest: validationDigest(validations),
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
  runValidation,
  runValidationCommand,
  runWork,
  validationInvocation,
};
