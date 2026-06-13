"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { execSync } = require("node:child_process");
const { ConfigError, UsageError } = require("./errors");
const { commandRegistry } = require("./command-registry");
const { checkIdRegistry } = require("./check-id-registry");
const { scanImports } = require("./quality-complexity-imports");

const SCHEMA_VERSION = "1.0.0";
const COMPLEXITY_POLICY_FILE = path.join(".meta-harness", "complexity-policy.json");
const OWNERS_FILE = path.join("docs", "architecture", "owners.json");
const EXCLUDED_DIRS = new Set([".git", "node_modules", ".meta-harness", "tmp", "dist", "build", "coverage"]);
const CONTROLLED_RISKS = new Set(["command", "control-plane", "entrypoint", "harness-contract", "implementation", "security"]);

const RESERVED_CHECK_PREFIXES = [
  "MH_SYNC_", "MH_STATE_", "MH_SECURITY_", "MH_COMPLEXITY_", "MH_QUALITY_", "MH_READY_",
  "MH_PACKAGE_", "MH_RELEASE_", "MH_MERGE_", "MH_SHIPGATE_", "MH_GITCHECK_", "MH_CONTRACT_",
  "MH_BRIEF_", "MH_DECISION_", "MH_TRUST_", "MH_REPRO_", "MH_TEST_", "MH_GITHUB_SETTINGS_",
  "MH_NPM_SCRIPTS_", "MH_DOMAIN_", "MH_SKILL_", "MH_SUBAGENT_", "MH_ROLLUP_", "MH_AUTONOMY_", "MH_CONTEXT_GATE_", "MH_TRANSITION_GRAPH_",
];

const DEFAULT_POLICY = Object.freeze({
  schema_version: SCHEMA_VERSION,
  version: 1,
  complexity_adopted_at: null,
  complexity_adoption_decision: null,
  line_budgets: { source: 400, bin_entrypoint: 150, command_module: 200, test: 300 },
  surface_ceiling: { max_cli_commands: 25, max_check_ids_global_warn: 20, max_template_count: 30 },
  duplicate_template_allowlist: [],
  generated_files: [],
  architecture_exceptions: [],
  import_direction: {
    "bin -> lib/commands": "allowed",
    "bin -> lib": "allowed",
    "lib/commands -> lib": "allowed",
    "lib/commands -> bin": "forbidden",
    "lib -> bin": "forbidden",
    "lib -> lib/commands": "forbidden",
    "templates -> lib": "forbidden",
  },
});

function defaultComplexityPolicy() {
  return mergePolicy({});
}

function finding(id, severity, message, file = undefined) {
  return { id, kind: id, severity, message, file };
}

function toSlash(value) { return String(value).replace(/\\/g, "/"); }

function normalizeRepoPath(value, { keepDirectory = false } = {}) {
  if (typeof value !== "string" || value.trim() === "") throw new UsageError("path must be a non-empty string");
  if (value.includes("\0")) throw new UsageError("path must not contain NUL bytes");
  const slash = toSlash(value.trim()).replace(/^\.\//, "");
  if (path.posix.isAbsolute(slash) || /^[A-Za-z]:\//.test(slash)) throw new UsageError(`path must be repo-relative: ${value}`);
  const normalized = path.posix.normalize(slash);
  if (normalized === ".." || normalized.startsWith("../")) throw new UsageError(`path escapes repo root: ${value}`);
  if (normalized === ".") return keepDirectory ? "" : ".";
  return keepDirectory && /\/$/.test(slash) && !normalized.endsWith("/") ? `${normalized}/` : normalized;
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    throw new ConfigError(`invalid JSON in ${filePath}`, { cause: error });
  }
}

function mergePolicy(policy) {
  return {
    ...DEFAULT_POLICY,
    ...policy,
    line_budgets: { ...DEFAULT_POLICY.line_budgets, ...(policy.line_budgets || {}) },
    surface_ceiling: { ...DEFAULT_POLICY.surface_ceiling, ...(policy.surface_ceiling || {}) },
    import_direction: { ...DEFAULT_POLICY.import_direction, ...(policy.import_direction || {}) },
  };
}

function loadComplexityPolicy(rootPath, harnessDir = ".meta-harness") {
  const policyPath = path.join(rootPath, harnessDir, "complexity-policy.json");
  if (!fs.existsSync(policyPath)) return { path: policyPath, policy: mergePolicy({}), missing: true };
  const policy = readJson(policyPath);
  if (policy.schema_version !== SCHEMA_VERSION) throw new ConfigError(`complexity policy schema_version must be ${SCHEMA_VERSION}`);
  return { path: policyPath, policy: mergePolicy(policy), missing: false };
}

function loadOwnersMap(rootPath) {
  const ownersPath = path.join(rootPath, OWNERS_FILE);
  if (!fs.existsSync(ownersPath)) return { path: ownersPath, owners: { schema_version: SCHEMA_VERSION, version: 1, modules: [] }, missing: true };
  const owners = readJson(ownersPath);
  const legacy = owners.schema_version === undefined;
  if (!legacy && owners.schema_version !== SCHEMA_VERSION) throw new ConfigError(`owners map schema_version must be ${SCHEMA_VERSION}`);
  if (!Array.isArray(owners.modules)) throw new ConfigError("owners map modules must be an array");
  return { path: ownersPath, owners: { schema_version: SCHEMA_VERSION, ...owners }, missing: false, legacy };
}

function validateComplexityConfig(policy, owners) {
  if (policy.schema_version !== SCHEMA_VERSION) throw new ConfigError(`complexity policy schema_version must be ${SCHEMA_VERSION}`);
  if (!policy.line_budgets || !policy.surface_ceiling) throw new ConfigError("complexity policy missing budgets or surface ceilings");
  if (!Array.isArray(owners.modules)) throw new ConfigError("owners map modules must be an array");
  return true;
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

function canonicalHash(value, volatileFields = []) {
  const volatile = new Set(volatileFields);
  function clean(item) {
    if (Array.isArray(item)) return item.map(clean);
    if (item && typeof item === "object") {
      return Object.fromEntries(Object.keys(item).filter((key) => !volatile.has(key)).sort().map((key) => [key, clean(item[key])]));
    }
    if (typeof item === "string") return item.replace(/\r\n/g, "\n");
    return item;
  }
  return sha256(stableJson(clean(value)));
}

function hashFile(filePath) {
  const text = fs.readFileSync(filePath, "utf8").replace(/\r\n/g, "\n");
  try {
    return canonicalHash(JSON.parse(text), ["generated_at", "timestamp", "ts", "time", "manifest_hash"]);
  } catch (_) {
    return sha256(text);
  }
}

function ownersHash(owners) { return canonicalHash(owners); }
function policyHash(policy) { return canonicalHash(policy); }

function ownerModules(owners) {
  return owners.modules.map((item) => ({
    ...item,
    normalized_path: normalizeRepoPath(item.path, { keepDirectory: item.path.endsWith("/") }),
  })).sort((left, right) => right.normalized_path.length - left.normalized_path.length || left.normalized_path.localeCompare(right.normalized_path));
}

function ownerFindings(owners) {
  const findings = [];
  const seen = new Map();
  for (const item of ownerModules(owners)) {
    if (seen.has(item.normalized_path)) {
      findings.push(finding(
        "MH_COMPLEXITY_OWNER_PATH_DUPLICATE",
        "BLOCK",
        `duplicate owner path: ${item.normalized_path}`,
        toSlash(OWNERS_FILE),
      ));
    }
    seen.set(item.normalized_path, item);
  }
  return findings;
}

function moduleBudget(relative, policy, owners) {
  const normalized = normalizeRepoPath(relative);
  const owner = ownerModules(owners).find((item) => {
    const base = item.normalized_path;
    if (base.endsWith("/")) return normalized.startsWith(base);
    return normalized === base;
  });
  if (Number.isInteger(owner?.budget_lines)) return { category: owner.risk || "owner", maxLines: owner.budget_lines };
  if (/^bin\/[^/]+\.js$/.test(normalized)) return { category: "bin_entrypoint", maxLines: policy.line_budgets.bin_entrypoint };
  if (/^lib\/commands\/[^/]+\.js$/.test(normalized)) return { category: "command_module", maxLines: policy.line_budgets.command_module };
  if (/^tests\//.test(normalized)) return { category: "test", maxLines: policy.line_budgets.test };
  return { category: "source", maxLines: policy.line_budgets.source };
}

function moduleBudgetSnapshot(sourceFiles, policy, owners) {
  return sourceFiles.map((file) => {
    const budget = moduleBudget(file.relative, policy, owners);
    return {
      relative: file.relative,
      lines: file.lines,
      max_lines: budget.maxLines,
      budget_category: budget.category,
      overbudget: file.lines > budget.maxLines,
    };
  });
}

function importFindings(sourceFiles) {
  const findings = [];
  for (const file of sourceFiles) {
    const source = normalizeRepoPath(file.relative);
    for (const item of scanImports(file.text)) {
      if (item.dynamic && !item.specifier) {
        findings.push(finding("MH_COMPLEXITY_DYNAMIC_IMPORT_UNRESOLVED", "WARN", `${source} uses unresolved dynamic import`, source));
        continue;
      }
      const specifier = item.specifier || "";
      if (specifier.startsWith("#") || !specifier.startsWith(".")) continue;
      const target = path.posix.normalize(path.posix.join(path.posix.dirname(source), specifier));
      if (source.startsWith("lib/commands/") && target.startsWith("bin/")) {
        findings.push(finding("MH_COMPLEXITY_REVERSE_IMPORT", "BLOCK", `${source} imports bin/ code`, source));
      } else if (source.startsWith("lib/") && target.startsWith("bin/")) {
        findings.push(finding("MH_COMPLEXITY_REVERSE_IMPORT", "BLOCK", `${source} imports bin/ code`, source));
      } else if (source.startsWith("lib/") && !source.startsWith("lib/commands/") && target.startsWith("lib/commands/")) {
        findings.push(finding("MH_COMPLEXITY_REVERSE_IMPORT", "BLOCK", `${source} imports lib/commands/ code`, source));
      }
    }
  }
  return findings;
}

function commandSurface(policy, registry = commandRegistry()) {
  const commands = registry.filter((item) => item.public && !item.alias_of && !item.deprecated && !item.internal).map((item) => item.name).sort();
  const max = policy.surface_ceiling.max_cli_commands;
  const findings = commands.length > max
    ? [finding("MH_COMPLEXITY_CLI_COMMAND_COUNT_WARN", "WARN", `public CLI command count ${commands.length} exceeds ${max}`)]
    : [];
  return { count: commands.length, max, commands, findings };
}

function checkIdSurface(policy, registry = checkIdRegistry()) {
  const entries = registry.slice().sort((left, right) => left.id.localeCompare(right.id));
  const ids = entries.filter((item) => item.public !== false).map((item) => item.id);
  const seen = new Set();
  const findings = [];
  for (const id of ids) {
    if (seen.has(id)) findings.push(finding("MH_COMPLEXITY_DUPLICATE_CHECK_ID", "BLOCK", `duplicate check ID: ${id}`));
    seen.add(id);
    if (!/^MH_[A-Z0-9_]+_\d{3}$/.test(id) || !RESERVED_CHECK_PREFIXES.some((prefix) => id.startsWith(prefix))) {
      findings.push(finding("MH_COMPLEXITY_INVALID_CHECK_ID_NAMESPACE", "BLOCK", `invalid check ID namespace: ${id}`));
    }
  }
  const max = policy.surface_ceiling.max_check_ids_global_warn;
  if (ids.length > max) findings.push(finding("MH_COMPLEXITY_CHECK_ID_COUNT_WARN", "WARN", `check ID count ${ids.length} exceeds ${max}`));
  return { count: ids.length, max, ids, findings };
}

function templateSurface(rootPath, policy) {
  const files = [];
  for (const directory of [path.join("templates", "contracts"), path.join("templates", "skills")]) {
    const fullDir = path.join(rootPath, directory);
    if (!fs.existsSync(fullDir)) continue;
    for (const name of fs.readdirSync(fullDir).sort()) {
      const filePath = path.join(fullDir, name);
      if (fs.statSync(filePath).isFile()) files.push({ relative: toSlash(path.join(directory, name)), hash: hashFile(filePath) });
    }
  }
  const findings = [];
  const max = policy.surface_ceiling.max_template_count;
  if (files.length > max) findings.push(finding("MH_COMPLEXITY_TEMPLATE_COUNT_WARN", "WARN", `template count ${files.length} exceeds ${max}`));
  const allow = new Set(policy.duplicate_template_allowlist || []);
  const byHash = new Map();
  for (const file of files) {
    const previous = byHash.get(file.hash);
    if (previous) {
      const key = [previous.relative, file.relative].sort().join("=");
      const allowed = allow.has(key);
      findings.push(finding(
        allowed ? "MH_COMPLEXITY_TEMPLATE_DUPLICATE_ALLOWLISTED" : "MH_COMPLEXITY_TEMPLATE_DUPLICATE",
        allowed ? "WARN" : "BLOCK",
        `duplicate template content: ${previous.relative} and ${file.relative}`,
        file.relative,
      ));
    }
    byHash.set(file.hash, file);
  }
  return { count: files.length, max, files: files.map((file) => file.relative), findings };
}

function walkPaths(rootPath, currentPath = rootPath, state = { findings: [], caseMap: new Map() }) {
  for (const name of fs.readdirSync(currentPath).sort()) {
    const fullPath = path.join(currentPath, name);
    const relative = toSlash(path.relative(rootPath, fullPath));
    const stat = fs.lstatSync(fullPath);
    const lower = relative.toLowerCase();
    state.caseMap.set(lower, [...(state.caseMap.get(lower) || []), relative]);
    if (stat.isSymbolicLink()) {
      try {
        const real = fs.realpathSync(fullPath);
        const relReal = path.relative(rootPath, real);
        if (relReal.startsWith("..") || path.isAbsolute(relReal)) {
          state.findings.push(finding("MH_COMPLEXITY_SYMLINK_OUTSIDE_ROOT", "BLOCK", `symlink points outside repo root: ${relative}`, relative));
        }
      } catch (error) {
        const id = error.code === "ELOOP" ? "MH_COMPLEXITY_SYMLINK_LOOP" : "MH_COMPLEXITY_SYMLINK_OUTSIDE_ROOT";
        state.findings.push(finding(id, "BLOCK", `symlink cannot be resolved: ${relative}`, relative));
      }
      continue;
    }
    if (stat.isDirectory() && !EXCLUDED_DIRS.has(name) && !EXCLUDED_DIRS.has(relative)) walkPaths(rootPath, fullPath, state);
  }
  return state;
}

function pathFindings(rootPath) {
  const state = walkPaths(rootPath);
  for (const variants of state.caseMap.values()) {
    const unique = [...new Set(variants)];
    if (unique.length > 1 && unique.some((item) => /^(\.github|\.meta-harness|bin|lib|templates|docs\/architecture)\//.test(item))) {
      state.findings.push(finding("MH_COMPLEXITY_PATH_CASE_COLLISION", "WARN", `case-colliding paths: ${unique.join(", ")}`));
    }
  }
  return state.findings;
}

function codeownersPath(rootPath) {
  return [path.join(".github", "CODEOWNERS"), "CODEOWNERS", path.join("docs", "CODEOWNERS")]
    .map((candidate) => path.join(rootPath, candidate))
    .find((candidate) => fs.existsSync(candidate));
}

function parseCodeowners(text) {
  const rules = [];
  const diagnostics = [];
  text.split(/\r?\n/).forEach((line, index) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return;
    const parts = trimmed.split(/\s+/);
    if (parts.length < 2 || parts[0].startsWith("!") || /[\[\]]/.test(parts[0])) {
      diagnostics.push({ line: index + 1, message: "invalid CODEOWNERS line skipped" });
      return;
    }
    rules.push({ pattern: parts[0], owners: parts.slice(1), line: index + 1 });
  });
  return { rules, diagnostics };
}

function codeownersMatches(pattern, relative) {
  const normalized = pattern.replace(/^\//, "");
  if (normalized === "*") return true;
  if (normalized.endsWith("/")) return relative === normalized.slice(0, -1) || relative.startsWith(normalized);
  if (normalized.includes("*")) {
    const escaped = normalized.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
    return new RegExp(`^${escaped}$`).test(relative);
  }
  return relative === normalized || relative.startsWith(`${normalized}/`);
}

function codeownersFindings(rootPath, owners) {
  const filePath = codeownersPath(rootPath);
  if (!filePath) return [finding("MH_COMPLEXITY_CODEOWNERS_DRIFT", "WARN", "CODEOWNERS file missing")];
  const parsed = parseCodeowners(fs.readFileSync(filePath, "utf8"));
  const findings = parsed.diagnostics.map((item) => finding("MH_COMPLEXITY_CODEOWNERS_INVALID", "WARN", `${item.message} at line ${item.line}`, toSlash(path.relative(rootPath, filePath))));
  for (const item of ownerModules(owners).filter((entry) => CONTROLLED_RISKS.has(entry.risk))) {
    const relative = item.normalized_path.replace(/\/$/, "");
    const match = parsed.rules.filter((rule) => codeownersMatches(rule.pattern, relative)).at(-1);
    if (!match) findings.push(finding("MH_COMPLEXITY_CODEOWNERS_DRIFT", "WARN", `CODEOWNERS does not cover owner path: ${item.normalized_path}`, toSlash(OWNERS_FILE)));
  }
  return findings;
}

function generatedFindings(rootPath, policy) {
  const findings = [];
  for (const item of policy.generated_files || []) {
    if (!item?.path || !item.do_not_edit_manually) continue;
    const relative = normalizeRepoPath(item.path);
    const filePath = path.join(rootPath, relative);
    if (fs.existsSync(filePath) && item.generated_hash && hashFile(filePath) !== item.generated_hash) {
      findings.push(finding("MH_COMPLEXITY_SOURCE_GENERATED_BOUNDARY", "WARN", `generated file hash changed: ${relative}`, relative));
    }
  }
  return findings;
}

function currentSourceCommit(rootPath) {
  try {
    return execSync("git rev-parse HEAD", { cwd: rootPath, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch (_) {
    return null;
  }
}

function isGitClean(rootPath) {
  try {
    return execSync("git status --porcelain", { cwd: rootPath, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim() === "";
  } catch (_) {
    return true;
  }
}

function validateDecisionId(rootPath, decisionId) {
  if (!/^D\d{3,}$/.test(String(decisionId || ""))) return false;
  const decisionLog = path.join(rootPath, "docs", "product", "decision-log.md");
  if (fs.existsSync(decisionLog) && fs.readFileSync(decisionLog, "utf8").includes(decisionId)) return true;
  const inbox = path.join(rootPath, ".meta-harness", "decisions.json");
  if (fs.existsSync(inbox) && fs.readFileSync(inbox, "utf8").includes(decisionId)) return true;
  return false;
}

function baselineHash(baseline) {
  const clone = { ...baseline };
  delete clone.new_baseline_hash;
  return canonicalHash(clone);
}

function baselineComplexitySnapshot(complexity) {
  return {
    schema_version: SCHEMA_VERSION,
    module_budgets: Object.fromEntries((complexity.module_budgets || []).map((file) => [
      file.relative,
      { lines: file.lines, overbudget: file.overbudget, max_lines: file.max_lines, budget_category: file.budget_category },
    ])),
    surfaces: complexity.surfaces,
  };
}

function compareComplexityToBaseline(complexity, baseline) {
  const findings = [...(complexity.findings || [])];
  if (!baseline.complexity?.module_budgets) {
    findings.push(finding("MH_COMPLEXITY_LEGACY_BASELINE_METADATA", "MIGRATION_NEEDED", "quality baseline missing Phase 9 complexity metadata"));
    return findings;
  }
  if (baseline.new_baseline_hash && baselineHash(baseline) !== baseline.new_baseline_hash && !baseline.manual_override_decision) {
    findings.push(finding("MH_COMPLEXITY_BASELINE_TAMPER", "BLOCK", "quality baseline hash does not match metadata"));
  }
  const previous = baseline.complexity.module_budgets || {};
  for (const file of complexity.module_budgets || []) {
    const old = previous[file.relative];
    if (!old && file.overbudget) findings.push(finding("MH_COMPLEXITY_MODULE_BUDGET_NEW", "BLOCK", `new module budget violation: ${file.relative}`, file.relative));
    else if (old?.overbudget && file.lines > old.lines) findings.push(finding("MH_COMPLEXITY_MODULE_BUDGET_GREW", "BLOCK", `grandfathered module debt grew: ${file.relative} ${old.lines} -> ${file.lines}`, file.relative));
    else if (old && !old.overbudget && file.overbudget) findings.push(finding("MH_COMPLEXITY_MODULE_BUDGET_CROSSED", "BLOCK", `file crossed module budget: ${file.relative}`, file.relative));
  }
  return findings;
}

function renderComplexityFindings(findings = []) {
  return findings.map((item) => `- [${item.severity}] ${item.id}: ${item.message}`).join("\n");
}

function analyzeComplexity(rootPath, options = {}) {
  const policyResult = loadComplexityPolicy(rootPath, options.harnessDir || ".meta-harness");
  const ownersResult = loadOwnersMap(rootPath);
  const policy = policyResult.policy;
  const owners = ownersResult.owners;
  validateComplexityConfig(policy, owners);
  const findings = [];
  if (policyResult.missing) findings.push(finding("MH_COMPLEXITY_LEGACY_BASELINE_METADATA", "MIGRATION_NEEDED", `${COMPLEXITY_POLICY_FILE} missing`));
  if (ownersResult.missing) findings.push(finding("MH_COMPLEXITY_LEGACY_BASELINE_METADATA", "MIGRATION_NEEDED", `${OWNERS_FILE} missing`));
  if (ownersResult.legacy) findings.push(finding("MH_COMPLEXITY_LEGACY_BASELINE_METADATA", "MIGRATION_NEEDED", `${OWNERS_FILE} missing schema_version`));

  const modules = moduleBudgetSnapshot(options.sourceFiles || [], policy, owners);
  const commandInfo = commandSurface(policy, options.commandRegistry || commandRegistry());
  const checkInfo = checkIdSurface(policy, options.checkIdRegistry || checkIdRegistry());
  const templateInfo = templateSurface(rootPath, policy);
  findings.push(
    ...ownerFindings(owners),
    ...importFindings(options.sourceFiles || []),
    ...commandInfo.findings,
    ...checkInfo.findings,
    ...templateInfo.findings,
    ...pathFindings(rootPath),
    ...codeownersFindings(rootPath, owners),
    ...generatedFindings(rootPath, policy),
  );

  return {
    schema_version: SCHEMA_VERSION,
    policy_hash: policyHash(policy),
    owners_hash: ownersHash(owners),
    adopted: Boolean(policy.complexity_adopted_at),
    module_budgets: modules,
    surfaces: {
      cli_commands: { count: commandInfo.count, max: commandInfo.max, commands: commandInfo.commands },
      check_ids: { count: checkInfo.count, max: checkInfo.max, ids: checkInfo.ids },
      templates: { count: templateInfo.count, max: templateInfo.max, files: templateInfo.files },
    },
    findings,
  };
}

module.exports = {
  SCHEMA_VERSION,
  analyzeComplexity,
  baselineComplexitySnapshot,
  baselineHash,
  canonicalHash,
  compareComplexityToBaseline,
  currentSourceCommit,
  defaultComplexityPolicy,
  isGitClean,
  loadComplexityPolicy,
  loadOwnersMap,
  renderComplexityFindings,
  validateComplexityConfig,
  validateDecisionId,
  _test: { parseCodeowners, scanImports, normalizeRepoPath },
};
