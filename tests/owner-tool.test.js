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
const {
  computePublicationAssetManifestDigest,
  validatePublicationIntent,
} = require("../lib/semantic-kernel/publication-intent");

const ROOT = path.resolve(__dirname, "..");
const CLI = path.join(ROOT, "internal", "owner-tool", "cli.js");

function digest(label) {
  return domainDigest("owner-tool-test/v1", { label });
}

function runCli(command, inputPath, keyPath) {
  return spawnSync(process.execPath, [
    CLI,
    command,
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

    const first = runCli("sign-publication-exception", inputPath, keyPath);
    const second = runCli("sign-publication-exception", inputPath, keyPath);
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

test("offline owner tool signs publication intent against the externally anchored owner key", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "owner-publication-intent-"));
  try {
    const pair = crypto.generateKeyPairSync("ed25519");
    const publicKey = pair.publicKey.export({ format: "jwk" });
    const ownerKeyId = ownerPublicKeyDigest(publicKey);
    const privatePem = pair.privateKey.export({ type: "pkcs8", format: "pem" });
    const keyPath = path.join(root, "owner-private.pem");
    const inputPath = path.join(root, "publication-intent-unsigned.json");
    fs.writeFileSync(keyPath, privatePem, { encoding: "utf8", mode: 0o600 });
    const assets = [
      ["black-box-proof", "black-box-proof.json"],
      ["integrated-candidate", "integrated-candidate.json"],
      ["mechanics-assessment", "mechanics-assessment.json"],
      ["owner-pin", "owner-pin.json"],
      ["package-candidate", "package-candidate.json"],
      ["release-candidate", "release-candidate.json"],
      ["reviewer-assessment", "review-custody.json"],
      ["reviewer-assessment", "review-domain.json"],
      ["reviewer-assessment", "review-product.json"],
      ["run-spec", "run-spec.json"],
      ["slice-authorization", "slice-authorization.json"],
      ["tarball", "nkgss-meta-harness-0.4.0.tgz"],
      ["terminal-assessment", "terminal-assessment.json"],
    ].map(([role, filename], index) => ({
      role,
      filename,
      sha256: digest(`asset-${index}`),
      bytes: index + 1,
    }));
    const unsigned = {
      schemaVersion: "publication-intent-draft/v1",
      repositoryId: digest("intent-repository"),
      sliceId: "S-SEMANTIC-KERNEL-1",
      generation: 4,
      sliceAuthorizationDigest: digest("intent-authorization"),
      terminalAssessmentDigest: digest("intent-terminal"),
      releaseCandidateDigest: digest("intent-release"),
      terminalStateDigest: digest("intent-state"),
      terminalOperationEventHead: digest("intent-head"),
      publicationAttemptOrdinal: 1,
      transport: {
        provider: "github-actions",
        repository: "nathanku3-hue/meta-harness",
        workflowFilename: "publish-0.4.yml",
      },
      gitTag: "v0.4.0",
      gitTagTargetRevision: "9".repeat(40),
      tarballDigest: assets.find((asset) => asset.role === "tarball").sha256,
      tarballIntegrity: "sha512-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==",
      tarballByteLength: assets.find((asset) => asset.role === "tarball").bytes,
      packageName: "@nkgss/meta-harness",
      version: "0.4.0",
      registry: "https://registry.npmjs.org/",
      access: "public",
      distTag: "latest",
      provenanceRequired: true,
      assets,
      assetManifestDigest: computePublicationAssetManifestDigest(assets),
      issuedAt: "2026-08-02T00:00:00.000Z",
      publishBy: "2026-08-03T00:00:00.000Z",
    };
    fs.writeFileSync(inputPath, `${JSON.stringify(unsigned, null, 2)}\n`, "utf8");

    const signedResult = runCli("sign-publication-intent", inputPath, keyPath);
    assert.equal(signedResult.status, 0, signedResult.stderr);
    const signed = JSON.parse(signedResult.stdout);
    const pin = {
      repositoryId: unsigned.repositoryId,
      ownerKeyId,
      ownerPublicKey: publicKey,
    };
    assert.equal(validatePublicationIntent(signed, {
      ownerPin: pin,
      expectedOwnerKeyId: ownerKeyId,
    }).intentDigest, signed.intentDigest);

    const wrongAnchor = digest("wrong-owner-anchor");
    assert.throws(
      () => validatePublicationIntent(signed, {
        ownerPin: pin,
        expectedOwnerKeyId: wrongAnchor,
      }),
      (error) => error.code === "PUBLICATION_INTENT_OWNER_ANCHOR",
    );
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
