"use strict";

/**
 * D070-A1 post-AO pre-materialization custody gate.
 * Proves the AO process did not mutate the detached worktree / refs / config.
 */

const { codedError, sameCanonicalExistingPath } = require("./support");
const {
  runGit,
  isDetachedHead,
} = require("./git-ops");

function captureWorktreeCustody(gitExecutablePath, worktreePath, repositoryPath, gitHome) {
  const head = String(
    runGit(gitExecutablePath, worktreePath, ["rev-parse", "HEAD"], gitHome).stdout,
  ).trim();
  const detached = isDetachedHead(gitExecutablePath, worktreePath, gitHome);
  const status = String(
    runGit(
      gitExecutablePath,
      worktreePath,
      ["status", "--porcelain=v1", "-uall", "--ignored"],
      gitHome,
    ).stdout,
  );
  const staged = String(
    runGit(gitExecutablePath, worktreePath, ["diff", "--cached", "--name-status"], gitHome).stdout,
  );
  const unstaged = String(
    runGit(gitExecutablePath, worktreePath, ["diff", "--name-status"], gitHome).stdout,
  );
  const refs = String(
    runGit(
      gitExecutablePath,
      repositoryPath,
      ["for-each-ref", "--format=%(refname) %(objectname)"],
      gitHome,
    ).stdout,
  );
  const localConfig = String(
    runGit(
      gitExecutablePath,
      worktreePath,
      ["config", "--local", "--list", "--show-origin"],
      gitHome,
    ).stdout,
  );
  const worktrees = String(
    runGit(gitExecutablePath, repositoryPath, ["worktree", "list", "--porcelain"], gitHome).stdout,
  );
  const topLevel = String(
    runGit(gitExecutablePath, worktreePath, ["rev-parse", "--show-toplevel"], gitHome).stdout,
  ).trim();

  return {
    head,
    detached,
    status,
    staged,
    unstaged,
    refs,
    localConfig,
    worktrees,
    topLevel,
  };
}

/**
 * Immediately after AO exits and before materialization:
 * detached HEAD still equals expected base; fully clean; index clean;
 * no untracked/ignored; refs/config/worktree registration unchanged.
 */
function assertPostAoCleanCustody({
  gitExecutablePath,
  worktreePath,
  repositoryPath,
  gitHome,
  expectedBaseRevision,
  before,
}) {
  const after = captureWorktreeCustody(
    gitExecutablePath,
    worktreePath,
    repositoryPath,
    gitHome,
  );

  if (!after.detached) {
    throw codedError("D070_CUSTODY_DETACHED", "worktree must remain detached after AO");
  }
  if (after.head !== expectedBaseRevision) {
    throw codedError(
      "D070_CUSTODY_HEAD",
      `post-AO HEAD ${after.head} !== expected base ${expectedBaseRevision}`,
    );
  }
  if (before.head !== after.head) {
    throw codedError("D070_CUSTODY_HEAD_MOVED", "HEAD moved during AO");
  }
  if (after.status.trim() !== "") {
    throw codedError(
      "D070_CUSTODY_DIRTY",
      `post-AO worktree not fully clean (incl. ignored): ${JSON.stringify(after.status)}`,
    );
  }
  if (after.staged.trim() !== "") {
    throw codedError("D070_CUSTODY_INDEX", "post-AO index must be clean");
  }
  if (after.unstaged.trim() !== "") {
    throw codedError("D070_CUSTODY_UNSTAGED", "post-AO unstaged diff must be empty");
  }
  if (before.refs !== after.refs) {
    throw codedError("D070_CUSTODY_REFS", "refs changed during AO");
  }
  if (before.localConfig !== after.localConfig) {
    throw codedError("D070_CUSTODY_CONFIG", "local Git config changed during AO");
  }
  if (before.worktrees !== after.worktrees) {
    throw codedError("D070_CUSTODY_WORKTREES", "worktree registration changed during AO");
  }
  if (!sameCanonicalExistingPath(after.topLevel, worktreePath)) {
    throw codedError("D070_CUSTODY_TOPLEVEL", "worktree top-level identity mismatch after AO");
  }

  return after;
}

module.exports = {
  captureWorktreeCustody,
  assertPostAoCleanCustody,
};
