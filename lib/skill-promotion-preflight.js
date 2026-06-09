"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { ConfigError, UsageError } = require("./errors");
const { validateSkillRegistry } = require("./skill-registry");

const SKILL_NAME_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
const PREFLIGHT_EVIDENCE_FIELDS = Object.freeze([
  "eval_evidence",
  "complexity_evidence",
  "rollback_evidence",
]);

function registryRecordPath(value) {
  return String(value || "").replace(/\\/g, "/").replace(/\/+$/, "");
}

function candidateSkillPath(skillName) {
  return `.agents/candidate/${skillName}`;
}

function assertSkillName(skillName) {
  if (!SKILL_NAME_PATTERN.test(skillName || "")) {
    throw new UsageError(`invalid skill name: ${skillName}`);
  }
}

function resolveUnder(root, relativePath) {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, ...String(relativePath).split("/"));
  const relative = path.relative(resolvedRoot, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new ConfigError(`path escapes target root: ${relativePath}`);
  }
  return resolved;
}

function parseFrontMatter(text) {
  const match = text.match(/^---\n([\s\S]*?)\n---\n/);
  if (!match) {
    throw new ConfigError("SKILL.md frontmatter is missing");
  }
  const data = {};
  for (const line of match[1].split(/\r?\n/)) {
    const separator = line.indexOf(":");
    if (separator === -1) {
      continue;
    }
    const key = line.slice(0, separator).trim();
    const rawValue = line.slice(separator + 1).trim();
    if (rawValue.startsWith("[") && rawValue.endsWith("]")) {
      data[key] = rawValue.slice(1, -1).split(",").map((item) => item.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
    } else {
      data[key] = rawValue.replace(/^["']|["']$/g, "");
    }
  }
  return data;
}

function arraysMatch(left, right) {
  return Array.isArray(left) && Array.isArray(right)
    && left.length === right.length
    && left.every((item, index) => item === right[index]);
}

function arrayDiff(left, right) {
  const rightSet = new Set(Array.isArray(right) ? right : []);
  return (Array.isArray(left) ? left : []).filter((item) => !rightSet.has(item));
}

function blocker(id, message) {
  return { id, message };
}

function hasExplicitEvidence(record, field) {
  const value = record?.[field];
  if (typeof value === "string") {
    return value.trim() !== "";
  }
  if (Array.isArray(value)) {
    return value.length > 0;
  }
  if (value && typeof value === "object") {
    return Object.keys(value).length > 0;
  }
  return false;
}

function nonZeroExitCode(value) {
  if (!Object.hasOwn(value, "exit_code")) {
    return false;
  }
  const numeric = Number(value.exit_code);
  return !Number.isFinite(numeric) || numeric !== 0;
}

function failingEvidenceReason(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return "";
  }
  if (value.passed === false) {
    return "passed is false";
  }
  if (value.ok === false) {
    return "ok is false";
  }
  const status = typeof value.status === "string" ? value.status.toLowerCase() : "";
  if (status === "fail" || status === "failed" || status === "blocked") {
    return `status is ${value.status}`;
  }
  if (nonZeroExitCode(value)) {
    return `exit_code is ${value.exit_code}`;
  }
  if (value.available === false) {
    return "available is false";
  }
  return "";
}

function inspectEvidence(record, field, blockers) {
  if (!hasExplicitEvidence(record, field)) {
    blockers.push(blocker("missing-evidence", `${field} is required for promotion preflight`));
    return;
  }
  const reason = failingEvidenceReason(record[field]);
  if (reason) {
    blockers.push(blocker("failing-evidence", `${field} reports failing promotion evidence: ${reason}`));
  }
}

function inspectCandidateFiles(bundleRoot, blockers, prefix = "") {
  let entries;
  try {
    entries = fs.readdirSync(path.join(bundleRoot, ...prefix.split("/").filter(Boolean)), { withFileTypes: true });
  } catch (error) {
    blockers.push(blocker("candidate-shape", `cannot read candidate directory: ${error.message}`));
    return;
  }
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isSymbolicLink()) {
      blockers.push(blocker("candidate-shape", `${relative} must not be a symlink`));
      continue;
    }
    if (entry.isDirectory()) {
      inspectCandidateFiles(bundleRoot, blockers, relative);
      continue;
    }
    if (!entry.isFile()) {
      blockers.push(blocker("candidate-shape", `${relative} must be a regular file`));
    }
  }
}

function readCandidateFrontMatter(targetRoot, record, blockers) {
  const skillMd = path.join(resolveUnder(targetRoot, record.path), "SKILL.md");
  try {
    return parseFrontMatter(fs.readFileSync(skillMd, "utf8"));
  } catch (error) {
    blockers.push(blocker("frontmatter-drift", error.message));
    return null;
  }
}

function inspectCandidateShape(targetRoot, record, blockers) {
  const expectedPath = candidateSkillPath(record.name);
  const normalizedRecordPath = registryRecordPath(record.path);
  if (normalizedRecordPath !== expectedPath) {
    blockers.push(blocker("candidate-shape", `candidate path must be ${expectedPath}`));
    return null;
  }

  const candidateRoot = resolveUnder(targetRoot, record.path);
  const candidateStat = fs.existsSync(candidateRoot) ? fs.lstatSync(candidateRoot) : null;
  if (!candidateStat || candidateStat.isSymbolicLink() || !candidateStat.isDirectory()) {
    blockers.push(blocker("candidate-shape", `${expectedPath} must be a regular directory`));
    return null;
  }

  const skillMd = path.join(candidateRoot, "SKILL.md");
  const skillMdStat = fs.existsSync(skillMd) ? fs.lstatSync(skillMd) : null;
  if (!skillMdStat || skillMdStat.isSymbolicLink() || !skillMdStat.isFile()) {
    blockers.push(blocker("candidate-shape", `${expectedPath}/SKILL.md must be a regular file`));
    return null;
  }

  inspectCandidateFiles(candidateRoot, blockers);
  return candidateRoot;
}

function inspectFrontMatterConsistency(targetRoot, record, blockers) {
  const frontMatter = readCandidateFrontMatter(targetRoot, record, blockers);
  if (!frontMatter) {
    return;
  }

  for (const field of ["name", "owner", "source"]) {
    if (frontMatter[field] !== record[field]) {
      blockers.push(blocker("frontmatter-drift", `${field} does not match SKILL.md frontmatter`));
    }
  }
  if (!arraysMatch(record.allowed_tools, frontMatter.allowed_tools)) {
    blockers.push(blocker("frontmatter-drift", "allowed_tools does not match SKILL.md frontmatter"));
  }
  if (!arraysMatch(record.forbidden_paths, frontMatter.forbidden_paths)) {
    blockers.push(blocker("frontmatter-drift", "forbidden_paths does not match SKILL.md frontmatter"));
  }
}

function permissionDiff(candidate, baseline) {
  if (!baseline) {
    return {
      baseline: null,
      added_allowed_tools: [],
      removed_forbidden_paths: [],
    };
  }
  return {
    baseline: {
      path: baseline.path,
      status: baseline.status,
    },
    added_allowed_tools: arrayDiff(candidate.allowed_tools, baseline.allowed_tools),
    removed_forbidden_paths: arrayDiff(baseline.forbidden_paths, candidate.forbidden_paths),
  };
}

function findBaseline(records, skillName) {
  return records.find((record) => record?.name === skillName && record.status === "active")
    || records.find((record) => record?.name === skillName && record.status === "prototype")
    || null;
}

function preflightSkillPromotion({ targetRoot, skillName }) {
  assertSkillName(skillName);
  const validation = validateSkillRegistry(targetRoot);
  const blockers = validation.errors.map((message) => blocker("registry-invalid", message));
  const registry = validation.registry;
  const records = Array.isArray(registry?.skills) ? registry.skills : [];
  const matchingCandidates = records.filter((record) => record?.name === skillName && record.status === "candidate");
  const candidate = matchingCandidates[0] || null;

  if (matchingCandidates.length === 0) {
    blockers.push(blocker("candidate-missing", `candidate skill not found: ${skillName}`));
  }
  if (matchingCandidates.length > 1) {
    blockers.push(blocker("candidate-duplicate", `multiple candidate records found for ${skillName}`));
  }

  let diff = {
    baseline: null,
    added_allowed_tools: [],
    removed_forbidden_paths: [],
  };

  if (candidate) {
    inspectCandidateShape(targetRoot, candidate, blockers);
    inspectFrontMatterConsistency(targetRoot, candidate, blockers);
    for (const field of PREFLIGHT_EVIDENCE_FIELDS) {
      inspectEvidence(candidate, field, blockers);
    }

    const baseline = findBaseline(records, skillName);
    diff = permissionDiff(candidate, baseline);
    if (!baseline) {
      blockers.push(blocker("baseline-missing", `active/prototype baseline is required for ${skillName}`));
    }
    if (diff.added_allowed_tools.length > 0 || diff.removed_forbidden_paths.length > 0) {
      blockers.push(blocker("permission-expansion", "candidate expands permissions relative to active/prototype baseline"));
    }
  }

  return {
    schema_version: "1.0.0",
    ok: blockers.length === 0,
    preflight: blockers.length === 0 ? "PASS" : "BLOCKED",
    skill: skillName,
    candidate: candidate ? {
      path: candidate.path,
      status: candidate.status,
      content_hash: candidate.content_hash,
    } : null,
    permission_diff: diff,
    blockers,
  };
}

module.exports = { preflightSkillPromotion };
