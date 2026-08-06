"use strict";

const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_TIMEOUT_SECONDS = 300;

function unsupported(reason) {
  return Object.freeze({
    supported: false,
    reason,
    validation: Object.freeze([]),
  });
}

function placeholderTestScript(script) {
  const normalized = String(script).replace(/\s+/g, " ").trim().toLowerCase();
  return normalized.includes("error: no test specified") && /(?:^|[;&|]\s*)exit\s+1(?:\s|$)/.test(normalized);
}

function isInsideRoot(root, targetPath) {
  const relative = path.relative(root, targetPath);
  return relative === ""
    || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function nearestPackagePath(root, allowedPath) {
  let current = path.resolve(root, allowedPath);
  if (!isInsideRoot(root, current)) return null;

  while (!fs.existsSync(current)) {
    if (current === root) return null;
    const parent = path.dirname(current);
    if (parent === current || !isInsideRoot(root, parent)) return null;
    current = parent;
  }

  const currentStat = fs.lstatSync(current);
  if (currentStat.isSymbolicLink()) return null;
  if (currentStat.isFile()) current = path.dirname(current);
  else if (!currentStat.isDirectory()) return null;

  while (isInsideRoot(root, current)) {
    const packagePath = path.join(current, "package.json");
    if (fs.existsSync(packagePath)) return packagePath;
    if (current === root) break;
    current = path.dirname(current);
  }
  return null;
}

function readTestScript(packagePath) {
  let stat;
  try {
    stat = fs.lstatSync(packagePath);
  } catch {
    return { error: "Selected package.json is unreadable." };
  }
  if (!stat.isFile() || stat.isSymbolicLink()) {
    return { error: "Selected package.json must be a regular non-symlink file." };
  }

  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(packagePath, "utf8"));
  } catch {
    return { error: "Selected package.json is not valid JSON." };
  }
  const script = manifest?.scripts?.test;
  if (typeof script !== "string" || script.trim() === "") {
    return { error: "Selected package.json has no non-empty scripts.test command." };
  }
  if (placeholderTestScript(script)) {
    return { error: "Selected package.json scripts.test is the npm placeholder failure." };
  }
  return { script };
}

function validationCwd(root, packagePath) {
  const relative = path.relative(root, path.dirname(packagePath));
  return relative ? relative.split(path.sep).join("/") : ".";
}

function resolveGoalValidation(repositoryPath, allowedPaths = ["."]) {
  const root = path.resolve(repositoryPath);
  const scope = Array.isArray(allowedPaths) && allowedPaths.length > 0 ? allowedPaths : ["."];
  const packagePaths = scope.map((allowedPath) => nearestPackagePath(root, allowedPath));
  if (packagePaths.some((packagePath) => !packagePath)) {
    return unsupported("No package.json was found between every allowed path and the repository root.");
  }

  const uniquePackages = [...new Set(packagePaths.map((packagePath) => path.resolve(packagePath)))];
  if (uniquePackages.length !== 1) {
    return unsupported("Allowed paths resolve to multiple package.json files; validation is ambiguous.");
  }

  const packagePath = uniquePackages[0];
  const selected = readTestScript(packagePath);
  if (selected.error) return unsupported(selected.error);

  const cwd = validationCwd(root, packagePath);
  return Object.freeze({
    supported: true,
    reason: cwd === "."
      ? "Resolved repository package.json scripts.test through npm test."
      : `Resolved scope-nearest ${cwd}/package.json scripts.test through npm test.`,
    validation: Object.freeze([Object.freeze({
      argv: Object.freeze(["npm", "test"]),
      cwd,
      timeoutSeconds: DEFAULT_TIMEOUT_SECONDS,
    })]),
  });
}

module.exports = {
  DEFAULT_TIMEOUT_SECONDS,
  placeholderTestScript,
  resolveGoalValidation,
};
