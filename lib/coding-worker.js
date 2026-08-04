"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const { ConfigError } = require("./errors");
const { writeJsonAtomic } = require("./paths");

const DEFAULT_TIMEOUT_SECONDS = 1200;
const OUTPUT_CAP_BYTES = 8 * 1024 * 1024;

const WORKER_RESULT_SCHEMA = Object.freeze({
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object",
  additionalProperties: false,
  required: ["status", "observableResult", "changes", "validation", "blocker", "nextAction"],
  properties: {
    status: { enum: ["done", "partial", "blocked"] },
    observableResult: { type: "string" },
    changes: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["path", "content"],
        properties: {
          path: { type: "string" },
          content: { type: "string" }
        }
      }
    },
    validation: { type: "array", items: { type: "string" } },
    blocker: { type: "string" },
    nextAction: { type: "string" },
  },
});

function fail(code, message, details) {
  throw new ConfigError(message, { code, details });
}

function listText(items) {
  return items.map((entry) => `- ${entry}`).join("\n");
}

function buildCodingPrompt(session, { attempt, priorFailure, workspaceMode }) {
  const failureBlock = priorFailure
    ? `\nPrevious attempt did not pass validation. Repair this exact failure before doing anything else:\n${priorFailure}\n`
    : "";
  return [
    "Execute this accepted coding work session. Do not reopen product planning.",
    "",
    `Product result: ${session.productResult}`,
    `Journey state: ${session.journeyState}`,
    `Do now: ${session.doNow}`,
    `Newly true behavior: ${session.newlyTrueBehavior}`,
    `Done when: ${session.doneWhen}`,
    "Stop only if:",
    listText(session.stopOnlyIf),
    "Authorized reversible actions:",
    listText(session.authorizedReversibleActions),
    "Owner-only actions:",
    listText(session.ownerOnlyActions),
    "Allowed paths:",
    listText(session.allowedPaths),
    "",
    `Workspace mode: ${workspaceMode}`,
    `Attempt: ${attempt} of ${session.maxAttempts}`,
    failureBlock,
    "Working rules:",
    "- Read repository instructions and only the files needed for this result.",
    "- Begin implementation immediately; do not produce another broad plan or ask approval for reversible in-scope work.",
    "- Preserve existing coherent work. Never reset, clean, stash, or revert unrelated changes.",
    "- The worker is read-only. Do not attempt filesystem or Git mutation.",
    "- Return every required file as a complete { path, content } entry inside changes; Meta-Harness owns materialization.",
    "- Include only allowed paths. Do not propose staging, commits, pushes, tags, branch/worktree changes, publication, credentials, or deletion.",
    "- Reason against the declared validation and repair the prior failure inside the returned file contents.",
    "- Stop at the stated product result. Do not add compatibility paths or downstream architecture unless required by doneWhen.",
    "- Return the required structured result with the product result first and process evidence second.",
  ].join("\n");
}

function parseWorkerOverride(env) {
  const raw = env.META_HARNESS_WORKER_COMMAND_JSON;
  if (!raw) return null;
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    fail("MH_WORKER_CONFIG", `META_HARNESS_WORKER_COMMAND_JSON is invalid JSON: ${error.message}`);
  }
  if (!Array.isArray(parsed) || parsed.length === 0 || parsed.some((entry) => typeof entry !== "string" || entry.length === 0)) {
    fail("MH_WORKER_CONFIG", "META_HARNESS_WORKER_COMMAND_JSON must be a non-empty JSON string array");
  }
  return { executable: parsed[0], prefixArgs: parsed.slice(1), identity: "configured-worker" };
}

function resolveCodingWorker(env = process.env, platform = process.platform) {
  const overridden = parseWorkerOverride(env);
  if (overridden) return overridden;

  if (platform === "win32") {
    const appData = env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
    const launcher = path.join(appData, "npm", "node_modules", "@openai", "codex", "bin", "codex.js");
    if (fs.existsSync(launcher)) {
      return { executable: process.execPath, prefixArgs: [launcher], identity: "codex-cli" };
    }
    fail("MH_WORKER_UNAVAILABLE", "Codex CLI is not installed in the expected global npm location");
  }

  return { executable: "codex", prefixArgs: [], identity: "codex-cli" };
}

function codingArgs({ workspacePath, schemaPath, outputPath, prompt, model }) {
  const args = [
    "-a", "never",
    "-c", 'model_reasoning_effort="medium"',
  ];
  if (model) args.push("-m", model);
  args.push(
    "exec",
    "-s", "read-only",
    "-C", workspacePath,
    "--ephemeral",
    "--ignore-user-config",
    "--color", "never",
    "--json",
    "--output-schema", schemaPath,
    "-o", outputPath,
    prompt,
  );
  return args;
}

function parseAgentResult(outputPath) {
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(outputPath, "utf8"));
  } catch (error) {
    fail("MH_WORKER_RESULT", `coding worker did not produce valid structured output: ${error.message}`);
  }
  const required = ["status", "observableResult", "changes", "validation", "blocker", "nextAction"];
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)
      || Object.keys(parsed).sort().join("\0") !== required.slice().sort().join("\0")) {
    fail("MH_WORKER_RESULT", "coding worker result has missing or unexpected fields");
  }
  if (!["done", "partial", "blocked"].includes(parsed.status)
      || typeof parsed.observableResult !== "string"
      || !Array.isArray(parsed.changes)
      || parsed.changes.some((entry) => !entry || typeof entry !== "object" || Array.isArray(entry)
        || Object.keys(entry).sort().join("\0") !== "content\0path"
        || typeof entry.path !== "string" || typeof entry.content !== "string")
      || !Array.isArray(parsed.validation)
      || parsed.validation.some((entry) => typeof entry !== "string")
      || typeof parsed.blocker !== "string"
      || typeof parsed.nextAction !== "string") {
    fail("MH_WORKER_RESULT", "coding worker result contains invalid values");
  }
  return parsed;
}

function runCodingWorker({
  workspacePath,
  session,
  schemaPath,
  outputPath,
  attempt,
  priorFailure = "",
  workspaceMode,
  timeoutSeconds = DEFAULT_TIMEOUT_SECONDS,
  model,
  env = process.env,
}) {
  writeJsonAtomic(schemaPath, WORKER_RESULT_SCHEMA);
  try {
    if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
  } catch (error) {
    fail("MH_WORKER_OUTPUT", `cannot reset worker output path: ${error.message}`);
  }
  const prompt = buildCodingPrompt(session, { attempt, priorFailure, workspaceMode });
  const worker = resolveCodingWorker(env);
  const args = [...worker.prefixArgs, ...codingArgs({ workspacePath, schemaPath, outputPath, prompt, model })];

  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    let outputBytes = 0;
    let timedOut = false;
    let capBreached = false;
    let settled = false;

    const child = spawn(worker.executable, args, {
      cwd: workspacePath,
      env: { ...env },
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      detached: process.platform !== "win32",
    });

    function terminate() {
      if (!child.pid) return;
      try {
        if (process.platform === "win32") {
          const killer = require("node:child_process").spawnSync(
            "taskkill",
            ["/PID", String(child.pid), "/T", "/F"],
            { encoding: "utf8", windowsHide: true, timeout: 15_000 },
          );
          return killer;
        }
        process.kill(-child.pid, "SIGKILL");
      } catch {
        try { process.kill(child.pid, "SIGKILL"); } catch (_) {}
      }
      return null;
    }

    const timer = setTimeout(() => {
      timedOut = true;
      terminate();
    }, Math.max(1, timeoutSeconds) * 1000);

    function onData(target, chunk) {
      const text = Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk);
      outputBytes += Buffer.byteLength(text);
      if (outputBytes > OUTPUT_CAP_BYTES) {
        capBreached = true;
        terminate();
        return target;
      }
      return target + text;
    }

    child.stdout.on("data", (chunk) => { stdout = onData(stdout, chunk); });
    child.stderr.on("data", (chunk) => { stderr = onData(stderr, chunk); });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new ConfigError(`coding worker could not start: ${error.message}`, {
        code: "MH_WORKER_SPAWN",
        details: { causeCode: error.code },
      }));
    });
    child.on("close", (exitCode, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (timedOut) {
        reject(new ConfigError(`coding worker exceeded ${timeoutSeconds} seconds`, { code: "MH_WORKER_TIMEOUT" }));
        return;
      }
      if (capBreached) {
        reject(new ConfigError("coding worker exceeded the output limit", { code: "MH_WORKER_OUTPUT_CAP" }));
        return;
      }
      if (exitCode !== 0) {
        reject(new ConfigError(
          `coding worker exited ${exitCode}${signal ? ` (${signal})` : ""}: ${stderr.trim().slice(-2000)}`,
          { code: "MH_WORKER_EXIT", details: { exitCode, signal } },
        ));
        return;
      }
      try {
        resolve({
          worker: worker.identity,
          result: parseAgentResult(outputPath),
          stdout,
          stderr,
        });
      } catch (error) {
        reject(error);
      }
    });
  });
}

module.exports = {
  DEFAULT_TIMEOUT_SECONDS,
  WORKER_RESULT_SCHEMA,
  buildCodingPrompt,
  codingArgs,
  parseAgentResult,
  resolveCodingWorker,
  runCodingWorker,
};
