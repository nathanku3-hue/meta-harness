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

/**
 * Strip Win32 device namespace prefixes returned by realpath.native.
 * \\?\C:\foo -> C:\foo ; \\?\UNC\server\share -> \\server\share
 */
function stripWindowsNamespacePrefix(p) {
  const s = String(p);
  if (process.platform !== "win32") return s;
  if (s.startsWith("\\\\?\\UNC\\")) {
    return `\\\\${s.slice("\\\\?\\UNC\\".length)}`;
  }
  if (s.startsWith("\\\\?\\")) {
    return s.slice("\\\\?\\".length);
  }
  return s;
}

/**
 * Host realpath suitable for identity checks against Git path output.
 * Prefers realpath.native (expands 8.3 short names on Windows) then absNorm.
 */
function hostRealPath(p) {
  const input = String(p);
  let real;
  try {
    if (typeof fs.realpathSync.native === "function") {
      real = fs.realpathSync.native(input);
    } else {
      real = fs.realpathSync(input);
    }
  } catch {
    real = fs.realpathSync(input);
  }
  return absNorm(stripWindowsNamespacePrefix(real));
}

/**
 * True when both paths resolve to the same existing host filesystem location.
 * Handles Git forward-slash paths, drive-letter case, and Windows 8.3 short
 * names (e.g. C:\\Users\\RUNNER~1 vs C:/Users/runneradmin on GHA).
 */
function sameCanonicalExistingPath(left, right) {
  let leftReal;
  let rightReal;
  try {
    leftReal = hostRealPath(left);
    rightReal = hostRealPath(right);
  } catch (err) {
    throw codedError(
      "D069_PATH_REALPATH",
      `canonical path compare realpath failed: ${err.message}`,
    );
  }
  if (leftReal === rightReal) return true;
  if (process.platform === "win32") {
    if (leftReal.toLowerCase() === rightReal.toLowerCase()) return true;
    // Same directory object under short-name vs long-name residual mismatch.
    try {
      const leftStat = fs.statSync(leftReal);
      const rightStat = fs.statSync(rightReal);
      if (
        Number(leftStat.dev) === Number(rightStat.dev)
        && String(leftStat.ino) === String(rightStat.ino)
        && String(leftStat.ino) !== "0"
      ) {
        return true;
      }
    } catch {
      // fall through
    }
  }
  return false;
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
  let canon;
  try {
    canon = hostRealPath(absPath);
  } catch (err) {
    throw codedError("D069_ROOT_REALPATH", `${label} realpath failed: ${err.message}`);
  }
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

const {
  WINDOWS_POWERSHELL_PATH,
  VALIDATION_ENV_ALLOWLIST,
  D071_SUBJECT_RELATIVE_PATH,
} = require("./ao-constants");

function requireRegularNonSymlinkFile(filePath, label) {
  let lstat;
  try {
    lstat = fs.lstatSync(filePath);
  } catch (err) {
    throw codedError("D069_PROGRAM_PATH_MISSING", `${label} missing: ${err.message}`);
  }
  if (lstat.isSymbolicLink()) {
    throw codedError("D069_PROGRAM_PATH_SYMLINK", `${label} must not be a symlink`);
  }
  const real = fs.realpathSync(filePath);
  const st = fs.lstatSync(real);
  if (!st.isFile() || st.isSymbolicLink()) {
    throw codedError("D069_PROGRAM_PATH_NOT_REGULAR", `${label} must be a regular non-symlink file`);
  }
  return real;
}

function normalizeAllowList(allow) {
  if (!Array.isArray(allow) || !allow.every(isNonEmptyString)) {
    throw codedError("D069_VALIDATION_ENV", "environmentPolicy.allow must be a string array");
  }
  const sorted = [...allow].sort();
  const unique = [...new Set(sorted)];
  if (unique.length !== sorted.length) {
    throw codedError("D069_VALIDATION_ENV", "environmentPolicy.allow must be unique");
  }
  return sorted;
}

function assertValidationAllowlist(allowSorted) {
  const expected = [...VALIDATION_ENV_ALLOWLIST].sort();
  if (JSON.stringify(allowSorted) !== JSON.stringify(expected)) {
    throw codedError(
      "D069_VALIDATION_ENV",
      `environmentPolicy.allow must be exactly ${JSON.stringify(expected)}`,
    );
  }
}

/**
 * Snapshot validation env from construction-bound allowlist only.
 * networkPolicy denied is trust-based (exact hashed validator has no network ops).
 */
function buildValidationEnv(allowList, sourceEnv) {
  const allow = normalizeAllowList(allowList);
  assertValidationAllowlist(allow);
  if (!isPlainObject(sourceEnv)) {
    throw codedError("D071_VALIDATION_ENV_SOURCE", "validation sourceEnv must be a plain object");
  }
  const env = Object.create(null);
  for (const key of allow) {
    if (Object.prototype.hasOwnProperty.call(sourceEnv, key)
      && sourceEnv[key] !== undefined
      && sourceEnv[key] !== null
      && String(sourceEnv[key]).length > 0) {
      env[key] = String(sourceEnv[key]);
    }
  }
  for (const key of allow) {
    if (!Object.prototype.hasOwnProperty.call(env, key)) {
      throw codedError(
        "D071_VALIDATION_ENV_MISSING",
        `validation env missing required host variable ${key}`,
      );
    }
  }
  return env;
}

function snapshotValidationHostEnv(sourceEnv) {
  const env = {};
  for (const key of VALIDATION_ENV_ALLOWLIST) {
    if (sourceEnv && sourceEnv[key]) env[key] = String(sourceEnv[key]);
    else if (process.env[key]) env[key] = String(process.env[key]);
  }
  return env;
}

function buildD071ValidationArgv(powershellPath, validatorScriptPath) {
  return [
    powershellPath,
    "-NoLogo",
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    validatorScriptPath,
    "-SubjectPath",
    D071_SUBJECT_RELATIVE_PATH,
  ];
}

/**
 * D071 validation program identity: Windows PowerShell host + hashed parent-local .ps1.
 * Sealed argv is executed verbatim (not reconstructed as [scriptPath]).
 */
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
  if (!isNonEmptyString(program.expectedExecutableSha256)
    || !/^[a-f0-9]{64}$/.test(program.expectedExecutableSha256)) {
    throw codedError(
      "D071_PROGRAM_EXECUTABLE_HASH",
      `${label}.expectedExecutableSha256 must be 64 lowercase hex chars`,
    );
  }
  if (!isNonEmptyString(program.expectedScriptSha256)
    || !/^[a-f0-9]{64}$/.test(program.expectedScriptSha256)) {
    throw codedError(
      "D069_PROGRAM_HASH",
      `${label}.expectedScriptSha256 must be 64 lowercase hex chars`,
    );
  }

  const expectedPs = absNorm(WINDOWS_POWERSHELL_PATH);
  const providedExec = absNorm(program.executablePath);
  if (providedExec.toLowerCase() !== expectedPs.toLowerCase()) {
    throw codedError(
      "D071_POWERSHELL_HOST",
      `${label}.executablePath must be ${WINDOWS_POWERSHELL_PATH}`,
    );
  }

  const execReal = requireRegularNonSymlinkFile(program.executablePath, `${label}.executablePath`);
  const execHash = sha256File(execReal);
  if (execHash !== program.expectedExecutableSha256) {
    throw codedError(
      "D071_EXECUTABLE_HASH_MISMATCH",
      `${label} executable sha256 mismatch`,
      { expected: program.expectedExecutableSha256, actual: execHash },
    );
  }

  const scriptReal = requireRegularNonSymlinkFile(program.scriptPath, `${label}.scriptPath`);
  const actualHash = sha256File(scriptReal);
  if (actualHash !== program.expectedScriptSha256) {
    throw codedError(
      "D069_PROGRAM_HASH_MISMATCH",
      `${label} script sha256 mismatch`,
      { expected: program.expectedScriptSha256, actual: actualHash },
    );
  }

  let expectedCommand;
  let validationEnv;
  if (requireExpectedCommand) {
    const ec = program.expectedCommand;
    if (!isPlainObject(ec)) {
      throw codedError("D069_VALIDATION_COMMAND", "validationProgram.expectedCommand required");
    }
    if (!Array.isArray(ec.argv) || ec.argv.length < 2 || !ec.argv.every(isNonEmptyString)) {
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
    if (!isPlainObject(ec.environmentPolicy) || !Array.isArray(ec.environmentPolicy.allow)) {
      throw codedError(
        "D069_VALIDATION_ENV",
        "validationProgram.expectedCommand.environmentPolicy.allow required",
      );
    }
    const allowSorted = normalizeAllowList(ec.environmentPolicy.allow);
    assertValidationAllowlist(allowSorted);

    const requiredArgv = buildD071ValidationArgv(absNorm(program.executablePath), absNorm(program.scriptPath));
    if (ec.argv.length !== requiredArgv.length) {
      throw codedError(
        "D069_VALIDATION_ARGV_MISMATCH",
        "validation argv length does not match D071 PowerShell shape",
      );
    }
    // argv[0] and -File target compared via realpath; all other args exact.
    let argv0Real;
    try {
      argv0Real = fs.realpathSync(ec.argv[0]);
    } catch (err) {
      throw codedError("D069_VALIDATION_ARGV_MISMATCH", `argv[0] resolve failed: ${err.message}`);
    }
    if (argv0Real !== execReal) {
      throw codedError(
        "D069_VALIDATION_ARGV_MISMATCH",
        "validation argv[0] must resolve to bound Windows PowerShell host",
      );
    }
    const fileIdx = ec.argv.indexOf("-File");
    if (fileIdx < 0 || fileIdx + 1 >= ec.argv.length) {
      throw codedError("D069_VALIDATION_ARGV_MISMATCH", "validation argv must include -File <script>");
    }
    let fileReal;
    try {
      fileReal = fs.realpathSync(ec.argv[fileIdx + 1]);
    } catch (err) {
      throw codedError("D069_VALIDATION_ARGV_MISMATCH", `-File path resolve failed: ${err.message}`);
    }
    if (fileReal !== scriptReal) {
      throw codedError(
        "D069_VALIDATION_ARGV_MISMATCH",
        "validation -File path must resolve to bound validator script",
      );
    }
    for (let i = 0; i < requiredArgv.length; i += 1) {
      if (i === 0 || i === fileIdx + 1) continue;
      if (ec.argv[i] !== requiredArgv[i]) {
        throw codedError(
          "D069_VALIDATION_ARGV_MISMATCH",
          `validation argv[${i}] mismatch`,
        );
      }
    }

    const hostEnv = snapshotValidationHostEnv(program.hostEnv || process.env);
    validationEnv = buildValidationEnv(allowSorted, hostEnv);

    // Optional observed PS version evidence (best-effort; fails closed only if probe errors hard).
    let powershellVersion = null;
    const verProbe = spawnSync(
      execReal,
      ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", "$PSVersionTable.PSVersion.ToString()"],
      {
        encoding: "utf8",
        windowsHide: true,
        timeout: 15_000,
        env: validationEnv,
      },
    );
    if (!verProbe.error && verProbe.status === 0) {
      powershellVersion = String(verProbe.stdout || "").trim() || null;
    }

    expectedCommand = {
      argv: ec.argv.slice(),
      cwdRelative: ec.cwdRelative,
      timeoutSeconds: ec.timeoutSeconds,
      networkPolicy: ec.networkPolicy,
      environmentPolicy: { allow: allowSorted },
    };

    return {
      executablePath: execReal,
      expectedExecutableSha256: program.expectedExecutableSha256,
      scriptPath: scriptReal,
      expectedScriptSha256: program.expectedScriptSha256,
      expectedCommand,
      validationEnv,
      powershellVersion,
      argv: expectedCommand.argv.slice(),
    };
  }

  return {
    executablePath: execReal,
    expectedExecutableSha256: program.expectedExecutableSha256,
    scriptPath: scriptReal,
    expectedScriptSha256: program.expectedScriptSha256,
    expectedCommand: undefined,
  };
}

function revalidateProgram(bound) {
  const execReal = requireRegularNonSymlinkFile(bound.executablePath, "validation executable");
  const execHash = sha256File(execReal);
  if (execHash !== bound.expectedExecutableSha256) {
    throw codedError("D071_EXECUTABLE_HASH_MISMATCH", "pre-spawn executable hash mismatch");
  }
  const st = fs.lstatSync(bound.scriptPath);
  if (!st.isFile() || st.isSymbolicLink()) {
    throw codedError("D069_PROGRAM_SCRIPT_NOT_REGULAR", "pre-spawn: script not regular");
  }
  const actualHash = sha256File(bound.scriptPath);
  if (actualHash !== bound.expectedScriptSha256) {
    throw codedError("D069_PROGRAM_HASH_MISMATCH", "pre-spawn script hash mismatch");
  }
  if (execReal !== bound.executablePath) {
    throw codedError("D071_EXECUTABLE_PATH_DRIFT", "validation executable path drift");
  }
}

/**
 * Execute the sealed validation argv verbatim (argv[0] = executable).
 */
function spawnProgram(argv, cwd, timeoutSeconds, env) {
  if (!Array.isArray(argv) || argv.length < 2 || !argv.every(isNonEmptyString)) {
    throw codedError("D069_VALIDATION_ARGV", "spawnProgram requires sealed argv array");
  }
  return spawnSync(argv[0], argv.slice(1), {
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
 * argv[0] and -File path are compared via realpath; every other arg exact.
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
    throw codedError("D069_VALIDATION_COMMAND_BINDING", "validation argv must include executable and flags");
  }
  let left0;
  let right0;
  try {
    left0 = fs.realpathSync(cmd.argv[0]);
    right0 = fs.realpathSync(expectedCommand.argv[0]);
  } catch (err) {
    throw codedError(
      "D069_VALIDATION_COMMAND_BINDING",
      `validation argv[0] resolve failed: ${err.message}`,
    );
  }
  if (left0 !== right0) {
    throw codedError(
      "D069_VALIDATION_COMMAND_BINDING",
      "runSpec validation argv[0] must equal construction expectedCommand argv[0]",
    );
  }
  const leftFileIdx = cmd.argv.indexOf("-File");
  const rightFileIdx = expectedCommand.argv.indexOf("-File");
  if (leftFileIdx < 0 || rightFileIdx < 0 || leftFileIdx !== rightFileIdx) {
    throw codedError(
      "D069_VALIDATION_COMMAND_BINDING",
      "validation argv -File position mismatch",
    );
  }
  if (leftFileIdx + 1 >= cmd.argv.length || rightFileIdx + 1 >= expectedCommand.argv.length) {
    throw codedError(
      "D069_VALIDATION_COMMAND_BINDING",
      "validation argv -File missing path argument",
    );
  }
  let leftFile;
  let rightFile;
  try {
    leftFile = fs.realpathSync(cmd.argv[leftFileIdx + 1]);
    rightFile = fs.realpathSync(expectedCommand.argv[rightFileIdx + 1]);
  } catch (err) {
    throw codedError(
      "D069_VALIDATION_COMMAND_BINDING",
      `validation -File path resolve failed: ${err.message}`,
    );
  }
  if (leftFile !== rightFile) {
    throw codedError(
      "D069_VALIDATION_COMMAND_BINDING",
      "runSpec validation -File path must equal construction expectedCommand",
    );
  }
  for (let i = 1; i < cmd.argv.length; i += 1) {
    if (i === leftFileIdx + 1) continue;
    if (cmd.argv[i] !== expectedCommand.argv[i]) {
      throw codedError("D069_VALIDATION_COMMAND_BINDING", `validation argv[${i}] mismatch`);
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
  buildD071ValidationArgv,
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
