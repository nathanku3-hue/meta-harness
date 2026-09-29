"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const { domainDigest } = require("../contracts/digest");
const {
  absNorm,
  canonicalExistingRoot,
  codedError,
  hostRealPath,
  rootsPairwiseSeparated,
} = require("../execution-custody/support");

const STATE_ROOT_DOMAIN = "meta-harness-repository-state-root/v1";
const REPOSITORY_IDENTITY_DOMAIN = "meta-harness-repository-identity/v1";
const PROTOCOL_NAMESPACE = "meta-harness/0.4";

function runGit(repositoryPath, args) {
  const result = spawnSync("git", ["-C", repositoryPath, ...args], {
    encoding: "utf8",
    windowsHide: true,
    timeout: 30000,
  });
  if (result.error || result.status !== 0) {
    throw codedError(
      "SEMANTIC_GIT_IDENTITY",
      `git ${args.join(" ")} failed: ${String(result.stderr || result.error?.message || "unknown error").trim()}`,
    );
  }
  return String(result.stdout || "").trim();
}

function physicalIdentity(existingPath) {
  const physicalPath = hostRealPath(existingPath);
  const stat = fs.statSync(physicalPath);
  return Object.freeze({
    physicalPath: process.platform === "win32" ? physicalPath.toLowerCase() : physicalPath,
    device: String(stat.dev),
    inode: String(stat.ino),
  });
}

function resolveRepositoryIdentity(repositoryPathInput) {
  const repositoryPath = canonicalExistingRoot(absNorm(repositoryPathInput), "repositoryPath");
  const commonDirText = runGit(repositoryPath, ["rev-parse", "--git-common-dir"]);
  const commonDirInput = path.isAbsolute(commonDirText)
    ? commonDirText
    : path.resolve(repositoryPath, commonDirText);
  const canonicalGitCommonDir = canonicalExistingRoot(
    absNorm(commonDirInput),
    "canonical Git common directory",
  );
  const gitObjectFormat = runGit(repositoryPath, ["rev-parse", "--show-object-format"]);
  if (!new Set(["sha1", "sha256"]).has(gitObjectFormat)) {
    throw codedError("SEMANTIC_GIT_OBJECT_FORMAT", `unsupported Git object format: ${gitObjectFormat}`);
  }

  const canonicalGitCommonDirIdentity = physicalIdentity(canonicalGitCommonDir);
  const repositoryIdentityDigest = domainDigest(REPOSITORY_IDENTITY_DOMAIN, {
    canonicalGitCommonDirIdentity,
    gitObjectFormat,
  });
  const stateRootKey = domainDigest(STATE_ROOT_DOMAIN, {
    canonicalGitCommonDirIdentity,
    gitObjectFormat,
    protocolNamespace: PROTOCOL_NAMESPACE,
  });

  return Object.freeze({
    repositoryPath,
    canonicalGitCommonDir,
    canonicalGitCommonDirIdentity,
    gitObjectFormat,
    protocolNamespace: PROTOCOL_NAMESPACE,
    repositoryIdentityDigest,
    stateRootKey,
  });
}

function defaultHostStateBase() {
  if (process.platform === "win32") {
    return absNorm(path.join(path.parse(os.homedir()).root, "ProgramData", "MetaHarness", "state", "0.4"));
  }
  if (process.platform === "darwin") {
    return "/Library/Application Support/MetaHarness/state/0.4";
  }
  return "/var/lib/meta-harness/state/0.4";
}

function resolveAtBase(repositoryPathInput, stateBaseInput, createBase) {
  const identity = resolveRepositoryIdentity(repositoryPathInput);
  const stateBase = absNorm(stateBaseInput);
  if (createBase) fs.mkdirSync(stateBase, { recursive: true, mode: 0o700 });
  if (!fs.existsSync(stateBase)) {
    throw codedError("SEMANTIC_STATE_BASE_MISSING", `host-global state base does not exist: ${stateBase}`);
  }
  const canonicalStateBase = canonicalExistingRoot(stateBase, "host-global state base");
  rootsPairwiseSeparated(identity.repositoryPath, canonicalStateBase, "repositoryPath", "stateBase");
  rootsPairwiseSeparated(identity.canonicalGitCommonDir, canonicalStateBase, "gitCommonDir", "stateBase");

  const stateRoot = absNorm(path.join(
    canonicalStateBase,
    "repositories",
    identity.stateRootKey.slice("sha256:".length),
  ));
  return Object.freeze({ ...identity, stateBase: canonicalStateBase, stateRoot });
}

function resolveRepositoryStateRoot(repositoryPathInput) {
  return resolveAtBase(repositoryPathInput, defaultHostStateBase(), true);
}

function resolveRepositoryStateRootForTests(repositoryPathInput, stateBaseInput) {
  return resolveAtBase(repositoryPathInput, stateBaseInput, true);
}

module.exports = {
  PROTOCOL_NAMESPACE,
  REPOSITORY_IDENTITY_DOMAIN,
  STATE_ROOT_DOMAIN,
  defaultHostStateBase,
  resolveRepositoryIdentity,
  resolveRepositoryStateRoot,
  resolveRepositoryStateRootForTests,
};
