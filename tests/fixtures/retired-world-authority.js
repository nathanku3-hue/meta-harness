"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const { domainDigest, isDigest } = require("./contracts/digest");
const { ConfigError } = require("./errors");
const { gitExecutableForWorkspace } = require("./git-command");

const CURRENT_WORLD_POINTER_SCHEMA = "current-world-pointer/v1";
const CURRENT_WORLD_REF = "refs/meta-harness/current-world-projection";
const REPO_DECISION_SCHEMA = "repo-decision/v3";
const REPO_DECISION_DOMAIN = "meta-harness-repo-decision-bytes/v3";
const ATTEMPT_ENTRY_SCHEMA = "attempt-entry/v1";
const ATTEMPT_ENTRY_DOMAIN = "meta-harness-attempt-entry/v1";
const EXECUTION_CLOSURE_SCHEMA = "execution-closure/v1";
const EXECUTION_WORK_RESULT_SCHEMA = "execution-work-result/v1";
const OBJECT_KINDS = new Set([
  "worlds",
  "attestations",
  "decisions",
  "transitions",
  "heads",
  "interpretations",
  "outcomes",
  "delegation-learnings",
  "delegation-checkpoints",
  "delegation-frontiers",
  "work-results",
  "execution-closures",
  "worker-stops",
  "forward-motion-proofs",
  "product-integrations",
  "structural-saws",
]);

function fail(code, message, details) {
  throw new ConfigError(message, { code, details });
}

function nonEmptyString(value, label) {
  if (typeof value !== "string" || value.trim() === "") {
    fail("MH_WORLD_AUTHORITY_VALUE", `${label} must be a non-empty string`);
  }
  return value;
}

function commonGitDirectory(repositoryPath) {
  const root = path.resolve(nonEmptyString(repositoryPath, "repositoryPath"));
  const dotGit = path.join(root, ".git");
  let stat;
  try {
    stat = fs.lstatSync(dotGit);
  } catch (error) {
    fail("MH_WORLD_AUTHORITY_GIT", `repository .git metadata is unreadable: ${error.message}`);
  }
  if (stat.isDirectory() && !stat.isSymbolicLink()) return dotGit;
  if (!stat.isFile() || stat.isSymbolicLink()) {
    fail("MH_WORLD_AUTHORITY_GIT", "repository .git metadata must be a directory or regular gitdir file");
  }
  const match = fs.readFileSync(dotGit, "utf8").trim().match(/^gitdir:\s*(.+)$/iu);
  if (!match) fail("MH_WORLD_AUTHORITY_GIT", "repository .git file does not contain a gitdir identity");
  const gitDir = path.resolve(root, match[1]);
  const commonDirFile = path.join(gitDir, "commondir");
  if (!fs.existsSync(commonDirFile)) return gitDir;
  const commonRelative = fs.readFileSync(commonDirFile, "utf8").trim();
  if (!commonRelative) fail("MH_WORLD_AUTHORITY_GIT", "Git commondir metadata is empty");
  return path.resolve(gitDir, commonRelative);
}

function protocolRoot(repositoryPath, { create = true } = {}) {
  const root = path.join(commonGitDirectory(repositoryPath), "meta-harness", "decision-plane-v2");
  if (create) fs.mkdirSync(root, { recursive: true });
  return root;
}

function digestStem(digest, label = "digest") {
  if (!isDigest(digest)) fail("MH_WORLD_AUTHORITY_DIGEST", `${label} must be a sha256 digest`);
  return digest.slice("sha256:".length);
}

function objectPath(repositoryPath, kind, digest) {
  if (!OBJECT_KINDS.has(kind)) fail("MH_WORLD_AUTHORITY_KIND", `unknown immutable object kind: ${kind}`);
  const directory = path.join(protocolRoot(repositoryPath), "objects", kind);
  fs.mkdirSync(directory, { recursive: true });
  return path.join(directory, `${digestStem(digest)}.json`);
}

function attemptEntriesRoot(repositoryPath) {
  const directory = path.join(protocolRoot(repositoryPath), "attempt-entries");
  fs.mkdirSync(directory, { recursive: true });
  return directory;
}

function decisionAttemptDirectory(repositoryPath, decisionDigest) {
  const directory = path.join(attemptEntriesRoot(repositoryPath), digestStem(decisionDigest, "decisionDigest"));
  fs.mkdirSync(directory, { recursive: true });
  return directory;
}

function outcomeAttemptDirectory(repositoryPath, claimDigest) {
  const directory = path.join(attemptEntriesRoot(repositoryPath), "outcomes", digestStem(claimDigest, "claimDigest"));
  fs.mkdirSync(directory, { recursive: true });
  return directory;
}

function outcomeWorkspaceAttemptDirectory(repositoryPath, claimDigest, workspaceId) {
  if (typeof workspaceId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(workspaceId)) {
    fail("MH_ATTEMPT_ENTRY_ID", "Outcome AttemptEntry workspaceId must be a canonical UUID");
  }
  const directory = path.join(outcomeAttemptDirectory(repositoryPath, claimDigest), "workspaces", workspaceId);
  fs.mkdirSync(directory, { recursive: true });
  return directory;
}

function runAttemptDirectory(repositoryPath, sessionDigest) {
  const directory = path.join(attemptEntriesRoot(repositoryPath), "runs", digestStem(sessionDigest, "sessionDigest"));
  fs.mkdirSync(directory, { recursive: true });
  return directory;
}

function runWorkspaceAttemptDirectory(repositoryPath, sessionDigest, workspaceId) {
  if (typeof workspaceId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(workspaceId)) {
    fail("MH_ATTEMPT_ENTRY_ID", "run AttemptEntry workspaceId must be a canonical UUID");
  }
  const directory = path.join(runAttemptDirectory(repositoryPath, sessionDigest), "workspaces", workspaceId);
  fs.mkdirSync(directory, { recursive: true });
  return directory;
}

function ownerAttemptDirectory(repositoryPath, workspaceId) {
  if (typeof workspaceId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(workspaceId)) {
    fail("MH_ATTEMPT_ENTRY_ID", "owner AttemptEntry workspaceId must be a canonical UUID");
  }
  const directory = path.join(attemptEntriesRoot(repositoryPath), "owner", workspaceId);
  fs.mkdirSync(directory, { recursive: true });
  return directory;
}

function attemptEntryPath(repositoryPath, origin, ordinal) {
  if (!Number.isInteger(ordinal) || ordinal < 1) {
    fail("MH_ATTEMPT_ENTRY_VALUE", "attempt ordinal must be a positive integer");
  }
  if (origin?.type === "REPO_DECISION") {
    return path.join(decisionAttemptDirectory(repositoryPath, origin.decisionDigest), `${ordinal}.json`);
  }
  if (origin?.type === "REPO_OUTCOME") {
    return path.join(outcomeAttemptDirectory(repositoryPath, origin.claimDigest), `${ordinal}.json`);
  }
  if (origin?.type === "REPO_OUTCOME_WORKSPACE") {
    return path.join(outcomeWorkspaceAttemptDirectory(repositoryPath, origin.claimDigest, origin.workspaceId), `${ordinal}.json`);
  }
  if (origin?.type === "REPO_RUN_WORKSPACE") {
    return path.join(runWorkspaceAttemptDirectory(repositoryPath, origin.sessionDigest, origin.workspaceId), `${ordinal}.json`);
  }
  if (origin?.type === "OWNER_GOAL") {
    return path.join(ownerAttemptDirectory(repositoryPath, origin.workspaceId), `${ordinal}.json`);
  }
  fail("MH_ATTEMPT_ENTRY_ORIGIN", "attempt entry origin must be REPO_RUN, legacy REPO_OUTCOME/REPO_DECISION, or OWNER_GOAL");
}

function writeCreateOnlyBytes(filePath, bytes, code = "MH_WORLD_AUTHORITY_WRITE") {
  const content = Buffer.isBuffer(bytes) ? bytes : Buffer.from(String(bytes), "utf8");
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  let fd;
  try {
    fd = fs.openSync(filePath, "wx", 0o600);
    fs.writeFileSync(fd, content);
    fs.fsyncSync(fd);
    return { created: true, path: filePath };
  } catch (error) {
    if (error?.code === "EEXIST") {
      const existing = fs.readFileSync(filePath);
      if (Buffer.compare(existing, content) !== 0) {
        fail(code, `immutable authority object already exists with different bytes: ${path.basename(filePath)}`);
      }
      return { created: false, path: filePath };
    }
    fail(code, `cannot persist immutable authority object: ${error.message}`);
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

function writeCreateOnlyJson(filePath, value, code) {
  return writeCreateOnlyBytes(filePath, `${JSON.stringify(value, null, 2)}\n`, code);
}

function persistImmutableJson(repositoryPath, kind, digest, value, code) {
  const filePath = objectPath(repositoryPath, kind, digest);
  writeCreateOnlyJson(filePath, value, code);
  return filePath;
}

function persistImmutableBytes(repositoryPath, kind, digest, bytes, code) {
  const filePath = objectPath(repositoryPath, kind, digest);
  writeCreateOnlyBytes(filePath, bytes, code);
  return filePath;
}

function readImmutableBytes(repositoryPath, kind, digest) {
  const filePath = objectPath(repositoryPath, kind, digest);
  try {
    return fs.readFileSync(filePath);
  } catch (error) {
    fail("MH_WORLD_AUTHORITY_MISSING", `immutable ${kind} object is unreadable: ${error.message}`, { digest });
  }
}

function readImmutableJson(repositoryPath, kind, digest) {
  const bytes = readImmutableBytes(repositoryPath, kind, digest);
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    fail("MH_WORLD_AUTHORITY_OBJECT", `immutable ${kind} object is invalid JSON: ${error.message}`, { digest });
  }
}

function pointerPath(repositoryPath) {
  return path.join(protocolRoot(repositoryPath), "current-world.json");
}

function validatePointer(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)
      || Object.keys(value).sort().join("\0") !== "headDigest\0schemaVersion"
      || value.schemaVersion !== CURRENT_WORLD_POINTER_SCHEMA
      || !isDigest(value.headDigest)) {
    fail("MH_WORLD_POINTER", "current-world pointer is invalid");
  }
  return Object.freeze({ ...value });
}

function pointerBytes(pointer) {
  return `${JSON.stringify(pointer, null, 2)}\n`;
}

function runPointerGit(repositoryPath, args, { allowFailure = false, input = undefined } = {}) {
  const cwd = path.resolve(nonEmptyString(repositoryPath, "repositoryPath"));
  const executable = gitExecutableForWorkspace({ cwd, fs });
  const result = spawnSync(executable, args, {
    cwd,
    input,
    encoding: "utf8",
    shell: false,
    windowsHide: true,
    timeout: 120_000,
    maxBuffer: 16 * 1024 * 1024,
    stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
  });
  if (!allowFailure && (result.error || result.status !== 0)) {
    fail(
      "MH_WORLD_POINTER_GIT",
      `git ${args.join(" ")} failed: ${String(result.stderr || result.stdout || result.error?.message || "unknown error").trim()}`,
      { status: result.status, causeCode: result.error?.code },
    );
  }
  return result;
}

function zeroObjectId(repositoryPath) {
  const format = String(runPointerGit(repositoryPath, ["rev-parse", "--show-object-format"]).stdout || "").trim();
  if (format === "sha1") return "0".repeat(40);
  if (format === "sha256") return "0".repeat(64);
  fail("MH_WORLD_POINTER_GIT", `unsupported Git object format: ${format || "unknown"}`);
}

function readPointerFile(repositoryPath, { optional = false } = {}) {
  const filePath = pointerPath(repositoryPath);
  try {
    return validatePointer(JSON.parse(fs.readFileSync(filePath, "utf8")));
  } catch (error) {
    if (optional && error?.code === "ENOENT") return null;
    if (error instanceof ConfigError) throw error;
    fail("MH_WORLD_POINTER", `current-world pointer is unreadable: ${error.message}`);
  }
}

function readPointerRef(repositoryPath, { optional = false } = {}) {
  const resolved = runPointerGit(
    repositoryPath,
    ["rev-parse", "--verify", "--quiet", CURRENT_WORLD_REF],
    { allowFailure: true },
  );
  const oid = String(resolved.stdout || "").trim();
  if (resolved.status !== 0 || !/^[a-f0-9]{40,64}$/u.test(oid)) {
    if (optional) return null;
    fail("MH_WORLD_POINTER", `semantic projection ref is missing: ${CURRENT_WORLD_REF}`);
  }
  const blob = runPointerGit(repositoryPath, ["cat-file", "blob", oid]);
  let parsed;
  try {
    parsed = JSON.parse(String(blob.stdout || ""));
  } catch (error) {
    fail("MH_WORLD_POINTER", `semantic projection ref is unreadable: ${error.message}`);
  }
  return Object.freeze({ oid, pointer: validatePointer(parsed) });
}

function writePointerBlob(repositoryPath, pointer) {
  const result = runPointerGit(repositoryPath, ["hash-object", "-w", "--stdin"], {
    input: pointerBytes(pointer),
  });
  const oid = String(result.stdout || "").trim();
  if (!/^[a-f0-9]{40,64}$/u.test(oid)) fail("MH_WORLD_POINTER_GIT", "Git did not return a pointer blob object id");
  return oid;
}

function writePointerMirror(repositoryPath, pointer) {
  const filePath = pointerPath(repositoryPath);
  const tempPath = path.join(
    path.dirname(filePath),
    `.tmp.current-world.${process.pid}.${Date.now()}.${crypto.randomUUID()}.json`,
  );
  let fd;
  try {
    fd = fs.openSync(tempPath, "wx", 0o600);
    fs.writeFileSync(fd, pointerBytes(pointer), "utf8");
    fs.fsyncSync(fd);
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
  try {
    fs.renameSync(tempPath, filePath);
  } catch (error) {
    try { fs.unlinkSync(tempPath); } catch (_) {}
    fail("MH_WORLD_POINTER", `cannot replace current-world compatibility mirror: ${error.message}`);
  }
}

function readCurrentWorldPointer(repositoryPath, { optional = false } = {}) {
  const ref = readPointerRef(repositoryPath, { optional: true });
  if (ref) return ref.pointer;
  return readPointerFile(repositoryPath, { optional });
}

function ensurePointerRef(repositoryPath, expectedHeadDigest) {
  const currentRef = readPointerRef(repositoryPath, { optional: true });
  if (currentRef) return currentRef;
  const legacy = readPointerFile(repositoryPath, { optional: true });
  const actual = legacy?.headDigest || null;
  if (actual !== expectedHeadDigest) {
    fail("MH_WORLD_CONFLICT", "current WorldHead changed before semantic projection CAS", {
      expected: expectedHeadDigest,
      actual,
    });
  }
  if (!legacy) return null;
  const legacyOid = writePointerBlob(repositoryPath, legacy);
  const created = runPointerGit(
    repositoryPath,
    ["update-ref", CURRENT_WORLD_REF, legacyOid, zeroObjectId(repositoryPath)],
    { allowFailure: true },
  );
  if (created.status === 0) return Object.freeze({ oid: legacyOid, pointer: legacy });
  const observed = readPointerRef(repositoryPath, { optional: true });
  if (!observed || observed.pointer.headDigest !== expectedHeadDigest) {
    fail("MH_WORLD_CONFLICT", "semantic projection changed while adopting the legacy current-world pointer", {
      expected: expectedHeadDigest,
      actual: observed?.pointer?.headDigest || null,
    });
  }
  return observed;
}

function writePointerAtomic(repositoryPath, expectedHeadDigest, successorHeadDigest) {
  if (expectedHeadDigest !== null && !isDigest(expectedHeadDigest)) {
    fail("MH_WORLD_POINTER", "expected current head must be null or a sha256 digest");
  }
  if (!isDigest(successorHeadDigest)) fail("MH_WORLD_POINTER", "successor head must be a sha256 digest");
  const current = ensurePointerRef(repositoryPath, expectedHeadDigest);
  const actual = current?.pointer?.headDigest || null;
  if (actual !== expectedHeadDigest) {
    fail("MH_WORLD_CONFLICT", "current WorldHead changed before semantic projection CAS", {
      expected: expectedHeadDigest,
      actual,
    });
  }
  const successor = validatePointer({
    schemaVersion: CURRENT_WORLD_POINTER_SCHEMA,
    headDigest: successorHeadDigest,
  });
  const successorOid = writePointerBlob(repositoryPath, successor);
  const expectedOid = current?.oid || zeroObjectId(repositoryPath);
  const advanced = runPointerGit(
    repositoryPath,
    ["update-ref", CURRENT_WORLD_REF, successorOid, expectedOid],
    { allowFailure: true },
  );
  if (advanced.status !== 0) {
    const observed = readPointerRef(repositoryPath, { optional: true });
    fail("MH_WORLD_CONFLICT", "semantic projection changed before Git CAS", {
      expected: expectedHeadDigest,
      actual: observed?.pointer?.headDigest || null,
    });
  }
  writePointerMirror(repositoryPath, successor);
  return successor;
}

function firstAttemptEntries(repositoryPath) {
  const root = attemptEntriesRoot(repositoryPath);
  const results = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === "owner" || !/^[a-f0-9]{64}$/u.test(entry.name)) continue;
    const firstPath = path.join(root, entry.name, "1.json");
    if (!fs.existsSync(firstPath)) continue;
    let parsed;
    try {
      parsed = JSON.parse(fs.readFileSync(firstPath, "utf8"));
    } catch (error) {
      fail("MH_ATTEMPT_ENTRY_READ", `first AttemptEntry is unreadable: ${error.message}`);
    }
    results.push({
      decisionDigest: `sha256:${entry.name}`,
      entry: parsed,
      path: firstPath,
    });
  }
  return results;
}

function durableDecisionReferences(repositoryPath) {
  const references = new Set();
  for (const [kind, schemaVersion] of [
    ["execution-closures", EXECUTION_CLOSURE_SCHEMA],
    ["work-results", EXECUTION_WORK_RESULT_SCHEMA],
  ]) {
    const directory = path.join(protocolRoot(repositoryPath), "objects", kind);
    if (!fs.existsSync(directory)) continue;
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (!entry.isFile() || !/^[a-f0-9]{64}\.json$/u.test(entry.name)) {
        fail("MH_WORLD_AUTHORITY_OBJECT", `immutable ${kind} directory contains an invalid authority object name`);
      }
      const digest = `sha256:${entry.name.slice(0, 64)}`;
      const value = readImmutableJson(repositoryPath, kind, digest);
      if (value?.schemaVersion !== schemaVersion || !value.origin || typeof value.origin !== "object") {
        fail("MH_WORLD_AUTHORITY_OBJECT", `immutable ${kind} object has invalid repo execution provenance`, { digest });
      }
      if (value.origin.type === "REPO_RUN") {
        if (!isDigest(value.origin.outcomeDigest) || !isDigest(value.origin.originHeadDigest)) {
          fail("MH_WORLD_AUTHORITY_OBJECT", `immutable ${kind} object has invalid claimless run provenance`, { digest });
        }
        continue;
      }
      if (value.origin.type === "REPO_OUTCOME") {
        if (!isDigest(value.origin.outcomeDigest) || !isDigest(value.origin.claimDigest)) {
          fail("MH_WORLD_AUTHORITY_OBJECT", `immutable ${kind} object has invalid legacy Outcome provenance`, { digest });
        }
        continue;
      }
      if (value.origin.type !== "REPO_DECISION" || !isDigest(value.origin.decisionDigest)) {
        fail("MH_WORLD_AUTHORITY_OBJECT", `immutable ${kind} object has invalid Decision provenance`, { digest });
      }
      references.add(value.origin.decisionDigest);
    }
  }
  return references;
}

function validateFirstAttemptEntry(candidate) {
  const value = candidate.entry;
  const expectedKeys = [
    "schemaVersion",
    "permitId",
    "permitDigest",
    "sessionDigest",
    "attemptId",
    "generation",
    "ordinal",
    "workspaceId",
    "origin",
    "enteredAt",
    "entryDigest",
  ].sort();
  if (!value || typeof value !== "object" || Array.isArray(value)
      || JSON.stringify(Object.keys(value).sort()) !== JSON.stringify(expectedKeys)
      || value.schemaVersion !== ATTEMPT_ENTRY_SCHEMA
      || value.generation !== 1
      || value.ordinal !== 1
      || value.origin?.type !== "REPO_DECISION"
      || value.origin.decisionDigest !== candidate.decisionDigest
      || !isDigest(value.entryDigest)) {
    fail("MH_ATTEMPT_ENTRY_READ", "first AttemptEntry authority object is invalid", {
      decisionDigest: candidate.decisionDigest,
    });
  }
  const body = JSON.parse(JSON.stringify(value));
  delete body.entryDigest;
  if (value.entryDigest !== domainDigest(ATTEMPT_ENTRY_DOMAIN, body)) {
    fail("MH_ATTEMPT_ENTRY_READ", "first AttemptEntry digest does not match its body", {
      decisionDigest: candidate.decisionDigest,
    });
  }
  return value;
}

function readAdmissionDecision(repositoryPath, decisionDigest) {
  const bytes = readImmutableBytes(repositoryPath, "decisions", decisionDigest);
  const actualDigest = domainDigest(REPO_DECISION_DOMAIN, { content: bytes.toString("utf8") });
  if (actualDigest !== decisionDigest) {
    fail("MH_WORLD_AUTHORITY_OBJECT", "immutable Decision bytes do not match their authority digest", {
      expected: decisionDigest,
      actual: actualDigest,
    });
  }
  let decision;
  try {
    decision = JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    fail("MH_WORLD_AUTHORITY_OBJECT", `immutable Decision object is invalid JSON: ${error.message}`, { decisionDigest });
  }
  if (!decision || typeof decision !== "object" || Array.isArray(decision)
      || decision.schemaVersion !== REPO_DECISION_SCHEMA
      || !isDigest(decision.worldHeadDigest)) {
    fail("MH_WORLD_AUTHORITY_OBJECT", "immutable Decision authority object is invalid", { decisionDigest });
  }
  return decision;
}

function admissionForHead(repositoryPath, headDigest) {
  if (!isDigest(headDigest)) fail("MH_WORLD_AUTHORITY_DIGEST", "headDigest must be a sha256 digest");
  const matches = [];
  const admittedDecisionDigests = new Set();
  for (const candidate of firstAttemptEntries(repositoryPath)) {
    validateFirstAttemptEntry(candidate);
    admittedDecisionDigests.add(candidate.decisionDigest);
    const decision = readAdmissionDecision(repositoryPath, candidate.decisionDigest);
    if (decision.worldHeadDigest === headDigest) matches.push({ ...candidate, decision });
  }
  for (const decisionDigest of durableDecisionReferences(repositoryPath)) {
    const decision = readAdmissionDecision(repositoryPath, decisionDigest);
    if (decision.worldHeadDigest === headDigest && !admittedDecisionDigests.has(decisionDigest)) {
      fail("MH_WORLD_AUTHORITY_MISSING", "durable execution authority references a missing generation-1 AttemptEntry", {
        headDigest,
        decisionDigest,
      });
    }
  }
  if (matches.length > 1) {
    fail("MH_WORLD_AUTHORITY_CONFLICT", "multiple Decisions have first AttemptEntry admission against one WorldHead", {
      headDigest,
      decisions: matches.map((entry) => entry.decisionDigest),
    });
  }
  return matches[0] || null;
}

module.exports = {
  CURRENT_WORLD_POINTER_SCHEMA,
  CURRENT_WORLD_REF,
  admissionForHead,
  attemptEntriesRoot,
  commonGitDirectory,
  attemptEntryPath,
  digestStem,
  objectPath,
  persistImmutableBytes,
  persistImmutableJson,
  protocolRoot,
  readCurrentWorldPointer,
  readImmutableBytes,
  readImmutableJson,
  writeCreateOnlyBytes,
  writeCreateOnlyJson,
  writePointerAtomic,
};
