"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const {
  staticRelativeRequires,
  verifyPackageClosure,
} = require("../lib/semantic-kernel/package-closure");
const { scanText } = require("../lib/semantic-kernel/release-negative-scan");
const { ROOT } = require("./helpers/cli");

function npmInvocation(args) {
  const candidates = [
    process.env.npm_execpath,
    path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js"),
  ].filter(Boolean);
  const npmExecPath = candidates.find((candidate) => fs.existsSync(candidate));
  if (npmExecPath) return { command: process.execPath, args: [npmExecPath, ...args] };
  return { command: process.platform === "win32" ? "npm.cmd" : "npm", args };
}

function isolatedNpmEnvironment(root) {
  const home = path.join(root, "home");
  const cache = path.join(root, "cache");
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(cache, { recursive: true });
  return {
    ...process.env,
    HOME: home,
    USERPROFILE: home,
    npm_config_cache: cache,
    npm_config_userconfig: path.join(root, "empty-npmrc"),
    npm_config_audit: "false",
    npm_config_fund: "false",
    npm_config_offline: "true",
  };
}

function runNpm(args, options = {}) {
  const invocation = npmInvocation(args);
  const result = spawnSync(invocation.command, invocation.args, {
    cwd: options.cwd || ROOT,
    env: options.env || process.env,
    encoding: "utf8",
    shell: false,
    timeout: options.timeout || 120000,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    throw new Error(`npm ${args.join(" ")} failed: ${String(result.stderr || result.error?.message || "unknown error").trim()}`);
  }
  return String(result.stdout || "").trim();
}

function normalizedFiles(packResult) {
  return packResult.files.map((entry) => entry.path).sort();
}

test("static relative require parser ignores dynamic and package imports", () => {
  assert.deepEqual(
    staticRelativeRequires("require('./a'); require(\"../b\"); require(name); require('node:fs'); require('./a');"),
    ["../b", "./a"],
  );
});

test("package closure rejects a source-only relative dependency", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "meta-harness-package-closure-negative-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "lib"), { recursive: true });
  fs.writeFileSync(path.join(root, "lib", "entry.js"), "module.exports = require('./missing-from-pack');\n");
  fs.writeFileSync(path.join(root, "lib", "missing-from-pack.js"), "module.exports = 1;\n");
  assert.throws(
    () => verifyPackageClosure({ packageRoot: root, packedFiles: ["lib/entry.js"] }),
    (error) => error.code === "PACKAGE_CLOSURE_DEPENDENCY_MISSING",
  );
});

test("0.4 tarball ships the product path without the historical command console", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "meta-harness-package-gate-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const packRoot = path.join(root, "pack");
  const projectRoot = path.join(root, "project");
  fs.mkdirSync(packRoot, { recursive: true });
  fs.mkdirSync(projectRoot, { recursive: true });
  fs.writeFileSync(path.join(root, "empty-npmrc"), "", "utf8");
  const env = isolatedNpmEnvironment(root);
  delete env.META_HARNESS_INTERNAL_CLI;

  const dry = JSON.parse(runNpm(["pack", "--dry-run", "--ignore-scripts", "--json"], { env }));
  assert.equal(dry.length, 1);
  assert.equal(dry[0].version, "0.4.0");
  const dryFiles = normalizedFiles(dry[0]);
  const closure = verifyPackageClosure({ packageRoot: ROOT, packedFiles: dryFiles });
  assert.ok(closure.javascriptEntryCount > 0);
  assert.ok(closure.staticRelativeDependencyCount > 0);
  const retiredIssues = dryFiles.flatMap((relativePath) => {
    if (!relativePath.endsWith(".js")) return [];
    return scanText(`package/${relativePath}`, fs.readFileSync(path.join(ROOT, relativePath), "utf8"));
  });
  const retiredAuthorityIssues = retiredIssues.filter((issue) => issue.code === "RETIRED_TOKEN_PRESENT");
  assert.deepEqual(retiredAuthorityIssues, []);
  for (const sourceOnly of [
    "lib/semantic-kernel/certification.js",
    "lib/semantic-kernel/package-closure.js",
    "lib/semantic-kernel/release-negative-scan.js",
  ]) assert.equal(dryFiles.includes(sourceOnly), false, sourceOnly);

  const packed = JSON.parse(runNpm([
    "pack",
    "--ignore-scripts",
    "--json",
    "--pack-destination",
    packRoot,
  ], { env }));
  assert.equal(packed.length, 1);
  const tarballs = fs.readdirSync(packRoot).filter((entry) => entry.endsWith(".tgz"));
  assert.equal(tarballs.length, 1);
  assert.deepEqual(normalizedFiles(packed[0]), dryFiles);
  assert.equal(packed[0].version, "0.4.0");

  for (const forbidden of ["internal/", "scripts/", "tests/", ".github/", "docs/ops/audits/archive-0.3-tests/"]) {
    assert.equal(dryFiles.some((entry) => entry.startsWith(forbidden)), false, forbidden);
  }

  fs.writeFileSync(path.join(projectRoot, "package.json"), "{\"name\":\"package-gate\",\"private\":true}\n", "utf8");
  const tarballPath = path.join(packRoot, tarballs[0]);
  const tarballBytes = fs.readFileSync(tarballPath);
  runNpm([
    "install",
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
    "--offline",
    tarballPath,
  ], { cwd: projectRoot, env, timeout: 180000 });

  const installedRoot = path.join(projectRoot, "node_modules", "@nkgss", "meta-harness");
  const installedPackage = JSON.parse(fs.readFileSync(path.join(installedRoot, "package.json"), "utf8"));
  assert.equal(installedPackage.version, "0.4.0");
  assert.equal(fs.existsSync(path.join(installedRoot, "lib", "semantic-kernel", "certification.js")), false);
  const installedExecutable = [
    "lib/execution-custody/execute.js",
    "lib/semantic-kernel/evidence-runtime.js",
    "lib/semantic-kernel/semantic-controller.js",
    "lib/semantic-kernel/slice-authorization.js",
    "lib/semantic-kernel/slice-state.js",
  ].map((relativePath) => fs.readFileSync(path.join(installedRoot, relativePath), "utf8")).join("\n");
  for (const token of ["CERTIFICATION_PREPARE", "CERTIFICATION_ASSESS", "CERTIFICATION_VERIFIED", "produceCertificationEvidence", "repository-application"]) {
    assert.equal(installedExecutable.includes(token), false, token);
  }
  const installedHandlers = fs.readdirSync(path.join(installedRoot, "lib", "commands")).sort();
  assert.deepEqual(installedHandlers, ["work.js"]);
  const registry = require(path.join(installedRoot, "lib", "command-registry.js"));
  assert.equal(registry.commandRegistry().every((entry) => entry.internal), true);

  const help = spawnSync(process.execPath, [path.join(installedRoot, "bin", "meta-harness.js"), "--help"], {
    cwd: projectRoot,
    env,
    encoding: "utf8",
    shell: false,
    timeout: 30000,
  });
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /meta-harness "<result>"/);
  assert.doesNotMatch(help.stdout, /meta-harness work|worker-report|governance|--resume|--session/);

  const retiredCommand = spawnSync(process.execPath, [path.join(installedRoot, "bin", "meta-harness.js"), "work"], {
    cwd: projectRoot,
    env,
    encoding: "utf8",
    shell: false,
    timeout: 30000,
  });
  assert.equal(retiredCommand.status, 2);
  assert.match(retiredCommand.stderr, /'work' is internal; normal usage is meta-harness/);
  t.diagnostic(JSON.stringify({
    version: packed[0].version,
    tarball: tarballs[0],
    tarballSha256: crypto.createHash("sha256").update(tarballBytes).digest("hex"),
    tarballBytes: tarballBytes.length,
    packlistEntries: dryFiles.length,
    packlistSha256: crypto.createHash("sha256").update(JSON.stringify(dryFiles)).digest("hex"),
    dryActualPacklistsEqual: true,
    javascriptEntries: closure.javascriptEntryCount,
    staticRelativeDependencies: closure.staticRelativeDependencyCount,
    retiredAuthorityTokenScan: retiredAuthorityIssues.length === 0,
    installedCommandHandlers: installedHandlers.length,
    installedCliHelp: true,
  }));
});
