"use strict";

/**
 * D069 shared private helpers (not packaged).
 */

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const { domainDigest } = require("../../lib/contracts/digest");
const {
  isAbsoluteNormalizedFsPath: contractAbsNormPath,
} = require("../../lib/contracts/workspace-attestation");

const OWNER_DOMAIN = "d069-controller-owner/v1";
const CLAIM_DOMAIN = "d069-claim/v1";
const JOURNAL_DOMAIN = "d069-journal/v1";

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

function absNorm(p) {
  const resolved = path.resolve(p);
  const normalized = path.normalize(resolved);
  if (normalized.length > 3 && normalized.endsWith(path.sep)) {
    return normalized.slice(0, -1);
  }
  return normalized;
}

function sha256File(filePath) {
  const hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(filePath));
  return hash.digest("hex");
}

function sha256Utf8(text) {
  return crypto.createHash("sha256").update(String(text), "utf8").digest("hex");
}

function digestHex(digest) {
  if (typeof digest !== "string" || !digest.startsWith("sha256:")) {
    throw codedError("D069_DIGEST_HEX", `expected sha256: digest, got ${digest}`);
  }
  const hex = digest.slice("sha256:".length);
  if (!/^[a-f0-9]{64}$/.test(hex)) {
    throw codedError("D069_DIGEST_HEX", `invalid digest hex: ${digest}`);
  }
  return hex;
}

function requireNodeMajorAtLeast(minMajor) {
  const major = Number.parseInt(String(process.versions.node).split(".")[0], 10);
  if (!Number.isInteger(major) || major < minMajor) {
    throw codedError(
      "D069_NODE_VERSION",
      `Node.js >= ${minMajor} required; got ${process.versions.node}`,
    );
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
  } catch (err) {
    try {
      fs.unlinkSync(tempPath);
    } catch {
      // ignore
    }
    throw err;
  }
  try {
    fs.unlinkSync(tempPath);
  } catch {
    // ignore
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
  const dir = path.dirname(destPath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(destPath, text, "utf8");
}

function rejectSymlinkPath(absPath, label) {
  let st;
  try {
    st = fs.lstatSync(absPath);
  } catch (err) {
    throw codedError("D069_ROOT_MISSING", `${label} missing: ${err.message}`);
  }
  if (st.isSymbolicLink()) {
    throw codedError("D069_ROOT_SYMLINK", `${label} must not be a symlink`);
  }
  let cur = absPath;
  const root = path.parse(cur).root;
  while (cur && cur !== root) {
    try {
      const lst = fs.lstatSync(cur);
      if (lst.isSymbolicLink()) {
        throw codedError("D069_ROOT_SYMLINK", `${label} path component is a symlink: ${cur}`);
      }
    } catch (err) {
      if (err && err.code && String(err.code).startsWith("D069_")) throw err;
    }
    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
}

function canonicalExistingRoot(absPath, label) {
  if (!isAbsoluteNormalizedFsPath(absPath)) {
    throw codedError("D069_ROOT_PATH", `${label} must be absolute normalized path`);
  }
  rejectSymlinkPath(absPath, label);
  let real;
  try {
    real = fs.realpathSync(absPath);
  } catch (err) {
    throw codedError("D069_ROOT_REALPATH", `${label} realpath failed: ${err.message}`);
  }
  const canon = absNorm(real);
  if (!isAbsoluteNormalizedFsPath(canon)) {
    throw codedError("D069_ROOT_PATH", `${label} canonical path is not absolute normalized`);
  }
  rejectSymlinkPath(canon, label);
  return canon;
}

function rootsPairwiseSeparated(a, b, labelA, labelB) {
  if (a === b) {
    throw codedError("D069_ROOT_OVERLAP", `${labelA} and ${labelB} must not be equal`);
  }
  const relAB = path.relative(a, b);
  const relBA = path.relative(b, a);
  const bUnderA = relAB === ""
    || (relAB !== ".." && !relAB.startsWith(`..${path.sep}`) && !path.isAbsolute(relAB));
  const aUnderB = relBA === ""
    || (relBA !== ".." && !relBA.startsWith(`..${path.sep}`) && !path.isAbsolute(relBA));
  if (bUnderA || aUnderB) {
    throw codedError(
      "D069_ROOT_OVERLAP",
      `${labelA} and ${labelB} must be pairwise separated (no ancestor/descendant)`,
    );
  }
}

function validateProgramIdentity(label, program, { requireExpectedCommand }) {
  if (!isPlainObject(program)) {
    throw codedError("D069_PROGRAM_REQUIRED", `${label} must be an object`);
  }
  if (!isNonEmptyString(program.executablePath)) {
    throw codedError("D069_PROGRAM_EXECUTABLE", `${label}.executablePath required`);
  }
  if (!isNonEmptyString(program.scriptPath)) {
    throw codedError("D069_PROGRAM_SCRIPT", `${label}.scriptPath required`);
  }
  if (!isNonEmptyString(program.expectedScriptSha256)
    || !/^[a-f0-9]{64}$/.test(program.expectedScriptSha256)) {
    throw codedError(
      "D069_PROGRAM_HASH",
      `${label}.expectedScriptSha256 must be 64 lowercase hex chars`,
    );
  }

  const execReal = fs.realpathSync(program.executablePath);
  if (execReal !== fs.realpathSync(process.execPath)) {
    throw codedError(
      "D069_PROGRAM_EXECUTABLE_MISMATCH",
      `${label}.executablePath must resolve to process.execPath`,
    );
  }

  const scriptLstat = fs.lstatSync(program.scriptPath);
  if (scriptLstat.isSymbolicLink()) {
    throw codedError(
      "D069_PROGRAM_SCRIPT_SYMLINK",
      `${label}.scriptPath must not be a symlink`,
    );
  }
  const scriptReal = fs.realpathSync(program.scriptPath);
  const st = fs.lstatSync(scriptReal);
  if (!st.isFile() || st.isSymbolicLink()) {
    throw codedError(
      "D069_PROGRAM_SCRIPT_NOT_REGULAR",
      `${label}.scriptPath must be a regular non-symlink file`,
    );
  }

  const actualHash = sha256File(scriptReal);
  if (actualHash !== program.expectedScriptSha256) {
    throw codedError(
      "D069_PROGRAM_HASH_MISMATCH",
      `${label} script sha256 mismatch`,
      { expected: program.expectedScriptSha256, actual: actualHash },
    );
  }

  if (requireExpectedCommand) {
    const ec = program.expectedCommand;
    if (!isPlainObject(ec)) {
      throw codedError("D069_VALIDATION_COMMAND", "validationProgram.expectedCommand required");
    }
    if (!Array.isArray(ec.argv) || ec.argv.length !== 2) {
      throw codedError("D069_VALIDATION_ARGV", "validationProgram.expectedCommand.argv invalid");
    }
    if (ec.cwdRelative !== ".") {
      throw codedError("D069_VALIDATION_CWD", "validationProgram.expectedCommand.cwdRelative must be \".\"");
    }
    if (!Number.isInteger(ec.timeoutSeconds) || ec.timeoutSeconds <= 0) {
      throw codedError("D069_VALIDATION_TIMEOUT", "validationProgram.expectedCommand.timeoutSeconds invalid");
    }
    if (ec.networkPolicy !== "denied") {
      throw codedError("D069_VALIDATION_NETWORK", "validationProgram.expectedCommand.networkPolicy must be denied");
    }
    if (!isPlainObject(ec.environmentPolicy)
      || !Array.isArray(ec.environmentPolicy.allow)
      || ec.environmentPolicy.allow.length !== 0) {
      throw codedError(
        "D069_VALIDATION_ENV",
        "validationProgram.expectedCommand.environmentPolicy.allow must be []",
      );
    }
    const intentOk = fs.realpathSync(ec.argv[0]) === execReal
      && fs.realpathSync(ec.argv[1]) === scriptReal;
    if (!intentOk) {
      throw codedError(
        "D069_VALIDATION_ARGV_MISMATCH",
        "validationProgram.expectedCommand.argv must be [process.execPath, scriptPath]",
      );
    }
  }

  return {
    executablePath: execReal,
    scriptPath: scriptReal,
    expectedScriptSha256: program.expectedScriptSha256,
    expectedCommand: requireExpectedCommand ? program.expectedCommand : undefined,
  };
}

function revalidateProgram(bound) {
  const st = fs.lstatSync(bound.scriptPath);
  if (!st.isFile() || st.isSymbolicLink()) {
    throw codedError("D069_PROGRAM_SCRIPT_NOT_REGULAR", "pre-spawn: script not regular");
  }
  const actualHash = sha256File(bound.scriptPath);
  if (actualHash !== bound.expectedScriptSha256) {
    throw codedError("D069_PROGRAM_HASH_MISMATCH", "pre-spawn script hash mismatch");
  }
}

function spawnProgram(executablePath, scriptPath, cwd, timeoutSeconds, env) {
  return spawnSync(executablePath, [scriptPath], {
    cwd,
    encoding: "utf8",
    windowsHide: true,
    timeout: timeoutSeconds * 1000,
    env,
    maxBuffer: 4 * 1024 * 1024,
  });
}

function artifactDigest(kind, content) {
  return domainDigest("artifact/v1", { kind, content: String(content) });
}

function sealClaim(body) {
  const without = { ...body };
  delete without.claimDigest;
  return { ...without, claimDigest: domainDigest(CLAIM_DOMAIN, without) };
}

function sealJournal(body) {
  const without = { ...body };
  delete without.journalDigest;
  return { ...without, journalDigest: domainDigest(JOURNAL_DOMAIN, without) };
}

function ownerDigestFor(body) {
  return domainDigest(OWNER_DOMAIN, body);
}

const ASSESSMENT_DOMAIN = "implementation-assessment/v1";

/** Recompute domain digest over body excluding digestKey; fail closed on mismatch. */
function assertStoredDomainDigest(domain, object, digestKey, label) {
  if (!isPlainObject(object) || typeof object[digestKey] !== "string") {
    throw codedError("D069_STATE_CORRUPT", `${label} missing ${digestKey}`);
  }
  const body = { ...object };
  delete body[digestKey];
  let expected;
  try {
    expected = domainDigest(domain, body);
  } catch (err) {
    throw codedError(
      "D069_STATE_CORRUPT",
      `${label} digest recompute failed: ${err.message}`,
    );
  }
  if (object[digestKey] !== expected) {
    throw codedError("D069_STATE_CORRUPT", `${label} ${digestKey} does not match body`);
  }
}

function assertClaimDigest(claim) {
  assertStoredDomainDigest(CLAIM_DOMAIN, claim, "claimDigest", "claim");
}

function assertJournalDigest(journal) {
  assertStoredDomainDigest(JOURNAL_DOMAIN, journal, "journalDigest", "journal");
}

function assertAssessmentDigest(assessment) {
  assertStoredDomainDigest(
    ASSESSMENT_DOMAIN,
    assessment,
    "implementationAssessmentDigest",
    "assessment",
  );
}

function readJsonIfExists(filePath) {
  if (!fs.existsSync(filePath)) return { exists: false, value: null };
  try {
    return { exists: true, value: JSON.parse(fs.readFileSync(filePath, "utf8")) };
  } catch (err) {
    throw codedError("D069_STATE_CORRUPT", `unreadable JSON at ${filePath}: ${err.message}`);
  }
}

/**
 * Exact normalized equality between sealed RunSpec validation commands and
 * the construction-bound expected validation command.
 */
function assertExactValidationCommandBinding(runSpec, expectedCommand) {
  const cmds = runSpec && runSpec.validation && runSpec.validation.commands;
  if (!Array.isArray(cmds) || cmds.length !== 1) {
    throw codedError(
      "D069_VALIDATION_COMMAND_BINDING",
      "runSpec.validation.commands must be exactly one command matching trusted validation",
    );
  }
  const cmd = cmds[0];
  if (!isPlainObject(cmd) || !isPlainObject(expectedCommand)) {
    throw codedError("D069_VALIDATION_COMMAND_BINDING", "validation command objects required");
  }
  if (!Array.isArray(cmd.argv) || !Array.isArray(expectedCommand.argv)
    || cmd.argv.length !== expectedCommand.argv.length) {
    throw codedError("D069_VALIDATION_COMMAND_BINDING", "validation argv length mismatch");
  }
  if (cmd.argv.length < 2) {
    throw codedError("D069_VALIDATION_COMMAND_BINDING", "validation argv must include executable and script");
  }
  let left0;
  let left1;
  let right0;
  let right1;
  try {
    left0 = fs.realpathSync(cmd.argv[0]);
    left1 = fs.realpathSync(cmd.argv[1]);
    right0 = fs.realpathSync(expectedCommand.argv[0]);
    right1 = fs.realpathSync(expectedCommand.argv[1]);
  } catch (err) {
    throw codedError(
      "D069_VALIDATION_COMMAND_BINDING",
      `validation argv path resolve failed: ${err.message}`,
    );
  }
  if (left0 !== right0 || left1 !== right1) {
    throw codedError(
      "D069_VALIDATION_COMMAND_BINDING",
      "runSpec validation argv paths must equal construction expectedCommand argv",
    );
  }
  for (let i = 2; i < cmd.argv.length; i += 1) {
    if (cmd.argv[i] !== expectedCommand.argv[i]) {
      throw codedError("D069_VALIDATION_COMMAND_BINDING", "validation argv tail mismatch");
    }
  }
  if (cmd.cwdRelative !== expectedCommand.cwdRelative
    || cmd.timeoutSeconds !== expectedCommand.timeoutSeconds
    || cmd.networkPolicy !== expectedCommand.networkPolicy) {
    throw codedError(
      "D069_VALIDATION_COMMAND_BINDING",
      "validation cwd/timeout/network fields must match construction expectedCommand",
    );
  }
  const allowA = [...(cmd.environmentPolicy && cmd.environmentPolicy.allow) || []].sort();
  const allowB = [...(expectedCommand.environmentPolicy && expectedCommand.environmentPolicy.allow) || []].sort();
  if (JSON.stringify(allowA) !== JSON.stringify(allowB)) {
    throw codedError(
      "D069_VALIDATION_COMMAND_BINDING",
      "validation environmentPolicy.allow must match construction expectedCommand",
    );
  }
}

module.exports = {
  codedError,
  isPlainObject,
  isNonEmptyString,
  isAbsoluteNormalizedFsPath,
  absNorm,
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
