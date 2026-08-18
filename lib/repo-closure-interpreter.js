"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const { ConfigError } = require("./errors");
const { assertVerifierAvailable } = require("./work-verifier");
const {
  computeRepoWorldDigest,
  validateRepoWorld,
  validateWorldAttestation,
} = require("./world-attestation");

const REPO_CLOSURE_INTERPRETER_RELATIVE_PATH = path.join(".meta-harness", "closure-interpreter.js");
const REPO_CLOSURE_INTERPRETATION_SCHEMA = "repo-closure-interpretation/v1";
const MAX_INTERPRETER_BYTES = 512 * 1024;
const MAX_INTERPRETER_OUTPUT_BYTES = 4 * 1024 * 1024;
const INTERPRETER_TIMEOUT_MS = 60_000;
const DISPOSITIONS = new Set(["APPLIED", "INVALIDATED_REPLAN"]);
const SYSTEM_ROOTS = Object.freeze(["/usr", "/bin", "/sbin", "/lib", "/lib64"]);
const SAFE_PATH = "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin";

function fail(code, message, details) {
  throw new ConfigError(message, { code, details });
}

function exactKeys(value, expected, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("MH_REPO_INTERPRETER_SHAPE", `${label} must be an object`);
  }
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (JSON.stringify(actual) !== JSON.stringify(wanted)) {
    fail("MH_REPO_INTERPRETER_SHAPE", `${label} has missing or unexpected fields`, { actual, expected: wanted });
  }
}

function interpreterPath(repositoryPath) {
  const filePath = path.resolve(repositoryPath, REPO_CLOSURE_INTERPRETER_RELATIVE_PATH);
  let stat;
  try {
    stat = fs.lstatSync(filePath);
  } catch (error) {
    fail("MH_REPO_INTERPRETER_MISSING", `${REPO_CLOSURE_INTERPRETER_RELATIVE_PATH} is missing or unreadable: ${error.message}`);
  }
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_INTERPRETER_BYTES) {
    fail(
      "MH_REPO_INTERPRETER_MISSING",
      `${REPO_CLOSURE_INTERPRETER_RELATIVE_PATH} must be a regular non-symlink file no larger than ${MAX_INTERPRETER_BYTES} bytes`,
    );
  }
  return filePath;
}

function validateRepositoryInterpretation(value, {
  repositoryPath,
  currentWorld,
  now = new Date(),
} = {}) {
  exactKeys(value, [
    "schemaVersion",
    "disposition",
    "interpretation",
    "successorWorld",
    "successorAttestation",
  ], "repoClosureInterpretation");
  if (value.schemaVersion !== REPO_CLOSURE_INTERPRETATION_SCHEMA) {
    fail("MH_REPO_INTERPRETER_SCHEMA", `repoClosureInterpretation.schemaVersion must be ${REPO_CLOSURE_INTERPRETATION_SCHEMA}`);
  }
  if (!DISPOSITIONS.has(value.disposition)) {
    fail("MH_REPO_INTERPRETER_VALUE", "repoClosureInterpretation.disposition must be APPLIED or INVALIDATED_REPLAN");
  }
  if (value.interpretation === undefined) {
    fail("MH_REPO_INTERPRETER_VALUE", "repoClosureInterpretation.interpretation is required");
  }
  try {
    JSON.stringify(value.interpretation);
  } catch (error) {
    fail("MH_REPO_INTERPRETER_VALUE", `repoClosureInterpretation.interpretation must be JSON-serializable: ${error.message}`);
  }
  const successorWorld = validateRepoWorld(value.successorWorld);
  if (!currentWorld || successorWorld.productDirectionDigest !== currentWorld.productDirectionDigest) {
    fail("MH_REPO_INTERPRETER_WORLD", "repository interpretation may not change owner product-direction identity");
  }
  const successorWorldDigest = computeRepoWorldDigest(successorWorld);
  const successorAttestation = validateWorldAttestation(value.successorAttestation, {
    repositoryPath,
    worldDigest: successorWorldDigest,
    now,
  });
  return Object.freeze({
    schemaVersion: value.schemaVersion,
    disposition: value.disposition,
    interpretation: JSON.parse(JSON.stringify(value.interpretation)),
    successorWorld,
    successorWorldDigest,
    successorAttestation,
  });
}

function writeInterpreterScaffold(root) {
  for (const relative of ["home", "tmp", "etc", "dev", "proc", "interpreter"]) {
    fs.mkdirSync(path.join(root, relative), { recursive: true });
  }
  fs.writeFileSync(path.join(root, "etc", "passwd"), "root:x:0:0:root:/home:/bin/sh\n", "utf8");
  fs.writeFileSync(path.join(root, "etc", "group"), "root:x:0:\n", "utf8");
  fs.writeFileSync(path.join(root, "etc", "hosts"), "127.0.0.1 localhost\n", "utf8");
  fs.writeFileSync(path.join(root, "etc", "resolv.conf"), "", "utf8");
  const ldCache = "/etc/ld.so.cache";
  if (fs.existsSync(ldCache) && fs.lstatSync(ldCache).isFile()) {
    fs.copyFileSync(ldCache, path.join(root, "etc", "ld.so.cache"));
  }
  for (const name of ["null", "zero", "random", "urandom"]) {
    fs.writeFileSync(path.join(root, "dev", name), "", "utf8");
  }
  fs.writeFileSync(path.join(root, "interpreter", "closure-interpreter.js"), "", "utf8");
}

function interpreterSandboxScript() {
  return [
    "set -eu",
    "root=$1",
    "source_script=$2",
    "node_path=$3",
    "mount --make-rprivate /",
    "bind_ro_recursive() {",
    "  source=$1",
    "  target=$2",
    "  mount --rbind \"$source\" \"$target\"",
    "  mount --make-rslave \"$target\"",
    "  /usr/bin/findmnt -R -r -n -o TARGET \"$target\" | /usr/bin/sort -r | while IFS= read -r mounted; do",
    "    mount -o remount,bind,ro \"$mounted\"",
    "  done",
    "}",
    ...SYSTEM_ROOTS.map((source) => [
      `if [ -e ${JSON.stringify(source)} ]; then`,
      `  mkdir -p \"$root${source}\"`,
      `  bind_ro_recursive ${JSON.stringify(source)} \"$root${source}\"`,
      "fi",
    ].join("\n")),
    "mount --bind \"$source_script\" \"$root/interpreter/closure-interpreter.js\"",
    "mount -o remount,bind,ro \"$root/interpreter/closure-interpreter.js\"",
    "mount -t proc proc \"$root/proc\" -o nosuid,nodev,noexec",
    "for device in null zero random urandom; do",
    "  mount --bind \"/dev/$device\" \"$root/dev/$device\"",
    "done",
    "exec chroot \"$root\" /usr/bin/setpriv --bounding-set=-all --inh-caps=-all --ambient-caps=-all --no-new-privs /bin/sh -ceu 'cd /interpreter; exec \"$@\"' meta-harness-repo-interpreter \"$node_path\" /interpreter/closure-interpreter.js",
  ].join("\n");
}

function runRepositoryClosureInterpreter({ repositoryPath, input, now = new Date() }) {
  const executable = interpreterPath(repositoryPath);
  let serialized;
  try {
    serialized = `${JSON.stringify(input)}\n`;
  } catch (error) {
    fail("MH_REPO_INTERPRETER_INPUT", `closure interpretation input is not JSON-serializable: ${error.message}`);
  }
  assertVerifierAvailable();
  const sandboxRoot = fs.mkdtempSync(path.join(os.tmpdir(), "meta-harness-repo-interpreter-"));
  writeInterpreterScaffold(sandboxRoot);
  let result;
  try {
    result = spawnSync("unshare", [
      "--user",
      "--map-root-user",
      "--mount",
      "--net",
      "--pid",
      "--fork",
      "--",
      "/bin/sh",
      "-ceu",
      interpreterSandboxScript(),
      "meta-harness-repo-interpreter",
      sandboxRoot,
      executable,
      process.execPath,
    ], {
      cwd: sandboxRoot,
      env: {
        PATH: SAFE_PATH,
        HOME: "/home",
        TEMP: "/tmp",
        TMP: "/tmp",
        TMPDIR: "/tmp",
        CI: "1",
        META_HARNESS_REPO_INTERPRETER: "1",
      },
      input: serialized,
      encoding: "utf8",
      shell: false,
      windowsHide: true,
      timeout: INTERPRETER_TIMEOUT_MS,
      maxBuffer: MAX_INTERPRETER_OUTPUT_BYTES,
      stdio: ["pipe", "pipe", "pipe"],
    });
  } finally {
    fs.rmSync(sandboxRoot, { recursive: true, force: true });
  }
  if (result.error || result.status !== 0) {
    fail(
      "MH_REPO_INTERPRETER_EXECUTION",
      `repository closure interpreter failed: ${String(result.stderr || result.stdout || result.error?.message || "unknown error").trim().slice(-4000)}`,
      { status: result.status, causeCode: result.error?.code },
    );
  }
  let parsed;
  try {
    parsed = JSON.parse(String(result.stdout || "").trim());
  } catch (error) {
    fail("MH_REPO_INTERPRETER_OUTPUT", `repository closure interpreter returned invalid JSON: ${error.message}`);
  }
  return validateRepositoryInterpretation(parsed, {
    repositoryPath,
    currentWorld: input?.currentWorld,
    now,
  });
}

module.exports = {
  INTERPRETER_TIMEOUT_MS,
  REPO_CLOSURE_INTERPRETATION_SCHEMA,
  REPO_CLOSURE_INTERPRETER_RELATIVE_PATH,
  runRepositoryClosureInterpreter,
  validateRepositoryInterpretation,
};
