"use strict";

const fs = require("node:fs");
const path = require("node:path");

const { fail, optionValue, optionValues, parseArgs } = require("../cli-args");
const { writeLine, writeOut } = require("../cli-context");
const { runWork } = require("../work-loop");
const { loadLatestWorkSession } = require("../work-git");
const { createGoalWorkSession, loadWorkSession } = require("../work-session");
const { resolveGoalValidation } = require("../work-validation");

const OPTIONS = new Set([
  "session",
  "goal",
  "resume",
  "allow",
  "continueDirty",
  "dryRun",
  "timeout",
  "model",
  "json",
]);

function targetRepository(context, value) {
  const target = path.resolve(context.cwd, value);
  let stat;
  try {
    stat = fs.lstatSync(target);
  } catch (error) {
    fail(`repository is unreadable: ${error.message}`);
  }
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    fail("repository must be an existing non-symlink directory");
  }
  return target;
}

function parseTimeout(value) {
  if (value === undefined) return undefined;
  const parsed = Number(optionValue(value));
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 3600) {
    fail("--timeout must be an integer from 1 to 3600 seconds");
  }
  return parsed;
}

function uniqueAllowedPaths(value, platform) {
  const rawValues = Array.isArray(value) ? value : [value];
  if (rawValues.includes(true)) fail("--allow requires a path");
  const allowedPaths = optionValues(value).map(String);
  const seen = new Set();
  for (const allowedPath of allowedPaths) {
    const normalized = path.normalize(allowedPath).replace(/[\\/]+$/u, "") || ".";
    const key = platform === "win32" ? normalized.toLowerCase() : normalized;
    if (seen.has(key)) {
      fail(`duplicate --allow path after normalization: ${allowedPath}`);
    }
    seen.add(key);
  }
  return allowedPaths;
}

function resolveSession(context, repositoryPath, options) {
  const selected = [options.session !== undefined, options.goal !== undefined, options.resume !== undefined]
    .filter(Boolean).length;
  if (selected > 1) {
    fail("choose exactly one of --session, --goal, or --resume");
  }
  if (options.resume !== undefined) {
    return loadLatestWorkSession(repositoryPath);
  }
  if (options.session !== undefined) {
    const value = optionValue(options.session);
    if (!value || value === true) fail("--session requires a JSON file");
    return loadWorkSession(path.resolve(context.cwd, String(value)));
  }
  if (options.goal !== undefined) {
    const goal = optionValue(options.goal);
    if (!goal || goal === true) fail("--goal requires the product result");
    const allowedPaths = uniqueAllowedPaths(options.allow, context.platform);
    const validationScope = allowedPaths.length > 0 ? allowedPaths.map(String) : ["."];
    const resolved = resolveGoalValidation(repositoryPath, validationScope);
    return createGoalWorkSession({
      goal: String(goal),
      allowedPaths: validationScope,
      dirtyPolicy: options.continueDirty !== undefined ? "continue-in-scope" : "isolate",
      validation: resolved.validation,
    });
  }

  const conventional = path.join(repositoryPath, ".meta-harness", "work-session.json");
  if (fs.existsSync(conventional)) return loadWorkSession(conventional);
  fail("provide --goal, --session, or --resume; no .meta-harness/work-session.json was found");
}

function renderHuman(context, result) {
  writeLine(context, `Outcome: ${result.outcome}`);
  writeLine(context, `Product result: ${result.productResult}`);
  writeLine(context, `Current state: ${result.currentState}`);
  writeLine(context, `Observable result: ${result.observableResult}`);
  writeLine(context, `Workspace: ${result.workspace.mode} — ${result.workspace.path}`);
  const passed = result.validation.filter((item) => item.passed).length;
  const validation = result.validation.length === 0
    ? result.delivery.validation || "unavailable"
    : `${passed}/${result.validation.length} passed`;
  writeLine(context, `Validation: ${validation}`);
  writeLine(context, `Commit: ${result.delivery.commit.status}${result.delivery.commit.sha ? ` — ${result.delivery.commit.sha}` : ""}`);
  writeLine(context, `Push: ${result.delivery.push.status}`);
  writeLine(context, `Blocker: ${result.blocker || "none"}`);
  writeLine(context, `Next: ${result.nextAction}`);
}

module.exports = async function commandWork(argv, context) {
  const { positional, options } = parseArgs(argv);
  if (positional.length !== 1) {
    fail("usage: meta-harness work <repository> --goal <result> | --session <file> | --resume");
  }
  for (const key of Object.keys(options)) {
    if (!OPTIONS.has(key)) fail(`unknown work option: --${key}`);
  }
  const repositoryPath = targetRepository(context, positional[0]);
  const session = resolveSession(context, repositoryPath, options);
  const result = await runWork({
    repositoryPath,
    session,
    dryRun: options.dryRun !== undefined,
    timeoutSeconds: parseTimeout(options.timeout),
    model: optionValue(options.model),
    env: context.env,
  });
  if (options.json !== undefined) writeOut(context, `${JSON.stringify(result, null, 2)}\n`);
  else renderHuman(context, result);
  return { exitCode: result.outcome === "BLOCKED" ? 1 : 0 };
};
