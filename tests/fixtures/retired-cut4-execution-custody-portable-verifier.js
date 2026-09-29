#!/usr/bin/env node
"use strict";

/** Packaged portable-custody verifier used by the installed execute command. */

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

function sha256Bytes(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function run(program, args, options = {}) {
  const result = spawnSync(program, args, {
    cwd: options.cwd,
    encoding: options.encoding === "buffer" ? "buffer" : "utf8",
    windowsHide: true,
    timeout: options.timeout || 180_000,
    env: options.env || process.env,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `${path.basename(program)} ${args.join(" ")} failed ${result.status}: ${String(result.stderr || result.stdout || "").trim()}`,
    );
  }
  return result;
}

function git(input, cwd, args, options = {}) {
  return run(
    input.gitExecutablePath,
    [
      "-c", `core.hooksPath=${process.platform === "win32" ? "NUL" : "/dev/null"}`,
      "-c", "commit.gpgsign=false",
      "-c", "core.autocrlf=false",
      ...(process.platform === "win32" ? ["-c", "core.longpaths=true"] : []),
      ...args,
    ],
    {
      cwd,
      ...options,
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: "0",
        GIT_CONFIG_NOSYSTEM: "1",
        ...(options.env || {}),
      },
    },
  );
}

function requireValidationExecutable(input) {
  assert.match(String(input.expectedValidationExecutableSha256 || ""), /^[a-f0-9]{64}$/);
  const lstat = fs.lstatSync(input.validationExecutablePath);
  assert.equal(lstat.isSymbolicLink(), false, "validation executable must not be a symlink");
  assert.equal(lstat.isFile(), true, "validation executable must be a regular file");
  const realPath = fs.realpathSync(input.validationExecutablePath);
  assert.equal(
    process.platform === "win32" ? realPath.toLowerCase() : realPath,
    process.platform === "win32"
      ? path.resolve(input.validationExecutablePath).toLowerCase()
      : path.resolve(input.validationExecutablePath),
    "validation executable realpath changed",
  );
  const observed = sha256Bytes(fs.readFileSync(realPath));
  assert.equal(observed, input.expectedValidationExecutableSha256, "validation executable sha256 mismatch");
  return realPath;
}

function commandEnvironment(command, sourceEnv) {
  const env = {};
  const source = sourceEnv && typeof sourceEnv === "object" ? sourceEnv : process.env;
  for (const key of command.environmentPolicy.allow) {
    const value = source[key];
    if (value !== undefined && value !== null && String(value).length > 0) {
      env[key] = String(value);
    }
  }
  return env;
}

function assertNoLeakage(input, manifest) {
  const sensitiveValues = [
    input.sourceRepositoryPath,
    input.exportDir,
    input.verifierRepositoryPath,
    ...(input.sensitiveValues || []),
  ].filter(Boolean).map(String);
  const findings = [];
  for (const entry of manifest.exportedObjects) {
    if (entry.path === manifest.thinBundle.path) continue;
    const text = fs.readFileSync(path.join(input.exportDir, ...entry.path.split("/")), "utf8");
    for (const value of sensitiveValues) {
      const escaped = JSON.stringify(value).slice(1, -1);
      if (text.includes(value) || (escaped && text.includes(escaped))) {
        findings.push(`${entry.path}: retained sensitive value`);
      }
    }
    if (/(?:api[_-]?key|access[_-]?token|refresh[_-]?token|authorization:\s*bearer|password\s*[=:])/i.test(text)) {
      findings.push(`${entry.path}: credential-shaped text`);
    }
  }
  assert.deepEqual(findings, []);
}

function prepareVerifierBase(input) {
  fs.mkdirSync(input.verifierRepositoryPath, { recursive: false });
  git(input, input.verifierRepositoryPath, ["init"]);
  git(input, input.verifierRepositoryPath, [
    "fetch", "--no-tags", input.sourceRepositoryPath, input.baseRevision,
  ]);
  git(input, input.verifierRepositoryPath, ["cat-file", "-e", `${input.baseRevision}^{commit}`]);
  git(input, input.verifierRepositoryPath, [
    "update-ref", "refs/verify/base", input.baseRevision,
  ]);
  const anchoredBase = String(
    git(input, input.verifierRepositoryPath, ["rev-parse", "refs/verify/base"]).stdout,
  ).trim();
  assert.equal(anchoredBase, input.baseRevision);
}

function verifyPortableCustody(input) {
  assert.ok(input && typeof input === "object", "verifier input object required");
  assert.ok(Array.isArray(input.validationCommands) && input.validationCommands.length > 0);

  const manifestPath = path.join(input.exportDir, "custody-export-manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const manifestBody = { ...manifest };
  delete manifestBody.exportManifestDigest;
  const actualManifestDigest = `sha256:${sha256Bytes(Buffer.from(`${JSON.stringify(manifestBody, null, 2)}\n`, "utf8"))}`;
  assert.equal(actualManifestDigest, manifest.exportManifestDigest);
  assert.equal(manifest.thinBundle.containsBaseObject, false);
  assert.equal(manifest.thinBundle.prerequisiteBaseRevision, input.baseRevision);
  assert.equal(manifest.thinBundle.resultCommit, input.verifiedHeadRevision);

  for (const entry of manifest.exportedObjects) {
    const filePath = path.join(input.exportDir, ...entry.path.split("/"));
    const bytes = fs.readFileSync(filePath);
    assert.equal(bytes.length, entry.bytes, entry.path);
    assert.equal(sha256Bytes(bytes), entry.sha256, entry.path);
  }
  assertNoLeakage(input, manifest);

  prepareVerifierBase(input);

  const bundlePath = path.join(input.exportDir, manifest.thinBundle.path);
  const bundleHeader = fs.readFileSync(bundlePath).subarray(0, 4096).toString("utf8");
  assert.match(bundleHeader, new RegExp(`-${input.baseRevision}\\s`));
  const verify = git(input, input.verifierRepositoryPath, ["bundle", "verify", bundlePath]);
  const verifyText = `${String(verify.stdout || "")}\n${String(verify.stderr || "")}`;
  assert.ok(verifyText.includes(input.baseRevision), "bundle verify must report prerequisite base");

  git(input, input.verifierRepositoryPath, [
    "fetch",
    bundlePath,
    `${input.durableRef}:refs/verify/result`,
  ]);
  const resultCommit = String(
    git(input, input.verifierRepositoryPath, ["rev-parse", "refs/verify/result"]).stdout,
  ).trim();
  assert.equal(resultCommit, input.verifiedHeadRevision);
  const parent = String(
    git(input, input.verifierRepositoryPath, ["rev-parse", `${resultCommit}^`]).stdout,
  ).trim();
  assert.equal(parent, input.baseRevision);

  const changed = String(
    git(input, input.verifierRepositoryPath, [
      "diff-tree", "--no-commit-id", "--name-only", "-r", resultCommit,
    ]).stdout,
  ).trim().split(/\r?\n/).filter(Boolean);
  assert.deepEqual(changed, [input.allowedPath]);

  const artifact = JSON.parse(
    fs.readFileSync(path.join(input.exportDir, "evidence", "change-artifact.json"), "utf8"),
  );
  assert.equal(artifact.path, input.allowedPath);
  const blob = git(
    input,
    input.verifierRepositoryPath,
    ["show", `${resultCommit}:${input.allowedPath}`],
    { encoding: "buffer" },
  ).stdout;
  assert.deepEqual(Buffer.from(blob), Buffer.from(artifact.content, "utf8"));

  git(input, input.verifierRepositoryPath, ["checkout", "--detach", resultCommit]);
  const validationExecutablePath = requireValidationExecutable(input);
  const validation = [];
  for (const command of input.validationCommands) {
    const commandCwd = command.cwdRelative === "."
      ? input.verifierRepositoryPath
      : path.join(input.verifierRepositoryPath, ...command.cwdRelative.split("/"));
    const result = run(validationExecutablePath, command.argv.slice(1), {
      cwd: commandCwd,
      timeout: command.timeoutSeconds * 1000,
      env: commandEnvironment(command, input.validationHostEnv),
    });
    validation.push({
      argv: command.argv,
      exitCode: result.status,
    });
  }

  return {
    ok: true,
    resultCommit,
    parent,
    changed,
    exportManifestDigest: manifest.exportManifestDigest,
    validation,
    leakage: "PASS",
  };
}

function runCli(argv = process.argv) {
  const inputPath = argv[2];
  assert.ok(inputPath, "input JSON path required");
  const input = JSON.parse(fs.readFileSync(inputPath, "utf8"));
  const result = verifyPortableCustody(input);
  process.stdout.write(`${JSON.stringify(result)}\n`);
  return result;
}

if (require.main === module) {
  try {
    runCli();
  } catch (err) {
    process.stderr.write(`${err.stack || err.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  requireValidationExecutable,
  prepareVerifierBase,
  verifyPortableCustody,
  runCli,
};
