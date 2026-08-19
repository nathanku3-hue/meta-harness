"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");

const { ConfigError } = require("./errors");
const { writeJsonAtomic } = require("./paths");

const DEFAULT_TIMEOUT_SECONDS = 1200;
const DEFAULT_OUTPUT_CAP_BYTES = 8 * 1024 * 1024;

function fail(code, message, details) {
  throw new ConfigError(message, { code, details });
}

function parseCommandOverride(env) {
  const raw = env.META_HARNESS_WORKER_COMMAND_JSON;
  if (!raw) return null;
  if (env.META_HARNESS_TEST_MODE !== "1") {
    fail("MH_WORKER_CONFIG", "META_HARNESS_WORKER_COMMAND_JSON is a test-only hook and cannot replace the sandboxed model in normal execution");
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    fail("MH_WORKER_CONFIG", `META_HARNESS_WORKER_COMMAND_JSON is invalid JSON: ${error.message}`);
  }
  if (!Array.isArray(parsed) || parsed.length === 0 || parsed.some((entry) => typeof entry !== "string" || entry.length === 0)) {
    fail("MH_WORKER_CONFIG", "META_HARNESS_WORKER_COMMAND_JSON must be a non-empty JSON string array");
  }
  return { executable: parsed[0], prefixArgs: parsed.slice(1), identity: "test-worker" };
}

function wslPathToWindows(value) {
  const match = String(value || "").match(/^\/mnt\/([a-zA-Z])\/(.*)$/);
  if (!match) return null;
  return `${match[1].toUpperCase()}:\\${match[2].replace(/\//g, "\\")}`;
}

function windowsPathToWsl(value) {
  const match = String(value || "").trim().match(/^([a-zA-Z]):[\\/](.*)$/);
  if (!match) return null;
  return `/mnt/${match[1].toLowerCase()}/${match[2].replace(/\\/g, "/")}`;
}

function firstOutputLine(result) {
  return String(result?.stdout || "").split(/\r?\n/).map((line) => line.trim()).find(Boolean) || "";
}

function resolveStructuredModel(env = process.env, platform = process.platform, spawnImpl = spawnSync) {
  const overridden = parseCommandOverride(env);
  if (overridden) return overridden;

  if (platform === "linux" && env.WSL_DISTRO_NAME) {
    const whereOptions = { encoding: "utf8", windowsHide: true };
    const nodeResult = spawnImpl("where.exe", ["node"], whereOptions);
    const codexResult = spawnImpl("where.exe", ["codex.cmd"], whereOptions);
    const windowsNode = firstOutputLine(nodeResult);
    const windowsCodexCommand = firstOutputLine(codexResult);
    const nodeExecutable = windowsPathToWsl(windowsNode);
    const codexLauncher = windowsCodexCommand
      ? path.win32.join(path.win32.dirname(windowsCodexCommand), "node_modules", "@openai", "codex", "bin", "codex.js")
      : "";
    if (nodeExecutable && codexLauncher) {
      const probe = spawnImpl(nodeExecutable, [codexLauncher, "--version"], whereOptions);
      if (!probe.error && probe.status === 0) {
        return {
          executable: nodeExecutable,
          prefixArgs: [codexLauncher],
          identity: "codex-cli-windows-from-wsl",
          pathStyle: "windows",
        };
      }
    }
  }

  if (platform === "win32") {
    const appData = env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
    const launcher = path.join(appData, "npm", "node_modules", "@openai", "codex", "bin", "codex.js");
    if (fs.existsSync(launcher)) {
      return { executable: process.execPath, prefixArgs: [launcher], identity: "codex-cli", pathStyle: "native" };
    }
    fail("MH_WORKER_UNAVAILABLE", "Codex CLI is not installed in the expected global npm location");
  }

  return { executable: "codex", prefixArgs: [], identity: "codex-cli", pathStyle: "native" };
}

function modelPath(value, pathStyle) {
  if (pathStyle !== "windows") return value;
  const converted = wslPathToWindows(value);
  if (!converted) fail("MH_WORKER_PATH", `cannot translate model path to Windows: ${value}`);
  return converted;
}

function structuredModelArgs({ cwd, schemaPath, outputPath, prompt, model, pathStyle = "native" }) {
  const args = [
    "-a", "never",
    "-c", 'model_reasoning_effort="medium"',
  ];
  if (model) args.push("-m", model);
  args.push(
    "exec",
    "-s", "read-only",
    "-C", modelPath(cwd, pathStyle),
    "--ephemeral",
    "--ignore-user-config",
    "--color", "never",
    "--json",
    "--output-schema", modelPath(schemaPath, pathStyle),
    "-o", modelPath(outputPath, pathStyle),
    prompt,
  );
  return args;
}

function terminateChild(child) {
  if (!child.pid) return;
  try {
    if (process.platform === "win32") {
      spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
        encoding: "utf8",
        windowsHide: true,
        timeout: 15_000,
      });
      return;
    }
    process.kill(-child.pid, "SIGKILL");
  } catch {
    try { process.kill(child.pid, "SIGKILL"); } catch (_) {}
  }
}

function parseStructuredOutput(outputPath, { codePrefix, label, validate }) {
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(outputPath, "utf8"));
  } catch (error) {
    fail(`${codePrefix}_RESULT`, `${label} did not produce valid structured output: ${error.message}`);
  }
  return typeof validate === "function" ? validate(parsed) : parsed;
}

function runEphemeralStructuredModel({
  cwd,
  prompt,
  outputSchema,
  schemaPath,
  outputPath,
  timeoutSeconds = DEFAULT_TIMEOUT_SECONDS,
  model,
  env = process.env,
  outputCapBytes = DEFAULT_OUTPUT_CAP_BYTES,
  codePrefix = "MH_STRUCTURED_MODEL",
  label = "structured model",
  validate,
}) {
  writeJsonAtomic(schemaPath, outputSchema);
  try {
    if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
  } catch (error) {
    fail(`${codePrefix}_OUTPUT`, `cannot reset ${label} output path: ${error.message}`);
  }

  const command = resolveStructuredModel(env);
  const args = [...command.prefixArgs, ...structuredModelArgs({
    cwd,
    schemaPath,
    outputPath,
    prompt,
    model,
    pathStyle: command.pathStyle || "native",
  })];

  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    let outputBytes = 0;
    let timedOut = false;
    let capBreached = false;
    let settled = false;
    const child = spawn(command.executable, args, {
      cwd,
      env: { ...env },
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      detached: process.platform !== "win32",
    });

    const timer = setTimeout(() => {
      timedOut = true;
      terminateChild(child);
    }, Math.max(1, timeoutSeconds) * 1000);

    function append(target, chunk) {
      const text = Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk);
      outputBytes += Buffer.byteLength(text);
      if (outputBytes > outputCapBytes) {
        capBreached = true;
        terminateChild(child);
        return target;
      }
      return target + text;
    }

    child.stdout.on("data", (chunk) => { stdout = append(stdout, chunk); });
    child.stderr.on("data", (chunk) => { stderr = append(stderr, chunk); });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new ConfigError(`${label} could not start: ${error.message}`, {
        code: `${codePrefix}_SPAWN`,
        details: { causeCode: error.code },
      }));
    });
    child.on("close", (exitCode, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (timedOut) {
        reject(new ConfigError(`${label} exceeded ${timeoutSeconds} seconds`, { code: `${codePrefix}_TIMEOUT` }));
        return;
      }
      if (capBreached) {
        reject(new ConfigError(`${label} exceeded the output limit`, { code: `${codePrefix}_OUTPUT_CAP` }));
        return;
      }
      if (exitCode !== 0) {
        reject(new ConfigError(
          `${label} exited ${exitCode}${signal ? ` (${signal})` : ""}: ${stderr.trim().slice(-2000)}`,
          { code: `${codePrefix}_EXIT`, details: { exitCode, signal } },
        ));
        return;
      }
      try {
        resolve({
          model: command.identity,
          result: parseStructuredOutput(outputPath, { codePrefix, label, validate }),
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
  DEFAULT_OUTPUT_CAP_BYTES,
  DEFAULT_TIMEOUT_SECONDS,
  modelPath,
  resolveStructuredModel,
  runEphemeralStructuredModel,
  structuredModelArgs,
  windowsPathToWsl,
  wslPathToWindows,
};
