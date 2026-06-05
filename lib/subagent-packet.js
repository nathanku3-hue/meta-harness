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

module.exports = {
  DEFAULT_SUBAGENT_FORBIDDEN_PATHS,
  DEFAULT_SUBAGENT_REQUIRED_EVIDENCE,
  DEFAULT_SUBAGENT_RETURN_SCHEMA,
  DEFAULT_SUBAGENT_STOP_RULE,
  buildSubagentPacket,
  rejectRawLogReturnSchema,
};
