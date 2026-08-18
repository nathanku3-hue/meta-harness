"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const { domainDigest, isDigest } = require("./contracts/digest");
const { ConfigError } = require("./errors");
const { createOutcome, persistOutcome } = require("./outcome");
const { ensureOutcomeClaim } = require("./outcome-claim");
const { pinProductDirection } = require("./product-direction");
const { persistImmutableBytes } = require("./world-authority");
const { validateResolvedBase } = require("./work-base");
const { WORK_SESSION_SCHEMA, sealWorkSession, validRelativePath } = require("./work-session");
const { compileProductProofSpec } = require("./work-proof-compiler");

const REPO_DECISION_SCHEMA = "repo-decision/v3";
const REPO_DECISION_DOMAIN = "meta-harness-repo-decision-bytes/v3";
const REPO_CHARTER_DOMAIN = "meta-harness-repo-charter-bytes/v2";
const REPO_CHARTER_RELATIVE_PATH = path.join(".meta-harness", "repo-charter.json");
const REPO_DECISION_RELATIVE_PATH = path.join(".meta-harness", "repo-decision.json");
const OWNER_DIRECTIVE_RELATIVE_PATH = path.join(".meta-harness", "owner-directive.md");
const MAX_CONTROL_BYTES = 512 * 1024;
const MAX_OWNER_DIRECTIVE_BYTES = 128 * 1024;
const NO_DISPATCH_REASONS = Object.freeze([
  "WAIT_EXTERNAL",
  "WAIT_MATURITY",
  "USE_PRODUCT",
  "NO_VALUABLE_ACTION",
]);
const NO_DISPATCH_REASON_SET = new Set(NO_DISPATCH_REASONS);

function fail(code, message, details) {
  throw new ConfigError(message, { code, details });
}

function exactKeys(value, expected, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("MH_REPO_DECISION_SHAPE", `${label} must be an object`);
  }
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (JSON.stringify(actual) !== JSON.stringify(wanted)) {
    fail("MH_REPO_DECISION_SHAPE", `${label} has missing or unexpected fields`, { actual, expected: wanted });
  }
}

function nonEmptyString(value, label) {
  if (typeof value !== "string" || value.trim() === "") fail("MH_REPO_DECISION_VALUE", `${label} must be a non-empty string`);
  return value;
}

function requireDigest(value, label) {
  if (!isDigest(value)) fail("MH_REPO_DECISION_DIGEST", `${label} must be a sha256 digest`);
  return value;
}

function stringList(value, label, { min = 0 } = {}) {
  if (!Array.isArray(value) || value.length < min) fail("MH_REPO_DECISION_VALUE", `${label} must contain at least ${min} item(s)`);
  const normalized = value.map((entry, index) => nonEmptyString(entry, `${label}[${index}]`));
  if (new Set(normalized).size !== normalized.length) fail("MH_REPO_DECISION_VALUE", `${label} must not contain duplicates`);
  return normalized;
}

function readRegularBytes(repositoryPath, relativePath, { optional = false, maxBytes = MAX_CONTROL_BYTES } = {}) {
  const filePath = path.resolve(repositoryPath, relativePath);
  let stat;
  try {
    stat = fs.lstatSync(filePath);
  } catch (error) {
    if (optional && error?.code === "ENOENT") return null;
    fail("MH_REPO_DECISION_READ", `${relativePath} is missing or unreadable: ${error.message}`);
  }
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > maxBytes) {
    fail("MH_REPO_DECISION_READ", `${relativePath} must be a regular non-symlink file no larger than ${maxBytes} bytes`);
  }
  return fs.readFileSync(filePath);
}

function bytesDomainDigest(domain, bytes) {
  return domainDigest(domain, { content: bytes.toString("utf8") });
}

function loadRepoCharter(repositoryPath) {
  const bytes = readRegularBytes(repositoryPath, REPO_CHARTER_RELATIVE_PATH);
  return {
    bytes,
    digest: bytesDomainDigest(REPO_CHARTER_DOMAIN, bytes),
    path: path.resolve(repositoryPath, REPO_CHARTER_RELATIVE_PATH),
  };
}

function ownerDirectiveDigest(repositoryPath) {
  const bytes = readRegularBytes(repositoryPath, OWNER_DIRECTIVE_RELATIVE_PATH, {
    optional: true,
    maxBytes: MAX_OWNER_DIRECTIVE_BYTES,
  });
  if (!bytes) return null;
  return `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
}

function validateValidationCommand(value, index) {
  const label = `repoDecision.decision.action.validation[${index}]`;
  exactKeys(value, ["argv", "cwd", "timeoutSeconds"], label);
  if (!Array.isArray(value.argv) || value.argv.length === 0 || value.argv.length > 200) fail("MH_REPO_DECISION_VALIDATION", `${label}.argv must contain 1-200 arguments`);
  value.argv.forEach((entry, argIndex) => nonEmptyString(entry, `${label}.argv[${argIndex}]`));
  if (value.cwd !== "." && !validRelativePath(value.cwd)) fail("MH_REPO_DECISION_VALIDATION", `${label}.cwd is invalid`);
  if (!Number.isInteger(value.timeoutSeconds) || value.timeoutSeconds < 1 || value.timeoutSeconds > 3600) fail("MH_REPO_DECISION_VALIDATION", `${label}.timeoutSeconds must be 1-3600`);
}

function validateDispatchAction(value) {
  exactKeys(value, [
    "id",
    "productResult",
    "journeyState",
    "doNow",
    "newlyTrueBehavior",
    "doneWhen",
    "stopOnlyIf",
    "allowedPaths",
    "base",
    "validation",
    "maxAttempts",
    "delivery",
  ], "repoDecision.decision.action");
  for (const field of ["id", "productResult", "journeyState", "doNow", "newlyTrueBehavior", "doneWhen"]) {
    nonEmptyString(value[field], `repoDecision.decision.action.${field}`);
  }
  stringList(value.stopOnlyIf, "repoDecision.decision.action.stopOnlyIf", { min: 1 });
  const allowedPaths = stringList(value.allowedPaths, "repoDecision.decision.action.allowedPaths", { min: 1 });
  allowedPaths.forEach((allowedPath) => {
    if (!validRelativePath(allowedPath)) fail("MH_REPO_DECISION_PATH", `invalid selected action path: ${allowedPath}`);
  });
  validateResolvedBase(value.base, "repoDecision.decision.action.base");
  if (!Array.isArray(value.validation) || value.validation.length === 0) fail("MH_REPO_DECISION_VALIDATION", "DISPATCH action requires controller validation");
  value.validation.forEach(validateValidationCommand);
  if (!Number.isInteger(value.maxAttempts) || value.maxAttempts < 1 || value.maxAttempts > 3) fail("MH_REPO_DECISION_VALUE", "DISPATCH maxAttempts must be 1-3");
  exactKeys(value.delivery, ["commit", "push"], "repoDecision.decision.action.delivery");
  if (typeof value.delivery.commit !== "boolean" || typeof value.delivery.push !== "boolean" || (value.delivery.push && !value.delivery.commit)) {
    fail("MH_REPO_DECISION_VALUE", "DISPATCH delivery must be boolean and push requires commit authority");
  }
}

function validateRepoDecision(value) {
  exactKeys(value, [
    "schemaVersion",
    "productDirectionDigest",
    "charterDigest",
    "worldHeadDigest",
    "ownerDirectiveDigest",
    "decision",
  ], "repoDecision");
  if (value.schemaVersion !== REPO_DECISION_SCHEMA) fail("MH_REPO_DECISION_SCHEMA", `repoDecision.schemaVersion must be ${REPO_DECISION_SCHEMA}`);
  requireDigest(value.productDirectionDigest, "repoDecision.productDirectionDigest");
  requireDigest(value.charterDigest, "repoDecision.charterDigest");
  requireDigest(value.worldHeadDigest, "repoDecision.worldHeadDigest");
  if (value.ownerDirectiveDigest !== null) requireDigest(value.ownerDirectiveDigest, "repoDecision.ownerDirectiveDigest");
  if (!value.decision || typeof value.decision !== "object" || Array.isArray(value.decision)) fail("MH_REPO_DECISION_SHAPE", "repoDecision.decision must be an object");
  if (value.decision.type === "DISPATCH") {
    exactKeys(value.decision, ["type", "action"], "repoDecision.decision");
    validateDispatchAction(value.decision.action);
  } else if (value.decision.type === "NO_DISPATCH") {
    exactKeys(value.decision, ["type", "reason"], "repoDecision.decision");
    if (value.decision.reason === "OWNER_DECISION_REQUIRED") {
      fail(
        "MH_UNEVIDENCED_AUTHORITY_BLOCKER",
        "owner authority cannot be asserted without a schema that identifies the real authority/resource and retained evidence",
      );
    }
    if (!NO_DISPATCH_REASON_SET.has(value.decision.reason)) fail("MH_REPO_DECISION_VALUE", `invalid NO_DISPATCH reason: ${value.decision.reason}`);
  } else {
    fail("MH_REPO_DECISION_VALUE", "repoDecision.decision.type must be DISPATCH or NO_DISPATCH");
  }
  return Object.freeze(JSON.parse(JSON.stringify(value)));
}

function loadRepoDecision(repositoryPath) {
  const bytes = readRegularBytes(repositoryPath, REPO_DECISION_RELATIVE_PATH);
  let parsed;
  try {
    parsed = JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    fail("MH_REPO_DECISION_JSON", `${REPO_DECISION_RELATIVE_PATH} is invalid JSON: ${error.message}`);
  }
  const value = validateRepoDecision(parsed);
  const digest = bytesDomainDigest(REPO_DECISION_DOMAIN, bytes);
  return { value, digest, bytes, path: path.resolve(repositoryPath, REPO_DECISION_RELATIVE_PATH) };
}

function assertBinding(label, expected, actual) {
  if (expected !== actual) fail("MH_REPO_DECISION_STALE", `${label} changed; recompute repo-decision`, { expected, actual });
}

function compileRepoDecision(repositoryPath, worldState) {
  const direction = pinProductDirection(repositoryPath);
  const charter = loadRepoCharter(repositoryPath);
  const decision = loadRepoDecision(repositoryPath);
  assertBinding("authoritative World product direction", direction.digest, worldState.world.productDirectionDigest);
  assertBinding("product direction", direction.digest, decision.value.productDirectionDigest);
  assertBinding("repo charter", charter.digest, decision.value.charterDigest);
  assertBinding("authoritative WorldHead", worldState.head.headDigest, decision.value.worldHeadDigest);
  assertBinding("owner directive", ownerDirectiveDigest(repositoryPath), decision.value.ownerDirectiveDigest);
  persistImmutableBytes(repositoryPath, "decisions", decision.digest, decision.bytes, "MH_REPO_DECISION_WRITE");

  if (decision.value.decision.type === "NO_DISPATCH") {
    return Object.freeze({
      type: "NO_DISPATCH",
      reason: decision.value.decision.reason,
      decisionDigest: decision.digest,
      worldHeadDigest: worldState.head.headDigest,
    });
  }

  const action = decision.value.decision.action;
  const outcome = persistOutcome(repositoryPath, createOutcome({
    id: action.id,
    desiredState: action.productResult,
    preconditions: [action.journeyState],
    evidenceRequirement: action.doneWhen,
  }));
  const claim = ensureOutcomeClaim({
    repositoryPath,
    outcomeDigest: outcome.outcomeDigest,
    originWorldHeadDigest: worldState.head.headDigest,
    executionBoundary: { writePaths: action.allowedPaths },
  });
  const productProofSpec = compileProductProofSpec({
    repositoryPath,
    productDirection: direction,
    base: action.base,
    productResult: action.productResult,
    newlyTrueBehavior: action.newlyTrueBehavior,
    doneWhen: action.doneWhen,
    allowModel: false,
  });
  const session = sealWorkSession({
    schemaVersion: WORK_SESSION_SCHEMA,
    productDirection: direction,
    origin: {
      type: "REPO_OUTCOME",
      outcomeDigest: outcome.outcomeDigest,
      claimDigest: claim.claimDigest,
    },
    base: action.base,
    productResult: action.productResult,
    journeyState: action.journeyState,
    doNow: action.doNow,
    newlyTrueBehavior: action.newlyTrueBehavior,
    doneWhen: action.doneWhen,
    productProofSpec,
    stopOnlyIf: action.stopOnlyIf,
    authorizedReversibleActions: [
      "Read repository instructions and relevant source files.",
      "Edit files inside the allowed paths.",
      "Run focused validation and repair failures inside scope.",
      "Execute only inside the fresh controller-owned managed worktree for this session.",
    ],
    ownerOnlyActions: [
      "Expand product scope or allowed paths.",
      "Change product direction in PRODUCT.md.",
      "Change repo policy, World projection, attestation, interpretation, or Decision authority.",
      "Supply credentials or approve protected access.",
      "Approve publication, destructive operations, or material risk.",
    ],
    allowedPaths: action.allowedPaths,
    validation: action.validation,
    maxAttempts: action.maxAttempts,
    delivery: action.delivery,
  });
  return Object.freeze({
    type: "DISPATCH",
    decisionDigest: decision.digest,
    outcomeDigest: outcome.outcomeDigest,
    claimDigest: claim.claimDigest,
    worldHeadDigest: worldState.head.headDigest,
    session,
  });
}

module.exports = {
  NO_DISPATCH_REASONS,
  OWNER_DIRECTIVE_RELATIVE_PATH,
  REPO_CHARTER_DOMAIN,
  REPO_CHARTER_RELATIVE_PATH,
  REPO_DECISION_DOMAIN,
  REPO_DECISION_RELATIVE_PATH,
  REPO_DECISION_SCHEMA,
  compileRepoDecision,
  loadRepoCharter,
  loadRepoDecision,
  ownerDirectiveDigest,
  validateRepoDecision,
};
