"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const {
  PROVIDER_ID,
  WORKER_PROFILE,
  MAX_VALIDATION_TIMEOUT_SECONDS,
  sha256File,
} = require("../../internal/execution-custody/controller");
const { absNorm, digestHex } = require("../../internal/execution-custody/support");
const { AGENT_ENV_ALLOWLIST } = require("../../internal/execution-custody/constants");
const { validateExample, buildRunRequest } = require("../../internal/execution-custody/example");
const { resolveGit, runGit } = require("./execution-custody-git");

const DEFAULT_FLUXARA_SOURCE = "E:\\code\\Fluxara";
const EXAMPLE_PATH = path.resolve(
  __dirname,
  "../../.agents/skills/bounded-repository-change/examples/fluxara-demo-output.json",
);

function sha256Utf8(value) {
  return crypto.createHash("sha256").update(String(value), "utf8").digest("hex");
}

function snapshotHostEnv(keys) {
  const result = {};
  for (const key of keys) {
    const value = process.env[key];
    if (value !== undefined && value !== null && String(value).length > 0) {
      result[key] = String(value);
    }
  }
  return result;
}

function packageTreeDigest(root) {
  const hash = crypto.createHash("sha256");
  function visit(directory, relative = "") {
    const entries = fs.readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.name !== "__pycache__" && !entry.name.endsWith(".pyc"))
      .sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const childRelative = relative ? `${relative}/${entry.name}` : entry.name;
      const child = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        hash.update(`D\0${childRelative}\0`);
        visit(child, childRelative);
      } else if (entry.isFile()) {
        hash.update(`F\0${childRelative}\0`);
        hash.update(fs.readFileSync(child));
        hash.update("\0");
      } else {
        throw new Error(`unsupported validation dependency entry: ${child}`);
      }
    }
  }
  visit(root);
  return hash.digest("hex");
}

function buildPythonValidationHostEnv(example, tools, clone) {
  const validationAllow = [...new Set(
    example.validationCapsule.commands.flatMap((command) => command.environmentPolicy.allow),
  )];
  const hostEnv = snapshotHostEnv(validationAllow);
  const packageProbe = spawnSync(
    tools.pythonPath,
    ["-c", "from pathlib import Path; import pygments; print(Path(pygments.__file__).parent)"],
    { encoding: "utf8", windowsHide: true, timeout: 15_000, env: process.env },
  );
  if (packageProbe.error || packageProbe.status !== 0) {
    throw new Error(`Pygments package probe failed: ${String(packageProbe.stderr || packageProbe.stdout || "").trim()}`);
  }
  const sourcePackage = absNorm(String(packageProbe.stdout || "").trim());
  if (!fs.existsSync(sourcePackage) || !fs.statSync(sourcePackage).isDirectory()) {
    throw new Error(`Pygments package probe returned invalid directory: ${sourcePackage}`);
  }

  const capsuleRoot = absNorm(path.join(clone.root, "validation-pythonpath"));
  const targetPackage = path.join(capsuleRoot, "pygments");
  if (!fs.existsSync(targetPackage)) {
    fs.mkdirSync(capsuleRoot, { recursive: false });
    fs.cpSync(sourcePackage, targetPackage, {
      recursive: true,
      errorOnExist: true,
      force: false,
      filter: (candidate) => {
        const name = path.basename(candidate);
        return name !== "__pycache__" && !name.endsWith(".pyc");
      },
    });
  }
  const sourceDigest = packageTreeDigest(sourcePackage);
  const capsuleDigest = packageTreeDigest(targetPackage);
  if (sourceDigest !== capsuleDigest) {
    throw new Error("Pygments validation capsule digest differs from its source package");
  }

  hostEnv.PYTHONPATH = capsuleRoot;
  const importProbe = spawnSync(
    tools.pythonPath,
    ["-c", "import pygments, pytest, uuid; assert 'validation-pythonpath' in pygments.__file__; assert hasattr(uuid, 'uuid4')"],
    { encoding: "utf8", windowsHide: true, timeout: 15_000, env: hostEnv },
  );
  if (importProbe.error || importProbe.status !== 0) {
    throw new Error(`python validation environment probe failed: ${String(importProbe.stderr || importProbe.stdout || "").trim()}`);
  }
  return { hostEnv, sourcePackage, capsuleRoot, capsuleDigest };
}

function detectLiveTools() {
  const force = /^(?:1|true)$/i.test(String(process.env.D073_LIVE_CUSTODY || ""));
  const nodePath = absNorm(
    process.env.CUSTODY_NODE_PATH
      || (fs.existsSync("D:\\nodejs\\node.exe") ? "D:\\nodejs\\node.exe" : process.execPath),
  );
  const appData = process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
  const codexRoot = path.join(appData, "npm", "node_modules", "@openai", "codex");
  const launcherPath = absNorm(
    process.env.CUSTODY_CODEX_LAUNCHER || path.join(codexRoot, "bin", "codex.js"),
  );
  const nativePath = absNorm(
    process.env.CUSTODY_CODEX_NATIVE || path.join(
      codexRoot,
      "node_modules",
      "@openai",
      "codex-win32-x64",
      "vendor",
      "x86_64-pc-windows-msvc",
      "bin",
      "codex.exe",
    ),
  );
  const codexHome = absNorm(process.env.CODEX_HOME || path.join(os.homedir(), ".codex"));
  const pythonPath = absNorm(
    process.env.CUSTODY_PYTHON_PATH
      || (fs.existsSync("E:\\Python\\bin\\python.exe")
        ? "E:\\Python\\bin\\python.exe"
        : "python"),
  );
  const sourcePath = absNorm(process.env.D073_FLUXARA_SOURCE || DEFAULT_FLUXARA_SOURCE);
  const version = process.env.CUSTODY_CODEX_VERSION || "0.144.1";
  const required = [nodePath, launcherPath, nativePath, codexHome, pythonPath, sourcePath];
  return {
    force,
    available: required.every((candidate) => fs.existsSync(candidate)),
    nodePath,
    launcherPath,
    nativePath,
    codexHome,
    pythonPath,
    sourcePath,
    version,
  };
}

function loadExample() {
  return validateExample(JSON.parse(fs.readFileSync(EXAMPLE_PATH, "utf8")));
}

function clonePinnedChild({ example, sourcePath, rootPath }) {
  const gitExecutablePath = resolveGit();
  const root = absNorm(rootPath);
  if (fs.existsSync(root)) {
    throw new Error(`create-only custody root already exists: ${root}`);
  }
  fs.mkdirSync(root, { recursive: false });
  const repositoryPath = absNorm(path.join(root, "repository"));
  runGit(gitExecutablePath, root, [
    "clone",
    "--no-hardlinks",
    "--no-checkout",
    sourcePath,
    "repository",
  ]);
  runGit(gitExecutablePath, repositoryPath, ["config", "core.autocrlf", "false"]);
  runGit(gitExecutablePath, repositoryPath, ["config", "core.eol", "lf"]);
  runGit(gitExecutablePath, repositoryPath, [
    "checkout",
    "--detach",
    example.repository.expectedBaseRevision,
  ]);
  runGit(gitExecutablePath, repositoryPath, ["reset", "--hard", "HEAD"]);
  try { runGit(gitExecutablePath, repositoryPath, ["remote", "remove", "origin"]); } catch { /* absent */ }

  const headRevision = String(
    runGit(gitExecutablePath, repositoryPath, ["rev-parse", "HEAD"]).stdout,
  ).trim();
  const tree = String(
    runGit(gitExecutablePath, repositoryPath, ["rev-parse", "HEAD^{tree}"]).stdout,
  ).trim();
  const status = String(
    runGit(gitExecutablePath, repositoryPath, ["status", "--porcelain", "-uall"]).stdout,
  ).trim();
  assert.equal(headRevision, example.repository.expectedBaseRevision);
  assert.equal(tree, example.repository.expectedBaseTree);
  assert.equal(status, "");
  assert.ok(fs.existsSync(path.join(repositoryPath, ...example.allowedPath.split("/"))));

  const stateRoot = absNorm(path.join(root, "state"));
  const workspaceRoot = absNorm(path.join(root, "workspaces"));
  const exportsRoot = absNorm(path.join(root, "exports"));
  for (const directory of [stateRoot, workspaceRoot, exportsRoot]) {
    fs.mkdirSync(directory, { recursive: false });
  }
  return {
    root,
    repositoryPath,
    stateRoot,
    workspaceRoot,
    exportsRoot,
    gitExecutablePath,
    headRevision,
    tree,
  };
}

function buildRequest(example, candidateShort, clockValue) {
  const approvedAt = new Date(new Date(clockValue).getTime() - 5 * 60 * 1000).toISOString();
  return buildRunRequest(example, {
    runId: `RUN-D073-FLUXARA-${candidateShort}`,
    approvalId: `APPROVAL-D073-FLUXARA-${candidateShort}`,
    authorizationId: `AUTH-D073-FLUXARA-${candidateShort}`,
    attemptId: `ATTEMPT-D073-FLUXARA-${candidateShort}`,
    approvedAt,
    approvedBy: "d073-live@meta-harness.local",
  }).request;
}

function buildConfig({ example, clone, tools }) {
  const { hostEnv } = buildPythonValidationHostEnv(example, tools, clone);
  return {
    trustedRepository: {
      repositoryId: example.repository.repositoryId,
      repositoryPath: clone.repositoryPath,
    },
    stateRoot: clone.stateRoot,
    workspaceRoot: clone.workspaceRoot,
    authorizationPolicy: {
      authorizationTtlSeconds: 3600,
      maxReadinessAgeSeconds: 7200,
      maxCommandTimeoutSeconds: MAX_VALIDATION_TIMEOUT_SECONDS,
      provider: { id: PROVIDER_ID, workerProfile: WORKER_PROFILE },
      workspacePolicy: {
        schemaVersion: "workspace-policy/v1",
        approvedRoot: clone.workspaceRoot,
      },
    },
    agentProgram: {
      workerProfile: WORKER_PROFILE,
      nodeExecutablePath: tools.nodePath,
      launcherScriptPath: tools.launcherPath,
      expectedLauncherSha256: sha256File(tools.launcherPath),
      nativeExecutablePath: tools.nativePath,
      expectedNativeSha256: sha256File(tools.nativePath),
      expectedVersion: tools.version,
      codexHome: tools.codexHome,
      hostEnv: snapshotHostEnv(AGENT_ENV_ALLOWLIST),
    },
    validationProgram: {
      commandName: example.validationCapsule.commandName,
      executablePath: tools.pythonPath,
      expectedExecutableSha256: sha256File(tools.pythonPath),
      hostEnv,
      expectedCommands: example.validationCapsule.commands,
    },
  };
}

function buildCanaryConfig(config, root) {
  const missing = absNorm(path.join(root, "execution-tools-must-not-be-read"));
  return {
    ...config,
    agentProgram: {
      ...config.agentProgram,
      nodeExecutablePath: absNorm(path.join(missing, "node.exe")),
      launcherScriptPath: absNorm(path.join(missing, "codex.js")),
      nativeExecutablePath: absNorm(path.join(missing, "codex.exe")),
      codexHome: absNorm(path.join(missing, "codex-home")),
      expectedLauncherSha256: "0".repeat(64),
      expectedNativeSha256: "1".repeat(64),
      expectedVersion: "unusable",
      hostEnv: {},
    },
    validationProgram: {
      ...config.validationProgram,
      executablePath: absNorm(path.join(missing, "python.exe")),
      expectedExecutableSha256: "2".repeat(64),
      hostEnv: {},
    },
  };
}

function runJsonChild(scriptPath, inputPath, timeout = 420_000) {
  const child = spawnSync(process.execPath, [scriptPath, inputPath], {
    cwd: path.resolve(__dirname, "../.."),
    encoding: "utf8",
    windowsHide: true,
    timeout,
    env: process.env,
  });
  if (child.error) throw child.error;
  if (child.status !== 0) {
    throw new Error(`${path.basename(scriptPath)} failed ${child.status}: ${String(child.stderr || child.stdout || "").trim()}`);
  }
  const lines = String(child.stdout || "").trim().split(/\r?\n/).filter(Boolean);
  assert.ok(lines.length > 0, `${path.basename(scriptPath)} produced no result`);
  return JSON.parse(lines[lines.length - 1]);
}

function runControllerProcess({ clone, label, config, request, clockValue }) {
  const inputPath = path.join(clone.exportsRoot, `${label}-input.json`);
  fs.writeFileSync(inputPath, `${JSON.stringify({ config, request, clock: clockValue }, null, 2)}\n`, "utf8");
  return runJsonChild(
    path.resolve(__dirname, "execution-custody-process-child.js"),
    inputPath,
  );
}

function runIndependentVerifier({ clone, portable, result, example, tools }) {
  const inputPath = path.join(clone.exportsRoot, "independent-verifier-input.json");
  const {
    hostEnv: validationHostEnv,
    sourcePackage,
    capsuleRoot,
  } = buildPythonValidationHostEnv(example, tools, clone);
  fs.writeFileSync(inputPath, `${JSON.stringify({
    gitExecutablePath: clone.gitExecutablePath,
    sourceRepositoryPath: clone.repositoryPath,
    verifierRepositoryPath: absNorm(path.join(clone.exportsRoot, "independent-verifier")),
    exportDir: portable.exportDir,
    baseRevision: example.repository.expectedBaseRevision,
    verifiedHeadRevision: result.verifiedHeadRevision,
    durableRef: result.durableRef,
    allowedPath: example.allowedPath,
    validationExecutablePath: tools.pythonPath,
    validationCommands: example.validationCapsule.commands,
    validationHostEnv,
    sensitiveValues: [
      clone.root,
      tools.nodePath,
      tools.launcherPath,
      tools.nativePath,
      tools.codexHome,
      tools.pythonPath,
      sourcePackage,
      capsuleRoot,
    ],
  }, null, 2)}\n`, "utf8");
  return runJsonChild(
    path.resolve(__dirname, "execution-custody-export-verifier.js"),
    inputPath,
  );
}

module.exports = {
  detectLiveTools,
  buildPythonValidationHostEnv,
  loadExample,
  clonePinnedChild,
  buildRequest,
  buildConfig,
  buildCanaryConfig,
  runControllerProcess,
  runIndependentVerifier,
  sha256Utf8,
  digestHex,
};
