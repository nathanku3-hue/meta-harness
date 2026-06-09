"use strict";

const { UsageError } = require("./errors");
const { validateOwnedPath } = require("./packet-rules");

const DEFAULT_SUBAGENT_FORBIDDEN_PATHS = [".env", "provider-config/*", "user-worktree/*"];
const DEFAULT_SUBAGENT_REQUIRED_EVIDENCE = [
  "dirty state snapshot",
  "scope diff gate result",
  "test output",
  "PM brief",
];
const DEFAULT_SUBAGENT_STOP_RULE = "Stop if outside-scope or credential/provider/runtime dirt appears.";
const DEFAULT_SUBAGENT_RETURN_SCHEMA = "PM brief + artifact paths + decision inbox entries only.";

const READ_ONLY_SCOUT_ALLOWED_COMMANDS = ["read_file", "list_dir", "grep_search"];
const DEFAULT_SCOUT_FORBIDDEN_PATHS = [
  ".env",
  ".env.*",
  "secrets",
  "secrets/*",
  "credentials",
  "credentials/*",
  "credentials.json",
  "provider-config",
  "provider-config/*",
  "runtime",
  "runtime/*",
  "data",
  "data/*",
  "data-output",
  "data-output/*",
  ".meta-harness/local",
  ".meta-harness/local/*",
];
const DEFAULT_SCOUT_STOP_RULE = "return findings after scanning; do not attempt fixes";
const DEFAULT_SCOUT_RETURN_SCHEMA = Object.freeze({
  findings: [
    {
      path: "",
      issue: "",
      severity: "block|warn|info",
    },
  ],
  summary: "",
  check_ids_referenced: [],
});
const DEFAULT_SCOUT_CONTEXT_BUDGET_KB = 100;
const DEFAULT_SCOUT_FILE_LIMIT = 50;
const DEFAULT_SCOUT_TIMEOUT_SECONDS = 120;

const SCOUT_ROLE_CONFIG = Object.freeze({
  "repo-scout": Object.freeze({
    task: "map template adoption state for target repo",
    requiredEvidence: ["findings list with severity", "file count", "template/state check results"],
    checkIdsReferenced: ["MH_SYNC_001", "MH_STATE_001", "MH_TRUST_001", "MH_CONTRACT_001"],
  }),
  "security-scout": Object.freeze({
    task: "check security posture without reading secrets or runtime data",
    requiredEvidence: ["findings list with severity", "file count", "security posture check results"],
    checkIdsReferenced: ["MH_SECURITY_001", "MH_PACKAGE_001", "MH_GITHUB_SETTINGS_001"],
  }),
  "test-scout": Object.freeze({
    task: "find coverage gaps, regression paths, and oversized test files",
    requiredEvidence: ["findings list with severity", "file count", "test and quality check results"],
    checkIdsReferenced: ["MH_QUALITY_001", "MH_TEST_001", "MH_READY_001"],
  }),
});

function fail(message) {
  throw new UsageError(message);
}

function uniqueStrings(values) {
  const seen = new Set();
  const result = [];
  for (const value of values) {
    if (typeof value !== "string" || value.trim().length === 0) {
      continue;
    }
    const normalized = value.trim();
    if (!seen.has(normalized)) {
      seen.add(normalized);
      result.push(normalized);
    }
  }
  return result;
}

function rejectRawLogReturnSchema(returnSchema) {
  const text = String(returnSchema || "");
  const forbidden = [
    /raw\s+(chat\s+)?logs?/i,
    /chat\s+logs?/i,
    /conversation\s+logs?/i,
    /raw\s+transcripts?/i,
    /chat\s+transcripts?/i,
    /conversation\s+transcripts?/i,
    /command\s+transcripts?/i,
    /full\s+transcripts?/i,
    /private\s+transcripts?/i,
  ];
  if (forbidden.some((pattern) => pattern.test(text))) {
    fail("subagent return schema must exclude raw logs and private transcripts");
  }
}

function validatePositiveInteger(value, name) {
  if (!Number.isInteger(value) || value <= 0) {
    fail(`${name} must be a positive integer`);
  }
  return value;
}

function normalizeScoutRole(role) {
  if (typeof role !== "string" || !SCOUT_ROLE_CONFIG[role]) {
    fail(`unknown read-only scout role: ${role || "<missing>"}`);
  }
  return role;
}

function cloneScoutReturnSchema() {
  return {
    findings: DEFAULT_SCOUT_RETURN_SCHEMA.findings.map((item) => ({ ...item })),
    summary: DEFAULT_SCOUT_RETURN_SCHEMA.summary,
    check_ids_referenced: [...DEFAULT_SCOUT_RETURN_SCHEMA.check_ids_referenced],
  };
}

function buildSubagentPacket(input) {
  const {
    cwd,
    goal = "Answer the single expert packet question.",
    ownedPaths = [],
    copiedSafeOwnedPaths = [],
    forbiddenPaths = DEFAULT_SUBAGENT_FORBIDDEN_PATHS,
    requiredEvidence = DEFAULT_SUBAGENT_REQUIRED_EVIDENCE,
    stopRule = DEFAULT_SUBAGENT_STOP_RULE,
    returnSchema = DEFAULT_SUBAGENT_RETURN_SCHEMA,
  } = input;

  if (!cwd) {
    fail("subagent packet requires cwd");
  }

  rejectRawLogReturnSchema(returnSchema);

  const sourceOwnedPaths = ownedPaths.length > 0 ? ownedPaths : copiedSafeOwnedPaths;
  const safeOwnedPaths = uniqueStrings(sourceOwnedPaths).map((item) => validateOwnedPath(cwd, item));

  return {
    goal,
    owned_paths: uniqueStrings(safeOwnedPaths),
    forbidden_paths: uniqueStrings(forbiddenPaths),
    required_evidence: uniqueStrings(requiredEvidence),
    stop_rule: stopRule,
    return_schema: returnSchema,
  };
}

function buildScoutPacket(input) {
  const {
    cwd,
    role,
    ownedPaths = [],
    forbiddenPaths = DEFAULT_SCOUT_FORBIDDEN_PATHS,
    allowedCommands = READ_ONLY_SCOUT_ALLOWED_COMMANDS,
    contextBudgetKb = DEFAULT_SCOUT_CONTEXT_BUDGET_KB,
    fileLimit = DEFAULT_SCOUT_FILE_LIMIT,
    timeoutSeconds = DEFAULT_SCOUT_TIMEOUT_SECONDS,
  } = input || {};

  if (!cwd) {
    fail("scout packet requires cwd");
  }

  const normalizedRole = normalizeScoutRole(role);
  const roleConfig = SCOUT_ROLE_CONFIG[normalizedRole];
  const safeOwnedPaths = uniqueStrings(ownedPaths).map((item) => validateOwnedPath(cwd, item));
  const normalizedAllowedCommands = uniqueStrings(allowedCommands);

  if (normalizedAllowedCommands.some((command) => !READ_ONLY_SCOUT_ALLOWED_COMMANDS.includes(command))) {
    fail("read-only scout packets may only use read_file, list_dir, and grep_search");
  }

  const normalizedContextBudgetKb = validatePositiveInteger(contextBudgetKb, "contextBudgetKb");
  const normalizedFileLimit = validatePositiveInteger(fileLimit, "fileLimit");
  const normalizedTimeoutSeconds = validatePositiveInteger(timeoutSeconds, "timeoutSeconds");

  return {
    role: normalizedRole,
    task: roleConfig.task,
    owned_paths: safeOwnedPaths,
    forbidden_paths: uniqueStrings(forbiddenPaths),
    allowed_commands: normalizedAllowedCommands,
    write_access: false,
    required_evidence: uniqueStrings(roleConfig.requiredEvidence),
    stop_rule: DEFAULT_SCOUT_STOP_RULE,
    context_budget: `max ${normalizedFileLimit} files or ${normalizedContextBudgetKb}KB context`,
    context_budget_kb: normalizedContextBudgetKb,
    timeout_seconds: normalizedTimeoutSeconds,
    return_schema: cloneScoutReturnSchema(),
    check_ids_referenced: [...roleConfig.checkIdsReferenced],
  };
}

module.exports = {
  DEFAULT_SCOUT_CONTEXT_BUDGET_KB,
  DEFAULT_SCOUT_FILE_LIMIT,
  DEFAULT_SCOUT_FORBIDDEN_PATHS,
  DEFAULT_SCOUT_RETURN_SCHEMA,
  DEFAULT_SCOUT_STOP_RULE,
  DEFAULT_SCOUT_TIMEOUT_SECONDS,
  DEFAULT_SUBAGENT_FORBIDDEN_PATHS,
  DEFAULT_SUBAGENT_REQUIRED_EVIDENCE,
  DEFAULT_SUBAGENT_RETURN_SCHEMA,
  DEFAULT_SUBAGENT_STOP_RULE,
  READ_ONLY_SCOUT_ALLOWED_COMMANDS,
  SCOUT_ROLE_CONFIG,
  buildScoutPacket,
  buildSubagentPacket,
  rejectRawLogReturnSchema,
};
