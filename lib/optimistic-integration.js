"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const { ConfigError } = require("./errors");
const { gitExecutableForWorkspace } = require("./git-command");
const { PRODUCT_HEAD_REF } = require("./product-head");
const OID_RE = /^[a-f0-9]{40,64}$/u;
const GIT_TIMEOUT_MS = 120_000;
const GIT_MAX_BUFFER = 16 * 1024 * 1024;

function fail(code, message, details) {
  throw new ConfigError(message, { code, details });
}

function runGit(cwd, args, { allowFailure = false, env = process.env } = {}) {
  const executable = gitExecutableForWorkspace({ cwd, fs });
  const result = spawnSync(executable, args, {
    cwd,
    env,
    encoding: "utf8",
    shell: false,
    windowsHide: true,
    timeout: GIT_TIMEOUT_MS,
    maxBuffer: GIT_MAX_BUFFER,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (!allowFailure && (result.error || result.status !== 0)) {
    fail(
      "MH_OPTIMISTIC_GIT",
      `git ${args.join(" ")} failed: ${String(result.stderr || result.stdout || result.error?.message || "unknown error").trim()}`,
      { status: result.status, causeCode: result.error?.code },
    );
  }
  return result;
}

function repositoryRoot(repositoryPath) {
  const target = path.resolve(String(repositoryPath || ""));
  let stat;
  try {
    stat = fs.lstatSync(target);
  } catch (error) {
    fail("MH_OPTIMISTIC_REPOSITORY", `repository path is unreadable: ${error.message}`);
  }
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    fail("MH_OPTIMISTIC_REPOSITORY", "repository path must be an existing non-symlink directory");
  }
  const result = runGit(target, ["rev-parse", "--show-toplevel"]);
  const root = String(result.stdout || "").trim();
  if (!root) fail("MH_OPTIMISTIC_REPOSITORY", "target is not a Git repository");
  return fs.realpathSync.native(path.resolve(root));
}

function validateIntegrationRef(root, ref) {
  const value = String(ref || "");
  if (!value.startsWith("refs/meta-harness/")) {
    fail("MH_OPTIMISTIC_REF", "integration ref must stay under refs/meta-harness/");
  }
  const result = runGit(root, ["check-ref-format", value], { allowFailure: true });
  if (result.status !== 0) fail("MH_OPTIMISTIC_REF", `invalid integration ref: ${value}`);
  return value;
}

function assertCommit(root, value, label) {
  const oid = String(value || "").trim();
  if (!OID_RE.test(oid)) fail("MH_OPTIMISTIC_COMMIT", `${label} must be a Git commit object id`);
  const result = runGit(root, ["cat-file", "-e", `${oid}^{commit}`], { allowFailure: true });
  if (result.status !== 0) fail("MH_OPTIMISTIC_COMMIT", `${label} is not an available commit: ${oid}`);
  return oid;
}

function objectFormat(root) {
  const format = String(runGit(root, ["rev-parse", "--show-object-format"]).stdout || "").trim();
  if (format === "sha1") return { name: format, zeroOid: "0".repeat(40) };
  if (format === "sha256") return { name: format, zeroOid: "0".repeat(64) };
  fail("MH_OPTIMISTIC_OBJECT_FORMAT", `unsupported Git object format: ${format || "unknown"}`);
}

function readIntegrationHead(repositoryPath, { ref = PRODUCT_HEAD_REF, optional = false } = {}) {
  const root = repositoryRoot(repositoryPath);
  const integrationRef = validateIntegrationRef(root, ref);
  const result = runGit(root, ["rev-parse", "--verify", "--quiet", `${integrationRef}^{commit}`], { allowFailure: true });
  const head = String(result.stdout || "").trim();
  if (result.status !== 0 || !OID_RE.test(head)) {
    if (optional) return null;
    fail("MH_OPTIMISTIC_REF_MISSING", `integration ref does not exist: ${integrationRef}`);
  }
  return head;
}

function initializeIntegrationHead({ repositoryPath, baseCommit, ref = PRODUCT_HEAD_REF }) {
  const root = repositoryRoot(repositoryPath);
  const integrationRef = validateIntegrationRef(root, ref);
  const base = assertCommit(root, baseCommit, "baseCommit");
  const current = readIntegrationHead(root, { ref: integrationRef, optional: true });
  if (current) {
    return Object.freeze({
      state: current === base ? "READY" : "CONFLICT",
      ref: integrationRef,
      expectedHead: base,
      observedHead: current,
    });
  }

  const { zeroOid } = objectFormat(root);
  const result = runGit(root, ["update-ref", integrationRef, base, zeroOid], { allowFailure: true });
  if (result.status === 0) {
    return Object.freeze({
      state: "INITIALIZED",
      ref: integrationRef,
      expectedHead: base,
      observedHead: base,
    });
  }

  const observed = readIntegrationHead(root, { ref: integrationRef, optional: true });
  if (observed) {
    return Object.freeze({
      state: observed === base ? "READY" : "CONFLICT",
      ref: integrationRef,
      expectedHead: base,
      observedHead: observed,
    });
  }
  fail("MH_OPTIMISTIC_REF_INIT", `integration ref could not be initialized: ${integrationRef}`);
}

function singleParent(root, commit, label) {
  const value = assertCommit(root, commit, label);
  const parts = String(runGit(root, ["rev-list", "--parents", "-n", "1", value]).stdout || "").trim().split(/\s+/u);
  if (parts.length !== 2 || parts[0] !== value || !OID_RE.test(parts[1])) {
    fail("MH_OPTIMISTIC_PARENT", `${label} must be a normal single-parent commit`);
  }
  return parts[1];
}

function optimisticCommitEnv() {
  return {
    ...process.env,
    GIT_AUTHOR_NAME: "Meta-Harness Optimistic Integration",
    GIT_AUTHOR_EMAIL: "optimistic-integration@meta-harness.invalid",
    GIT_COMMITTER_NAME: "Meta-Harness Optimistic Integration",
    GIT_COMMITTER_EMAIL: "optimistic-integration@meta-harness.invalid",
    GIT_AUTHOR_DATE: "2000-01-01T00:00:00Z",
    GIT_COMMITTER_DATE: "2000-01-01T00:00:00Z",
  };
}

function prepareCandidateAgainstObservedHead({
  repositoryPath,
  candidateBase,
  candidateHead,
  observedHead,
}) {
  const root = repositoryRoot(repositoryPath);
  const base = assertCommit(root, candidateBase, "candidateBase");
  const candidate = assertCommit(root, candidateHead, "candidateHead");
  const observed = assertCommit(root, observedHead, "observedHead");
  if (candidate === base) {
    return Object.freeze({
      state: "ALREADY_PRESENT",
      candidateBase: base,
      originalCandidateHead: candidate,
      observedHead: observed,
      preparedHead: observed,
      conflictPaths: [],
    });
  }
  const parent = singleParent(root, candidate, "candidateHead");
  if (parent !== base) {
    fail("MH_OPTIMISTIC_PARENT", "candidateHead must have candidateBase as its unique parent", {
      candidateHead: candidate,
      candidateBase: base,
      observedParent: parent,
    });
  }
  if (observed === base) {
    return Object.freeze({
      state: "PREPARED",
      candidateBase: base,
      originalCandidateHead: candidate,
      observedHead: observed,
      preparedHead: candidate,
      conflictPaths: [],
    });
  }

  const holder = fs.mkdtempSync(path.join(os.tmpdir(), "meta-harness-optimistic-integration-"));
  const workspacePath = path.join(holder, "workspace");
  try {
    runGit(root, ["worktree", "add", "--detach", workspacePath, observed]);
    const cherry = runGit(workspacePath, ["cherry-pick", "--no-commit", candidate], { allowFailure: true });
    if (cherry.error || cherry.status !== 0) {
      const paths = String(runGit(workspacePath, ["diff", "--name-only", "--diff-filter=U"], { allowFailure: true }).stdout || "")
        .split(/\r?\n/u).map((entry) => entry.trim()).filter(Boolean).sort();
      return Object.freeze({
        state: "CONFLICT",
        candidateBase: base,
        originalCandidateHead: candidate,
        observedHead: observed,
        preparedHead: null,
        conflictPaths: paths,
      });
    }
    const treeOid = String(runGit(workspacePath, ["write-tree"]).stdout || "").trim();
    const observedTree = String(runGit(workspacePath, ["rev-parse", `${observed}^{tree}`]).stdout || "").trim();
    if (!OID_RE.test(treeOid)) fail("MH_OPTIMISTIC_GIT", "replayed candidate did not produce a Git tree");
    if (treeOid === observedTree) {
      return Object.freeze({
        state: "ALREADY_PRESENT",
        candidateBase: base,
        originalCandidateHead: candidate,
        observedHead: observed,
        preparedHead: observed,
        conflictPaths: [],
      });
    }
    const message = `Meta-Harness optimistic replay ${candidate}`;
    const prepared = String(runGit(workspacePath, ["commit-tree", treeOid, "-p", observed, "-m", message], {
      env: optimisticCommitEnv(),
    }).stdout || "").trim();
    assertCommit(root, prepared, "preparedHead");
    return Object.freeze({
      state: "PREPARED",
      candidateBase: base,
      originalCandidateHead: candidate,
      observedHead: observed,
      preparedHead: prepared,
      conflictPaths: [],
    });
  } finally {
    runGit(root, ["worktree", "remove", "--force", workspacePath], { allowFailure: true });
    fs.rmSync(holder, { recursive: true, force: true });
  }
}

function compareAndSwapIntegrationHead({
  repositoryPath,
  expectedHead,
  candidateHead,
  ref = PRODUCT_HEAD_REF,
}) {
  const root = repositoryRoot(repositoryPath);
  const integrationRef = validateIntegrationRef(root, ref);
  const expected = assertCommit(root, expectedHead, "expectedHead");
  const candidate = assertCommit(root, candidateHead, "candidateHead");

  const result = runGit(root, ["update-ref", integrationRef, candidate, expected], { allowFailure: true });
  if (result.status === 0) {
    return Object.freeze({
      state: "LANDED",
      ref: integrationRef,
      expectedHead: expected,
      candidateHead: candidate,
      observedHead: candidate,
    });
  }

  return Object.freeze({
    state: "CONFLICT",
    ref: integrationRef,
    expectedHead: expected,
    candidateHead: candidate,
    observedHead: readIntegrationHead(root, { ref: integrationRef, optional: true }),
  });
}

module.exports = {
  PRODUCT_HEAD_REF,
  compareAndSwapIntegrationHead,
  initializeIntegrationHead,
  prepareCandidateAgainstObservedHead,
  readIntegrationHead,
};
