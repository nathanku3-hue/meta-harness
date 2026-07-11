"use strict";

/**
 * D069 sequential verified path (portable Node >= 20).
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

test("D069 sequential: sealed request produces verified commit, validation, ref, journal", async () => {
  requireNode20();

  const layout = createRuntimeFixtureLayout({ label: "d069seq" });
  let controller;
  try {
    const programs = programPaths();

    const before = runValidation(layout.repositoryPath, programs.validationScript);
    assert.notEqual(before.status, 0, "validation must fail before worker on base fixture");

    const worker = spawnSync(
      process.execPath,
      [programs.fixtureWorkerScript],
      { cwd: layout.repositoryPath, encoding: "utf8", windowsHide: true },
    );
    assert.equal(worker.status, 0, `fixture worker failed: ${worker.stderr}`);
    const after = runValidation(layout.repositoryPath, programs.validationScript);
    assert.equal(after.status, 0, "validation must pass after worker");

    fs.writeFileSync(layout.fixtureAbsoluteFile, layout.initialBody, "utf8");
    runGit(layout.gitExecutablePath, layout.repositoryPath, ["checkout", "--", FIXTURE_RELATIVE_FILE]);
    const clean = String(
      runGit(layout.gitExecutablePath, layout.repositoryPath, ["status", "--porcelain"]).stdout,
    );
    assert.equal(clean.trim(), "", "fixture must be clean before controller run");

    const ownerPath = path.join(layout.stateRoot, OWNER_FILE_NAME);
    controller = createLocalWalkingSliceController(buildControllerConfig(layout));
    assert.ok(fs.existsSync(ownerPath), "owner must exist after construction");

    const request = buildRunRequest(layout);
    assert.ok(request.runSpecApproval.approvalDigest);
    assert.match(request.runSpecApproval.runSpecDigest, /^sha256:[a-f0-9]{64}$/);

    const result = await controller.run(request);
    assert.equal(result.ok, true);
    assert.equal(result.won, true);
    assert.equal(result.disposition, "VERIFIED");
    assert.equal(result.verdict, "IMPLEMENTATION_VERIFIED");

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
    assert.ok(fs.existsSync(path.join(artDir, "worker.stdout")));
    assert.ok(fs.existsSync(path.join(artDir, "git.name-status")));

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

    const refs = String(
      runGit(layout.gitExecutablePath, layout.repositoryPath, ["show-ref"]).stdout,
    );
    assert.match(refs, new RegExp(`refs/meta-harness/attempts/${authHex}`));
    const metaHarnessRefs = refs
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.includes("refs/meta-harness/"));
    assert.equal(metaHarnessRefs.length, 1, `only one meta-harness ref; got ${metaHarnessRefs.join(" | ")}`);

    // Terminal duplicate replay (no second worktree / worker).
    const replay = await controller.run(request);
    assert.equal(replay.ok, true);
    assert.equal(replay.disposition, "REPLAY");
    assert.equal(replay.terminal, true);
    assert.equal(replay.restart, false);
    assert.equal(replay.verdict, "IMPLEMENTATION_VERIFIED");
    assert.equal(replay.verifiedHeadRevision, result.verifiedHeadRevision);
    assert.equal(replay.durableRef, result.durableRef);

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
