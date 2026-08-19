"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const { domainDigest, isDigest } = require("./contracts/digest");
const { ConfigError } = require("./errors");
const { createOutcome, persistOutcome } = require("./outcome");
const { acquireOutcomeClaimSession } = require("./outcome-claim");
const { pinProductDirection } = require("./product-direction");
const { compileProductProofSpec } = require("./work-proof-compiler");
const { WORK_SESSION_SCHEMA, sealWorkSession, validRelativePath } = require("./work-session");

const REPO_PROPOSAL_SET_SCHEMA = "repo-proposal-set/v2";
const REPO_PROPOSAL_SET_DOMAIN = "meta-harness-repo-proposal-set-bytes/v2";
const REPO_PROPOSALS_RELATIVE_PATH = path.join(".meta-harness", "repo-proposals.json");
const REPO_CHARTER_DOMAIN = "meta-harness-repo-charter-bytes/v2";
const REPO_CHARTER_RELATIVE_PATH = path.join(".meta-harness", "repo-charter.json");
const OWNER_DIRECTIVE_RELATIVE_PATH = path.join(".meta-harness", "owner-directive.md");
const MAX_CONTROL_BYTES = 512 * 1024;
const MAX_OWNER_DIRECTIVE_BYTES = 128 * 1024;

function fail(code, message, details) {
  throw new ConfigError(message, { code, details });
}

function exactKeys(value, expected, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("MH_REPO_PROPOSAL_SHAPE", `${label} must be an object`);
  }
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (JSON.stringify(actual) !== JSON.stringify(wanted)) {
    fail("MH_REPO_PROPOSAL_SHAPE", `${label} has missing or unexpected fields`, { actual, expected: wanted });
  }
}

function nonEmptyString(value, label) {
  if (typeof value !== "string" || value.trim() === "") {
    fail("MH_REPO_PROPOSAL_VALUE", `${label} must be a non-empty string`);
  }
  return value;
}

function requireDigest(value, label) {
  if (!isDigest(value)) fail("MH_REPO_PROPOSAL_DIGEST", `${label} must be a sha256 digest`);
  return value;
}

function stringList(value, label, { min = 0 } = {}) {
  if (!Array.isArray(value) || value.length < min) {
    fail("MH_REPO_PROPOSAL_VALUE", `${label} must contain at least ${min} item(s)`);
  }
  const normalized = value.map((entry, index) => nonEmptyString(entry, `${label}[${index}]`));
  if (new Set(normalized).size !== normalized.length) {
    fail("MH_REPO_PROPOSAL_VALUE", `${label} must not contain duplicates`);
  }
  return normalized;
}

function readRegularBytes(repositoryPath, relativePath, { optional = false, maxBytes = MAX_CONTROL_BYTES } = {}) {
  const filePath = path.resolve(repositoryPath, relativePath);
  let stat;
  try {
    stat = fs.lstatSync(filePath);
  } catch (error) {
    if (optional && error?.code === "ENOENT") return null;
    fail("MH_REPO_PROPOSAL_READ", `${relativePath} is missing or unreadable: ${error.message}`);
  }
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > maxBytes) {
    fail("MH_REPO_PROPOSAL_READ", `${relativePath} must be a regular non-symlink file no larger than ${maxBytes} bytes`);
  }
  return fs.readFileSync(filePath);
}

function bytesDomainDigest(domain, bytes) {
  return domainDigest(domain, { content: bytes.toString("utf8") });
}

function loadRepoCharter(repositoryPath) {
  const bytes = readRegularBytes(repositoryPath, REPO_CHARTER_RELATIVE_PATH);
  return Object.freeze({
    bytes,
    digest: bytesDomainDigest(REPO_CHARTER_DOMAIN, bytes),
    path: path.resolve(repositoryPath, REPO_CHARTER_RELATIVE_PATH),
  });
}

function ownerDirectiveDigest(repositoryPath) {
  const bytes = readRegularBytes(repositoryPath, OWNER_DIRECTIVE_RELATIVE_PATH, {
    optional: true,
    maxBytes: MAX_OWNER_DIRECTIVE_BYTES,
  });
  if (!bytes) return null;
  return `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
}

function repoControlPlaneEnabled(repositoryPath) {
  const charterPath = path.resolve(repositoryPath, REPO_CHARTER_RELATIVE_PATH);
  try {
    const stat = fs.lstatSync(charterPath);
    return stat.isFile() && !stat.isSymbolicLink();
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    fail("MH_REPO_CHARTER_READ", `repo charter is unreadable: ${error.message}`);
  }
}

function validateValidationCommand(value, index) {
  const label = `repoProposalSet.proposals[?].validation[${index}]`;
  exactKeys(value, ["argv", "cwd", "timeoutSeconds"], label);
  if (!Array.isArray(value.argv) || value.argv.length === 0 || value.argv.length > 200) {
    fail("MH_REPO_PROPOSAL_VALIDATION", `${label}.argv must contain 1-200 arguments`);
  }
  value.argv.forEach((entry, argIndex) => nonEmptyString(entry, `${label}.argv[${argIndex}]`));
  if (value.cwd !== "." && !validRelativePath(value.cwd)) {
    fail("MH_REPO_PROPOSAL_VALIDATION", `${label}.cwd is invalid`);
  }
  if (!Number.isInteger(value.timeoutSeconds) || value.timeoutSeconds < 1 || value.timeoutSeconds > 3600) {
    fail("MH_REPO_PROPOSAL_VALIDATION", `${label}.timeoutSeconds must be 1-3600`);
  }
}

function validateProposal(value, index) {
  const label = `repoProposalSet.proposals[${index}]`;
  exactKeys(value, [
    "id",
    "productResult",
    "journeyState",
    "doNow",
    "newlyTrueBehavior",
    "doneWhen",
    "stopOnlyIf",
    "allowedPaths",
    "validation",
    "maxAttempts",
    "delivery",
  ], label);
  for (const field of ["id", "productResult", "journeyState", "doNow", "newlyTrueBehavior", "doneWhen"]) {
    nonEmptyString(value[field], `${label}.${field}`);
  }
  stringList(value.stopOnlyIf, `${label}.stopOnlyIf`, { min: 1 });
  const allowedPaths = stringList(value.allowedPaths, `${label}.allowedPaths`, { min: 1 });
  allowedPaths.forEach((allowedPath) => {
    if (!validRelativePath(allowedPath)) fail("MH_REPO_PROPOSAL_PATH", `invalid proposal path: ${allowedPath}`);
  });
  if (!Array.isArray(value.validation) || value.validation.length === 0) {
    fail("MH_REPO_PROPOSAL_VALIDATION", `${label}.validation must contain controller validation`);
  }
  value.validation.forEach(validateValidationCommand);
  if (!Number.isInteger(value.maxAttempts) || value.maxAttempts < 1 || value.maxAttempts > 3) {
    fail("MH_REPO_PROPOSAL_VALUE", `${label}.maxAttempts must be 1-3`);
  }
  exactKeys(value.delivery, ["commit", "push"], `${label}.delivery`);
  if (typeof value.delivery.commit !== "boolean"
      || typeof value.delivery.push !== "boolean"
      || (value.delivery.push && !value.delivery.commit)) {
    fail("MH_REPO_PROPOSAL_VALUE", `${label}.delivery must be boolean and push requires commit authority`);
  }
  return Object.freeze(JSON.parse(JSON.stringify(value)));
}

function validateRepoProposalSet(value) {
  exactKeys(value, [
    "schemaVersion",
    "productDirectionDigest",
    "charterDigest",
    "worldHeadDigest",
    "ownerDirectiveDigest",
    "proposals",
  ], "repoProposalSet");
  if (value.schemaVersion !== REPO_PROPOSAL_SET_SCHEMA) {
    fail("MH_REPO_PROPOSAL_SCHEMA", `repoProposalSet.schemaVersion must be ${REPO_PROPOSAL_SET_SCHEMA}`);
  }
  requireDigest(value.productDirectionDigest, "repoProposalSet.productDirectionDigest");
  requireDigest(value.charterDigest, "repoProposalSet.charterDigest");
  requireDigest(value.worldHeadDigest, "repoProposalSet.worldHeadDigest");
  if (value.ownerDirectiveDigest !== null) requireDigest(value.ownerDirectiveDigest, "repoProposalSet.ownerDirectiveDigest");
  if (!Array.isArray(value.proposals)) fail("MH_REPO_PROPOSAL_VALUE", "repoProposalSet.proposals must be an array");
  const proposals = value.proposals.map(validateProposal);
  const ids = proposals.map((proposal) => proposal.id);
  if (new Set(ids).size !== ids.length) fail("MH_REPO_PROPOSAL_VALUE", "repoProposalSet proposal ids must be unique");
  return Object.freeze({ ...JSON.parse(JSON.stringify(value)), proposals: Object.freeze(proposals) });
}

function assertBinding(label, expected, actual) {
  if (expected !== actual) {
    fail("MH_REPO_PROPOSAL_STALE", `${label} changed; recompute repo-proposals`, { expected, actual });
  }
}

function loadRepoProposalSet(repositoryPath, worldState) {
  if (!worldState?.head || !worldState?.world || worldState.head.schemaVersion !== "world-head/v2"
      || !/^[a-f0-9]{40,64}$/u.test(String(worldState.head.productCommit || ""))) {
    fail("MH_REPO_PROPOSAL_WORLD", "active repo proposals require authoritative world-head/v2 with productCommit");
  }
  const direction = pinProductDirection(repositoryPath);
  const charter = loadRepoCharter(repositoryPath);
  const bytes = readRegularBytes(repositoryPath, REPO_PROPOSALS_RELATIVE_PATH);
  let parsed;
  try {
    parsed = JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    fail("MH_REPO_PROPOSAL_JSON", `${REPO_PROPOSALS_RELATIVE_PATH} is invalid JSON: ${error.message}`);
  }
  const value = validateRepoProposalSet(parsed);
  assertBinding("authoritative World product direction", direction.digest, worldState.world.productDirectionDigest);
  assertBinding("product direction", direction.digest, value.productDirectionDigest);
  assertBinding("repo charter", charter.digest, value.charterDigest);
  assertBinding("authoritative WorldHead", worldState.head.headDigest, value.worldHeadDigest);
  assertBinding("owner directive", ownerDirectiveDigest(repositoryPath), value.ownerDirectiveDigest);
  return Object.freeze({
    value,
    bytes,
    digest: bytesDomainDigest(REPO_PROPOSAL_SET_DOMAIN, bytes),
    path: path.resolve(repositoryPath, REPO_PROPOSALS_RELATIVE_PATH),
    direction,
    charterDigest: charter.digest,
    worldHeadDigest: worldState.head.headDigest,
    productCommit: worldState.head.productCommit,
  });
}

function outcomeForProposal(repositoryPath, proposal) {
  const value = validateProposal(proposal, 0);
  return persistOutcome(repositoryPath, createOutcome({
    id: value.id,
    desiredState: value.productResult,
    preconditions: [value.journeyState],
    evidenceRequirement: value.doneWhen,
  }));
}

function prepareRepoProposal(repositoryPath, loadedProposalSet, proposal, { outcome = null } = {}) {
  const value = validateProposal(proposal, 0);
  const preparedOutcome = outcome || outcomeForProposal(repositoryPath, value);
  const base = { type: "EXACT_COMMIT", commit: loadedProposalSet.productCommit };
  const productProofSpec = compileProductProofSpec({
    repositoryPath,
    productDirection: loadedProposalSet.direction,
    base,
    productResult: value.productResult,
    newlyTrueBehavior: value.newlyTrueBehavior,
    doneWhen: value.doneWhen,
    allowModel: false,
  });
  return Object.freeze({ proposal: value, outcome: preparedOutcome, productProofSpec, base });
}

function admitPreparedRepoProposal(repositoryPath, loadedProposalSet, prepared, { now = new Date() } = {}) {
  const action = prepared.proposal;
  return acquireOutcomeClaimSession({
    repositoryPath,
    outcomeDigest: prepared.outcome.outcomeDigest,
    originWorldHeadDigest: loadedProposalSet.worldHeadDigest,
    executionBoundary: { writePaths: action.allowedPaths },
    now,
    buildSession: (claim) => sealWorkSession({
      schemaVersion: WORK_SESSION_SCHEMA,
      productDirection: loadedProposalSet.direction,
      origin: {
        type: "REPO_OUTCOME",
        outcomeDigest: prepared.outcome.outcomeDigest,
        claimDigest: claim.claimDigest,
      },
      base: prepared.base,
      productResult: action.productResult,
      journeyState: action.journeyState,
      doNow: action.doNow,
      newlyTrueBehavior: action.newlyTrueBehavior,
      doneWhen: action.doneWhen,
      productProofSpec: prepared.productProofSpec,
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
        "Change repository World/proposal authority or repository interpretation semantics.",
        "Supply credentials or approve protected access.",
        "Approve publication, destructive operations, or material risk.",
      ],
      allowedPaths: action.allowedPaths,
      validation: action.validation,
      maxAttempts: action.maxAttempts,
      delivery: action.delivery,
    }),
  });
}

module.exports = {
  OWNER_DIRECTIVE_RELATIVE_PATH,
  REPO_CHARTER_DOMAIN,
  REPO_CHARTER_RELATIVE_PATH,
  REPO_PROPOSALS_RELATIVE_PATH,
  REPO_PROPOSAL_SET_DOMAIN,
  REPO_PROPOSAL_SET_SCHEMA,
  admitPreparedRepoProposal,
  loadRepoCharter,
  loadRepoProposalSet,
  outcomeForProposal,
  ownerDirectiveDigest,
  prepareRepoProposal,
  repoControlPlaneEnabled,
  validateProposal,
  validateRepoProposalSet,
};
