"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  computeAuthorizationRequestDigest,
  sealAuthorizationReceipt,
} = require("../../lib/contracts/attempt-authorization");
const {
  buildControllerConfig,
  absNorm,
} = require("./runtime-fixture-repo");

function digestHex(digest) {
  assert.match(digest, /^sha256:[a-f0-9]{64}$/);
  return digest.slice("sha256:".length);
}

function jsonBytes(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function directoryEntries(directory) {
  return fs.existsSync(directory) ? fs.readdirSync(directory).sort() : [];
}

function resealReceipt(receipt, overrides) {
  const body = { ...receipt, ...overrides };
  delete body.receiptDigest;
  body.provider = { ...receipt.provider, ...(overrides.provider || {}) };
  body.authorizationRequestDigest = computeAuthorizationRequestDigest({
    authorizationId: body.authorizationId,
    attemptId: body.attemptId,
    approvalDigest: body.approvalDigest,
    runSpecDigest: body.runSpecDigest,
    executionReadinessDigest: body.executionReadinessDigest,
    authorizationPolicyDigest: body.authorizationPolicyDigest,
    workspacePolicyDigest: body.workspacePolicyDigest,
    provider: body.provider,
    capability: body.capability,
  });
  return sealAuthorizationReceipt(body);
}

function canaryConfig(layout, clockValue = "2026-07-14T12:00:00.000Z") {
  const config = buildControllerConfig(layout, { clock: () => clockValue });
  const missing = absNorm(path.join(layout.root, "execution-canary"));
  config.codexProgram = {
    ...config.codexProgram,
    nodeExecutablePath: absNorm(path.join(missing, "node.exe")),
    launcherScriptPath: absNorm(path.join(missing, "codex.js")),
    nativeExecutablePath: absNorm(path.join(missing, "codex.exe")),
    codexHome: absNorm(path.join(missing, "codex-home")),
    expectedLauncherSha256: "0".repeat(64),
    expectedNativeSha256: "1".repeat(64),
  };
  config.validationProgram = {
    ...config.validationProgram,
    executablePath: absNorm(path.join(missing, "powershell.exe")),
    scriptPath: absNorm(path.join(missing, "validator.ps1")),
    expectedExecutableSha256: "2".repeat(64),
    expectedScriptSha256: "3".repeat(64),
  };
  return config;
}

async function expectReject(controller, request, code) {
  await assert.rejects(
    () => controller.run(request),
    (err) => err && err.code === code,
    code,
  );
}

module.exports = {
  digestHex,
  jsonBytes,
  directoryEntries,
  resealReceipt,
  canaryConfig,
  expectReject,
};
