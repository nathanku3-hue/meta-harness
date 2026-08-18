"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const { domainDigest } = require("./contracts/digest");
const { ConfigError } = require("./errors");
const { executedProductProof } = require("./work-product-proof");
const { productProofContract, validateProductProofSpec } = require("./work-product-proof-spec");
const { inspectWorkspace, runGit } = require("./work-git");

const VERIFICATION_SCHEMA = "candidate-verification/v1";
const VERIFICATION_DOMAIN = "meta-harness-candidate-verification/v1";
const ISOLATION_PROFILE = "linux-user-mount-net-pid-chroot/v1";
const SAFE_PATH = [
  "/usr/local/sbin",
  "/usr/local/bin",
  "/usr/sbin",
  "/usr/bin",
  "/sbin",
  "/bin",
].join(":");
const SYSTEM_ROOTS = Object.freeze(["/usr", "/bin", "/sbin", "/lib", "/lib64"]);
const DEPENDENCY_ROOTS = Object.freeze(["node_modules", ".venv", "venv"]);

function fail(code, message, details) {
  throw new ConfigError(message, { code, details });
}

let cachedSandboxAvailable = null;

function sandboxAvailable() {
  if (cachedSandboxAvailable !== null) return cachedSandboxAvailable;
  if (process.platform !== "linux") {
    cachedSandboxAvailable = false;
    return false;
  }
  const result = spawnSync("unshare", [
    "--user",
    "--map-root-user",
    "--mount",
    "--net",
    "--pid",
    "--fork",
    "--",
    "/bin/sh",
    "-ceu",
    [
      "command -v mount >/dev/null",
      "command -v chroot >/dev/null",
      "command -v setpriv >/dev/null",
      "command -v findmnt >/dev/null",
      "command -v sort >/dev/null",
      "command -v ip >/dev/null",
      "mount --make-rprivate /",
      "/usr/sbin/ip link set lo up",
    ].join("; "),
  ], {
    encoding: "utf8",
    shell: false,
    windowsHide: true,
    timeout: 10_000,
    stdio: ["ignore", "pipe", "pipe"],
  });
  cachedSandboxAvailable = !result.error && result.status === 0;
  return cachedSandboxAvailable;
}

function assertVerifierAvailable() {
  if (!sandboxAvailable()) {
    fail(
      "MH_WORK_VERIFIER_SANDBOX_UNAVAILABLE",
      "work-session/v7 verification requires Linux user, mount, network, and pid namespaces",
    );
  }
}

function sandboxEnvironment(sourceEnv = process.env) {
  const env = {
    PATH: SAFE_PATH,
    HOME: "/home",
    USERPROFILE: "/home",
    APPDATA: "/home/AppData/Roaming",
    LOCALAPPDATA: "/home/AppData/Local",
    TEMP: "/tmp",
    TMP: "/tmp",
    TMPDIR: "/tmp",
    XDG_CACHE_HOME: "/tmp/xdg-cache",
    XDG_CONFIG_HOME: "/home/.config",
    XDG_DATA_HOME: "/home/.local/share",
    CI: "1",
    GIT_TERMINAL_PROMPT: "0",
    npm_config_audit: "false",
    npm_config_fund: "false",
    npm_config_update_notifier: "false",
    PIP_DISABLE_PIP_VERSION_CHECK: "1",
    PIP_NO_INPUT: "1",
    PIP_NO_INDEX: "1",
    HTTP_PROXY: "http://127.0.0.1:9",
    HTTPS_PROXY: "http://127.0.0.1:9",
    ALL_PROXY: "http://127.0.0.1:9",
    NO_PROXY: "",
  };
  for (const key of ["LANG", "LC_ALL", "TERM"]) {
    if (sourceEnv?.[key]) env[key] = String(sourceEnv[key]);
  }
  return env;
}

function gitPrefix(directory) {
  return `${path.resolve(directory).replace(/\\/g, "/")}/`;
}

function writeSandboxScaffold(verifierRoot) {
  for (const relative of [
    "home",
    "home/AppData/Roaming",
    "home/AppData/Local",
    "home/.config",
    "home/.local/share",
    "tmp",
    "tmp/xdg-cache",
    "etc",
    "dev",
    "proc",
  ]) {
    fs.mkdirSync(path.join(verifierRoot, ...relative.split("/")), { recursive: true });
  }
  fs.writeFileSync(path.join(verifierRoot, "etc", "passwd"), "root:x:0:0:root:/home:/bin/sh\n", "utf8");
  fs.writeFileSync(path.join(verifierRoot, "etc", "group"), "root:x:0:\n", "utf8");
  fs.writeFileSync(path.join(verifierRoot, "etc", "hosts"), "127.0.0.1 localhost\n", "utf8");
  fs.writeFileSync(path.join(verifierRoot, "etc", "nsswitch.conf"), "hosts: files\npasswd: files\ngroup: files\n", "utf8");
  fs.writeFileSync(path.join(verifierRoot, "etc", "resolv.conf"), "", "utf8");
  const ldCache = "/etc/ld.so.cache";
  if (fs.existsSync(ldCache) && fs.lstatSync(ldCache).isFile()) {
    fs.copyFileSync(ldCache, path.join(verifierRoot, "etc", "ld.so.cache"));
  }
  for (const name of ["null", "zero", "random", "urandom"]) {
    fs.writeFileSync(path.join(verifierRoot, "dev", name), "", "utf8");
  }
}

function dependencySearchDirectories(commands) {
  const directories = new Set(["."]);
  for (const command of commands || []) {
    let current = command.cwd === "." ? "." : String(command.cwd || ".").replace(/\\/g, "/");
    while (current && current !== ".") {
      directories.add(current);
      const parent = path.posix.dirname(current);
      current = parent === current ? "." : parent;
    }
  }
  return [...directories].sort((left, right) => left.split("/").length - right.split("/").length);
}

function dependencyMounts(sourceRoot, verifierPath, commands) {
  const mounts = [];
  const seenTargets = new Set();
  for (const directory of dependencySearchDirectories(commands)) {
    for (const dependency of DEPENDENCY_ROOTS) {
      const relative = directory === "." ? dependency : path.posix.join(directory, dependency);
      const source = path.join(sourceRoot, ...relative.split("/"));
      const target = path.join(verifierPath, ...relative.split("/"));
      if (seenTargets.has(target) || !fs.existsSync(source) || fs.existsSync(target)) continue;
      const stat = fs.lstatSync(source);
      if (!stat.isDirectory() || stat.isSymbolicLink()) continue;
      fs.mkdirSync(target, { recursive: true });
      mounts.push({ source: fs.realpathSync.native(source), target });
      seenTargets.add(target);
    }
  }
  return mounts;
}

function prepareCandidateVerifier({
  workspacePath,
  dependencySourcePath = workspacePath,
  baseHead,
  candidateTreeOid,
  commands = [],
  env = process.env,
}) {
  if (!/^[a-f0-9]{40,64}$/u.test(String(baseHead || ""))
      || !/^[a-f0-9]{40,64}$/u.test(String(candidateTreeOid || ""))) {
    fail("MH_WORK_VERIFIER_IDENTITY", "candidate verifier requires valid base and tree object ids");
  }

  assertVerifierAvailable();
  const verifierRoot = fs.mkdtempSync(path.join(os.tmpdir(), "meta-harness-verifier-"));
  const verifierPath = path.join(verifierRoot, "repository");
  const sourceIndex = path.join(verifierRoot, "candidate.index");
  try {
    runGit(workspacePath, ["clone", "--no-checkout", "--no-hardlinks", workspacePath, verifierPath], { env });
    runGit(verifierPath, ["remote", "remove", "origin"], { env });
    runGit(verifierPath, ["cat-file", "-e", `${baseHead}^{commit}`], { env });
    runGit(verifierPath, ["reset", "--mixed", baseHead], { env });

    const candidateIndexEnv = { ...env, GIT_INDEX_FILE: sourceIndex };
    runGit(workspacePath, ["read-tree", candidateTreeOid], { env: candidateIndexEnv });
    runGit(workspacePath, [
      "checkout-index",
      "--all",
      "--force",
      `--prefix=${gitPrefix(verifierPath)}`,
    ], { env: candidateIndexEnv });

    runGit(verifierPath, ["add", "-A"], { env });
    const materializedTree = String(runGit(verifierPath, ["write-tree"], { env }).stdout || "").trim();
    if (materializedTree !== candidateTreeOid) {
      fail("MH_WORK_VERIFIER_TREE", "verifier materialization does not match the sealed candidate tree", {
        expected: candidateTreeOid,
        actual: materializedTree,
      });
    }

    const commitEnv = {
      ...env,
      GIT_AUTHOR_NAME: "Meta-Harness Verifier",
      GIT_AUTHOR_EMAIL: "verifier@meta-harness.invalid",
      GIT_COMMITTER_NAME: "Meta-Harness Verifier",
      GIT_COMMITTER_EMAIL: "verifier@meta-harness.invalid",
      GIT_AUTHOR_DATE: "2000-01-01T00:00:00Z",
      GIT_COMMITTER_DATE: "2000-01-01T00:00:00Z",
    };
    const verifierCommit = String(runGit(verifierPath, [
      "commit-tree",
      candidateTreeOid,
      "-p",
      baseHead,
      "-m",
      "Meta-Harness sealed candidate verifier",
    ], { env: commitEnv }).stdout || "").trim();
    runGit(verifierPath, ["reset", "--hard", verifierCommit], { env });
    writeSandboxScaffold(verifierRoot);

    return {
      verifierRoot,
      verifierPath,
      verifierCommit,
      dependencyMounts: dependencyMounts(dependencySourcePath, verifierPath, commands),
      validationEnv: sandboxEnvironment(env),
    };
  } catch (error) {
    fs.rmSync(verifierRoot, { recursive: true, force: true });
    throw error;
  } finally {
    try { fs.rmSync(sourceIndex, { force: true }); } catch (_) {}
  }
}

function materializeTree(workspacePath, treeOid, targetPath, indexPath, env) {
  fs.mkdirSync(targetPath, { recursive: true });
  const indexEnv = { ...env, GIT_INDEX_FILE: indexPath };
  runGit(workspacePath, ["read-tree", treeOid], { env: indexEnv });
  runGit(workspacePath, [
    "checkout-index",
    "--all",
    "--force",
    `--prefix=${gitPrefix(targetPath)}`,
  ], { env: indexEnv });
  const materializedTree = String(runGit(workspacePath, ["write-tree"], { env: indexEnv }).stdout || "").trim();
  if (materializedTree !== treeOid) {
    fail("MH_WORK_VERIFIER_TREE", "isolated proof materialization does not match its sealed Git tree", {
      expected: treeOid,
      actual: materializedTree,
    });
  }
}

function proofDependencyMounts(sourceRoot, payloadRoot, sandboxTargetRoot) {
  const mounts = [];
  for (const dependency of DEPENDENCY_ROOTS) {
    const source = path.join(sourceRoot, dependency);
    const payloadTarget = path.join(payloadRoot, dependency);
    if (!fs.existsSync(source) || fs.existsSync(payloadTarget)) continue;
    const stat = fs.lstatSync(source);
    if (!stat.isDirectory() || stat.isSymbolicLink()) continue;
    fs.mkdirSync(payloadTarget, { recursive: true });
    mounts.push({ source: fs.realpathSync.native(source), target: path.join(sandboxTargetRoot, dependency) });
  }
  return mounts;
}

function prepareProductProofVerifier({
  workspacePath,
  dependencySourcePath = workspacePath,
  baseCommit,
  candidateTreeOid,
  contract,
  program,
  env = process.env,
}) {
  if (!/^[a-f0-9]{40,64}$/u.test(String(baseCommit || ""))
      || !/^[a-f0-9]{40,64}$/u.test(String(candidateTreeOid || ""))
      || contract?.baseCommit !== baseCommit
      || !program || typeof program.content !== "string" || program.content.trim() === "") {
    fail("MH_WORK_PRODUCT_PROOF", "product proof verifier requires the exact sealed base, candidate tree, contract, and proof program");
  }
  assertVerifierAvailable();
  const verifierRoot = fs.mkdtempSync(path.join(os.tmpdir(), "meta-harness-product-proof-"));
  const sandboxRoot = path.join(verifierRoot, "sandbox");
  const candidatePath = path.join(verifierRoot, "candidate");
  const basePath = path.join(verifierRoot, "base");
  const proofSpecPath = path.join(verifierRoot, "proof-spec");
  const sessionPath = path.join(verifierRoot, "session");
  const candidateIndex = path.join(verifierRoot, "candidate.index");
  const baseIndex = path.join(verifierRoot, "base.index");
  try {
    const baseTreeOid = String(runGit(workspacePath, ["rev-parse", `${baseCommit}^{tree}`], { env }).stdout || "").trim();
    materializeTree(workspacePath, candidateTreeOid, candidatePath, candidateIndex, env);
    materializeTree(workspacePath, baseTreeOid, basePath, baseIndex, env);
    fs.mkdirSync(proofSpecPath, { recursive: true });
    fs.writeFileSync(path.join(proofSpecPath, "program"), program.content, { encoding: "utf8", mode: 0o500 });
    fs.mkdirSync(sessionPath, { recursive: true });
    fs.writeFileSync(path.join(sessionPath, "product-contract.json"), `${JSON.stringify(contract, null, 2)}\n`, "utf8");
    fs.mkdirSync(sandboxRoot, { recursive: true });
    writeSandboxScaffold(sandboxRoot);
    for (const relative of ["candidate", "base", "proof-spec", "session"]) {
      fs.mkdirSync(path.join(sandboxRoot, relative), { recursive: true });
    }
    const candidateTarget = path.join(sandboxRoot, "candidate");
    const baseTarget = path.join(sandboxRoot, "base");
    return {
      verifierRoot,
      sandboxRoot,
      mounts: [
        { source: candidatePath, target: candidateTarget },
        { source: basePath, target: baseTarget },
        { source: proofSpecPath, target: path.join(sandboxRoot, "proof-spec") },
        { source: sessionPath, target: path.join(sandboxRoot, "session") },
        ...proofDependencyMounts(dependencySourcePath, candidatePath, candidateTarget),
        ...proofDependencyMounts(dependencySourcePath, basePath, baseTarget),
      ],
      sandboxCwd: "/proof-spec",
      validationEnv: {
        ...sandboxEnvironment(env),
        META_HARNESS_CANDIDATE_ROOT: "/candidate",
        META_HARNESS_BASE_ROOT: "/base",
        META_HARNESS_CONTRACT_PATH: "/session/product-contract.json",
      },
    };
  } catch (error) {
    fs.rmSync(verifierRoot, { recursive: true, force: true });
    throw error;
  } finally {
    try { fs.rmSync(candidateIndex, { force: true }); } catch (_) {}
    try { fs.rmSync(baseIndex, { force: true }); } catch (_) {}
  }
}

function sandboxScript() {
  return [
    "set -eu",
    "root=$1",
    "cwd=$2",
    "mount_count=$3",
    "shift 3",
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
    "/usr/sbin/ip link set lo up",
    "mount -t proc proc \"$root/proc\" -o nosuid,nodev,noexec",
    "for device in null zero random urandom; do",
    "  mount --bind \"/dev/$device\" \"$root/dev/$device\"",
    "done",
    "i=0",
    "while [ \"$i\" -lt \"$mount_count\" ]; do",
    "  source=$1",
    "  target=$2",
    "  shift 2",
    "  bind_ro_recursive \"$source\" \"$target\"",
    "  i=$((i + 1))",
    "done",
    "exec chroot \"$root\" /usr/bin/setpriv --bounding-set=-all --inh-caps=-all --ambient-caps=-all --no-new-privs /bin/sh -ceu 'cd \"$1\"; shift; exec \"$@\"' meta-harness-validation \"$cwd\" \"$@\"",
  ].join("\n");
}

function runSandboxedCommand(prepared, command) {
  const startedAt = Date.now();
  const mounts = prepared.mounts || prepared.dependencyMounts || [];
  const mountArgs = mounts.flatMap((entry) => [
    entry.source,
    entry.target,
  ]);
  const sandboxRoot = prepared.sandboxRoot || prepared.verifierRoot;
  const sandboxCwd = prepared.sandboxCwd || (command.cwd === "." ? "/repository" : `/repository/${command.cwd}`);
  const result = spawnSync("unshare", [
    "--user",
    "--map-root-user",
    "--mount",
    "--net",
    "--pid",
    "--fork",
    "--",
    "/bin/sh",
    "-ceu",
    sandboxScript(),
    "meta-harness-verifier",
    sandboxRoot,
    sandboxCwd,
    String(mounts.length),
    ...mountArgs,
    ...command.argv,
  ], {
    cwd: sandboxRoot,
    env: prepared.validationEnv,
    encoding: "utf8",
    shell: false,
    windowsHide: true,
    timeout: command.timeoutSeconds * 1000,
    maxBuffer: 16 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const passed = !result.error && result.status === 0;
  return {
    argv: command.argv,
    cwd: command.cwd,
    passed,
    exitCode: result.status,
    durationMs: Date.now() - startedAt,
    output: String(result.stderr || result.stdout || result.error?.message || "").trim().slice(-4000),
  };
}

function assertVerifierUnchanged(verifierPath) {
  const inspected = inspectWorkspace(verifierPath, ["."]);
  if (inspected.entries.length > 0) {
    fail("MH_WORK_VALIDATION_MUTATION", "verification mutated the sealed candidate snapshot", {
      paths: inspected.entries.map((entry) => entry.path),
    });
  }
  return inspected;
}

function verificationBody(value) {
  const body = JSON.parse(JSON.stringify(value));
  delete body.verificationDigest;
  return body;
}

function runProductProofClaims(prepared, claims, program) {
  const results = [];
  for (const claim of claims.filter((entry) => entry.disposition === "EXECUTABLE")) {
    const command = {
      argv: [program.runtime, "/proof-spec/program"],
      cwd: "/proof-spec",
      timeoutSeconds: program.timeoutSeconds,
    };
    const result = runSandboxedCommand({
      ...prepared,
      validationEnv: {
        ...prepared.validationEnv,
        META_HARNESS_PROOF_CLAIM_ID: claim.id,
      },
    }, command);
    results.push({ id: claim.id, passed: result.passed, command: result });
  }
  return results;
}

function calibrateProductProofDraft({
  workspacePath,
  dependencySourcePath = workspacePath,
  contract,
  claims,
  program,
  env = process.env,
}) {
  const executable = claims.filter((claim) => claim.disposition === "EXECUTABLE");
  if (executable.length === 0) return [];
  const baseTreeOid = String(runGit(workspacePath, ["rev-parse", `${contract.baseCommit}^{tree}`], { env }).stdout || "").trim();
  const prepared = prepareProductProofVerifier({
    workspacePath,
    dependencySourcePath,
    baseCommit: contract.baseCommit,
    candidateTreeOid: baseTreeOid,
    contract,
    program,
    env,
  });
  try {
    const results = runProductProofClaims(prepared, executable, program);
    const byId = new Map(results.map((result) => [result.id, result]));
    return executable.map((claim) => {
      const result = byId.get(claim.id);
      return {
        claimId: claim.id,
        expected: claim.baselineExpectation,
        observed: result?.passed === true ? "PASS" : "FAIL",
      };
    });
  } finally {
    fs.rmSync(prepared.verifierRoot, { recursive: true, force: true });
  }
}

function verifyProductProof({
  workspacePath,
  dependencySourcePath = workspacePath,
  session,
  candidateSeal,
  env = process.env,
}) {
  const contract = productProofContract(session);
  const spec = validateProductProofSpec(session.productProofSpec, contract);
  if (candidateSeal?.baseHead !== session.base.commit || candidateSeal?.sessionDigest !== session.sessionDigest) {
    fail("MH_WORK_PRODUCT_PROOF", "product proof requires the exact sealed session and candidate");
  }
  if (!spec.program) {
    return executedProductProof({
      session,
      candidateSeal,
      spec,
      isolation: null,
      claimResults: [],
    });
  }
  const prepared = prepareProductProofVerifier({
    workspacePath,
    dependencySourcePath,
    baseCommit: session.base.commit,
    candidateTreeOid: candidateSeal.candidateTreeOid,
    contract,
    program: spec.program,
    env,
  });
  try {
    const claimResults = runProductProofClaims(prepared, spec.claims, spec.program);
    return executedProductProof({
      session,
      candidateSeal,
      spec,
      isolation: ISOLATION_PROFILE,
      claimResults,
    });
  } finally {
    fs.rmSync(prepared.verifierRoot, { recursive: true, force: true });
  }
}

function verifyCandidate({
  workspacePath,
  dependencySourcePath = workspacePath,
  candidateSeal,
  commands,
  env = process.env,
}) {
  const prepared = prepareCandidateVerifier({
    workspacePath,
    dependencySourcePath,
    baseHead: candidateSeal.baseHead,
    candidateTreeOid: candidateSeal.candidateTreeOid,
    commands,
    env,
  });
  try {
    const commandResults = [];
    for (const command of commands) {
      commandResults.push(runSandboxedCommand(prepared, command));
      assertVerifierUnchanged(prepared.verifierPath);
    }
    const body = {
      schemaVersion: VERIFICATION_SCHEMA,
      isolation: ISOLATION_PROFILE,
      candidateTreeOid: candidateSeal.candidateTreeOid,
      commands: commandResults,
    };
    return Object.freeze({
      ...body,
      verificationDigest: domainDigest(VERIFICATION_DOMAIN, body),
    });
  } finally {
    fs.rmSync(prepared.verifierRoot, { recursive: true, force: true });
  }
}

module.exports = {
  ISOLATION_PROFILE,
  VERIFICATION_SCHEMA,
  assertVerifierAvailable,
  calibrateProductProofDraft,
  verifyCandidate,
  verifyProductProof,
};
