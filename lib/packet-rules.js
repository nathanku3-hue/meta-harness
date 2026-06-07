"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { UsageError } = require("./errors");
const { ensureDir } = require("./paths");

const MAX_PACKET_FILE_BYTES = 2_000_000;
const FORBIDDEN_PATH_PARTS = new Set([
  ".git",
  ".mypy_cache",
  ".pytest_cache",
  ".ruff_cache",
  ".venv",
  "__pycache__",
  "node_modules",
  "provider-config",
  "provider_config",
  "runtime",
  "user-worktree",
  "user_worktree",
  "wrds",
]);
const FORBIDDEN_BASENAMES = new Set([
  ".env",
  "secret.txt",
  "secrets.txt",
]);
const RAW_CHAT_MARKERS = new Set([
  "chats",
  "docs-chats",
  "docs_chats",
  "raw-chat-log",
  "raw_chat_log",
  "chat-log",
  "chat_log",
  "chat-logs",
  "chat_logs",
  "conversation-log",
  "conversation_log",
  "transcript",
  "transcripts",
]);

function fail(message) {
  throw new UsageError(message);
}

function slashPath(value) {
  return String(value).split(path.sep).join("/");
}

function relativePath(cwd, targetPath) {
  return slashPath(path.relative(cwd, targetPath));
}

function pathParts(cwd, targetPath) {
  const resolved = path.isAbsolute(targetPath) ? targetPath : path.resolve(cwd, targetPath);
  return relativePath(cwd, resolved)
    .toLowerCase()
    .split("/")
    .filter(Boolean);
}

function isInsidePath(targetPath, rootPath) {
  const relative = path.relative(rootPath, targetPath);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function nearestExistingParent(targetPath) {
  let current = targetPath;
  while (!fs.existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) {
      return undefined;
    }
    current = parent;
  }
  return current;
}

function resolveInsideRepo(cwd, rawPath, label, options = {}) {
  const { mustExist = true } = options;
  if (typeof rawPath !== "string" || rawPath.trim().length === 0) {
    fail(`${label} must be a non-empty path`);
  }
  const repoRoot = fs.realpathSync(cwd);
  const resolved = path.resolve(cwd, rawPath);
  if (!isInsidePath(resolved, path.resolve(cwd))) {
    fail(`${label} must stay inside the current repository: ${rawPath}`);
  }
  if (fs.existsSync(resolved)) {
    const realCandidate = fs.realpathSync(resolved);
    if (!isInsidePath(realCandidate, repoRoot)) {
      fail(`${label} must stay inside the current repository: ${rawPath}`);
    }
  } else {
    if (mustExist) {
      fail(`${label} does not exist: ${rawPath}`);
    }
    const parent = nearestExistingParent(path.dirname(resolved));
    if (parent) {
      const realParent = fs.realpathSync(parent);
      if (!isInsidePath(realParent, repoRoot)) {
        fail(`${label} must stay inside the current repository: ${rawPath}`);
      }
    }
  }
  return resolved;
}

function isRawChatPath(cwd, targetPath) {
  const parts = pathParts(cwd, targetPath);
  const relative = parts.join("/");
  if (relative.includes("docs/chats/") || relative === "docs/chats") {
    return true;
  }
  if (parts.some((part) => RAW_CHAT_MARKERS.has(part))) {
    return true;
  }
  const basename = parts[parts.length - 1] || "";
  return [...RAW_CHAT_MARKERS].some((marker) => (
    basename === marker
    || basename.startsWith(`${marker}.`)
    || basename.startsWith(`${marker}-`)
    || basename.startsWith(`${marker}_`)
  ));
}

function isForbiddenPacketPath(cwd, targetPath) {
  const parts = pathParts(cwd, targetPath);
  if (parts.some((part) => FORBIDDEN_PATH_PARTS.has(part))) {
    return true;
  }
  const basename = parts[parts.length - 1] || "";
  return FORBIDDEN_BASENAMES.has(basename);
}

function validatePacketPath(cwd, rawPath, label, options = {}) {
  const resolved = resolveInsideRepo(cwd, rawPath, label, options);
  if (isForbiddenPacketPath(cwd, resolved)) {
    fail(`refusing forbidden ${label}: ${relativePath(cwd, resolved)}`);
  }
  return {
    absolutePath: resolved,
    relativePath: relativePath(cwd, resolved),
  };
}

function validateOwnedPath(cwd, rawPath) {
  const result = validatePacketPath(cwd, rawPath, "owned path", { mustExist: false });
  if (isRawChatPath(cwd, result.absolutePath)) {
    fail(`refusing raw chat owned path: ${result.relativePath}`);
  }
  return result.relativePath;
}

function isExpertReportPath(cwd, targetPath) {
  const parts = pathParts(cwd, targetPath);
  const basename = parts[parts.length - 1] || "";
  return /(^|[-_])expert[-_]?report($|[-_.])/.test(basename)
    || /(^|[-_])expert[-_]?review($|[-_.])/.test(basename)
    || /(^|[-_])reviewer[-_]?report($|[-_.])/.test(basename);
}

function canPrependStaleHeader(targetPath) {
  return new Set([".md", ".txt"]).has(path.extname(targetPath).toLowerCase());
}

function staleExpertReportHeader() {
  return [
    "# STALE EXPERT REPORT",
    "",
    "This report predates current harness truth. Treat it as historical evidence only; reconcile against the front card, status, decision inbox, and dirty evidence before use.",
    "",
  ].join("\n");
}

function classifyStaleExpertReport(cwd, targetPath, referenceMtimeMs) {
  if (!referenceMtimeMs || !isExpertReportPath(cwd, targetPath) || !fs.existsSync(targetPath)) {
    return { stale: false, headerAllowed: false };
  }
  const stale = fs.statSync(targetPath).mtimeMs < referenceMtimeMs;
  return {
    stale,
    headerAllowed: stale && canPrependStaleHeader(targetPath),
  };
}

function staleStatusLine(cwd, targetPath, stale) {
  if (!stale.stale) {
    return undefined;
  }
  const mode = stale.headerAllowed ? "stale header prepended" : "manifest/front-card warning only";
  return `${relativePath(cwd, targetPath)} (${mode})`;
}

function copyFileWithPacketRules(cwd, sourcePath, destinationPath, options = {}) {
  const { referenceMtimeMs, failOnSkip = false } = options;
  const source = validatePacketPath(cwd, sourcePath, "packet source").absolutePath;
  const repoRelative = relativePath(cwd, source);
  if (isRawChatPath(cwd, source)) {
    const skipped = `${repoRelative} (raw chat log excluded)`;
    if (failOnSkip) {
      fail(`refusing raw chat packet source: ${repoRelative}`);
    }
    return { copied: false, skipped, repoRelative };
  }
  const stats = fs.statSync(source);
  if (!stats.isFile()) {
    fail(`packet source is not a file: ${repoRelative}`);
  }
  if (stats.size > MAX_PACKET_FILE_BYTES) {
    fail(`packet source exceeds ${MAX_PACKET_FILE_BYTES} bytes: ${repoRelative}`);
  }
  ensureDir(path.dirname(destinationPath));
  const stale = classifyStaleExpertReport(cwd, source, referenceMtimeMs);
  if (stale.headerAllowed) {
    fs.writeFileSync(destinationPath, `${staleExpertReportHeader()}${fs.readFileSync(source, "utf8")}`, "utf8");
  } else {
    fs.copyFileSync(source, destinationPath);
  }
  return {
    copied: true,
    repoRelative,
    stale: staleStatusLine(cwd, source, stale),
  };
}

function skippedDirectoryFiles(cwd, sourceDir, reason, skipped = []) {
  const entries = fs.readdirSync(sourceDir, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    const source = path.join(sourceDir, entry.name);
    if (entry.isDirectory()) {
      skippedDirectoryFiles(cwd, source, reason, skipped);
    } else if (entry.isFile()) {
      skipped.push(`${relativePath(cwd, source)} (${reason})`);
    }
  }
  return skipped;
}

function copyDirectoryWithPacketRules(cwd, sourceDir, destinationDir, options = {}) {
  const copied = [];
  const skipped = [];
  const staleEntries = [];
  const entries = fs.readdirSync(sourceDir, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name));

  for (const entry of entries) {
    const source = path.join(sourceDir, entry.name);
    const repoRelative = relativePath(cwd, source);
    if (isForbiddenPacketPath(cwd, source)) {
      skipped.push(`${repoRelative} (forbidden path excluded)`);
      continue;
    }
    if (isRawChatPath(cwd, source)) {
      if (entry.isDirectory()) {
        skippedDirectoryFiles(cwd, source, "raw chat log excluded", skipped);
      } else {
        skipped.push(`${repoRelative} (raw chat log excluded)`);
      }
      continue;
    }
    const destination = path.join(destinationDir, entry.name);
    if (entry.isDirectory()) {
      const result = copyDirectoryWithPacketRules(cwd, source, destination, options);
      copied.push(...result.copied);
      skipped.push(...result.skipped);
      staleEntries.push(...result.staleEntries);
    } else if (entry.isFile()) {
      const stats = fs.statSync(source);
      if (stats.size > MAX_PACKET_FILE_BYTES) {
        skipped.push(`${repoRelative} (file exceeds packet size cap)`);
        continue;
      }
      const result = copyFileWithPacketRules(cwd, source, destination, options);
      if (result.copied) {
        copied.push(result.repoRelative);
      } else {
        skipped.push(result.skipped);
      }
      if (result.stale) {
        staleEntries.push(result.stale);
      }
    }
  }
  return { copied, skipped, staleEntries };
}

module.exports = {
  canPrependStaleHeader,
  classifyStaleExpertReport,
  copyDirectoryWithPacketRules,
  copyFileWithPacketRules,
  isForbiddenPacketPath,
  isInsidePath,
  isRawChatPath,
  relativePath,
  resolveInsideRepo,
  staleExpertReportHeader,
  validateOwnedPath,
  validatePacketPath,
};
