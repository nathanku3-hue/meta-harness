"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const GIT_TIMEOUT_MS = 20_000;
const GIT_MAX_BUFFER = 10 * 1024 * 1024;

function parseStatusZ(text) {
  const tokens = String(text).split("\0").filter((token) => token.length > 0);
  const paths = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token.length < 4) {
      throw new Error("malformed git status output");
    }
    const itemStatus = token.slice(0, 2);
    const filePath = token.slice(3);
    if (!filePath) {
      throw new Error("malformed git status path");
    }
    paths.push(filePath);
    if (["R", "C"].includes(itemStatus[0]) || ["R", "C"].includes(itemStatus[1])) {
      const originalPath = tokens[index + 1];
      if (!originalPath) {
        throw new Error("malformed git rename/copy output");
      }
      paths.push(originalPath);
      index += 1;
    }
    if (itemStatus.includes("S")) {
      paths.push("submodule");
    }
  }
  return paths;
}

function readOwners(targetRoot, unavailableError) {
  const ownersPath = path.join(targetRoot, "docs", "architecture", "owners.json");
  if (!fs.existsSync(ownersPath)) {
    return [];
  }
  try {
    const owners = JSON.parse(fs.readFileSync(ownersPath, "utf8"));
    if (Array.isArray(owners.owned_paths)) return owners.owned_paths;
    if (Array.isArray(owners.ownedPaths)) return owners.ownedPaths;
    if (Array.isArray(owners.paths)) return owners.paths;
    if (Array.isArray(owners.modules)) {
      return owners.modules.flatMap((mod) => mod.owned_paths || mod.ownedPaths || mod.paths || []);
    }
  } catch (error) {
    throw new unavailableError(`owners.json is unreadable: ${error.message}`);
  }
  return [];
}

function makeClassifyCurrentChangeSet({
  classifyPaths,
  higherTier,
  normalizePath,
  normalizeResult,
  ShipGateUnavailableError,
  UsageError,
}) {
  return function classifyCurrentChangeSet({ targetRoot, ...options } = {}) {
    if (!targetRoot) {
      throw new UsageError("ship gate current change classification requires targetRoot");
    }
    const resolved = path.resolve(targetRoot);
    if (!fs.existsSync(path.join(resolved, ".git"))) {
      throw new ShipGateUnavailableError("target is not a git repository");
    }
    const result = spawnSync("git", [
      "--no-optional-locks",
      "status",
      "--porcelain=v1",
      "-z",
      "--untracked-files=all",
    ], {
      cwd: resolved,
      encoding: "utf8",
      shell: false,
      timeout: GIT_TIMEOUT_MS,
      maxBuffer: GIT_MAX_BUFFER,
    });
    if (result.error || result.status !== 0) {
      throw new ShipGateUnavailableError(`git status unavailable: ${(result.stderr || result.error?.message || "git status failed").trim()}`);
    }
    const ownedPaths = options.owned_paths || options.ownedPaths || readOwners(resolved, ShipGateUnavailableError);
    const paths = parseStatusZ(result.stdout);
    const normalizedPaths = paths.map((item) => item === "submodule" ? item : normalizePath(item));
    const hasSubmodule = normalizedPaths.includes("submodule");
    const classification = classifyPaths(normalizedPaths.filter((item) => item !== "submodule"), {
      ...options,
      owned_paths: ownedPaths,
    });
    if (!hasSubmodule) {
      return classification;
    }
    return normalizeResult(
      higherTier(classification.tier, "SLOW"),
      "decision-needed",
      [...classification.reasons, "submodule change requires decision review unless explicitly policy-covered"],
      classification.changed_paths,
    );
  };
}

module.exports = {
  makeClassifyCurrentChangeSet,
  parseStatusZ,
};
