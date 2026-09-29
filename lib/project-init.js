"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const { withBootstrapLock } = require("./bootstrap-lock");
const { ConfigError } = require("./errors");
const {
  HARNESS_DIR,
  STREAMS,
  ensureHarness,
  harnessPath,
  streamTemplate,
  workerReportTemplate,
} = require("./harness-state");
const { writeIfMissing } = require("./paths");
const { renderCanonicalStatus } = require("./truth-reconciler");
const {
  assertContainedPath,
  assertHarnessAbsent,
  assertRepositoryRoot,
} = require("./truth-paths");

const PROJECT_DECLARATION_RELATIVE_PATH = ".meta-harness-project.json";
const PROJECT_DECLARATION_SCHEMA = "meta-harness-project/v1";
const STARTUP_CONTEXT_SCHEMA = "project-startup-context/v1";
const MAX_SOURCE_BYTES = 2 * 1024 * 1024;
const MAX_SOURCES = 20;
const MAX_PROJECTION_LINES = 10;
const MAX_LINE_CHARACTERS = 900;
const MAX_ARRAY_ITEMS = 5;
const FUTURE_SKEW_MS = 5 * 60 * 1000;

function failConfig(message) {
  throw new ConfigError(message);
}

function slashPath(value) {
  return String(value || "").split(path.sep).join("/");
}

function declarationPath(root) {
  return path.join(root, PROJECT_DECLARATION_RELATIVE_PATH);
}

function normalizeRelativePath(value, label) {
  const raw = String(value || "").trim();
  if (!raw) failConfig(`${label} path is required`);
  if (path.isAbsolute(raw) || path.win32.isAbsolute(raw) || /^[A-Za-z]:/.test(raw)) {
    failConfig(`${label} path must be repository-relative`);
  }
  const normalized = path.normalize(raw);
  const parts = normalized.split(/[\\/]+/).filter(Boolean);
  if (parts.length === 0 || parts.some((part) => part === "..")) {
    failConfig(`${label} path must remain inside the repository`);
  }
  return parts.join("/");
}

function nonEmptyString(value, label) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) failConfig(`${label} is required`);
  return text;
}

function exactSelector(value, label) {
  const jsonPointer = typeof value?.jsonPointer === "string" ? value.jsonPointer : null;
  const linePrefix = typeof value?.linePrefix === "string" ? value.linePrefix : null;
  if ((jsonPointer === null) === (linePrefix === null)) {
    failConfig(`${label} must define exactly one of jsonPointer or linePrefix`);
  }
  if (jsonPointer !== null && jsonPointer !== "" && !jsonPointer.startsWith("/")) {
    failConfig(`${label}.jsonPointer must be empty or start with /`);
  }
  if (linePrefix !== null && !linePrefix.trim()) {
    failConfig(`${label}.linePrefix must be non-empty`);
  }
  return jsonPointer !== null
    ? { kind: "jsonPointer", value: jsonPointer }
    : { kind: "linePrefix", value: linePrefix };
}

function normalizeMaxBytes(value, label) {
  if (value === undefined || value === null) return MAX_SOURCE_BYTES;
  const maxBytes = Number(value);
  if (!Number.isInteger(maxBytes) || maxBytes < 1 || maxBytes > MAX_SOURCE_BYTES) {
    failConfig(`${label}.maxBytes must be an integer from 1 to ${MAX_SOURCE_BYTES}`);
  }
  return maxBytes;
}

function normalizeFreshness(value, label) {
  if (value === undefined || value === null) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    failConfig(`${label} must be an object`);
  }
  const maxAgeDays = Number(value.maxAgeDays);
  if (!Number.isFinite(maxAgeDays) || maxAgeDays < 0) {
    failConfig(`${label}.maxAgeDays must be a non-negative number`);
  }
  return {
    maxAgeDays,
    selector: exactSelector(value, label),
  };
}

function normalizeDeclaration(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    failConfig(`${PROJECT_DECLARATION_RELATIVE_PATH} must contain a JSON object`);
  }
  if (input.schemaVersion !== PROJECT_DECLARATION_SCHEMA) {
    failConfig(`${PROJECT_DECLARATION_RELATIVE_PATH} schemaVersion must be ${PROJECT_DECLARATION_SCHEMA}`);
  }
  if (input.startupContext === undefined && input.professionalContext !== undefined) {
    return Object.freeze({ sources: [], projection: [], professionalContext: input.professionalContext });
  }
  const startup = input.startupContext;
  if (!startup || typeof startup !== "object" || Array.isArray(startup)) {
    failConfig(`${PROJECT_DECLARATION_RELATIVE_PATH} startupContext is required`);
  }
  if (!Array.isArray(startup.sources) || startup.sources.length === 0 || startup.sources.length > MAX_SOURCES) {
    failConfig(`startupContext.sources must contain 1-${MAX_SOURCES} entries`);
  }
  const sourceIds = new Set();
  const sources = startup.sources.map((source, index) => {
    if (!source || typeof source !== "object" || Array.isArray(source)) {
      failConfig(`startupContext.sources[${index}] must be an object`);
    }
    const id = nonEmptyString(source.id, `startupContext.sources[${index}].id`);
    if (sourceIds.has(id)) failConfig(`startupContext source id is duplicated: ${id}`);
    sourceIds.add(id);
    return {
      id,
      path: normalizeRelativePath(source.path, `startupContext.sources[${index}]`),
      required: source.required !== false,
      maxBytes: normalizeMaxBytes(source.maxBytes, `startupContext.sources[${index}]`),
      freshness: normalizeFreshness(source.freshness, `startupContext.sources[${index}].freshness`),
    };
  });
  if (!Array.isArray(startup.projection) || startup.projection.length === 0 || startup.projection.length > MAX_PROJECTION_LINES) {
    failConfig(`startupContext.projection must contain 1-${MAX_PROJECTION_LINES} entries`);
  }
  const projection = startup.projection.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      failConfig(`startupContext.projection[${index}] must be an object`);
    }
    const source = nonEmptyString(item.source, `startupContext.projection[${index}].source`);
    if (!sourceIds.has(source)) failConfig(`startupContext projection references unknown source: ${source}`);
    const take = item.take === undefined ? null : Number(item.take);
    if (take !== null && (!Number.isInteger(take) || take < 1 || take > MAX_ARRAY_ITEMS)) {
      failConfig(`startupContext.projection[${index}].take must be an integer from 1 to ${MAX_ARRAY_ITEMS}`);
    }
    return {
      label: nonEmptyString(item.label, `startupContext.projection[${index}].label`),
      source,
      selector: exactSelector(item, `startupContext.projection[${index}]`),
      take,
    };
  });
  return Object.freeze({ sources, projection });
}

function readProjectDeclaration(root) {
  const target = declarationPath(root);
  if (!fs.existsSync(target)) return null;
  assertContainedPath(root, target, {
    leafType: "file",
    label: "project init declaration",
  });
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(target, "utf8"));
  } catch (error) {
    throw new ConfigError(`invalid JSON in ${PROJECT_DECLARATION_RELATIVE_PATH}`, { cause: error });
  }
  return normalizeDeclaration(parsed);
}

function writeStarterFiles(context) {
  ensureHarness(context);
  writeIfMissing(harnessPath(context, "workers", "worker-report-template.md"), workerReportTemplate());
  for (const stream of STREAMS) {
    writeIfMissing(harnessPath(context, "streams", `${stream}.md`), streamTemplate(stream));
  }
  writeIfMissing(harnessPath(context, "status.md"), renderCanonicalStatus());
}

function promoteBootstrap(context) {
  const { root } = assertRepositoryRoot(context.cwd);
  const targetHarness = assertHarnessAbsent(root);
  const stageRoot = fs.mkdtempSync(path.join(root, ".meta-harness-bootstrap-"));
  const stageContext = { ...context, cwd: stageRoot };
  const stagedHarness = path.join(stageRoot, HARNESS_DIR);

  try {
    assertContainedPath(root, stageRoot, {
      leafType: "directory",
      label: "bootstrap staging directory",
    });
    writeStarterFiles(stageContext);
    assertHarnessAbsent(root);
    fs.renameSync(stagedHarness, targetHarness);
  } finally {
    fs.rmSync(stageRoot, { recursive: true, force: true });
  }
}

function regularFileNoLink(target) {
  try {
    const stat = fs.lstatSync(target);
    return stat.isFile() && !stat.isSymbolicLink();
  } catch (error) {
    if (error && error.code === "ENOENT") return false;
    throw error;
  }
}

function directoryNoLink(target) {
  try {
    const stat = fs.lstatSync(target);
    return stat.isDirectory() && !stat.isSymbolicLink();
  } catch (error) {
    if (error && error.code === "ENOENT") return false;
    throw error;
  }
}

function projectHooksComplete(root) {
  const targetHarness = path.join(root, HARNESS_DIR);
  assertContainedPath(root, targetHarness, {
    leafType: "directory",
    label: "existing harness directory",
  });
  const requiredDirectories = [
    path.join(targetHarness, "contracts"),
    path.join(targetHarness, "streams"),
    path.join(targetHarness, "workers"),
  ];
  const requiredFiles = [
    path.join(targetHarness, "events.jsonl"),
    path.join(targetHarness, "repos.json"),
    path.join(targetHarness, "status.md"),
    path.join(targetHarness, "workers", "worker-report-template.md"),
    ...STREAMS.map((stream) => path.join(targetHarness, "streams", `${stream}.md`)),
  ];
  return requiredDirectories.every(directoryNoLink) && requiredFiles.every(regularFileNoLink);
}

function assertExistingHookRootsSafe(root) {
  for (const relative of ["contracts", "streams", "workers"]) {
    const target = path.join(root, HARNESS_DIR, relative);
    if (!fs.existsSync(target)) continue;
    assertContainedPath(root, target, {
      leafType: "directory",
      label: `existing harness ${relative} directory`,
    });
  }
  for (const relative of [
    "events.jsonl",
    "repos.json",
    "status.md",
    "workers/worker-report-template.md",
    ...STREAMS.map((stream) => `streams/${stream}.md`),
  ]) {
    const target = path.join(root, HARNESS_DIR, ...relative.split("/"));
    if (!fs.existsSync(target)) continue;
    assertContainedPath(root, target, {
      leafType: "file",
      label: `existing harness ${relative}`,
    });
  }
}

function ensureProjectHooks(context = {}) {
  const { root } = assertRepositoryRoot(context.cwd);
  const targetHarness = path.join(root, HARNESS_DIR);
  if (fs.existsSync(targetHarness)) {
    assertExistingHookRootsSafe(root);
    if (projectHooksComplete(root)) {
      return Object.freeze({ initialized: false, reconciled: false, root });
    }
    writeStarterFiles({ ...context, cwd: root });
    if (!projectHooksComplete(root)) {
      failConfig("repository runtime hooks remain incomplete after silent reconcile");
    }
    return Object.freeze({ initialized: false, reconciled: true, root });
  }
  withBootstrapLock({ ...context, cwd: root }, () => {
    if (!fs.existsSync(targetHarness)) promoteBootstrap({ ...context, cwd: root });
  });
  if (!projectHooksComplete(root)) {
    failConfig("fresh repository runtime hooks are incomplete after bootstrap");
  }
  return Object.freeze({ initialized: true, reconciled: false, root });
}

function pointerParts(pointer) {
  if (pointer === "") return [];
  return pointer.slice(1).split("/").map((part) => part.replace(/~1/g, "/").replace(/~0/g, "~"));
}

function selectJsonPointer(doc, pointer) {
  let current = doc;
  for (const part of pointerParts(pointer)) {
    if (current === null || current === undefined || typeof current !== "object") return undefined;
    if (Array.isArray(current)) {
      if (!/^\d+$/.test(part)) return undefined;
      current = current[Number(part)];
    } else {
      current = current[part];
    }
  }
  return current;
}

function selectLinePrefix(text, prefix) {
  const line = String(text).split(/\r?\n/).find((candidate) => candidate.startsWith(prefix));
  return line === undefined ? undefined : line.slice(prefix.length).trim();
}

function selectValue(source, selector) {
  if (selector.kind === "linePrefix") return selectLinePrefix(source.text, selector.value);
  if (source.jsonError) return undefined;
  if (source.json === undefined) {
    try {
      source.json = JSON.parse(source.text);
    } catch (error) {
      source.jsonError = error;
      return undefined;
    }
  }
  return selectJsonPointer(source.json, selector.value);
}

function compactScalar(value) {
  let text;
  if (typeof value === "string") text = value.trim();
  else if (["number", "boolean"].includes(typeof value) || value === null) text = String(value);
  else text = JSON.stringify(value);
  if (text.length <= MAX_LINE_CHARACTERS) return text;
  return `${text.slice(0, MAX_LINE_CHARACTERS - 1)}…`;
}

function compactValue(value, take) {
  if (!Array.isArray(value)) return compactScalar(value);
  const limit = take || MAX_ARRAY_ITEMS;
  const items = value.slice(0, limit).map(compactScalar);
  const suffix = value.length > limit ? ` | +${value.length - limit} more` : "";
  return compactScalar(`${items.join(" | ")}${suffix}`);
}

function readDeclaredSource(root, source) {
  const target = path.join(root, ...source.path.split("/"));
  if (!fs.existsSync(target)) {
    return { ...source, status: "missing", text: null, path: source.path };
  }
  try {
    assertContainedPath(root, target, {
      leafType: "file",
      label: `startup context source ${source.id}`,
    });
    const stat = fs.statSync(target);
    if (stat.size > source.maxBytes) {
      return {
        ...source,
        status: "invalid",
        text: null,
        path: source.path,
        sizeBytes: stat.size,
        issue: `source exceeds declared maxBytes ${source.maxBytes}`,
      };
    }
    const bytes = fs.readFileSync(target);
    return {
      ...source,
      status: "present",
      text: bytes.toString("utf8"),
      path: source.path,
      sizeBytes: bytes.length,
      sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
    };
  } catch (error) {
    return { ...source, status: "invalid", text: null, path: source.path, issue: error.message };
  }
}

function evaluateFreshness(source, nowMs) {
  if (source.status !== "present" || !source.freshness) return source;
  const selected = selectValue(source, source.freshness.selector);
  const timestamp = typeof selected === "string" ? Date.parse(selected) : Number.NaN;
  if (!Number.isFinite(timestamp)) {
    return { ...source, status: "invalid", issue: "freshness timestamp is missing or invalid" };
  }
  const ageMs = nowMs - timestamp;
  if (ageMs < -FUTURE_SKEW_MS) {
    return { ...source, status: "invalid", issue: "freshness timestamp is in the future", observedAt: new Date(timestamp).toISOString() };
  }
  const maxAgeMs = source.freshness.maxAgeDays * 24 * 60 * 60 * 1000;
  return {
    ...source,
    status: ageMs > maxAgeMs ? "stale" : "fresh",
    observedAt: new Date(timestamp).toISOString(),
    ageDays: Math.max(0, ageMs) / (24 * 60 * 60 * 1000),
  };
}

function blockedStartup(reason) {
  return Object.freeze({
    schemaVersion: STARTUP_CONTEXT_SCHEMA,
    status: "BLOCKED",
    lines: [],
    sources: [],
    blockers: [reason],
  });
}

function inspectProjectStartup(root, { nowMs = Date.now() } = {}) {
  let declaration;
  try {
    declaration = readProjectDeclaration(root);
  } catch (error) {
    return blockedStartup(error.message);
  }
  if (!declaration) return null;

  const loaded = new Map();
  const sourceSummaries = [];
  const blockers = [];
  for (const source of declaration.sources) {
    const evaluated = evaluateFreshness(readDeclaredSource(root, source), nowMs);
    loaded.set(source.id, evaluated);
    sourceSummaries.push(Object.freeze({
      id: source.id,
      path: slashPath(source.path),
      status: evaluated.status,
      ...(Number.isInteger(evaluated.sizeBytes) ? { sizeBytes: evaluated.sizeBytes } : {}),
      ...(evaluated.sha256 ? { sha256: evaluated.sha256 } : {}),
      ...(evaluated.observedAt ? { observedAt: evaluated.observedAt } : {}),
    }));
    if (source.required && evaluated.status === "missing") blockers.push(`required startup source missing: ${source.path}`);
    if (source.required && evaluated.status === "stale") blockers.push(`required startup source stale: ${source.path}`);
    if (source.required && evaluated.status === "invalid") blockers.push(`required startup source invalid: ${source.path}${evaluated.issue ? ` (${evaluated.issue})` : ""}`);
  }

  const lines = [];
  for (const item of declaration.projection) {
    const source = loaded.get(item.source);
    if (!source || source.text === null) {
      blockers.push(`startup projection unavailable: ${item.label}`);
      continue;
    }
    const value = selectValue(source, item.selector);
    if (value === undefined) {
      blockers.push(`startup projection selector missing: ${item.label}`);
      continue;
    }
    lines.push(`${item.label}: ${compactValue(value, item.take)}`);
  }

  return Object.freeze({
    schemaVersion: STARTUP_CONTEXT_SCHEMA,
    status: blockers.length === 0 ? "READY" : "BLOCKED",
    lines: Object.freeze(lines.slice(0, MAX_PROJECTION_LINES)),
    sources: Object.freeze(sourceSummaries),
    blockers: Object.freeze(blockers.slice(0, MAX_PROJECTION_LINES)),
  });
}

module.exports = {
  PROJECT_DECLARATION_RELATIVE_PATH,
  PROJECT_DECLARATION_SCHEMA,
  STARTUP_CONTEXT_SCHEMA,
  ensureProjectHooks,
  inspectProjectStartup,
  readProjectDeclaration,
};
