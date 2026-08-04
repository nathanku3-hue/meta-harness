"use strict";

const path = require("node:path");
const { spawnSync } = require("node:child_process");

const { ConfigError } = require("./errors");
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
  const plan = worktreePlan(repositoryPath, session);
  if (dryRun) return dryRunResult(session, plan);

  const startedAt = new Date().toISOString();
  const workspace = prepareWorkspace(repositoryPath, session);
  const state = persistWorkSession(repositoryPath, session, workspace);
  const before = captureBoundary(workspace.workspacePath, session.allowedPaths);
  let agentResult = null;
  let validations = [];
  let priorFailure = "";
  let attempts = 0;
  let acceptedPaths = [];

  for (let attempt = 1; attempt <= session.maxAttempts; attempt += 1) {
    attempts = attempt;
    const run = await runner({
      workspacePath: workspace.workspacePath,
      session,
      schemaPath: state.schemaPath,
      outputPath: state.agentOutputPath,
      attempt,
      priorFailure,
      workspaceMode: workspace.mode,
      timeoutSeconds,
      model,
      env,
    });
    agentResult = run.result;
    assertBoundaryPreserved(before, workspace.workspacePath, session.allowedPaths);
    if (agentResult.status === "blocked") {
      if (agentResult.changes.length > 0) {
        fail("MH_WORKER_RESULT", "a blocked coding worker must not return file changes");
      }
      break;
    }
    acceptedPaths = materializeWorkerChanges(workspace.workspacePath, agentResult.changes, session.allowedPaths);
    const after = assertBoundaryPreserved(before, workspace.workspacePath, session.allowedPaths);
    validations = runValidation(workspace.workspacePath, session.validation, env);
    const validationPassed = validations.every((item) => item.passed);
    if (validationPassed) {
      const outcome = agentResult.status === "done" ? "DONE" : "PARTIAL";
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
          ? "Push the committed result when explicitly authorized."
          : null;
      const result = {
        schemaVersion: "work-result/v1",
        outcome,
        productResult: session.productResult,
        currentState: session.journeyState,
        observableResult: agentResult.observableResult,
        workspace: {
          mode: workspace.mode,
          path: workspace.workspacePath,
          branch: workspace.branch,
          created: workspace.created,
        },
        changedPaths: changedPaths(after.inspected),
        validation: validations,
        delivery,
        blocker: agentResult.blocker || "none",
        nextAction: delivered || agentResult.nextAction || (outcome === "DONE" ? "Review and bank the delivered change." : "Continue the bounded repair."),
        attempts,
        sessionDigest: session.sessionDigest,
        startedAt,
        completedAt: new Date().toISOString(),
      };
      writeJsonAtomic(state.resultPath, result);
      return result;
    }

    priorFailure = validationFailureText(validations);
    if (attempt === session.maxAttempts) break;
  }

  const after = assertBoundaryPreserved(before, workspace.workspacePath, session.allowedPaths);
  const validationText = validationFailureText(validations);
  const blocker = agentResult?.blocker || validationText || "The coding worker did not complete the accepted result.";
  const result = {
    schemaVersion: "work-result/v1",
    outcome: agentResult?.status === "partial" ? "PARTIAL" : "BLOCKED",
    productResult: session.productResult,
    currentState: session.journeyState,
    observableResult: agentResult?.observableResult || "No completed product result was produced.",
    workspace: {
      mode: workspace.mode,
      path: workspace.workspacePath,
      branch: workspace.branch,
      created: workspace.created,
    },
    changedPaths: changedPaths(after.inspected),
    validation: validations,
    delivery: {
      validation: validations.length > 0 ? "failed" : "not_completed",
      commit: { status: "not_attempted" },
      push: { status: "not_attempted" },
    },
    blocker,
    nextAction: agentResult?.nextAction || "Resolve the named blocker inside the existing work session.",
    attempts,
    sessionDigest: session.sessionDigest,
    startedAt,
    completedAt: new Date().toISOString(),
  };
  writeJsonAtomic(state.resultPath, result);
  return result;
}

module.exports = {
  assertBoundaryPreserved,
  captureBoundary,
  runValidation,
  runValidationCommand,
  runWork,
  validationInvocation,
};
