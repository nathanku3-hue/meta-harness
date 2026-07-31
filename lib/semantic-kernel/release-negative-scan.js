"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const { contractError, immutable } = require("./contract-utils");

const RETIRED_TOKENS = Object.freeze([
  "run-spec/v1",
  "run-spec-approval/v1",
  "attempt-authorization/v1",
  "implementation-assessment/v1",
  "execution-custody-manifest/v1",
  "meta-harness-execution-request/v1",
  "meta-harness-execution-receipt/v1",
  "meta-harness-execute-result/v1",
  "meta-harness-truth-authority-public/v1",
  "meta-harness-truth-authority-receipt/v1",
  "meta-harness-truth-authority-receipt/v2",
  "meta-harness-truth-proposal/v1",
  "truth-authority-public-key/v1",
  "canonical_truth_mutation",
  "allowLegacy",
  "allowLegacyAuthority",
  "IMPLEMENTATION_VERIFIED",
]);

const FORBIDDEN_PACKAGE_PATHS = Object.freeze([
  "package/internal/owner-tool/cli.js",
  "package/internal/owner-tool/owner-tool.js",
  "package/lib/contracts/attempt-authorization.js",
  "package/lib/contracts/authorize.js",
  "package/lib/contracts/implementation-assessment.js",
  "package/lib/contracts/run-spec-approval.js",
  "package/lib/execution-custody/attempt.js",
  "package/lib/execution-custody/custody-replay.js",
  "package/lib/execution-custody/implement.js",
  "package/lib/execution-custody/portable-verifier.js",
  "package/lib/execution-custody/terminal-evidence.js",
  "package/lib/truth-authority-contract.js",
  "package/lib/truth-authority.js",
  "package/lib/truth-mutation.js",
]);

const TOKEN_ALLOWLIST = Object.freeze(new Map([
  ["package/lib/semantic-kernel/legacy-cutoff.js", new Set(RETIRED_TOKENS)],
  ["package/lib/semantic-kernel/release-negative-scan.js", new Set(RETIRED_TOKENS)],
  ["package/lib/release-package-check.js", new Set(RETIRED_TOKENS)],
]));

const TEXT_EXTENSIONS = Object.freeze(new Set([
  ".js",
  ".json",
  ".md",
  ".mjs",
  ".cjs",
  ".txt",
  "",
]));

function normalizeTarPath(value) {
  return String(value).replaceAll("\\", "/").replace(/^\.\//, "");
}

function isTextPath(relativePath) {
  const extension = path.posix.extname(relativePath).toLowerCase();
  return TEXT_EXTENSIONS.has(extension);
}

function tokenAllowed(relativePath, token) {
  return TOKEN_ALLOWLIST.get(relativePath)?.has(token) === true;
}

function scanText(relativePath, text) {
  const issues = [];
  for (const token of RETIRED_TOKENS) {
    if (text.includes(token) && !tokenAllowed(relativePath, token)) {
      issues.push({
        code: "RETIRED_TOKEN_PRESENT",
        path: relativePath,
        token,
      });
    }
  }
  if (relativePath.endsWith(".js")) {
    for (const pattern of [
      /["']VERIFIED["']/g,
      /npm\s+pack/g,
      /\[\s*["']pack["']/g,
    ]) {
      if (pattern.test(text) && relativePath !== "package/lib/semantic-kernel/release-verification.js") {
        issues.push({
          code: pattern.source.includes("VERIFIED") ? "PRODUCT_SOUNDING_MECHANICS_VERDICT" : "PACKAGE_REBUILD_PATH_PRESENT",
          path: relativePath,
          token: pattern.source,
        });
      }
    }
  }
  return issues;
}

function defaultTarRunner(command, args) {
  return spawnSync(command, args, {
    encoding: "utf8",
    windowsHide: true,
    timeout: 60000,
  });
}

function runTar(args, runner = defaultTarRunner) {
  const result = runner("tar", args, { timeout: 60000 });
  if (result.error || result.status !== 0) {
    throw contractError(
      "RELEASE_NEGATIVE_SCAN_TAR",
      `tar ${args.join(" ")} failed: ${String(result.stderr || result.error?.message || "unknown error").trim()}`,
    );
  }
  return String(result.stdout || "");
}

function scanTarballForRetiredSurface(tarballPath, runner = defaultTarRunner) {
  const entries = runTar(["-tf", tarballPath], runner)
    .split(/\r?\n/)
    .filter(Boolean)
    .map(normalizeTarPath)
    .sort();
  const entrySet = new Set(entries);
  const issues = [];
  for (const forbiddenPath of FORBIDDEN_PACKAGE_PATHS) {
    if (entrySet.has(forbiddenPath)) {
      issues.push({ code: "RETIRED_PACKAGE_PATH_PRESENT", path: forbiddenPath, token: forbiddenPath });
    }
  }
  for (const relativePath of entries) {
    if (!relativePath.startsWith("package/") || relativePath.endsWith("/") || !isTextPath(relativePath)) continue;
    const text = runTar(["-xOf", tarballPath, relativePath], runner);
    issues.push(...scanText(relativePath, text));
  }
  if (issues.length > 0) {
    throw contractError(
      "RELEASE_RETIRED_SURFACE",
      "release tarball contains retired authority, verdict, signer, or rebuild surface",
      { issues },
    );
  }
  return immutable({
    ok: true,
    scannedEntryCount: entries.length,
    retiredTokenCount: RETIRED_TOKENS.length,
    forbiddenPathCount: FORBIDDEN_PACKAGE_PATHS.length,
    issues: [],
  });
}

module.exports = {
  FORBIDDEN_PACKAGE_PATHS,
  RETIRED_TOKENS,
  TOKEN_ALLOWLIST,
  defaultTarRunner,
  scanTarballForRetiredSurface,
  scanText,
};
