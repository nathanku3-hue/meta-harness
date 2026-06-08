"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { checkStateLayout, checkTemplateSync } = require("./sync-check");
const {
  analyzeQuality,
  compareQualityToBaseline,
  readQualityBaseline,
  readQualityContract,
} = require("./quality");

const FINDING_ORDER = [
  "ADOPT_SYNC_MISSING_TEMPLATES",
  "ADOPT_STATE_MISSING_STATUS",
  "ADOPT_STATE_MISSING_EVENTS",
  "ADOPT_STATE_OLD_RUNS",
  "ADOPT_SECURITY_MISSING_GITATTRIBUTES",
  "ADOPT_SECURITY_MISSING_SECURITY_MD",
  "ADOPT_SECURITY_MISSING_CODEOWNERS",
  "ADOPT_SECURITY_MISSING_DEPENDABOT",
  "ADOPT_QUALITY_BLOCK",
  "ADOPT_PACKAGE_FORBIDDEN_PATH",
  "ADOPT_GITIGNORE_WEAK_SECRET_PATTERNS",
];

const SECRET_GITIGNORE_PATTERNS = [
  ".env",
  ".env.*",
  "*.pem",
  "*.key",
  "credentials.json",
  "secrets.json",
];

const PACKAGE_FORBIDDEN_PREFIXES = [
  ".agents/",
  ".meta-harness/",
  "provider-config/",
  "runtime/",
  "data/",
  "data-output/",
  "demo/",
  "node_modules/",
];

const DENIED_READ_PREFIXES = [
  ".git/",
  "node_modules/",
  "dist/",
  "coverage/",
  ".env",
  ".env.",
  "provider-config/",
  "runtime/",
  "data/",
  "data-output/",
  ".meta-harness/local/",
  ".meta-harness/snapshots/",
  ".meta-harness/expert-packets/",
  ".meta-harness/workers/",
];

const DENIED_READ_SUBSTRINGS = ["secrets", "credentials"];
const DENIED_READ_EXTENSIONS = [".pem", ".key", ".p12", ".pfx", ".zip", ".tgz", ".tar", ".gz"];

function toSlash(value) {
  return value.split(path.sep).join("/");
}

function normalizeRelative(relativePath) {
  return toSlash(path.normalize(relativePath)).replace(/^(\.\.\/)+/, "");
}

function resolveInside(root, relativePath) {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, ...relativePath.split("/"));
  const relative = path.relative(resolvedRoot, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`path escapes target root: ${relativePath}`);
  }
  return resolved;
}

function deniedReadPath(relativePath) {
  const normalized = normalizeRelative(relativePath).toLowerCase();
  if (DENIED_READ_PREFIXES.some((prefix) => normalized === prefix.slice(0, -1) || normalized.startsWith(prefix))) {
    return true;
  }
  if (DENIED_READ_SUBSTRINGS.some((part) => normalized.includes(part))) {
    return true;
  }
  return DENIED_READ_EXTENSIONS.some((extension) => normalized.endsWith(extension));
}

function safeExists(root, relativePath) {
  const fullPath = resolveInside(root, relativePath);
  try {
    return fs.lstatSync(fullPath).isFile();
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

function safeDirectoryExists(root, relativePath) {
  const fullPath = resolveInside(root, relativePath);
  try {
    const stat = fs.lstatSync(fullPath);
    return stat.isDirectory() && !stat.isSymbolicLink();
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

function safeReadText(root, relativePath) {
  if (deniedReadPath(relativePath)) {
    throw new Error(`refusing to read forbidden path: ${relativePath}`);
  }
  return fs.readFileSync(resolveInside(root, relativePath), "utf8");
}

function finding(id, issue, severity, fix, phaseReference, evidence = undefined) {
  return {
    id,
    issue,
    severity,
    fix,
    phase_reference: phaseReference,
    ...(evidence ? { evidence } : {}),
  };
}

function addSyncFindings(findings, sourceRoot, targetRoot) {
  const sync = checkTemplateSync({ sourceRoot, targetRoot });
  if (sync.status !== "PASS") {
    findings.push(finding(
      "ADOPT_SYNC_MISSING_TEMPLATES",
      "installed Meta-Harness templates are missing or drifted",
      "block",
      "run `meta-harness templates install --allow-dirty`, then `meta-harness sync check --target .`",
      "Phase 2",
      `${sync.items.filter((item) => item.status !== "PASS").length} template sync finding(s)`,
    ));
  }
}

function addStateFindings(findings, targetRoot) {
  const state = checkStateLayout({ targetRoot });
  for (const item of state.items) {
    if (item.path === ".meta-harness/status.md") {
      findings.push(finding("ADOPT_STATE_MISSING_STATUS", item.detail, "block", "create .meta-harness/status.md", "Phase 2"));
    }
    if (item.path === ".meta-harness/events.jsonl") {
      findings.push(finding("ADOPT_STATE_MISSING_EVENTS", item.detail, "block", "create .meta-harness/events.jsonl", "Phase 2"));
    }
    if (item.path === ".meta-harness/runs") {
      findings.push(finding("ADOPT_STATE_OLD_RUNS", item.detail, "block", "migrate or archive .meta-harness/runs", "Phase 1"));
    }
  }
}

function addSecurityFindings(findings, targetRoot) {
  if (!safeExists(targetRoot, ".gitattributes")) {
    findings.push(finding("ADOPT_SECURITY_MISSING_GITATTRIBUTES", "missing .gitattributes", "warn", "add .gitattributes line-ending baseline", "Phase 1"));
  }
  if (!safeExists(targetRoot, "SECURITY.md")) {
    findings.push(finding("ADOPT_SECURITY_MISSING_SECURITY_MD", "missing SECURITY.md", "warn", "add SECURITY.md vulnerability policy", "Phase 5"));
  }
  if (!safeExists(targetRoot, ".github/CODEOWNERS") && !safeExists(targetRoot, "CODEOWNERS")) {
    findings.push(finding("ADOPT_SECURITY_MISSING_CODEOWNERS", "missing CODEOWNERS", "warn", "add .github/CODEOWNERS", "Phase 5"));
  }
  if (!safeExists(targetRoot, ".github/dependabot.yml") && !safeExists(targetRoot, ".github/dependabot.yaml")) {
    findings.push(finding("ADOPT_SECURITY_MISSING_DEPENDABOT", "missing Dependabot config", "warn", "add .github/dependabot.yml", "Phase 5"));
  }
}

function addGitignoreFinding(findings, targetRoot) {
  const text = safeExists(targetRoot, ".gitignore") ? safeReadText(targetRoot, ".gitignore") : "";
  const missing = SECRET_GITIGNORE_PATTERNS.filter((pattern) => !text.split(/\r?\n/).includes(pattern));
  if (missing.length > 0) {
    findings.push(finding(
      "ADOPT_GITIGNORE_WEAK_SECRET_PATTERNS",
      "weak .gitignore secret-pattern baseline",
      "warn",
      `add missing patterns: ${missing.join(", ")}`,
      "Phase 1",
    ));
  }
}

function addPackageFinding(findings, targetRoot) {
  if (!safeExists(targetRoot, "package.json")) {
    return;
  }
  const parsed = JSON.parse(safeReadText(targetRoot, "package.json"));
  const files = Array.isArray(parsed.files) ? parsed.files.map(String) : [];
  const forbidden = files.filter((entry) => {
    const normalized = normalizeRelative(entry).replace(/\/?$/, "/");
    return PACKAGE_FORBIDDEN_PREFIXES.some((prefix) => normalized.startsWith(prefix));
  });
  if (forbidden.length > 0) {
    findings.push(finding(
      "ADOPT_PACKAGE_FORBIDDEN_PATH",
      "package files include local/runtime/control-plane paths",
      "block",
      `remove forbidden package entries: ${forbidden.join(", ")}`,
      "Phase 10",
    ));
  }
}

function hasDeniedQualityRoots(targetRoot) {
  return [
    "provider-config",
    "runtime",
    "data",
    "data-output",
    ".meta-harness/local",
    ".meta-harness/snapshots",
    ".meta-harness/expert-packets",
    ".meta-harness/workers",
  ].some((relative) => safeDirectoryExists(targetRoot, relative));
}

function addQualityFinding(findings, targetRoot) {
  if (hasDeniedQualityRoots(targetRoot)) {
    return;
  }
  try {
    const contract = readQualityContract(targetRoot);
    const baseline = readQualityBaseline(targetRoot);
    const result = compareQualityToBaseline(analyzeQuality(targetRoot, contract), baseline, contract, targetRoot);
    if (!result.pass) {
      findings.push(finding(
        "ADOPT_QUALITY_BLOCK",
        "quality gate has blocking findings",
        "block",
        "run `meta-harness quality check` and fix blocking findings",
        "Phase 4",
        result.findings.map((item) => item.kind).join(", "),
      ));
    }
  } catch (_) {
    // Missing quality setup is handled by earlier phases; the doctor reports failures, not every absent optional gate.
  }
}

function sortFindings(findings) {
  return findings.sort((left, right) => FINDING_ORDER.indexOf(left.id) - FINDING_ORDER.indexOf(right.id));
}

function diagnoseRepoAdoption({ sourceRoot, targetRoot }) {
  const resolvedSource = path.resolve(sourceRoot || path.join(__dirname, ".."));
  const resolvedTarget = path.resolve(targetRoot);
  const findings = [];

  addSyncFindings(findings, resolvedSource, resolvedTarget);
  addStateFindings(findings, resolvedTarget);
  addSecurityFindings(findings, resolvedTarget);
  addQualityFinding(findings, resolvedTarget);
  addPackageFinding(findings, resolvedTarget);
  addGitignoreFinding(findings, resolvedTarget);

  return {
    ok: findings.length === 0,
    findings: sortFindings(findings),
  };
}

module.exports = {
  FINDING_ORDER,
  _test: {
    deniedReadPath,
    normalizeRelative,
    safeReadText,
  },
  diagnoseRepoAdoption,
};
