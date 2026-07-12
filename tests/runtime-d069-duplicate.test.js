"use strict";

/**
 * D069 duplicate same-request single-use / terminal replay.
 * Sequential duplicate observation (sync controller), not an async claim race.
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

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
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

test("D069 duplicate same-request: first verifies, second replays terminal result", async () => {
  await withController("d069dup", async (layout, controller) => {
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

    const workspacesRoot = path.join(layout.workspaceRoot, "workspaces", authHex);
    if (fs.existsSync(workspacesRoot)) {
      assert.equal(fs.readdirSync(workspacesRoot).length, 0);
    }
    const artDir = path.join(layout.stateRoot, "artifacts", authHex);
    assert.match(fs.readFileSync(path.join(artDir, "worker.stdout"), "utf8"), /ok/);
    const refSha = String(
      runGit(layout.gitExecutablePath, layout.repositoryPath, ["rev-parse", first.durableRef]).stdout,
    ).trim();
    assert.equal(refSha, first.verifiedHeadRevision);
  });
});

test("D069 integrity: mismatched RunSpec validation command is rejected", async () => {
  await withController("d069cmd", async (layout, controller) => {
    const programs = programPaths();
    const runSpec = {
      schemaVersion: "run-spec/v1",
      runId: "RUN-D069-BAD-CMD",
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

test("D069 integrity: create-only durable ref rejects pre-existing ref and terminalizes", async () => {
  await withController("d069ref", async (layout, controller) => {
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

test("D069 integrity: terminal replay fails when durable ref is moved", async () => {
  await withController("d069lost", async (layout, controller) => {
    const request = buildRunRequest(layout);
    const first = await controller.run(request);
    assert.equal(first.disposition, "VERIFIED");
    runGit(layout.gitExecutablePath, layout.repositoryPath, ["update-ref", "-d", first.durableRef]);
    await assert.rejects(
      () => controller.run(request),
      (err) => err && err.code === "D069_REF_MISSING",
    );
  });
});

test("D069 integrity: tampered stored digests fail closed on replay", async () => {
  await withController("d069tamper", async (layout, controller) => {
    const request = buildRunRequest(layout);
    const first = await controller.run(request);
    assert.equal(first.disposition, "VERIFIED");
    const authHex = digestHex(first.authorizationRequestDigest);
    const attemptDir = path.join(layout.stateRoot, "attempts", authHex);
    const claimPath = path.join(attemptDir, "claim.json");
    const journalPath = path.join(attemptDir, "journal.json");
    const assessmentPath = path.join(attemptDir, "assessment.json");

    const cases = [
      {
        name: "mutated claim body with unchanged digest",
        apply() {
          const claim = JSON.parse(fs.readFileSync(claimPath, "utf8"));
          claim.workspaceRef = `${claim.workspaceRef}-tampered`;
          writeJson(claimPath, claim);
        },
      },
      {
        name: "mutated journal body with unchanged digest",
        apply() {
          const journal = JSON.parse(fs.readFileSync(journalPath, "utf8"));
          journal.workspaceRef = `${journal.workspaceRef}-tampered`;
          writeJson(journalPath, journal);
        },
      },
      {
        name: "mutated assessment body with unchanged digest",
        apply() {
          const assessment = JSON.parse(fs.readFileSync(assessmentPath, "utf8"));
          assessment.repositoryId = `${assessment.repositoryId}-tampered`;
          writeJson(assessmentPath, assessment);
        },
      },
      {
        name: "wrong durable-ref name in journal",
        apply() {
          const journal = JSON.parse(fs.readFileSync(journalPath, "utf8"));
          journal.durableRef = "refs/meta-harness/attempts/deadbeef";
          // keep old journalDigest — must fail either digest or exact-ref check
          writeJson(journalPath, journal);
        },
      },
    ];

    for (const c of cases) {
      // Restore clean verified state for each case from a fresh first-run clone via re-run
      // of the whole controller is expensive; instead re-verify from first artifacts by
      // re-writing pristine files from the initial successful run snapshot.
    }

    // Snapshot pristine state once, then restore before each tamper case.
    const pristine = {
      claim: fs.readFileSync(claimPath, "utf8"),
      journal: fs.readFileSync(journalPath, "utf8"),
      assessment: fs.readFileSync(assessmentPath, "utf8"),
    };

    for (const c of cases) {
      fs.writeFileSync(claimPath, pristine.claim, "utf8");
      fs.writeFileSync(journalPath, pristine.journal, "utf8");
      fs.writeFileSync(assessmentPath, pristine.assessment, "utf8");
      c.apply();
      await assert.rejects(
        () => controller.run(request),
        (err) => err && err.code === "D069_STATE_CORRUPT",
        c.name,
      );
    }
  });
});
