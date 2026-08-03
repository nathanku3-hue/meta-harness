"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { UsageError } = require("./errors");

const MAX_SCAN_DEPTH = 4;
const MAX_CANDIDATES = 128;
const EXCLUDED_DIRECTORY_NAMES = new Set([
  ".git",
  ".meta-harness",
  ".worktrees",
  "archives",
  "archive",
  "audits",
  "build",
  "coverage",
  "dist",
  "evidence",
  "fixtures",
  "historical",
  "history",
  "node_modules",
  "snapshots",
  "tmp",
  "vendor",
]);
const ARCHIVE_EXTENSIONS = new Set([".7z", ".bz2", ".gz", ".rar", ".tar", ".tgz", ".xz", ".zip"]);

function toSlash(value) {
  return value.split(path.sep).join("/");
}

function isWindowsAbsolute(value) {
  return /^[A-Za-z]:[\\/]/.test(value) || value.startsWith("\\\\");
}

function isWithin(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function safeRealpath(root, candidate, label) {
  const realRoot = fs.realpathSync(root);
  let realCandidate;
  try {
    realCandidate = fs.realpathSync(candidate);
  } catch (error) {
    if (error && error.code === "ENOENT") {
      throw new UsageError(`${label} must name an existing path: ${candidate}`);
    }
    throw error;
  }
  if (!isWithin(realRoot, realCandidate)) {
    throw new UsageError(`${label} escapes the target root through a symlink: ${candidate}`);
  }
  return realCandidate;
}

function validateRelativePackageRoot(targetRoot, value) {
  if (value === undefined || value === null || value === true || Array.isArray(value) || String(value).trim() === "") {
    throw new UsageError("--package-root requires one non-empty relative path");
  }

  const raw = String(value).trim();
  if (path.isAbsolute(raw) || isWindowsAbsolute(raw)) {
    throw new UsageError(`--package-root must be relative to the target root: ${raw}`);
  }

  const segments = raw.replace(/\\/g, "/").split("/");
  if (segments.some((segment) => segment === "..")) {
    throw new UsageError(`--package-root may not contain a parent traversal: ${raw}`);
  }
  const excludedSegment = segments.find((segment) => {
    const lower = segment.toLowerCase();
    return lower !== "."
      && (EXCLUDED_DIRECTORY_NAMES.has(lower) || ARCHIVE_EXTENSIONS.has(path.extname(lower)));
  });
  if (excludedSegment) {
    throw new UsageError(`--package-root may not select an excluded directory: ${excludedSegment}`);
  }

  const candidate = path.resolve(targetRoot, raw);
  if (!isWithin(path.resolve(targetRoot), candidate)) {
    throw new UsageError(`--package-root escapes the target root: ${raw}`);
  }
  return {
    raw,
    candidate,
    relative: toSlash(path.relative(path.resolve(targetRoot), candidate)) || ".",
  };
}

function isRegularFile(filePath, root, label) {
  let stat;
  try {
    stat = fs.lstatSync(filePath);
  } catch (error) {
    if (error && error.code === "ENOENT") return false;
    throw error;
  }
  if (stat.isSymbolicLink()) {
    safeRealpath(root, filePath, label);
    return fs.statSync(filePath).isFile();
  }
  return stat.isFile();
}

function hasPackageManifest(directory, root, label = "package.json") {
  const manifestPath = path.join(directory, "package.json");
  return isRegularFile(manifestPath, root, label);
}

function excludedDirectory(name, relativePath) {
  const lowerName = name.toLowerCase();
  const lowerPath = relativePath.toLowerCase();
  if (EXCLUDED_DIRECTORY_NAMES.has(lowerName)) return true;
  if (ARCHIVE_EXTENSIONS.has(path.extname(lowerName))) return true;
  return lowerPath.split("/").some((part) => EXCLUDED_DIRECTORY_NAMES.has(part));
}

function scanNestedPackageRoots(targetRoot) {
  const candidates = [];
  const root = path.resolve(targetRoot);

  function walk(directory, depth) {
    if (depth > MAX_SCAN_DEPTH || candidates.length >= MAX_CANDIDATES) return;
    let entries;
    try {
      entries = fs.readdirSync(directory, { withFileTypes: true });
    } catch (error) {
      if (error && (error.code === "EACCES" || error.code === "EPERM")) return;
      throw error;
    }

    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      if (candidates.length >= MAX_CANDIDATES) return;
      const child = path.join(directory, entry.name);
      const relative = toSlash(path.relative(root, child));
      if (!relative || excludedDirectory(entry.name, relative)) continue;
      if (entry.isSymbolicLink()) continue;
      if (!entry.isDirectory()) continue;

      if (hasPackageManifest(child, root, `package root ${relative}/package.json`)) {
        candidates.push({
          packageRoot: child,
          packageRootRelative: relative,
        });
      }
      walk(child, depth + 1);
    }
  }

  walk(root, 1);
  return candidates;
}

function packageResolution({ packageRoot, packageDiscovery, packageRootRelative, candidates, error } = {}) {
  return {
    packageRoot: packageRoot || null,
    packageRootRelative: packageRootRelative || null,
    packageDiscovery: packageDiscovery || "none",
    candidates: candidates || [],
    error: error || null,
  };
}

function resolvePackageRoot(targetRoot, explicitPackageRoot) {
  const root = path.resolve(targetRoot || process.cwd());
  safeRealpath(root, root, "target root");

  if (explicitPackageRoot !== undefined) {
    const validated = validateRelativePackageRoot(root, explicitPackageRoot);
    const stat = fs.lstatSync(validated.candidate);
    if (stat.isSymbolicLink()) {
      safeRealpath(root, validated.candidate, "--package-root");
    }
    if (!stat.isDirectory() && !stat.isSymbolicLink()) {
      throw new UsageError(`--package-root must name a directory: ${validated.raw}`);
    }
    if (!hasPackageManifest(validated.candidate, root, `--package-root ${validated.raw}/package.json`)) {
      throw new UsageError(`--package-root does not contain package.json: ${validated.raw}`);
    }
    return packageResolution({
      packageRoot: validated.candidate,
      packageRootRelative: validated.relative,
      packageDiscovery: "explicit",
    });
  }

  if (hasPackageManifest(root, root, "root package.json")) {
    return packageResolution({
      packageRoot: root,
      packageRootRelative: ".",
      packageDiscovery: "root_package",
    });
  }

  const candidates = scanNestedPackageRoots(root);
  if (candidates.length === 1) {
    return packageResolution({
      packageRoot: candidates[0].packageRoot,
      packageRootRelative: candidates[0].packageRootRelative,
      packageDiscovery: "single_nested_candidate",
      candidates: candidates.map((candidate) => candidate.packageRootRelative),
    });
  }
  if (candidates.length > 1) {
    const candidatePaths = candidates.map((candidate) => candidate.packageRootRelative).sort();
    return packageResolution({
      packageDiscovery: "ambiguous",
      candidates: candidatePaths,
      error: `multiple package.json files found under the target root: ${candidatePaths.join(", ")}; pass --package-root <relative-path> to select one`,
    });
  }

  return packageResolution({ packageDiscovery: "none" });
}

function compareVersions(left, right) {
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return 0;
}

function parseVersionToken(token, allowWildcards = true) {
  const normalized = String(token || "").trim().replace(/^v/i, "");
  if (!normalized) return null;
  const parts = normalized.split(".");
  if (parts.length > 3) return null;
  const values = [];
  let hasWildcard = false;
  for (let index = 0; index < 3; index += 1) {
    const part = parts[index];
    if (part === undefined) {
      if (allowWildcards) {
        hasWildcard = true;
        values.push(null);
      } else {
        values.push(0);
      }
      continue;
    }
    if (/^[xX*]$/.test(part)) {
      hasWildcard = true;
      values.push(null);
      continue;
    }
    if (!/^\d+$/.test(part)) return null;
    values.push(Number(part));
  }
  if (!allowWildcards && hasWildcard) return null;
  return { values, hasWildcard };
}

function upperForWildcard(version) {
  const [major, minor, patch] = version.values;
  if (major === null) return null;
  if (minor === null) return [major + 1, 0, 0];
  if (patch === null) return [major, minor + 1, 0];
  return [major, minor, patch + 1];
}

function exactBounds(version) {
  const lower = [version.values[0] || 0, version.values[1] || 0, version.values[2] || 0];
  return {
    lower: { version: lower, inclusive: true },
    upper: version.hasWildcard ? { version: upperForWildcard(version), inclusive: false } : { version: lower, inclusive: true },
  };
}

function setLower(bounds, version, inclusive) {
  const next = { version, inclusive };
  if (!bounds.lower || compareVersions(version, bounds.lower.version) > 0 ||
      (compareVersions(version, bounds.lower.version) === 0 && !inclusive && bounds.lower.inclusive)) {
    bounds.lower = next;
  }
}

function setUpper(bounds, version, inclusive) {
  const next = { version, inclusive };
  if (!bounds.upper || compareVersions(version, bounds.upper.version) < 0 ||
      (compareVersions(version, bounds.upper.version) === 0 && !inclusive && bounds.upper.inclusive)) {
    bounds.upper = next;
  }
}

function parseNodeClause(clause) {
  const tokens = clause.replace(/,/g, " ").trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return null;
  const bounds = { lower: null, upper: null };

  for (const token of tokens) {
    const match = token.match(/^(\^|~|>=|<=|>|<|=)?(.*)$/);
    if (!match || !match[2]) return null;
    const operator = match[1] || "";
    const version = parseVersionToken(match[2], operator === "");
    if (!version) return null;

    if (operator === "^" || operator === "~") {
      if (version.hasWildcard || version.values[0] === null) return null;
      const lower = version.values;
      const upper = operator === "^"
        ? (lower[0] > 0 ? [lower[0] + 1, 0, 0] : [0, lower[1] + 1, 0])
        : [lower[0], lower[1] + 1, 0];
      setLower(bounds, lower, true);
      setUpper(bounds, upper, false);
      continue;
    }

    if (operator === "") {
      if (version.values[0] === null) return null;
      const exact = exactBounds(version);
      setLower(bounds, exact.lower.version, exact.lower.inclusive);
      if (exact.upper) setUpper(bounds, exact.upper.version, exact.upper.inclusive);
      continue;
    }

    if (version.hasWildcard || version.values[0] === null) return null;
    const normalized = version.values;
    if (operator === ">=") setLower(bounds, normalized, true);
    else if (operator === ">") setLower(bounds, normalized, false);
    else if (operator === "<=") setUpper(bounds, normalized, true);
    else if (operator === "<") setUpper(bounds, normalized, false);
    else if (operator === "=") {
      setLower(bounds, normalized, true);
      setUpper(bounds, normalized, true);
    } else return null;
  }

  return bounds;
}

function evaluateNodeRange(range, minimumMajor = 20) {
  if (typeof range !== "string" || range.trim() === "") {
    return { valid: false, supported: false, reason: "engines.node must be a non-empty semver range" };
  }
  const alternatives = range.split("||").map((part) => parseNodeClause(part));
  if (alternatives.some((bounds) => !bounds)) {
    return { valid: false, supported: false, reason: `malformed Node range: ${range}` };
  }

  for (const bounds of alternatives) {
    if (!bounds.lower || bounds.lower.version[0] < minimumMajor) {
      return { valid: true, supported: false, reason: `Node range permits versions below ${minimumMajor}` };
    }
    if (bounds.upper && bounds.upper.version[0] < minimumMajor) {
      return { valid: true, supported: false, reason: `Node range ends before ${minimumMajor}` };
    }
    if (bounds.upper) {
      const comparison = compareVersions(bounds.lower.version, bounds.upper.version);
      if (comparison > 0 || (comparison === 0 && (!bounds.lower.inclusive || !bounds.upper.inclusive))) {
        return { valid: true, supported: false, reason: "Node range is empty" };
      }
    }
  }

  return { valid: true, supported: true, reason: "" };
}

function isNodeRangeSupported(range, minimumMajor = 20) {
  const result = evaluateNodeRange(range, minimumMajor);
  return result.valid && result.supported;
}

module.exports = {
  evaluateNodeRange,
  isNodeRangeSupported,
  resolvePackageRoot,
  scanNestedPackageRoots,
};
