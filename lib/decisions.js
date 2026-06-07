"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { UsageError } = require("./errors");
const { readJsonFile, writeJsonFile } = require("./json");
const { ensureDir } = require("./paths");
const { stableJson, stateHash } = require("./state-hash");

const DEFAULT_INBOX = ".meta-harness/decision-inbox.json";
const DEFAULT_PM_BRIEF = ".meta-harness/pm-brief.md";
const DEFAULT_REASK_WHEN = "source classification state hash changes";
const DIRTY_REASK_WHEN = "file state, scope hash, or credential/provider/runtime boundary changes";
const GIT_TIMEOUT_MS = 20_000;
const GIT_MAX_BUFFER = 10 * 1024 * 1024;
const DECISION_LIMIT = 10;
const PATH_LIMIT = 10;
const ALLOWED_STATUSES = new Set(["open", "approved", "rejected", "deferred"]);
const ALLOWED_RESOLUTIONS = new Set(["approved", "rejected", "deferred"]);
const ALLOWED_KINDS = new Set(["user_decision"]);
const ALLOWED_RECOMMENDATIONS = new Set(["approve", "reject", "defer", "hold"]);

function fail(message) { throw new UsageError(message); }

function parseArgs(argv) {
  const positional = [];
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      positional.push(token);
      continue;
    }
    const key = token.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    const next = argv[index + 1];
    if (next === undefined || next.startsWith("--")) {
      addOption(options, key, true);
    } else {
      addOption(options, key, next);
      index += 1;
    }
  }
  return { positional, options };
}

function addOption(options, key, value) {
  if (Object.prototype.hasOwnProperty.call(options, key)) {
    const current = options[key];
    options[key] = Array.isArray(current) ? [...current, value] : [current, value];
  } else {
    options[key] = value;
  }
}

function toSlash(value) { return value.split(path.sep).join("/"); }

function resolveGitRoot(cwd) {
  const result = spawnSync("git", ["rev-parse", "--show-toplevel"], {
    cwd,
    encoding: "utf8",
    shell: false,
    timeout: GIT_TIMEOUT_MS,
    maxBuffer: GIT_MAX_BUFFER,
  });
  if (result.error || result.status !== 0) {
    fail(`decision commands require a git repository: ${(result.stderr || result.error?.message || "git rev-parse failed").trim()}`);
  }
  return path.resolve(result.stdout.trim());
}

function requireCliValue(value, label) {
  if (Array.isArray(value)) {
    fail(`${label} must be provided once`);
  }
  if (value === undefined || value === null || value === true || String(value).trim() === "") {
    fail(`${label} requires a value`);
  }
  return String(value).trim();
}

function requireOptionValue(value, label) {
  return requireCliValue(value, label);
}

function optionalCliValue(value, label, fallback = undefined) {
  if (value === undefined || value === null) return fallback;
  return requireCliValue(value, label);
}

function optionValues(value, label) {
  if (value === undefined || value === null) return [];
  const values = Array.isArray(value) ? value : [value];
  return values.map((item) => requireCliValue(item, label));
}

function optionOrDefault(options, key, fallback) {
  return Object.prototype.hasOwnProperty.call(options, key) ? options[key] : fallback;
}

function isInside(targetPath, rootPath) {
  const relative = path.relative(rootPath, targetPath);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function isUnderHarness(repoRoot, targetPath) {
  return isInside(targetPath, path.join(repoRoot, ".meta-harness"));
}

function resolveRepoPath(repoRoot, rawPath, label, options = {}) {
  const value = requireOptionValue(rawPath, label);
  const resolved = path.resolve(repoRoot, value);
  if (!isInside(resolved, repoRoot)) {
    fail(`${label} must stay inside the repository root: ${value}`);
  }
  if (options.write && !isUnderHarness(repoRoot, resolved)) {
    fail(`${label} writes must stay under .meta-harness: ${value}`);
  }
  return resolved;
}

function relativeRepoPath(repoRoot, targetPath) {
  return toSlash(path.relative(repoRoot, targetPath));
}

function canonicalArray(values = []) {
  return [...new Set(values.map((item) => String(item).trim()).filter((item) => item.length > 0))]
    .sort((left, right) => left.localeCompare(right));
}

function canonicalDecisionIdentity(input) {
  const kind = requireCliValue(input.kind, "decision kind");
  if (!ALLOWED_KINDS.has(kind)) {
    fail(`decision kind must be one of: ${[...ALLOWED_KINDS].join("|")}`);
  }
  const question = requireCliValue(input.question, "decision question");
  const recommended = optionalCliValue(input.recommended, "decision recommendation", "hold");
  if (!ALLOWED_RECOMMENDATIONS.has(recommended)) {
    fail(`decision recommendation must be one of: ${[...ALLOWED_RECOMMENDATIONS].join("|")}`);
  }
  const sourceStateHash = requireCliValue(input.state_hash || input.stateHash, "decision state hash");
  const reaskWhen = optionalCliValue(input.reask_when || input.reaskWhen, "decision reask_when", DEFAULT_REASK_WHEN);
  return {
    kind,
    question,
    recommended,
    assumptions: canonicalArray(input.assumptions),
    reask_when: reaskWhen,
    source_state_hash: sourceStateHash,
  };
}

function decisionIdentity(input) {
  const identity = canonicalDecisionIdentity(input);
  const identityKey = stableJson(identity);
  return {
    identity,
    assumption_hash: stateHash(identity.assumptions),
    identity_hash: stateHash(identity),
    identity_key: identityKey,
  };
}

function normalizeDecision(rawDecision, index) {
  const identityData = decisionIdentity(rawDecision);
  const status = rawDecision.status || "open";
  if (!ALLOWED_STATUSES.has(status)) {
    fail(`invalid decision status at index ${index}: ${status}`);
  }
  const id = requireCliValue(rawDecision.id, `decision id at index ${index}`);
  return {
    id,
    kind: identityData.identity.kind,
    question: identityData.identity.question,
    recommended: identityData.identity.recommended,
    state_hash: identityData.identity.source_state_hash,
    assumption_hash: identityData.assumption_hash,
    identity_hash: identityData.identity_hash,
    identity_key: identityData.identity_key,
    assumptions: identityData.identity.assumptions,
    reask_when: identityData.identity.reask_when,
    status,
    evidence: canonicalArray(rawDecision.evidence),
  };
}

function validateInbox(rawInbox) {
  const source = rawInbox && typeof rawInbox === "object" ? rawInbox : {};
  const decisions = Array.isArray(source.decisions) ? source.decisions : [];
  const normalized = decisions.map((decision, index) => normalizeDecision(decision, index));
  const seenIds = new Map();
  const seenIdentityHashes = new Map();
  for (const decision of normalized) {
    if (seenIds.has(decision.id)) {
      fail(`duplicate decision id: ${decision.id}`);
    }
    const seenIdentityKey = seenIdentityHashes.get(decision.identity_hash);
    if (seenIdentityKey !== undefined && seenIdentityKey !== decision.identity_key) {
      fail("decision identity hash collision detected");
    }
    if (seenIdentityKey === decision.identity_key) {
      fail(`duplicate decision identity_hash: ${decision.identity_hash}`);
    }
    seenIds.set(decision.id, decision);
    seenIdentityHashes.set(decision.identity_hash, decision.identity_key);
  }
  return { v: 1, decisions: normalized };
}

function readInbox(inboxPath) {
  return validateInbox(readJsonFile(inboxPath, { v: 1, decisions: [] }));
}

function writeInbox(inboxPath, inbox) {
  ensureDir(path.dirname(inboxPath));
  writeJsonFile(inboxPath, validateInbox(inbox));
}

function findDecisionByIdentity(inbox, identityHash, identityKey) {
  return inbox.decisions.find((decision) => {
    if (decision.identity_hash !== identityHash) return false;
    if (decision.identity_key && decision.identity_key !== identityKey) {
      fail("decision identity hash collision detected");
    }
    return true;
  });
}

function makeDecisionId(identityHash, identityKey, decisions, minimumLength = 10) {
  const fullHashCollision = decisions.find((decision) => (
    decision.identity_hash === identityHash
    && decision.identity_key
    && decision.identity_key !== identityKey
  ));
  if (fullHashCollision) {
    fail("decision identity hash collision detected");
  }
  for (let length = minimumLength; length <= identityHash.length; length += 1) {
    const id = `D-${identityHash.slice(0, length)}`;
    const collision = decisions.find((decision) => decision.id === id);
    if (!collision) return id;
    if (collision.identity_hash === identityHash && collision.identity_key === identityKey) return id;
  }
  fail("decision id collision could not be resolved");
}

function upsertDecision(inbox, input) {
  const identityData = decisionIdentity(input);
  const existingIdentity = findDecisionByIdentity(inbox, identityData.identity_hash, identityData.identity_key);
  if (existingIdentity) {
    existingIdentity.evidence = canonicalArray([...existingIdentity.evidence, ...(input.evidence || [])]);
    return { decision: existingIdentity, created: false };
  }
  const decision = {
    id: makeDecisionId(identityData.identity_hash, identityData.identity_key, inbox.decisions),
    kind: identityData.identity.kind,
    question: identityData.identity.question,
    recommended: identityData.identity.recommended,
    state_hash: identityData.identity.source_state_hash,
    assumption_hash: identityData.assumption_hash,
    identity_hash: identityData.identity_hash,
    identity_key: identityData.identity_key,
    assumptions: identityData.identity.assumptions,
    reask_when: identityData.identity.reask_when,
    status: "open",
    evidence: canonicalArray(input.evidence),
  };
  inbox.decisions.push(decision);
  inbox.decisions.sort((left, right) => left.id.localeCompare(right.id));
  return { decision, created: true };
}

function dirtyDecisionInput(item, dirtyOutputPath) {
  if (!item || item.action !== "DECISION") return undefined;
  const sourceStateHash = requireCliValue(item.decision_state_hash, `dirty DECISION state hash for ${item.path || "unknown path"}`);
  const itemPath = requireCliValue(item.path, "dirty DECISION path");
  return {
    kind: "user_decision",
    question: `Approve touching inherited dirty path ${itemPath}?`,
    recommended: "hold",
    state_hash: sourceStateHash,
    assumptions: ["dirty path existed before current scope", "path overlaps owned scope"],
    reask_when: DIRTY_REASK_WHEN,
    evidence: [dirtyOutputPath],
  };
}

function importDirtyDecisions(repoRoot, scope, result, dirtyOutputPath) {
  const decisionItems = (result.classifications || []).filter((item) => item.action === "DECISION");
  if (decisionItems.length === 0) return { imported: 0, reused: 0 };
  const inboxPath = resolveRepoPath(repoRoot, scope.decision_inbox_path || DEFAULT_INBOX, "decision inbox", { write: true });
  const inbox = readInbox(inboxPath);
  let imported = 0;
  let reused = 0;
  for (const item of decisionItems) {
    const { created } = upsertDecision(inbox, dirtyDecisionInput(item, dirtyOutputPath));
    if (created) imported += 1;
    else reused += 1;
  }
  writeInbox(inboxPath, inbox);
  return { imported, reused };
}

function limitedList(items, limit, render) {
  const visible = items.slice(0, limit).map(render);
  const remaining = items.length - visible.length;
  if (remaining > 0) {
    visible.push(`- ... and ${remaining} more`);
  }
  return visible.length === 0 ? ["- none"] : visible;
}

function dirtySummaryValue(dirty, key) {
  return Number(dirty.summary?.[key] || 0);
}

function renderPmBrief(dirty, inbox, paths) {
  const openDecisions = inbox.decisions.filter((decision) => decision.status === "open");
  const blockers = (dirty.classifications || [])
    .filter((item) => ["BLOCK", "ESCALATE"].includes(item.action))
    .sort((left, right) => `${left.action}:${left.path}`.localeCompare(`${right.action}:${right.path}`));
  const blockerCount = blockers.filter((item) => item.action === "BLOCK").length;
  const escalationCount = blockers.filter((item) => item.action === "ESCALATE").length;
  const queuedCount = dirtySummaryValue(dirty, "queued");
  const suppressedCount = dirtySummaryValue(dirty, "suppressed");
  const nextAction = blockers.length > 0
    ? "Resolve current blockers/escalations before continuing."
    : openDecisions.length > 0
      ? "Resolve open decisions or keep them deferred before expanding scope."
      : "No current user decision is needed.";
  return [
    "# PM Brief",
    "",
    "## Outcome / Result",
    "",
    `Open decisions: ${openDecisions.length}`,
    `Current blockers: ${blockerCount}`,
    `Current escalations: ${escalationCount}`,
    "",
    "## Open decisions",
    "",
    ...limitedList(openDecisions, DECISION_LIMIT, (decision) => `- ${decision.id}: ${decision.question} (recommended: ${decision.recommended})`),
    "",
    "## Current blockers / escalations",
    "",
    ...limitedList(blockers, PATH_LIMIT, (item) => `- ${item.action}: ${item.path} (${item.classification})`),
    "",
    "## Suppressed dirty work summary",
    "",
    `Queued items: ${queuedCount}`,
    `Suppressed items: ${suppressedCount}`,
    "",
    "## Evidence",
    "",
    `- Dirty classification: ${paths.dirtyPath}`,
    `- Dirty state hash: ${dirty.state_hash || "not recorded"}`,
    `- Decision inbox: ${paths.decisionsPath}`,
    `- Decision inbox count: ${inbox.decisions.length}`,
    "",
    "## Next action",
    "",
    nextAction,
    "",
  ].join("\n");
}

function commandDecisions(argv, context = {}) {
  const repoRoot = resolveGitRoot(context.cwd || process.cwd());
  const { positional, options } = parseArgs(argv);
  const action = positional[0];
  const inboxPath = resolveRepoPath(repoRoot, optionOrDefault(options, "in", DEFAULT_INBOX), "decision inbox", { write: ["add", "resolve"].includes(action) });
  const inbox = readInbox(inboxPath);

  if (action === "list") {
    const openDecisions = inbox.decisions.filter((decision) => decision.status === "open");
    if (openDecisions.length === 0) {
      console.log("No open decisions.");
      return;
    }
    for (const decision of openDecisions) {
      console.log(`${decision.id}\t${decision.recommended}\t${decision.question}`);
    }
    return;
  }

  if (action === "add") {
    const input = {
      kind: requireCliValue(options.kind, "--kind"),
      question: requireCliValue(options.question, "--question"),
      recommended: optionalCliValue(options.recommended, "--recommended", "hold"),
      state_hash: requireCliValue(options.stateHash, "--state-hash"),
      assumptions: optionValues(options.assumption, "--assumption"),
      reask_when: optionalCliValue(options.reaskWhen, "--reask-when", DEFAULT_REASK_WHEN),
      evidence: optionValues(options.evidence, "--evidence"),
    };
    const { decision, created } = upsertDecision(inbox, input);
    writeInbox(inboxPath, inbox);
    console.log(`${created ? "Added" : "Reused"} decision: ${decision.id}`);
    return;
  }

  if (action === "resolve") {
    const id = requireCliValue(options.id, "--id");
    const resolution = requireCliValue(options.resolution, "--resolution");
    if (!ALLOWED_RESOLUTIONS.has(resolution)) {
      fail(`decision resolution must be one of: ${[...ALLOWED_RESOLUTIONS].join("|")}`);
    }
    const decision = inbox.decisions.find((item) => item.id === id);
    if (!decision) {
      fail(`decision not found: ${id}`);
    }
    decision.status = resolution;
    writeInbox(inboxPath, inbox);
    console.log(`Resolved decision: ${id} -> ${resolution}`);
    return;
  }

  fail(`unknown decisions action: ${action || "missing"}`);
}

function commandBrief(argv, context = {}) {
  const repoRoot = resolveGitRoot(context.cwd || process.cwd());
  const { positional, options } = parseArgs(argv);
  if (positional[0] !== "pm") {
    fail(`unknown brief action: ${positional[0] || "missing"}`);
  }
  const dirtyPath = resolveRepoPath(repoRoot, options.dirty, "--dirty");
  const decisionsPath = resolveRepoPath(repoRoot, optionOrDefault(options, "decisions", DEFAULT_INBOX), "--decisions");
  const outPath = resolveRepoPath(repoRoot, optionOrDefault(options, "out", DEFAULT_PM_BRIEF), "--out", { write: true });
  if (!fs.existsSync(dirtyPath)) fail(`dirty classification file not found: ${relativeRepoPath(repoRoot, dirtyPath)}`);
  const dirty = readJsonFile(dirtyPath);
  const inbox = readInbox(decisionsPath);
  const brief = renderPmBrief(dirty, inbox, {
    dirtyPath: relativeRepoPath(repoRoot, dirtyPath),
    decisionsPath: relativeRepoPath(repoRoot, decisionsPath),
  });
  ensureDir(path.dirname(outPath));
  fs.writeFileSync(outPath, brief, "utf8");
  process.stdout.write(brief);
}

module.exports = {
  commandBrief,
  commandDecisions,
  importDirtyDecisions,
  renderPmBrief,
  validateInbox,
  _test: { makeDecisionId },
};
