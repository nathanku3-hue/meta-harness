"use strict";

/**
 * D070-A1 AO process contract: identity bind, allowlisted env, tree timeout.
 */

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");

const {
  codedError,
  isPlainObject,
  isNonEmptyString,
  isAbsoluteNormalizedFsPath,
  sha256File,
  absNorm,
  hostRealPath,
} = require("./support");
const {
  AO_TIMEOUT_SECONDS,
  AO_STDOUT_MAX_BYTES,
  AO_STDERR_MAX_BYTES,
  AO_ENV_ALLOWLIST,
  buildObjectiveAoPrompt,
  WORKER_PROFILE,
} = require("./ao-constants");

function sha256Utf8(text) {
  return crypto.createHash("sha256").update(String(text), "utf8").digest("hex");
}

/**
 * Snapshot allowlisted env keys from an explicit source map (not inherit-all).
 */
function snapshotAoEnv(codexHome, sourceEnv) {
  if (!isNonEmptyString(codexHome) || !isAbsoluteNormalizedFsPath(codexHome)) {
    throw codedError("D070_CODEX_HOME", "codexHome must be absolute normalized path");
  }
  if (!isPlainObject(sourceEnv)) {
    throw codedError("D070_ENV_SOURCE", "sourceEnv must be a plain object");
  }
  const env = Object.create(null);
  for (const key of AO_ENV_ALLOWLIST) {
    if (key === "CODEX_HOME") continue;
    if (Object.prototype.hasOwnProperty.call(sourceEnv, key)
      && sourceEnv[key] !== undefined
      && sourceEnv[key] !== null
      && String(sourceEnv[key]).length > 0) {
      env[key] = String(sourceEnv[key]);
    }
  }
  env.CODEX_HOME = codexHome;
  if (!env.PATH) {
    throw codedError("D070_ENV_PATH", "allowlisted env requires PATH");
  }
  return env;
}

function probeCodexVersion(nodeExecutablePath, launcherScriptPath, env) {
  const result = spawnSync(
    nodeExecutablePath,
    [launcherScriptPath, "--version"],
    {
      encoding: "utf8",
      windowsHide: true,
      timeout: 15_000,
      env: { ...env },
      maxBuffer: 64 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  if (result.error) {
    throw codedError(
      "D070_VERSION_PROBE",
      `codex --version probe failed: ${result.error.message}`,
      { causeCode: result.error.code },
    );
  }
  if (result.status !== 0) {
    throw codedError(
      "D070_VERSION_PROBE",
      `codex --version exited ${result.status}: ${String(result.stderr || "").trim()}`,
      { status: result.status },
    );
  }
  const output = String(result.stdout || "").trim();
  const match = /^codex-cli\s+([^\s]+)$/.exec(output);
  if (!match) {
    throw codedError(
      "D070_VERSION_OUTPUT",
      `unexpected codex --version output: ${JSON.stringify(output)}`,
    );
  }
  return match[1];
}

function revalidateCodexIdentity(bound) {
  if (!isPlainObject(bound)) {
    throw codedError("D070_CODEX_BOUND", "bound codex program required");
  }
  const nodeReal = hostRealPath(bound.nodeExecutablePath);
  if (nodeReal !== bound.nodeRealPath
    && nodeReal.toLowerCase() !== String(bound.nodeRealPath).toLowerCase()) {
    throw codedError(
      "D070_NODE_IDENTITY",
      "node executable realpath changed since controller construction",
    );
  }

  const launcherReal = hostRealPath(bound.launcherScriptPath);
  if (launcherReal !== bound.launcherRealPath) {
    throw codedError("D070_LAUNCHER_PATH", "launcher realpath changed");
  }
  const launcherLstat = fs.lstatSync(launcherReal);
  if (launcherLstat.isSymbolicLink() || !launcherLstat.isFile()) {
    throw codedError("D070_LAUNCHER_FILE", "launcher must be a regular non-symlink file");
  }
  const launcherSha = sha256File(launcherReal);
  if (launcherSha !== bound.expectedLauncherSha256) {
    throw codedError("D070_LAUNCHER_HASH", "launcher sha256 mismatch");
  }

  const nativeReal = hostRealPath(bound.nativeExecutablePath);
  if (nativeReal !== bound.nativeRealPath) {
    throw codedError("D070_NATIVE_PATH", "native executable realpath changed");
  }
  const nativeLstat = fs.lstatSync(nativeReal);
  if (nativeLstat.isSymbolicLink() || !nativeLstat.isFile()) {
    throw codedError("D070_NATIVE_FILE", "native executable must be a regular non-symlink file");
  }
  const nativeSha = sha256File(nativeReal);
  if (nativeSha !== bound.expectedNativeSha256) {
    throw codedError("D070_NATIVE_HASH", "native executable sha256 mismatch");
  }

  const liveVersion = probeCodexVersion(
    bound.nodeRealPath,
    bound.launcherRealPath,
    bound.env,
  );
  if (liveVersion !== bound.expectedVersion || liveVersion !== bound.boundVersion) {
    throw codedError(
      "D070_VERSION",
      `codex version ${liveVersion} does not match bound ${bound.expectedVersion}`,
    );
  }

  if (bound.workerProfile !== WORKER_PROFILE) {
    throw codedError("D070_PROFILE", `workerProfile must be ${WORKER_PROFILE}`);
  }

  return {
    nodeRealPath: bound.nodeRealPath,
    launcherRealPath: bound.launcherRealPath,
    launcherSha256: launcherSha,
    nativeRealPath: bound.nativeRealPath,
    nativeSha256: nativeSha,
    version: liveVersion,
  };
}

/**
 * Bind codex identity at controller construction.
 */
function bindCodexProgram(codexProgram, { sourceEnv } = {}) {
  if (!isPlainObject(codexProgram)) {
    throw codedError("D070_CODEX_PROGRAM", "codexProgram object required");
  }
  if (codexProgram.workerProfile !== WORKER_PROFILE) {
    throw codedError(
      "D070_WORKER_PROFILE",
      `codexProgram.workerProfile must be "${WORKER_PROFILE}"`,
    );
  }
  if (!isNonEmptyString(codexProgram.expectedVersion)) {
    throw codedError("D070_VERSION_REQUIRED", "codexProgram.expectedVersion required");
  }
  if (!isNonEmptyString(codexProgram.expectedLauncherSha256)
    || !/^[a-f0-9]{64}$/.test(codexProgram.expectedLauncherSha256)) {
    throw codedError("D070_LAUNCHER_HASH_SHAPE", "expectedLauncherSha256 must be 64 hex chars");
  }
  if (!isNonEmptyString(codexProgram.expectedNativeSha256)
    || !/^[a-f0-9]{64}$/.test(codexProgram.expectedNativeSha256)) {
    throw codedError("D070_NATIVE_HASH_SHAPE", "expectedNativeSha256 must be 64 hex chars");
  }
  if (!isAbsoluteNormalizedFsPath(codexProgram.nodeExecutablePath)) {
    throw codedError("D070_NODE_PATH", "nodeExecutablePath must be absolute normalized");
  }
  if (!isAbsoluteNormalizedFsPath(codexProgram.launcherScriptPath)) {
    throw codedError("D070_LAUNCHER_PATH_SHAPE", "launcherScriptPath must be absolute normalized");
  }
  if (!isAbsoluteNormalizedFsPath(codexProgram.nativeExecutablePath)) {
    throw codedError("D070_NATIVE_PATH_SHAPE", "nativeExecutablePath must be absolute normalized");
  }
  if (!isAbsoluteNormalizedFsPath(codexProgram.codexHome)) {
    throw codedError("D070_CODEX_HOME", "codexHome must be absolute normalized");
  }

  // CODEX_HOME is a boundary only — must exist as a directory, never content-inspected for secrets.
  let homeStat;
  try {
    homeStat = fs.lstatSync(codexProgram.codexHome);
  } catch (err) {
    throw codedError("D070_CODEX_HOME_MISSING", `codexHome missing: ${err.message}`);
  }
  if (homeStat.isSymbolicLink() || !homeStat.isDirectory()) {
    throw codedError("D070_CODEX_HOME_TYPE", "codexHome must be a non-symlink directory");
  }

  const nodeRealPath = hostRealPath(codexProgram.nodeExecutablePath);
  const launcherRealPath = hostRealPath(codexProgram.launcherScriptPath);
  const nativeRealPath = hostRealPath(codexProgram.nativeExecutablePath);

  const launcherSha = sha256File(launcherRealPath);
  if (launcherSha !== codexProgram.expectedLauncherSha256) {
    throw codedError(
      "D070_LAUNCHER_HASH_MISMATCH",
      "launcher sha256 does not match expectedLauncherSha256",
      { expected: codexProgram.expectedLauncherSha256, actual: launcherSha },
    );
  }
  const nativeSha = sha256File(nativeRealPath);
  if (nativeSha !== codexProgram.expectedNativeSha256) {
    throw codedError(
      "D070_NATIVE_HASH_MISMATCH",
      "native sha256 does not match expectedNativeSha256",
      { expected: codexProgram.expectedNativeSha256, actual: nativeSha },
    );
  }

  const env = snapshotAoEnv(
    absNorm(codexProgram.codexHome),
    sourceEnv || codexProgram.hostEnv || {},
  );
  const boundVersion = probeCodexVersion(nodeRealPath, launcherRealPath, env);
  if (boundVersion !== codexProgram.expectedVersion) {
    throw codedError(
      "D070_VERSION_MISMATCH",
      `codex --version ${boundVersion} does not match expected ${codexProgram.expectedVersion}`,
    );
  }

  return {
    workerProfile: WORKER_PROFILE,
    nodeExecutablePath: absNorm(codexProgram.nodeExecutablePath),
    nodeRealPath,
    launcherScriptPath: absNorm(codexProgram.launcherScriptPath),
    launcherRealPath,
    expectedLauncherSha256: codexProgram.expectedLauncherSha256,
    nativeExecutablePath: absNorm(codexProgram.nativeExecutablePath),
    nativeRealPath,
    expectedNativeSha256: codexProgram.expectedNativeSha256,
    expectedVersion: codexProgram.expectedVersion,
    boundVersion,
    codexHome: absNorm(codexProgram.codexHome),
    env,
    aoTimeoutSeconds: AO_TIMEOUT_SECONDS,
  };
}

function listDescendantPidsWindows(rootPid) {
  // tasklist does not give tree easily; use wmic/CIM via powershell is heavy.
  // Use WMIC process where ParentProcessId — iterative BFS.
  const result = spawnSync(
    "wmic",
    ["process", "get", "ProcessId,ParentProcessId", "/FORMAT:CSV"],
    { encoding: "utf8", windowsHide: true, timeout: 15_000 },
  );
  if (result.error || result.status !== 0) {
    return [];
  }
  const lines = String(result.stdout || "").split(/\r?\n/).filter(Boolean);
  const childrenByParent = new Map();
  for (const line of lines) {
    // Node,ParentProcessId,ProcessId
    const parts = line.split(",");
    if (parts.length < 3) continue;
    const ppid = Number(parts[parts.length - 2]);
    const pid = Number(parts[parts.length - 1]);
    if (!Number.isInteger(ppid) || !Number.isInteger(pid)) continue;
    if (!childrenByParent.has(ppid)) childrenByParent.set(ppid, []);
    childrenByParent.get(ppid).push(pid);
  }
  const out = [];
  const queue = [rootPid];
  const seen = new Set();
  while (queue.length) {
    const cur = queue.shift();
    if (seen.has(cur)) continue;
    seen.add(cur);
    const kids = childrenByParent.get(cur) || [];
    for (const k of kids) {
      out.push(k);
      queue.push(k);
    }
  }
  return out;
}

function processExists(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Terminate the launcher process tree. Windows: taskkill /T /F.
 * Non-Windows: SIGKILL process group best-effort.
 */
function terminateProcessTree(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return { method: "noop" };
  if (process.platform === "win32") {
    const kill = spawnSync(
      "taskkill",
      ["/PID", String(pid), "/T", "/F"],
      { encoding: "utf8", windowsHide: true, timeout: 15_000 },
    );
    return {
      method: "taskkill /T /F",
      status: kill.status,
      stderr: String(kill.stderr || "").slice(0, 500),
    };
  }
  try {
    process.kill(-pid, "SIGKILL");
    return { method: "kill(-pid, SIGKILL)" };
  } catch {
    try {
      process.kill(pid, "SIGKILL");
      return { method: "kill(pid, SIGKILL)" };
    } catch (err) {
      return { method: "kill-failed", error: err.message };
    }
  }
}

function assertTreeReaped(pid) {
  // Give the OS a brief moment after taskkill
  const deadline = Date.now() + 2000;
  while (Date.now() < deadline) {
    if (!processExists(pid)) break;
    spawnSync(process.execPath, ["-e", ""], { timeout: 50, windowsHide: true });
  }
  if (processExists(pid)) {
    throw codedError(
      "D070_TREE_NOT_REAPED",
      `launcher pid ${pid} still alive after tree termination`,
    );
  }
  if (process.platform === "win32") {
    const descendants = listDescendantPidsWindows(pid);
    const live = descendants.filter((p) => processExists(p));
    if (live.length > 0) {
      throw codedError(
        "D070_DESCENDANT_ALIVE",
        `descendants still alive after tree kill: ${live.join(",")}`,
      );
    }
  }
}

/**
 * Spawn AO without shell; stdin closed at creation via stdio ignore.
 * Caps stdout/stderr; on timeout or cap breach, kill process tree and reap.
 */
function spawnAoProcess(bound, {
  worktreePath,
  schemaPath,
  allowedPath,
  objective,
  timeoutSeconds = AO_TIMEOUT_SECONDS,
}) {
  const identity = revalidateCodexIdentity(bound);

  const prompt = buildObjectiveAoPrompt(objective, allowedPath);
  const args = [
    bound.launcherRealPath,
    "--ask-for-approval",
    "never",
    "-c",
    'permission_profile=":read-only"',
    "exec",
    "--cd",
    worktreePath,
    "--ephemeral",
    "--ignore-user-config",
    "--color",
    "never",
    "--json",
    "--output-schema",
    schemaPath,
    prompt,
  ];

  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let timedOut = false;
    let capBreached = null;
    let settled = false;
    let killInfo = null;

    const child = spawn(bound.nodeRealPath, args, {
      cwd: worktreePath,
      env: { ...bound.env },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      shell: false,
      // On POSIX, start new process group so -pid kill works
      detached: process.platform !== "win32",
    });

    const pid = child.pid;

    function finish(result) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    }

    function failHard(code, message, extra = {}) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        if (pid) {
          killInfo = terminateProcessTree(pid);
          try {
            assertTreeReaped(pid);
          } catch {
            // include reap failure in error below
          }
        }
      } catch {
        // ignore
      }
      const err = codedError(code, message, extra);
      reject(err);
    }

    const timer = setTimeout(() => {
      timedOut = true;
      if (pid) {
        killInfo = terminateProcessTree(pid);
      }
    }, Math.max(1, timeoutSeconds) * 1000);

    child.stdout.on("data", (chunk) => {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      stdoutBytes += buf.length;
      if (stdoutBytes > AO_STDOUT_MAX_BYTES) {
        capBreached = "stdout";
        if (pid) killInfo = terminateProcessTree(pid);
        return;
      }
      stdout += buf.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      stderrBytes += buf.length;
      if (stderrBytes > AO_STDERR_MAX_BYTES) {
        capBreached = "stderr";
        if (pid) killInfo = terminateProcessTree(pid);
        return;
      }
      stderr += buf.toString("utf8");
    });

    child.on("error", (err) => {
      failHard("D070_SPAWN_ERROR", err.message, { causeCode: err.code });
    });

    child.on("close", (exitCode, signal) => {
      clearTimeout(timer);
      if (pid) {
        try {
          if (timedOut || capBreached) {
            assertTreeReaped(pid);
          } else if (processExists(pid)) {
            // should not happen after close
          }
        } catch (reapErr) {
          failHard(reapErr.code || "D070_TREE_NOT_REAPED", reapErr.message);
          return;
        }
      }

      const meta = {
        exitCode: exitCode === null ? null : exitCode,
        signal: signal || null,
        timedOut,
        capBreached,
        stdoutBytes,
        stderrBytes,
        stdoutSha256: sha256Utf8(stdout),
        stderrSha256: sha256Utf8(stderr),
        killInfo,
        pid: pid || null,
        promptSha256: sha256Utf8(prompt),
        identity,
        argv: [
          bound.nodeRealPath,
          bound.launcherRealPath,
          "--ask-for-approval",
          "never",
          "-c",
          'permission_profile=":read-only"',
          "exec",
          "--cd",
          worktreePath,
          "--ephemeral",
          "--ignore-user-config",
          "--color",
          "never",
          "--json",
          "--output-schema",
          schemaPath,
          `<FIXED_PROMPT_SHA256:${sha256Utf8(prompt)}>`,
        ],
      };

      if (timedOut) {
        finish({
          ok: false,
          code: "D070_AO_TIMEOUT",
          stdout,
          stderr,
          meta,
        });
        return;
      }
      if (capBreached) {
        finish({
          ok: false,
          code: "D070_AO_OUTPUT_CAP",
          stdout,
          stderr,
          meta,
        });
        return;
      }
      finish({
        ok: exitCode === 0,
        code: exitCode === 0 ? null : "D070_AO_EXIT",
        stdout,
        stderr,
        meta,
      });
    });
  });
}

/**
 * Offline helper used by tests: spawn an arbitrary node script under the same
 * tree-timeout contract (no shell, stdin ignored, caps, tree kill).
 */
function spawnTrackedNodeProcess({
  nodeExecutablePath,
  scriptPath,
  scriptArgs = [],
  cwd,
  env,
  timeoutSeconds,
  stdoutMaxBytes = AO_STDOUT_MAX_BYTES,
  stderrMaxBytes = AO_STDERR_MAX_BYTES,
}) {
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let timedOut = false;
    let capBreached = null;
    let settled = false;
    let killInfo = null;

    const child = spawn(nodeExecutablePath, [scriptPath, ...scriptArgs], {
      cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      shell: false,
      detached: process.platform !== "win32",
    });
    const pid = child.pid;

    const timer = setTimeout(() => {
      timedOut = true;
      if (pid) killInfo = terminateProcessTree(pid);
    }, Math.max(1, timeoutSeconds) * 1000);

    function finish(payload) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(payload);
    }

    child.stdout.on("data", (chunk) => {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      stdoutBytes += buf.length;
      if (stdoutBytes > stdoutMaxBytes) {
        capBreached = "stdout";
        if (pid) killInfo = terminateProcessTree(pid);
        return;
      }
      stdout += buf.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      stderrBytes += buf.length;
      if (stderrBytes > stderrMaxBytes) {
        capBreached = "stderr";
        if (pid) killInfo = terminateProcessTree(pid);
        return;
      }
      stderr += buf.toString("utf8");
    });
    child.on("error", reject);
    child.on("close", (exitCode) => {
      clearTimeout(timer);
      let reapOk = true;
      let reapError = null;
      if (pid && (timedOut || capBreached)) {
        try {
          assertTreeReaped(pid);
        } catch (err) {
          reapOk = false;
          reapError = err.message;
        }
      }
      finish({
        exitCode,
        timedOut,
        capBreached,
        stdout,
        stderr,
        stdoutBytes,
        stderrBytes,
        pid,
        killInfo,
        reapOk,
        reapError,
        launcherAlive: pid ? processExists(pid) : false,
      });
    });
  });
}

module.exports = {
  snapshotAoEnv,
  bindCodexProgram,
  revalidateCodexIdentity,
  spawnAoProcess,
  spawnTrackedNodeProcess,
  terminateProcessTree,
  assertTreeReaped,
  processExists,
  listDescendantPidsWindows,
  sha256Utf8,
  probeCodexVersion,
};
