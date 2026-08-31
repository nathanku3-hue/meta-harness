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

function structuredModelArgs({
  cwd,
  schemaPath,
  outputPath,
  prompt,
  model,
  pathStyle = "native",
  skipGitRepoCheck = false,
}) {
  const args = [
    "-a", "never",
    "-c", 'model_reasoning_effort="medium"',
    "-c", "project_doc_max_bytes=0",
    "-c", "skills.include_instructions=false",
  ];
  if (model) args.push("-m", model);
  args.push("exec");
  if (skipGitRepoCheck) args.push("--skip-git-repo-check");
  args.push(
    "-s", "read-only",
    "-C", modelPath(cwd, pathStyle),
    "--ephemeral",
    "--ignore-user-config",
    "--ignore-rules",
    "--color", "never",
    "--json",
    "--output-schema", modelPath(schemaPath, pathStyle),
    "-o", modelPath(outputPath, pathStyle),
    prompt,
  );
  return args;
}

function signalPid(pid, signal) {
  try {
    process.kill(pid, signal);
    return true;
  } catch (error) {
    if (error?.code === "ESRCH") return false;
    return false;
  }
}

function linuxProcessTable() {
  let entries;
  try {
    entries = fs.readdirSync("/proc", { withFileTypes: true });
  } catch (_) {
    return null;
  }
  const rows = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !/^\d+$/u.test(entry.name)) continue;
    const pid = Number(entry.name);
    try {
      const stat = fs.readFileSync(`/proc/${entry.name}/stat`, "utf8");
      const close = stat.lastIndexOf(")");
      if (close < 0) continue;
      const fields = stat.slice(close + 1).trim().split(/\s+/u);
      const ppid = Number(fields[1]);
      if (Number.isInteger(pid) && pid > 0 && Number.isInteger(ppid) && ppid >= 0) {
        rows.push({ pid, ppid });
      }
    } catch (_) {
      // Processes may disappear while /proc is being enumerated.
    }
  }
  return rows;
}

function psProcessTable() {
  const result = spawnSync("ps", ["-axo", "pid=,ppid="], {
    encoding: "utf8",
    windowsHide: true,
    timeout: 5_000,
  });
  if (result.error || result.status !== 0) return null;
  return String(result.stdout || "")
    .split(/\r?\n/u)
    .map((line) => line.trim().split(/\s+/u).map(Number))
    .filter(([pid, ppid]) => Number.isInteger(pid) && pid > 0 && Number.isInteger(ppid) && ppid >= 0)
    .map(([pid, ppid]) => ({ pid, ppid }));
}

function posixProcessTable() {
  return process.platform === "linux" ? linuxProcessTable() : psProcessTable();
}

function descendantPids(rootPid) {
  const rows = posixProcessTable();
  if (!rows) return null;
  const byParent = new Map();
  for (const row of rows) {
    const children = byParent.get(row.ppid) || [];
    children.push(row.pid);
    byParent.set(row.ppid, children);
  }
  const descendants = [];
  const queue = [...(byParent.get(rootPid) || [])];
  const seen = new Set();
  while (queue.length > 0) {
    const pid = queue.shift();
    if (seen.has(pid)) continue;
    seen.add(pid);
    descendants.push(pid);
    queue.push(...(byParent.get(pid) || []));
  }
  return descendants;
}

function freezePosixProcessTree(rootPid) {
  try {
    process.kill(-rootPid, "SIGSTOP");
  } catch (_) {
    signalPid(rootPid, "SIGSTOP");
  }
  const frozen = new Set([rootPid]);
  let ordered = [];
  for (let round = 0; round < 64; round += 1) {
    const descendants = descendantPids(rootPid);
    if (!descendants) return null;
    ordered = descendants;
    let discovered = false;
    for (const pid of descendants) {
      if (!frozen.has(pid)) discovered = true;
      frozen.add(pid);
      signalPid(pid, "SIGSTOP");
    }
    const verify = descendantPids(rootPid);
    if (!verify) return null;
    for (const pid of verify) {
      if (!frozen.has(pid)) discovered = true;
      frozen.add(pid);
      signalPid(pid, "SIGSTOP");
    }
    ordered = verify;
    if (!discovered) return { frozen, ordered };
  }
  return { frozen, ordered };
}

function terminatePosixTree(rootPid) {
  const frozen = freezePosixProcessTree(rootPid);
  if (frozen) {
    const leavesFirst = [...frozen.ordered].reverse();
    for (const pid of leavesFirst) signalPid(pid, "SIGKILL");
  }
  try {
    process.kill(-rootPid, "SIGKILL");
  } catch (_) {
    signalPid(rootPid, "SIGKILL");
  }
  if (frozen) {
    for (const pid of frozen.frozen) signalPid(pid, "SIGKILL");
  }
}

function terminateChild(child) {
  if (!child.pid) return;
  if (process.platform === "win32") {
    try {
      spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
        encoding: "utf8",
        windowsHide: true,
        timeout: 15_000,
      });
    } catch (_) {
      signalPid(child.pid, "SIGKILL");
    }
    return;
  }
  terminatePosixTree(child.pid);
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

function drainRequestedError() {
  return new ConfigError("controlled drain requested", { code: "MH_DRAIN_REQUESTED" });
}

function throwIfDrainRequested(signal) {
  if (signal?.aborted) throw drainRequestedError();
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
  skipGitRepoCheck = false,
  signal,
  onTerminationRequestedForTest,
}) {
  throwIfDrainRequested(signal);
  if (onTerminationRequestedForTest !== undefined
      && (env.META_HARNESS_TEST_MODE !== "1" || typeof onTerminationRequestedForTest !== "function")) {
    fail("MH_WORKER_CONFIG", "onTerminationRequestedForTest is available only as a test-mode function hook");
  }
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
    skipGitRepoCheck,
  })];

  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    let outputBytes = 0;
    let terminationCause = null;
    let spawnError = null;
    let closed = false;
    let abortListener = null;
    const child = spawn(command.executable, args, {
      cwd,
      env: { ...env },
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      detached: process.platform !== "win32",
    });

    function requestTermination(cause) {
      if (closed || terminationCause !== null) return false;
      terminationCause = cause;
      if (onTerminationRequestedForTest) {
        try { onTerminationRequestedForTest(cause); } catch (_) {}
      }
      terminateChild(child);
      return true;
    }

    if (signal) {
      abortListener = () => { requestTermination("DRAIN"); };
      signal.addEventListener("abort", abortListener, { once: true });
      if (signal.aborted) abortListener();
    }

    const timer = setTimeout(() => {
      requestTermination("TIMEOUT");
    }, Math.max(1, timeoutSeconds) * 1000);

    function cleanup() {
      clearTimeout(timer);
      if (signal && abortListener) signal.removeEventListener("abort", abortListener);
    }

    function append(target, chunk) {
      const text = Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk);
      outputBytes += Buffer.byteLength(text);
      if (outputBytes > outputCapBytes) {
        requestTermination("OUTPUT_CAP");
        return target;
      }
      return target + text;
    }

    child.stdout.on("data", (chunk) => { stdout = append(stdout, chunk); });
    child.stderr.on("data", (chunk) => { stderr = append(stderr, chunk); });
    child.on("error", (error) => {
      spawnError = error;
    });
    child.on("close", (exitCode, closeSignal) => {
      if (closed) return;
      closed = true;
      cleanup();
      if (terminationCause === "DRAIN") {
        reject(drainRequestedError());
        return;
      }
      if (terminationCause === "TIMEOUT") {
        reject(new ConfigError(`${label} exceeded ${timeoutSeconds} seconds`, { code: `${codePrefix}_TIMEOUT` }));
        return;
      }
      if (terminationCause === "OUTPUT_CAP") {
        reject(new ConfigError(`${label} exceeded the output limit`, { code: `${codePrefix}_OUTPUT_CAP` }));
        return;
      }
      if (spawnError) {
        reject(new ConfigError(`${label} could not start: ${spawnError.message}`, {
          code: `${codePrefix}_SPAWN`,
          details: { causeCode: spawnError.code },
        }));
        return;
      }
      if (exitCode !== 0) {
        reject(new ConfigError(
          `${label} exited ${exitCode}${closeSignal ? ` (${closeSignal})` : ""}: ${stderr.trim().slice(-2000)}`,
          { code: `${codePrefix}_EXIT`, details: { exitCode, signal: closeSignal } },
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
  drainRequestedError,
  modelPath,
  resolveStructuredModel,
  runEphemeralStructuredModel,
  structuredModelArgs,
  throwIfDrainRequested,
  windowsPathToWsl,
  wslPathToWindows,
};
