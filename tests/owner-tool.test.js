"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const { domainDigest } = require("../lib/contracts/digest");
const { npmInvocation } = require("../lib/npm-command");
const { ownerPublicKeyDigest } = require("../lib/semantic-kernel/owner-pin");
const { validatePublicationException } = require("../lib/semantic-kernel/publication-exception");

const ROOT = path.resolve(__dirname, "..");
const CLI = path.join(ROOT, "internal", "owner-tool", "cli.js");

function digest(label) {
  return domainDigest("owner-tool-test/v1", { label });
}

function runCli(inputPath, keyPath) {
  return spawnSync(process.execPath, [
    CLI,
    "sign-publication-exception",
    "--input",
    inputPath,
    "--private-key",
    keyPath,
  ], {
    cwd: ROOT,
    encoding: "utf8",
    windowsHide: true,
    timeout: 30000,
  });
}

test("offline owner tool produces deterministic cross-process signatures without copying the key", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "owner-tool-"));
  try {
    const pair = crypto.generateKeyPairSync("ed25519");
    const publicKey = pair.publicKey.export({ format: "jwk" });
    const ownerKeyId = ownerPublicKeyDigest(publicKey);
    const privatePem = pair.privateKey.export({ type: "pkcs8", format: "pem" });
    const keyPath = path.join(root, "owner-private.pem");
    const inputPath = path.join(root, "publication-exception.json");
    fs.writeFileSync(keyPath, privatePem, { encoding: "utf8", mode: 0o600 });
    const unsigned = {
      schemaVersion: "publication-exception/v1",
      repositoryId: digest("repository"),
      sliceId: "S-SEMANTIC-KERNEL-1",
      releaseCandidateDigest: digest("release-candidate"),
      priorPublicationObservationDigest: digest("not-published-observation"),
      allowedAction: "RETRY_IDENTICAL_NOT_PUBLISHED_RELEASE",
      newPublishBy: "2026-08-02T00:00:00.000Z",
      maxPublicationAttempts: 1,
      reason: "Registry independently confirmed that the first request did not publish.",
      issuedAt: "2026-08-01T00:00:00.000Z"
    };
    fs.writeFileSync(inputPath, `${JSON.stringify(unsigned, null, 2)}\n`, "utf8");

    const first = runCli(inputPath, keyPath);
    const second = runCli(inputPath, keyPath);
    assert.equal(first.status, 0, first.stderr);
    assert.equal(second.status, 0, second.stderr);
    assert.equal(first.stdout, second.stdout);
    assert.match(first.stderr, /Canonical signed body:/);
    assert.match(first.stderr, /Object digest: sha256:/);

    const signed = JSON.parse(first.stdout);
    assert.equal(signed.ownerKeyId, ownerKeyId);
    const pin = {
      schemaVersion: "authority-genesis-pin/v2",
      repositoryId: unsigned.repositoryId,
      ownerKeyId,
      ownerPublicKey: publicKey,
      ownerPublicKeyDigest: ownerKeyId,
      installedByExplicitOwnerAction: true,
      installedAt: "2026-07-31T00:00:00.000Z",
      pinDigest: digest("pin"),
    };
    assert.equal(validatePublicationException(signed, pin).exceptionDigest, signed.exceptionDigest);

    const changed = JSON.parse(JSON.stringify(signed));
    changed.reason += " changed";
    assert.throws(
      () => validatePublicationException(changed, pin),
      (error) => error.code === "CONTRACT_DIGEST_MISMATCH",
    );

    assert.equal(fs.existsSync(keyPath), true);
    assert.equal(fs.readdirSync(root).filter((entry) => /private|key/i.test(entry)).length, 1);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("npm package excludes owner signing tools and retired authority paths", () => {
  const invocation = npmInvocation(["pack", "--ignore-scripts", "--dry-run", "--json"]);
  const result = spawnSync(invocation.command, invocation.args, {
    cwd: ROOT,
    encoding: "utf8",
    windowsHide: true,
    shell: process.platform === "win32" && invocation.command === "npm.cmd",
    timeout: 180000,
  });
  assert.equal(result.status, 0, result.stderr);
  const pack = JSON.parse(result.stdout)[0];
  const files = pack.files.map((entry) => entry.path);
  assert.equal(files.some((entry) => entry.startsWith("internal/")), false);
  assert.equal(files.some((entry) => entry.startsWith("tests/")), false);
  for (const retired of [
    "lib/contracts/attempt-authorization.js",
    "lib/contracts/run-spec-approval.js",
    "lib/contracts/implementation-assessment.js",
    "lib/execution-custody/custody-replay.js",
    "lib/execution-custody/terminal-evidence.js",
    "lib/truth-authority.js",
  ]) {
    assert.equal(files.includes(retired), false, retired);
  }
  assert.equal(files.includes("lib/semantic-kernel/slice-authorization.js"), true);
  assert.equal(files.includes("lib/semantic-kernel/release-verification.js"), true);
});
