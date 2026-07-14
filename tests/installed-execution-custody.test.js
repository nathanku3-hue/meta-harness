"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const { computeRunSpecDigest } = require("../lib/contracts/run-spec");
const { sealRunSpecApproval } = require("../lib/contracts/run-spec-approval");
const { resolveGit, gitEnv, runGit } = require("./helpers/execution-custody-git");

const ROOT = path.resolve(__dirname, "..");
const ALLOWED_PATH = "src/message.js";
const LONG_PATH_SEGMENT = "committed-long-path-regression-segment-xxxxxxxx";
const TEST_AGENT_VERSION = "0.144.1-test";
const VALIDATION_ALLOW = [
  "HOME", "PATH", "PATHEXT", "SYSTEMROOT", "SystemRoot", "TEMP", "TMP", "TMPDIR", "USERPROFILE",
];

function sha256File(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function snapshotEnv(keys, environment = process.env) {
  const result = {};
  for (const key of keys) {
    const value = environment[key];
    if (value !== undefined && value !== null && String(value).length > 0) result[key] = String(value);
  }
  return result;
}

function isInsidePath(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function consumerEnvironment(overrides = {}) {
  const result = { ...process.env, ...overrides };
  for (const [key, value] of Object.entries(result)) {
    if (key.toUpperCase() !== "PATH" || typeof value !== "string") continue;
    result[key] = value
      .split(path.delimiter)
      .filter(Boolean)
      .filter((entry) => !isInsidePath(ROOT, path.resolve(entry)))
      .join(path.delimiter);
  }
  return result;
}

function run(program, args, options = {}) {
  const result = spawnSync(program, args, {
    cwd: options.cwd,
    env: options.env || process.env,
    encoding: "utf8",
    windowsHide: true,
    timeout: options.timeout || 420_000,
    maxBuffer: 16 * 1024 * 1024,
    shell: options.shell || false,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `${program} ${args.join(" ")} failed ${result.status}: ${String(result.stderr || result.stdout || "").trim()}`,
    );
  }
  return result;
}

function npmCliPath() {
  return path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js");
}

function runCommandScript(scriptPath, args, options = {}) {
  return run(scriptPath, args, { ...options, shell: true });
}

function writeSourceRepository(root) {
  const repositoryPath = path.join(root, "source-repository");
  fs.mkdirSync(path.join(repositoryPath, "src"), { recursive: true });
  fs.mkdirSync(path.join(repositoryPath, "test"), { recursive: true });
  fs.writeFileSync(
    path.join(repositoryPath, ALLOWED_PATH),
    '"use strict";\n\nfunction formatMessage(name) {\n  return `hello ${name}`;\n}\n\nmodule.exports = { formatMessage };\n',
    "utf8",
  );
  fs.writeFileSync(
    path.join(repositoryPath, "test", "message.test.js"),
    '"use strict";\nconst test = require("node:test");\nconst assert = require("node:assert/strict");\nconst { formatMessage } = require("../src/message");\ntest("formats names", () => assert.equal(formatMessage("Ada"), "hello Ada"));\n',
    "utf8",
  );
  fs.writeFileSync(
    path.join(repositoryPath, "package.json"),
    `${JSON.stringify({ private: true, scripts: { test: "node --test" } }, null, 2)}\n`,
    "utf8",
  );
  const longTrackedRelativePath = path.join(
    "data",
    `${LONG_PATH_SEGMENT}-01`,
    `${LONG_PATH_SEGMENT}-02`,
    `${LONG_PATH_SEGMENT}-03`,
    `${LONG_PATH_SEGMENT}-04`,
    `${LONG_PATH_SEGMENT}-05`,
    "sentinel.txt",
  );
  const longTrackedPath = path.join(repositoryPath, longTrackedRelativePath);
  assert.ok(longTrackedPath.length > 260, `expected Windows long path, got ${longTrackedPath.length}`);
  fs.mkdirSync(path.dirname(longTrackedPath), { recursive: true });
  fs.writeFileSync(longTrackedPath, "committed long-path sentinel\n", "utf8");

  const gitExecutablePath = resolveGit();
  runGit(gitExecutablePath, repositoryPath, ["init"]);
  runGit(gitExecutablePath, repositoryPath, ["config", "core.autocrlf", "false"]);
  if (process.platform === "win32") {
    runGit(gitExecutablePath, repositoryPath, ["config", "core.longpaths", "true"]);
  }
  runGit(gitExecutablePath, repositoryPath, ["add", "--all"]);
  runGit(
    gitExecutablePath,
    repositoryPath,
    ["commit", "-m", "installed execution base"],
    {
      ...gitEnv("meta-harness-installed-execution-fixture"),
      GIT_AUTHOR_DATE: "2026-07-15T00:00:00+08:00",
      GIT_COMMITTER_DATE: "2026-07-15T00:00:00+08:00",
    },
  );
  const baseRevision = String(
    runGit(gitExecutablePath, repositoryPath, ["rev-parse", "HEAD"]).stdout,
  ).trim();
  const baseTree = String(
    runGit(gitExecutablePath, repositoryPath, ["rev-parse", "HEAD^{tree}"]).stdout,
  ).trim();
  let objectFormat = baseRevision.length === 64 ? "sha256" : "sha1";
  try {
    const observed = String(
      runGit(gitExecutablePath, repositoryPath, ["rev-parse", "--show-object-format"]).stdout,
    ).trim();
    if (observed === "sha1" || observed === "sha256") objectFormat = observed;
  } catch {
    // Hash-length fallback above.
  }

  fs.writeFileSync(
    path.join(repositoryPath, ALLOWED_PATH),
    '"use strict";\nmodule.exports = { formatMessage: () => "DIRTY SOURCE BYTES MUST NOT ENTER CUSTODY" };\n',
    "utf8",
  );
  fs.writeFileSync(path.join(repositoryPath, "untracked-source-sentinel.txt"), "dirty\n", "utf8");
  return {
    repositoryPath,
    gitExecutablePath,
    baseRevision,
    baseTree,
    objectFormat,
    longTrackedRelativePath,
  };
}

function writeToolRoot(root) {
  const toolRoot = path.join(root, "unrelated-tools");
  const codexHome = path.join(toolRoot, "codex-home");
  fs.mkdirSync(codexHome, { recursive: true });
  const nodePath = path.join(toolRoot, path.basename(process.execPath));
  const launcherPath = path.join(toolRoot, "test-agent-launcher.js");
  const nativePath = path.join(toolRoot, "test-agent-native-stub.js");
  fs.copyFileSync(process.execPath, nodePath);
  fs.copyFileSync(
    path.join(ROOT, "tests", "fixtures", "execution-custody", "test-agent-launcher.js"),
    launcherPath,
  );
  fs.copyFileSync(
    path.join(ROOT, "tests", "fixtures", "execution-custody", "test-agent-native-stub.js"),
    nativePath,
  );
  fs.copyFileSync(
    path.join(ROOT, "tests", "fixtures", "execution-custody", "known-good-message.js"),
    path.join(toolRoot, "known-good-message.js"),
  );
  return { toolRoot, codexHome, nodePath, launcherPath, nativePath };
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

function writePublicRequest(root, source, tools, custodyRoot, environment) {
  const runSpec = {
    schemaVersion: "run-spec/v1",
    runId: "RUN-INSTALLED-EXECUTION-001",
    repository: {
      repositoryId: "installed-novel-repository",
      objectFormat: source.objectFormat,
      expectedBaseRevision: source.baseRevision,
    },
    objective: [
      "Replace src/message.js with a CommonJS module exporting formatMessage(name = 'world').",
      "Trim the string form of name, return 'hello world' when the trimmed value is empty,",
      "and otherwise return 'hello ' followed by the trimmed value.",
      "Do not modify any other file and do not use network access.",
    ].join(" "),
    scope: { allow: [ALLOWED_PATH], deny: [] },
    validation: { commands: validationCommands() },
    changePolicy: "forbid-noop",
  };
  const runSpecDigest = computeRunSpecDigest(runSpec);
  const request = {
    schemaVersion: "meta-harness-execution-request/v1",
    executionId: "installed-execution-001",
    sourceRepositoryPath: source.repositoryPath,
    custodyRoot,
    expectedBaseTree: source.baseTree,
    runRequest: {
      runSpecApproval: sealRunSpecApproval({
        schemaVersion: "run-spec-approval/v1",
        approvalId: "APPROVAL-INSTALLED-EXECUTION-001",
        approvedBy: "installed-test@meta-harness.local",
        approvedAt: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
        runSpec,
        runSpecDigest,
      }),
      authorizationRequest: {
        authorizationId: "AUTH-INSTALLED-EXECUTION-001",
        attemptId: "ATTEMPT-INSTALLED-EXECUTION-001",
      },
    },
    agentProgram: {
      nodeExecutablePath: tools.nodePath,
      expectedNodeSha256: sha256File(tools.nodePath),
      launcherScriptPath: tools.launcherPath,
      expectedLauncherSha256: sha256File(tools.launcherPath),
      nativeExecutablePath: tools.nativePath,
      expectedNativeSha256: sha256File(tools.nativePath),
      expectedVersion: TEST_AGENT_VERSION,
      codexHome: tools.codexHome,
    },
    validationProgram: {
      commandName: "node",
      executablePath: tools.nodePath,
      expectedExecutableSha256: sha256File(tools.nodePath),
      hostEnv: snapshotEnv(VALIDATION_ALLOW, environment),
      sensitiveValues: ["CALLER-SUPPLIED-SECRET-SENTINEL"],
    },
  };
  const requestPath = path.join(root, "execution-request.json");
  fs.writeFileSync(requestPath, `${JSON.stringify(request, null, 2)}\n`, "utf8");
  return { request, requestPath };
}

function collectFiles(root) {
  const files = [];
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.isFile()) files.push(full);
    }
  }
  return files;
}

function assertTextAbsent(text, values, label) {
  for (const value of values.filter(Boolean).map(String)) {
    const escaped = JSON.stringify(value).slice(1, -1);
    assert.equal(text.includes(value), false, `${label} retained ${value}`);
    if (escaped) assert.equal(text.includes(escaped), false, `${label} retained escaped ${value}`);
  }
}

test("packed isolated installation executes VERIFIED, expired zero-spawn REPLAY, portable validation, and receipt", {
  skip: process.platform !== "win32",
  timeout: 420_000,
}, (t) => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "meta-harness-installed-execute-"));
  try {
    const source = writeSourceRepository(tempRoot);
    const sourceStatusBefore = String(
      runGit(source.gitExecutablePath, source.repositoryPath, ["status", "--porcelain", "-uall"]).stdout,
    ).trim();
    const sourceHeadBefore = String(
      runGit(source.gitExecutablePath, source.repositoryPath, ["rev-parse", "HEAD"]).stdout,
    ).trim();
    assert.notEqual(sourceStatusBefore, "");

    const tools = writeToolRoot(tempRoot);
    t.diagnostic(JSON.stringify({
      sourceRepository: {
        objectFormat: source.objectFormat,
        baseRevision: source.baseRevision,
        baseTree: source.baseTree,
        allowedPath: ALLOWED_PATH,
      },
      fakeTools: {
        nodeSha256: sha256File(tools.nodePath),
        launcherSha256: sha256File(tools.launcherPath),
        nativeSha256: sha256File(tools.nativePath),
        expectedVersion: TEST_AGENT_VERSION,
      },
    }));
    const packDir = path.join(tempRoot, "pack");
    fs.mkdirSync(packDir);
    const pack = run(process.execPath, [
      npmCliPath(), "pack", "--json", "--ignore-scripts", "--pack-destination", packDir,
    ], { cwd: ROOT, timeout: 180_000 });
    const packResult = JSON.parse(pack.stdout);
    assert.equal(packResult.length, 1);
    const tarballPath = path.join(packDir, packResult[0].filename);
    assert.equal(fs.existsSync(tarballPath), true);

    const installRoot = path.join(tempRoot, "consumer");
    fs.mkdirSync(installRoot);
    fs.writeFileSync(
      path.join(installRoot, "package.json"),
      `${JSON.stringify({ name: "meta-harness-installed-consumer", private: true }, null, 2)}\n`,
      "utf8",
    );
    run(process.execPath, [
      npmCliPath(), "install", "--ignore-scripts", "--no-audit", "--no-fund", "--package-lock=false", tarballPath,
    ], { cwd: installRoot, timeout: 240_000 });

    const installedPackage = path.join(installRoot, "node_modules", "meta-harness");
    assert.equal(fs.existsSync(path.join(installedPackage, ".git")), false);
    assert.equal(fs.existsSync(path.join(installedPackage, "internal")), false);
    assert.equal(fs.existsSync(path.join(installedPackage, "scripts")), false);
    assert.equal(fs.existsSync(path.join(installedPackage, ".agents")), false);
    assert.equal(fs.existsSync(path.join(installedPackage, "lib", "commands", "execute.js")), true);
    for (const name of [
      "execute.js", "controller-process.js", "portable-verifier.js", "controller.js", "attempt.js",
    ]) {
      assert.equal(fs.existsSync(path.join(installedPackage, "lib", "execution-custody", name)), true, name);
    }
    for (const name of ["operator.js", "operator-process.js", "example.js"]) {
      assert.equal(fs.existsSync(path.join(installedPackage, "lib", "execution-custody", name)), false, name);
    }

    const installedBin = path.join(installRoot, "node_modules", ".bin", "meta-harness.cmd");
    const help = runCommandScript(installedBin, ["--help"], { cwd: installRoot });
    assert.equal(
      help.stdout.split("meta-harness execute --request <absolute-path> [--json]").length - 1,
      1,
    );

    const requestRoot = path.join(tempRoot, "user-request");
    const custodyParent = path.join(tempRoot, "custody-parent");
    fs.mkdirSync(requestRoot);
    fs.mkdirSync(custodyParent);
    const custodyRoot = path.join(custodyParent, "custody");
    const executionEnv = consumerEnvironment({ META_HARNESS_DEBUG: "1" });
    const { request, requestPath } = writePublicRequest(
      requestRoot,
      source,
      tools,
      custodyRoot,
      executionEnv,
    );
    const execution = runCommandScript(
      installedBin,
      ["execute", "--request", requestPath, "--json"],
      {
        cwd: installRoot,
        timeout: 420_000,
        env: executionEnv,
      },
    );
    const result = JSON.parse(execution.stdout);
    assert.deepEqual(Object.keys(result), [
      "schemaVersion", "ok", "executionId", "disposition", "verifiedHeadRevision",
      "durableRef", "receiptPath", "portableExportPath", "replay",
    ]);
    assert.equal(result.schemaVersion, "meta-harness-execute-result/v1");
    assert.equal(result.ok, true);
    assert.equal(result.executionId, request.executionId);
    assert.equal(result.disposition, "VERIFIED");
    assert.match(result.verifiedHeadRevision, source.objectFormat === "sha256" ? /^[a-f0-9]{64}$/ : /^[a-f0-9]{40}$/);
    assert.match(result.durableRef, /^refs\/meta-harness\/attempts\/[a-f0-9]{64}$/);
    assert.deepEqual(result.replay, { disposition: "REPLAY", agentSpawnCount: 0 });

    const receipt = JSON.parse(fs.readFileSync(result.receiptPath, "utf8"));
    assert.equal(receipt.schemaVersion, "meta-harness-execution-receipt/v1");
    assert.equal(receipt.authority.headRevision, source.baseRevision);
    assert.equal(receipt.authority.tree, source.baseTree);
    assert.equal(receipt.authority.visibleRevisionCount, 1);
    assert.equal(receipt.authority.shallowBoundary, source.baseRevision);
    assert.equal(receipt.authority.remoteCount, 0);
    assert.equal(receipt.process1.disposition, "VERIFIED");
    assert.equal(receipt.process1.agentSpawnCount, 1);
    assert.equal(receipt.process1.verifiedHeadRevision, result.verifiedHeadRevision);
    assert.equal(receipt.process2.disposition, "REPLAY");
    assert.equal(receipt.process2.agentSpawnCount, 0);
    assert.equal(receipt.process2.secondsAfterAuthorizationExpiry, 60);
    assert.equal(receipt.process2.unusableToolCanaryPassed, true);
    assert.equal(receipt.portable.independent.resultCommit, result.verifiedHeadRevision);
    assert.equal(receipt.portable.independent.parent, source.baseRevision);
    assert.deepEqual(receipt.portable.independent.changed, [ALLOWED_PATH]);
    assert.equal(receipt.portable.independent.validation.every((entry) => entry.exitCode === 0), true);
    assert.equal(receipt.portable.independent.leakage, "PASS");
    assert.equal(receipt.executableIdentities.node.expectedSha256, sha256File(tools.nodePath));
    assert.equal(receipt.executableIdentities.node.observedSha256, sha256File(tools.nodePath));
    assert.equal(receipt.executableIdentities.launcher.expectedSha256, sha256File(tools.launcherPath));
    assert.equal(receipt.executableIdentities.nativeAgent.expectedSha256, sha256File(tools.nativePath));
    assert.equal(receipt.executableIdentities.validation.expectedSha256, sha256File(tools.nodePath));
    assert.equal(receipt.executableIdentities.observedAgentVersion, TEST_AGENT_VERSION);
    assert.equal(
      fs.readFileSync(path.join(custodyRoot, "repository", source.longTrackedRelativePath), "utf8"),
      "committed long-path sentinel\n",
    );
    assert.equal(
      fs.readFileSync(
        path.join(custodyRoot, "exports", "independent-verifier", source.longTrackedRelativePath),
        "utf8",
      ),
      "committed long-path sentinel\n",
    );

    const sourceHeadAfter = String(
      runGit(source.gitExecutablePath, source.repositoryPath, ["rev-parse", "HEAD"]).stdout,
    ).trim();
    const sourceStatusAfter = String(
      runGit(source.gitExecutablePath, source.repositoryPath, ["status", "--porcelain", "-uall"]).stdout,
    ).trim();
    assert.equal(sourceHeadAfter, sourceHeadBefore);
    assert.equal(sourceStatusAfter, sourceStatusBefore);

    const receiptWithoutAuthorizedRetainedPaths = {
      ...receipt,
      retained: {
        custodyRoot: "<authorized-host-local-custody-root>",
        receiptPath: "<authorized-host-local-receipt-path>",
      },
    };
    const receiptText = JSON.stringify(receiptWithoutAuthorizedRetainedPaths);
    assertTextAbsent(receiptText, [
      source.repositoryPath,
      installedPackage,
      tools.nodePath,
      tools.launcherPath,
      tools.nativePath,
      tools.codexHome,
      ...Object.values(request.validationProgram.hostEnv),
      ...request.validationProgram.sensitiveValues,
    ], "public receipt outside authorized retained paths");

    const sourceCheckoutSentinel = ROOT;
    for (const filePath of collectFiles(custodyRoot)) {
      const bytes = fs.readFileSync(filePath);
      const text = bytes.toString("utf8");
      assertTextAbsent(text, [sourceCheckoutSentinel], path.relative(custodyRoot, filePath));
    }
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});
