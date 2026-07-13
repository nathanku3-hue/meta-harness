"use strict";

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
    timeout: options.timeout || 120_000,
    env: {
      ...process.env,
      GIT_TERMINAL_PROMPT: "0",
      GIT_CONFIG_NOSYSTEM: "1",
      ...options.env,
    },
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
      ...args,
    ],
    { cwd, ...options },
  );
}

function main() {
  const inputPath = process.argv[2];
  assert.ok(inputPath, "input JSON path required");
  const input = JSON.parse(fs.readFileSync(inputPath, "utf8"));
  const manifestPath = path.join(input.exportDir, "custody-export-manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const body = { ...manifest };
  delete body.exportManifestDigest;
  const actualManifestDigest = `sha256:${sha256Bytes(Buffer.from(`${JSON.stringify(body, null, 2)}\n`, "utf8"))}`;
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

  fs.mkdirSync(input.verifierRepositoryPath, { recursive: false });
  git(input, input.verifierRepositoryPath, ["init"]);
  git(input, input.verifierRepositoryPath, [
    "fetch", "--no-tags", input.sourceRepositoryPath, input.baseRevision,
  ]);
  git(input, input.verifierRepositoryPath, ["cat-file", "-e", `${input.baseRevision}^{commit}`]);

  const bundlePath = path.join(input.exportDir, manifest.thinBundle.path);
  const header = fs.readFileSync(bundlePath).subarray(0, 4096).toString("utf8");
  assert.match(header, new RegExp(`-${input.baseRevision}\\s`));
  const verify = git(input, input.verifierRepositoryPath, ["bundle", "verify", bundlePath]);
  const verifyText = `${String(verify.stdout || "")}\n${String(verify.stderr || "")}`;
  assert.ok(verifyText.includes(input.baseRevision), "bundle verify must report prerequisite base");

  git(input, input.verifierRepositoryPath, [
    "fetch",
    bundlePath,
    `${input.durableRef}:refs/verify/d072-result`,
  ]);
  const resultCommit = String(
    git(input, input.verifierRepositoryPath, ["rev-parse", "refs/verify/d072-result"]).stdout,
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
  const validation = run(input.validationArgv[0], input.validationArgv.slice(1), {
    cwd: input.verifierRepositoryPath,
    timeout: 120_000,
  });
  assert.match(String(validation.stdout || ""), /d072-validation-ok/);

  process.stdout.write(`${JSON.stringify({
    ok: true,
    resultCommit,
    parent,
    changed,
    exportManifestDigest: manifest.exportManifestDigest,
    validation: "PASS",
  })}\n`);
}

try {
  main();
} catch (err) {
  process.stderr.write(`${err.stack || err.message}\n`);
  process.exitCode = 1;
}
