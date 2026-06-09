"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { UsageError } = require("./errors");

const SEVERITY_ORDER = Object.freeze({ block: 0, warn: 1, info: 2 });
const VALID_SEVERITIES = new Set(Object.keys(SEVERITY_ORDER));

function fail(message) {
  throw new UsageError(message);
}

function normalizeRepoPath(value, fieldName = "path") {
  if (typeof value !== "string") {
    fail(`${fieldName} must be a string`);
  }

  const normalized = value.trim().replaceAll("\\", "/");
  if (normalized.length === 0) {
    return "";
  }
  if (normalized.includes("\0")) {
    fail(`${fieldName} must not contain NUL bytes`);
  }
  if (path.isAbsolute(normalized) || /^[A-Za-z]:\//.test(normalized)) {
    fail(`${fieldName} must be repository-relative`);
  }
  if (normalized.split("/").includes("..")) {
    fail(`${fieldName} must not traverse outside the repository`);
  }
  return normalized.replace(/^\.\//, "");
}

function normalizeFinding(finding, role) {
  if (!finding || typeof finding !== "object") {
    fail("scout finding must be an object");
  }

  const severity = typeof finding.severity === "string" ? finding.severity.trim() : "";
  if (!VALID_SEVERITIES.has(severity)) {
    fail(`invalid scout finding severity: ${severity || "<missing>"}`);
  }

  const issue = typeof finding.issue === "string" ? finding.issue.trim() : "";
  if (issue.length === 0) {
    fail("scout finding issue is required");
  }

  return {
    role,
    path: normalizeRepoPath(finding.path || ""),
    issue,
    severity,
    check_ids_referenced: Array.isArray(finding.check_ids_referenced)
      ? finding.check_ids_referenced.filter((item) => typeof item === "string" && item.trim()).map((item) => item.trim())
      : [],
  };
}

function validateAgainstRepo(targetRoot, finding) {
  if (!finding.path) {
    return { status: "global", exists: null };
  }

  const fullPath = path.join(targetRoot, finding.path);
  const relativeFromRoot = path.relative(targetRoot, fullPath);
  if (relativeFromRoot.startsWith("..") || path.isAbsolute(relativeFromRoot)) {
    fail("finding path escaped target root during validation");
  }

  return fs.existsSync(fullPath)
    ? { status: "validated", exists: true }
    : { status: "unverified-missing-path", exists: false };
}

function findingKey(finding) {
  return [finding.path, finding.issue, finding.severity].join("\0");
}

function reconcileScoutOutputs(outputs, options = {}) {
  const { targetRoot } = options;
  if (!targetRoot) {
    fail("scout reconciler requires targetRoot");
  }
  if (!Array.isArray(outputs)) {
    fail("scout outputs must be an array");
  }

  const normalizedTargetRoot = path.resolve(targetRoot);
  const byKey = new Map();
  let rawFindingCount = 0;

  for (const output of outputs) {
    if (!output || typeof output !== "object") {
      fail("scout output must be an object");
    }
    const role = typeof output.role === "string" && output.role.trim() ? output.role.trim() : "unknown-scout";
    if (!Array.isArray(output.findings)) {
      fail(`scout output for ${role} must contain findings array`);
    }

    for (const finding of output.findings) {
      rawFindingCount += 1;
      const normalized = normalizeFinding(finding, role);
      const validation = validateAgainstRepo(normalizedTargetRoot, normalized);
      const key = findingKey(normalized);
      const existing = byKey.get(key);
      if (existing) {
        existing.roles = [...new Set([...existing.roles, role])].sort();
        existing.duplicate_count += 1;
        continue;
      }
      byKey.set(key, {
        ...normalized,
        roles: [role],
        duplicate_count: 1,
        validation_status: validation.status,
        path_exists: validation.exists,
        authority: "evidence-only",
      });
    }
  }

  const findings = [...byKey.values()].sort((left, right) => {
    const severityDiff = SEVERITY_ORDER[left.severity] - SEVERITY_ORDER[right.severity];
    if (severityDiff !== 0) {
      return severityDiff;
    }
    return `${left.path}\0${left.issue}`.localeCompare(`${right.path}\0${right.issue}`);
  });

  const severityCounts = findings.reduce(
    (counts, finding) => {
      counts[finding.severity] += 1;
      return counts;
    },
    { block: 0, warn: 0, info: 0 },
  );

  return {
    schema_version: "1.0.0",
    authority: "reconciler-only",
    decision: "none",
    evidence_only: true,
    scout_count: outputs.length,
    raw_finding_count: rawFindingCount,
    deduped_finding_count: findings.length,
    severity_counts: severityCounts,
    findings,
    summary: `${findings.length} deduped findings from ${outputs.length} read-only scouts`,
  };
}

module.exports = {
  reconcileScoutOutputs,
  normalizeRepoPath,
};
