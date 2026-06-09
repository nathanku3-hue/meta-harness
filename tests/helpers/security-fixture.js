"use strict";

const fs = require("node:fs");
const path = require("node:path");

function writeFile(root, relativePath, content) {
  const filePath = path.join(root, ...relativePath.split("/"));
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf8");
}

function mergePackageJson(root) {
  const pkgPath = path.join(root, "package.json");
  const pkg = fs.existsSync(pkgPath) ? JSON.parse(fs.readFileSync(pkgPath, "utf8")) : {
    name: "dummy-target",
    version: "1.0.0",
    scripts: {}
  };
  pkg.license = pkg.license || "MIT";
  pkg.repository = pkg.repository || { type: "git", url: "https://example.com/dummy-target.git" };
  pkg.bin = pkg.bin || { [pkg.name || "dummy-target"]: "bin/dummy.js" };
  pkg.files = pkg.files || ["bin/", "lib/", "README.md"];
  pkg.engines = pkg.engines || { node: ">=20" };
  pkg.packageManager = pkg.packageManager || "npm@11.16.0";
  pkg.devEngines = pkg.devEngines || {
    runtime: { name: "node", version: ">=20", onFail: "error" },
    packageManager: { name: "npm", version: ">=10.9.0", onFail: "error" }
  };
  fs.writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`, "utf8");
  writeFile(root, "bin/dummy.js", "#!/usr/bin/env node\n");
  writeFile(root, "README.md", "# Dummy target\n");
}

function writePhase5SecurityFixture(root) {
  mergePackageJson(root);
  writeFile(root, "SECURITY.md", [
    "# Security Policy",
    "",
    "## Reporting Vulnerabilities",
    "",
    "Report security vulnerabilities by opening a private security advisory in this repository.",
    "",
    "Do not open public issues for security vulnerabilities.",
    "",
    "## Credential Rotation",
    "",
    "Rotate leaked credentials immediately.",
    "",
    "## Agent Security Boundaries",
    "",
    "Agents must not read .env files or write secrets into harness outputs.",
    ""
  ].join("\n"));
  writeFile(root, ".github/CODEOWNERS", [
    "/.github/           @nathanku3-hue",
    "/SECURITY.md        @nathanku3-hue",
    "/bin/               @nathanku3-hue",
    "/lib/               @nathanku3-hue",
    "/templates/         @nathanku3-hue",
    "/.meta-harness/security-policy.json @nathanku3-hue",
    "/docs/architecture/owners.json @nathanku3-hue",
    "/package.json       @nathanku3-hue",
    "/package-lock.json  @nathanku3-hue",
    ""
  ].join("\n"));
  writeFile(root, ".github/dependabot.yml", [
    "version: 2",
    "updates:",
    "  - package-ecosystem: \"npm\"",
    "    directory: \"/\"",
    "    schedule:",
    "      interval: \"weekly\"",
    "  - package-ecosystem: \"github-actions\"",
    "    directory: \"/\"",
    "    schedule:",
    "      interval: \"weekly\"",
    ""
  ].join("\n"));
  writeFile(root, ".github/workflows/ci.yml", [
    "name: CI",
    "on:",
    "  pull_request:",
    "permissions:",
    "  contents: read",
    "jobs:",
    "  test:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - uses: actions/checkout@34e114876b0b11c390a56381ad16ebd13914f8d5",
    "      - run: npm ci",
    ""
  ].join("\n"));
  writeFile(root, ".gitignore", [
    ".env",
    ".env.*",
    "!.env.example",
    "*.pem",
    "*.key",
    "credentials.json",
    "secrets.*",
    "*.secret",
    "*.token",
    ".npmrc",
    ".meta-harness/local/locks/",
    ".meta-harness/local/",
    ".meta-harness/*.lock",
    ".meta-harness/**/*.lock",
    ""
  ].join("\n"));
  writeFile(root, ".meta-harness/security-policy.json", JSON.stringify({
    version: 1,
    secrets_in_prompts: "forbidden",
    secrets_in_packets: "forbidden",
    secrets_in_briefs: "forbidden",
    secrets_in_events: "forbidden",
    workflow_secrets: "forbidden",
    workflow_permissions_default: "contents:read",
    action_pinning: "full-sha-required-for-remote-actions",
    local_actions: "allowed",
    reusable_workflows: "classified",
    pull_request_target: "forbidden-unless-gated",
    workflow_run: "forbidden-unless-gated",
    self_hosted_runners: "forbidden-unless-approved",
    private_vulnerability_reporting: "api-verified",
    dependabot_version_updates: "required",
    dependabot_security_updates: "api-verified",
    dependabot_alerts: "api-verified",
    dependency_graph: "api-verified",
    codeowners_file: "required",
    codeowners_enforcement: "api-verified",
    subagent_default_access: "read-only",
    skill_permission_expansion: "decision-required",
    dependency_addition: "decision-required",
    credential_rotation_on_leak: "immediate",
    npm_lockfile: "required",
    npm_ci_in_workflows: "required",
    npm_lifecycle_scripts: "checked",
    redaction_surfaces: [".meta-harness/events.jsonl", ".meta-harness/workers/"],
    deferred_hardening: ["Dependency Review Action before release automation"]
  }, null, 2) + "\n");
  writeFile(root, "docs/architecture/owners.json", JSON.stringify({
    version: 1,
    modules: [
      { path: "README.md", owner: "nathanku3-hue", risk: "docs" },
      { path: ".github/", owner: "nathanku3-hue", risk: "security" }
    ]
  }, null, 2) + "\n");
}

module.exports = {
  writePhase5SecurityFixture
};
