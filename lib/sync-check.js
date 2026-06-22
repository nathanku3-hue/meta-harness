"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const TEMPLATE_CATEGORIES = ["skills", "contracts"];
const SKILL_NAME_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
const OLD_REPORT_HEADINGS = [
  { heading: "# Worker Report", pattern: /^# Worker Report\s*$/m },
  { heading: "## Result", pattern: /^## Result\s*$/m },
  { heading: "## Human Summary", pattern: /^## Human Summary\s*$/m },
];
const ACTIVE_GUIDANCE_PATHS = ["AGENTS.md", "CLAUDE.md", "GEMINI.md", ".github/copilot-instructions.md"];
const ACTIVE_GUIDANCE_ROOTS = [".agents/skills", ".agents/candidate", ".agents/quarantine", ".agents/prototypes", ".meta-harness/templates", ".meta-harness/workers", ".meta-harness/contracts"];
const ACTIVE_GUIDANCE_EXTENSIONS = new Set([".md", ".txt", ".json", ".yml", ".yaml"]);
const ACTIVE_GUIDANCE_CONFLICTS = [
  { pattern: /final responses? must use .*PM Brief/i, detail: "active guidance requires the worker-report artifact as the final chat response" },
  { pattern: /final (?:chat )?(?:answer|response) must start with .*Outcome.*Round.*Progress.*Confidence/i, detail: "active guidance requires artifact metadata at the start of final chat" },
  { pattern: /^Artifact:\s*PM_CLOSURE\s*\|\s*Route:/m, detail: "active guidance exposes internal closure labels as user output" },
  { pattern: /^Route:\s*BLOCK\s*\|\s*Outcome:/m, detail: "active guidance exposes internal route and outcome labels as user output" },
];

function toSlash(value) {
  return value.split(path.sep).join("/");
}

function relativePath(root, targetPath) {
  return toSlash(path.relative(root, targetPath));
}

function safeLstat(targetPath) {
  try {
    return fs.lstatSync(targetPath);
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

function sortedDirectoryEntries(directoryPath) {
  return fs.readdirSync(directoryPath).sort((left, right) => left.localeCompare(right));
}

function hasSymlinkParent(rootPath, targetPath) {
  const resolvedRoot = path.resolve(rootPath);
  const resolvedTarget = path.resolve(targetPath);
  const relative = path.relative(resolvedRoot, resolvedTarget);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    return true;
  }

  const rootStat = safeLstat(resolvedRoot);
  if (rootStat && rootStat.isSymbolicLink()) {
    return true;
  }

  const parts = relative.split(path.sep).filter(Boolean);
  let currentPath = resolvedRoot;
  for (const part of parts.slice(0, -1)) {
    currentPath = path.join(currentPath, part);
    const stat = safeLstat(currentPath);
    if (!stat) {
      return false;
    }
    if (stat.isSymbolicLink()) {
      return true;
    }
    if (!stat.isDirectory()) {
      return false;
    }
  }
  return false;
}

function listRegularFiles(rootPath, boundaryRoot = rootPath) {
  const resolvedRoot = path.resolve(rootPath);
  if (hasSymlinkParent(boundaryRoot, resolvedRoot)) {
    return [];
  }
  const rootStat = safeLstat(resolvedRoot);
  if (!rootStat || !rootStat.isDirectory()) {
    return [];
  }

  const files = [];
  function walk(directoryPath) {
    for (const name of sortedDirectoryEntries(directoryPath)) {
      const itemPath = path.join(directoryPath, name);
      const stat = safeLstat(itemPath);
      if (!stat || stat.isSymbolicLink()) {
        continue;
      }
      if (stat.isDirectory()) {
        walk(itemPath);
      } else if (stat.isFile()) {
        files.push(itemPath);
      }
    }
  }

  walk(resolvedRoot);
  return files.sort((left, right) => relativePath(resolvedRoot, left).localeCompare(relativePath(resolvedRoot, right)));
}

function readRegularFileBuffer(filePath, boundaryRoot) {
  if (boundaryRoot && hasSymlinkParent(boundaryRoot, filePath)) {
    return { kind: "not_regular" };
  }
  const stat = safeLstat(filePath);
  if (!stat) {
    return { kind: "missing" };
  }
  if (stat.isSymbolicLink() || !stat.isFile()) {
    return { kind: "not_regular" };
  }
  return { kind: "ok", buffer: fs.readFileSync(filePath) };
}

function sourceTemplateEntries(sourceRoot) {
  const resolvedSource = path.resolve(sourceRoot);
  const entries = [];
  for (const category of TEMPLATE_CATEGORIES) {
    const categoryRoot = path.join(resolvedSource, "templates", category);
    for (const filePath of listRegularFiles(categoryRoot, resolvedSource)) {
      entries.push({
        category,
        source: filePath,
        path: `${category}/${relativePath(categoryRoot, filePath)}`,
      });
    }
  }
  return entries.sort((left, right) => left.path.localeCompare(right.path));
}

function checkTemplateSync({ sourceRoot, targetRoot }) {
  const resolvedTarget = path.resolve(targetRoot);
  const items = [];

  for (const entry of sourceTemplateEntries(sourceRoot)) {
    const targetPath = path.join(resolvedTarget, ".meta-harness", "templates", ...entry.path.split("/"));
    const target = readRegularFileBuffer(targetPath, resolvedTarget);
    if (target.kind === "missing") {
      items.push({ status: "MISSING", path: entry.path, detail: "installed template is missing" });
      continue;
    }
    if (target.kind !== "ok") {
      items.push({ status: "DRIFT", path: entry.path, detail: "installed template is not a regular file" });
      continue;
    }

    const source = readRegularFileBuffer(entry.source, sourceRoot);
    if (source.kind !== "ok") {
      items.push({ status: "DRIFT", path: entry.path, detail: "installed template differs from source" });
      continue;
    }
    const sourceText = source.buffer.toString("utf8").replace(/\r\n/g, "\n");
    const targetText = target.buffer.toString("utf8").replace(/\r\n/g, "\n");
    if (sourceText !== targetText) {
      items.push({ status: "DRIFT", path: entry.path, detail: "installed template differs from source" });
      continue;
    }
    items.push({ status: "PASS", path: entry.path });
  }

  // Check for unexpected extra files in .meta-harness/templates
  const targetTemplateRoot = path.join(resolvedTarget, ".meta-harness", "templates");
  const targetFiles = listRegularFiles(targetTemplateRoot, resolvedTarget);
  const expectedPaths = new Set(sourceTemplateEntries(sourceRoot).map(e => `.meta-harness/templates/${e.path}`));
  
  for (const file of targetFiles) {
    const rel = relativePath(resolvedTarget, file);
    if (rel === ".meta-harness/templates/manifest.json") {
      continue;
    }
    if (!expectedPaths.has(rel)) {
      items.push({ status: "REJECTED", path: rel.replace(".meta-harness/templates/", ""), detail: "unexpected extra template file" });
    }
  }

  const manifestPath = path.join(resolvedTarget, ".meta-harness", "templates", "manifest.json");
  const manifest = readRegularFileBuffer(manifestPath, resolvedTarget);
  if (manifest.kind === "missing") {
    items.push({ status: "MISSING", path: "manifest.json", detail: "templates manifest is missing" });
  } else if (manifest.kind !== "ok") {
    items.push({ status: "DRIFT", path: "manifest.json", detail: "templates manifest is not a regular file" });
  } else {
    try {
      const data = JSON.parse(manifest.buffer.toString("utf8"));
      if (!data || typeof data !== "object" || !Array.isArray(data.templates)) {
        items.push({ status: "DRIFT", path: "manifest.json", detail: "templates manifest is malformed" });
      } else {
        for (const template of data.templates) {
          const tPath = path.join(resolvedTarget, ...template.installed_path.split("/"));
          const tFile = readRegularFileBuffer(tPath, resolvedTarget);
          if (tFile.kind === "ok") {
            const normalized = tFile.buffer.toString("utf8").replace(/\r\n/g, "\n");
            const hash = crypto.createHash("sha256").update(normalized, "utf8").digest("hex");
            if (hash !== template.content_hash) {
              items.push({ status: "DRIFT", path: template.name || template.source_path.replace("templates/", ""), detail: "installed template hash does not match manifest" });
            }
          }
        }
        items.push({ status: "PASS", path: "manifest.json" });
      }
    } catch (_) {
      items.push({ status: "DRIFT", path: "manifest.json", detail: "templates manifest contains invalid JSON" });
    }
  }

  return {
    status: items.some((item) => item.status !== "PASS") ? "FAIL" : "PASS",
    checked: items.length,
    items,
  };
}

function markdownFilesUnder(targetRoot, relativeRoots) {
  const resolvedTarget = path.resolve(targetRoot);
  const files = [];
  for (const relativeRoot of relativeRoots) {
    const surfaceRoot = path.join(resolvedTarget, ...relativeRoot.split("/"));
    for (const filePath of listRegularFiles(surfaceRoot, resolvedTarget)) {
      if (filePath.toLowerCase().endsWith(".md")) {
        files.push(filePath);
      }
    }
  }
  return files.sort((left, right) => relativePath(resolvedTarget, left).localeCompare(relativePath(resolvedTarget, right)));
}

function activeGuidanceFilesUnder(targetRoot) {
  const resolvedTarget = path.resolve(targetRoot);
  const files = ACTIVE_GUIDANCE_PATHS
    .map((relativePath) => path.join(resolvedTarget, ...relativePath.split("/")))
    .filter((filePath) => isRegularFile(filePath));
  for (const relativeRoot of ACTIVE_GUIDANCE_ROOTS) {
    const rootPath = path.join(resolvedTarget, ...relativeRoot.split("/"));
    for (const filePath of listRegularFiles(rootPath, resolvedTarget))
      if (ACTIVE_GUIDANCE_EXTENSIONS.has(path.extname(filePath).toLowerCase())) files.push(filePath);
  }
  return [...new Set(files)].sort((left, right) => relativePath(resolvedTarget, left).localeCompare(relativePath(resolvedTarget, right)));
}

function scanContracts({ targetRoot }) {
  const resolvedTarget = path.resolve(targetRoot);
  const files = markdownFilesUnder(targetRoot, [".meta-harness/contracts", ".meta-harness/templates/contracts", ".meta-harness/workers"]);
  const activeGuidanceFiles = activeGuidanceFilesUnder(targetRoot);
  const items = [];

  for (const filePath of files) {
    const text = fs.readFileSync(filePath, "utf8");
    for (const oldHeading of OLD_REPORT_HEADINGS) {
      if (oldHeading.pattern.test(text)) {
        items.push({
          status: "REJECTED",
          path: relativePath(resolvedTarget, filePath),
          detail: `old primary heading: ${oldHeading.heading}`,
        });
      }
    }
  }

  for (const filePath of activeGuidanceFiles) {
    const text = fs.readFileSync(filePath, "utf8");
    for (const conflict of ACTIVE_GUIDANCE_CONFLICTS) {
      if (conflict.pattern.test(text)) {
        items.push({
          status: "REJECTED",
          path: relativePath(resolvedTarget, filePath),
          detail: conflict.detail,
        });
      }
    }
  }

  return {
    status: items.length === 0 ? "PASS" : "FAIL",
    checked: new Set([...files, ...activeGuidanceFiles]).size,
    items,
  };
}

function readJsonNoThrow(filePath) {
  try {
    return { ok: true, value: JSON.parse(fs.readFileSync(filePath, "utf8")) };
  } catch (error) {
    return { ok: false, error };
  }
}

function checkTrustPolicy({ targetRoot }) {
  const resolvedTarget = path.resolve(targetRoot);
  const registryPath = path.join(resolvedTarget, ".meta-harness", "skill-distillations.json");
  const relativeRegistryPath = ".meta-harness/skill-distillations.json";
  const stat = safeLstat(registryPath);
  if (!stat) {
    return { status: "PASS", checked: 0, items: [] };
  }
  if (stat.isSymbolicLink() || !stat.isFile()) {
    return {
      status: "FAIL",
      checked: 0,
      items: [{ status: "REJECTED", path: relativeRegistryPath, detail: "skill registry is not a regular file" }],
    };
  }

  const parsed = readJsonNoThrow(registryPath);
  if (!parsed.ok) {
    return {
      status: "FAIL",
      checked: 0,
      items: [{ status: "REJECTED", path: relativeRegistryPath, detail: `malformed JSON: ${parsed.error.message}` }],
    };
  }

  const body = parsed.value;
  if (!body || typeof body !== "object" || Array.isArray(body) || !Array.isArray(body.distillations)) {
    return {
      status: "FAIL",
      checked: 0,
      items: [{ status: "REJECTED", path: relativeRegistryPath, detail: "registry must contain a distillations array" }],
    };
  }

  const items = [];
  let checked = 0;
  for (let index = 0; index < body.distillations.length; index += 1) {
    const record = body.distillations[index];
    const skill = record && typeof record === "object" ? record.skill : undefined;
    checked += 1;
    if (typeof skill !== "string" || !SKILL_NAME_PATTERN.test(skill)) {
      items.push({
        status: "REJECTED",
        path: `${relativeRegistryPath}#distillations[${index}].skill`,
        detail: "skill reference must be a local capsule name",
      });
    }
  }

  return {
    status: items.length === 0 ? "PASS" : "FAIL",
    checked,
    items,
  };
}

function isRegularFile(filePath) {
  const stat = safeLstat(filePath);
  return Boolean(stat && stat.isFile() && !stat.isSymbolicLink());
}

function isDirectory(filePath) {
  const stat = safeLstat(filePath);
  return Boolean(stat && stat.isDirectory() && !stat.isSymbolicLink());
}

function checkStateLayout({ targetRoot }) {
  const resolvedTarget = path.resolve(targetRoot);
  const harnessRoot = path.join(resolvedTarget, ".meta-harness");
  const items = [];

  if (isDirectory(path.join(harnessRoot, "runs"))) {
    items.push({
      status: "MIGRATION_NEEDED",
      path: ".meta-harness/runs",
      detail: "old run layout present",
    });
  }
  if (!isRegularFile(path.join(harnessRoot, "status.md"))) {
    items.push({
      status: "MISSING",
      path: ".meta-harness/status.md",
      detail: "root status truth is missing",
    });
  }
  if (!isRegularFile(path.join(harnessRoot, "events.jsonl"))) {
    items.push({
      status: "MISSING",
      path: ".meta-harness/events.jsonl",
      detail: "root events truth is missing",
    });
  }

  const status = items.some((item) => item.status === "MIGRATION_NEEDED")
    ? "MIGRATION_NEEDED"
    : (items.length === 0 ? "PASS" : "FAIL");
  return { status, checked: 3, items };
}

module.exports = {
  checkTemplateSync,
  scanContracts,
  checkTrustPolicy,
  checkStateLayout,
};
