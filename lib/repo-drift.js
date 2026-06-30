"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const HARNESS_DIR = ".meta-harness";
const SECURITY_SURFACE_FILES = Object.freeze([
  "SECURITY.md",
  path.join(".github", "dependabot.yml"),
  path.join(".github", "codeql.yml"),
  path.join(".github", "workflows", "security.yml"),
]);
const SKILL_REGISTRY_PATHS = Object.freeze([
  path.join(HARNESS_DIR, "skill-registry.json"),
  path.join(HARNESS_DIR, "skills", "registry.json"),
]);

function fileExists(filePath, fsApi = fs) {
  try {
    return fsApi.existsSync(filePath) && fsApi.statSync(filePath).isFile();
  } catch (_error) {
    return false;
  }
}

function dirExists(dirPath, fsApi = fs) {
  try {
    return fsApi.existsSync(dirPath) && fsApi.statSync(dirPath).isDirectory();
  } catch (_error) {
    return false;
  }
}

function readText(filePath, fsApi = fs) {
  return fsApi.readFileSync(filePath, "utf8");
}

function safeReadJson(filePath, fsApi = fs) {
  try {
    return { ok: true, value: JSON.parse(readText(filePath, fsApi)) };
  } catch (error) {
    return { ok: false, error: error && error.message ? error.message : String(error) };
  }
}

function sha256(text) {
  return crypto.createHash("sha256").update(String(text), "utf8").digest("hex");
}

function driftWarning({ id, kind, reason, expected = null, actual = null, source }) {
  return {
    id,
    kind,
    severity: "warn",
    reason,
    expected: expected == null ? null : String(expected),
    actual: actual == null ? null : String(actual),
    source,
  };
}

function parseOptionalJson(filePath, kind, source, fsApi = fs) {
  if (!fileExists(filePath, fsApi)) return { present: false, value: null, warnings: [] };
  const parsed = safeReadJson(filePath, fsApi);
  if (parsed.ok) return { present: true, value: parsed.value, warnings: [] };
  return {
    present: true,
    value: null,
    warnings: [driftWarning({
      id: kind === "template_manifest" ? "DRIFT_TEMPLATE_MANIFEST_INVALID" : "DRIFT_SKILL_REGISTRY_INVALID",
      kind,
      reason: `${kind === "template_manifest" ? "template manifest" : "skill registry"} could not be parsed`,
      expected: "valid JSON",
      actual: "invalid JSON",
      source,
    })],
  };
}

function templateEntryKey(entry) {
  if (!entry || typeof entry !== "object") return null;
  return entry.source_path || entry.installed_path || entry.name || entry.id || null;
}

function templateEntryHash(entry) {
  if (!entry || typeof entry !== "object") return null;
  return entry.content_hash || entry.hash || null;
}

function templateEntryMap(manifest) {
  const entries = manifest && Array.isArray(manifest.templates) ? manifest.templates : [];
  const pairs = [];
  for (const entry of entries) {
    const key = templateEntryKey(entry);
    if (key) pairs.push([String(key), templateEntryHash(entry)]);
  }
  return new Map(pairs.sort(([a], [b]) => a.localeCompare(b)));
}

function collectTemplateManifestDrift(root, childRoot, fsApi = fs) {
  const source = path.join(HARNESS_DIR, "templates", "manifest.json");
  const parentPath = path.join(root, source);
  const childPath = path.join(childRoot, source);
  if (!fileExists(parentPath, fsApi)) return [];
  if (!fileExists(childPath, fsApi)) {
    return [driftWarning({
      id: "DRIFT_TEMPLATE_MANIFEST_MISSING",
      kind: "template_manifest",
      reason: "child template manifest is missing",
      expected: "present",
      actual: "missing",
      source,
    })];
  }

  const parentManifest = parseOptionalJson(parentPath, "template_manifest", source, fsApi);
  const childManifest = parseOptionalJson(childPath, "template_manifest", source, fsApi);
  const warnings = [...parentManifest.warnings, ...childManifest.warnings];
  if (!parentManifest.value || !childManifest.value) return warnings;

  if (parentManifest.value.version !== childManifest.value.version) {
    warnings.push(driftWarning({
      id: "DRIFT_TEMPLATE_VERSION",
      kind: "template_manifest",
      reason: "child template manifest version differs from parent",
      expected: parentManifest.value.version,
      actual: childManifest.value.version,
      source,
    }));
  }

  const parentEntries = templateEntryMap(parentManifest.value);
  const childEntries = templateEntryMap(childManifest.value);
  for (const name of [...parentEntries.keys()].sort()) {
    if (!childEntries.has(name)) {
      warnings.push(driftWarning({
        id: "DRIFT_TEMPLATE_ENTRY_MISSING",
        kind: "template_manifest",
        reason: "child template entry is missing",
        expected: name,
        actual: null,
        source,
      }));
      continue;
    }
    const expectedHash = parentEntries.get(name);
    const actualHash = childEntries.get(name);
    if (expectedHash !== actualHash) {
      warnings.push(driftWarning({
        id: "DRIFT_TEMPLATE_HASH",
        kind: "template_manifest",
        reason: "child template content hash differs from parent",
        expected: expectedHash,
        actual: actualHash,
        source: `${source}:${name}`,
      }));
    }
  }
  for (const name of [...childEntries.keys()].sort()) {
    if (!parentEntries.has(name)) {
      warnings.push(driftWarning({
        id: "DRIFT_TEMPLATE_ENTRY_MISSING",
        kind: "template_manifest",
        reason: "child template entry is not present in parent",
        expected: null,
        actual: name,
        source,
      }));
    }
  }
  return warnings;
}

function collectSecuritySurfaceDrift(root, childRoot, fsApi = fs) {
  const warnings = [];
  for (const source of SECURITY_SURFACE_FILES) {
    const parentPath = path.join(root, source);
    const childPath = path.join(childRoot, source);
    if (!fileExists(parentPath, fsApi)) continue;
    if (!fileExists(childPath, fsApi)) {
      warnings.push(driftWarning({
        id: "DRIFT_SECURITY_FILE_MISSING",
        kind: "security_surface",
        reason: "child security file is missing",
        expected: "present",
        actual: "missing",
        source,
      }));
      continue;
    }
    const expectedHash = sha256(readText(parentPath, fsApi));
    const actualHash = sha256(readText(childPath, fsApi));
    if (expectedHash !== actualHash) {
      warnings.push(driftWarning({
        id: "DRIFT_SECURITY_FILE_HASH",
        kind: "security_surface",
        reason: "child security file content hash differs from parent",
        expected: expectedHash,
        actual: actualHash,
        source,
      }));
    }
  }
  return warnings;
}

function firstExistingSkillRegistryPath(root, fsApi = fs) {
  for (const source of SKILL_REGISTRY_PATHS) {
    const filePath = path.join(root, source);
    if (fileExists(filePath, fsApi)) return { filePath, source };
  }
  return null;
}

function skillId(skill) {
  if (!skill || typeof skill !== "object") return null;
  return skill.id || skill.name || null;
}

function skillVersion(skill) {
  if (!skill || typeof skill !== "object") return null;
  return skill.version || skill.content_hash || null;
}

function skillMap(registry) {
  const skills = registry && Array.isArray(registry.skills) ? registry.skills : [];
  const pairs = [];
  for (const skill of skills) {
    const id = skillId(skill);
    if (id) pairs.push([String(id), skillVersion(skill)]);
  }
  return new Map(pairs.sort(([a], [b]) => a.localeCompare(b)));
}

function collectSkillRegistryDrift(root, childRoot, fsApi = fs) {
  const parentRegistryPath = firstExistingSkillRegistryPath(root, fsApi);
  if (!parentRegistryPath) return [];
  const childPath = path.join(childRoot, parentRegistryPath.source);
  if (!fileExists(childPath, fsApi)) {
    return [driftWarning({
      id: "DRIFT_SKILL_REGISTRY_MISSING",
      kind: "skill_registry",
      reason: "child skill registry is missing",
      expected: "present",
      actual: "missing",
      source: parentRegistryPath.source,
    })];
  }

  const parentRegistry = parseOptionalJson(parentRegistryPath.filePath, "skill_registry", parentRegistryPath.source, fsApi);
  const childRegistry = parseOptionalJson(childPath, "skill_registry", parentRegistryPath.source, fsApi);
  const warnings = [...parentRegistry.warnings, ...childRegistry.warnings];
  if (!parentRegistry.value || !childRegistry.value) return warnings;

  if (parentRegistry.value.version !== childRegistry.value.version) {
    warnings.push(driftWarning({
      id: "DRIFT_SKILL_REGISTRY_VERSION",
      kind: "skill_registry",
      reason: "child skill registry version differs from parent",
      expected: parentRegistry.value.version,
      actual: childRegistry.value.version,
      source: parentRegistryPath.source,
    }));
  }

  const parentSkills = skillMap(parentRegistry.value);
  const childSkills = skillMap(childRegistry.value);
  for (const id of [...parentSkills.keys()].sort()) {
    if (!childSkills.has(id)) {
      warnings.push(driftWarning({
        id: "DRIFT_SKILL_ID",
        kind: "skill_registry",
        reason: "child skill id is missing",
        expected: id,
        actual: null,
        source: parentRegistryPath.source,
      }));
      continue;
    }
    const expectedVersion = parentSkills.get(id);
    const actualVersion = childSkills.get(id);
    if (expectedVersion !== actualVersion) {
      warnings.push(driftWarning({
        id: "DRIFT_SKILL_VERSION",
        kind: "skill_registry",
        reason: "child skill version differs from parent",
        expected: expectedVersion,
        actual: actualVersion,
        source: `${parentRegistryPath.source}:${id}`,
      }));
    }
  }
  for (const id of [...childSkills.keys()].sort()) {
    if (!parentSkills.has(id)) {
      warnings.push(driftWarning({
        id: "DRIFT_SKILL_ID",
        kind: "skill_registry",
        reason: "child skill id is not present in parent",
        expected: null,
        actual: id,
        source: parentRegistryPath.source,
      }));
    }
  }
  return warnings;
}

function collectGovernanceDrift(paths, readySchemaVersion, fsApi = fs) {
  const warnings = [];
  if (fileExists(paths.readyPath, fsApi)) {
    const parsed = safeReadJson(paths.readyPath, fsApi);
    if (parsed.ok && parsed.value && parsed.value.schema_version !== readySchemaVersion) {
      warnings.push(driftWarning({
        id: "DRIFT_READY_SCHEMA_VERSION",
        kind: "governance_compatibility",
        reason: "child ready schema version differs from parent",
        expected: readySchemaVersion,
        actual: parsed.value.schema_version,
        source: path.join(HARNESS_DIR, "ready.json"),
      }));
    }
  }
  if (fileExists(paths.statusPath, fsApi)) {
    const statusText = readText(paths.statusPath, fsApi);
    if (!/^Phase:\s*/im.test(statusText)) {
      warnings.push(driftWarning({
        id: "DRIFT_STATUS_PHASE_MARKER",
        kind: "governance_compatibility",
        reason: "child status is missing Phase marker",
        expected: "Phase:",
        actual: null,
        source: path.join(HARNESS_DIR, "status.md"),
      }));
    }
  }
  return warnings;
}

function collectDriftWarnings(root, repo, paths, options = {}) {
  const fsApi = options.fs || fs;
  if (!repo.path || !dirExists(paths.absolutePath, fsApi)) return [];
  return [
    ...collectTemplateManifestDrift(root, paths.absolutePath, fsApi),
    ...collectSecuritySurfaceDrift(root, paths.absolutePath, fsApi),
    ...collectSkillRegistryDrift(root, paths.absolutePath, fsApi),
    ...collectGovernanceDrift(paths, options.readySchemaVersion || "1.0.0", fsApi),
  ];
}

module.exports = { collectDriftWarnings };
