"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const { domainDigest, isDigest } = require("./contracts/digest");
const { ConfigError } = require("./errors");
const { scanImports } = require("./quality-complexity-imports");
const {
  countDirectEventAppends,
  countMainBoundaryMissing,
  countProcessExit,
  workerReportFlagSignature,
} = require("./quality-signatures");

const STRUCTURAL_SAW_SNAPSHOT_SCHEMA = "structural-saw-snapshot/v1";
const STRUCTURAL_SAW_SCHEMA = "structural-saw/v1";
const STRUCTURAL_SAW_DOMAIN = "meta-harness-structural-saw/v1";
const STRUCTURAL_SNAPSHOT_DOMAIN = "meta-harness-structural-saw-snapshot/v1";
const SOURCE_EXTENSIONS = new Set([".cjs", ".js", ".jsx", ".mjs", ".ts", ".tsx", ".py", ".rb", ".go", ".rs", ".java", ".cs", ".php"]);
const CONTROLLER_EXCLUSIONS = new Set([".git", ".worktrees", ".worktree-owners", ".devspace", ".cursor"]);

function fail(code, message, details) {
  throw new ConfigError(message, { code, details });
}

function toSlash(value) { return String(value).replace(/\\/gu, "/"); }

function normalizePath(value, { directory = false } = {}) {
  const raw = toSlash(value).replace(/^\.\//u, "");
  if (!raw || path.posix.isAbsolute(raw) || /^[A-Za-z]:\//u.test(raw)) {
    fail("MH_STRUCTURAL_SAW_POLICY", `invalid repository-relative policy path: ${value}`);
  }
  const normalized = path.posix.normalize(raw);
  if (normalized === ".." || normalized.startsWith("../")) {
    fail("MH_STRUCTURAL_SAW_POLICY", `policy path escapes repository root: ${value}`);
  }
  return directory && raw.endsWith("/") && !normalized.endsWith("/") ? `${normalized}/` : normalized;
}

function lineCount(text) {
  if (!text) return 0;
  const lines = text.split(/\r?\n/u).length;
  return /\r?\n$/u.test(text) ? lines - 1 : lines;
}

function excludedDirectories(contract) {
  const excluded = new Set(CONTROLLER_EXCLUSIONS);
  for (const value of contract.excluded_dirs || []) {
    excluded.add(normalizePath(value, { directory: String(value).endsWith("/") }).replace(/\/$/u, ""));
  }
  return excluded;
}

function collectSourceFiles(rootPath, contract, currentPath = rootPath, files = []) {
  const excluded = excludedDirectories(contract);
  for (const entry of fs.readdirSync(currentPath, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const fullPath = path.join(currentPath, entry.name);
    const relative = toSlash(path.relative(rootPath, fullPath));
    if (entry.isDirectory()) {
      if (!excluded.has(entry.name) && !excluded.has(relative)) collectSourceFiles(rootPath, contract, fullPath, files);
    } else if (entry.isFile() && SOURCE_EXTENSIONS.has(path.extname(entry.name))) {
      const text = fs.readFileSync(fullPath, "utf8");
      files.push({ relative, text, lines: lineCount(text) });
    }
  }
  return files;
}

function ownerModules(owners) {
  return owners.modules.map((item) => ({
    ...item,
    normalizedPath: normalizePath(item.path, { directory: item.path.endsWith("/") }),
  })).sort((a, b) => b.normalizedPath.length - a.normalizedPath.length || a.normalizedPath.localeCompare(b.normalizedPath));
}

function moduleBudget(relative, policy, owners) {
  const normalized = normalizePath(relative);
  const owner = ownerModules(owners).find((item) => item.normalizedPath.endsWith("/")
    ? normalized.startsWith(item.normalizedPath)
    : normalized === item.normalizedPath);
  if (Number.isInteger(owner?.budget_lines)) return { category: owner.risk || "owner", maxLines: owner.budget_lines };
  if (/^bin\/[^/]+\.[^/]+$/u.test(normalized)) return { category: "bin_entrypoint", maxLines: policy.line_budgets.bin_entrypoint };
  if (/^lib\/commands\/[^/]+\.[^/]+$/u.test(normalized)) return { category: "command_module", maxLines: policy.line_budgets.command_module };
  if (/^tests\//u.test(normalized)) return { category: "test", maxLines: policy.line_budgets.test };
  return { category: "source", maxLines: policy.line_budgets.source };
}

function moduleBudgets(files, policy, owners) {
  return files.map((file) => {
    const budget = moduleBudget(file.relative, policy, owners);
    return {
      path: file.relative,
      lines: file.lines,
      maxLines: budget.maxLines,
      category: budget.category,
      overbudget: file.lines > budget.maxLines,
    };
  }).sort((a, b) => a.path.localeCompare(b.path));
}

function layerFor(relative) {
  if (relative.startsWith("bin/")) return "bin";
  if (relative.startsWith("lib/commands/")) return "lib/commands";
  if (relative.startsWith("lib/")) return "lib";
  if (relative.startsWith("templates/")) return "templates";
  return null;
}

function importViolations(files, policy) {
  const facts = new Map();
  for (const file of files) {
    const sourceLayer = layerFor(file.relative);
    if (!sourceLayer) continue;
    for (const item of scanImports(file.text)) {
      const specifier = item.specifier || "";
      if (!specifier.startsWith(".")) continue;
      const target = path.posix.normalize(path.posix.join(path.posix.dirname(file.relative), specifier));
      const targetLayer = layerFor(target);
      if (!targetLayer) continue;
      const direction = `${sourceLayer} -> ${targetLayer}`;
      if (policy.import_direction?.[direction] !== "forbidden") continue;
      const key = `forbidden-import:${direction}:${file.relative}:${target}`;
      facts.set(key, { rule: "forbidden_import", key, direction, source: file.relative, target });
    }
  }
  return [...facts.values()].sort((a, b) => a.key.localeCompare(b.key));
}

function sha256Bytes(bytes) {
  return `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
}

function templateDuplicateFacts(rootPath, policy) {
  const allow = new Set(policy.duplicate_template_allowlist || []);
  const byHash = new Map();
  const facts = [];
  for (const directory of ["templates/contracts", "templates/skills"]) {
    const fullDir = path.join(rootPath, ...directory.split("/"));
    if (!fs.existsSync(fullDir)) continue;
    for (const entry of fs.readdirSync(fullDir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (!entry.isFile()) continue;
      const relative = `${directory}/${entry.name}`;
      const hash = sha256Bytes(fs.readFileSync(path.join(fullDir, entry.name)));
      const previous = byHash.get(hash);
      if (previous) {
        const pair = [previous, relative].sort();
        if (!allow.has(pair.join("="))) {
          const key = `template-duplicate:${pair.join(":")}`;
          facts.push({ rule: "template_duplicate", key, paths: pair });
        }
      }
      byHash.set(hash, relative);
    }
  }
  return facts.sort((a, b) => a.key.localeCompare(b.key));
}

function symlinkFacts(rootPath, contract) {
  const excluded = excludedDirectories(contract);
  const facts = [];
  function walk(currentPath) {
    for (const entry of fs.readdirSync(currentPath, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const fullPath = path.join(currentPath, entry.name);
      const relative = toSlash(path.relative(rootPath, fullPath));
      const stat = fs.lstatSync(fullPath);
      if (stat.isSymbolicLink()) {
        const target = toSlash(fs.readlinkSync(fullPath));
        try {
          const real = fs.realpathSync(fullPath);
          const relReal = path.relative(rootPath, real);
          if (relReal.startsWith("..") || path.isAbsolute(relReal)) {
            const key = `symlink-outside-root:${relative}:${target}`;
            facts.push({ rule: "symlink_outside_root", key, path: relative, target });
          }
        } catch (error) {
          const rule = error.code === "ELOOP" ? "symlink_loop" : "symlink_unresolved";
          const key = `${rule.replace(/_/gu, "-")}:${relative}:${target}`;
          facts.push({ rule, key, path: relative, target });
        }
      } else if (stat.isDirectory() && !excluded.has(entry.name) && !excluded.has(relative)) {
        walk(fullPath);
      }
    }
  }
  walk(rootPath);
  return facts.sort((a, b) => a.key.localeCompare(b.key));
}

function structuralSnapshot(rootPath, policyBundle) {
  if (!policyBundle.active) {
    return Object.freeze({
      schemaVersion: STRUCTURAL_SAW_SNAPSHOT_SCHEMA,
      active: false,
      moduleBudgets: [],
      ratchets: { processExit: 0, mainBoundaryMissing: 0, directEventAppend: 0, workerReportFlags: { count: 0, flags: [] } },
      importViolations: [],
      blockingFacts: [],
    });
  }
  const files = collectSourceFiles(rootPath, policyBundle.cleanCodeContract);
  return Object.freeze({
    schemaVersion: STRUCTURAL_SAW_SNAPSHOT_SCHEMA,
    active: true,
    moduleBudgets: moduleBudgets(files, policyBundle.complexityPolicy, policyBundle.owners),
    ratchets: {
      processExit: files.reduce((sum, file) => sum + countProcessExit(file.text), 0),
      mainBoundaryMissing: files.reduce((sum, file) => sum + countMainBoundaryMissing(file.text), 0),
      directEventAppend: files.reduce((sum, file) => sum + countDirectEventAppends(file.text, policyBundle.cleanCodeContract), 0),
      workerReportFlags: workerReportFlagSignature(files),
    },
    importViolations: importViolations(files, policyBundle.complexityPolicy),
    blockingFacts: [
      ...templateDuplicateFacts(rootPath, policyBundle.complexityPolicy),
      ...symlinkFacts(rootPath, policyBundle.cleanCodeContract),
    ].sort((a, b) => a.key.localeCompare(b.key)),
  });
}

function computeStructuralSnapshotDigest(snapshot) {
  return domainDigest(STRUCTURAL_SNAPSHOT_DOMAIN, snapshot);
}

function compareStructuralSaw(predecessor, candidate, contract) {
  if (predecessor.schemaVersion !== STRUCTURAL_SAW_SNAPSHOT_SCHEMA || candidate.schemaVersion !== STRUCTURAL_SAW_SNAPSHOT_SCHEMA) {
    fail("MH_STRUCTURAL_SAW_SNAPSHOT", "structural SAW snapshots must use structural-saw-snapshot/v1");
  }
  const regressions = [];
  const previousModules = new Map(predecessor.moduleBudgets.map((item) => [item.path, item]));
  for (const current of candidate.moduleBudgets) {
    const previous = previousModules.get(current.path);
    if (!previous && current.overbudget) {
      regressions.push({ rule: "new_overbudget_module", key: `module:${current.path}`, path: current.path, beforeLines: null, afterLines: current.lines, maxLines: current.maxLines });
    } else if (previous?.overbudget && current.lines > previous.lines) {
      regressions.push({ rule: "grandfathered_module_grew", key: `module:${current.path}`, path: current.path, beforeLines: previous.lines, afterLines: current.lines, maxLines: current.maxLines });
    } else if (previous && !previous.overbudget && current.overbudget) {
      regressions.push({ rule: "module_budget_crossed", key: `module:${current.path}`, path: current.path, beforeLines: previous.lines, afterLines: current.lines, maxLines: current.maxLines });
    }
  }
  for (const name of ["processExit", "mainBoundaryMissing", "directEventAppend"]) {
    const before = predecessor.ratchets[name] || 0;
    const after = candidate.ratchets[name] || 0;
    if (after > before) regressions.push({ rule: "ratchet_increased", key: `ratchet:${name}`, ratchet: name, before, after });
  }
  const beforeFlags = predecessor.ratchets.workerReportFlags || { count: 0, flags: [] };
  const afterFlags = candidate.ratchets.workerReportFlags || { count: 0, flags: [] };
  const escapeFlags = contract?.ratchets?.worker_report_flags?.must_not_increase_without || [];
  const hasEscape = escapeFlags.some((flag) => afterFlags.flags.includes(String(flag).replace(/^--/u, "")));
  if (afterFlags.count > beforeFlags.count && !hasEscape) {
    regressions.push({ rule: "worker_report_flags_increased", key: "ratchet:workerReportFlags", before: beforeFlags.count, after: afterFlags.count, flags: afterFlags.flags });
  }
  for (const field of ["importViolations", "blockingFacts"]) {
    const previousKeys = new Set(predecessor[field].map((item) => item.key));
    for (const fact of candidate[field]) if (!previousKeys.has(fact.key)) regressions.push({ ...fact });
  }
  return Object.freeze(regressions.sort((a, b) => a.key.localeCompare(b.key) || a.rule.localeCompare(b.rule)));
}

function computeStructuralSawDigest(value) {
  const body = JSON.parse(JSON.stringify(value));
  delete body.sawDigest;
  return domainDigest(STRUCTURAL_SAW_DOMAIN, body);
}

function validatePolicyIdentity(value) {
  const expected = ["active", "cleanCodeContractDigest", "complexityPolicyDigest", "ownersDigest", "codeownersDigest"].sort();
  if (!value || typeof value !== "object" || Array.isArray(value) || JSON.stringify(Object.keys(value).sort()) !== JSON.stringify(expected)) {
    fail("MH_STRUCTURAL_SAW_POLICY", "structural SAW policyIdentity has missing or unexpected fields");
  }
  if (typeof value.active !== "boolean") fail("MH_STRUCTURAL_SAW_POLICY", "structural SAW policyIdentity.active must be boolean");
  for (const field of ["cleanCodeContractDigest", "complexityPolicyDigest", "ownersDigest"]) {
    if (value.active ? !isDigest(value[field]) : value[field] !== null) fail("MH_STRUCTURAL_SAW_POLICY", `structural SAW policyIdentity.${field} is invalid`);
  }
  if (value.codeownersDigest !== null && !isDigest(value.codeownersDigest)) fail("MH_STRUCTURAL_SAW_POLICY", "structural SAW policyIdentity.codeownersDigest is invalid");
  if (!value.active && value.codeownersDigest !== null) fail("MH_STRUCTURAL_SAW_POLICY", "inactive structural SAW policyIdentity cannot bind CODEOWNERS");
}

function validateStructuralSaw(value) {
  const expected = [
    "schemaVersion", "predecessorProductCommit", "candidateTreeOid", "changedPaths", "policyIdentity",
    "predecessorSnapshotDigest", "candidateSnapshotDigest", "regressions", "passed", "sawDigest",
  ].sort();
  if (!value || typeof value !== "object" || Array.isArray(value) || JSON.stringify(Object.keys(value).sort()) !== JSON.stringify(expected)) {
    fail("MH_STRUCTURAL_SAW_SHAPE", "structural SAW evidence has missing or unexpected fields");
  }
  if (value.schemaVersion !== STRUCTURAL_SAW_SCHEMA) fail("MH_STRUCTURAL_SAW_SCHEMA", `schemaVersion must be ${STRUCTURAL_SAW_SCHEMA}`);
  if (!/^[a-f0-9]{40,64}$/u.test(value.predecessorProductCommit) || !/^[a-f0-9]{40,64}$/u.test(value.candidateTreeOid)) fail("MH_STRUCTURAL_SAW_GIT", "structural SAW Git identities are invalid");
  if (!Array.isArray(value.changedPaths) || !Array.isArray(value.regressions)) fail("MH_STRUCTURAL_SAW_SHAPE", "structural SAW changedPaths/regressions must be arrays");
  if (value.changedPaths.some((item) => typeof item !== "string" || !item || item.includes("\\") || item.startsWith("../") || path.posix.isAbsolute(item))
      || JSON.stringify(value.changedPaths) !== JSON.stringify([...new Set(value.changedPaths)].sort())) {
    fail("MH_STRUCTURAL_SAW_SHAPE", "structural SAW changedPaths must be unique sorted repository-relative paths");
  }
  validatePolicyIdentity(value.policyIdentity);
  if (!isDigest(value.predecessorSnapshotDigest) || !isDigest(value.candidateSnapshotDigest) || !isDigest(value.sawDigest)) fail("MH_STRUCTURAL_SAW_DIGEST", "structural SAW digests are invalid");
  if (value.passed !== (value.regressions.length === 0)) fail("MH_STRUCTURAL_SAW_RESULT", "structural SAW pass/fail does not match regressions");
  for (const item of value.regressions) {
    if (!item || typeof item.rule !== "string" || typeof item.key !== "string") fail("MH_STRUCTURAL_SAW_RESULT", "structural SAW regression fact is invalid");
  }
  if (value.sawDigest !== computeStructuralSawDigest(value)) fail("MH_STRUCTURAL_SAW_DIGEST", "structural SAW digest does not match its body");
  return Object.freeze(JSON.parse(JSON.stringify(value)));
}

module.exports = {
  STRUCTURAL_SAW_DOMAIN,
  STRUCTURAL_SAW_SCHEMA,
  STRUCTURAL_SAW_SNAPSHOT_SCHEMA,
  compareStructuralSaw,
  computeStructuralSawDigest,
  computeStructuralSnapshotDigest,
  structuralSnapshot,
  validateStructuralSaw,
  _test: { collectSourceFiles, importViolations, moduleBudget, normalizePath },
};
