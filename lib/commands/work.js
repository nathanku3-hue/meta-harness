"use strict";

const fs = require("node:fs");
const path = require("node:path");

const { fail, optionValue, optionValues, parseArgs } = require("../cli-args");
const { writeLine, writeOut } = require("../cli-context");
const { runWork } = require("../work-loop");
const { loadLatestWorkSession } = require("../work-git");
const { createGoalWorkSession, loadWorkSession } = require("../work-session");

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
    const allowedPaths = optionValues(options.allow);
    return createGoalWorkSession({
      goal: String(goal),
      allowedPaths: allowedPaths.length > 0 ? allowedPaths.map(String) : ["."],
      dirtyPolicy: options.continueDirty !== undefined ? "continue-in-scope" : "isolate",
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
  writeLine(context, `Validation: ${result.validation.length === 0 ? "worker-reported" : `${passed}/${result.validation.length} passed`}`);
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
