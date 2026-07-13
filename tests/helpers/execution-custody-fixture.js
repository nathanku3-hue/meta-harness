"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  createExecutionCustodyController,
  PROVIDER_ID,
  WORKER_PROFILE,
  MAX_VALIDATION_TIMEOUT_SECONDS,
  sha256File,
} = require("../../internal/execution-custody/controller");
const { absNorm } = require("../../internal/execution-custody/support");
const {
  validateExample,
  buildRunRequest: buildExampleRunRequest,
} = require("../../internal/execution-custody/example");
const { AGENT_ENV_ALLOWLIST } = require("../../internal/execution-custody/constants");
const { resolveGit, runGit } = require("./execution-custody-git");

const FROZEN_NOW = "2026-07-14T12:00:00.000Z";
const APPROVED_AT = "2026-07-14T11:30:00.000Z";
const TEST_AGENT_VERSION = "0.144.1-test";
const FIXTURE_REPOSITORY_ID = "host-neutral-message-fixture";
const FIXTURE_ALLOWED_PATH = "src/message.js";
const OBJECTIVE = [
  "Replace src/message.js with a CommonJS module exporting formatMessage(name = 'world').",
  "Trim the string form of name, return 'hello world' when the trimmed value is empty,",
  "and otherwise return 'hello ' followed by the trimmed value.",
  "Do not modify any other file and do not use network access.",
].join(" ");

const VALIDATION_ALLOW = Object.freeze([
  "HOME",
  "PATH",
  "PATHEXT",
  "SYSTEMROOT",
  "SystemRoot",
  "TEMP",
  "TMP",
  "TMPDIR",
  "USERPROFILE",
]);

function snapshotHostEnv(keys) {
  const out = {};
  for (const key of keys) {
    const value = process.env[key];
    if (value !== undefined && value !== null && String(value).length > 0) {
      out[key] = String(value);
    }
  }
  return out;
}

function validationCommands() {
  return [
    {
      argv: ["node", "--test"],
      cwdRelative: ".",
      timeoutSeconds: 60,
      networkPolicy: "denied",
      environmentPolicy: { allow: [...VALIDATION_ALLOW] },
    },
    {
      argv: [
        "node",
        "-e",
        "const {formatMessage}=require('./src/message'); if(formatMessage('  Ada  ')!=='hello Ada'||formatMessage()!=='hello world'||formatMessage('   ')!=='hello world') process.exit(1)",
      ],
      cwdRelative: ".",
      timeoutSeconds: 30,
      networkPolicy: "denied",
      environmentPolicy: { allow: [...VALIDATION_ALLOW] },
    },
  ];
}

function createFixtureLayout(options = {}) {
  const label = options.label || "execution-custody";
  const root = absNorm(fs.mkdtempSync(path.join(os.tmpdir(), `${label}-`)));
  const repositoryPath = absNorm(path.join(root, "repository"));
  const stateRoot = absNorm(path.join(root, "state"));
  const workspaceRoot = absNorm(path.join(root, "workspaces"));
  const codexHome = absNorm(path.join(root, "codex-home"));
  const exportsRoot = absNorm(path.join(root, "exports"));
  const gitExecutablePath = options.gitExecutablePath || resolveGit();

  for (const directory of [repositoryPath, stateRoot, workspaceRoot, codexHome, exportsRoot]) {
    fs.mkdirSync(directory, { recursive: true });
  }

  runGit(gitExecutablePath, repositoryPath, ["init"]);
  runGit(gitExecutablePath, repositoryPath, ["config", "core.autocrlf", "false"]);

  fs.mkdirSync(path.join(repositoryPath, "src"), { recursive: true });
  fs.mkdirSync(path.join(repositoryPath, "test"), { recursive: true });
  fs.writeFileSync(
    path.join(repositoryPath, "src", "message.js"),
    '"use strict";\n\nfunction formatMessage(name) {\n  return `hello ${name}`;\n}\n\nmodule.exports = { formatMessage };\n',
    "utf8",
  );
  fs.writeFileSync(
    path.join(repositoryPath, "test", "message.test.js"),
    '"use strict";\nconst test = require("node:test");\nconst assert = require("node:assert/strict");\nconst { formatMessage } = require("../src/message");\ntest("formats a supplied name", () => assert.equal(formatMessage("Ada"), "hello Ada"));\n',
    "utf8",
  );
  fs.writeFileSync(
    path.join(repositoryPath, "package.json"),
    `${JSON.stringify({ private: true, scripts: { test: "node --test" } }, null, 2)}\n`,
    "utf8",
  );

  runGit(gitExecutablePath, repositoryPath, ["add", "--all"]);
  runGit(gitExecutablePath, repositoryPath, ["commit", "-m", "fixture baseline"]);
  const headRevision = String(
    runGit(gitExecutablePath, repositoryPath, ["rev-parse", "HEAD"]).stdout,
  ).trim();
  const expectedBaseTree = String(
    runGit(gitExecutablePath, repositoryPath, ["rev-parse", "HEAD^{tree}"]).stdout,
  ).trim();
  let objectFormat = "sha1";
  try {
    const output = String(
      runGit(gitExecutablePath, repositoryPath, ["rev-parse", "--show-object-format"]).stdout,
    ).trim();
    if (output === "sha1" || output === "sha256") objectFormat = output;
  } catch {
    objectFormat = headRevision.length === 64 ? "sha256" : "sha1";
  }

  const launcherScriptPath = absNorm(path.resolve(
    __dirname,
    "../fixtures/execution-custody/test-agent-launcher.js",
  ));
  const nativeExecutablePath = absNorm(path.resolve(
    __dirname,
    "../fixtures/execution-custody/test-agent-native-stub.js",
  ));

  return {
    root,
    repositoryPath,
    stateRoot,
    workspaceRoot,
    codexHome,
    exportsRoot,
    gitExecutablePath,
    headRevision,
    expectedBaseTree,
    objectFormat,
    launcherScriptPath,
    nativeExecutablePath,
    trustedRepository: {
      repositoryId: FIXTURE_REPOSITORY_ID,
      repositoryPath,
    },
    cleanup() {
      try {
        fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
      } catch {
        // best effort
      }
    },
  };
}

function buildExample(layout) {
  return validateExample({
    schemaVersion: "bounded-repository-change-example/v1",
    exampleId: "host-neutral-message",
    repository: {
      repositoryId: FIXTURE_REPOSITORY_ID,
      objectFormat: layout.objectFormat,
      expectedBaseRevision: layout.headRevision,
      expectedBaseTree: layout.expectedBaseTree,
    },
    allowedPath: FIXTURE_ALLOWED_PATH,
    objective: OBJECTIVE,
    validationCapsule: {
      commandName: "node",
      commands: validationCommands(),
    },
  });
}

function buildRunRequest(layout, options = {}) {
  return buildExampleRunRequest(buildExample(layout), {
    runId: options.runId || "RUN-CUSTODY-FIXTURE",
    approvalId: options.approvalId || "APPROVAL-CUSTODY-FIXTURE",
    authorizationId: options.authorizationId || "AUTH-CUSTODY-FIXTURE",
    attemptId: options.attemptId || "ATTEMPT-CUSTODY-FIXTURE",
    approvedAt: options.approvedAt || APPROVED_AT,
    approvedBy: options.approvedBy || "test@meta-harness.local",
  }).request;
}

function buildControllerConfig(layout, options = {}) {
  const commands = validationCommands();
  return {
    trustedRepository: { ...layout.trustedRepository },
    stateRoot: layout.stateRoot,
    workspaceRoot: layout.workspaceRoot,
    authorizationPolicy: {
      authorizationTtlSeconds: 3600,
      maxReadinessAgeSeconds: 7200,
      maxCommandTimeoutSeconds: MAX_VALIDATION_TIMEOUT_SECONDS,
      provider: { id: PROVIDER_ID, workerProfile: WORKER_PROFILE },
      workspacePolicy: {
        schemaVersion: "workspace-policy/v1",
        approvedRoot: layout.workspaceRoot,
      },
    },
    clock: options.clock || (() => FROZEN_NOW),
    agentProgram: {
      workerProfile: WORKER_PROFILE,
      nodeExecutablePath: absNorm(process.execPath),
      launcherScriptPath: layout.launcherScriptPath,
      expectedLauncherSha256: sha256File(layout.launcherScriptPath),
      nativeExecutablePath: layout.nativeExecutablePath,
      expectedNativeSha256: sha256File(layout.nativeExecutablePath),
      expectedVersion: TEST_AGENT_VERSION,
      codexHome: layout.codexHome,
      hostEnv: snapshotHostEnv(AGENT_ENV_ALLOWLIST),
    },
    validationProgram: {
      commandName: "node",
      executablePath: absNorm(process.execPath),
      expectedExecutableSha256: sha256File(process.execPath),
      hostEnv: snapshotHostEnv(VALIDATION_ALLOW),
      expectedCommands: commands,
      versionArgs: ["--version"],
      expectedVersion: process.version,
      versionEnvironmentAllow: [...VALIDATION_ALLOW],
    },
  };
}

function buildUnusableReplayConfig(layout) {
  const missingRoot = absNorm(path.join(layout.root, "unusable-tools"));
  const commands = validationCommands();
  return {
    ...buildControllerConfig(layout),
    agentProgram: {
      workerProfile: WORKER_PROFILE,
      nodeExecutablePath: absNorm(path.join(missingRoot, "node")),
      launcherScriptPath: absNorm(path.join(missingRoot, "agent.js")),
      expectedLauncherSha256: "0".repeat(64),
      nativeExecutablePath: absNorm(path.join(missingRoot, "native")),
      expectedNativeSha256: "1".repeat(64),
      expectedVersion: "unusable",
      codexHome: absNorm(path.join(missingRoot, "home")),
      hostEnv: {},
    },
    validationProgram: {
      commandName: "node",
      executablePath: absNorm(path.join(missingRoot, "validator")),
      expectedExecutableSha256: "2".repeat(64),
      hostEnv: {},
      expectedCommands: commands,
    },
  };
}

module.exports = {
  createFixtureLayout,
  buildExample,
  buildRunRequest,
  buildControllerConfig,
  buildUnusableReplayConfig,
  createExecutionCustodyController,
  FIXTURE_REPOSITORY_ID,
  FIXTURE_ALLOWED_PATH,
  OBJECTIVE,
  FROZEN_NOW,
  APPROVED_AT,
  validationCommands,
};
