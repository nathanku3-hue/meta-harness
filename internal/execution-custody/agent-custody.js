"use strict";

/**
 * Post-agent pre-materialization custody gate.
 * Proves the agent process did not mutate the detached worktree, refs, or config.
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
 * Immediately after the agent exits and before materialization:
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
    throw codedError("CUSTODY_AGENT_DETACHED", "worktree must remain detached after the agent exits");
  }
  if (after.head !== expectedBaseRevision) {
    throw codedError(
      "CUSTODY_AGENT_HEAD",
      `post-agent HEAD ${after.head} !== expected base ${expectedBaseRevision}`,
    );
  }
  if (before.head !== after.head) {
    throw codedError("CUSTODY_AGENT_HEAD_MOVED", "HEAD moved during agent execution");
  }
  if (after.status.trim() !== "") {
    throw codedError(
      "CUSTODY_AGENT_DIRTY",
      `post-agent worktree not fully clean (incl. ignored): ${JSON.stringify(after.status)}`,
    );
  }
  if (after.staged.trim() !== "") {
    throw codedError("CUSTODY_AGENT_INDEX", "post-agent index must be clean");
  }
  if (after.unstaged.trim() !== "") {
    throw codedError("CUSTODY_AGENT_UNSTAGED", "post-agent unstaged diff must be empty");
  }
  if (before.refs !== after.refs) {
    throw codedError("CUSTODY_AGENT_REFS", "refs changed during agent execution");
  }
  if (before.localConfig !== after.localConfig) {
    throw codedError("CUSTODY_AGENT_CONFIG", "local Git config changed during agent execution");
  }
  if (before.worktrees !== after.worktrees) {
    throw codedError("CUSTODY_AGENT_WORKTREES", "worktree registration changed during agent execution");
  }
  if (!sameCanonicalExistingPath(after.topLevel, worktreePath)) {
    throw codedError("CUSTODY_AGENT_TOPLEVEL", "worktree top-level identity mismatch after agent execution");
  }

  return after;
}

module.exports = {
  captureWorktreeCustody,
  assertPostAoCleanCustody,
};
