"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
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

function subcheck(id, name, status, reason = "", nextAction = "") {
  return { id, name, status, reason, next_action: nextAction };
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

function checkPackageMetadata(root) {
  if (!fileExists(root, "package.json")) {
    return subcheck("SEC_PACKAGE_META_001", "package_metadata", "skip", "no package.json found");
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
  if (!pkg.engines || !pkg.engines.node || !pkg.engines.node.includes(">=20")) missing.push("engines.node>=20");
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

function checkReproducibility(root) {
  if (!fileExists(root, "package.json")) {
    return subcheck("SEC_REPRO_001", "reproducibility", "skip", "no package.json found");
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

  const workflows = workflowFiles(root);
  const workflowTexts = workflows.map(file => readText(root, file)).join("\n");
  if (/\bnpm\s+install\b/.test(workflowTexts)) reasons.push("workflow uses npm install instead of npm ci");
  if (workflows.length === 0 || !/\bnpm\s+ci\b/.test(workflowTexts)) reasons.push("workflow does not use npm ci");

  if (reasons.length > 0) {
    return subcheck("SEC_REPRO_001", "reproducibility", "fail", reasons.join(", "), "Commit package-lock.json and ensure CI installs dependencies with npm ci");
  }
  return subcheck("SEC_REPRO_001", "reproducibility", "pass");
}

function checkPackageDryRun(root, noExec) {
  if (!fileExists(root, "package.json")) {
    return subcheck("SEC_PACKAGE_CONTENTS_001", "package_contents", "skip", "no package.json found");
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

module.exports = {
  checkPackageDryRun,
  checkPackageMetadata,
  checkReproducibility
};
