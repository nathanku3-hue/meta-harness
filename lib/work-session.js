"use strict";

const fs = require("node:fs");
const path = require("node:path");

const { domainDigest, isDigest } = require("./contracts/digest");
const { ConfigError } = require("./errors");
const {
  assertProductDirectionUnchanged,
  pinProductDirection,
  validateProductDirectionShape,
} = require("./product-direction");
const { assertBaseCommitAvailable, validateResolvedBase } = require("./work-base");

const WORK_SESSION_SCHEMA = "work-session/v5";
const WORK_SESSION_DOMAIN = "meta-harness-work-session/v5";
const TOP_KEYS = Object.freeze([
  "schemaVersion",
  "productDirection",
  "origin",
  "base",
  "productResult",
  "journeyState",
  "doNow",
  "newlyTrueBehavior",
  "doneWhen",
  "stopOnlyIf",
  "authorizedReversibleActions",
  "ownerOnlyActions",
  "allowedPaths",
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

function validateOrigin(value) {
  plainObject(value, "workSession.origin");
  if (value.type === "OWNER_GOAL") {
    exactKeys(value, ["type"], "workSession.origin");
    return;
  }
  if (value.type === "REPO_DECISION") {
    exactKeys(value, ["type", "decisionDigest"], "workSession.origin");
    if (!isDigest(value.decisionDigest)) {
      fail("MH_WORK_SESSION_ORIGIN", "workSession.origin.decisionDigest must be a sha256 digest");
    }
    return;
  }
  fail("MH_WORK_SESSION_ORIGIN", "workSession.origin.type must be OWNER_GOAL or REPO_DECISION");
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

function reduceJourneyState({ ownerResult = null, activeSession = null, compiledDecision = null } = {}) {
  const requested = typeof ownerResult === "string" && ownerResult.trim() !== "" ? ownerResult.trim() : null;
  const next = (kind, operation, reason) => Object.freeze({
    kind,
    operation,
    automatic: kind !== "OWNER_INPUT",
    reason,
  });

  if (requested && activeSession) {
    if (activeSession.productResult === requested) {
      return Object.freeze({
        state: "ACTIVE",
        productResult: activeSession.productResult,
        next: next("EXECUTE", "RESUME", "the accepted result already has active workspace custody"),
      });
    }
    return Object.freeze({
      state: "ACTIVE",
      productResult: activeSession.productResult,
      next: next("OWNER_INPUT", "REPLACE_ACTIVE_RESULT", "a different accepted result is already active"),
    });
  }
  if (requested) {
    return Object.freeze({
      state: "NEW",
      productResult: requested,
      next: next("EXECUTE", "NEW", "a new product result was supplied and no active result exists"),
    });
  }
  if (activeSession) {
    return Object.freeze({
      state: "ACTIVE",
      productResult: activeSession.productResult,
      next: next("EXECUTE", "RESUME", "persisted workspace custody identifies the continuation"),
    });
  }
  if (compiledDecision?.type === "DISPATCH") {
    return Object.freeze({
      state: "NEW",
      productResult: compiledDecision.session.productResult,
      next: next("EXECUTE", "NEW", "repository state selected one executable result"),
    });
  }
  if (compiledDecision?.type === "NO_DISPATCH") {
    return Object.freeze({
      state: "IDLE",
      productResult: null,
      next: next("STOP", "STOP", compiledDecision.reason),
    });
  }
  return Object.freeze({
    state: "IDLE",
    productResult: null,
    next: next("STOP", "STOP", "no accepted result is active and no repository action is selected"),
  });
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
  validateProductDirectionShape(value.productDirection);
  validateOrigin(value.origin);
  validateResolvedBase(value.base, "workSession.base");
  nonEmptyString(value.productResult, "workSession.productResult");
  nonEmptyString(value.journeyState, "workSession.journeyState");
  nonEmptyString(value.doNow, "workSession.doNow");
  nonEmptyString(value.newlyTrueBehavior, "workSession.newlyTrueBehavior");
  nonEmptyString(value.doneWhen, "workSession.doneWhen");
  stringList(value.stopOnlyIf, "workSession.stopOnlyIf", { min: 1 });
  stringList(value.authorizedReversibleActions, "workSession.authorizedReversibleActions", { min: 1 });
  stringList(value.ownerOnlyActions, "workSession.ownerOnlyActions", { min: 1 });
  validateAllowedPaths(value.allowedPaths);
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

function bindWorkSessionToRepository(session, repositoryPath) {
  const validated = validateWorkSession(session);
  assertProductDirectionUnchanged(validated.productDirection, repositoryPath);
  assertBaseCommitAvailable(repositoryPath, validated.base.commit);
  return validated;
}

function createGoalWorkSession({
  goal,
  repositoryPath,
  productDirection,
  base,
  allowedPaths = ["."],
  validation = [],
  delivery = { commit: false, push: false },
}) {
  const productResult = nonEmptyString(goal, "goal").trim();
  const direction = productDirection
    ? validateProductDirectionShape(productDirection)
    : pinProductDirection(nonEmptyString(repositoryPath, "repositoryPath"));
  const resolvedBase = validateResolvedBase(base, "base");
  return sealWorkSession({
    schemaVersion: WORK_SESSION_SCHEMA,
    productDirection: direction,
    origin: { type: "OWNER_GOAL" },
    base: resolvedBase,
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
      "Execute only inside the fresh controller-owned managed worktree for this session.",
    ],
    ownerOnlyActions: [
      "Expand product scope or allowed paths.",
      "Change product direction in PRODUCT.md.",
      "Supply credentials or approve protected access.",
      "Approve publication, destructive operations, or material risk.",
    ],
    allowedPaths,
    validation,
    maxAttempts: 2,
    delivery,
  });
}

module.exports = {
  WORK_SESSION_DOMAIN,
  WORK_SESSION_SCHEMA,
  bindWorkSessionToRepository,
  computeWorkSessionDigest,
  createGoalWorkSession,
  loadWorkSession,
  reduceJourneyState,
  sealWorkSession,
  validateWorkSession,
  validRelativePath,
  workSessionBody,
};
