"use strict";

/**
 * D070-A1 integrity: duplicate replay + fail-closed cases (offline launcher).
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { sealRunSpecApproval } = require("../lib/contracts/run-spec-approval");
const { computeRunSpecDigest } = require("../lib/contracts/run-spec");
const {
  createLocalWalkingSliceController,
  OWNER_FILE_NAME,
} = require("../internal/d069/local-controller");
const {
  createRuntimeFixtureLayout,
  buildControllerConfig,
  buildRunRequest,
  programPaths,
} = require("./helpers/runtime-fixture-repo");

function requireNode20() {
  const major = Number.parseInt(String(process.versions.node).split(".")[0], 10);
  assert.ok(Number.isInteger(major) && major >= 20, `Node >= 20 required; got ${process.version}`);
}

function digestHex(digest) {
  assert.match(digest, /^sha256:[a-f0-9]{64}$/);
  return digest.slice("sha256:".length);
}

function hooksPath() {
  return process.platform === "win32" ? "NUL" : "/dev/null";
}

function runGit(gitPath, cwd, args) {
  const result = spawnSync(
    gitPath,
    ["-c", `core.hooksPath=${hooksPath()}`, "-c", "commit.gpgsign=false", ...args],
    {
      cwd,
      encoding: "utf8",
      windowsHide: true,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_CONFIG_NOSYSTEM: "1" },
    },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${String(result.stderr || result.stdout || "").trim()}`);
  }
  return result;
}

async function withController(label, fn) {
  requireNode20();
  const layout = createRuntimeFixtureLayout({ label });
  let controller;
  try {
    controller = createLocalWalkingSliceController(buildControllerConfig(layout));
    return await fn(layout, controller);
  } finally {
    if (controller) {
      try { await controller.close(); } catch { /* ignore */ }
    }
    layout.cleanup();
  }
}

test("D070 duplicate same-request: first verifies, second replays; one AO spawn total", async () => {
  await withController("d070dup", async (layout, controller) => {
    const ownerPath = path.join(layout.stateRoot, OWNER_FILE_NAME);
    assert.ok(fs.existsSync(ownerPath));
    const request = buildRunRequest(layout);
    const first = await controller.run(request);
    assert.equal(first.ok, true);
    assert.equal(first.disposition, "VERIFIED");
    assert.equal(first.terminal, true);
    assert.equal(first.restart, false);
    assert.equal(first.won, true);
    assert.equal(first.verdict, "IMPLEMENTATION_VERIFIED");
    assert.equal(first.aoSpawnCount, 1);

    const authHex = digestHex(first.authorizationRequestDigest);
    assert.ok(fs.existsSync(path.join(layout.stateRoot, "attempts", authHex, "claim.json")));
    const journal = JSON.parse(
      fs.readFileSync(path.join(layout.stateRoot, "attempts", authHex, "journal.json"), "utf8"),
    );
    assert.equal(journal.state, "verified");
    assert.equal(journal.terminal, true);

    const second = await controller.run(request);
    assert.equal(second.ok, true);
    assert.equal(second.disposition, "REPLAY");
    assert.equal(second.terminal, true);
    assert.equal(second.restart, false);
    assert.equal(second.verdict, "IMPLEMENTATION_VERIFIED");
    assert.equal(second.verifiedHeadRevision, first.verifiedHeadRevision);
    assert.equal(second.durableRef, first.durableRef);
    assert.equal(second.factsDigest, first.factsDigest);
    assert.equal(controller.getAoSpawnCount(), 1);

    const workspacesRoot = path.join(layout.workspaceRoot, "workspaces", authHex);
    if (fs.existsSync(workspacesRoot)) {
      assert.equal(fs.readdirSync(workspacesRoot).length, 0);
    }
    const artDir = path.join(layout.stateRoot, "artifacts", authHex);
    assert.ok(fs.existsSync(path.join(artDir, "ao-process-meta.json")));
    assert.equal(fs.existsSync(path.join(artDir, "worker.stdout")), false);
    const refSha = String(
      runGit(layout.gitExecutablePath, layout.repositoryPath, ["rev-parse", first.durableRef]).stdout,
    ).trim();
    assert.equal(refSha, first.verifiedHeadRevision);
  });
});

test("D070 integrity: mismatched RunSpec validation command is rejected", async () => {
  await withController("d070cmd", async (layout, controller) => {
    const programs = programPaths();
    const runSpec = {
      schemaVersion: "run-spec/v1",
      runId: "RUN-D070-BAD-CMD",
      repository: {
        repositoryId: layout.trustedRepository.repositoryId,
        objectFormat: layout.objectFormat,
        expectedBaseRevision: layout.headRevision,
      },
      objective: "mismatch validation command",
      scope: { allow: ["src/fixture.txt"], deny: [] },
      validation: {
        commands: [{
          argv: [process.execPath, programs.validationScript, "not-bound"],
          cwdRelative: ".",
          timeoutSeconds: 60,
          networkPolicy: "denied",
          environmentPolicy: { allow: [] },
        }],
      },
      changePolicy: "forbid-noop",
    };
    const runSpecDigest = computeRunSpecDigest(runSpec);
    const approval = sealRunSpecApproval({
      schemaVersion: "run-spec-approval/v1",
      approvalId: "APR-BAD",
      approvedBy: "test@meta-harness.local",
      approvedAt: "2026-07-12T11:00:00.000Z",
      runSpec,
      runSpecDigest,
    });
    await assert.rejects(
      () => controller.run({
        runSpecApproval: approval,
        authorizationRequest: { authorizationId: "AUTH-BAD", attemptId: "ATTEMPT-BAD" },
      }),
      (err) => err && err.code === "D069_VALIDATION_COMMAND_BINDING",
    );
  });
});

test("D070 integrity: create-only durable ref rejects pre-existing ref and terminalizes", async () => {
  await withController("d070ref", async (layout, controller) => {
    const request = buildRunRequest(layout);
    const first = await controller.run(request);
    assert.equal(first.disposition, "VERIFIED");
    const authHex = digestHex(first.authorizationRequestDigest);
    const attemptDir = path.join(layout.stateRoot, "attempts", authHex);
    fs.rmSync(attemptDir, { recursive: true, force: true });
    await assert.rejects(
      () => controller.run(request),
      (err) => err && err.code === "D069_REF_EXISTS",
    );
    const journal = JSON.parse(
      fs.readFileSync(path.join(attemptDir, "journal.json"), "utf8"),
    );
    assert.equal(journal.state, "controller_failed");
    assert.equal(journal.terminal, true);
    assert.equal(journal.failureCode, "D069_REF_EXISTS");
  });
});

test("D070 integrity: terminal replay fails when durable ref is moved", async () => {
  await withController("d070moved", async (layout, controller) => {
    const request = buildRunRequest(layout);
    const first = await controller.run(request);
    assert.equal(first.disposition, "VERIFIED");
    const other = String(
      runGit(layout.gitExecutablePath, layout.repositoryPath, ["rev-parse", "HEAD"]).stdout,
    ).trim();
    runGit(
      layout.gitExecutablePath,
      layout.repositoryPath,
      ["update-ref", first.durableRef, other],
    );
    await assert.rejects(
      () => controller.run(request),
      (err) => err && (err.code === "D069_STATE_CORRUPT" || err.code === "D069_REF_MISMATCH" || String(err.message).length > 0),
    );
  });
});

test("D070 integrity: tampered stored digests fail closed on replay", async () => {
  await withController("d070tamper", async (layout, controller) => {
    const request = buildRunRequest(layout);
    const first = await controller.run(request);
    assert.equal(first.disposition, "VERIFIED");
    const authHex = digestHex(first.authorizationRequestDigest);
    const journalPath = path.join(layout.stateRoot, "attempts", authHex, "journal.json");
    const journal = JSON.parse(fs.readFileSync(journalPath, "utf8"));
    journal.factsDigest = "sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff";
    fs.writeFileSync(journalPath, `${JSON.stringify(journal, null, 2)}\n`, "utf8");
    await assert.rejects(
      () => controller.run(request),
      (err) => err && err.code === "D069_STATE_CORRUPT",
    );
  });
});
