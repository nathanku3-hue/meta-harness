"use strict";

const SHIP_TIERS = ["FAST", "REVIEW", "SLOW", "BLOCK"];
const TASK_RESOLUTIONS = ["ship", "blocked", "decision-needed", "follow-up-queued"];
const SHIPGATE_CHECK_ID = "MH_SHIPGATE_001";
const DEFAULT_DIRTY_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const DEFAULT_CLOCK_SKEW_MS = 5 * 60 * 1000;

const CREDENTIAL_PATTERNS = [
  ".env",
  ".env.",
  "secret",
  "secrets",
  "credential",
  "credentials",
  "token",
  ".npmrc",
  ".pem",
  ".key",
  ".p12",
  ".pfx",
];

const SECURITY_PATHS = [
  ".github/",
  "SECURITY.md",
  ".gitignore",
  ".gitattributes",
  ".meta-harness/security-policy.json",
];

const DOMAIN_PATHS = ["domain/", "lib/domain", "src/domain"];

const RUNTIME_PROVIDER_PATHS = [
  "provider-config/",
  "runtime/",
  "data/",
  "data-output/",
  "wrds/",
  "broker/",
  "scoring/",
  "dashboard-output/",
];

const ARCHITECTURE_PATHS = [
  "docs/architecture/",
  ".meta-harness/complexity-policy.json",
];

const PACKAGE_RELEASE_PATHS = [
  "package.json",
  "package-lock.json",
  "npm-shrinkwrap.json",
  ".npmrc",
  "CHANGELOG.md",
];

const CONTROL_PLANE_PATHS = [
  ".agents/",
  ".meta-harness/",
  "templates/",
  "bin/",
  "lib/commands/",
  "lib/ship-gate.js",
];

const WORKFLOW_PATH_PREFIX = ".github/workflows/";
const ALLOWED_DIRTY_ACTIONS = new Set(["PASS", "QUEUE", "DECISION", "BLOCK", "ESCALATE"]);
const ALLOWED_DIRTY_STATUSES = new Set(["??", "A ", " A", "M ", " M", "MM", "D ", " D", "R ", " R", "C ", " C", "AM", "AD", "RM", "before-only"]);

module.exports = {
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
};
