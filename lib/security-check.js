"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { scanRedactionSurfaces } = require("./redaction-check");
const {
  checkWorkflowPermissions,
  checkWorkflowPinning,
  checkWorkflowRunners,
  checkWorkflowTriggers,
  checkWorkflowUntrustedInput
} = require("./security-workflow-check");
const {
  checkPackageDryRun,
  checkPackageMetadata,
  checkReproducibility
} = require("./security-package-check");

const OWNER = "@nathanku3-hue";

const CONTROL_PLANE_PATHS = [
  "/.github/",
  "/SECURITY.md",
  "/bin/",
  "/lib/",
  "/templates/",
  "/.meta-harness/security-policy.json",
  "/docs/architecture/owners.json",
  "/package.json",
  "/package-lock.json"
];

const REQUIRED_GITIGNORE_PATTERNS = [
  ".env",
  ".env.*",
  "*.pem",
  "*.key",
  "credentials.json",
  "secrets.*",
  "*.secret",
  "*.token",
  ".npmrc",
  ".meta-harness/local/locks/",
  ".meta-harness/*.lock",
  ".meta-harness/**/*.lock"
];

const REQUIRED_POLICY_KEYS = [
  "secrets_in_prompts",
  "secrets_in_packets",
  "secrets_in_briefs",
  "secrets_in_events",
  "workflow_secrets",
  "workflow_permissions_default",
  "action_pinning",
  "local_actions",
  "reusable_workflows",
  "pull_request_target",
  "workflow_run",
  "self_hosted_runners",
  "private_vulnerability_reporting",
  "dependabot_version_updates",
  "dependabot_security_updates",
  "dependabot_alerts",
  "dependency_graph",
  "codeowners_file",
  "codeowners_enforcement",
  "subagent_default_access",
  "skill_permission_expansion",
  "dependency_addition",
  "credential_rotation_on_leak",
  "npm_lockfile",
  "npm_ci_in_workflows",
  "npm_lifecycle_scripts",
  "redaction_surfaces",
  "deferred_hardening"
];

function fileExists(root, relativePath) {
  return fs.existsSync(path.join(root, relativePath));
}

function readText(root, relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function readJson(root, relativePath) {
  return JSON.parse(readText(root, relativePath));
}

function subcheck(id, name, status, reason = "", nextAction = "") {
  return { id, name, status, reason, next_action: nextAction };
}

function linesWithoutComments(text) {
  return text
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line && !line.startsWith("#"));
}

function checkSecurityMd(root) {
  if (!fileExists(root, "SECURITY.md")) {
    return subcheck("SEC_REPORTING_001", "security_reporting", "fail", "SECURITY.md missing", "Create SECURITY.md with reporting, rotation, and agent-boundary guidance");
  }

  const text = readText(root, "SECURITY.md");
  const missing = [];
  for (const phrase of [
    "Reporting Vulnerabilities",
    "private security advisory",
    "Credential Rotation",
    "Agent Security Boundaries"
  ]) {
    if (!text.includes(phrase)) missing.push(phrase);
  }
  if (/\[MAINTAINER_EMAIL\]|@MAINTAINER/.test(text)) {
    missing.push("no placeholders");
  }
  if (missing.length > 0) {
    return subcheck("SEC_REPORTING_001", "security_reporting", "fail", `SECURITY.md incomplete: ${missing.join(", ")}`, "Update SECURITY.md to remove placeholders and include required security sections");
  }
  return null;
}

function checkCodeownersFile(root) {
  if (!fileExists(root, ".github/CODEOWNERS")) {
    return subcheck("SEC_OWNER_FILE_001", "codeowners_file", "fail", ".github/CODEOWNERS missing", "Create CODEOWNERS for control-plane paths");
  }

  const text = readText(root, ".github/CODEOWNERS");
  if (/@MAINTAINER/.test(text)) {
    return subcheck("SEC_OWNER_FILE_001", "codeowners_file", "fail", "CODEOWNERS contains placeholder owner", `Replace placeholders with ${OWNER}`);
  }

  const entries = new Map();
  for (const line of linesWithoutComments(text)) {
    const [ownerPath, ...owners] = line.split(/\s+/);
    entries.set(ownerPath, owners);
  }

  const missing = CONTROL_PLANE_PATHS.filter(controlPath => {
    const owners = entries.get(controlPath);
    return !owners || !owners.includes(OWNER);
  });

  if (missing.length > 0) {
    return subcheck("SEC_OWNER_FILE_001", "codeowners_file", "fail", `CODEOWNERS does not cover: ${missing.join(", ")}`, "Add owner coverage for all control-plane paths");
  }
  return subcheck("SEC_OWNER_FILE_001", "codeowners_file", "pass");
}

function checkDependabotFile(root) {
  if (!fileExists(root, ".github/dependabot.yml")) {
    return subcheck("SEC_DEP_001", "dependabot_file", "fail", ".github/dependabot.yml missing", "Create Dependabot config for npm and github-actions");
  }
  const text = readText(root, ".github/dependabot.yml");
  const missing = [];
  if (!/package-ecosystem:\s*["']?npm["']?/.test(text)) missing.push("npm");
  if (!/package-ecosystem:\s*["']?github-actions["']?/.test(text)) missing.push("github-actions");
  if (!/interval:\s*["']?weekly["']?/.test(text)) missing.push("weekly schedule");
  if (missing.length > 0) {
    return subcheck("SEC_DEP_001", "dependabot_file", "fail", `Dependabot config missing: ${missing.join(", ")}`, "Configure weekly npm and github-actions updates");
  }
  return subcheck("SEC_DEP_001", "dependabot_file", "pass");
}

function checkGitignore(root) {
  if (!fileExists(root, ".gitignore")) {
    return subcheck("SEC_GITIGNORE_001", "gitignore", "fail", ".gitignore missing", "Create .gitignore with secret and scoped lock patterns");
  }
  const lines = linesWithoutComments(readText(root, ".gitignore"));
  const missing = REQUIRED_GITIGNORE_PATTERNS.filter(pattern => !lines.includes(pattern));
  if (missing.length > 0) {
    return subcheck("SEC_GITIGNORE_001", "gitignore", "fail", `.gitignore lacks patterns: ${missing.join(", ")}`, "Add secret and scoped lock patterns to .gitignore");
  }
  return subcheck("SEC_GITIGNORE_001", "gitignore", "pass");
}

function checkSecurityPolicy(root) {
  if (!fileExists(root, ".meta-harness/security-policy.json")) {
    return subcheck("SEC_POLICY_001", "security_policy", "fail", ".meta-harness/security-policy.json missing", "Create machine-readable security policy");
  }

  let policy;
  try {
    policy = readJson(root, ".meta-harness/security-policy.json");
  } catch (error) {
    return subcheck("SEC_POLICY_001", "security_policy", "fail", `security-policy.json is invalid JSON: ${error.message}`, "Fix security-policy.json");
  }

  const missing = REQUIRED_POLICY_KEYS.filter(key => policy[key] === undefined);
  if (policy.version !== 1) missing.push("version=1");
  if (!Array.isArray(policy.redaction_surfaces) || policy.redaction_surfaces.length === 0) missing.push("redaction_surfaces entries");
  if (!Array.isArray(policy.deferred_hardening) || !policy.deferred_hardening.some(item => /Dependency Review Action/i.test(item))) {
    missing.push("Dependency Review Action deferred hardening");
  }

  if (missing.length > 0) {
    return subcheck("SEC_POLICY_001", "security_policy", "fail", `security policy missing implemented boundaries: ${missing.join(", ")}`, "Represent every implemented security boundary in security-policy.json or explicitly defer it");
  }
  return subcheck("SEC_POLICY_001", "security_policy", "pass");
}

function checkRedaction(root) {
  const result = scanRedactionSurfaces({ targetRoot: root });
  if (result.status !== "PASS") {
    const first = result.findings.slice(0, 5).map(item => `${item.path}:${item.line}:${item.id}`).join(", ");
    return subcheck("SEC_REDACTION_001", "redaction", "fail", `secret-like output content detected: ${first}`, "Remove leaked secret-like content from harness outputs and rotate affected credentials");
  }
  return subcheck("SEC_REDACTION_001", "redaction", "pass");
}

async function fetchJson(url, token) {
  const response = await fetch(url, {
    headers: {
      "Authorization": `Bearer ${token}`,
      "Accept": "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "meta-harness-security-check"
    }
  });
  if (!response.ok) {
    const error = new Error(`GitHub API returned ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return response.json();
}

function settingStatus({ id, name, label, required, token, repo }) {
  if (!token || !repo) {
    return subcheck(id, name, required ? "fail" : "warn", `${label} setting not verified locally`, "Verify repository security settings with GitHub API access");
  }
  return null;
}

function securityFieldEnabled(repoData, candidates) {
  for (const candidate of candidates) {
    const parts = candidate.split(".");
    let current = repoData;
    for (const part of parts) {
      current = current?.[part];
    }
    if (current === "enabled" || current === true) {
      return true;
    }
  }
  return false;
}

async function checkGithubSettings({ root, mode, strictGithubSettings }) {
  const required = Boolean(strictGithubSettings || mode === "strict" || mode === "release");
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPOSITORY;
  const checks = [];

  const reportingLocal = checkSecurityMd(root);
  if (reportingLocal) {
    checks.push(reportingLocal);
  }

  const pending = [
    settingStatus({ id: "SEC_REPORTING_001", name: "security_reporting", label: "private vulnerability reporting", required, token, repo }),
    settingStatus({ id: "SEC_DEP_SETTINGS_001", name: "dependabot_settings", label: "Dependabot security", required, token, repo }),
    settingStatus({ id: "SEC_OWNER_ENFORCE_001", name: "codeowners_enforcement", label: "Code Owner review enforcement", required, token, repo })
  ].filter(Boolean);
  if (pending.length > 0) {
    return checks.concat(pending);
  }

  try {
    const repoData = await fetchJson(`https://api.github.com/repos/${repo}`, token);
    const security = repoData.security_and_analysis || {};

    const privateReporting = securityFieldEnabled(repoData, [
      "private_vulnerability_reporting.enabled",
      "security_and_analysis.private_vulnerability_reporting.status"
    ]);
    checks.push(subcheck(
      "SEC_REPORTING_001",
      "security_reporting",
      privateReporting ? "pass" : (required ? "fail" : "warn"),
      privateReporting ? "" : "private vulnerability reporting is not enabled or not visible to this token",
      "Enable private vulnerability reporting in repository settings"
    ));

    const dependabotAlerts = security.dependabot_alerts?.status === "enabled";
    const dependabotSecurity = security.dependabot_security_updates?.status === "enabled";
    const dependencyGraph = security.dependency_graph?.status === "enabled";
    const missing = [];
    if (!dependabotAlerts) missing.push("Dependabot alerts");
    if (!dependabotSecurity) missing.push("Dependabot security updates");
    if (!dependencyGraph) missing.push("dependency graph");
    checks.push(subcheck(
      "SEC_DEP_SETTINGS_001",
      "dependabot_settings",
      missing.length === 0 ? "pass" : (required ? "fail" : "warn"),
      missing.length === 0 ? "" : `${missing.join(", ")} not enabled or not visible to this token`,
      "Enable dependency graph, Dependabot alerts, and Dependabot security updates"
    ));

    let codeownersEnforced = false;
    try {
      const defaultBranch = repoData.default_branch || "main";
      const protection = await fetchJson(`https://api.github.com/repos/${repo}/branches/${encodeURIComponent(defaultBranch)}/protection`, token);
      codeownersEnforced = protection.required_pull_request_reviews?.require_code_owner_reviews === true;
    } catch (error) {
      codeownersEnforced = false;
    }
    checks.push(subcheck(
      "SEC_OWNER_ENFORCE_001",
      "codeowners_enforcement",
      codeownersEnforced ? "pass" : (required ? "fail" : "warn"),
      codeownersEnforced ? "" : "Code Owner review enforcement is not enabled or not visible to this token",
      "Enable Require review from Code Owners in branch protection or rulesets"
    ));
  } catch (error) {
    for (const [id, name, label] of [
      ["SEC_REPORTING_001", "security_reporting", "private vulnerability reporting"],
      ["SEC_DEP_SETTINGS_001", "dependabot_settings", "Dependabot security"],
      ["SEC_OWNER_ENFORCE_001", "codeowners_enforcement", "Code Owner review enforcement"]
    ]) {
      checks.push(subcheck(id, name, required ? "fail" : "warn", `${label} setting could not be verified: ${error.message}`, "Verify repository security settings with GitHub API access"));
    }
  }

  return checks;
}

function aggregateChecks(checks) {
  const failed = checks.filter(check => check.status === "fail");
  const warned = checks.filter(check => check.status === "warn" || check.status === "unknown");
  if (failed.length > 0) {
    return {
      status: "fail",
      reason: `security failures: ${failed.map(check => check.id).join(", ")}`,
      next_action: failed.map(check => check.next_action).filter(Boolean)[0] || "Fix security baseline failures",
      checks
    };
  }
  if (warned.length > 0) {
    return {
      status: "warn",
      reason: `security warnings: ${warned.map(check => check.id).join(", ")}`,
      next_action: warned.map(check => check.next_action).filter(Boolean)[0] || "Verify repository security settings",
      checks
    };
  }
  return { status: "pass", reason: "", next_action: "", checks };
}

async function checkSecurityBaseline({
  targetRoot,
  noExec = false,
  mode = "local",
  strictGithubSettings = false
} = {}) {
  const root = path.resolve(targetRoot || process.cwd());
  const checks = [
    checkCodeownersFile(root),
    checkDependabotFile(root),
    checkGitignore(root),
    checkSecurityPolicy(root),
    checkWorkflowPinning(root),
    checkWorkflowPermissions(root),
    checkWorkflowTriggers(root),
    checkWorkflowUntrustedInput(root),
    checkWorkflowRunners(root),
    checkPackageMetadata(root),
    checkReproducibility(root),
    checkPackageDryRun(root, noExec),
    checkRedaction(root)
  ];
  checks.push(...await checkGithubSettings({ root, mode, strictGithubSettings }));
  return aggregateChecks(checks);
}

module.exports = {
  checkSecurityBaseline
};
