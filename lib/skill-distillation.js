"use strict";

const crypto = require("node:crypto");
const path = require("node:path");
const { ConfigError, UsageError } = require("./errors");
const { readJsonFile, writeJsonFile } = require("./json");
const { ensureDir } = require("./paths");

const DEFAULT_REGISTRY = ".meta-harness/skill-distillations.json";
const ALLOWED_STATUSES = new Set(["active", "superseded", "reopened"]);
const SKILL_NAME_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

function failUsage(message) { throw new UsageError(message); }
function failConfig(message) { throw new ConfigError(message); }

function parseArgs(argv) {
  const positional = [];
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      positional.push(token);
      continue;
    }
    const key = token.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    const next = argv[index + 1];
    if (next === undefined || next.startsWith("--")) {
      addOption(options, key, true);
    } else {
      addOption(options, key, next);
      index += 1;
    }
  }
  return { positional, options };
}

function addOption(options, key, value) {
  if (Object.prototype.hasOwnProperty.call(options, key)) {
    const current = options[key];
    options[key] = Array.isArray(current) ? [...current, value] : [current, value];
  } else {
    options[key] = value;
  }
}

function requireCliValue(value, label) {
  if (Array.isArray(value)) {
    failUsage(`${label} must be provided once`);
  }
  if (value === undefined || value === null || value === true || String(value).trim() === "") {
    failUsage(`${label} requires a value`);
  }
  return String(value).trim();
}

function optionalCliValue(value, label, fallback) {
  if (value === undefined || value === null) return fallback;
  return requireCliValue(value, label);
}

function optionValues(value, label) {
  if (value === undefined || value === null) return [];
  const values = Array.isArray(value) ? value : [value];
  return values.map((item) => requireCliValue(item, label));
}

function requireRecordString(record, key, index) {
  const value = record[key];
  if (typeof value !== "string" || value.trim() === "") {
    failConfig(`distillation ${key} at index ${index} requires a non-empty string`);
  }
  return value.trim();
}

function canonicalArray(values) {
  return [...new Set(values.map((item) => String(item).trim()).filter((item) => item.length > 0))]
    .sort((left, right) => left.localeCompare(right));
}

function normalizeSkillName(skill, error = failUsage) {
  if (!SKILL_NAME_PATTERN.test(skill)) {
    error(`skill must be a local capsule name matching ${SKILL_NAME_PATTERN}: ${skill}`);
  }
  return skill;
}

function canonicalIdentityKey(input) {
  return JSON.stringify({
    principle: input.principle,
    skill: input.skill,
    source_decision_id: input.source_decision_id,
  });
}

function first12HexSha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex").slice(0, 12);
}

function makeDistillationId(input) {
  return `S-${first12HexSha256(canonicalIdentityKey(input))}`;
}

function normalizeInput(input) {
  const assumptions = canonicalArray(input.assumptions || []);
  if (assumptions.length === 0) {
    failUsage("--assumption requires at least one value");
  }
  const status = input.status || "active";
  if (!ALLOWED_STATUSES.has(status)) {
    failUsage(`status must be one of: ${[...ALLOWED_STATUSES].join("|")}`);
  }
  const distillation = {
    source_decision_id: requireCliValue(input.source_decision_id, "--decision-id"),
    principle: requireCliValue(input.principle, "--principle"),
    skill: normalizeSkillName(requireCliValue(input.skill, "--skill")),
    assumptions,
    reopen_when: requireCliValue(input.reopen_when, "--reopen-when"),
    enforcement: optionalCliValue(input.enforcement, "--enforcement", "human-only"),
    owner: optionalCliValue(input.owner, "--owner", "orchestrator"),
    status,
  };
  return { id: makeDistillationId(distillation), ...distillation };
}

function normalizeDistillationRecord(record, index) {
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    failConfig(`distillation at index ${index} must be a JSON object`);
  }
  const normalized = {
    id: requireRecordString(record, "id", index),
    source_decision_id: requireRecordString(record, "source_decision_id", index),
    principle: requireRecordString(record, "principle", index),
    skill: normalizeSkillName(requireRecordString(record, "skill", index), failConfig),
    assumptions: Array.isArray(record.assumptions) ? canonicalArray(record.assumptions) : undefined,
    reopen_when: requireRecordString(record, "reopen_when", index),
    enforcement: requireRecordString(record, "enforcement", index),
    owner: requireRecordString(record, "owner", index),
    status: requireRecordString(record, "status", index),
  };
  if (!Array.isArray(record.assumptions) || normalized.assumptions.length === 0) {
    failConfig(`distillation assumptions at index ${index} requires a non-empty array`);
  }
  if (!ALLOWED_STATUSES.has(normalized.status)) {
    failConfig(`distillation status at index ${index} must be one of: ${[...ALLOWED_STATUSES].join("|")}`);
  }
  const expectedId = makeDistillationId(normalized);
  if (normalized.id !== expectedId) {
    failConfig(`distillation id at index ${index} must be ${expectedId}`);
  }
  return normalized;
}

function validateRegistry(rawRegistry) {
  if (!rawRegistry || typeof rawRegistry !== "object" || Array.isArray(rawRegistry)) {
    failConfig("skill distillation registry must be a JSON object");
  }
  if (rawRegistry.v !== 1) {
    failConfig("skill distillation registry v must be 1");
  }
  if (!Array.isArray(rawRegistry.distillations)) {
    failConfig("skill distillation registry must contain a distillations array");
  }
  const distillations = rawRegistry.distillations.map(normalizeDistillationRecord);
  const seenIds = new Set();
  for (const distillation of distillations) {
    if (seenIds.has(distillation.id)) {
      failConfig(`duplicate distillation id: ${distillation.id}`);
    }
    seenIds.add(distillation.id);
  }
  return { v: 1, distillations };
}

function sameIdentity(left, right) {
  return left.source_decision_id === right.source_decision_id
    && left.principle === right.principle
    && left.skill === right.skill;
}

function arraysEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function upsertDistillation(registry, input) {
  const normalizedRegistry = validateRegistry(registry);
  const distillation = normalizeInput(input);
  const existing = normalizedRegistry.distillations.find((item) => item.id === distillation.id);
  if (existing && !sameIdentity(existing, distillation)) {
    failUsage(`distillation id collision detected: ${distillation.id}`);
  }
  if (existing) {
    const reopened = !arraysEqual(existing.assumptions, distillation.assumptions)
      || existing.reopen_when !== distillation.reopen_when;
    if (reopened) {
      existing.assumptions = distillation.assumptions;
      existing.reopen_when = distillation.reopen_when;
      existing.enforcement = distillation.enforcement;
      existing.owner = distillation.owner;
      existing.status = "reopened";
    }
    return { registry: normalizedRegistry, distillation: existing, created: false, reopened };
  }
  normalizedRegistry.distillations.push(distillation);
  normalizedRegistry.distillations.sort((left, right) => left.id.localeCompare(right.id));
  return { registry: normalizedRegistry, distillation, created: true, reopened: false };
}

function isInside(targetPath, rootPath) {
  const relative = path.relative(rootPath, targetPath);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function resolveLocalPath(cwd, rawPath, label) {
  const value = rawPath === undefined || rawPath === null ? DEFAULT_REGISTRY : requireCliValue(rawPath, label);
  const resolved = path.resolve(cwd, value);
  if (!isInside(resolved, cwd)) {
    failUsage(`${label} must stay inside the current workspace: ${value}`);
  }
  return resolved;
}

function readRegistry(registryPath) {
  return validateRegistry(readJsonFile(registryPath, { v: 1, distillations: [] }));
}

function writeRegistry(registryPath, registry) {
  ensureDir(path.dirname(registryPath));
  writeJsonFile(registryPath, validateRegistry(registry));
}

function renderDistillation(distillation) {
  return `${distillation.id}\t${distillation.status}\t${distillation.skill}\t${distillation.principle}`;
}

function commandDistill(argv, context = {}) {
  const cwd = context.cwd || process.cwd();
  const { positional, options } = parseArgs(argv);
  const action = positional[0];

  if (action === "add") {
    const registryPath = resolveLocalPath(cwd, options.out, "--out");
    const registry = readRegistry(registryPath);
    const result = upsertDistillation(registry, {
      source_decision_id: options.decisionId,
      principle: options.principle,
      skill: options.skill,
      assumptions: optionValues(options.assumption, "--assumption"),
      reopen_when: options.reopenWhen,
      enforcement: options.enforcement,
      owner: options.owner,
      status: options.status,
    });
    writeRegistry(registryPath, result.registry);
    const verb = result.created ? "Added" : result.reopened ? "Reopened" : "Reused";
    console.log(`${verb} distillation: ${result.distillation.id}`);
    return;
  }

  if (action === "list") {
    const registry = readRegistry(resolveLocalPath(cwd, options.in, "--in"));
    if (registry.distillations.length === 0) {
      console.log("No distillations.");
      return;
    }
    for (const distillation of registry.distillations) {
      console.log(renderDistillation(distillation));
    }
    return;
  }

  if (action === "check") {
    const registry = readRegistry(resolveLocalPath(cwd, options.in, "--in"));
    const active = registry.distillations.filter((item) => item.status === "active");
    console.log("Skill distillation registry: PASS");
    console.log(`Active records: ${active.length}`);
    for (const distillation of active) {
      console.log(`- ${renderDistillation(distillation)}`);
    }
    return;
  }

  failUsage(`unknown distill action: ${action || "missing"}`);
}

module.exports = {
  commandDistill,
  validateRegistry,
  upsertDistillation,
  _test: { makeDistillationId },
};
