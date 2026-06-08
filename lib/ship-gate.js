"use strict";

const path = require("node:path");
const { UsageError } = require("./errors");
const { makeClassifyCurrentChangeSet, parseStatusZ } = require("./ship-gate/current-change-set");
const {
  ALLOWED_DIRTY_ACTIONS,
  ALLOWED_DIRTY_STATUSES,
  ARCHITECTURE_PATHS,
  CONTROL_PLANE_PATHS,
  CREDENTIAL_PATTERNS,
  DEFAULT_CLOCK_SKEW_MS,
  DEFAULT_DIRTY_MAX_AGE_MS,
  DOMAIN_PATHS,
  PACKAGE_RELEASE_PATHS,
  RUNTIME_PROVIDER_PATHS,
  SECURITY_PATHS,
  SHIP_TIERS,
  SHIPGATE_CHECK_ID,
  TASK_RESOLUTIONS,
  WORKFLOW_PATH_PREFIX,
} = require("./ship-gate-constants");

const TIER_RANK = new Map(SHIP_TIERS.map((tier, index) => [tier, index]));

class ShipGateUnavailableError extends Error {
  constructor(message) {
    super(message);
    this.name = "ShipGateUnavailableError";
  }
}

function isPlainObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function bool(value) {
  if (value === true) return true;
  if (value === false || value === undefined || value === null) return false;
  return ["1", "true", "yes", "y"].includes(String(value).trim().toLowerCase());
}

function normalizePath(value) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new UsageError("ship gate path must be a non-empty string");
  }
  if (value.includes("\0")) {
    throw new UsageError("ship gate path must not contain NUL bytes");
  }
  const normalized = value.replace(/\\/g, "/").replace(/^\.\//, "");
  if (path.posix.isAbsolute(normalized) || /^[A-Za-z]:\//.test(normalized)) {
    throw new UsageError(`ship gate path must be repository-relative: ${value}`);
  }
  if (normalized.split("/").includes("..")) {
    throw new UsageError(`ship gate path must not traverse outside the repository: ${value}`);
  }
  return normalized;
}

function uniqueSorted(values) {
  return [...new Set(values.filter(Boolean))].sort((left, right) => left.localeCompare(right));
}

function pathStartsWith(filePath, patterns) {
  return patterns.some((pattern) => {
    const normalized = normalizePattern(pattern);
    return filePath === normalized || filePath.startsWith(normalized);
  });
}

function normalizePattern(pattern) {
  return String(pattern).replace(/\\/g, "/").replace(/^\.\//, "");
}

function pathMatches(filePath, patterns = []) {
  return patterns.some((pattern) => {
    const normalized = normalizePattern(pattern);
    if (normalized.endsWith("*")) return filePath.startsWith(normalized.slice(0, -1));
    if (normalized.endsWith("/")) return filePath.startsWith(normalized);
    return filePath === normalized || filePath.startsWith(`${normalized}/`);
  });
}

function isCredentialPath(filePath) {
  const lower = filePath.toLowerCase();
  return CREDENTIAL_PATTERNS.some((pattern) => {
    const normalized = pattern.toLowerCase();
    return lower === normalized || lower.includes(normalized);
  });
}

function isWorkflowPath(filePath) {
  return filePath.startsWith(WORKFLOW_PATH_PREFIX);
}

function isSecurityPath(filePath) {
  return pathStartsWith(filePath, SECURITY_PATHS);
}

function isDomainPath(filePath) {
  return pathStartsWith(filePath, DOMAIN_PATHS);
}

function isRuntimeProviderPath(filePath) {
  return pathStartsWith(filePath, RUNTIME_PROVIDER_PATHS);
}

function isArchitecturePath(filePath) {
  return pathStartsWith(filePath, ARCHITECTURE_PATHS);
}

function isPackageReleasePath(filePath) {
  return pathMatches(filePath, PACKAGE_RELEASE_PATHS);
}

function isControlPlanePath(filePath) {
  return pathStartsWith(filePath, CONTROL_PLANE_PATHS);
}

function isDocsPath(filePath) {
  return filePath.endsWith(".md") && (filePath.startsWith("docs/") || filePath === "README.md");
}

function isTestPath(filePath) {
  return filePath.startsWith("tests/") || /\.test\.[cm]?js$/.test(filePath) || filePath.endsWith(".spec.js");
}

function isOwnedPath(filePath, ownedPaths) {
  return pathMatches(filePath, ownedPaths);
}

function checkStatus(options = {}) {
  const explicit = options.checks_status || options.checksStatus || options.test_status || options.testStatus;
  if (explicit) {
    const normalized = String(explicit).trim().toLowerCase();
    if (["pass", "passed", "ok", "true"].includes(normalized)) return "pass";
    if (["fail", "failed", "false"].includes(normalized)) return "fail";
    return "unknown";
  }
  if (options.checks_passed === true || options.checksPassed === true || options.tests_passed === true || options.testsPassed === true) return "pass";
  if (options.checks_failed === true || options.checksFailed === true || options.tests_failed === true || options.testsFailed === true) return "fail";
  return "unknown";
}

function normalizeResult(tier, resolution, reasons, paths, decisionRequired = undefined) {
  const normalizedTier = SHIP_TIERS.includes(tier) ? tier : "BLOCK";
  const normalizedResolution = TASK_RESOLUTIONS.includes(resolution) ? resolution : "blocked";
  const changedPaths = uniqueSorted(paths.map(normalizePath));
  const sortedReasons = uniqueSorted(reasons.map((reason) => String(reason).trim()).filter(Boolean));
  return {
    tier: normalizedTier,
    resolution: normalizedResolution,
    reasons: sortedReasons,
    changed_paths: changedPaths,
    decision_required: decisionRequired === undefined
      ? normalizedTier === "SLOW" && normalizedResolution === "decision-needed"
      : Boolean(decisionRequired),
  };
}

function higherTier(left, right) {
  return TIER_RANK.get(right) > TIER_RANK.get(left) ? right : left;
}

function applyChecks(tier, baseResolution, reasons, options) {
  const status = checkStatus(options);
  if (status === "pass") {
    return { resolution: baseResolution, reasons };
  }
  if (status === "fail") {
    return {
      resolution: "blocked",
      reasons: [...reasons, "checks failed; task cannot ship until validation passes"],
    };
  }
  if (baseResolution === "ship") {
    return {
      resolution: "follow-up-queued",
      reasons: [...reasons, "checks are unknown; route follow-up validation before shipping"],
    };
  }
  return { resolution: baseResolution, reasons };
}

function classifyPath(filePath, options = {}) {
  const normalized = normalizePath(filePath);
  const ownedPaths = options.owned_paths || options.ownedPaths || [];

  if (isCredentialPath(normalized)) {
    return { tier: "BLOCK", reason: `${normalized}: credential or secret path requires blocker remediation` };
  }
  if (isWorkflowPath(normalized)) {
    return { tier: "SLOW", reason: `${normalized}: workflow change requires decision review` };
  }
  if (isSecurityPath(normalized)) {
    return { tier: "SLOW", reason: `${normalized}: security posture change requires decision review` };
  }
  if (isDomainPath(normalized)) {
    return { tier: "SLOW", reason: `${normalized}: domain-governed change requires decision review` };
  }
  if (isRuntimeProviderPath(normalized)) {
    return { tier: "SLOW", reason: `${normalized}: runtime/provider/data boundary requires decision review` };
  }
  if (isArchitecturePath(normalized)) {
    return { tier: "SLOW", reason: `${normalized}: architecture boundary requires decision review` };
  }
  if (isPackageReleasePath(normalized)) {
    return { tier: "SLOW", reason: `${normalized}: package or release surface requires decision review` };
  }
  if (isControlPlanePath(normalized)) {
    return { tier: "SLOW", reason: `${normalized}: control-plane surface requires decision review` };
  }
  if (isTestPath(normalized)) {
    return { tier: "REVIEW", reason: `${normalized}: owned test/code change routes through review` };
  }
  if (isDocsPath(normalized)) {
    if (ownedPaths.length === 0 || !isOwnedPath(normalized, ownedPaths)) {
      return { tier: "REVIEW", reason: `${normalized}: docs path is not proven owned, so fast path is withheld` };
    }
    return { tier: "FAST", reason: `${normalized}: docs-only owned path` };
  }
  if (ownedPaths.length > 0 && isOwnedPath(normalized, ownedPaths)) {
    return { tier: "REVIEW", reason: `${normalized}: owned code path routes through review` };
  }
  return { tier: "SLOW", reason: `${normalized}: unowned or uncategorized path requires decision review` };
}

function metadataTier(options = {}) {
  const blockFlags = [
    "credentials_touched",
    "credentialsTouched",
    "security_boundary_expanded",
    "securityBoundaryExpanded",
    "workflow_permission_increase",
    "workflowPermissionIncrease",
    "secrets_inherited",
    "secretsInherited",
    "pull_request_target_added",
    "pullRequestTargetAdded",
    "workflow_untrusted_input_to_agent_or_script",
    "workflowUntrustedInputToAgentOrScript",
    "workflow_untrusted_input_flow",
    "workflowUntrustedInputFlow",
    "workflow_agent_prompt_input",
    "workflowAgentPromptInput",
    "workflow_script_injection_risk",
    "workflowScriptInjectionRisk",
  ];
  for (const flag of blockFlags) {
    if (bool(options[flag])) {
      return { tier: "BLOCK", reason: `${flag}: security boundary cannot self-approve` };
    }
  }

  const slowFlags = [
    "provider_access_touched",
    "providerAccessTouched",
    "runtime_or_data_output_touched",
    "runtimeOrDataOutputTouched",
    "data_output_created",
    "dataOutputCreated",
    "domain_or_architecture_touched",
    "domainOrArchitectureTouched",
    "package_or_release_touched",
    "packageOrReleaseTouched",
  ];
  for (const flag of slowFlags) {
    if (bool(options[flag])) {
      return { tier: "SLOW", reason: `${flag}: boundary-touching work requires decision review` };
    }
  }
  return undefined;
}

function resolutionForTier(tier) {
  if (tier === "BLOCK") return "blocked";
  if (tier === "SLOW") return "decision-needed";
  return "ship";
}

function classifyPaths(paths, options = {}) {
  const changedPaths = uniqueSorted((paths || []).map(normalizePath));
  const meta = metadataTier(options);
  let tier = meta?.tier || "FAST";
  const reasons = meta ? [meta.reason] : [];

  for (const changedPath of changedPaths) {
    const pathResult = classifyPath(changedPath, options);
    tier = higherTier(tier, pathResult.tier);
    reasons.push(pathResult.reason);
  }

  if (changedPaths.length === 0 && !meta) {
    reasons.push("no current changed paths found");
  }

  const checked = applyChecks(tier, resolutionForTier(tier), reasons, options);
  return normalizeResult(tier, checked.resolution, checked.reasons, changedPaths);
}

function classifyDirtyItem(item) {
  if (!isPlainObject(item)) {
    throw new UsageError("dirty classification item must be an object");
  }
  const action = String(item.action || "");
  if (!ALLOWED_DIRTY_ACTIONS.has(action)) {
    throw new UsageError(`dirty classification action is invalid: ${action || "missing"}`);
  }
  const status = String(item.status || "");
  if (status && !ALLOWED_DIRTY_STATUSES.has(status)) {
    throw new UsageError(`dirty classification status is invalid: ${status}`);
  }
  const paths = [item.path];
  if (item.original_path) paths.push(item.original_path);
  return {
    action,
    paths: paths.map(normalizePath),
    classification: String(item.classification || action),
    reason: String(item.reason || item.classification || action),
  };
}

function validateDirtyFreshness(dirty, options = {}) {
  const maxAgeMs = Number(options.max_age_ms || options.maxAgeMs || DEFAULT_DIRTY_MAX_AGE_MS);
  const clockSkewMs = Number(options.clock_skew_ms || options.clockSkewMs || DEFAULT_CLOCK_SKEW_MS);
  const expiresAfter = dirty.expires_after || dirty.expiresAfter;
  const generatedAt = dirty.generated_at || dirty.generatedAt;

  if (!generatedAt) {
    throw new UsageError("dirty classification missing generated_at");
  }
  const generatedTime = Date.parse(generatedAt);
  if (!Number.isFinite(generatedTime)) {
    throw new UsageError("dirty classification generated_at is not parseable");
  }
  const now = Date.now();
  if (generatedTime - now > clockSkewMs) {
    throw new UsageError("dirty classification generated_at is in the future");
  }
  if (expiresAfter !== undefined) {
    const expiresTime = Date.parse(expiresAfter);
    if (!Number.isFinite(expiresTime)) {
      throw new UsageError("dirty classification expires_after is not parseable");
    }
    if (now > expiresTime) {
      throw new UsageError("dirty classification has expired");
    }
  } else if (Number.isFinite(maxAgeMs) && maxAgeMs >= 0 && now - generatedTime > maxAgeMs) {
    throw new UsageError("dirty classification is stale");
  }
}

function validateDirtyResult(dirty, options = {}) {
  if (!isPlainObject(dirty)) {
    throw new UsageError("dirty classification must be a JSON object");
  }
  if (dirty.schema_version !== undefined && dirty.schema_version !== "1.0.0") {
    throw new UsageError(`unsupported dirty classification schema_version: ${dirty.schema_version}`);
  }
  if (dirty.v !== undefined && dirty.v !== 1) {
    throw new UsageError(`unsupported dirty classification version: ${dirty.v}`);
  }
  if (dirty.schema_version === undefined && dirty.v === undefined) {
    throw new UsageError("dirty classification missing schema_version");
  }
  if (dirty.redacted !== undefined && dirty.redacted !== true) {
    throw new UsageError("dirty classification redacted flag must be true");
  }
  if (options.targetRoot && dirty.target) {
    const expected = path.resolve(options.targetRoot).split(path.sep).join("/");
    const actual = path.resolve(dirty.target).split(path.sep).join("/");
    if (actual !== expected) {
      throw new UsageError(`dirty classification target mismatch: ${actual} != ${expected}`);
    }
  }
  validateDirtyFreshness(dirty, options);
  if (!Array.isArray(dirty.classifications)) {
    throw new UsageError("dirty classification missing classifications array");
  }
  return dirty.classifications.map(classifyDirtyItem);
}

function classifyDirtyResult(dirty, options = {}) {
  const items = validateDirtyResult(dirty, options);
  let tier = "FAST";
  let resolution = "ship";
  const reasons = [];
  const paths = [];
  let onlyQueue = items.length > 0;

  for (const item of items) {
    paths.push(...item.paths);
    if (item.action !== "QUEUE") onlyQueue = false;
    if (item.action === "QUEUE") {
      reasons.push(`${item.paths.join(", ")}: queued dirty evidence retained (${item.classification})`);
      continue;
    }
    if (item.action === "PASS") {
      const pathResult = classifyPaths(item.paths, options);
      tier = higherTier(tier, pathResult.tier);
      reasons.push(...pathResult.reasons);
      continue;
    }
    if (item.action === "DECISION" || item.action === "ESCALATE") {
      tier = higherTier(tier, "SLOW");
      reasons.push(`${item.paths.join(", ")}: ${item.action} requires decision review (${item.classification})`);
      continue;
    }
    if (item.action === "BLOCK") {
      tier = higherTier(tier, "BLOCK");
      reasons.push(`${item.paths.join(", ")}: blocker requires remediation (${item.classification})`);
    }
  }

  if (onlyQueue) {
    resolution = "follow-up-queued";
  } else {
    resolution = resolutionForTier(tier);
  }

  const checked = applyChecks(tier, resolution, reasons, options);
  return normalizeResult(tier, checked.resolution, checked.reasons, paths);
}

function classifyWorkerReport(report = {}) {
  const options = isPlainObject(report) ? report : {};
  const meta = metadataTier(options);
  const paths = [
    ...(Array.isArray(options.changed_paths) ? options.changed_paths : []),
    ...(Array.isArray(options.changedPaths) ? options.changedPaths : []),
  ];
  let result = classifyPaths(paths, options);
  let tier = meta ? higherTier(result.tier, meta.tier) : result.tier;
  const reasons = [...result.reasons];
  if (meta) reasons.push(meta.reason);

  const outcome = String(options.outcome || "").trim().toUpperCase();
  const requested = String(options.requested_work_type || options.requestedWorkType || "").trim();
  const actual = String(options.actual_work_type || options.actualWorkType || "").trim();

  if (outcome === "REJECTED") {
    tier = higherTier(tier, "BLOCK");
    reasons.push("worker report outcome is REJECTED");
  } else if (outcome === "PARTIAL_WITH_EXPLICIT_SCOPE") {
    tier = higherTier(tier, "SLOW");
    reasons.push("worker report outcome is PARTIAL_WITH_EXPLICIT_SCOPE");
  } else if (outcome === "DONE") {
    if (actual === "docs" && requested === "docs") {
      tier = higherTier(tier, "FAST");
      reasons.push("worker report completed docs-only work");
    } else if (["code", "test"].includes(actual) || ["code", "test"].includes(requested)) {
      tier = higherTier(tier, "REVIEW");
      reasons.push("worker report completed code/test work");
    } else if (["provider_probe", "execution", "data_output"].includes(actual) || ["provider_probe", "execution", "data_output"].includes(requested)) {
      tier = higherTier(tier, "SLOW");
      reasons.push("worker report completed boundary-touching execution work");
    }
  }

  const checked = applyChecks(tier, resolutionForTier(tier), reasons, options);
  return normalizeResult(tier, checked.resolution, checked.reasons, paths);
}

const classifyCurrentChangeSet = makeClassifyCurrentChangeSet({
  classifyPaths,
  higherTier,
  normalizePath,
  normalizeResult,
  ShipGateUnavailableError,
  UsageError,
});

module.exports = {
  DEFAULT_CLOCK_SKEW_MS,
  DEFAULT_DIRTY_MAX_AGE_MS,
  SHIP_TIERS,
  SHIPGATE_CHECK_ID,
  TASK_RESOLUTIONS,
  ShipGateUnavailableError,
  classifyCurrentChangeSet,
  classifyDirtyResult,
  classifyPaths,
  classifyWorkerReport,
  normalizePath,
  validateDirtyResult,
  _test: { parseStatusZ },
};
