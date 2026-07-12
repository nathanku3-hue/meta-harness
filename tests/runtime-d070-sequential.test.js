"use strict";

/**
 * D070-A1 offline full-chain sequential + replay (test Codex launcher).
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const {
  createLocalWalkingSliceController,
  OWNER_FILE_NAME,
  CONTROLLER_AUTHOR_NAME,
} = require("../internal/d069/local-controller");
const {
  createRuntimeFixtureLayout,
  buildControllerConfig,
  buildRunRequest,
  programPaths,
  FIXTURE_RELATIVE_FILE,
  A1_EXACT_BODY,
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

function runValidation(cwd, validationScript) {
  return spawnSync(process.execPath, [validationScript], {
    cwd,
    encoding: "utf8",
    windowsHide: true,
  });
}

function runGit(gitPath, cwd, args) {
  const result = spawnSync(
    gitPath,
    ["-c", `core.hooksPath=${hooksPath()}`, "-c", "commit.gpgsign=false", ...args],
    {
      cwd,
      encoding: "utf8",
      windowsHide: true,
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: "0",
        GIT_CONFIG_NOSYSTEM: "1",
      },
    },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `git ${args.join(" ")} failed: ${String(result.stderr || result.stdout || "").trim()}`,
    );
  }
  return result;
}

test("D070-A1 sequential: sealed request produces verified commit, validation, ref, journal", async () => {
  requireNode20();

  const layout = createRuntimeFixtureLayout({ label: "d070seq" });
  let controller;
  try {
    const programs = programPaths();

    const before = runValidation(layout.repositoryPath, programs.validationScript);
    assert.notEqual(before.status, 0, "validation must fail on base fixture");

    const ownerPath = path.join(layout.stateRoot, OWNER_FILE_NAME);
    controller = createLocalWalkingSliceController(buildControllerConfig(layout));
    assert.ok(fs.existsSync(ownerPath), "owner must exist after construction");

    const request = buildRunRequest(layout);
    assert.ok(request.runSpecApproval.approvalDigest);

    const result = await controller.run(request);
    assert.equal(result.ok, true);
    assert.equal(result.won, true);
    assert.equal(result.disposition, "VERIFIED");
    assert.equal(result.verdict, "IMPLEMENTATION_VERIFIED");
    assert.equal(result.aoSpawnCount, 1);

    const authHex = digestHex(result.authorizationRequestDigest);
    const attemptDir = path.join(layout.stateRoot, "attempts", authHex);
    const journalPath = path.join(attemptDir, "journal.json");
    const assessmentPath = path.join(attemptDir, "assessment.json");
    const claimPath = path.join(attemptDir, "claim.json");
    const artDir = path.join(layout.stateRoot, "artifacts", authHex);

    assert.ok(fs.existsSync(claimPath), "claim.json present");
    assert.ok(fs.existsSync(assessmentPath), "assessment.json present");
    assert.ok(fs.existsSync(journalPath), "journal.json present");
    assert.ok(fs.existsSync(path.join(artDir, "validation.stdout")));
    assert.ok(fs.existsSync(path.join(artDir, "ao-process-meta.json")));
    assert.ok(fs.existsSync(path.join(artDir, "change-artifact.json")));
    assert.ok(fs.existsSync(path.join(artDir, "git.name-status")));
    // Raw AO streams must not be persisted
    assert.equal(fs.existsSync(path.join(artDir, "worker.stdout")), false);
    assert.equal(fs.existsSync(path.join(artDir, "worker.stderr")), false);
    assert.equal(fs.existsSync(path.join(artDir, "ao.stdout")), false);
    assert.equal(fs.existsSync(path.join(artDir, "ao.stderr")), false);

    const meta = JSON.parse(fs.readFileSync(path.join(artDir, "ao-process-meta.json"), "utf8"));
    assert.equal(meta.exitCode, 0);
    assert.equal(meta.timedOut, false);
    assert.equal(meta.spawnOrdinal, 1);
    assert.match(meta.stdoutSha256, /^[a-f0-9]{64}$/);
    assert.match(meta.stderrSha256, /^[a-f0-9]{64}$/);
    assert.ok(meta.eventCount >= 1);
    assert.equal(meta.terminalType, "turn.completed");

    const artifact = JSON.parse(fs.readFileSync(path.join(artDir, "change-artifact.json"), "utf8"));
    assert.equal(artifact.path, FIXTURE_RELATIVE_FILE);
    assert.equal(artifact.content, A1_EXACT_BODY);

    const invCount = String(
      fs.readFileSync(path.join(artDir, "ao-invocation-count.txt"), "utf8"),
    ).trim();
    assert.equal(invCount, "1");

    const journal = JSON.parse(fs.readFileSync(journalPath, "utf8"));
    assert.equal(journal.state, "verified");
    assert.equal(journal.terminal, true);
    assert.equal(journal.factsDigest, result.factsDigest);
    assert.equal(journal.implementationAssessmentDigest, result.implementationAssessmentDigest);
    assert.equal(journal.verifiedHeadRevision, result.verifiedHeadRevision);
    assert.equal(journal.durableRef, result.durableRef);
    assert.equal(journal.durableRef, `refs/meta-harness/attempts/${authHex}`);

    const assessment = JSON.parse(fs.readFileSync(assessmentPath, "utf8"));
    assert.equal(assessment.verdict, "IMPLEMENTATION_VERIFIED");
    assert.equal(assessment.verifiedHeadRevision, result.verifiedHeadRevision);

    const refSha = String(
      runGit(
        layout.gitExecutablePath,
        layout.repositoryPath,
        ["rev-parse", result.durableRef],
      ).stdout,
    ).trim();
    assert.equal(refSha, result.verifiedHeadRevision, "durable ref must equal assessed commit");

    const parentLine = String(
      runGit(
        layout.gitExecutablePath,
        layout.repositoryPath,
        ["rev-list", "--parents", "-n", "1", result.verifiedHeadRevision],
      ).stdout,
    ).trim().split(/\s+/);
    assert.equal(parentLine[1], layout.headRevision, "commit parent == base");

    const author = String(
      runGit(
        layout.gitExecutablePath,
        layout.repositoryPath,
        ["show", "-s", "--format=%an", result.verifiedHeadRevision],
      ).stdout,
    ).trim();
    const committer = String(
      runGit(
        layout.gitExecutablePath,
        layout.repositoryPath,
        ["show", "-s", "--format=%cn", result.verifiedHeadRevision],
      ).stdout,
    ).trim();
    assert.equal(author, CONTROLLER_AUTHOR_NAME);
    assert.equal(committer, CONTROLLER_AUTHOR_NAME);

    const nameStatus = String(
      runGit(
        layout.gitExecutablePath,
        layout.repositoryPath,
        ["diff-tree", "--no-commit-id", "--name-status", "-r", result.verifiedHeadRevision],
      ).stdout,
    ).trim();
    assert.equal(nameStatus, `M\t${FIXTURE_RELATIVE_FILE}`);

    // Exact bytes in the commit tree
    const blob = String(
      runGit(
        layout.gitExecutablePath,
        layout.repositoryPath,
        ["show", `${result.verifiedHeadRevision}:${FIXTURE_RELATIVE_FILE}`],
      ).stdout,
    );
    assert.equal(blob, A1_EXACT_BODY);

    const workspacesRoot = path.join(layout.workspaceRoot, "workspaces", authHex);
    if (fs.existsSync(workspacesRoot)) {
      const remaining = fs.readdirSync(workspacesRoot);
      assert.equal(remaining.length, 0, `worktrees must be removed; left ${remaining.join(",")}`);
    }

    const primaryHead = String(
      runGit(layout.gitExecutablePath, layout.repositoryPath, ["rev-parse", "HEAD"]).stdout,
    ).trim();
    assert.equal(primaryHead, layout.headRevision, "primary worktree remains at base");
    const primaryStatus = String(
      runGit(layout.gitExecutablePath, layout.repositoryPath, ["status", "--porcelain"]).stdout,
    );
    assert.equal(primaryStatus.trim(), "", "primary worktree clean");

    // Terminal duplicate replay — no second AO spawn
    const replay = await controller.run(request);
    assert.equal(replay.ok, true);
    assert.equal(replay.disposition, "REPLAY");
    assert.equal(replay.terminal, true);
    assert.equal(replay.restart, false);
    assert.equal(replay.verdict, "IMPLEMENTATION_VERIFIED");
    assert.equal(replay.verifiedHeadRevision, result.verifiedHeadRevision);
    assert.equal(replay.durableRef, result.durableRef);
    assert.equal(controller.getAoSpawnCount(), 1, "replay must not spawn AO again");
    assert.equal(
      String(fs.readFileSync(path.join(artDir, "ao-invocation-count.txt"), "utf8")).trim(),
      "1",
      "launcher invocation counter stays at 1",
    );

    assert.ok(fs.existsSync(ownerPath), "owner remains until close");
    await controller.close();
    assert.equal(fs.existsSync(ownerPath), false, "owner absent after close");
    controller = null;
  } finally {
    if (controller) {
      try {
        await controller.close();
      } catch {
        // ignore
      }
    }
    layout.cleanup();
  }
});
