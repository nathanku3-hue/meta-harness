"use strict";

/** Shared private helpers for the execution-custody runtime. */

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const { domainDigest } = require("../../lib/contracts/digest");
const {
  isAbsoluteNormalizedFsPath: contractAbsNormPath,
} = require("../../lib/contracts/workspace-attestation");

const OWNER_DOMAIN = "execution-custody-controller-owner/v1";
const CLAIM_DOMAIN = "execution-custody-claim/v1";
const JOURNAL_DOMAIN = "execution-custody-journal/v1";
const ASSESSMENT_DOMAIN = "implementation-assessment/v1";

function codedError(code, message, extra = {}) {
  const err = new Error(message);
  err.code = code;
  Object.assign(err, extra);
  return err;
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isAbsoluteNormalizedFsPath(value) {
  return contractAbsNormPath(value);
}

function absNorm(value) {
  const normalized = path.normalize(path.resolve(value));
  return normalized.length > 3 && normalized.endsWith(path.sep)
    ? normalized.slice(0, -1)
    : normalized;
}

function stripWindowsNamespacePrefix(value) {
  const text = String(value);
  if (process.platform !== "win32") return text;
  if (text.startsWith("\\\\?\\UNC\\")) return `\\\\${text.slice("\\\\?\\UNC\\".length)}`;
  if (text.startsWith("\\\\?\\")) return text.slice("\\\\?\\".length);
  return text;
}

function hostRealPath(value) {
  const input = String(value);
  const real = typeof fs.realpathSync.native === "function"
    ? fs.realpathSync.native(input)
    : fs.realpathSync(input);
  return absNorm(stripWindowsNamespacePrefix(real));
}

function sameCanonicalExistingPath(left, right) {
  let leftReal;
  let rightReal;
  try {
    leftReal = hostRealPath(left);
    rightReal = hostRealPath(right);
  } catch (err) {
    throw codedError("CUSTODY_PATH_REALPATH", `canonical path compare failed: ${err.message}`);
  }
  if (leftReal === rightReal) return true;
  if (process.platform === "win32" && leftReal.toLowerCase() === rightReal.toLowerCase()) return true;
  try {
    const a = fs.statSync(leftReal);
    const b = fs.statSync(rightReal);
    return Number(a.dev) === Number(b.dev) && String(a.ino) !== "0" && String(a.ino) === String(b.ino);
  } catch {
    return false;
  }
}

function sha256File(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function sha256Utf8(text) {
  return crypto.createHash("sha256").update(String(text), "utf8").digest("hex");
}

function digestHex(digest) {
  if (typeof digest !== "string" || !/^sha256:[a-f0-9]{64}$/.test(digest)) {
    throw codedError("CUSTODY_DIGEST_HEX", `expected sha256 digest, got ${digest}`);
  }
  return digest.slice("sha256:".length);
}

function requireNodeMajorAtLeast(minMajor) {
  const major = Number.parseInt(String(process.versions.node).split(".")[0], 10);
  if (!Number.isInteger(major) || major < minMajor) {
    throw codedError("CUSTODY_NODE_VERSION", `Node.js >= ${minMajor} required; got ${process.versions.node}`);
  }
}

function publishNoReplace(destPath, contentBuffer) {
  const dir = path.dirname(destPath);
  fs.mkdirSync(dir, { recursive: true });
  const tempPath = path.join(dir, `.tmp-${crypto.randomBytes(12).toString("hex")}`);
  const fd = fs.openSync(tempPath, "wx");
  try {
    fs.writeFileSync(fd, contentBuffer);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  try {
    fs.linkSync(tempPath, destPath);
  } finally {
    try { fs.unlinkSync(tempPath); } catch { /* ignore */ }
  }
}

function publishReplace(destPath, contentBuffer) {
  const dir = path.dirname(destPath);
  fs.mkdirSync(dir, { recursive: true });
  const tempPath = path.join(dir, `.tmp-r-${crypto.randomBytes(12).toString("hex")}`);
  const fd = fs.openSync(tempPath, "wx");
  try {
    fs.writeFileSync(fd, contentBuffer);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tempPath, destPath);
}

function writeJsonNoReplace(destPath, value) {
  publishNoReplace(destPath, Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8"));
}

function writeJsonReplace(destPath, value) {
  publishReplace(destPath, Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8"));
}

function writeTextFile(destPath, text) {
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  fs.writeFileSync(destPath, String(text), "utf8");
}

function rejectSymlinkPath(absPath, label) {
  let current = absPath;
  const root = path.parse(current).root;
  while (current) {
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink()) {
      throw codedError("CUSTODY_ROOT_SYMLINK", `${label} contains symlink component: ${current}`);
    }
    if (current === root) break;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
}

function canonicalExistingRoot(absPath, label) {
  if (!isAbsoluteNormalizedFsPath(absPath)) {
    throw codedError("CUSTODY_ROOT_PATH", `${label} must be an absolute normalized path`);
  }
  try {
    rejectSymlinkPath(absPath, label);
    const canon = hostRealPath(absPath);
    rejectSymlinkPath(canon, label);
    return canon;
  } catch (err) {
    if (err && String(err.code || "").startsWith("CUSTODY_")) throw err;
    throw codedError("CUSTODY_ROOT_REALPATH", `${label} realpath failed: ${err.message}`);
  }
}

function rootsPairwiseSeparated(a, b, labelA, labelB) {
  if (a === b) throw codedError("CUSTODY_ROOT_OVERLAP", `${labelA} and ${labelB} must differ`);
  const relAB = path.relative(a, b);
  const relBA = path.relative(b, a);
  const bUnderA = relAB === "" || (!relAB.startsWith(`..${path.sep}`) && relAB !== ".." && !path.isAbsolute(relAB));
  const aUnderB = relBA === "" || (!relBA.startsWith(`..${path.sep}`) && relBA !== ".." && !path.isAbsolute(relBA));
  if (bUnderA || aUnderB) {
    throw codedError("CUSTODY_ROOT_OVERLAP", `${labelA} and ${labelB} must be pairwise separated`);
  }
}

function requireRegularNonSymlinkFile(filePath, label) {
  let lstat;
  try {
    lstat = fs.lstatSync(filePath);
  } catch (err) {
    throw codedError("CUSTODY_PROGRAM_MISSING", `${label} missing: ${err.message}`);
  }
  if (lstat.isSymbolicLink() || !lstat.isFile()) {
    throw codedError("CUSTODY_PROGRAM_NOT_REGULAR", `${label} must be a regular non-symlink file`);
  }
  return hostRealPath(filePath);
}

function normalizeAllowList(allow) {
  if (!Array.isArray(allow) || !allow.every(isNonEmptyString)) {
    throw codedError("CUSTODY_VALIDATION_ENV", "environmentPolicy.allow must be a string array");
  }
  const sorted = [...allow].sort();
  if (new Set(sorted).size !== sorted.length) {
    throw codedError("CUSTODY_VALIDATION_ENV", "environmentPolicy.allow must be unique");
  }
  return sorted;
}

function snapshotValidationHostEnv(allowList, sourceEnv = process.env) {
  const env = {};
  for (const key of normalizeAllowList(allowList)) {
    const value = sourceEnv && sourceEnv[key];
    if (value !== undefined && value !== null && String(value).length > 0) {
      env[key] = String(value);
    }
  }
  return env;
}

function buildValidationEnv(allowList, sourceEnv) {
  if (!isPlainObject(sourceEnv)) {
    throw codedError("CUSTODY_VALIDATION_ENV", "validation host environment must be a plain object");
  }
  const env = Object.create(null);
  for (const key of normalizeAllowList(allowList)) {
    const value = sourceEnv[key];
    if (value !== undefined && value !== null && String(value).length > 0) env[key] = String(value);
  }
  return env;
}

function normalizeCommand(command) {
  if (!isPlainObject(command)
    || !Array.isArray(command.argv)
    || command.argv.length < 2
    || !command.argv.every(isNonEmptyString)
    || !isNonEmptyString(command.cwdRelative)
    || !Number.isInteger(command.timeoutSeconds)
    || command.timeoutSeconds <= 0
    || command.networkPolicy !== "denied"
    || !isPlainObject(command.environmentPolicy)
    || !Array.isArray(command.environmentPolicy.allow)) {
    throw codedError("CUSTODY_VALIDATION_COMMAND", "invalid validation command capsule");
  }
  return {
    argv: command.argv.slice(),
    cwdRelative: command.cwdRelative,
    timeoutSeconds: command.timeoutSeconds,
    networkPolicy: command.networkPolicy,
    environmentPolicy: { allow: normalizeAllowList(command.environmentPolicy.allow) },
  };
}

function validateProgramIdentity(label, program, { requireExpectedCommands = true } = {}) {
  if (!isPlainObject(program)) throw codedError("CUSTODY_PROGRAM_REQUIRED", `${label} must be an object`);
  if (!isNonEmptyString(program.commandName)) {
    throw codedError("CUSTODY_PROGRAM_COMMAND", `${label}.commandName required`);
  }
  if (!isAbsoluteNormalizedFsPath(program.executablePath)) {
    throw codedError("CUSTODY_PROGRAM_EXECUTABLE", `${label}.executablePath must be absolute normalized`);
  }
  if (!/^[a-f0-9]{64}$/.test(String(program.expectedExecutableSha256 || ""))) {
    throw codedError("CUSTODY_PROGRAM_HASH", `${label}.expectedExecutableSha256 must be 64 lowercase hex chars`);
  }
  const executablePath = requireRegularNonSymlinkFile(program.executablePath, `${label}.executablePath`);
  const actualHash = sha256File(executablePath);
  if (actualHash !== program.expectedExecutableSha256) {
    throw codedError("CUSTODY_PROGRAM_HASH_MISMATCH", `${label} executable sha256 mismatch`, {
      expected: program.expectedExecutableSha256,
      actual: actualHash,
    });
  }
  const expectedCommands = requireExpectedCommands
    ? (program.expectedCommands || []).map(normalizeCommand)
    : [];
  if (requireExpectedCommands && expectedCommands.length === 0) {
    throw codedError("CUSTODY_VALIDATION_COMMAND", `${label}.expectedCommands must be non-empty`);
  }
  for (const command of expectedCommands) {
    if (command.argv[0] !== program.commandName) {
      throw codedError("CUSTODY_VALIDATION_COMMAND", `sealed argv[0] must equal ${program.commandName}`);
    }
  }
  const hostEnv = isPlainObject(program.hostEnv) ? { ...program.hostEnv } : {};
  const validationEnvs = expectedCommands.map((command) => (
    buildValidationEnv(command.environmentPolicy.allow, hostEnv)
  ));

  let observedVersion = null;
  if (Array.isArray(program.versionArgs) && program.versionArgs.every(isNonEmptyString)) {
    const versionAllow = Array.isArray(program.versionEnvironmentAllow)
      ? program.versionEnvironmentAllow
      : (expectedCommands[0] ? expectedCommands[0].environmentPolicy.allow : []);
    const probe = spawnSync(executablePath, program.versionArgs, {
      encoding: "utf8",
      windowsHide: true,
      timeout: 15_000,
      env: buildValidationEnv(versionAllow, hostEnv),
    });
    if (probe.error || probe.status !== 0) {
      throw codedError("CUSTODY_PROGRAM_VERSION", `${label} version probe failed`);
    }
    observedVersion = `${String(probe.stdout || "").trim()}${String(probe.stderr || "").trim()}`.trim();
    if (isNonEmptyString(program.expectedVersion) && observedVersion !== program.expectedVersion) {
      throw codedError("CUSTODY_PROGRAM_VERSION", `${label} version mismatch`, {
        expected: program.expectedVersion,
        actual: observedVersion,
      });
    }
  }

  return Object.freeze({
    commandName: program.commandName,
    executablePath,
    expectedExecutableSha256: program.expectedExecutableSha256,
    expectedCommands,
    validationEnvs,
    versionArgs: Array.isArray(program.versionArgs) ? program.versionArgs.slice() : [],
    expectedVersion: program.expectedVersion || null,
    observedVersion,
  });
}

function revalidateProgram(bound) {
  const real = requireRegularNonSymlinkFile(bound.executablePath, "validation executable");
  if (real !== bound.executablePath) {
    throw codedError("CUSTODY_PROGRAM_PATH_DRIFT", "validation executable path drift");
  }
  if (sha256File(real) !== bound.expectedExecutableSha256) {
    throw codedError("CUSTODY_PROGRAM_HASH_MISMATCH", "pre-spawn validation executable hash mismatch");
  }
}

function spawnProgram(bound, command, cwd, commandIndex) {
  const normalized = normalizeCommand(command);
  if (normalized.argv[0] !== bound.commandName) {
    throw codedError("CUSTODY_VALIDATION_COMMAND", "sealed command name does not match local binding");
  }
  return spawnSync(bound.executablePath, normalized.argv.slice(1), {
    cwd,
    encoding: "utf8",
    windowsHide: true,
    timeout: normalized.timeoutSeconds * 1000,
    env: bound.validationEnvs[commandIndex] || Object.create(null),
    maxBuffer: 4 * 1024 * 1024,
  });
}

function assertExactValidationCommandBinding(runSpec, expectedCommands) {
  const actual = runSpec && runSpec.validation && runSpec.validation.commands;
  if (!Array.isArray(actual) || !Array.isArray(expectedCommands) || actual.length !== expectedCommands.length) {
    throw codedError("CUSTODY_VALIDATION_BINDING", "RunSpec validation command set must match the adapter capsule exactly");
  }
  const normalizedActual = actual.map(normalizeCommand);
  const normalizedExpected = expectedCommands.map(normalizeCommand);
  if (JSON.stringify(normalizedActual) !== JSON.stringify(normalizedExpected)) {
    throw codedError("CUSTODY_VALIDATION_BINDING", "RunSpec validation commands differ from the adapter capsule");
  }
}

function artifactDigest(kind, content) {
  return domainDigest("artifact/v1", { kind, content: String(content) });
}

function sealClaim(body) {
  const value = { ...body };
  delete value.claimDigest;
  return { ...value, claimDigest: domainDigest(CLAIM_DOMAIN, value) };
}

function sealJournal(body) {
  const value = { ...body };
  delete value.journalDigest;
  return { ...value, journalDigest: domainDigest(JOURNAL_DOMAIN, value) };
}

function ownerDigestFor(body) {
  return domainDigest(OWNER_DOMAIN, body);
}

function assertStoredDomainDigest(domain, object, digestKey, label) {
  if (!isPlainObject(object) || typeof object[digestKey] !== "string") {
    throw codedError("CUSTODY_STATE_CORRUPT", `${label} missing ${digestKey}`);
  }
  const body = { ...object };
  delete body[digestKey];
  let expected;
  try {
    expected = domainDigest(domain, body);
  } catch (err) {
    throw codedError("CUSTODY_STATE_CORRUPT", `${label} digest recompute failed: ${err.message}`);
  }
  if (object[digestKey] !== expected) {
    throw codedError("CUSTODY_STATE_CORRUPT", `${label} ${digestKey} does not match body`);
  }
}

function assertClaimDigest(claim) {
  assertStoredDomainDigest(CLAIM_DOMAIN, claim, "claimDigest", "claim");
}

function assertJournalDigest(journal) {
  assertStoredDomainDigest(JOURNAL_DOMAIN, journal, "journalDigest", "journal");
}

function assertAssessmentDigest(assessment) {
  assertStoredDomainDigest(ASSESSMENT_DOMAIN, assessment, "implementationAssessmentDigest", "assessment");
}

function readJsonIfExists(filePath) {
  if (!fs.existsSync(filePath)) return { exists: false, value: null };
  try {
    return { exists: true, value: JSON.parse(fs.readFileSync(filePath, "utf8")) };
  } catch (err) {
    throw codedError("CUSTODY_STATE_CORRUPT", `unreadable JSON at ${filePath}: ${err.message}`);
  }
}

module.exports = {
  codedError,
  isPlainObject,
  isNonEmptyString,
  isAbsoluteNormalizedFsPath,
  absNorm,
  hostRealPath,
  sameCanonicalExistingPath,
  sha256File,
  sha256Utf8,
  digestHex,
  requireNodeMajorAtLeast,
  publishNoReplace,
  writeJsonNoReplace,
  writeJsonReplace,
  writeTextFile,
  canonicalExistingRoot,
  rootsPairwiseSeparated,
  validateProgramIdentity,
  revalidateProgram,
  spawnProgram,
  buildValidationEnv,
  snapshotValidationHostEnv,
  artifactDigest,
  sealClaim,
  sealJournal,
  ownerDigestFor,
  readJsonIfExists,
  assertExactValidationCommandBinding,
  assertClaimDigest,
  assertJournalDigest,
  assertAssessmentDigest,
  assertStoredDomainDigest,
  OWNER_DOMAIN,
  CLAIM_DOMAIN,
  JOURNAL_DOMAIN,
  ASSESSMENT_DOMAIN,
};
