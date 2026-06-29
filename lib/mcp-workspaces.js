"use strict";

const path = require("node:path");

function normalizeRoot(root) {
  return path.resolve(root || ".");
}

function isInsideRoot(root, targetPath) {
  const normalizedRoot = normalizeRoot(root);
  const normalizedTarget = path.resolve(targetPath);
  const relative = path.relative(normalizedRoot, normalizedTarget);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function resolveWorkspacePath(root, requestedPath) {
  if (!requestedPath || requestedPath === true) {
    throw new Error("Path is required.");
  }
  const normalizedRoot = normalizeRoot(root);
  const targetPath = path.resolve(normalizedRoot, String(requestedPath));
  if (!isInsideRoot(normalizedRoot, targetPath)) {
    throw new Error(`Path is outside workspace root: ${requestedPath}`);
  }
  return targetPath;
}

function readWorkspaceFile(root, requestedPath, fsApi) {
  const filePath = resolveWorkspacePath(root, requestedPath);
  const stat = fsApi.lstatSync(filePath);
  if (!stat.isFile()) {
    throw new Error(`Path is not a regular file: ${requestedPath}`);
  }
  return {
    path: String(requestedPath).split(path.sep).join("/"),
    absolutePath: filePath,
    content: fsApi.readFileSync(filePath, "utf8"),
  };
}

function readWorkspaceFiles(root, requestedPaths, fsApi) {
  return requestedPaths.map((requestedPath) => readWorkspaceFile(root, requestedPath, fsApi));
}

function localMcpConfigPath(root) {
  return path.join(normalizeRoot(root), ".meta-harness", "local", "mcp", "config.json");
}

module.exports = {
  isInsideRoot,
  localMcpConfigPath,
  normalizeRoot,
  readWorkspaceFile,
  readWorkspaceFiles,
  resolveWorkspacePath,
};
