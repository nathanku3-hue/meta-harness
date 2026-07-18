"use strict";

const fs = require("node:fs");
const path = require("node:path");

const { ConfigError } = require("./errors");

function pathError(message, details = {}) {
  throw new ConfigError(message, {
    code: "MH_TRUTH_PATH",
    exitCode: 1,
    details,
  });
}

function isWithin(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function lstatIfPresent(targetPath) {
  try {
    return fs.lstatSync(targetPath);
  } catch (error) {
    if (error && error.code === "ENOENT") return null;
    throw error;
  }
}

function assertRepositoryRoot(targetRoot) {
  const root = path.resolve(targetRoot || process.cwd());
  const stats = lstatIfPresent(root);
  if (!stats || !stats.isDirectory()) {
    pathError("truth target root must be an existing directory", { path: root });
  }
  if (stats.isSymbolicLink()) {
    pathError("truth target root must not be a symlink, junction, or reparse link", { path: root });
  }
  const realRoot = fs.realpathSync.native(root);
  return { root, realRoot };
}

function assertContainedPath(targetRoot, targetPath, {
  allowMissingLeaf = false,
  allowMissingTail = false,
  leafType = "any",
  label = "truth path",
} = {}) {
  const { root, realRoot } = assertRepositoryRoot(targetRoot);
  const resolved = path.resolve(targetPath);
  if (!isWithin(root, resolved)) {
    pathError(`${label} must remain beneath the target repository`, { root, path: resolved });
  }

  const relative = path.relative(root, resolved);
  const parts = relative === "" ? [] : relative.split(path.sep).filter(Boolean);
  let current = root;
  let missingSeen = false;

  for (let index = 0; index < parts.length; index += 1) {
    current = path.join(current, parts[index]);
    const isLeaf = index === parts.length - 1;
    const stats = lstatIfPresent(current);
    if (!stats) {
      missingSeen = true;
      if (!(allowMissingTail || (allowMissingLeaf && isLeaf))) {
        pathError(`${label} is missing`, { path: current });
      }
      continue;
    }
    if (missingSeen) {
      pathError(`${label} has an unexpected existing descendant after a missing ancestor`, { path: current });
    }
    if (stats.isSymbolicLink()) {
      pathError(`${label} must not traverse a symlink, junction, or reparse link`, { path: current });
    }
    if (!isLeaf && !stats.isDirectory()) {
      pathError(`${label} ancestor must be a directory`, { path: current });
    }
    if (isLeaf && leafType === "file" && !stats.isFile()) {
      pathError(`${label} must be a regular file`, { path: current });
    }
    if (isLeaf && leafType === "directory" && !stats.isDirectory()) {
      pathError(`${label} must be a regular directory`, { path: current });
    }
    const realCurrent = fs.realpathSync.native(current);
    if (!isWithin(realRoot, realCurrent)) {
      pathError(`${label} resolves outside the target repository`, { root: realRoot, path: realCurrent });
    }
  }

  return resolved;
}

function assertHarnessAbsent(targetRoot) {
  const root = path.resolve(targetRoot || process.cwd());
  const harnessPath = path.join(root, ".meta-harness");
  const stats = lstatIfPresent(harnessPath);
  if (!stats) {
    assertContainedPath(root, harnessPath, {
      allowMissingLeaf: true,
      label: "harness bootstrap target",
    });
    return harnessPath;
  }
  if (stats.isSymbolicLink()) {
    pathError("existing .meta-harness must not be a symlink, junction, or reparse link", { path: harnessPath });
  }
  throw new ConfigError("repository is already initialized; use the explicit templates workflow for repairs", {
    code: "MH_ALREADY_INITIALIZED",
    exitCode: 1,
  });
}

function assertCanonicalReadPaths(targetRoot, { requireStatus = false } = {}) {
  const root = path.resolve(targetRoot || process.cwd());
  assertContainedPath(root, path.join(root, ".meta-harness"), {
    leafType: "directory",
    label: "canonical harness directory",
  });
  assertContainedPath(root, path.join(root, ".meta-harness", "contracts"), {
    leafType: "directory",
    label: "canonical authority directory",
  });
  const authorityPath = path.join(root, ".meta-harness", "contracts", "truth-authority-public.json");
  if (fs.existsSync(authorityPath)) {
    assertContainedPath(root, authorityPath, {
      leafType: "file",
      label: "canonical authority contract",
    });
  } else {
    assertContainedPath(root, authorityPath, {
      allowMissingLeaf: true,
      leafType: "file",
      label: "canonical authority contract",
    });
  }
  assertContainedPath(root, path.join(root, ".meta-harness", "events.jsonl"), {
    leafType: "file",
    label: "canonical event ledger",
  });
  if (requireStatus) {
    assertContainedPath(root, path.join(root, ".meta-harness", "status.md"), {
      leafType: "file",
      label: "canonical status projection",
    });
  }
}

function assertCanonicalMutationPaths(targetRoot, { allowMissingStatus = true } = {}) {
  const root = path.resolve(targetRoot || process.cwd());
  assertCanonicalReadPaths(root);
  assertContainedPath(root, path.join(root, ".meta-harness", "status.md"), {
    allowMissingLeaf: allowMissingStatus,
    leafType: "file",
    label: "canonical status projection",
  });
  const lockDirectory = assertContainedPath(root, path.join(root, ".meta-harness", "local", "locks"), {
    allowMissingTail: true,
    leafType: "directory",
    label: "canonical event lock directory",
  });
  fs.mkdirSync(lockDirectory, { recursive: true });
  assertContainedPath(root, lockDirectory, {
    leafType: "directory",
    label: "canonical event lock directory",
  });
  assertContainedPath(root, path.join(lockDirectory, "events.lock"), {
    allowMissingLeaf: true,
    leafType: "file",
    label: "canonical event lock",
  });
}

module.exports = {
  assertCanonicalMutationPaths,
  assertCanonicalReadPaths,
  assertContainedPath,
  assertHarnessAbsent,
  assertRepositoryRoot,
  isWithin,
};
