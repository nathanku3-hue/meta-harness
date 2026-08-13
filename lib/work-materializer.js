"use strict";

const fs = require("node:fs");
const path = require("node:path");

const { ConfigError } = require("./errors");
const { isProtectedProductDirectionPath } = require("./product-direction");
const { isProtectedRepoDecisionPlanePath } = require("./repo-decision-plane");
const { pathAllowed } = require("./work-git");
const { validRelativePath } = require("./work-session");

const MAX_CHANGE_COUNT = 200;
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_TOTAL_BYTES = 20 * 1024 * 1024;

function fail(code, message, details) {
  throw new ConfigError(message, { code, details });
}

function normalizeChangePath(value) {
  const normalized = String(value || "").replace(/\\/g, "/").replace(/^\.\//, "");
  if (normalized === "." || !validRelativePath(normalized)) {
    fail("MH_WORK_CHANGE_PATH", `invalid worker change path: ${value}`);
  }
  return normalized;
}

function inspectTarget(workspacePath, relativePath) {
  const root = path.resolve(workspacePath);
  const target = path.resolve(root, ...relativePath.split("/"));
  const rootPrefix = `${root}${path.sep}`.toLowerCase();
  if (!target.toLowerCase().startsWith(rootPrefix)) {
    fail("MH_WORK_CHANGE_PATH", `worker change escapes workspace: ${relativePath}`);
  }

  let current = root;
  const parts = relativePath.split("/");
  for (let index = 0; index < parts.length - 1; index += 1) {
    current = path.join(current, parts[index]);
    if (!fs.existsSync(current)) continue;
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink()) {
      fail("MH_WORK_CHANGE_SYMLINK", `worker change traverses a symlink: ${relativePath}`);
    }
    if (!stat.isDirectory()) {
      fail("MH_WORK_CHANGE_PARENT", `worker change parent is not a directory: ${relativePath}`);
    }
  }

  let existing = null;
  if (fs.existsSync(target)) {
    const stat = fs.lstatSync(target);
    if (stat.isSymbolicLink() || !stat.isFile()) {
      fail("MH_WORK_CHANGE_TARGET", `worker change target must be a regular non-symlink file: ${relativePath}`);
    }
    existing = {
      bytes: fs.readFileSync(target),
      mode: stat.mode,
    };
  }
  return { root, target, existing };
}

function validateWorkerChanges(workspacePath, changes, allowedPaths) {
  if (!Array.isArray(changes) || changes.length > MAX_CHANGE_COUNT) {
    fail("MH_WORK_CHANGES", `worker changes must contain at most ${MAX_CHANGE_COUNT} files`);
  }
  const seen = new Set();
  let totalBytes = 0;
  return changes.map((change, index) => {
    if (!change || typeof change !== "object" || Array.isArray(change)
        || Object.keys(change).sort().join("\0") !== "content\0path") {
      fail("MH_WORK_CHANGES", `worker change ${index} has an invalid shape`);
    }
    const relativePath = normalizeChangePath(change.path);
    if (isProtectedProductDirectionPath(relativePath)) {
      fail(
        "MH_PRODUCT_DIRECTION_PROTECTED",
        "worker proposed a mutation of PRODUCT.md; product direction is owner-authored only",
      );
    }
    if (isProtectedRepoDecisionPlanePath(relativePath)) {
      fail(
        "MH_REPO_DECISION_PROTECTED",
        `worker proposed a mutation of Decision Plane control state: ${relativePath}`,
      );
    }
    if (!pathAllowed(relativePath, allowedPaths)) {
      fail("MH_WORK_BOUNDARY_PATH", `worker proposed a file outside allowed paths: ${relativePath}`);
    }
    if (seen.has(relativePath)) {
      fail("MH_WORK_CHANGES", `worker proposed duplicate path: ${relativePath}`);
    }
    seen.add(relativePath);
    if (typeof change.content !== "string") {
      fail("MH_WORK_CHANGES", `worker change content must be text: ${relativePath}`);
    }
    const bytes = Buffer.byteLength(change.content, "utf8");
    if (bytes > MAX_FILE_BYTES) {
      fail("MH_WORK_CHANGE_SIZE", `worker change exceeds ${MAX_FILE_BYTES} bytes: ${relativePath}`);
    }
    totalBytes += bytes;
    if (totalBytes > MAX_TOTAL_BYTES) {
      fail("MH_WORK_CHANGE_SIZE", `worker changes exceed ${MAX_TOTAL_BYTES} total bytes`);
    }
    return {
      path: relativePath,
      content: change.content,
      bytes,
      ...inspectTarget(workspacePath, relativePath),
    };
  });
}

function rollback(applied) {
  for (const item of [...applied].reverse()) {
    try {
      if (item.existing) {
        fs.writeFileSync(item.target, item.existing.bytes);
        fs.chmodSync(item.target, item.existing.mode);
      } else if (fs.existsSync(item.target)) {
        fs.unlinkSync(item.target);
      }
    } catch (_) {
      // Preserve the original materialization error; rollback is best effort.
    }
  }
}

function materializeWorkerChanges(workspacePath, changes, allowedPaths) {
  const validated = validateWorkerChanges(workspacePath, changes, allowedPaths);
  const applied = [];
  try {
    for (const item of validated) {
      fs.mkdirSync(path.dirname(item.target), { recursive: true });
      fs.writeFileSync(item.target, item.content, "utf8");
      applied.push(item);
    }
  } catch (error) {
    rollback(applied);
    fail("MH_WORK_MATERIALIZE", `worker changes could not be materialized: ${error.message}`);
  }
  return validated.map((item) => item.path);
}

module.exports = {
  MAX_CHANGE_COUNT,
  MAX_FILE_BYTES,
  MAX_TOTAL_BYTES,
  materializeWorkerChanges,
  normalizeChangePath,
  validateWorkerChanges,
};
