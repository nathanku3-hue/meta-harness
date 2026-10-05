"use strict";

const path = require("node:path");

const { HARNESS_DIR } = require("./paths");

const CONTEXT_LOCAL_DIR = path.join(HARNESS_DIR, "local", "context");
const CONTEXT_TRACKED_DIR = path.join(HARNESS_DIR, "context");
const ROUND_PATTERN = /^ROUND-([0-9]{3,})$/;
const ARTIFACT_PATTERN = /^ROUND-([0-9]{3,})\.json$/;
const DEFAULT_MAX_ARTIFACT_AGE_DAYS = 7;

const DIMENSIONS = Object.freeze([
  "product_outcome",
  "scope_boundary",
  "repo_and_stack",
  "owned_surface",
  "evidence_plan",
  "risk_and_stop_rules",
  "freshness",
  "handoff_completeness",
]);

const ALLOWED_TRANSITIONS = Object.freeze([
  "intake->plan",
  "plan->work",
  "work->verify",
  "verify->synthesize",
  "synthesize->handoff",
  "handoff->lookback",
]);

const REQUIRED_GATE_TRANSITIONS = new Set([
  "intake->plan",
  "plan->work",
  "work->verify",
  "verify->synthesize",
]);

const OPTIONAL_GATE_TRANSITIONS = new Set([
  "synthesize->handoff",
  "handoff->lookback",
]);

const BYPASS_REASON_CODES = Object.freeze([
  "time_pressure",
  "known_gap_accepted",
  "human_override",
  "infra_failure",
]);

const EXECUTION_TRANSITIONS = new Set(["plan->work", "work->verify"]);
const VALID_VERDICTS = new Set(["blocked", "narrowed", "proceed", "excellent"]);

module.exports = {
  ALLOWED_TRANSITIONS,
  ARTIFACT_PATTERN,
  BYPASS_REASON_CODES,
  CONTEXT_LOCAL_DIR,
  CONTEXT_TRACKED_DIR,
  DEFAULT_MAX_ARTIFACT_AGE_DAYS,
  DIMENSIONS,
  EXECUTION_TRANSITIONS,
  OPTIONAL_GATE_TRANSITIONS,
  REQUIRED_GATE_TRANSITIONS,
  ROUND_PATTERN,
  VALID_VERDICTS,
};
