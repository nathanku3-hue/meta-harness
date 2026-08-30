"use strict";

const fs = require("node:fs");
const path = require("node:path");

const { domainDigest, isDigest } = require("./contracts/digest");
const { ConfigError } = require("./errors");
const {
  dirtyManifestDigest,
  validateAttemptEntry,
  validateExecutionPermit,
} = require("./execution-permit");
const { validateProposalWorkerPacket } = require("./proposal-worker-packet");
const { validateWorkerResult } = require("./worker-result");
const { validateWorkspaceCustody } = require("./workspace-custody");

const PROPOSAL_DISPATCH_INTENT_SCHEMA = "proposal-dispatch-intent/v1";
const PROPOSAL_DISPATCH_INTENT_DOMAIN = "meta-harness-proposal-dispatch-intent/v1";
const PROPOSAL_DISPATCH_RECEIPT_SCHEMA = "proposal-dispatch-receipt/v1";
const PROPOSAL_DISPATCH_RECEIPT_DOMAIN = "meta-harness-proposal-dispatch-receipt/v1";
const PROPOSAL_DISPATCH_RESULT_SCHEMA = "proposal-dispatch-result/v1";
const PROPOSAL_DISPATCH_RESULT_DOMAIN = "meta-harness-proposal-dispatch-result/v1";
const PROPOSAL_CONTEXT_TELEMETRY_SCHEMA = "proposal-context-telemetry/v1";
const PROPOSAL_CONTEXT_TELEMETRY_DOMAIN = "meta-harness-proposal-context-telemetry/v1";
const PROPOSAL_ENSURE_REQUEST_SCHEMA = "meta-proposal-ensure/v1";
const MAX_PROMPT_BYTES = 512 * 1024;
const MAX_SCHEMA_BYTES = 256 * 1024;

function fail(code, message, details) {
  throw new ConfigError(message, { code, details });
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

function exactKeys(value, expected, label, code = "MH_PROPOSAL_DISPATCH_SHAPE") {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail(code, `${label} must be an object`);
  }
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.join("\0") !== wanted.join("\0")) {
    fail(code, `${label} has missing or unexpected fields`, { actual, expected: wanted });
  }
}

function nonEmptyString(value, label, code = "MH_PROPOSAL_DISPATCH_VALUE") {
  if (typeof value !== "string" || value.trim() === "") fail(code, `${label} must be a non-empty string`);
  return value;
}

function pathIdentity(value) {
  const resolved = path.resolve(nonEmptyString(value, "path"));
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function samePath(left, right) {
  return pathIdentity(left) === pathIdentity(right);
}

function intentBody(value) {
  const body = JSON.parse(JSON.stringify(value));
  delete body.intentDigest;
  return body;
}

function receiptBody(value) {
  const body = JSON.parse(JSON.stringify(value));
  delete body.receiptDigest;
  return body;
}

function computeProposalDispatchIntentDigest(value) {
  return domainDigest(PROPOSAL_DISPATCH_INTENT_DOMAIN, intentBody(value));
}

function computeProposalDispatchReceiptDigest(value) {
  return domainDigest(PROPOSAL_DISPATCH_RECEIPT_DOMAIN, receiptBody(value));
}

function resultBody(value) {
  const body = JSON.parse(JSON.stringify(value));
  delete body.resultRecordDigest;
  return body;
}

function computeProposalDispatchResultDigest(value) {
  return domainDigest(PROPOSAL_DISPATCH_RESULT_DOMAIN, resultBody(value));
}

function telemetryBody(value) {
  const body = JSON.parse(JSON.stringify(value));
  delete body.telemetryRecordDigest;
  return body;
}

function computeProposalContextTelemetryDigest(value) {
  return domainDigest(PROPOSAL_CONTEXT_TELEMETRY_DOMAIN, telemetryBody(value));
}

function validateHostProposalTelemetry(value, receipt) {
  exactKeys(value, [
    "schemaVersion",
    "authority",
    "taskId",
    "taskDigest",
    "packetDigest",
    "promptBytes",
    "resultBytes",
    "activationCount",
    "timeToSubmitMs",
    "readCalls",
    "readBytes",
    "fileReads",
    "searchCalls",
    "searches",
    "truncated",
    "createdAt",
    "updatedAt",
  ], "proposal host context telemetry", "MH_PROPOSAL_TELEMETRY");
  if (value.schemaVersion !== "meta-proposal-context-telemetry/v1"
      || value.authority !== "NON_AUTHORITATIVE_OBSERVATION"
      || value.taskId !== receipt.taskId
      || value.taskDigest !== receipt.taskDigest
      || value.packetDigest !== receipt.packetDigest) {
    fail("MH_PROPOSAL_TELEMETRY", "proposal host telemetry does not match the exact task receipt");
  }
  for (const field of ["promptBytes", "activationCount", "readCalls", "readBytes", "searchCalls"]) {
    if (!Number.isInteger(value[field]) || value[field] < 0) fail("MH_PROPOSAL_TELEMETRY", `proposal host telemetry ${field} must be non-negative`);
  }
  for (const field of ["resultBytes", "timeToSubmitMs"]) {
    if (value[field] !== null && (!Number.isInteger(value[field]) || value[field] < 0)) {
      fail("MH_PROPOSAL_TELEMETRY", `proposal host telemetry ${field} must be null or non-negative`);
    }
  }
  if (!Array.isArray(value.fileReads) || !Array.isArray(value.searches) || typeof value.truncated !== "boolean") {
    fail("MH_PROPOSAL_TELEMETRY", "proposal host telemetry repetition metrics and truncation flag are invalid");
  }
  for (const item of value.fileReads) {
    exactKeys(item, ["path", "calls", "repeatReads"], "proposal host telemetry file read", "MH_PROPOSAL_TELEMETRY");
    if (typeof item.path !== "string" || item.path.trim() === ""
        || !Number.isInteger(item.calls) || item.calls < 1
        || item.repeatReads !== Math.max(0, item.calls - 1)) {
      fail("MH_PROPOSAL_TELEMETRY", "proposal host telemetry file read is invalid");
    }
  }
  for (const item of value.searches) {
    exactKeys(item, ["queryDigest", "calls", "repeatQueries"], "proposal host telemetry search", "MH_PROPOSAL_TELEMETRY");
    if (!isDigest(item.queryDigest)
        || !Number.isInteger(item.calls) || item.calls < 1
        || item.repeatQueries !== Math.max(0, item.calls - 1)) {
      fail("MH_PROPOSAL_TELEMETRY", "proposal host telemetry search is invalid");
    }
  }
  if (!Number.isFinite(Date.parse(value.createdAt)) || !Number.isFinite(Date.parse(value.updatedAt))) {
    fail("MH_PROPOSAL_TELEMETRY", "proposal host telemetry timestamps must be ISO timestamps");
  }
  return deepFreeze(JSON.parse(JSON.stringify(value)));
}

function validateProposalContextTelemetry(value) {
  exactKeys(value, [
    "schemaVersion",
    "authority",
    "intentDigest",
    "receiptDigest",
    "sessionDigest",
    "claimDigest",
    "generation",
    "packetDigest",
    "taskId",
    "taskDigest",
    "hostTelemetry",
    "capturedAt",
    "telemetryRecordDigest",
  ], "proposal context telemetry", "MH_PROPOSAL_TELEMETRY");
  if (value.schemaVersion !== PROPOSAL_CONTEXT_TELEMETRY_SCHEMA
      || value.authority !== "NON_AUTHORITATIVE_OBSERVATION") {
    fail("MH_PROPOSAL_TELEMETRY", `proposal context telemetry schema must be ${PROPOSAL_CONTEXT_TELEMETRY_SCHEMA}`);
  }
  for (const field of ["intentDigest", "receiptDigest", "sessionDigest", "claimDigest", "packetDigest", "taskDigest", "telemetryRecordDigest"]) {
    if (!isDigest(value[field])) fail("MH_PROPOSAL_TELEMETRY", `proposal context telemetry ${field} must be a sha256 digest`);
  }
  if (!Number.isInteger(value.generation) || value.generation < 1) {
    fail("MH_PROPOSAL_TELEMETRY", "proposal context telemetry generation must be a positive integer");
  }
  nonEmptyString(value.taskId, "proposal context telemetry taskId", "MH_PROPOSAL_TELEMETRY");
  const receipt = {
    taskId: value.taskId,
    taskDigest: value.taskDigest,
    packetDigest: value.packetDigest,
  };
  const hostTelemetry = validateHostProposalTelemetry(value.hostTelemetry, receipt);
  if (!Number.isFinite(Date.parse(value.capturedAt))) fail("MH_PROPOSAL_TELEMETRY", "proposal context telemetry capturedAt must be an ISO timestamp");
  const normalized = { ...JSON.parse(JSON.stringify(value)), hostTelemetry };
  if (value.telemetryRecordDigest !== computeProposalContextTelemetryDigest(normalized)) {
    fail("MH_PROPOSAL_TELEMETRY", "proposal context telemetry digest does not match its body");
  }
  return deepFreeze(normalized);
}

function validateEnsureRequest(value) {
  exactKeys(value, ["schemaVersion", "workspaceRoot", "packet", "prompt", "workerResultSchema"], "proposal ensure request");
  if (value.schemaVersion !== PROPOSAL_ENSURE_REQUEST_SCHEMA) {
    fail("MH_PROPOSAL_DISPATCH_SCHEMA", `proposal ensure request schema must be ${PROPOSAL_ENSURE_REQUEST_SCHEMA}`);
  }
  nonEmptyString(value.workspaceRoot, "proposal ensure request workspaceRoot");
  if (typeof value.prompt !== "string" || Buffer.byteLength(value.prompt, "utf8") > MAX_PROMPT_BYTES) {
    fail("MH_PROPOSAL_DISPATCH_VALUE", `proposal ensure request prompt must be at most ${MAX_PROMPT_BYTES} bytes`);
  }
  if (!value.workerResultSchema || typeof value.workerResultSchema !== "object" || Array.isArray(value.workerResultSchema)) {
    fail("MH_PROPOSAL_DISPATCH_VALUE", "proposal ensure request workerResultSchema must be an object");
  }
  if (Buffer.byteLength(JSON.stringify(value.workerResultSchema), "utf8") > MAX_SCHEMA_BYTES) {
    fail("MH_PROPOSAL_DISPATCH_VALUE", `proposal ensure request workerResultSchema must be at most ${MAX_SCHEMA_BYTES} bytes`);
  }
  const packet = validateProposalWorkerPacket(value.packet, {
    prompt: value.prompt,
    workerResultSchema: value.workerResultSchema,
  });
  return deepFreeze({
    schemaVersion: PROPOSAL_ENSURE_REQUEST_SCHEMA,
    workspaceRoot: path.resolve(value.workspaceRoot),
    packet,
    prompt: value.prompt,
    workerResultSchema: JSON.parse(JSON.stringify(value.workerResultSchema)),
  });
}

function validateProposalDispatchIntent(value) {
  exactKeys(value, ["schemaVersion", "authority", "request", "createdAt", "intentDigest"], "proposal dispatch intent");
  if (value.schemaVersion !== PROPOSAL_DISPATCH_INTENT_SCHEMA) {
    fail("MH_PROPOSAL_DISPATCH_SCHEMA", `proposal dispatch intent schema must be ${PROPOSAL_DISPATCH_INTENT_SCHEMA}`);
  }
  exactKeys(value.authority, [
    "capability",
    "sessionDigest",
    "claimDigest",
    "outcomeDigest",
    "workspaceId",
    "generation",
    "attemptEntryDigest",
    "permitDigest",
  ], "proposal dispatch authority");
  if (value.authority.capability !== "CODE_PROPOSE") {
    fail("MH_PROPOSAL_DISPATCH_AUTHORITY", "proposal dispatch authority grants only CODE_PROPOSE");
  }
  for (const field of ["sessionDigest", "claimDigest", "outcomeDigest", "attemptEntryDigest", "permitDigest"]) {
    if (!isDigest(value.authority[field])) {
      fail("MH_PROPOSAL_DISPATCH_DIGEST", `proposal dispatch authority ${field} must be a sha256 digest`);
    }
  }
  nonEmptyString(value.authority.workspaceId, "proposal dispatch authority workspaceId");
  if (!Number.isInteger(value.authority.generation) || value.authority.generation < 1) {
    fail("MH_PROPOSAL_DISPATCH_VALUE", "proposal dispatch authority generation must be a positive integer");
  }
  const request = validateEnsureRequest(value.request);
  if (request.packet.permitDigest !== value.authority.permitDigest
      || request.packet.attemptEntryDigest !== value.authority.attemptEntryDigest) {
    fail("MH_PROPOSAL_DISPATCH_AUTHORITY", "proposal packet does not match dispatch authority provenance");
  }
  if (!Number.isFinite(Date.parse(value.createdAt))) {
    fail("MH_PROPOSAL_DISPATCH_VALUE", "proposal dispatch intent createdAt must be an ISO timestamp");
  }
  if (!isDigest(value.intentDigest) || value.intentDigest !== computeProposalDispatchIntentDigest(value)) {
    fail("MH_PROPOSAL_DISPATCH_DIGEST", "proposal dispatch intent digest does not match its body");
  }
  return deepFreeze({
    schemaVersion: value.schemaVersion,
    authority: JSON.parse(JSON.stringify(value.authority)),
    request,
    createdAt: value.createdAt,
    intentDigest: value.intentDigest,
  });
}

function validateProposalDispatchReceipt(value) {
  exactKeys(value, [
    "schemaVersion",
    "intentDigest",
    "packetDigest",
    "taskId",
    "taskDigest",
    "acceptedAt",
    "receiptDigest",
  ], "proposal dispatch receipt");
  if (value.schemaVersion !== PROPOSAL_DISPATCH_RECEIPT_SCHEMA) {
    fail("MH_PROPOSAL_DISPATCH_SCHEMA", `proposal dispatch receipt schema must be ${PROPOSAL_DISPATCH_RECEIPT_SCHEMA}`);
  }
  for (const field of ["intentDigest", "packetDigest", "taskDigest", "receiptDigest"]) {
    if (!isDigest(value[field])) fail("MH_PROPOSAL_DISPATCH_DIGEST", `proposal dispatch receipt ${field} must be a sha256 digest`);
  }
  nonEmptyString(value.taskId, "proposal dispatch receipt taskId");
  if (!Number.isFinite(Date.parse(value.acceptedAt))) {
    fail("MH_PROPOSAL_DISPATCH_VALUE", "proposal dispatch receipt acceptedAt must be an ISO timestamp");
  }
  if (value.receiptDigest !== computeProposalDispatchReceiptDigest(value)) {
    fail("MH_PROPOSAL_DISPATCH_DIGEST", "proposal dispatch receipt digest does not match its body");
  }
  return deepFreeze(JSON.parse(JSON.stringify(value)));
}

function validateProposalDispatchResult(value) {
  exactKeys(value, [
    "schemaVersion",
    "intentDigest",
    "receiptDigest",
    "packetDigest",
    "taskId",
    "taskDigest",
    "workerResult",
    "hostResultDigest",
    "capturedAt",
    "resultRecordDigest",
  ], "proposal dispatch result");
  if (value.schemaVersion !== PROPOSAL_DISPATCH_RESULT_SCHEMA) {
    fail("MH_PROPOSAL_DISPATCH_SCHEMA", `proposal dispatch result schema must be ${PROPOSAL_DISPATCH_RESULT_SCHEMA}`);
  }
  for (const field of [
    "intentDigest",
    "receiptDigest",
    "packetDigest",
    "taskDigest",
    "hostResultDigest",
    "resultRecordDigest",
  ]) {
    if (!isDigest(value[field])) fail("MH_PROPOSAL_DISPATCH_DIGEST", `proposal dispatch result ${field} must be a sha256 digest`);
  }
  nonEmptyString(value.taskId, "proposal dispatch result taskId");
  const workerResult = validateWorkerResult(value.workerResult);
  if (!Number.isFinite(Date.parse(value.capturedAt))) {
    fail("MH_PROPOSAL_DISPATCH_VALUE", "proposal dispatch result capturedAt must be an ISO timestamp");
  }
  const normalized = { ...JSON.parse(JSON.stringify(value)), workerResult };
  if (value.resultRecordDigest !== computeProposalDispatchResultDigest(normalized)) {
    fail("MH_PROPOSAL_DISPATCH_DIGEST", "proposal dispatch result digest does not match its body");
  }
  return deepFreeze(normalized);
}

function dispatchDirectory(workspaceRegistryDir, { create = false } = {}) {
  const directory = path.join(path.resolve(nonEmptyString(workspaceRegistryDir, "workspaceRegistryDir")), "proposal-dispatch");
  if (create) fs.mkdirSync(directory, { recursive: true });
  return directory;
}

function recordStem(workspaceId, generation) {
  nonEmptyString(workspaceId, "workspaceId");
  if (!Number.isInteger(generation) || generation < 1) {
    fail("MH_PROPOSAL_DISPATCH_VALUE", "proposal dispatch generation must be a positive integer");
  }
  if (!/^[a-zA-Z0-9_-]+$/u.test(workspaceId)) {
    fail("MH_PROPOSAL_DISPATCH_VALUE", "proposal dispatch workspaceId contains unsupported characters");
  }
  return `${workspaceId}.generation-${generation}`;
}

function proposalDispatchPaths({ workspaceRegistryDir, workspaceId, generation, create = false }) {
  const directory = dispatchDirectory(workspaceRegistryDir, { create });
  const stem = recordStem(workspaceId, generation);
  return Object.freeze({
    directory,
    intentPath: path.join(directory, `${stem}.intent.json`),
    receiptPath: path.join(directory, `${stem}.receipt.json`),
    resultPath: path.join(directory, `${stem}.result.json`),
    telemetryPath: path.join(directory, `${stem}.telemetry.json`),
  });
}

function readJson(filePath, code, optional) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    if (optional && error?.code === "ENOENT") return null;
    fail(code, `proposal dispatch record is unreadable: ${error.message}`);
  }
}

function writeCreateOnly(filePath, value, code) {
  let fd;
  try {
    fd = fs.openSync(filePath, "wx", 0o600);
    fs.writeFileSync(fd, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    fs.fsyncSync(fd);
  } catch (error) {
    if (error?.code === "EEXIST") throw error;
    fail(code, `cannot persist proposal dispatch record: ${error.message}`);
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

function createIntent({ session, workspace, executionPermit, attemptEntry, packet, prompt, workerResultSchema, now = new Date() }) {
  if (session?.origin?.type !== "REPO_OUTCOME") {
    fail("MH_PROPOSAL_DISPATCH_AUTHORITY", "external proposal dispatch requires a Claim-bound REPO_OUTCOME session");
  }
  const permit = validateExecutionPermit(executionPermit);
  const entry = validateAttemptEntry(attemptEntry);
  const request = validateEnsureRequest({
    schemaVersion: PROPOSAL_ENSURE_REQUEST_SCHEMA,
    workspaceRoot: workspace.workspacePath,
    packet,
    prompt,
    workerResultSchema,
  });
  if (permit.permitDigest !== entry.permitDigest
      || permit.permitDigest !== request.packet.permitDigest
      || entry.entryDigest !== request.packet.attemptEntryDigest
      || permit.authority.sessionDigest !== session.sessionDigest
      || permit.authority.workspaceId !== workspace.workspaceId
      || entry.workspaceId !== workspace.workspaceId
      || entry.generation !== permit.generation) {
    fail("MH_PROPOSAL_DISPATCH_AUTHORITY", "proposal dispatch inputs do not share one entered execution identity");
  }
  const body = {
    schemaVersion: PROPOSAL_DISPATCH_INTENT_SCHEMA,
    authority: {
      capability: "CODE_PROPOSE",
      sessionDigest: session.sessionDigest,
      claimDigest: session.origin.claimDigest,
      outcomeDigest: session.origin.outcomeDigest,
      workspaceId: workspace.workspaceId,
      generation: entry.generation,
      attemptEntryDigest: entry.entryDigest,
      permitDigest: permit.permitDigest,
    },
    request,
    createdAt: now.toISOString(),
  };
  return validateProposalDispatchIntent({
    ...body,
    intentDigest: computeProposalDispatchIntentDigest(body),
  });
}

function persistProposalDispatchIntent({
  workspaceRegistryDir,
  session,
  workspace,
  executionPermit,
  attemptEntry,
  packet,
  prompt,
  workerResultSchema,
  now = new Date(),
}) {
  const intent = createIntent({ session, workspace, executionPermit, attemptEntry, packet, prompt, workerResultSchema, now });
  const paths = proposalDispatchPaths({
    workspaceRegistryDir,
    workspaceId: intent.authority.workspaceId,
    generation: intent.authority.generation,
    create: true,
  });
  try {
    writeCreateOnly(paths.intentPath, intent, "MH_PROPOSAL_DISPATCH_INTENT_WRITE");
    return intent;
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
    const existing = validateProposalDispatchIntent(readJson(paths.intentPath, "MH_PROPOSAL_DISPATCH_INTENT_READ", false));
    if (existing.intentDigest !== intent.intentDigest) {
      fail("MH_PROPOSAL_DISPATCH_INTENT_CONFLICT", "an entered attempt already has a different durable external proposal route");
    }
    return existing;
  }
}

function readProposalDispatchIntent({ workspaceRegistryDir, workspaceId, generation, optional = false }) {
  const paths = proposalDispatchPaths({ workspaceRegistryDir, workspaceId, generation });
  const parsed = readJson(paths.intentPath, "MH_PROPOSAL_DISPATCH_INTENT_READ", optional);
  return parsed ? validateProposalDispatchIntent(parsed) : null;
}

function proposalDispatchIntentExists({ workspaceRegistryDir, workspaceId, generation }) {
  const paths = proposalDispatchPaths({ workspaceRegistryDir, workspaceId, generation });
  try {
    return fs.lstatSync(paths.intentPath).isFile();
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    fail("MH_PROPOSAL_DISPATCH_INTENT_READ", `proposal dispatch intent cannot be inspected: ${error.message}`);
  }
}

function assertProposalDispatchBinding({ intent, session, custody, attemptEntry, executionPermit, boundary }) {
  const validated = validateProposalDispatchIntent(intent);
  const currentCustody = validateWorkspaceCustody(custody);
  const entry = validateAttemptEntry(attemptEntry);
  const permit = validateExecutionPermit(executionPermit);
  if (session?.origin?.type !== "REPO_OUTCOME"
      || validated.authority.sessionDigest !== session.sessionDigest
      || validated.authority.claimDigest !== session.origin.claimDigest
      || validated.authority.outcomeDigest !== session.origin.outcomeDigest
      || validated.authority.workspaceId !== currentCustody.workspaceId
      || validated.authority.generation !== currentCustody.generation
      || validated.authority.generation !== entry.generation
      || validated.authority.attemptEntryDigest !== entry.entryDigest
      || validated.authority.permitDigest !== permit.permitDigest
      || permit.authority.workspaceId !== currentCustody.workspaceId
      || permit.authority.sessionDigest !== session.sessionDigest
      || permit.authority.workspaceCustodyDigest !== currentCustody.recordDigest
      || !samePath(validated.request.workspaceRoot, currentCustody.workspacePath)
      || !samePath(permit.authority.workspacePath, currentCustody.workspacePath)
      || permit.authority.baseHead !== currentCustody.baseHead
      || permit.authority.baselineHead !== boundary.head
      || validated.request.packet.baseline.head !== boundary.head
      || validated.request.packet.baseline.treeOid !== boundary.treeOid
      || validated.request.packet.baseline.dirtyManifestDigest !== dirtyManifestDigest(boundary)) {
    fail("MH_PROPOSAL_DISPATCH_STALE", "durable proposal dispatch no longer matches the exact entered workspace attempt");
  }
  return validated;
}

function assertRecoveredProposalDispatchBinding({ intent, session, custody, attemptEntry, boundary }) {
  const validated = validateProposalDispatchIntent(intent);
  const currentCustody = validateWorkspaceCustody(custody);
  const entry = validateAttemptEntry(attemptEntry);
  if (session?.origin?.type !== "REPO_OUTCOME"
      || validated.authority.sessionDigest !== session.sessionDigest
      || validated.authority.claimDigest !== session.origin.claimDigest
      || validated.authority.outcomeDigest !== session.origin.outcomeDigest
      || validated.authority.workspaceId !== currentCustody.workspaceId
      || validated.authority.generation !== currentCustody.generation
      || validated.authority.generation !== entry.generation
      || validated.authority.attemptEntryDigest !== entry.entryDigest
      || validated.authority.permitDigest !== entry.permitDigest
      || validated.request.packet.permitDigest !== entry.permitDigest
      || validated.request.packet.attemptEntryDigest !== entry.entryDigest
      || !samePath(validated.request.workspaceRoot, currentCustody.workspacePath)
      || validated.request.packet.baseline.head !== boundary.head
      || validated.request.packet.baseline.treeOid !== boundary.treeOid
      || validated.request.packet.baseline.dirtyManifestDigest !== dirtyManifestDigest(boundary)) {
    fail("MH_PROPOSAL_DISPATCH_STALE", "recovered proposal dispatch no longer matches the exact active workspace attempt");
  }
  return validated;
}

function persistProposalDispatchReceipt({ workspaceRegistryDir, intent, hostResult, now = new Date() }) {
  const validatedIntent = validateProposalDispatchIntent(intent);
  if (!hostResult || typeof hostResult !== "object" || Array.isArray(hostResult)) {
    fail("MH_PROPOSAL_DISPATCH_RECEIPT", "proposal host response must be an object");
  }
  if (hostResult.packetDigest !== validatedIntent.request.packet.packetDigest) {
    fail("MH_PROPOSAL_DISPATCH_RECEIPT", "proposal host response packetDigest does not match the durable intent");
  }
  nonEmptyString(hostResult.taskId, "proposal host taskId", "MH_PROPOSAL_DISPATCH_RECEIPT");
  if (!isDigest(hostResult.taskDigest)) {
    fail("MH_PROPOSAL_DISPATCH_RECEIPT", "proposal host taskDigest must be a sha256 digest");
  }
  const body = {
    schemaVersion: PROPOSAL_DISPATCH_RECEIPT_SCHEMA,
    intentDigest: validatedIntent.intentDigest,
    packetDigest: validatedIntent.request.packet.packetDigest,
    taskId: hostResult.taskId,
    taskDigest: hostResult.taskDigest,
    acceptedAt: now.toISOString(),
  };
  const receipt = validateProposalDispatchReceipt({
    ...body,
    receiptDigest: computeProposalDispatchReceiptDigest(body),
  });
  const paths = proposalDispatchPaths({
    workspaceRegistryDir,
    workspaceId: validatedIntent.authority.workspaceId,
    generation: validatedIntent.authority.generation,
    create: true,
  });
  try {
    writeCreateOnly(paths.receiptPath, receipt, "MH_PROPOSAL_DISPATCH_RECEIPT_WRITE");
    return receipt;
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
    const existing = validateProposalDispatchReceipt(readJson(paths.receiptPath, "MH_PROPOSAL_DISPATCH_RECEIPT_READ", false));
    if (existing.intentDigest !== receipt.intentDigest
        || existing.packetDigest !== receipt.packetDigest
        || existing.taskId !== receipt.taskId
        || existing.taskDigest !== receipt.taskDigest) {
      fail("MH_PROPOSAL_DISPATCH_RECEIPT_CONFLICT", "durable proposal receipt conflicts with the retained task binding");
    }
    return existing;
  }
}

function readProposalDispatchReceipt({ workspaceRegistryDir, workspaceId, generation, optional = true }) {
  const paths = proposalDispatchPaths({ workspaceRegistryDir, workspaceId, generation });
  const parsed = readJson(paths.receiptPath, "MH_PROPOSAL_DISPATCH_RECEIPT_READ", optional);
  return parsed ? validateProposalDispatchReceipt(parsed) : null;
}

function persistProposalDispatchResult({ workspaceRegistryDir, intent, receipt, hostResult, now = new Date() }) {
  const validatedIntent = validateProposalDispatchIntent(intent);
  const validatedReceipt = assertProposalDispatchReceiptBinding(validatedIntent, receipt);
  if (!validatedReceipt) fail("MH_PROPOSAL_DISPATCH_RESULT", "proposal result capture requires the durable exact task receipt");
  if (!hostResult || typeof hostResult !== "object" || Array.isArray(hostResult)) {
    fail("MH_PROPOSAL_DISPATCH_RESULT", "proposal host durable result must be an object");
  }
  const expected = ["schemaVersion", "taskId", "taskDigest", "packetDigest", "result", "resultDigest", "submittedAt"].sort();
  if (Object.keys(hostResult).sort().join("\0") !== expected.join("\0")
      || hostResult.schemaVersion !== "meta-proposal-result/v1"
      || hostResult.packetDigest !== validatedReceipt.packetDigest
      || hostResult.taskId !== validatedReceipt.taskId
      || hostResult.taskDigest !== validatedReceipt.taskDigest
      || !isDigest(hostResult.resultDigest)
      || !Number.isFinite(Date.parse(hostResult.submittedAt))) {
    fail("MH_PROPOSAL_DISPATCH_RESULT", "proposal host durable result does not match the retained exact task receipt");
  }
  const body = {
    schemaVersion: PROPOSAL_DISPATCH_RESULT_SCHEMA,
    intentDigest: validatedIntent.intentDigest,
    receiptDigest: validatedReceipt.receiptDigest,
    packetDigest: validatedReceipt.packetDigest,
    taskId: validatedReceipt.taskId,
    taskDigest: validatedReceipt.taskDigest,
    workerResult: validateWorkerResult(hostResult.result),
    hostResultDigest: hostResult.resultDigest,
    capturedAt: now.toISOString(),
  };
  const result = validateProposalDispatchResult({
    ...body,
    resultRecordDigest: computeProposalDispatchResultDigest(body),
  });
  const paths = proposalDispatchPaths({
    workspaceRegistryDir,
    workspaceId: validatedIntent.authority.workspaceId,
    generation: validatedIntent.authority.generation,
    create: true,
  });
  try {
    writeCreateOnly(paths.resultPath, result, "MH_PROPOSAL_DISPATCH_RESULT_WRITE");
    return result;
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
    const existing = validateProposalDispatchResult(readJson(paths.resultPath, "MH_PROPOSAL_DISPATCH_RESULT_READ", false));
    if (existing.resultRecordDigest !== result.resultRecordDigest) {
      fail("MH_PROPOSAL_DISPATCH_RESULT_CONFLICT", "durable proposal packet already has a different captured worker result");
    }
    return existing;
  }
}

function readProposalDispatchResult({ workspaceRegistryDir, workspaceId, generation, optional = true }) {
  const paths = proposalDispatchPaths({ workspaceRegistryDir, workspaceId, generation });
  const parsed = readJson(paths.resultPath, "MH_PROPOSAL_DISPATCH_RESULT_READ", optional);
  return parsed ? validateProposalDispatchResult(parsed) : null;
}

function persistProposalContextTelemetry({ workspaceRegistryDir, intent, receipt, hostTelemetry, now = new Date() }) {
  const validatedIntent = validateProposalDispatchIntent(intent);
  const validatedReceipt = assertProposalDispatchReceiptBinding(validatedIntent, receipt);
  if (!validatedReceipt) fail("MH_PROPOSAL_TELEMETRY", "proposal telemetry capture requires the durable exact task receipt");
  const telemetry = validateHostProposalTelemetry(hostTelemetry, validatedReceipt);
  const body = {
    schemaVersion: PROPOSAL_CONTEXT_TELEMETRY_SCHEMA,
    authority: "NON_AUTHORITATIVE_OBSERVATION",
    intentDigest: validatedIntent.intentDigest,
    receiptDigest: validatedReceipt.receiptDigest,
    sessionDigest: validatedIntent.authority.sessionDigest,
    claimDigest: validatedIntent.authority.claimDigest,
    generation: validatedIntent.authority.generation,
    packetDigest: validatedReceipt.packetDigest,
    taskId: validatedReceipt.taskId,
    taskDigest: validatedReceipt.taskDigest,
    hostTelemetry: telemetry,
    capturedAt: now.toISOString(),
  };
  const record = validateProposalContextTelemetry({
    ...body,
    telemetryRecordDigest: computeProposalContextTelemetryDigest(body),
  });
  const paths = proposalDispatchPaths({
    workspaceRegistryDir,
    workspaceId: validatedIntent.authority.workspaceId,
    generation: validatedIntent.authority.generation,
    create: true,
  });
  try {
    writeCreateOnly(paths.telemetryPath, record, "MH_PROPOSAL_TELEMETRY_WRITE");
    return record;
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
    const existing = validateProposalContextTelemetry(readJson(paths.telemetryPath, "MH_PROPOSAL_TELEMETRY_READ", false));
    if (existing.telemetryRecordDigest !== record.telemetryRecordDigest) {
      fail("MH_PROPOSAL_TELEMETRY_CONFLICT", "proposal packet already has a different captured context telemetry snapshot");
    }
    return existing;
  }
}

function readProposalContextTelemetry({ workspaceRegistryDir, workspaceId, generation, optional = true }) {
  const paths = proposalDispatchPaths({ workspaceRegistryDir, workspaceId, generation });
  const parsed = readJson(paths.telemetryPath, "MH_PROPOSAL_TELEMETRY_READ", optional);
  return parsed ? validateProposalContextTelemetry(parsed) : null;
}

function assertProposalContextTelemetryBinding(intent, receipt, telemetry) {
  const validatedIntent = validateProposalDispatchIntent(intent);
  const validatedReceipt = assertProposalDispatchReceiptBinding(validatedIntent, receipt);
  if (!telemetry) return null;
  if (!validatedReceipt) fail("MH_PROPOSAL_TELEMETRY", "captured proposal telemetry exists without its durable receipt");
  const validated = validateProposalContextTelemetry(telemetry);
  if (validated.intentDigest !== validatedIntent.intentDigest
      || validated.receiptDigest !== validatedReceipt.receiptDigest
      || validated.sessionDigest !== validatedIntent.authority.sessionDigest
      || validated.claimDigest !== validatedIntent.authority.claimDigest
      || validated.generation !== validatedIntent.authority.generation
      || validated.packetDigest !== validatedReceipt.packetDigest
      || validated.taskId !== validatedReceipt.taskId
      || validated.taskDigest !== validatedReceipt.taskDigest) {
    fail("MH_PROPOSAL_TELEMETRY", "captured proposal telemetry does not belong to the exact dispatch intent and task receipt");
  }
  return validated;
}

function assertProposalDispatchResultBinding(intent, receipt, result) {
  const validatedIntent = validateProposalDispatchIntent(intent);
  const validatedReceipt = assertProposalDispatchReceiptBinding(validatedIntent, receipt);
  if (!result) return null;
  if (!validatedReceipt) fail("MH_PROPOSAL_DISPATCH_RESULT", "captured proposal result exists without its durable receipt");
  const validatedResult = validateProposalDispatchResult(result);
  if (validatedResult.intentDigest !== validatedIntent.intentDigest
      || validatedResult.receiptDigest !== validatedReceipt.receiptDigest
      || validatedResult.packetDigest !== validatedReceipt.packetDigest
      || validatedResult.taskId !== validatedReceipt.taskId
      || validatedResult.taskDigest !== validatedReceipt.taskDigest) {
    fail("MH_PROPOSAL_DISPATCH_RESULT", "captured proposal result does not belong to the exact dispatch intent and task receipt");
  }
  return validatedResult;
}

function assertProposalDispatchReceiptBinding(intent, receipt) {
  const validatedIntent = validateProposalDispatchIntent(intent);
  if (!receipt) return null;
  const validatedReceipt = validateProposalDispatchReceipt(receipt);
  if (validatedReceipt.intentDigest !== validatedIntent.intentDigest
      || validatedReceipt.packetDigest !== validatedIntent.request.packet.packetDigest) {
    fail("MH_PROPOSAL_DISPATCH_RECEIPT", "proposal receipt does not belong to the durable dispatch intent");
  }
  return validatedReceipt;
}

module.exports = {
  PROPOSAL_DISPATCH_INTENT_DOMAIN,
  PROPOSAL_DISPATCH_INTENT_SCHEMA,
  PROPOSAL_DISPATCH_RECEIPT_DOMAIN,
  PROPOSAL_DISPATCH_RECEIPT_SCHEMA,
  PROPOSAL_DISPATCH_RESULT_DOMAIN,
  PROPOSAL_DISPATCH_RESULT_SCHEMA,
  PROPOSAL_CONTEXT_TELEMETRY_DOMAIN,
  PROPOSAL_CONTEXT_TELEMETRY_SCHEMA,
  PROPOSAL_ENSURE_REQUEST_SCHEMA,
  assertProposalContextTelemetryBinding,
  assertProposalDispatchBinding,
  assertProposalDispatchReceiptBinding,
  assertProposalDispatchResultBinding,
  assertRecoveredProposalDispatchBinding,
  computeProposalContextTelemetryDigest,
  computeProposalDispatchIntentDigest,
  computeProposalDispatchReceiptDigest,
  computeProposalDispatchResultDigest,
  persistProposalContextTelemetry,
  persistProposalDispatchIntent,
  persistProposalDispatchReceipt,
  persistProposalDispatchResult,
  proposalDispatchIntentExists,
  proposalDispatchPaths,
  readProposalContextTelemetry,
  readProposalDispatchIntent,
  readProposalDispatchReceipt,
  readProposalDispatchResult,
  validateEnsureRequest,
  validateHostProposalTelemetry,
  validateProposalContextTelemetry,
  validateProposalDispatchIntent,
  validateProposalDispatchReceipt,
  validateProposalDispatchResult,
};
