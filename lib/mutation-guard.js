"use strict";

const fs = require("node:fs");
const path = require("node:path");

const MANAGED_MARKER = path.join("meta-harness", "managed-v1");

function normalizeAbsolute(value) {
  const resolved = path.resolve(String(value));
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function isWithin(root, target) {
  const normalizedRoot = normalizeAbsolute(root);
  const normalizedTarget = normalizeAbsolute(target);
  const relative = path.relative(normalizedRoot, normalizedTarget);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function deepestExistingAncestor(targetPath, fsApi = fs) {
  let current = path.resolve(targetPath);
  while (true) {
    try {
      const stat = fsApi.lstatSync(current);
      if (stat.isSymbolicLink()) return current;
      return current;
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      const parent = path.dirname(current);
      if (parent === current) throw error;
      current = parent;
    }
  }
}

function canonicalMutationTarget(targetPath, fsApi = fs) {
  const requested = path.resolve(String(targetPath));
  const ancestor = deepestExistingAncestor(requested, fsApi);
  let canonicalAncestor;
  try {
    canonicalAncestor = fsApi.realpathSync.native
      ? fsApi.realpathSync.native(ancestor)
      : fsApi.realpathSync(ancestor);
  } catch (error) {
    throw new Error(`cannot canonicalize mutation target: ${error.message}`);
  }
  const suffix = path.relative(ancestor, requested);
  return path.resolve(canonicalAncestor, suffix);
}

function findGitCommonDir(targetPath, fsApi = fs) {
  const canonicalTarget = canonicalMutationTarget(targetPath, fsApi);
  let current = canonicalTarget;
  try {
    if (!fsApi.lstatSync(canonicalTarget).isDirectory()) current = path.dirname(canonicalTarget);
  } catch (_) {
    current = path.dirname(canonicalTarget);
  }
  while (true) {
    const gitPath = path.join(current, ".git");
    try {
      const stat = fsApi.lstatSync(gitPath);
      if (stat.isSymbolicLink()) return null;
      if (stat.isDirectory()) return canonicalMutationTarget(gitPath, fsApi);
      if (stat.isFile()) {
        const content = fsApi.readFileSync(gitPath, "utf8");
        const match = /^gitdir:\s*(.+?)\s*$/mu.exec(content);
        if (!match) return null;
        const gitDir = canonicalMutationTarget(path.resolve(current, match[1]), fsApi);
        const commondirPath = path.join(gitDir, "commondir");
        try {
          const commonRef = fsApi.readFileSync(commondirPath, "utf8").trim();
          return canonicalMutationTarget(path.resolve(gitDir, commonRef), fsApi);
        } catch (error) {
          if (error?.code !== "ENOENT") return null;
          return canonicalMutationTarget(path.resolve(gitDir, "../.."), fsApi);
        }
      }
    } catch (error) {
      if (error?.code !== "ENOENT") return null;
    }
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

function managedMarkerPath(gitCommonDir) {
  return path.join(path.resolve(gitCommonDir), MANAGED_MARKER);
}

function isManagedGitTarget(targetPath, fsApi = fs) {
  const canonicalTarget = canonicalMutationTarget(targetPath, fsApi);
  const commonDir = findGitCommonDir(canonicalTarget, fsApi);
  if (!commonDir) return { managed: false, canonicalTarget, commonDir: null };
  const marker = managedMarkerPath(commonDir);
  let exists = false;
  try {
    const stat = fsApi.lstatSync(marker);
    exists = stat.isFile() && !stat.isSymbolicLink();
  } catch (error) {
    if (error?.code !== "ENOENT") throw new Error(`cannot inspect Meta-Harness managed marker: ${error.message}`);
  }
  return { managed: exists, canonicalTarget, commonDir, marker };
}

function assertMutationTargetAllowed(targetPath, fsApi = fs) {
  let result;
  try {
    result = isManagedGitTarget(targetPath, fsApi);
  } catch (error) {
    const denial = new Error(`mutation denied because target identity is uncertain: ${error.message}`);
    denial.code = "MH_DEVSPACE_MUTATION_CANONICALIZATION_DENIED";
    throw denial;
  }
  if (result.managed) {
    const denial = new Error(`mutation denied for Meta-Harness-managed repository target: ${result.canonicalTarget}`);
    denial.code = "MH_DEVSPACE_MUTATION_DENIED";
    throw denial;
  }
  return result;
}

module.exports = {
  MANAGED_MARKER,
  assertMutationTargetAllowed,
  canonicalMutationTarget,
  findGitCommonDir,
  isManagedGitTarget,
  managedMarkerPath,
};
