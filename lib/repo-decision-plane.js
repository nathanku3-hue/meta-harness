"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const { domainDigest, isDigest } = require("./contracts/digest");
const { ConfigError } = require("./errors");
const { pinProductDirection } = require("./product-direction");
const { sealWorkSession, validRelativePath } = require("./work-session");
const { repositoryRoot, runGit, stateDirectory } = require("./work-git");

const REPO_CHARTER_SCHEMA = "repo-charter/v1";
const REPO_WORLD_SCHEMA = "repo-world/v1";
const REPO_DECISION_SCHEMA = "repo-decision/v1";

const REPO_CHARTER_DOMAIN = "meta-harness-repo-charter/v1";
const REPO_WORLD_DOMAIN = "meta-harness-repo-world/v1";
const REPO_DECISION_DOMAIN = "meta-harness-repo-decision/v1";
const REPO_EXECUTION_BASE_DOMAIN = "meta-harness-repo-execution-base/v1";
const REPO_DECISION_CONSUMPTION_SCHEMA = "repo-decision-consumption/v1";
const REPO_DECISION_RESULT_SCHEMA = "repo-decision-result/v1";

const REPO_CHARTER_RELATIVE_PATH = path.join(".meta-harness", "repo-charter.json");
const REPO_WORLD_RELATIVE_PATH = path.join(".meta-harness", "repo-world.json");
const REPO_DECISION_RELATIVE_PATH = path.join(".meta-harness", "repo-decision.json");
const OWNER_DIRECTIVE_RELATIVE_PATH = path.join(".meta-harness", "owner-directive.md");

const MAX_CONTRACT_BYTES = 512 * 1024;
const MAX_OWNER_DIRECTIVE_BYTES = 128 * 1024;

const REQUIRED_FACTUAL_PRECEDENCE = Object.freeze([
  "validated_observation",
  "canonical_factual_state",
  "derived_status",
  "prose_history",
]);

const REQUIRED_STRATEGIC_PRECEDENCE = Object.freeze([
  "current_owner_directive",
  "product_direction",
  "repo_charter",
  "derived_recommendation",
  "stale_history",
]);

function fail(code, message, details) {
  throw new ConfigError(message, { code, details });
}

function plainObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    fail("MH_REPO_DECISION_SHAPE", `${label} must be a plain object`);
  }
  return value;
}

function exactKeys(value, expected, label) {
  plainObject(value, label);
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (JSON.stringify(actual) !== JSON.stringify(wanted)) {
    fail("MH_REPO_DECISION_SHAPE", `${label} has missing or unexpected fields`, { actual, expected: wanted });
  }
}

function nonEmptyString(value, label) {
  if (typeof value !== "string" || value.trim() === "") {
    fail("MH_REPO_DECISION_VALUE", `${label} must be a non-empty string`);
  }
  return value;
}

function nullableNonEmptyString(value, label) {
  if (value === null) return null;
  return nonEmptyString(value, label);
}

function uniqueStrings(value, label, { min = 0 } = {}) {
  if (!Array.isArray(value) || value.length < min) {
    fail("MH_REPO_DECISION_VALUE", `${label} must be an array with at least ${min} item(s)`);
  }
  const normalized = value.map((entry, index) => nonEmptyString(entry, `${label}[${index}]`));
  if (new Set(normalized).size !== normalized.length) {
    fail("MH_REPO_DECISION_VALUE", `${label} must not contain duplicates`);
  }
  return normalized;
}

function requireDigest(value, label) {
  if (!isDigest(value)) {
    fail("MH_REPO_DECISION_DIGEST", `${label} must be sha256:<64 lowercase hex>`);
  }
  return value;
}

function requireOrderedSubsequence(actual, required, label) {
  let cursor = -1;
  for (const entry of required) {
    const index = actual.indexOf(entry, cursor + 1);
    if (index < 0) {
      fail(
        "MH_REPO_CHARTER_PRECEDENCE",
        `${label} must preserve required authority order: ${required.join(" > ")}`,
      );
    }
    cursor = index;
  }
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

function regularFileStat(filePath, { missingCode, targetCode, label, optional = false } = {}) {
  let stat;
  try {
    stat = fs.lstatSync(filePath);
  } catch (error) {
    if (optional && error?.code === "ENOENT") return null;
    fail(missingCode, `${label} is missing or unreadable: ${error.message}`);
  }
  if (!stat.isFile() || stat.isSymbolicLink()) {
    fail(targetCode, `${label} must be a regular non-symlink file`);
  }
  return stat;
}

function readJsonContract(filePath, label, { missingCode, targetCode, jsonCode }) {
  const stat = regularFileStat(filePath, { missingCode, targetCode, label });
  if (stat.size > MAX_CONTRACT_BYTES) {
    fail(targetCode, `${label} exceeds ${MAX_CONTRACT_BYTES} bytes`);
  }
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    fail(jsonCode, `${label} is invalid JSON: ${error.message}`);
  }
  return parsed;
}

function contractPath(repositoryPath, relativePath) {
  return path.resolve(repositoryPath, relativePath);
}

function isProtectedRepoDecisionPlanePath(relativePath) {
  const normalized = String(relativePath || "").replace(/\\/g, "/").replace(/^\.\//, "").toLowerCase();
  return new Set([
    ".meta-harness/repo-charter.json",
    ".meta-harness/repo-world.json",
    ".meta-harness/repo-decision.json",
    ".meta-harness/owner-directive.md",
  ]).has(normalized);
}

function repositoryExecutionBaseDigest(repositoryPath) {
  const root = repositoryRoot(repositoryPath);
  const output = String(runGit(root, ["ls-tree", "-r", "-z", "--full-tree", "HEAD"]).stdout || "");
  const entries = output.split("\0").filter(Boolean).map((record) => {
    const tabAt = record.indexOf("\t");
    if (tabAt < 0) fail("MH_REPO_EXECUTION_BASE", "git ls-tree returned an invalid record");
    const header = record.slice(0, tabAt).trim().split(/\s+/u);
    const relativePath = record.slice(tabAt + 1).replace(/\\/g, "/");
    if (header.length !== 3 || !relativePath) {
      fail("MH_REPO_EXECUTION_BASE", "git ls-tree returned an invalid tracked-entry identity");
    }
    if (isProtectedRepoDecisionPlanePath(relativePath)) return null;
    return {
      mode: header[0],
      type: header[1],
      object: header[2],
      path: relativePath,
    };
  }).filter(Boolean);
  return domainDigest(REPO_EXECUTION_BASE_DOMAIN, entries);
}

function decisionPlaneEnabled(repositoryPath) {
  const charterPath = contractPath(repositoryPath, REPO_CHARTER_RELATIVE_PATH);
  const stat = regularFileStat(charterPath, {
    missingCode: "MH_REPO_CHARTER_MISSING",
    targetCode: "MH_REPO_CHARTER_TARGET",
    label: REPO_CHARTER_RELATIVE_PATH,
    optional: true,
  });
  return Boolean(stat);
}

function validateRepoCharter(value) {
  exactKeys(value, [
    "schemaVersion",
    "version",
    "productDirectionDigest",
    "objectiveHierarchy",
    "factualTruthPrecedence",
    "strategicAuthorityPrecedence",
    "falsificationLayers",
    "resurrectionLaw",
    "externalStateRequirements",
    "allocationPolicy",
  ], "repoCharter");
  if (value.schemaVersion !== REPO_CHARTER_SCHEMA) {
    fail("MH_REPO_CHARTER_SCHEMA", `repoCharter.schemaVersion must be ${REPO_CHARTER_SCHEMA}`);
  }
  nonEmptyString(value.version, "repoCharter.version");
  requireDigest(value.productDirectionDigest, "repoCharter.productDirectionDigest");
  uniqueStrings(value.objectiveHierarchy, "repoCharter.objectiveHierarchy", { min: 1 });
  const factual = uniqueStrings(value.factualTruthPrecedence, "repoCharter.factualTruthPrecedence", { min: 4 });
  const strategic = uniqueStrings(value.strategicAuthorityPrecedence, "repoCharter.strategicAuthorityPrecedence", { min: 5 });
  requireOrderedSubsequence(factual, REQUIRED_FACTUAL_PRECEDENCE, "repoCharter.factualTruthPrecedence");
  requireOrderedSubsequence(strategic, REQUIRED_STRATEGIC_PRECEDENCE, "repoCharter.strategicAuthorityPrecedence");
  uniqueStrings(value.falsificationLayers, "repoCharter.falsificationLayers");
  uniqueStrings(value.resurrectionLaw, "repoCharter.resurrectionLaw", { min: 1 });
  uniqueStrings(value.externalStateRequirements, "repoCharter.externalStateRequirements");
  uniqueStrings(value.allocationPolicy, "repoCharter.allocationPolicy", { min: 1 });
  return deepFreeze(JSON.parse(JSON.stringify(value)));
}

function evidenceRecord(value, label, extraKeys = []) {
  exactKeys(value, ["id", "statement", "evidenceRef", ...extraKeys], label);
  nonEmptyString(value.id, `${label}.id`);
  nonEmptyString(value.statement, `${label}.statement`);
  nonEmptyString(value.evidenceRef, `${label}.evidenceRef`);
  for (const key of extraKeys) nonEmptyString(value[key], `${label}.${key}`);
  return value;
}

function evidenceRecords(value, label, extraKeys = []) {
  if (!Array.isArray(value)) fail("MH_REPO_WORLD_VALUE", `${label} must be an array`);
  value.forEach((entry, index) => evidenceRecord(entry, `${label}[${index}]`, extraKeys));
  const ids = value.map((entry) => entry.id);
  if (new Set(ids).size !== ids.length) fail("MH_REPO_WORLD_VALUE", `${label} ids must be unique`);
  return value;
}

function terminalRoutes(value) {
  if (!Array.isArray(value)) fail("MH_REPO_WORLD_VALUE", "repoWorld.truth.terminalRoutes must be an array");
  value.forEach((entry, index) => {
    const label = `repoWorld.truth.terminalRoutes[${index}]`;
    exactKeys(entry, ["id", "reason", "evidenceRef", "validity", "resurrectionCondition"], label);
    nonEmptyString(entry.id, `${label}.id`);
    nonEmptyString(entry.reason, `${label}.reason`);
    nonEmptyString(entry.evidenceRef, `${label}.evidenceRef`);
    exactKeys(entry.validity, ["verdict", "evidenceRef"], `${label}.validity`);
    if (entry.validity.verdict !== "PASS") {
      fail("MH_REPO_WORLD_TERMINAL_VALIDITY", `${label}.validity.verdict must be PASS before a route may be terminal`);
    }
    nonEmptyString(entry.validity.evidenceRef, `${label}.validity.evidenceRef`);
    nonEmptyString(entry.resurrectionCondition, `${label}.resurrectionCondition`);
  });
  const ids = value.map((entry) => entry.id);
  if (new Set(ids).size !== ids.length) fail("MH_REPO_WORLD_VALUE", "repoWorld.truth.terminalRoutes ids must be unique");
  return value;
}

function externalInputIdentities(value) {
  if (!Array.isArray(value)) fail("MH_REPO_WORLD_VALUE", "repoWorld.truth.externalInputIdentities must be an array");
  value.forEach((entry, index) => {
    const label = `repoWorld.truth.externalInputIdentities[${index}]`;
    exactKeys(entry, ["name", "identity"], label);
    nonEmptyString(entry.name, `${label}.name`);
    nonEmptyString(entry.identity, `${label}.identity`);
  });
  const names = value.map((entry) => entry.name);
  if (new Set(names).size !== names.length) fail("MH_REPO_WORLD_VALUE", "external input names must be unique");
  return value;
}

function candidateActions(value) {
  if (!Array.isArray(value) || value.length === 0) {
    fail("MH_REPO_WORLD_VALUE", "repoWorld.recommendation.candidateActions must contain at least one candidate");
  }
  value.forEach((entry, index) => {
    const label = `repoWorld.recommendation.candidateActions[${index}]`;
    exactKeys(entry, ["id", "routeId", "result", "status", "reason", "priorBasisInvalidatedByEvidenceRef"], label);
    nonEmptyString(entry.id, `${label}.id`);
    nonEmptyString(entry.routeId, `${label}.routeId`);
    nonEmptyString(entry.result, `${label}.result`);
    if (!new Set(["LEGAL", "BLOCKED"]).has(entry.status)) {
      fail("MH_REPO_WORLD_VALUE", `${label}.status must be LEGAL or BLOCKED`);
    }
    nonEmptyString(entry.reason, `${label}.reason`);
    nullableNonEmptyString(entry.priorBasisInvalidatedByEvidenceRef, `${label}.priorBasisInvalidatedByEvidenceRef`);
  });
  const ids = value.map((entry) => entry.id);
  if (new Set(ids).size !== ids.length) fail("MH_REPO_WORLD_VALUE", "candidate action ids must be unique");
  return value;
}

function validateRepoWorld(value) {
  exactKeys(value, ["schemaVersion", "productDirectionDigest", "charterDigest", "executionBaseDigest", "truth", "recommendation"], "repoWorld");
  if (value.schemaVersion !== REPO_WORLD_SCHEMA) {
    fail("MH_REPO_WORLD_SCHEMA", `repoWorld.schemaVersion must be ${REPO_WORLD_SCHEMA}`);
  }
  requireDigest(value.productDirectionDigest, "repoWorld.productDirectionDigest");
  requireDigest(value.charterDigest, "repoWorld.charterDigest");
  requireDigest(value.executionBaseDigest, "repoWorld.executionBaseDigest");

  exactKeys(value.truth, [
    "facts",
    "supportedClaims",
    "contradictedClaims",
    "notEstablishedClaims",
    "positiveKnowledge",
    "negativeKnowledge",
    "terminalRoutes",
    "externalInputIdentities",
    "activeTracks",
    "blockedTracks",
    "currentBottleneck",
  ], "repoWorld.truth");
  evidenceRecords(value.truth.facts, "repoWorld.truth.facts");
  evidenceRecords(value.truth.supportedClaims, "repoWorld.truth.supportedClaims");
  evidenceRecords(value.truth.contradictedClaims, "repoWorld.truth.contradictedClaims");
  evidenceRecords(value.truth.notEstablishedClaims, "repoWorld.truth.notEstablishedClaims");
  evidenceRecords(value.truth.positiveKnowledge, "repoWorld.truth.positiveKnowledge");
  evidenceRecords(value.truth.negativeKnowledge, "repoWorld.truth.negativeKnowledge", ["resurrectionCondition"]);
  const terminal = terminalRoutes(value.truth.terminalRoutes);
  externalInputIdentities(value.truth.externalInputIdentities);
  uniqueStrings(value.truth.activeTracks, "repoWorld.truth.activeTracks");
  uniqueStrings(value.truth.blockedTracks, "repoWorld.truth.blockedTracks");
  nonEmptyString(value.truth.currentBottleneck, "repoWorld.truth.currentBottleneck");

  const claimIds = [
    ...value.truth.supportedClaims,
    ...value.truth.contradictedClaims,
    ...value.truth.notEstablishedClaims,
  ].map((entry) => entry.id);
  if (new Set(claimIds).size !== claimIds.length) {
    fail("MH_REPO_WORLD_CLAIM_STATE", "a claim id may appear in exactly one of supported, contradicted, or not-established state");
  }

  exactKeys(value.recommendation, ["candidateActions", "recommendedNextActionId"], "repoWorld.recommendation");
  const candidates = candidateActions(value.recommendation.candidateActions);
  const terminalByRoute = new Map(terminal.map((entry) => [entry.id, entry]));
  const truthEvidenceRefs = new Set([
    ...value.truth.facts,
    ...value.truth.supportedClaims,
    ...value.truth.contradictedClaims,
    ...value.truth.notEstablishedClaims,
    ...value.truth.positiveKnowledge,
    ...value.truth.negativeKnowledge,
  ].map((entry) => entry.evidenceRef));
  for (const route of terminal) {
    truthEvidenceRefs.add(route.evidenceRef);
    truthEvidenceRefs.add(route.validity.evidenceRef);
  }
  for (const candidate of candidates) {
    if (terminalByRoute.has(candidate.id) && candidate.routeId !== candidate.id) {
      fail("MH_REPO_WORLD_RESURRECTION", "candidate id matches a terminal route but declares a different routeId");
    }
    const stopped = terminalByRoute.get(candidate.routeId);
    if (!stopped) {
      if (candidate.priorBasisInvalidatedByEvidenceRef !== null) {
        fail("MH_REPO_WORLD_RESURRECTION", "resurrection evidence may be attached only to a route retained as terminal");
      }
      continue;
    }
    if (candidate.status !== "LEGAL") {
      if (candidate.priorBasisInvalidatedByEvidenceRef !== null) {
        fail("MH_REPO_WORLD_RESURRECTION", "a blocked terminal route must not claim that its prior basis is already invalidated");
      }
      continue;
    }
    const invalidatingRef = candidate.priorBasisInvalidatedByEvidenceRef;
    if (invalidatingRef === null
        || !truthEvidenceRefs.has(invalidatingRef)
        || invalidatingRef === stopped.evidenceRef
        || invalidatingRef === stopped.validity.evidenceRef) {
      fail(
        "MH_REPO_WORLD_RESURRECTION",
        `LEGAL candidate ${candidate.id} reopens terminal route ${candidate.routeId} without new truth evidence that invalidates the prior basis`,
      );
    }
  }
  if (value.recommendation.recommendedNextActionId !== null) {
    nonEmptyString(value.recommendation.recommendedNextActionId, "repoWorld.recommendation.recommendedNextActionId");
    const recommended = candidates.find((entry) => entry.id === value.recommendation.recommendedNextActionId);
    if (!recommended || recommended.status !== "LEGAL") {
      fail("MH_REPO_WORLD_RECOMMENDATION", "recommendedNextActionId must reference a LEGAL candidate action");
    }
  }

  return deepFreeze(JSON.parse(JSON.stringify(value)));
}

function validateValidationCommand(value, index) {
  const label = `repoDecision.selectedAction.validation[${index}]`;
  exactKeys(value, ["argv", "cwd", "timeoutSeconds"], label);
  if (!Array.isArray(value.argv) || value.argv.length === 0 || value.argv.length > 200) {
    fail("MH_REPO_DECISION_VALIDATION", `${label}.argv must contain 1-200 arguments`);
  }
  value.argv.forEach((entry, argIndex) => nonEmptyString(entry, `${label}.argv[${argIndex}]`));
  if (value.cwd !== "." && !validRelativePath(value.cwd)) {
    fail("MH_REPO_DECISION_VALIDATION", `${label}.cwd is invalid`);
  }
  if (!Number.isInteger(value.timeoutSeconds) || value.timeoutSeconds < 1 || value.timeoutSeconds > 3600) {
    fail("MH_REPO_DECISION_VALIDATION", `${label}.timeoutSeconds must be 1-3600`);
  }
}

function validateSelectedAction(value) {
  exactKeys(value, [
    "id",
    "result",
    "doNow",
    "newlyTrueBehavior",
    "doneWhen",
    "whyNow",
    "claimLayer",
    "stopOnlyIf",
    "allowedPaths",
    "validation",
    "maxAttempts",
    "delivery",
  ], "repoDecision.selectedAction");
  nonEmptyString(value.id, "repoDecision.selectedAction.id");
  nonEmptyString(value.result, "repoDecision.selectedAction.result");
  nonEmptyString(value.doNow, "repoDecision.selectedAction.doNow");
  nonEmptyString(value.newlyTrueBehavior, "repoDecision.selectedAction.newlyTrueBehavior");
  nonEmptyString(value.doneWhen, "repoDecision.selectedAction.doneWhen");
  nonEmptyString(value.whyNow, "repoDecision.selectedAction.whyNow");
  nullableNonEmptyString(value.claimLayer, "repoDecision.selectedAction.claimLayer");
  uniqueStrings(value.stopOnlyIf, "repoDecision.selectedAction.stopOnlyIf", { min: 1 });
  const allowedPaths = uniqueStrings(value.allowedPaths, "repoDecision.selectedAction.allowedPaths", { min: 1 });
  for (const allowedPath of allowedPaths) {
    if (!validRelativePath(allowedPath)) fail("MH_REPO_DECISION_PATH", `invalid selectedAction allowed path: ${allowedPath}`);
  }
  if (!Array.isArray(value.validation) || value.validation.length === 0) {
    fail("MH_REPO_DECISION_VALIDATION", "repoDecision.selectedAction.validation must contain at least one controller-owned command");
  }
  value.validation.forEach(validateValidationCommand);
  if (!Number.isInteger(value.maxAttempts) || value.maxAttempts < 1 || value.maxAttempts > 3) {
    fail("MH_REPO_DECISION_VALUE", "repoDecision.selectedAction.maxAttempts must be 1-3");
  }
  exactKeys(value.delivery, ["commit", "push"], "repoDecision.selectedAction.delivery");
  if (typeof value.delivery.commit !== "boolean" || typeof value.delivery.push !== "boolean") {
    fail("MH_REPO_DECISION_VALUE", "repoDecision.selectedAction.delivery commit and push must be booleans");
  }
  if (value.delivery.push && !value.delivery.commit) {
    fail("MH_REPO_DECISION_VALUE", "repoDecision.selectedAction.delivery.push requires commit authority");
  }
}

function validateRepoDecision(value) {
  exactKeys(value, [
    "schemaVersion",
    "productDirectionDigest",
    "charterDigest",
    "worldDigest",
    "ownerDirectiveDigest",
    "objective",
    "selectedAction",
    "rejectedAlternatives",
  ], "repoDecision");
  if (value.schemaVersion !== REPO_DECISION_SCHEMA) {
    fail("MH_REPO_DECISION_SCHEMA", `repoDecision.schemaVersion must be ${REPO_DECISION_SCHEMA}`);
  }
  requireDigest(value.productDirectionDigest, "repoDecision.productDirectionDigest");
  requireDigest(value.charterDigest, "repoDecision.charterDigest");
  requireDigest(value.worldDigest, "repoDecision.worldDigest");
  if (value.ownerDirectiveDigest !== null) requireDigest(value.ownerDirectiveDigest, "repoDecision.ownerDirectiveDigest");
  nonEmptyString(value.objective, "repoDecision.objective");
  validateSelectedAction(value.selectedAction);
  if (!Array.isArray(value.rejectedAlternatives)) {
    fail("MH_REPO_DECISION_VALUE", "repoDecision.rejectedAlternatives must be an array");
  }
  value.rejectedAlternatives.forEach((entry, index) => {
    const label = `repoDecision.rejectedAlternatives[${index}]`;
    exactKeys(entry, ["id", "reason"], label);
    nonEmptyString(entry.id, `${label}.id`);
    nonEmptyString(entry.reason, `${label}.reason`);
  });
  const rejectedIds = value.rejectedAlternatives.map((entry) => entry.id);
  if (new Set(rejectedIds).size !== rejectedIds.length) {
    fail("MH_REPO_DECISION_VALUE", "repoDecision.rejectedAlternatives ids must be unique");
  }
  return deepFreeze(JSON.parse(JSON.stringify(value)));
}

function loadRepoCharter(repositoryPath) {
  const filePath = contractPath(repositoryPath, REPO_CHARTER_RELATIVE_PATH);
  const value = validateRepoCharter(readJsonContract(filePath, REPO_CHARTER_RELATIVE_PATH, {
    missingCode: "MH_REPO_CHARTER_MISSING",
    targetCode: "MH_REPO_CHARTER_TARGET",
    jsonCode: "MH_REPO_CHARTER_JSON",
  }));
  return { value, digest: domainDigest(REPO_CHARTER_DOMAIN, value), path: filePath };
}

function loadRepoWorld(repositoryPath) {
  const filePath = contractPath(repositoryPath, REPO_WORLD_RELATIVE_PATH);
  const value = validateRepoWorld(readJsonContract(filePath, REPO_WORLD_RELATIVE_PATH, {
    missingCode: "MH_REPO_WORLD_MISSING",
    targetCode: "MH_REPO_WORLD_TARGET",
    jsonCode: "MH_REPO_WORLD_JSON",
  }));
  return { value, digest: domainDigest(REPO_WORLD_DOMAIN, value), path: filePath };
}

function loadRepoDecision(repositoryPath) {
  const filePath = contractPath(repositoryPath, REPO_DECISION_RELATIVE_PATH);
  const value = validateRepoDecision(readJsonContract(filePath, REPO_DECISION_RELATIVE_PATH, {
    missingCode: "MH_REPO_DECISION_MISSING",
    targetCode: "MH_REPO_DECISION_TARGET",
    jsonCode: "MH_REPO_DECISION_JSON",
  }));
  return { value, digest: domainDigest(REPO_DECISION_DOMAIN, value), path: filePath };
}

function ownerDirectiveDigest(repositoryPath) {
  const filePath = contractPath(repositoryPath, OWNER_DIRECTIVE_RELATIVE_PATH);
  const stat = regularFileStat(filePath, {
    missingCode: "MH_OWNER_DIRECTIVE_READ",
    targetCode: "MH_OWNER_DIRECTIVE_TARGET",
    label: OWNER_DIRECTIVE_RELATIVE_PATH,
    optional: true,
  });
  if (!stat) return null;
  if (stat.size > MAX_OWNER_DIRECTIVE_BYTES) {
    fail("MH_OWNER_DIRECTIVE_TARGET", `${OWNER_DIRECTIVE_RELATIVE_PATH} exceeds ${MAX_OWNER_DIRECTIVE_BYTES} bytes`);
  }
  const bytes = fs.readFileSync(filePath);
  const content = bytes.toString("utf8");
  if (Buffer.compare(Buffer.from(content, "utf8"), bytes) !== 0) {
    fail("MH_OWNER_DIRECTIVE_ENCODING", `${OWNER_DIRECTIVE_RELATIVE_PATH} must be valid UTF-8`);
  }
  return `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
}

function stale(code, label, expected, actual) {
  fail(code, `${label} is stale; recompute the repo decision from current truth`, { expected, actual });
}

function decisionConsumptionPath(repositoryPath, decisionDigest) {
  requireDigest(decisionDigest, "decisionDigest");
  const harnessStateRoot = path.dirname(stateDirectory(repositoryPath));
  return path.join(
    harnessStateRoot,
    "decision-plane",
    "consumed",
    `${decisionDigest.slice("sha256:".length)}.json`,
  );
}

function decisionResultPath(repositoryPath, decisionDigest) {
  requireDigest(decisionDigest, "decisionDigest");
  const harnessStateRoot = path.dirname(stateDirectory(repositoryPath));
  return path.join(
    harnessStateRoot,
    "decision-plane",
    "results",
    `${decisionDigest.slice("sha256:".length)}.json`,
  );
}

function readDecisionConsumption(repositoryPath, decisionDigest) {
  const filePath = decisionConsumptionPath(repositoryPath, decisionDigest);
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    fail("MH_REPO_DECISION_CONSUMPTION", `decision consumption record is unreadable: ${error.message}`);
  }
  exactKeys(parsed, [
    "schemaVersion",
    "decisionDigest",
    "sessionDigest",
    "attemptId",
    "permitDigest",
    "consumedAt",
  ], "repoDecisionConsumption");
  if (parsed.schemaVersion !== REPO_DECISION_CONSUMPTION_SCHEMA) {
    fail("MH_REPO_DECISION_CONSUMPTION", "decision consumption record schema is invalid");
  }
  requireDigest(parsed.decisionDigest, "repoDecisionConsumption.decisionDigest");
  requireDigest(parsed.sessionDigest, "repoDecisionConsumption.sessionDigest");
  nonEmptyString(parsed.attemptId, "repoDecisionConsumption.attemptId");
  requireDigest(parsed.permitDigest, "repoDecisionConsumption.permitDigest");
  nonEmptyString(parsed.consumedAt, "repoDecisionConsumption.consumedAt");
  if (parsed.decisionDigest !== decisionDigest) {
    fail("MH_REPO_DECISION_CONSUMPTION", "decision consumption record identity does not match its path");
  }
  return parsed;
}

function readDecisionResult(repositoryPath, decisionDigest) {
  const filePath = decisionResultPath(repositoryPath, decisionDigest);
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    fail("MH_REPO_DECISION_RESULT", `decision result record is unreadable: ${error.message}`);
  }
  exactKeys(parsed, [
    "schemaVersion",
    "decisionDigest",
    "sessionDigest",
    "outcome",
    "attempts",
    "observableResult",
    "recordedAt",
  ], "repoDecisionResult");
  if (parsed.schemaVersion !== REPO_DECISION_RESULT_SCHEMA) {
    fail("MH_REPO_DECISION_RESULT", "decision result record schema is invalid");
  }
  requireDigest(parsed.decisionDigest, "repoDecisionResult.decisionDigest");
  requireDigest(parsed.sessionDigest, "repoDecisionResult.sessionDigest");
  nonEmptyString(parsed.outcome, "repoDecisionResult.outcome");
  if (!Number.isInteger(parsed.attempts) || parsed.attempts < 1) {
    fail("MH_REPO_DECISION_RESULT", "repoDecisionResult.attempts must be a positive integer");
  }
  nonEmptyString(parsed.observableResult, "repoDecisionResult.observableResult");
  nonEmptyString(parsed.recordedAt, "repoDecisionResult.recordedAt");
  if (parsed.decisionDigest !== decisionDigest) {
    fail("MH_REPO_DECISION_RESULT", "decision result record identity does not match its path");
  }
  return parsed;
}

function assertRepoDecisionNotConsumed(repositoryPath, decisionDigest) {
  const consumed = readDecisionConsumption(repositoryPath, decisionDigest);
  if (consumed) {
    fail(
      "MH_REPO_DECISION_CONSUMED",
      "this repo decision already entered a worker attempt; bank that attempt/result or an explicit no-change finding into repo-world, then recompute repo-decision before more material work",
      { decisionDigest, priorSessionDigest: consumed.sessionDigest, priorAttemptId: consumed.attemptId },
    );
  }
}

function repoDecisionDigestFromSession(session) {
  if (!session || !Array.isArray(session.stopOnlyIf)) return null;
  for (const condition of session.stopOnlyIf) {
    const match = String(condition).match(/^The bound repo-decision identity (sha256:[a-f0-9]{64}) changes before completion\.$/u);
    if (match) return match[1];
  }
  return null;
}

function recordRepoDecisionAttempt(repositoryPath, session, { executionPermit } = {}) {
  const decisionDigest = repoDecisionDigestFromSession(session);
  if (!decisionDigest) return null;
  if (!executionPermit || typeof executionPermit !== "object") {
    fail("MH_REPO_DECISION_CONSUMPTION", "decision attempt consumption requires the issued execution permit");
  }
  const receipt = {
    schemaVersion: REPO_DECISION_CONSUMPTION_SCHEMA,
    decisionDigest,
    sessionDigest: requireDigest(session.sessionDigest, "workSession.sessionDigest"),
    attemptId: nonEmptyString(executionPermit.attemptId, "executionPermit.attemptId"),
    permitDigest: requireDigest(executionPermit.permitDigest, "executionPermit.permitDigest"),
    consumedAt: new Date().toISOString(),
  };
  const filePath = decisionConsumptionPath(repositoryPath, decisionDigest);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  try {
    fs.writeFileSync(filePath, `${JSON.stringify(receipt, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
    return receipt;
  } catch (error) {
    if (error?.code !== "EEXIST") {
      fail("MH_REPO_DECISION_CONSUMPTION", `failed to record decision consumption: ${error.message}`);
    }
    const existing = readDecisionConsumption(repositoryPath, decisionDigest);
    if (existing.sessionDigest !== receipt.sessionDigest) {
      fail("MH_REPO_DECISION_CONSUMPTION", "decision consumption already belongs to a different work session");
    }
    return existing;
  }
}

function recordRepoDecisionResult(repositoryPath, session, result) {
  const decisionDigest = repoDecisionDigestFromSession(session);
  if (!decisionDigest || !result || !Number.isInteger(result.attempts) || result.attempts < 1) return null;
  const consumed = readDecisionConsumption(repositoryPath, decisionDigest);
  if (!consumed || consumed.sessionDigest !== session.sessionDigest) {
    fail("MH_REPO_DECISION_RESULT", "decision result requires a matching prior attempt-consumption record");
  }
  const receipt = {
    schemaVersion: REPO_DECISION_RESULT_SCHEMA,
    decisionDigest,
    sessionDigest: session.sessionDigest,
    outcome: nonEmptyString(result.outcome, "workResult.outcome"),
    attempts: result.attempts,
    observableResult: nonEmptyString(result.observableResult, "workResult.observableResult"),
    recordedAt: new Date().toISOString(),
  };
  const filePath = decisionResultPath(repositoryPath, decisionDigest);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  try {
    fs.writeFileSync(filePath, `${JSON.stringify(receipt, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
    return receipt;
  } catch (error) {
    if (error?.code !== "EEXIST") {
      fail("MH_REPO_DECISION_RESULT", `failed to record decision result: ${error.message}`);
    }
    const existing = readDecisionResult(repositoryPath, decisionDigest);
    if (existing.sessionDigest !== receipt.sessionDigest
        || existing.outcome !== receipt.outcome
        || existing.attempts !== receipt.attempts) {
      fail("MH_REPO_DECISION_RESULT", "decision result already exists with a different terminal result");
    }
    return existing;
  }
}

function compileRepoDecisionSession(repositoryPath) {
  const productDirection = pinProductDirection(repositoryPath);
  const charter = loadRepoCharter(repositoryPath);
  if (charter.value.productDirectionDigest !== productDirection.digest) {
    stale("MH_REPO_CHARTER_STALE", "repo charter product direction binding", productDirection.digest, charter.value.productDirectionDigest);
  }

  const world = loadRepoWorld(repositoryPath);
  if (world.value.productDirectionDigest !== productDirection.digest) {
    stale("MH_REPO_WORLD_STALE", "repo world product direction binding", productDirection.digest, world.value.productDirectionDigest);
  }
  if (world.value.charterDigest !== charter.digest) {
    stale("MH_REPO_WORLD_STALE", "repo world charter binding", charter.digest, world.value.charterDigest);
  }
  const liveExecutionBaseDigest = repositoryExecutionBaseDigest(repositoryPath);
  if (world.value.executionBaseDigest !== liveExecutionBaseDigest) {
    stale(
      "MH_REPO_WORLD_STALE",
      "repo world committed execution-base binding",
      liveExecutionBaseDigest,
      world.value.executionBaseDigest,
    );
  }
  const availableExternalInputs = new Set(world.value.truth.externalInputIdentities.map((entry) => entry.name));
  const missingExternalInputs = charter.value.externalStateRequirements.filter((name) => !availableExternalInputs.has(name));
  if (missingExternalInputs.length > 0) {
    fail(
      "MH_REPO_WORLD_EXTERNAL_STATE",
      `repo world is missing required external-state identities: ${missingExternalInputs.join(", ")}`,
    );
  }

  const decision = loadRepoDecision(repositoryPath);
  if (decision.value.productDirectionDigest !== productDirection.digest) {
    stale("MH_REPO_DECISION_STALE", "repo decision product direction binding", productDirection.digest, decision.value.productDirectionDigest);
  }
  if (decision.value.charterDigest !== charter.digest) {
    stale("MH_REPO_DECISION_STALE", "repo decision charter binding", charter.digest, decision.value.charterDigest);
  }
  if (decision.value.worldDigest !== world.digest) {
    stale("MH_REPO_DECISION_STALE", "repo decision world binding", world.digest, decision.value.worldDigest);
  }
  const directiveDigest = ownerDirectiveDigest(repositoryPath);
  if (decision.value.ownerDirectiveDigest !== directiveDigest) {
    stale("MH_REPO_DECISION_STALE", "repo decision owner directive binding", directiveDigest, decision.value.ownerDirectiveDigest);
  }
  assertRepoDecisionNotConsumed(repositoryPath, decision.digest);

  const primaryObjective = charter.value.objectiveHierarchy[0];
  if (directiveDigest === null && decision.value.objective !== primaryObjective) {
    fail(
      "MH_REPO_DECISION_OBJECTIVE",
      `without a current owner directive, repo decision objective must be the charter primary objective: ${primaryObjective}`,
    );
  }

  const candidates = world.value.recommendation.candidateActions;
  const selected = candidates.find((entry) => entry.id === decision.value.selectedAction.id);
  if (!selected) {
    fail("MH_REPO_DECISION_ACTION", "selectedAction.id is not present in the current repo-world recommendation candidates");
  }
  if (selected.status !== "LEGAL") {
    fail("MH_REPO_DECISION_ACTION", "selectedAction must reference a LEGAL current candidate action");
  }
  if (selected.result !== decision.value.selectedAction.result) {
    fail("MH_REPO_DECISION_ACTION", "selectedAction.result does not match the current repo-world candidate result");
  }

  const claimLayer = decision.value.selectedAction.claimLayer;
  if (claimLayer !== null && !charter.value.falsificationLayers.includes(claimLayer)) {
    fail("MH_REPO_DECISION_CLAIM_LAYER", "selectedAction.claimLayer is not declared by the current repo charter");
  }

  for (const alternative of decision.value.rejectedAlternatives) {
    if (alternative.id === decision.value.selectedAction.id || !candidates.some((entry) => entry.id === alternative.id)) {
      fail("MH_REPO_DECISION_ALTERNATIVE", "rejectedAlternatives must reference other current repo-world candidates");
    }
  }

  const bindingStop = `The bound repo-decision identity ${decision.digest} changes before completion.`;
  const currentState = [
    `Decision Plane selected ${decision.value.selectedAction.id} under ${decision.value.objective}.`,
    `Current bottleneck: ${world.value.truth.currentBottleneck}`,
    `Why now: ${decision.value.selectedAction.whyNow}`,
  ].join(" ");

  return sealWorkSession({
    schemaVersion: "work-session/v2",
    productDirection,
    productResult: decision.value.selectedAction.result,
    journeyState: currentState,
    doNow: decision.value.selectedAction.doNow,
    newlyTrueBehavior: decision.value.selectedAction.newlyTrueBehavior,
    doneWhen: decision.value.selectedAction.doneWhen,
    stopOnlyIf: [...decision.value.selectedAction.stopOnlyIf, bindingStop],
    authorizedReversibleActions: [
      "Read repository instructions and relevant source files.",
      "Edit files inside the allowed paths.",
      "Run focused validation and repair failures inside scope.",
      "Execute only inside the fresh controller-owned managed worktree for this session.",
    ],
    ownerOnlyActions: [
      "Expand product scope or allowed paths.",
      "Change product direction in PRODUCT.md.",
      "Change the repo charter or current owner directive.",
      "Supply credentials or approve protected access.",
      "Approve publication, destructive operations, or material risk.",
    ],
    allowedPaths: decision.value.selectedAction.allowedPaths,
    validation: decision.value.selectedAction.validation,
    maxAttempts: decision.value.selectedAction.maxAttempts,
    delivery: decision.value.selectedAction.delivery,
  });
}

function assertRepoDecisionSessionCurrent(repositoryPath, session) {
  const compiled = compileRepoDecisionSession(repositoryPath);
  if (compiled.sessionDigest !== session.sessionDigest) {
    fail(
      "MH_REPO_DECISION_STALE",
      "resumable work session no longer matches the current repo decision; recompute and start a new work session",
      { currentSessionDigest: compiled.sessionDigest, persistedSessionDigest: session.sessionDigest },
    );
  }
  return session;
}

function requireRepoDecisionPlaneWork(repositoryPath, options = {}) {
  if (!decisionPlaneEnabled(repositoryPath)) return null;
  if (options.goal !== undefined || options.session !== undefined || options.allow !== undefined) {
    fail(
      "MH_REPO_DECISION_REQUIRED",
      "this repository has opted into the Decision Plane; material work must come from current .meta-harness/repo-decision.json",
    );
  }
  if (options.resume !== undefined) return "resume";
  return "decision";
}

module.exports = {
  OWNER_DIRECTIVE_RELATIVE_PATH,
  REPO_CHARTER_DOMAIN,
  REPO_CHARTER_RELATIVE_PATH,
  REPO_CHARTER_SCHEMA,
  REPO_DECISION_CONSUMPTION_SCHEMA,
  REPO_DECISION_DOMAIN,
  REPO_DECISION_RESULT_SCHEMA,
  REPO_EXECUTION_BASE_DOMAIN,
  REPO_DECISION_RELATIVE_PATH,
  REPO_DECISION_SCHEMA,
  REPO_WORLD_DOMAIN,
  REPO_WORLD_RELATIVE_PATH,
  REPO_WORLD_SCHEMA,
  REQUIRED_FACTUAL_PRECEDENCE,
  REQUIRED_STRATEGIC_PRECEDENCE,
  assertRepoDecisionNotConsumed,
  assertRepoDecisionSessionCurrent,
  compileRepoDecisionSession,
  decisionPlaneEnabled,
  loadRepoCharter,
  loadRepoDecision,
  loadRepoWorld,
  isProtectedRepoDecisionPlanePath,
  ownerDirectiveDigest,
  readDecisionConsumption,
  readDecisionResult,
  recordRepoDecisionAttempt,
  recordRepoDecisionResult,
  repoDecisionDigestFromSession,
  repositoryExecutionBaseDigest,
  requireRepoDecisionPlaneWork,
  validateRepoCharter,
  validateRepoDecision,
  validateRepoWorld,
};
