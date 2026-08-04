"use strict";

const fs = require("node:fs");
const path = require("node:path");

const { domainDigest, isDigest } = require("./contracts/digest");
const { ConfigError } = require("./errors");

const WORK_SESSION_SCHEMA = "work-session/v1";
const WORK_SESSION_DOMAIN = "meta-harness-work-session/v1";
const DIRTY_POLICIES = Object.freeze(new Set(["isolate", "continue-in-scope"]));
const TOP_KEYS = Object.freeze([
  "schemaVersion",
  "intent",
  "productResult",
  "journeyState",
  "doNow",
  "newlyTrueBehavior",
  "doneWhen",
  "stopOnlyIf",
  "authorizedReversibleActions",
  "ownerOnlyActions",
  "allowedPaths",
  "dirtyPolicy",
  "validation",
  "maxAttempts",
  "delivery",
  "sessionDigest",
]);

function fail(code, message, details) {
  throw new ConfigError(message, { code, details });
}

function plainObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    fail("MH_WORK_SESSION_SHAPE", `${label} must be a plain object`);
  }
  return value;
}

function exactKeys(value, expected, label) {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (JSON.stringify(actual) !== JSON.stringify(wanted)) {
    fail("MH_WORK_SESSION_SHAPE", `${label} has missing or unexpected fields`, { actual, expected: wanted });
  }
}

function nonEmptyString(value, label) {
  if (typeof value !== "string" || value.trim() === "") {
    fail("MH_WORK_SESSION_VALUE", `${label} must be a non-empty string`);
  }
  return value;
}

function stringList(value, label, { min = 0 } = {}) {
  if (!Array.isArray(value) || value.length < min) {
    fail("MH_WORK_SESSION_VALUE", `${label} must be an array with at least ${min} item(s)`);
  }
  const normalized = value.map((entry, index) => nonEmptyString(entry, `${label}[${index}]`));
  if (new Set(normalized).size !== normalized.length) {
    fail("MH_WORK_SESSION_VALUE", `${label} must not contain duplicates`);
  }
  return normalized;
}

function validRelativePath(value) {
  if (value === ".") return true;
  return typeof value === "string"
    && value.length > 0
    && !value.startsWith("/")
    && !value.includes("\\")
    && !value.split("/").some((part) => part === "" || part === "." || part === "..")
    && value !== ".git"
    && !value.startsWith(".git/");
}

function validateAllowedPaths(value) {
  const paths = stringList(value, "workSession.allowedPaths", { min: 1 });
  for (const allowedPath of paths) {
    if (!validRelativePath(allowedPath)) {
      fail("MH_WORK_SESSION_PATH", `invalid allowed path: ${allowedPath}`);
    }
  }
  return paths;
}

function validateIntent(value) {
  plainObject(value, "workSession.intent");
  exactKeys(value, ["version", "digest"], "workSession.intent");
  nonEmptyString(value.version, "workSession.intent.version");
  if (!isDigest(value.digest)) {
    fail("MH_WORK_SESSION_INTENT", "workSession.intent.digest must be sha256:<64 lowercase hex>");
  }
}

function validateCommand(value, index) {
  plainObject(value, `workSession.validation[${index}]`);
  exactKeys(value, ["argv", "cwd", "timeoutSeconds"], `workSession.validation[${index}]`);
  if (!Array.isArray(value.argv) || value.argv.length === 0 || value.argv.length > 200) {
    fail("MH_WORK_SESSION_VALIDATION", `validation[${index}].argv must contain 1-200 arguments`);
  }
  value.argv.forEach((entry, argIndex) => nonEmptyString(entry, `validation[${index}].argv[${argIndex}]`));
  if (value.cwd !== "." && !validRelativePath(value.cwd)) {
    fail("MH_WORK_SESSION_VALIDATION", `invalid validation cwd: ${value.cwd}`);
  }
  if (!Number.isInteger(value.timeoutSeconds) || value.timeoutSeconds < 1 || value.timeoutSeconds > 3600) {
    fail("MH_WORK_SESSION_VALIDATION", `validation[${index}].timeoutSeconds must be 1-3600`);
  }
}

function validateDelivery(value) {
  plainObject(value, "workSession.delivery");
  exactKeys(value, ["commit", "push"], "workSession.delivery");
  if (typeof value.commit !== "boolean" || typeof value.push !== "boolean") {
    fail("MH_WORK_SESSION_DELIVERY", "workSession.delivery.commit and push must be booleans");
  }
  if (value.push && !value.commit) {
    fail("MH_WORK_SESSION_DELIVERY", "workSession.delivery.push requires commit authority");
  }
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

function workSessionBody(value) {
  const body = JSON.parse(JSON.stringify(value));
  delete body.sessionDigest;
  return body;
}

function computeWorkSessionDigest(value) {
  return domainDigest(WORK_SESSION_DOMAIN, workSessionBody(value));
}

function validateWorkSession(value) {
  plainObject(value, "workSession");
  exactKeys(value, TOP_KEYS, "workSession");
  if (value.schemaVersion !== WORK_SESSION_SCHEMA) {
    fail("MH_WORK_SESSION_SCHEMA", `workSession.schemaVersion must be ${WORK_SESSION_SCHEMA}`);
  }
  validateIntent(value.intent);
  nonEmptyString(value.productResult, "workSession.productResult");
  nonEmptyString(value.journeyState, "workSession.journeyState");
  nonEmptyString(value.doNow, "workSession.doNow");
  nonEmptyString(value.newlyTrueBehavior, "workSession.newlyTrueBehavior");
  nonEmptyString(value.doneWhen, "workSession.doneWhen");
  stringList(value.stopOnlyIf, "workSession.stopOnlyIf", { min: 1 });
  stringList(value.authorizedReversibleActions, "workSession.authorizedReversibleActions", { min: 1 });
  stringList(value.ownerOnlyActions, "workSession.ownerOnlyActions", { min: 1 });
  validateAllowedPaths(value.allowedPaths);
  if (!DIRTY_POLICIES.has(value.dirtyPolicy)) {
    fail("MH_WORK_SESSION_DIRTY_POLICY", `dirtyPolicy must be one of: ${[...DIRTY_POLICIES].join(", ")}`);
  }
  if (!Array.isArray(value.validation)) {
    fail("MH_WORK_SESSION_VALIDATION", "workSession.validation must be an array");
  }
  value.validation.forEach(validateCommand);
  if (!Number.isInteger(value.maxAttempts) || value.maxAttempts < 1 || value.maxAttempts > 3) {
    fail("MH_WORK_SESSION_ATTEMPTS", "workSession.maxAttempts must be 1-3");
  }
  validateDelivery(value.delivery);
  if (!isDigest(value.sessionDigest) || value.sessionDigest !== computeWorkSessionDigest(value)) {
    fail("MH_WORK_SESSION_DIGEST", "workSession.sessionDigest does not match its body");
  }
  return deepFreeze(JSON.parse(JSON.stringify(value)));
}

function sealWorkSession(value) {
  const body = { ...value };
  delete body.sessionDigest;
  const sealed = { ...body, sessionDigest: computeWorkSessionDigest(body) };
  return validateWorkSession(sealed);
}

function loadWorkSession(filePath) {
  const absolute = path.resolve(filePath);
  let stat;
  try {
    stat = fs.lstatSync(absolute);
  } catch (error) {
    fail("MH_WORK_SESSION_READ", `work session is unreadable: ${error.message}`);
  }
  if (!stat.isFile() || stat.isSymbolicLink()) {
    fail("MH_WORK_SESSION_READ", "work session must be a regular non-symlink JSON file");
  }
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(absolute, "utf8"));
  } catch (error) {
    fail("MH_WORK_SESSION_JSON", `work session JSON is invalid: ${error.message}`);
  }
  return validateWorkSession(parsed);
}

function createGoalWorkSession({
  goal,
  allowedPaths = ["."],
  dirtyPolicy = "isolate",
  validation = [],
  delivery = { commit: false, push: false },
}) {
  const productResult = nonEmptyString(goal, "goal").trim();
  const intent = {
    version: "owner-goal/v1",
    digest: domainDigest("meta-harness-owner-goal/v1", { productResult }),
  };
  return sealWorkSession({
    schemaVersion: WORK_SESSION_SCHEMA,
    intent,
    productResult,
    journeyState: "The owner has authorized this coding result; implementation has not yet been delivered.",
    doNow: productResult,
    newlyTrueBehavior: productResult,
    doneWhen: "The requested behavior works in the repository and relevant validation passes.",
    stopOnlyIf: [
      "The work requires scope outside the allowed paths.",
      "The work requires credentials, protected access, irreversible data mutation, publication, or a material product decision.",
      "Repository evidence proves the requested result is impossible or materially unsafe.",
    ],
    authorizedReversibleActions: [
      "Read repository instructions and relevant source files.",
      "Edit files inside the allowed paths.",
      "Run focused validation and repair failures inside scope.",
      "Create or use an isolated worktree when unrelated dirtiness exists.",
    ],
    ownerOnlyActions: [
      "Expand product scope or allowed paths.",
      "Supply credentials or approve protected access.",
      "Approve publication, destructive operations, or material risk.",
    ],
    allowedPaths,
    dirtyPolicy,
    validation,
    maxAttempts: 2,
    delivery,
  });
}

module.exports = {
  DIRTY_POLICIES,
  WORK_SESSION_DOMAIN,
  WORK_SESSION_SCHEMA,
  computeWorkSessionDigest,
  createGoalWorkSession,
  loadWorkSession,
  sealWorkSession,
  validateWorkSession,
  validRelativePath,
  workSessionBody,
};
