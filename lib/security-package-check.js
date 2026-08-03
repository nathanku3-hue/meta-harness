"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { isNodeRangeSupported } = require("./package-root");
const { workflowFiles } = require("./security-workflow-check");

const FORBIDDEN_PACKAGE_PATTERNS = [
  /^\.meta-harness\/local(\/|$)/,
  /^\.meta-harness\/snapshots(\/|$)/,
  /^\.meta-harness\/expert-packets(\/|$)/,
  /^\.meta-harness\/workers(\/|$)/,
  /^\.meta-harness\/runs(\/|$)/,
  /^\.env($|\/)/,
  /(^|\/)secrets?($|[.\-/])/i,
  /(^|\/)credentials?($|[.\-/])/i,
  /^provider-config(\/|$)/,
  /^runtime(\/|$)/,
  /^data(\/|$)/,
  /^demo(\/|$)/
];

function normalizePath(value) {
  return value.split(/[\\/]+/).join("/");
}

function subcheck(id, name, status, reason = "", nextAction = "", applicable) {
  const result = { id, name, status, reason, next_action: nextAction };
  if (applicable !== undefined) result.applicable = applicable;
  return result;
}

function fileExists(root, relativePath) {
  return fs.existsSync(path.join(root, relativePath));
}

function readText(root, relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function readJson(root, relativePath) {
  return JSON.parse(readText(root, relativePath));
}

function linesWithoutComments(text) {
  return text
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line && !line.startsWith("#"));
}

function packageUnavailable(id, name, packageRoot, packageResolution) {
  if (packageResolution?.error) {
    return subcheck(id, name, "fail", packageResolution.error, "Pass --package-root <relative-path> to select one package");
  }
  if (!packageRoot) {
    return subcheck(id, name, "skip", "no Node package found", "", false);
  }
  return null;
}

function checkPackageMetadata(root, options = {}) {
  const unavailable = packageUnavailable("SEC_PACKAGE_META_001", "package_metadata", root, options.packageResolution);
  if (unavailable) return unavailable;
  if (!fileExists(root, "package.json")) {
    return subcheck("SEC_PACKAGE_META_001", "package_metadata", "skip", "no package.json found", "", false);
  }
  let pkg;
  try {
    pkg = readJson(root, "package.json");
  } catch (error) {
    return subcheck("SEC_PACKAGE_META_001", "package_metadata", "fail", `package.json is invalid JSON: ${error.message}`, "Fix package.json");
  }
  const missing = [];
  for (const key of ["license", "repository", "bin", "files", "engines", "packageManager"]) {
    if (!pkg[key]) missing.push(key);
  }
  if (!pkg.engines || !pkg.engines.node || !isNodeRangeSupported(pkg.engines.node)) missing.push("engines.node>=20");
  if (!pkg.packageManager || !pkg.packageManager.startsWith("npm@")) missing.push("packageManager npm@...");
  if (!pkg.devEngines || !pkg.devEngines.runtime || pkg.devEngines.runtime.name !== "node") missing.push("devEngines.runtime");
  if (!pkg.devEngines || !pkg.devEngines.packageManager || pkg.devEngines.packageManager.name !== "npm") missing.push("devEngines.packageManager");
  if (!Array.isArray(pkg.files) || pkg.files.length === 0) missing.push("files[]");
  if (missing.length > 0) {
    return subcheck("SEC_PACKAGE_META_001", "package_metadata", "fail", `package metadata missing: ${Array.from(new Set(missing)).join(", ")}`, "Add license, repository, bin, files, engines, packageManager, and devEngines metadata");
  }
  return subcheck("SEC_PACKAGE_META_001", "package_metadata", "pass");
}

function isPackageLockIgnored(root) {
  if (!fileExists(root, ".gitignore")) return false;
  return linesWithoutComments(readText(root, ".gitignore")).some(line =>
    line === "package-lock.json" ||
    line === "/package-lock.json" ||
    line === "**/package-lock.json" ||
    line === "*.json" ||
    line === "**/*.json"
  );
}

function checkReproducibility(root, options = {}) {
  const unavailable = packageUnavailable("SEC_REPRO_001", "reproducibility", root, options.packageResolution);
  if (unavailable) return unavailable;
  if (!fileExists(root, "package.json")) {
    return subcheck("SEC_REPRO_001", "reproducibility", "skip", "no package.json found", "", false);
  }

  const reasons = [];
  if (!fileExists(root, "package-lock.json")) {
    reasons.push("package-lock.json missing");
  } else {
    try {
      const lock = readJson(root, "package-lock.json");
      if (!lock.lockfileVersion) reasons.push("package-lock.json lacks lockfileVersion");
      if (lock.lockfileVersion && lock.lockfileVersion < 3) reasons.push(`lockfileVersion must be >=3 (found ${lock.lockfileVersion})`);
    } catch (error) {
      reasons.push(`package-lock.json invalid JSON: ${error.message}`);
    }
  }
  if (isPackageLockIgnored(root)) reasons.push("package-lock.json is ignored");

  const repositoryRoot = options.repositoryRoot || root;
  const workflows = workflowFiles(repositoryRoot);
  const workflowTexts = workflows.map(file => readText(repositoryRoot, file)).join("\n");
  if (/\bnpm\s+install\b/.test(workflowTexts)) reasons.push("workflow uses npm install instead of npm ci");
  if (workflows.length === 0 || !/\bnpm\s+ci\b/.test(workflowTexts)) reasons.push("workflow does not use npm ci");

  if (reasons.length > 0) {
    return subcheck("SEC_REPRO_001", "reproducibility", "fail", reasons.join(", "), "Commit package-lock.json and ensure CI installs dependencies with npm ci");
  }
  return subcheck("SEC_REPRO_001", "reproducibility", "pass");
}

function checkPackageDryRun(root, noExec, options = {}) {
  const unavailable = packageUnavailable("SEC_PACKAGE_CONTENTS_001", "package_contents", root, options.packageResolution);
  if (unavailable) return unavailable;
  if (!fileExists(root, "package.json")) {
    return subcheck("SEC_PACKAGE_CONTENTS_001", "package_contents", "skip", "no package.json found", "", false);
  }
  if (noExec) {
    return subcheck("SEC_PACKAGE_CONTENTS_001", "package_contents", "skip", "package dry-run skipped in no-exec mode");
  }

  const npmExecPath = process.env.npm_execpath;
  const npmCliPath = path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js");
  const command = (npmExecPath || fs.existsSync(npmCliPath)) ? process.execPath : (process.platform === "win32" ? "npm.cmd" : "npm");
  const args = npmExecPath
    ? [npmExecPath, "pack", "--dry-run", "--json", "--ignore-scripts"]
    : (fs.existsSync(npmCliPath) ? [npmCliPath, "pack", "--dry-run", "--json", "--ignore-scripts"] : ["pack", "--dry-run", "--json", "--ignore-scripts"]);

  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    timeout: 30000,
    maxBuffer: 10 * 1024 * 1024,
    shell: process.platform === "win32" && command === "npm.cmd"
  });

  if ((result.error && result.error.code === "ETIMEDOUT") || result.signal === "SIGTERM") {
    return subcheck("SEC_PACKAGE_CONTENTS_001", "package_contents", "fail", "npm pack dry-run timed out", "Validate package contents manually");
  }
  if (result.status !== 0) {
    return subcheck("SEC_PACKAGE_CONTENTS_001", "package_contents", "fail", `npm pack failed: ${result.stderr || result.error?.message || "unknown failure"}`, "Ensure npm pack --dry-run succeeds");
  }

  let packData;
  try {
    packData = JSON.parse(result.stdout);
  } catch (error) {
    return subcheck("SEC_PACKAGE_CONTENTS_001", "package_contents", "fail", `npm pack JSON parse failed: ${error.message}`, "Inspect npm pack output");
  }

  const pack = Array.isArray(packData) ? packData[0] : packData;
  const files = (pack.files || []).map(file => normalizePath(file.path || ""));
  const leaks = files.filter(file => FORBIDDEN_PACKAGE_PATTERNS.some(pattern => pattern.test(file)));
  if (leaks.length > 0) {
    return subcheck("SEC_PACKAGE_CONTENTS_001", "package_contents", "fail", `forbidden package paths included: ${leaks.join(", ")}`, "Update package files list or npm ignore rules");
  }
  return subcheck("SEC_PACKAGE_CONTENTS_001", "package_contents", "pass");
}

function inspectLifecycleScripts(root, options = {}) {
  const unavailable = packageUnavailable("SEC_NPM_LIFECYCLE_001", "npm_lifecycle_scripts", root, options.packageResolution);
  if (unavailable) return { ...unavailable, failedHooks: [], packHooks: [], warnedHooks: [] };
  if (!fileExists(root, "package.json")) {
    return { status: "skip", reason: "no package.json found", next_action: "", applicable: false, failedHooks: [], packHooks: [], warnedHooks: [] };
  }

  const pkg = readJson(root, "package.json");
  const scripts = pkg.scripts || {};
  const failedHooks = ["preinstall", "install", "postinstall"].filter((hook) => scripts[hook]);
  const packHooks = ["prepare", "prepack", "postpack"].filter((hook) => scripts[hook]);
  const warnedHooks = [];
  const allowedPrepublishOnly = new Set([
    "node bin/meta-harness.js release check --publish --json",
    "node ./bin/meta-harness.js release check --publish --json",
    "meta-harness release check --publish --json"
  ]);
  for (const hook of ["publish", "postpublish", "prepublish", "prepublishOnly"]) {
    if (!scripts[hook]) continue;
    const normalized = String(scripts[hook]).trim().replace(/\s+/g, " ");
    if (hook === "prepublishOnly" && allowedPrepublishOnly.has(normalized)) continue;
    warnedHooks.push(hook);
  }
  return { failedHooks, packHooks, warnedHooks };
}

function checkLifecycleScripts(root, mode = "local", options = {}) {
  const result = inspectLifecycleScripts(root, options);
  if (result.status) return result;
  if (result.failedHooks.length > 0) {
    return subcheck(
      "SEC_NPM_LIFECYCLE_001",
      "npm_lifecycle_scripts",
      "fail",
      `risky npm lifecycle scripts found: ${result.failedHooks.join(", ")}`,
      "Audit or remove pre/postinstall hooks"
    );
  }
  if (result.packHooks.length > 0) {
    return subcheck(
      "SEC_NPM_LIFECYCLE_001",
      "npm_lifecycle_scripts",
      mode === "local" ? "warn" : "fail",
      `npm pack execution hooks found: ${result.packHooks.join(", ")}`,
      "Audit pack lifecycle scripts before running package dry-run"
    );
  }
  if (result.warnedHooks.length > 0) {
    return subcheck(
      "SEC_NPM_LIFECYCLE_001",
      "npm_lifecycle_scripts",
      "warn",
      `lifecycle scripts with security concerns: ${result.warnedHooks.join(", ")}`,
      "Review lifecycle script hooks for execution risks"
    );
  }
  return subcheck("SEC_NPM_LIFECYCLE_001", "npm_lifecycle_scripts", "pass");
}

module.exports = {
  checkLifecycleScripts,
  checkPackageDryRun,
  checkPackageMetadata,
  checkReproducibility,
  inspectLifecycleScripts,
};
