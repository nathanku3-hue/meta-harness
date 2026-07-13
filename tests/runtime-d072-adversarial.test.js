"use strict";

/** D072 adversarial custody classification and fail-closed behavior. */

const {
  windowsRuntimeTest: test,
} = require("./helpers/windows-runtime-test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  createLocalWalkingSliceController,
} = require("../internal/d069/local-controller");
const {
  canonicalReceiptPath,
} = require("../internal/d069/custody-replay");
const { sealJournal } = require("../internal/d069/support");
const {
  createRuntimeFixtureLayout,
  buildControllerConfig,
  buildRunRequest,
  absNorm,
} = require("./helpers/runtime-fixture-repo");
const { runGit } = require("./helpers/runtime-git");
const {
  digestHex,
  jsonBytes,
  directoryEntries,
  resealReceipt,
  canaryConfig,
  expectReject,
} = require("./helpers/runtime-d072-custody-support");

test("D072 stored custody conflicts and tampering fail closed without replacement work", async () => {
  const layout = createRuntimeFixtureLayout({ label: "d072adversarial" });
  const request = buildRunRequest(layout, {
    authorizationId: "AUTH-D072-ADVERSARIAL",
    attemptId: "ATTEMPT-D072-ADVERSARIAL",
  });
  let controller;
  try {
    controller = createLocalWalkingSliceController(buildControllerConfig(layout));
    const verified = await controller.run(request);
    assert.equal(verified.disposition, "VERIFIED");
    assert.equal(controller.getAoSpawnCount(), 1);

    const authHex = digestHex(verified.authorizationRequestDigest);
    const attemptRoot = path.join(layout.stateRoot, "attempts");
    const attemptDir = path.join(attemptRoot, authHex);
    const journalPath = path.join(attemptDir, "journal.current.json");
    const manifestPath = path.join(attemptDir, "evidence", "custody-manifest.json");
    const receiptPath = canonicalReceiptPath(
      layout.stateRoot,
      request.authorizationRequest.authorizationId,
    );
    const receiptBytes = fs.readFileSync(receiptPath);
    const receipt = JSON.parse(receiptBytes.toString("utf8"));
    const journalBytes = fs.readFileSync(journalPath);
    const journal = JSON.parse(journalBytes.toString("utf8"));
    const manifestBytes = fs.readFileSync(manifestPath);
    const authorizationEntries = directoryEntries(path.dirname(receiptPath));
    const attemptEntries = directoryEntries(attemptRoot);

    const changedAttempt = {
      ...request,
      authorizationRequest: {
        ...request.authorizationRequest,
        attemptId: "ATTEMPT-D072-CONFLICT",
      },
    };
    await expectReject(controller, changedAttempt, "D072_STORED_RECEIPT_CONFLICT");

    const replacementAuthorization = {
      ...request,
      authorizationRequest: {
        ...request.authorizationRequest,
        authorizationId: "AUTH-D072-REPLACEMENT-DENIED",
      },
    };
    await expectReject(
      controller,
      replacementAuthorization,
      "D072_REPLACEMENT_AUTHORIZATION_DENIED",
    );

    const changedApproval = buildRunRequest(layout, {
      authorizationId: request.authorizationRequest.authorizationId,
      attemptId: request.authorizationRequest.attemptId,
      approvalId: "APR-D072-CONFLICT",
      objective: `${request.runSpecApproval.runSpec.objective} changed`,
    });
    await expectReject(controller, changedApproval, "D072_STORED_RECEIPT_CONFLICT");

    const corruptReceipt = { ...receipt, attemptId: "ATTEMPT-D072-CORRUPT-SEAL" };
    fs.writeFileSync(receiptPath, jsonBytes(corruptReceipt));
    await expectReject(controller, request, "D069_RECEIPT_CONFLICT");
    fs.writeFileSync(receiptPath, receiptBytes);

    const authorizationConflict = resealReceipt(receipt, {
      authorizationId: "AUTH-D072-CONFLICTING-STORED",
    });
    fs.writeFileSync(receiptPath, jsonBytes(authorizationConflict));
    await expectReject(controller, request, "D072_STORED_RECEIPT_CONFLICT");
    fs.writeFileSync(receiptPath, receiptBytes);

    const providerConflict = resealReceipt(receipt, {
      provider: { workerProfile: "d072-conflicting-profile" },
    });
    fs.writeFileSync(receiptPath, jsonBytes(providerConflict));
    await expectReject(controller, request, "D072_STORED_RECEIPT_CONFLICT");
    fs.writeFileSync(receiptPath, receiptBytes);

    fs.rmSync(manifestPath);
    await expectReject(controller, request, "D072_TERMINAL_EVIDENCE_CORRUPT");
    fs.writeFileSync(manifestPath, manifestBytes);

    fs.rmSync(journalPath);
    await expectReject(controller, request, "D072_CLAIM_WITHOUT_JOURNAL");
    fs.writeFileSync(journalPath, journalBytes);

    const priorFailure = sealJournal({
      schemaVersion: journal.schemaVersion,
      authorizationRequestDigest: journal.authorizationRequestDigest,
      claimDigest: journal.claimDigest,
      authorizationReceiptDigest: journal.authorizationReceiptDigest,
      startCheckDigest: journal.startCheckDigest,
      workspaceRef: journal.workspaceRef,
      invocationNonce: journal.invocationNonce,
      state: "controller_failed",
      terminal: true,
      updatedAt: journal.updatedAt,
      failureCode: "D072_STORED_FAILURE",
      failureMessage: "stored failure",
    });
    fs.writeFileSync(journalPath, jsonBytes(priorFailure));
    const failureReplay = await controller.run(request);
    assert.equal(failureReplay.ok, false);
    assert.equal(failureReplay.terminal, true);
    assert.equal(failureReplay.failureCode, "D072_STORED_FAILURE");
    fs.writeFileSync(journalPath, journalBytes);

    runGit(layout.gitExecutablePath, layout.repositoryPath, ["update-ref", "-d", verified.durableRef]);
    await expectReject(controller, request, "D069_REF_MISSING");
    runGit(
      layout.gitExecutablePath,
      layout.repositoryPath,
      ["update-ref", verified.durableRef, verified.verifiedHeadRevision],
    );
    runGit(
      layout.gitExecutablePath,
      layout.repositoryPath,
      ["update-ref", verified.durableRef, layout.headRevision],
    );
    await expectReject(controller, request, "D069_REF_MISMATCH");
    runGit(
      layout.gitExecutablePath,
      layout.repositoryPath,
      ["update-ref", verified.durableRef, verified.verifiedHeadRevision],
    );

    assert.equal(controller.getAoSpawnCount(), 1);
    assert.deepEqual(fs.readFileSync(receiptPath), receiptBytes);
    assert.deepEqual(directoryEntries(path.dirname(receiptPath)), authorizationEntries);
    assert.deepEqual(directoryEntries(attemptRoot), attemptEntries);
    const attemptWorktrees = path.join(layout.workspaceRoot, "workspaces", authHex);
    assert.deepEqual(directoryEntries(attemptWorktrees), []);
  } finally {
    if (controller) {
      try { await controller.close(); } catch { /* ignore */ }
    }
    layout.cleanup();
  }
});

test("D072 incomplete stored attempt never reauthorizes and expiry fails closed", async () => {
  const layout = createRuntimeFixtureLayout({ label: "d072incomplete" });
  const request = buildRunRequest(layout, {
    authorizationId: "AUTH-D072-INCOMPLETE",
    attemptId: "ATTEMPT-D072-INCOMPLETE",
  });
  let firstController;
  let laterController;
  try {
    firstController = createLocalWalkingSliceController(buildControllerConfig(layout));
    const verified = await firstController.run(request);
    const authHex = digestHex(verified.authorizationRequestDigest);
    const journalPath = path.join(
      layout.stateRoot,
      "attempts",
      authHex,
      "journal.current.json",
    );
    const terminalBytes = fs.readFileSync(journalPath);
    const terminal = JSON.parse(terminalBytes.toString("utf8"));
    const nonterminal = sealJournal({
      schemaVersion: terminal.schemaVersion,
      authorizationRequestDigest: terminal.authorizationRequestDigest,
      claimDigest: terminal.claimDigest,
      authorizationReceiptDigest: terminal.authorizationReceiptDigest,
      startCheckDigest: terminal.startCheckDigest,
      workspaceRef: terminal.workspaceRef,
      invocationNonce: terminal.invocationNonce,
      state: "worker_started",
      terminal: false,
      updatedAt: terminal.updatedAt,
    });
    fs.writeFileSync(journalPath, jsonBytes(nonterminal));

    const current = await firstController.run(request);
    assert.equal(current.disposition, "ALREADY_CLAIMED");
    assert.equal(current.ok, true);
    assert.equal(firstController.getAoSpawnCount(), 1);
    await firstController.close();
    firstController = null;

    laterController = createLocalWalkingSliceController(canaryConfig(layout));
    const expired = await laterController.run(request);
    assert.equal(expired.disposition, "INCOMPLETE_EXPIRED");
    assert.equal(expired.ok, false);
    assert.equal(expired.code, "D072_INCOMPLETE_RECEIPT_EXPIRED");
    assert.equal(laterController.getAoSpawnCount(), 0);
    fs.writeFileSync(journalPath, terminalBytes);
  } finally {
    if (laterController) {
      try { await laterController.close(); } catch { /* ignore */ }
    }
    if (firstController) {
      try { await firstController.close(); } catch { /* ignore */ }
    }
    layout.cleanup();
  }
});

test("D072 policy drift conflicts before execution tools and missing validator blocks a new attempt", async () => {
  const layout = createRuntimeFixtureLayout({ label: "d072policy" });
  const request = buildRunRequest(layout, {
    authorizationId: "AUTH-D072-POLICY",
    attemptId: "ATTEMPT-D072-POLICY",
  });
  let firstController;
  let driftController;
  try {
    firstController = createLocalWalkingSliceController(buildControllerConfig(layout));
    await firstController.run(request);
    await firstController.close();
    firstController = null;

    const driftConfig = canaryConfig(layout);
    driftConfig.authorizationPolicy.authorizationTtlSeconds = 1800;
    driftController = createLocalWalkingSliceController(driftConfig);
    await expectReject(driftController, request, "D072_STORED_RECEIPT_CONFLICT");
    assert.equal(driftController.getAoSpawnCount(), 0);
  } finally {
    if (driftController) {
      try { await driftController.close(); } catch { /* ignore */ }
    }
    if (firstController) {
      try { await firstController.close(); } catch { /* ignore */ }
    }
    layout.cleanup();
  }

  const fresh = createRuntimeFixtureLayout({ label: "d072missingvalidator" });
  let freshController;
  try {
    const config = buildControllerConfig(fresh);
    const missing = absNorm(path.join(fresh.root, "missing-validator"));
    config.validationProgram = {
      ...config.validationProgram,
      scriptPath: absNorm(path.join(missing, "validator.ps1")),
      expectedScriptSha256: "5".repeat(64),
    };
    freshController = createLocalWalkingSliceController(config);
    await expectReject(
      freshController,
      buildRunRequest(fresh, {
        authorizationId: "AUTH-D072-FRESH-MISSING",
        attemptId: "ATTEMPT-D072-FRESH-MISSING",
      }),
      "D069_PROGRAM_PATH_MISSING",
    );
    assert.equal(freshController.getAoSpawnCount(), 0);
  } finally {
    if (freshController) {
      try { await freshController.close(); } catch { /* ignore */ }
    }
    fresh.cleanup();
  }
});
