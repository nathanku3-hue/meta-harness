"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { ConfigError, UsageError } = require("./errors");
const { appendEvent, ensureHarness } = require("./harness-state");
const { writeJsonAtomic } = require("./paths");

const REGISTRY_RELATIVE = ".meta-harness/skill-registry.json";
const SKILL_NAME_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
const ALLOWED_STATUSES = new Set(["active", "prototype", "candidate", "quarantined"]);
const REVIEW_REQUIRED_DIRS = new Set(["scripts", "references", "assets"]);

function toSlash(value) {
  return value.split(path.sep).join("/");
}

function registryPath(targetRoot) {
  return path.join(targetRoot, ".meta-harness", "skill-registry.json");
}

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

function relativeFrom(root, targetPath) {
  return toSlash(path.relative(root, targetPath));
}

function readJsonFile(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new ConfigError(`invalid JSON in ${filePath}`, { cause: error });
    }
    throw error;
  }
}

function readSkillRegistry(targetRoot) {
  const filePath = registryPath(targetRoot);
  const stat = fs.existsSync(filePath) ? fs.lstatSync(filePath) : null;
  if (!stat) {
    throw new ConfigError(`${REGISTRY_RELATIVE} is missing`);
  }
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new ConfigError(`${REGISTRY_RELATIVE} must be a regular file`);
  }
  return readJsonFile(filePath);
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

function listBundleFiles(bundleRoot, errors, prefix = "") {
  const files = [];
  const entries = fs.readdirSync(path.join(bundleRoot, prefix), { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isSymbolicLink()) {
      errors.push(`${relative} must not be a symlink`);
      continue;
    }
    if (entry.isDirectory()) {
      if (prefix === "" && REVIEW_REQUIRED_DIRS.has(entry.name)) {
        errors.push(`${relative}/ requires explicit package review in Phase 7`);
        continue;
      }
      if (prefix === "" && entry.name !== "evals") {
        errors.push(`${relative}/ is not allowed in the Phase 7 skill bundle`);
        continue;
      }
      files.push(...listBundleFiles(bundleRoot, errors, relative));
      continue;
    }
    if (entry.isFile()) {
      if (prefix === "" && entry.name !== "SKILL.md") {
        errors.push(`${relative} is not allowed in the Phase 7 skill bundle`);
        continue;
      }
      files.push(relative);
    }
  }
  return files;
}

function canonicalSkillBundleHash(targetRoot, skillPath) {
  const bundleRoot = resolveUnder(targetRoot, skillPath);
  const errors = [];
  const files = listBundleFiles(bundleRoot, errors);
  if (errors.length > 0) {
    throw new ConfigError(errors[0]);
  }
  const hash = crypto.createHash("sha256");
  for (const relative of files.sort((left, right) => left.localeCompare(right))) {
    const repoRelative = toSlash(path.posix.join(skillPath, relative));
    const text = fs.readFileSync(path.join(bundleRoot, ...relative.split("/")), "utf8").replace(/\r\n/g, "\n");
    hash.update(repoRelative, "utf8");
    hash.update("\0", "utf8");
    hash.update(text, "utf8");
    hash.update("\0", "utf8");
  }
  return `sha256:${hash.digest("hex")}`;
}

function arraysMatch(left, right) {
  return Array.isArray(left) && Array.isArray(right)
    && left.length === right.length
    && left.every((item, index) => item === right[index]);
}

function validateRepoLicense(targetRoot, record, errors, index) {
  if (record.license !== "inherit-repo") {
    return;
  }
  const packagePath = path.join(targetRoot, "package.json");
  if (!fs.existsSync(packagePath)) {
    errors.push(`skills[${index}].license cannot inherit without package.json license`);
    return;
  }
  const pkg = readJsonFile(packagePath);
  if (typeof pkg.license !== "string" || pkg.license.trim() === "") {
    errors.push(`skills[${index}].license cannot inherit from missing package.json license`);
  }
}

function validateSourceRules(record, errors, index) {
  if (record.source === "local") {
    if (typeof record.reviewer !== "string" || record.reviewer.trim() === "") {
      errors.push(`skills[${index}].reviewer is required for local source`);
    }
    if (typeof record.content_hash !== "string" || !record.content_hash.startsWith("sha256:")) {
      errors.push(`skills[${index}].content_hash is required for local source`);
    }
    if (record.rollback_hash === null && record.first_version !== true) {
      errors.push(`skills[${index}].rollback_hash may be null only for first_version local skills`);
    }
    return;
  }
  if (record.source === "public-derived") {
    for (const field of ["source_url", "license", "reviewer", "eval_command"]) {
      if (typeof record[field] !== "string" || record[field].trim() === "") {
        errors.push(`skills[${index}].${field} is required for public-derived source`);
      }
    }
    if (!record.source_commit && !record.content_hash) {
      errors.push(`skills[${index}] public-derived source requires source_commit or content_hash`);
    }
    return;
  }
  errors.push(`skills[${index}].source must be local or public-derived`);
}

function validateSkillRecord(targetRoot, record, index, errors) {
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    errors.push(`skills[${index}] must be an object`);
    return;
  }
  for (const field of ["name", "path", "status", "owner", "reviewer", "source", "content_hash", "eval_command"]) {
    if (typeof record[field] !== "string" || record[field].trim() === "") {
      errors.push(`skills[${index}].${field} is required`);
    }
  }
  if (!ALLOWED_STATUSES.has(record.status)) {
    errors.push(`skills[${index}].status is invalid`);
  }
  const normalizedRecordPath = registryRecordPath(record.path);
  if (record.status === "candidate" && normalizedRecordPath !== candidateSkillPath(record.name)) {
    errors.push(`skills[${index}].candidate path must be .agents/candidate/${record.name}`);
  }
  if (normalizedRecordPath.startsWith(".agents/candidate/") && record.status !== "candidate") {
    errors.push(`skills[${index}].status must be candidate for .agents/candidate/ paths`);
  }
  validateSourceRules(record, errors, index);
  validateRepoLicense(targetRoot, record, errors, index);
  if (!record.path || record.status === "quarantined") {
    return;
  }
  const skillRoot = resolveUnder(targetRoot, record.path);
  const skillMd = path.join(skillRoot, "SKILL.md");
  if (!normalizedRecordPath.startsWith(".agents/skills/") && !normalizedRecordPath.startsWith(".agents/candidate/")) {
    errors.push(`skills[${index}].path must live under .agents/skills/ or .agents/candidate/`);
  }
  const skillMdStat = fs.existsSync(skillMd) ? fs.lstatSync(skillMd) : null;
  if (!skillMdStat || skillMdStat.isSymbolicLink() || !skillMdStat.isFile()) {
    errors.push(`skills[${index}] SKILL.md must exist as a regular file`);
    return;
  }
  const frontMatter = parseFrontMatter(fs.readFileSync(skillMd, "utf8"));
  if (!arraysMatch(record.allowed_tools, frontMatter.allowed_tools)) {
    errors.push(`skills[${index}].allowed_tools does not match SKILL.md frontmatter`);
  }
  if (!arraysMatch(record.forbidden_paths, frontMatter.forbidden_paths)) {
    errors.push(`skills[${index}].forbidden_paths does not match SKILL.md frontmatter`);
  }
  const actualHash = canonicalSkillBundleHash(targetRoot, record.path);
  if (record.content_hash !== actualHash) {
    errors.push(`skills[${index}].content_hash does not match skill bundle`);
  }
}

function validateSkillRegistry(targetRoot) {
  try {
    const registry = readSkillRegistry(targetRoot);
    const errors = [];
    if (registry.schema_version !== "1.0.0") {
      errors.push("schema_version must be 1.0.0");
    }
    if (registry.version !== 1) {
      errors.push("version must be 1");
    }
    if (!Array.isArray(registry.skills)) {
      errors.push("skills must be an array");
    } else {
      registry.skills.forEach((record, index) => validateSkillRecord(targetRoot, record, index, errors));
    }
    return { ok: errors.length === 0, errors, registry };
  } catch (error) {
    return { ok: false, errors: [error.message], registry: null };
  }
}

function withMetaHarnessLock(targetRoot, name, fn) {
  const lockPath = path.join(targetRoot, ".meta-harness", "local", "locks", `${name}.lock`);
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  try {
    fs.writeFileSync(lockPath, process.pid.toString(), { flag: "wx" });
  } catch (error) {
    if (error && error.code === "EEXIST") {
      throw new ConfigError(`lock already held: ${toSlash(path.relative(targetRoot, lockPath))}`);
    }
    throw error;
  }
  try {
    return fn();
  } finally {
    try {
      fs.unlinkSync(lockPath);
    } catch (_) {}
  }
}

function writeRecoveryMarker(targetRoot, payload) {
  const marker = path.join(targetRoot, ".meta-harness", "local", `skill-disable-recovery-${Date.now()}.json`);
  writeJsonAtomic(marker, payload);
}

function appendRedactedSkillEvent(targetRoot, event) {
  ensureHarness({ cwd: targetRoot });
  return appendEvent({ cwd: targetRoot }, {
    actor: "meta-harness",
    stream: "coding",
    phase: "work",
    action: "skill.disable",
    result: event.result,
    reason: event.reason,
    skill: event.skill,
    skill_content_hash: event.skill_content_hash,
    quarantine_path: event.quarantine_path,
    redacted: true,
  });
}

function quarantineRelativePath(skillName, contentHash, timestamp = new Date()) {
  const safeTime = timestamp.toISOString().replace(/[:.]/g, "-");
  const hashPart = String(contentHash || "sha256:unknown").replace(/^sha256:/, "").slice(0, 12);
  return `.agents/quarantine/${skillName}-${safeTime}-${hashPart}`;
}

function disableSkill({ targetRoot, skillName, reason = "operator-requested", dryRun = false }) {
  assertSkillName(skillName);
  return withMetaHarnessLock(targetRoot, "skill-registry", () => {
    const validation = validateSkillRegistry(targetRoot);
    if (!validation.ok) {
      throw new ConfigError(`skill registry invalid: ${validation.errors.join("; ")}`);
    }
    const registry = validation.registry;
    const record = registry.skills.find((skill) => skill.name === skillName);
    if (!record) {
      throw new UsageError(`unknown skill: ${skillName}`);
    }
    if (record.status === "quarantined") {
      throw new ConfigError(`skill already quarantined: ${skillName}`);
    }
    if (!record.path.startsWith(".agents/skills/")) {
      throw new ConfigError(`can only disable skills under .agents/skills/: ${record.path}`);
    }
    if (record.rollback_hash) {
      throw new ConfigError("rollback_hash restore requires an explicit rollback_path in Phase 7");
    }
    const sourcePath = resolveUnder(targetRoot, record.path);
    const quarantineRel = quarantineRelativePath(skillName, record.content_hash);
    const quarantinePath = resolveUnder(targetRoot, quarantineRel);
    if (fs.existsSync(quarantinePath)) {
      throw new ConfigError(`quarantine path already exists: ${quarantineRel}`);
    }
    if (dryRun) {
      return { dry_run: true, skill: skillName, from: record.path, to: quarantineRel, status: "would-quarantine" };
    }

    const originalRegistry = JSON.parse(JSON.stringify(registry));
    let moved = false;
    let registryWritten = false;
    try {
      fs.mkdirSync(path.dirname(quarantinePath), { recursive: true });
      fs.renameSync(sourcePath, quarantinePath);
      moved = true;
      record.status = "quarantined";
      record.path = quarantineRel;
      record.quarantined_at = new Date().toISOString();
      record.quarantine_reason = reason;
      writeJsonAtomic(registryPath(targetRoot), registry);
      registryWritten = true;
      appendRedactedSkillEvent(targetRoot, {
        result: "quarantined",
        reason,
        skill: skillName,
        skill_content_hash: record.content_hash,
        quarantine_path: quarantineRel,
      });
      return { dry_run: false, skill: skillName, from: relativeFrom(targetRoot, sourcePath), to: quarantineRel, status: "quarantined" };
    } catch (error) {
      try {
        if (registryWritten) {
          writeJsonAtomic(registryPath(targetRoot), originalRegistry);
        }
        if (moved && !fs.existsSync(sourcePath)) {
          fs.renameSync(quarantinePath, sourcePath);
        }
      } catch (rollbackError) {
        writeRecoveryMarker(targetRoot, {
          skill: skillName,
          source_path: record.path,
          quarantine_path: quarantineRel,
          error: error.message,
          rollback_error: rollbackError.message,
        });
      }
      throw error;
    }
  });
}

module.exports = {
  REGISTRY_RELATIVE,
  _test: {
    parseFrontMatter,
    quarantineRelativePath,
    resolveUnder,
  },
  canonicalSkillBundleHash,
  disableSkill,
  readSkillRegistry,
  validateSkillRegistry,
  withMetaHarnessLock,
  writeJsonAtomic,
};
