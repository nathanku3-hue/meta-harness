"use strict";

const fs = require("node:fs");
const path = require("node:path");

const { ConfigError } = require("./errors");
const { isProtectedProductDirectionPath } = require("./product-direction");
const { pathAllowed } = require("./work-git");
const { validRelativePath } = require("./work-session");

const MAX_OPERATION_COUNT = 200;
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_TOTAL_BYTES = 20 * 1024 * 1024;
const DEFAULT_NEW_FILE_LIMIT = 2;

function fail(code, message, details) {
  throw new ConfigError(message, { code, details });
}

function normalizeMutationPath(value) {
  const normalized = String(value || "").replace(/\\/g, "/").replace(/^\.\//, "");
  if (normalized === "." || !validRelativePath(normalized)) {
    fail("MH_WORK_OPERATION_PATH", `invalid worker operation path: ${value}`);
  }
  return normalized;
}

function pathKey(value) {
  const normalized = normalizeMutationPath(value);
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function exactAllowedPathKeys(allowedPaths) {
  return new Set((allowedPaths || [])
    .map((entry) => String(entry || "").replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/$/, ""))
    .filter((entry) => entry && entry !== ".")
    .map(pathKey));
}

function isSlopProneNewPath(relativePath) {
  const normalized = relativePath.replace(/\\/g, "/").toLowerCase();
  const filename = path.posix.basename(normalized);
  return normalized.startsWith("docs/saw_reports/")
    || /_v\d+[a-z]?(?=\.[^.]+$|$)/i.test(filename)
    || /_20\d{6}(?=\.[^.]+$|$)/.test(filename)
    || /(?:^|[_-])(?:court|constitution|reflection|handoff|memo|lineage)(?:[_\-.]|$)/i.test(filename)
    || /(?:worker|status|completion)[_-]?report/i.test(filename);
}

function assertMutablePath(relativePath, allowedPaths, protectedPaths = []) {
  if (isProtectedProductDirectionPath(relativePath)) {
    fail(
      "MH_PRODUCT_DIRECTION_PROTECTED",
      "worker proposed a mutation of PRODUCT.md; product direction is owner-authored only",
    );
  }
  const key = process.platform === "win32" ? relativePath.toLowerCase() : relativePath;
  const protectedSet = new Set((protectedPaths || []).map((item) => process.platform === "win32" ? String(item).toLowerCase() : String(item)));
  if (protectedSet.has(key)) {
    fail("MH_REPOSITORY_CONTRACT_PROTECTED", `worker proposed a mutation of a bound repository contract: ${relativePath}`);
  }
  const lowerPath = relativePath.toLowerCase();
  if (lowerPath === ".meta-harness" || lowerPath.startsWith(".meta-harness/")) {
    fail("MH_WORK_CONTROL_PATH", `worker proposed a protected controller path: ${relativePath}`);
  }
  if (!pathAllowed(relativePath, allowedPaths)) {
    fail("MH_WORK_BOUNDARY_PATH", `worker proposed a file outside allowed paths: ${relativePath}`);
  }
}

function inspectTarget(workspacePath, relativePath) {
  const root = path.resolve(workspacePath);
  const target = path.resolve(root, ...relativePath.split("/"));
  const rootPrefix = `${root}${path.sep}`.toLowerCase();
  if (!target.toLowerCase().startsWith(rootPrefix)) {
    fail("MH_WORK_OPERATION_PATH", `worker operation escapes workspace: ${relativePath}`);
  }

  let current = root;
  const parts = relativePath.split("/");
  for (let index = 0; index < parts.length - 1; index += 1) {
    current = path.join(current, parts[index]);
    if (!fs.existsSync(current)) continue;
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink()) {
      fail("MH_WORK_OPERATION_SYMLINK", `worker operation traverses a symlink: ${relativePath}`);
    }
    if (!stat.isDirectory()) {
      fail("MH_WORK_OPERATION_PARENT", `worker operation parent is not a directory: ${relativePath}`);
    }
  }

  let existing = null;
  if (fs.existsSync(target)) {
    const stat = fs.lstatSync(target);
    if (stat.isSymbolicLink() || !stat.isFile()) {
      fail("MH_WORK_OPERATION_TARGET", `worker operation target must be a regular non-symlink file: ${relativePath}`);
    }
    existing = {
      bytes: fs.readFileSync(target),
      mode: stat.mode,
    };
  }
  return { root, target, existing };
}

function reservePath(seen, relativePath) {
  const key = pathKey(relativePath);
  if (seen.has(key)) {
    fail("MH_WORK_OPERATIONS", `worker operations touch the same path more than once: ${relativePath}`);
  }
  seen.add(key);
}

function validateWorkerOperations(workspacePath, operations, allowedPaths, protectedPaths = []) {
  if (!Array.isArray(operations) || operations.length > MAX_OPERATION_COUNT) {
    fail("MH_WORK_OPERATIONS", `worker operations must contain at most ${MAX_OPERATION_COUNT} entries`);
  }
  const seen = new Set();
  let totalBytes = 0;

  const validated = operations.map((operation, index) => {
    if (!operation || typeof operation !== "object" || Array.isArray(operation)) {
      fail("MH_WORK_OPERATIONS", `worker operation ${index} has an invalid shape`);
    }

    if (operation.type === "WRITE") {
      if (Object.keys(operation).sort().join("\0") !== "content\0path\0type"
          || typeof operation.content !== "string") {
        fail("MH_WORK_OPERATIONS", `WRITE operation ${index} has an invalid shape`);
      }
      const relativePath = normalizeMutationPath(operation.path);
      assertMutablePath(relativePath, allowedPaths, protectedPaths);
      reservePath(seen, relativePath);
      const bytes = Buffer.byteLength(operation.content, "utf8");
      if (bytes > MAX_FILE_BYTES) {
        fail("MH_WORK_OPERATION_SIZE", `WRITE exceeds ${MAX_FILE_BYTES} bytes: ${relativePath}`);
      }
      totalBytes += bytes;
      if (totalBytes > MAX_TOTAL_BYTES) {
        fail("MH_WORK_OPERATION_SIZE", `WRITE operations exceed ${MAX_TOTAL_BYTES} total bytes`);
      }
      return {
        type: "WRITE",
        path: relativePath,
        content: operation.content,
        bytes,
        targetInfo: inspectTarget(workspacePath, relativePath),
      };
    }

    if (operation.type === "DELETE") {
      if (Object.keys(operation).sort().join("\0") !== "path\0type") {
        fail("MH_WORK_OPERATIONS", `DELETE operation ${index} has an invalid shape`);
      }
      const relativePath = normalizeMutationPath(operation.path);
      assertMutablePath(relativePath, allowedPaths, protectedPaths);
      reservePath(seen, relativePath);
      const targetInfo = inspectTarget(workspacePath, relativePath);
      if (!targetInfo.existing) {
        fail("MH_WORK_OPERATION_MISSING", `DELETE source does not exist: ${relativePath}`);
      }
      return { type: "DELETE", path: relativePath, targetInfo };
    }

    if (operation.type === "MOVE") {
      if (Object.keys(operation).sort().join("\0") !== "from\0to\0type") {
        fail("MH_WORK_OPERATIONS", `MOVE operation ${index} has an invalid shape`);
      }
      const from = normalizeMutationPath(operation.from);
      const to = normalizeMutationPath(operation.to);
      assertMutablePath(from, allowedPaths, protectedPaths);
      assertMutablePath(to, allowedPaths, protectedPaths);
      if (pathKey(from) === pathKey(to)) {
        fail("MH_WORK_OPERATION_MOVE", "MOVE source and target must be distinct paths");
      }
      reservePath(seen, from);
      reservePath(seen, to);
      const sourceInfo = inspectTarget(workspacePath, from);
      const targetInfo = inspectTarget(workspacePath, to);
      if (!sourceInfo.existing) {
        fail("MH_WORK_OPERATION_MISSING", `MOVE source does not exist: ${from}`);
      }
      if (targetInfo.existing) {
        fail("MH_WORK_OPERATION_EXISTS", `MOVE target already exists: ${to}`);
      }
      return { type: "MOVE", from, to, sourceInfo, targetInfo };
    }

    fail("MH_WORK_OPERATIONS", `worker operation ${index} has unsupported type: ${operation.type}`);
  });

  const exactAllowed = exactAllowedPathKeys(allowedPaths);
  const newWrites = validated.filter((operation) => operation.type === "WRITE" && !operation.targetInfo.existing);
  const broadNewWrites = newWrites.filter((operation) => !exactAllowed.has(pathKey(operation.path)));
  if (broadNewWrites.length > DEFAULT_NEW_FILE_LIMIT) {
    fail(
      "MH_WORK_ARTIFACT_POLICY",
      `broad worker scope may create at most ${DEFAULT_NEW_FILE_LIMIT} new files; explicitly scope additional exact paths`,
      { paths: broadNewWrites.map((operation) => operation.path) },
    );
  }

  for (const operation of newWrites) {
    if (isSlopProneNewPath(operation.path) && !exactAllowed.has(pathKey(operation.path))) {
      fail(
        "MH_WORK_ARTIFACT_POLICY",
        `new versioned, dated, or meta-process artifact requires an exact allowed path: ${operation.path}`,
      );
    }
  }
  for (const operation of validated) {
    if (operation.type === "MOVE"
        && isSlopProneNewPath(operation.to)
        && !exactAllowed.has(pathKey(operation.to))) {
      fail(
        "MH_WORK_ARTIFACT_POLICY",
        `move to versioned, dated, or meta-process artifact requires an exact allowed path: ${operation.to}`,
      );
    }
  }

  return validated;
}

function operationSnapshots(validated) {
  const snapshots = new Map();
  function remember(relativePath, info) {
    if (snapshots.has(relativePath)) return;
    snapshots.set(relativePath, info.existing
      ? { target: info.target, bytes: info.existing.bytes, mode: info.existing.mode }
      : { target: info.target, bytes: null, mode: null });
  }
  for (const operation of validated) {
    if (operation.type === "WRITE" || operation.type === "DELETE") {
      remember(operation.path, operation.targetInfo);
    } else {
      remember(operation.from, operation.sourceInfo);
      remember(operation.to, operation.targetInfo);
    }
  }
  return snapshots;
}

function rollback(snapshots) {
  const entries = [...snapshots.values()];
  for (const snapshot of entries) {
    try {
      if (fs.existsSync(snapshot.target)) {
        const stat = fs.lstatSync(snapshot.target);
        if (stat.isFile() && !stat.isSymbolicLink()) fs.unlinkSync(snapshot.target);
      }
    } catch (_) {}
  }
  for (const snapshot of entries) {
    if (snapshot.bytes === null) continue;
    try {
      fs.mkdirSync(path.dirname(snapshot.target), { recursive: true });
      fs.writeFileSync(snapshot.target, snapshot.bytes);
      fs.chmodSync(snapshot.target, snapshot.mode);
    } catch (_) {
      // Preserve the original materialization error; rollback is best effort.
    }
  }
}

function materializeWorkerOperations(workspacePath, operations, allowedPaths) {
  const validated = validateWorkerOperations(workspacePath, operations, allowedPaths);
  const snapshots = operationSnapshots(validated);
  try {
    for (const operation of validated) {
      if (operation.type === "WRITE") {
        fs.mkdirSync(path.dirname(operation.targetInfo.target), { recursive: true });
        fs.writeFileSync(operation.targetInfo.target, operation.content, "utf8");
      } else if (operation.type === "DELETE") {
        fs.unlinkSync(operation.targetInfo.target);
      } else {
        fs.mkdirSync(path.dirname(operation.targetInfo.target), { recursive: true });
        fs.renameSync(operation.sourceInfo.target, operation.targetInfo.target);
      }
    }
  } catch (error) {
    rollback(snapshots);
    fail("MH_WORK_MATERIALIZE", `worker operations could not be materialized: ${error.message}`);
  }

  return [...snapshots.keys()].sort();
}

module.exports = {
  DEFAULT_NEW_FILE_LIMIT,
  MAX_FILE_BYTES,
  MAX_OPERATION_COUNT,
  MAX_TOTAL_BYTES,
  materializeWorkerOperations,
  normalizeMutationPath,
  validateWorkerOperations,
};
