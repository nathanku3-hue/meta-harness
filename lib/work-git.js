"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const { domainDigest } = require("./contracts/digest");
const { ConfigError } = require("./errors");
const { dirtyManifestDigest } = require("./execution-permit");
const { gitExecutableForWorkspace } = require("./git-command");
const { writeJsonAtomic } = require("./paths");
const { assertBaseCommitAvailable } = require("./work-base");
const { bindWorkSessionToRepository, loadWorkSession, validRelativePath } = require("./work-session");
const {
  acquireWorkspaceExecutionLease,
  activateWorkspaceCustody,
  assertWorkspaceCustodyExecutable,
  createWorkspaceCustody,
  readWorkspaceCustody,
  registryDirectory,
  releaseWorkspaceExecutionLease,
  terminalizeWorkspaceCustody,
  validateWorkspaceCustody,
} = require("./workspace-custody");

const GIT_TIMEOUT_MS = 120_000;
const GIT_MAX_BUFFER = 64 * 1024 * 1024;
const WORK_SESSION_POINTER_SCHEMA = "work-session-pointer/v5";
const MANAGED_WORKTREE_DIRECTORY = ".worktrees";
const MANAGED_WORKTREE_PREFIX = "meta-harness-";
const LEGACY_WORKTREE_DIRECTORY = ".meta-harness-worktrees";
const WORKTREE_IDENTITY_SCHEMA = "workspace-identity/v1";
const WORKTREE_IDENTITY_DOMAIN = "meta-harness-worktree-identity/v1";
const WORKTREE_IDENTITY_FILE = "meta-harness-workspace-identity.json";
const CANDIDATE_SEAL_SCHEMA = "work-candidate-seal/v1";
const CANDIDATE_SEAL_DOMAIN = "meta-harness-work-candidate-seal/v1";
const CANDIDATE_ACCEPTANCE_SCHEMA = "candidate-acceptance/v1";
const CANDIDATE_ACCEPTANCE_DOMAIN = "meta-harness-candidate-acceptance/v1";
const BANK_RECOVERY_RESULT_DOMAIN = "meta-harness-work-bank-recovery-result/v1";
const BANK_RECOVERY_VALIDATION_DOMAIN = "meta-harness-work-bank-recovery-validation/v1";
const resumeRecords = new WeakMap();

function fail(code, message, details) {
  throw new ConfigError(message, { code, details });
}

function runGit(cwd, args, { allowFailure = false, env = process.env } = {}) {
  const executable = gitExecutableForWorkspace({ cwd, fs });
  const result = spawnSync(executable, args, {
    cwd,
    env,
    encoding: "utf8",
    shell: false,
    windowsHide: true,
    timeout: GIT_TIMEOUT_MS,
    maxBuffer: GIT_MAX_BUFFER,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (!allowFailure && (result.error || result.status !== 0)) {
    fail(
      "MH_WORK_GIT",
      `git ${args.join(" ")} failed: ${String(result.stderr || result.stdout || result.error?.message || "unknown error").trim()}`,
      { status: result.status, causeCode: result.error?.code },
    );
  }
  return result;
}

function normalizedPath(value) {
  return String(value || "").replace(/\\/g, "/").replace(/^\.\//, "");
}

function parsePorcelainZ(text) {
  const tokens = String(text || "").split("\0");
  const entries = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const raw = tokens[index];
    if (!raw) continue;
    const xy = raw.slice(0, 2);
    const itemPath = normalizedPath(raw.slice(3));
    const indexStatus = xy[0] || " ";
    const worktreeStatus = xy[1] || " ";
    let originalPath = null;
    if (indexStatus === "R" || indexStatus === "C") {
      originalPath = normalizedPath(tokens[index + 1] || "");
      index += 1;
    }
    entries.push({
      xy,
      indexStatus,
      worktreeStatus,
      path: itemPath,
      originalPath,
      staged: indexStatus !== " " && indexStatus !== "?",
      untracked: xy === "??",
    });
  }
  return entries;
}

function pathAllowed(itemPath, allowedPaths) {
  const candidate = normalizedPath(itemPath).replace(/\/$/, "");
  return allowedPaths.some((entry) => {
    const allowed = normalizedPath(entry).replace(/\/$/, "");
    return allowed === "." || candidate === allowed || candidate.startsWith(`${allowed}/`);
  });
}

function requireDirectory(targetPath) {
  let stat;
  try {
    stat = fs.lstatSync(targetPath);
  } catch (error) {
    fail("MH_WORK_REPOSITORY", `repository path is unreadable: ${error.message}`);
  }
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    fail("MH_WORK_REPOSITORY", "repository path must be an existing non-symlink directory");
  }
}

function realPath(targetPath, code, label) {
  try {
    return fs.realpathSync.native(targetPath);
  } catch (error) {
    fail(code, `${label} cannot be resolved canonically: ${error.message}`);
  }
}

function lstatIfExists(targetPath, code, label) {
  try {
    return fs.lstatSync(targetPath);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    fail(code, `${label} is unreadable: ${error.message}`);
  }
}

function pathIdentity(value) {
  const resolved = path.resolve(value);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function samePath(left, right) {
  return pathIdentity(left) === pathIdentity(right);
}

function pathContainedBy(parentPath, candidatePath) {
  const relative = path.relative(parentPath, candidatePath);
  return relative === ""
    || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function repositoryRoot(repositoryPath) {
  const target = path.resolve(repositoryPath);
  requireDirectory(target);
  const result = runGit(target, ["rev-parse", "--show-toplevel"]);
  const root = String(result.stdout || "").trim();
  if (!root) fail("MH_WORK_REPOSITORY", "target is not a Git repository");
  const resolved = path.resolve(root);
  requireDirectory(resolved);
  return realPath(resolved, "MH_WORK_REPOSITORY", "repository root");
}

function commonGitDirectory(root) {
  const value = String(runGit(root, ["rev-parse", "--git-common-dir"]).stdout || "").trim();
  if (!value) fail("MH_WORK_GIT", "Git common directory could not be resolved");
  return path.resolve(root, value);
}

function currentBranch(root) {
  const result = runGit(root, ["symbolic-ref", "--quiet", "--short", "HEAD"], { allowFailure: true });
  return result.status === 0 ? String(result.stdout || "").trim() || null : null;
}

function inspectWorkspace(repositoryPath, allowedPaths = ["."]) {
  const root = repositoryRoot(repositoryPath);
  const head = String(runGit(root, ["rev-parse", "HEAD"]).stdout || "").trim();
  const status = runGit(root, [
    "--no-optional-locks",
    "status",
    "--porcelain=v1",
    "-z",
    "--untracked-files=all",
  ]);
  const entries = parsePorcelainZ(status.stdout);
  const outOfScope = entries.filter((entry) => {
    if (!pathAllowed(entry.path, allowedPaths)) return true;
    return entry.originalPath ? !pathAllowed(entry.originalPath, allowedPaths) : false;
  });
  return {
    root,
    head,
    branch: currentBranch(root),
    clean: entries.length === 0,
    entries,
    outOfScope,
    staged: entries.filter((entry) => entry.staged),
  };
}

function exactDeliveryPaths(values) {
  if (!Array.isArray(values)) {
    fail("MH_WORK_DELIVERY_PATH", "accepted delivery paths must be an array");
  }
  const paths = [...new Set(values.map(normalizedPath))].sort();
  for (const itemPath of paths) {
    if (itemPath === "." || !validRelativePath(itemPath)) {
      fail("MH_WORK_DELIVERY_PATH", `invalid accepted delivery path: ${itemPath}`);
    }
  }
  return paths;
}

function dirtyPaths(inspected) {
  if (!inspected || !Array.isArray(inspected.entries)) {
    fail("MH_WORK_CANDIDATE_BOUNDARY", "candidate derivation requires an inspected Git boundary");
  }
  return exactDeliveryPaths(inspected.entries.flatMap((entry) => [entry.path, entry.originalPath].filter(Boolean)));
}

function candidateSealBody(value) {
  const body = JSON.parse(JSON.stringify(value));
  delete body.sealDigest;
  return body;
}

function computeCandidateSealDigest(value) {
  return domainDigest(CANDIDATE_SEAL_DOMAIN, candidateSealBody(value));
}

function candidateSealPath(directory, sessionDigest, workspaceId, generation) {
  const sessionId = String(sessionDigest || "").replace(/^sha256:/u, "");
  if (!/^[a-f0-9]{64}$/u.test(sessionId) || typeof workspaceId !== "string" || !Number.isInteger(generation) || generation < 1) {
    fail("MH_WORK_CANDIDATE_SEAL", "candidate seal identity is invalid");
  }
  return path.join(path.resolve(directory), `${sessionId}.${workspaceId}.generation-${generation}.candidate.json`);
}

function validateCandidateSeal(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("MH_WORK_CANDIDATE_SEAL", "candidate seal must be an object");
  }
  const expected = [
    "schemaVersion",
    "sessionDigest",
    "workspaceId",
    "generation",
    "baseHead",
    "candidatePaths",
    "dirtyManifestDigest",
    "candidateTreeOid",
    "sealedAt",
    "sealDigest",
  ].sort();
  if (Object.keys(value).sort().join("\0") !== expected.join("\0")
      || value.schemaVersion !== CANDIDATE_SEAL_SCHEMA
      || !/^sha256:[a-f0-9]{64}$/u.test(value.sessionDigest)
      || typeof value.workspaceId !== "string"
      || !Number.isInteger(value.generation) || value.generation < 1
      || typeof value.baseHead !== "string" || !/^[a-f0-9]{40,64}$/u.test(value.baseHead)
      || !Array.isArray(value.candidatePaths)
      || !/^sha256:[a-f0-9]{64}$/u.test(value.dirtyManifestDigest)
      || typeof value.candidateTreeOid !== "string" || !/^[a-f0-9]{40,64}$/u.test(value.candidateTreeOid)
      || !Number.isFinite(Date.parse(value.sealedAt))
      || !/^sha256:[a-f0-9]{64}$/u.test(value.sealDigest)
      || value.sealDigest !== computeCandidateSealDigest(value)) {
    fail("MH_WORK_CANDIDATE_SEAL", "candidate seal is invalid");
  }
  const candidatePaths = exactDeliveryPaths(value.candidatePaths);
  if (JSON.stringify(candidatePaths) !== JSON.stringify(value.candidatePaths)) {
    fail("MH_WORK_CANDIDATE_SEAL", "candidate seal paths must be unique and sorted");
  }
  return Object.freeze(JSON.parse(JSON.stringify(value)));
}

function candidateAcceptanceBody(value) {
  const body = JSON.parse(JSON.stringify(value));
  delete body.acceptanceDigest;
  return body;
}

function computeCandidateAcceptanceDigest(value) {
  return domainDigest(CANDIDATE_ACCEPTANCE_DOMAIN, candidateAcceptanceBody(value));
}

function validateCandidateAcceptance(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("MH_WORK_ACCEPTANCE", "candidate acceptance must be an object");
  }
  const expected = [
    "schemaVersion",
    "sessionDigest",
    "candidateSealDigest",
    "candidateTreeOid",
    "verificationDigest",
    "acceptanceDigest",
  ].sort();
  if (Object.keys(value).sort().join("\0") !== expected.join("\0")
      || value.schemaVersion !== CANDIDATE_ACCEPTANCE_SCHEMA
      || !/^sha256:[a-f0-9]{64}$/u.test(value.sessionDigest)
      || !/^sha256:[a-f0-9]{64}$/u.test(value.candidateSealDigest)
      || !/^[a-f0-9]{40,64}$/u.test(value.candidateTreeOid)
      || !/^sha256:[a-f0-9]{64}$/u.test(value.verificationDigest)
      || !/^sha256:[a-f0-9]{64}$/u.test(value.acceptanceDigest)
      || value.acceptanceDigest !== computeCandidateAcceptanceDigest(value)) {
    fail("MH_WORK_ACCEPTANCE", "candidate acceptance proof is invalid");
  }
  return Object.freeze(JSON.parse(JSON.stringify(value)));
}

function acceptCandidate({ session, candidateSeal, verification }) {
  const seal = validateCandidateSeal(candidateSeal);
  if (!session || session.sessionDigest !== seal.sessionDigest) {
    fail("MH_WORK_ACCEPTANCE", "candidate acceptance requires the sealed work session");
  }
  const verificationKeys = ["schemaVersion", "isolation", "candidateTreeOid", "commands", "verificationDigest"].sort();
  const verificationBody = verification && typeof verification === "object" && !Array.isArray(verification)
    ? {
        schemaVersion: verification.schemaVersion,
        isolation: verification.isolation,
        candidateTreeOid: verification.candidateTreeOid,
        commands: verification.commands,
      }
    : null;
  if (!verificationBody
      || Object.keys(verification).sort().join("\0") !== verificationKeys.join("\0")
      || verification.schemaVersion !== "candidate-verification/v1"
      || verification.isolation !== "linux-user-mount-net-pid-chroot/v1"
      || verification.candidateTreeOid !== seal.candidateTreeOid
      || !/^sha256:[a-f0-9]{64}$/u.test(String(verification.verificationDigest || ""))
      || verification.verificationDigest !== domainDigest("meta-harness-candidate-verification/v1", verificationBody)
      || !Array.isArray(verification.commands)
      || verification.commands.length === 0
      || verification.commands.length !== session.validation.length) {
    fail("MH_WORK_ACCEPTANCE", "candidate verification is not bound to this sealed candidate and session");
  }
  for (let index = 0; index < session.validation.length; index += 1) {
    const expectedCommand = session.validation[index];
    const observed = verification.commands[index];
    if (!observed || observed.passed !== true
        || JSON.stringify(observed.argv) !== JSON.stringify(expectedCommand.argv)
        || observed.cwd !== expectedCommand.cwd) {
      fail("MH_WORK_ACCEPTANCE", "isolated verification did not satisfy the sealed validation contract", { index });
    }
  }
  const body = {
    schemaVersion: CANDIDATE_ACCEPTANCE_SCHEMA,
    sessionDigest: session.sessionDigest,
    candidateSealDigest: seal.sealDigest,
    candidateTreeOid: seal.candidateTreeOid,
    verificationDigest: verification.verificationDigest,
  };
  return validateCandidateAcceptance({
    ...body,
    acceptanceDigest: computeCandidateAcceptanceDigest(body),
  });
}

function writeCandidateSealCreateOnly(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  let fd;
  try {
    fd = fs.openSync(filePath, "wx", 0o600);
    fs.writeFileSync(fd, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    fs.fsyncSync(fd);
  } catch (error) {
    if (error?.code === "EEXIST") {
      fail("MH_WORK_CANDIDATE_SEAL_EXISTS", `candidate seal already exists: ${path.basename(filePath)}`);
    }
    fail("MH_WORK_CANDIDATE_SEAL_WRITE", `candidate seal could not be persisted: ${error.message}`);
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

function readCandidateSeal(directory, sessionDigest, workspaceId, generation, { optional = false } = {}) {
  const filePath = candidateSealPath(directory, sessionDigest, workspaceId, generation);
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    if (optional && error?.code === "ENOENT") return null;
    fail("MH_WORK_CANDIDATE_SEAL_READ", `candidate seal is unreadable: ${error.message}`);
  }
  const seal = validateCandidateSeal(parsed);
  if (seal.sessionDigest !== sessionDigest || seal.workspaceId !== workspaceId || seal.generation !== generation) {
    fail("MH_WORK_CANDIDATE_SEAL", "candidate seal identity does not match the requested generation");
  }
  return seal;
}

function prospectiveCandidateTree(workspacePath, baseHead, candidatePaths, directory) {
  const root = repositoryRoot(workspacePath);
  const paths = exactDeliveryPaths(candidatePaths);
  const indexPath = path.join(path.resolve(directory), `.candidate-index.${process.pid}.${crypto.randomUUID()}`);
  fs.mkdirSync(path.dirname(indexPath), { recursive: true });
  const env = { ...process.env, GIT_INDEX_FILE: indexPath };
  try {
    runGit(root, ["read-tree", baseHead], { env });
    if (paths.length > 0) runGit(root, ["add", "-A", "--", ...paths], { env });
    return String(runGit(root, ["write-tree"], { env }).stdout || "").trim();
  } finally {
    try {
      if (fs.existsSync(indexPath)) fs.unlinkSync(indexPath);
    } catch (_) {
      // A failed temporary-index cleanup cannot authorize or alter repository bytes.
    }
  }
}

function sealCandidate({ stateDirectory: directory, session, workspace, boundary, materializedPaths, now = new Date() }) {
  if (!session || !workspace || !boundary) {
    fail("MH_WORK_CANDIDATE_SEAL", "candidate sealing requires session, workspace, and boundary state");
  }
  if (boundary.head !== session.base.commit || boundary.inspected?.staged?.length > 0) {
    fail("MH_WORK_CANDIDATE_AUTHORITY", "candidate sealing requires the sealed base HEAD and an unchanged real Git index");
  }
  const candidatePaths = dirtyPaths(boundary.inspected);
  const materialized = new Set(exactDeliveryPaths(materializedPaths || []));
  const foreign = candidatePaths.filter((itemPath) => !materialized.has(itemPath));
  if (foreign.length > 0) {
    fail("MH_WORK_CANDIDATE_PROVENANCE", "Git-visible candidate dirt includes paths never materialized by the controller", { paths: foreign });
  }
  const body = {
    schemaVersion: CANDIDATE_SEAL_SCHEMA,
    sessionDigest: session.sessionDigest,
    workspaceId: workspace.workspaceId,
    generation: workspace.generation,
    baseHead: session.base.commit,
    candidatePaths,
    dirtyManifestDigest: dirtyManifestDigest(boundary),
    candidateTreeOid: prospectiveCandidateTree(workspace.workspacePath, session.base.commit, candidatePaths, directory),
    sealedAt: now.toISOString(),
  };
  const seal = validateCandidateSeal({ ...body, sealDigest: computeCandidateSealDigest(body) });
  writeCandidateSealCreateOnly(candidateSealPath(directory, seal.sessionDigest, seal.workspaceId, seal.generation), seal);
  return seal;
}

function assertCandidateSealCurrent({ workspacePath, stateDirectory: directory, seal, code = "MH_WORK_CANDIDATE_MUTATION" }) {
  const currentSeal = validateCandidateSeal(seal);
  const inspected = inspectWorkspace(workspacePath, ["."]);
  const candidatePaths = dirtyPaths(inspected);
  const manifestDigest = dirtyManifestDigest({ inspected });
  const treeOid = prospectiveCandidateTree(workspacePath, currentSeal.baseHead, candidatePaths, directory);
  if (inspected.head !== currentSeal.baseHead
      || inspected.staged.length > 0
      || !samePaths(candidatePaths, currentSeal.candidatePaths)
      || manifestDigest !== currentSeal.dirtyManifestDigest
      || treeOid !== currentSeal.candidateTreeOid) {
    fail(code, "Git-authoritative candidate changed after its durable seal", {
      expectedPaths: currentSeal.candidatePaths,
      actualPaths: candidatePaths,
      expectedTreeOid: currentSeal.candidateTreeOid,
      actualTreeOid: treeOid,
    });
  }
  return { inspected, candidatePaths, treeOid };
}

function hashAcceptedPaths(workspacePath, acceptedPaths) {
  const root = repositoryRoot(workspacePath);
  const hashes = {};
  for (const itemPath of exactDeliveryPaths(acceptedPaths)) {
    const target = path.resolve(root, ...itemPath.split("/"));
    const rootPrefix = `${root}${path.sep}`.toLowerCase();
    if (!target.toLowerCase().startsWith(rootPrefix)) {
      fail("MH_WORK_DELIVERY_PATH", `accepted delivery path escapes the repository: ${itemPath}`);
    }
    let stat;
    try {
      stat = fs.lstatSync(target);
    } catch (error) {
      fail("MH_WORK_DELIVERY_PATH", `accepted delivery path is unreadable: ${itemPath}: ${error.message}`);
    }
    if (!stat.isFile() || stat.isSymbolicLink()) {
      fail("MH_WORK_DELIVERY_PATH", `accepted delivery path must be a regular non-symlink file: ${itemPath}`);
    }
    const digest = crypto.createHash("sha256").update(fs.readFileSync(target)).digest("hex");
    hashes[itemPath] = `sha256:${digest}`;
  }
  return Object.freeze(hashes);
}

function verifyAcceptedPathHashes(workspacePath, expectedHashes) {
  if (!expectedHashes || typeof expectedHashes !== "object" || Array.isArray(expectedHashes)) {
    fail("MH_WORK_DELIVERY_HASH", "accepted path hashes must be an object");
  }
  const paths = exactDeliveryPaths(Object.keys(expectedHashes));
  const actual = hashAcceptedPaths(workspacePath, paths);
  for (const itemPath of paths) {
    if (actual[itemPath] !== expectedHashes[itemPath]) {
      fail("MH_WORK_DELIVERY_MUTATION", `accepted path changed after validation: ${itemPath}`, {
        expected: expectedHashes[itemPath],
        actual: actual[itemPath],
      });
    }
  }
  return paths;
}

function nulPaths(text) {
  return String(text || "").split("\0").filter(Boolean).map(normalizedPath).sort();
}

function stagedPaths(root) {
  return nulPaths(runGit(root, ["diff", "--cached", "--name-only", "--no-renames", "-z"]).stdout);
}

function samePaths(left, right) {
  return JSON.stringify([...left].sort()) === JSON.stringify([...right].sort());
}

function deliveryCommitMessage(productResult) {
  const summary = String(productResult || "validated task")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);
  return `Deliver ${summary || "validated task"}`;
}

function remoteBranchHead(root, branch) {
  const ref = `refs/heads/${branch}`;
  const output = String(runGit(root, ["ls-remote", "--heads", "origin", ref]).stdout || "").trim();
  if (!output) return null;
  const [sha, returnedRef] = output.split(/\s+/);
  return returnedRef === ref ? sha : null;
}

function assertManagedDeliveryWorkspace({ repositoryRoot: sourceRepositoryRoot, workspacePath, session, workspaceCustody }) {
  if (!session || typeof session !== "object" || !session.base || typeof session.base.commit !== "string") {
    fail("MH_WORK_DELIVERY_WORKSPACE", "delivery requires a sealed work session with an exact base commit");
  }
  const sourceRoot = repositoryRoot(sourceRepositoryRoot);
  const custody = validateWorkspaceCustody(workspaceCustody);
  if (custody.state !== "ACTIVE"
      || custody.sessionDigest !== session.sessionDigest
      || !samePath(custody.repositoryRoot, sourceRoot)
      || !samePath(custody.workspacePath, workspacePath)
      || custody.baseHead !== session.base.commit) {
    fail("MH_WORK_DELIVERY_WORKSPACE", "delivery requires exact ACTIVE managed-worktree custody for this session");
  }
  const canonicalWorkspace = validateManagedWorktreePath(sourceRoot, custody.workspaceId, workspacePath, { mustExist: true });
  const registered = registeredWorktree(sourceRoot, canonicalWorkspace);
  if (!registered || registered.branch !== custody.branch) {
    fail("MH_WORK_DELIVERY_WORKSPACE", "delivery workspace Git registration does not match controller custody");
  }
  const identity = readWorktreeIdentity(sourceRoot, canonicalWorkspace);
  if (identity.workspaceId !== custody.workspaceId
      || identity.sessionDigest !== custody.sessionDigest
      || !samePath(identity.repositoryRoot, sourceRoot)
      || !samePath(identity.workspacePath, canonicalWorkspace)
      || identity.markerDigest !== custody.gitWorktreeIdentityDigest) {
    fail("MH_WORK_DELIVERY_WORKSPACE", "delivery workspace identity marker does not match controller custody");
  }
  const inspected = inspectWorkspace(canonicalWorkspace, session.allowedPaths);
  if (inspected.head !== custody.baseHead || inspected.branch !== custody.branch) {
    fail("MH_WORK_DELIVERY_WORKSPACE", "delivery workspace HEAD or branch no longer matches controller custody");
  }
  return canonicalWorkspace;
}

function proveBankedCandidate({ workspacePath, seal }) {
  const currentSeal = validateCandidateSeal(seal);
  const root = repositoryRoot(workspacePath);
  const inspected = inspectWorkspace(root, ["."]);
  const head = inspected.head;
  const headTree = String(runGit(root, ["rev-parse", `${head}^{tree}`]).stdout || "").trim();
  const indexPaths = stagedPaths(root);
  const diffPaths = nulPaths(runGit(root, [
    "diff",
    "--name-only",
    "--no-renames",
    "-z",
    currentSeal.baseHead,
    head,
    "--",
  ]).stdout);

  if (currentSeal.candidatePaths.length === 0) {
    if (head !== currentSeal.baseHead
        || headTree !== currentSeal.candidateTreeOid
        || diffPaths.length > 0
        || indexPaths.length > 0
        || inspected.entries.length > 0) {
      fail("MH_WORK_BANK_PROOF", "no-change BANK proof does not match the durable candidate seal");
    }
    return { head, headTree, diffPaths, inspected };
  }

  const parentResult = runGit(root, ["rev-parse", `${head}^`], { allowFailure: true });
  const parent = parentResult.status === 0 ? String(parentResult.stdout || "").trim() : null;
  if (parent !== currentSeal.baseHead
      || headTree !== currentSeal.candidateTreeOid
      || !samePaths(diffPaths, currentSeal.candidatePaths)
      || indexPaths.length > 0
      || inspected.entries.length > 0) {
    fail("MH_WORK_BANK_PROOF", "committed workspace does not exactly match the durable candidate seal", {
      expectedBase: currentSeal.baseHead,
      actualParent: parent,
      expectedTreeOid: currentSeal.candidateTreeOid,
      actualTreeOid: headTree,
      expectedPaths: currentSeal.candidatePaths,
      actualPaths: diffPaths,
    });
  }
  return { head, headTree, diffPaths, inspected };
}

function deliverValidatedChanges({
  repositoryRoot: sourceRepositoryRoot,
  workspacePath,
  session,
  workspaceCustody,
  candidateSeal,
  candidateAcceptance,
  stateDirectory: directory,
  delivery,
  productResult,
}) {
  if (!delivery || typeof delivery.commit !== "boolean" || typeof delivery.push !== "boolean") {
    fail("MH_WORK_DELIVERY_AUTHORITY", "delivery authority must contain boolean commit and push fields");
  }
  const root = assertManagedDeliveryWorkspace({
    repositoryRoot: sourceRepositoryRoot,
    workspacePath,
    session,
    workspaceCustody,
  });
  const seal = validateCandidateSeal(candidateSeal);
  const acceptance = validateCandidateAcceptance(candidateAcceptance);
  if (acceptance.sessionDigest !== session.sessionDigest
      || acceptance.candidateSealDigest !== seal.sealDigest
      || acceptance.candidateTreeOid !== seal.candidateTreeOid) {
    fail("MH_WORK_BANK_ACCEPTANCE", "BANK requires controller acceptance of this exact sealed candidate");
  }
  if (seal.sessionDigest !== session.sessionDigest
      || seal.workspaceId !== workspaceCustody.workspaceId
      || seal.generation !== workspaceCustody.generation
      || seal.baseHead !== session.base.commit) {
    fail("MH_WORK_BANK_SEAL", "BANK requires the exact durable candidate seal for this ACTIVE generation");
  }
  assertCandidateSealCurrent({
    workspacePath: root,
    stateDirectory: directory,
    seal,
    code: "MH_WORK_BANK_MUTATION",
  });
  if (stagedPaths(root).length > 0) {
    fail("MH_WORK_BANK_INDEX", "BANK requires an unchanged real Git index before staging the sealed candidate");
  }

  if (seal.candidatePaths.length === 0) {
    proveBankedCandidate({ workspacePath: root, seal });
    return {
      validation: "passed",
      commit: { status: "no_changes", sha: seal.baseHead, paths: [] },
      push: { status: "not_attempted" },
    };
  }

  runGit(root, ["add", "-A", "--", ...seal.candidatePaths]);
  const staged = stagedPaths(root);
  if (!samePaths(staged, seal.candidatePaths)) {
    fail("MH_WORK_BANK_STAGE", "BANK staged path set does not equal the sealed candidate path set", {
      expected: seal.candidatePaths,
      actual: staged,
    });
  }
  const stagedTree = String(runGit(root, ["write-tree"]).stdout || "").trim();
  if (stagedTree !== seal.candidateTreeOid) {
    fail("MH_WORK_BANK_TREE", "real Git index tree does not equal the sealed candidate tree", {
      expected: seal.candidateTreeOid,
      actual: stagedTree,
    });
  }

  runGit(root, ["commit", "--no-verify", "-m", deliveryCommitMessage(productResult)]);
  const proof = proveBankedCandidate({ workspacePath: root, seal });
  return {
    validation: "passed",
    commit: { status: "committed", sha: proof.head, paths: seal.candidatePaths },
    push: { status: "not_attempted" },
  };
}

function publishBankedChanges({ workspacePath, commit, push }) {
  if (!push) return { status: "not_authorized" };
  if (!commit || commit.status !== "committed") return { status: "not_attempted" };
  const root = repositoryRoot(workspacePath);
  const branch = currentBranch(root);
  if (!branch) {
    return { status: "failed", error: "authorized publication requires a checked-out branch" };
  }
  const pushed = runGit(root, ["push", "origin", `HEAD:refs/heads/${branch}`], { allowFailure: true });
  if (pushed.error || pushed.status !== 0) {
    return {
      status: "failed",
      branch,
      error: String(pushed.stderr || pushed.stdout || pushed.error?.message || "push failed").trim().slice(-2000),
    };
  }
  try {
    const remoteHead = remoteBranchHead(root, branch);
    if (remoteHead !== commit.sha) {
      return { status: "failed", branch, error: "remote HEAD does not equal the banked local commit" };
    }
  } catch (error) {
    return { status: "failed", branch, error: String(error?.message || error).slice(-2000) };
  }
  return { status: "remote_equal", sha: commit.sha, remote: "origin", branch };
}

function slug(value) {
  const normalized = String(value || "work")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 36);
  return normalized || "work";
}

function legacyIsolationRoot(root) {
  const legacyRoot = path.join(path.dirname(root), LEGACY_WORKTREE_DIRECTORY);
  return lstatIfExists(legacyRoot, "MH_WORK_LEGACY_ROOT", "legacy isolation root") ? legacyRoot : null;
}

function requireManagedWorktreeIgnore(root) {
  const ignored = runGit(root, ["check-ignore", "-q", "--", `${MANAGED_WORKTREE_DIRECTORY}/`], { allowFailure: true });
  if (ignored.status !== 0) {
    fail(
      "MH_WORK_WORKTREE_IGNORE",
      `${MANAGED_WORKTREE_DIRECTORY}/ must be ignored before Meta-Harness creates an isolated worktree`,
    );
  }
}

function managedWorktreeRoot(root, { create = false } = {}) {
  const target = path.join(root, MANAGED_WORKTREE_DIRECTORY);
  let stat = lstatIfExists(target, "MH_WORK_WORKTREE_ROOT", "managed worktree root");
  if (!stat) {
    if (!create) return target;
    fs.mkdirSync(target);
    stat = lstatIfExists(target, "MH_WORK_WORKTREE_ROOT", "managed worktree root");
  }
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    fail("MH_WORK_WORKTREE_ROOT", "managed worktree root must be a real directory, not a symlink or junction");
  }
  const canonical = realPath(target, "MH_WORK_WORKTREE_ROOT", "managed worktree root");
  if (!samePath(path.dirname(canonical), root)) {
    fail("MH_WORK_WORKTREE_ESCAPE", "managed worktree root escapes the repository");
  }
  return canonical;
}

function expectedManagedWorktreePath(root, workspaceId) {
  return path.join(root, MANAGED_WORKTREE_DIRECTORY, `${MANAGED_WORKTREE_PREFIX}${workspaceId}`);
}

function validateManagedWorktreePath(root, workspaceId, workspacePath, { mustExist = false } = {}) {
  const expected = expectedManagedWorktreePath(root, workspaceId);
  if (!samePath(workspacePath, expected)) {
    fail("MH_WORK_WORKTREE_ESCAPE", "managed worktree path does not match the controller-owned workspace identity");
  }
  const rootPath = path.join(root, MANAGED_WORKTREE_DIRECTORY);
  if (lstatIfExists(rootPath, "MH_WORK_WORKTREE_ROOT", "managed worktree root")) managedWorktreeRoot(root);
  const stat = lstatIfExists(expected, "MH_WORK_WORKTREE_PATH", "managed worktree path");
  if (!stat) {
    if (mustExist) fail("MH_WORK_WORKTREE_MISSING", `managed worktree is missing: ${expected}`);
    return expected;
  }
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    fail("MH_WORK_WORKTREE_PATH", "managed worktree path must be a real directory, not a symlink or junction");
  }
  const canonicalRoot = managedWorktreeRoot(root);
  const canonicalWorkspace = realPath(expected, "MH_WORK_WORKTREE_PATH", "managed worktree");
  if (!samePath(path.dirname(canonicalWorkspace), canonicalRoot) || !pathContainedBy(root, canonicalWorkspace)) {
    fail("MH_WORK_WORKTREE_ESCAPE", "managed worktree escapes the repository-local worktree root");
  }
  return canonicalWorkspace;
}

function workspaceRegistryDirectory(root) {
  return registryDirectory(commonGitDirectory(root));
}

function custodyDirtyDigest(workspacePath, allowedPaths) {
  const inspected = inspectWorkspace(workspacePath, allowedPaths);
  return {
    inspected,
    digest: dirtyManifestDigest({ inspected }),
  };
}

function registeredWorktree(root, workspacePath) {
  const output = String(runGit(root, ["worktree", "list", "--porcelain"]).stdout || "");
  const blocks = output.trim().split(/\r?\n\r?\n/).filter(Boolean);
  for (const block of blocks) {
    const lines = block.split(/\r?\n/);
    const worktreeLine = lines.find((line) => line.startsWith("worktree "));
    if (!worktreeLine) continue;
    const candidate = path.resolve(worktreeLine.slice("worktree ".length));
    if (!samePath(candidate, workspacePath)) continue;
    const branchLine = lines.find((line) => line.startsWith("branch refs/heads/"));
    return {
      path: candidate,
      branch: branchLine ? branchLine.slice("branch refs/heads/".length) : null,
      detached: lines.includes("detached"),
    };
  }
  return null;
}

function worktreeGitDirectory(root, workspacePath) {
  const value = String(runGit(workspacePath, ["rev-parse", "--git-dir"]).stdout || "").trim();
  if (!value) fail("MH_WORK_WORKTREE_IDENTITY", "managed worktree Git directory could not be resolved");
  const resolved = path.resolve(workspacePath, value);
  const common = commonGitDirectory(root);
  if (!pathContainedBy(common, resolved) || samePath(common, resolved)) {
    fail("MH_WORK_WORKTREE_IDENTITY", "managed worktree Git directory is not a linked-worktree administrative directory");
  }
  return resolved;
}

function worktreeIdentityBody({ workspaceId, sessionDigest, repositoryRoot, workspacePath }) {
  return {
    schemaVersion: WORKTREE_IDENTITY_SCHEMA,
    workspaceId,
    sessionDigest,
    repositoryRoot: path.resolve(repositoryRoot),
    workspacePath: path.resolve(workspacePath),
  };
}

function worktreeIdentityDigest(value) {
  return domainDigest(WORKTREE_IDENTITY_DOMAIN, worktreeIdentityBody(value));
}

function writeWorktreeIdentity(root, workspacePath, workspaceId, sessionDigest) {
  const gitDir = worktreeGitDirectory(root, workspacePath);
  const markerPath = path.join(gitDir, WORKTREE_IDENTITY_FILE);
  const body = worktreeIdentityBody({ workspaceId, sessionDigest, repositoryRoot: root, workspacePath });
  const marker = { ...body, markerDigest: worktreeIdentityDigest(body) };
  let fd;
  try {
    fd = fs.openSync(markerPath, "wx", 0o600);
    fs.writeFileSync(fd, `${JSON.stringify(marker, null, 2)}\n`, "utf8");
    fs.fsyncSync(fd);
  } catch (error) {
    if (error?.code === "EEXIST") fail("MH_WORK_WORKTREE_IDENTITY", "managed worktree identity marker already exists");
    fail("MH_WORK_WORKTREE_IDENTITY", `cannot create managed worktree identity marker: ${error.message}`);
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
  return marker;
}

function readWorktreeIdentity(root, workspacePath) {
  const markerPath = path.join(worktreeGitDirectory(root, workspacePath), WORKTREE_IDENTITY_FILE);
  let marker;
  try {
    marker = JSON.parse(fs.readFileSync(markerPath, "utf8"));
  } catch (error) {
    fail("MH_WORK_WORKTREE_IDENTITY", `managed worktree identity marker is unreadable: ${error.message}`);
  }
  if (!marker || marker.schemaVersion !== WORKTREE_IDENTITY_SCHEMA
      || typeof marker.workspaceId !== "string"
      || typeof marker.sessionDigest !== "string"
      || typeof marker.repositoryRoot !== "string"
      || typeof marker.workspacePath !== "string"
      || typeof marker.markerDigest !== "string"
      || marker.markerDigest !== worktreeIdentityDigest(marker)) {
    fail("MH_WORK_WORKTREE_IDENTITY", "managed worktree identity marker is invalid");
  }
  return marker;
}

function validateCustodyWorkspace(root, session, custody) {
  const current = validateWorkspaceCustody(custody);
  if (current.sessionDigest !== session.sessionDigest) {
    fail("MH_WORKSPACE_CUSTODY_MISMATCH", "workspace custody belongs to a different work session");
  }
  if (!samePath(current.repositoryRoot, root)) {
    fail("MH_WORKSPACE_CUSTODY_MISMATCH", "workspace custody belongs to a different repository root");
  }
  if (current.baseHead !== session.base.commit) {
    fail("MH_WORKSPACE_CUSTODY_MISMATCH", "workspace custody base does not match the sealed work-session base");
  }
  if (current.state !== "ACTIVE") {
    fail("MH_WORKSPACE_NOT_EXECUTABLE", `workspace is terminal or inactive: ${current.state}`);
  }
  requireManagedWorktreeIgnore(root);
  const canonicalWorkspace = validateManagedWorktreePath(root, current.workspaceId, current.workspacePath, { mustExist: true });
  const registered = registeredWorktree(root, canonicalWorkspace);
  if (!registered || registered.branch !== current.branch) {
    fail("MH_WORKSPACE_CUSTODY_MISMATCH", "workspace Git registration does not match controller custody");
  }
  const identity = readWorktreeIdentity(root, canonicalWorkspace);
  if (identity.workspaceId !== current.workspaceId
      || identity.sessionDigest !== current.sessionDigest
      || !samePath(identity.repositoryRoot, current.repositoryRoot)
      || !samePath(identity.workspacePath, current.workspacePath)
      || identity.markerDigest !== current.gitWorktreeIdentityDigest) {
    fail("MH_WORKSPACE_CUSTODY_MISMATCH", "workspace Git administrative identity does not match controller custody");
  }
  const { inspected, digest } = custodyDirtyDigest(canonicalWorkspace, session.allowedPaths);
  if (inspected.head !== current.baseHead) {
    fail("MH_WORKSPACE_CUSTODY_MISMATCH", "ACTIVE workspace HEAD no longer matches its sealed base commit");
  }
  return assertWorkspaceCustodyExecutable({
    custody: current,
    sessionDigest: session.sessionDigest,
    repositoryRoot: root,
    workspacePath: canonicalWorkspace,
    branch: registered.branch,
    baseHead: current.baseHead,
    generation: current.generation,
    dirtyManifestDigest: digest,
  });
}

function worktreePlan(repositoryPath, session) {
  const root = repositoryRoot(repositoryPath);
  const resumed = resumeRecords.get(session);
  if (resumed) {
    if (!samePath(resumed.repositoryRoot, root)) {
      fail("MH_WORKSPACE_CUSTODY_MISMATCH", "resume request targets a different repository root");
    }
    const custody = readWorkspaceCustody(workspaceRegistryDirectory(root), resumed.workspaceId);
    const active = validateCustodyWorkspace(root, session, custody);
    return {
      mode: "isolated",
      reason: "resuming the exact still-ACTIVE controller-owned workspace generation",
      repositoryRoot: root,
      workspaceId: active.workspaceId,
      workspacePath: active.workspacePath,
      branch: active.branch,
      baseHead: active.baseHead,
      head: active.baseHead,
      generation: active.generation,
      custody: active,
      resumed: true,
      existingDirtyPaths: inspectWorkspace(active.workspacePath, session.allowedPaths).entries.map((entry) => entry.path),
      legacyIsolationRoot: legacyIsolationRoot(root),
      wouldCreate: false,
    };
  }

  requireManagedWorktreeIgnore(root);
  assertBaseCommitAvailable(root, session.base.commit);
  const inspected = inspectWorkspace(root, session.allowedPaths);
  const workspaceId = crypto.randomUUID();
  const workspacePath = validateManagedWorktreePath(root, workspaceId, expectedManagedWorktreePath(root, workspaceId));
  return {
    mode: "isolated",
    reason: "new sessions always receive a fresh clean controller-owned worktree from an immutable base commit",
    repositoryRoot: root,
    workspaceId,
    workspacePath,
    branch: `work/${slug(session.productResult)}-${workspaceId.replace(/-/g, "").slice(0, 12)}`,
    baseHead: session.base.commit,
    head: session.base.commit,
    generation: 1,
    resumed: false,
    sourceDirtyPaths: inspected.entries.map((entry) => entry.path),
    legacyIsolationRoot: legacyIsolationRoot(root),
    wouldCreate: true,
  };
}

function prepareWorkspace(repositoryPath, session, selectedPlan) {
  const plan = selectedPlan || worktreePlan(repositoryPath, session);
  if (plan.baseHead !== session.base.commit) {
    fail("MH_WORK_BASE_MISMATCH", "workspace plan base must equal the sealed work-session base commit");
  }
  if (plan.resumed) {
    const custody = validateCustodyWorkspace(plan.repositoryRoot, session, plan.custody);
    return {
      ...plan,
      custody,
      generation: custody.generation,
      created: false,
      reused: true,
      registryDir: workspaceRegistryDirectory(plan.repositoryRoot),
    };
  }

  if (registeredWorktree(plan.repositoryRoot, plan.workspacePath)) {
    fail("MH_WORK_WORKTREE_COLLISION", "fresh workspace identity unexpectedly collides with an existing Git worktree");
  }
  if (lstatIfExists(plan.workspacePath, "MH_WORK_WORKTREE_PATH", "managed worktree path")) {
    fail("MH_WORK_WORKTREE_COLLISION", `fresh workspace path already exists: ${plan.workspacePath}`);
  }
  const branchExists = runGit(plan.repositoryRoot, ["show-ref", "--verify", `refs/heads/${plan.branch}`], { allowFailure: true }).status === 0;
  if (branchExists) {
    fail("MH_WORK_WORKTREE_COLLISION", `fresh workspace branch already exists: ${plan.branch}`);
  }

  const root = managedWorktreeRoot(plan.repositoryRoot, { create: true });
  const target = path.join(root, path.basename(plan.workspacePath));
  if (!samePath(target, plan.workspacePath)) {
    fail("MH_WORK_WORKTREE_ESCAPE", "managed worktree target changed after canonical root resolution");
  }
  runGit(plan.repositoryRoot, ["worktree", "add", "-b", plan.branch, target, plan.baseHead]);
  const physicalPath = validateManagedWorktreePath(plan.repositoryRoot, plan.workspaceId, target, { mustExist: true });
  const createdRegistration = registeredWorktree(plan.repositoryRoot, physicalPath);
  if (!createdRegistration || createdRegistration.branch !== plan.branch) {
    fail("MH_WORK_WORKTREE_REGISTRATION", "created managed worktree is not registered by Git at the recorded physical path");
  }
  const clean = inspectWorkspace(physicalPath, session.allowedPaths);
  if (!clean.clean || clean.head !== plan.baseHead || clean.staged.length > 0) {
    fail("MH_WORK_WORKTREE_DIRTY", "fresh managed worktree did not start from a clean immutable base commit");
  }

  const identity = writeWorktreeIdentity(plan.repositoryRoot, physicalPath, plan.workspaceId, session.sessionDigest);
  const registryDir = workspaceRegistryDirectory(plan.repositoryRoot);
  const createdCustody = createWorkspaceCustody({
    registryDir,
    workspaceId: plan.workspaceId,
    sessionDigest: session.sessionDigest,
    repositoryRoot: plan.repositoryRoot,
    workspacePath: physicalPath,
    baseHead: plan.baseHead,
    branch: plan.branch,
    gitWorktreeIdentityDigest: identity.markerDigest,
    expectedDirtyManifestDigest: dirtyManifestDigest({ inspected: clean }),
  });
  const custody = activateWorkspaceCustody({ registryDir, custody: createdCustody });
  return {
    ...plan,
    workspacePath: physicalPath,
    custody,
    generation: custody.generation,
    registryDir,
    created: true,
    reused: false,
  };
}

function stateDirectory(repositoryPath) {
  const root = repositoryRoot(repositoryPath);
  return path.join(commonGitDirectory(root), "meta-harness", "work-sessions");
}

function persistWorkSession(repositoryPath, session, workspace) {
  const root = repositoryRoot(repositoryPath);
  const directory = stateDirectory(root);
  fs.mkdirSync(directory, { recursive: true });
  if (!workspace || typeof workspace.workspaceId !== "string") {
    fail("MH_WORKSPACE_CUSTODY_MISMATCH", "persisted work session requires controller-owned workspace custody");
  }
  const registryDir = workspace.registryDir || workspaceRegistryDirectory(root);
  const custody = readWorkspaceCustody(registryDir, workspace.workspaceId);
  validateWorkspaceCustody(custody);
  if (custody.sessionDigest !== session.sessionDigest
      || !samePath(custody.repositoryRoot, root)
      || !samePath(custody.workspacePath, workspace.workspacePath)) {
    fail("MH_WORKSPACE_CUSTODY_MISMATCH", "workspace custody does not match the work session being persisted");
  }
  validateManagedWorktreePath(root, custody.workspaceId, custody.workspacePath, { mustExist: true });

  const name = `${session.sessionDigest.slice("sha256:".length)}.json`;
  const sessionPath = path.join(directory, name);
  writeJsonAtomic(sessionPath, session);
  writeJsonAtomic(path.join(directory, "latest.json"), {
    schemaVersion: WORK_SESSION_POINTER_SCHEMA,
    repositoryRoot: root,
    sessionFile: name,
    sessionDigest: session.sessionDigest,
    workspace: {
      workspaceId: custody.workspaceId,
      path: custody.workspacePath,
    },
  });
  const resultStem = `${session.sessionDigest.slice("sha256:".length)}.${custody.workspaceId}`;
  return {
    directory,
    sessionPath,
    resultPath: path.join(directory, `${resultStem}.result.json`),
    schemaPath: path.join(directory, "worker-result.schema.json"),
    agentOutputPath: path.join(directory, `${resultStem}.agent.json`),
  };
}

function readLatestWorkPointer(root, { optional = false } = {}) {
  const directory = stateDirectory(root);
  const pointerPath = path.join(directory, "latest.json");
  let pointer;
  try {
    pointer = JSON.parse(fs.readFileSync(pointerPath, "utf8"));
  } catch (error) {
    if (optional && error?.code === "ENOENT") return null;
    fail("MH_WORK_RESUME", `no resumable work session: ${error.message}`);
  }
  if (!pointer || pointer.schemaVersion !== WORK_SESSION_POINTER_SCHEMA
    || typeof pointer.repositoryRoot !== "string"
    || typeof pointer.sessionFile !== "string"
    || typeof pointer.sessionDigest !== "string"
    || !pointer.workspace || typeof pointer.workspace !== "object" || Array.isArray(pointer.workspace)
    || Object.keys(pointer.workspace).sort().join("\0") !== "path\0workspaceId"
    || typeof pointer.workspace.workspaceId !== "string"
    || typeof pointer.workspace.path !== "string") {
    fail("MH_WORK_RESUME", "latest work-session pointer is invalid");
  }
  if (!samePath(pointer.repositoryRoot, root) || !/^[a-f0-9]{64}\.json$/u.test(pointer.sessionFile)) {
    fail("MH_WORK_RESUME", "latest work-session pointer does not belong to this repository");
  }
  const sessionPath = path.resolve(directory, pointer.sessionFile);
  if (!samePath(path.dirname(sessionPath), directory)) {
    fail("MH_WORK_RESUME", "latest work-session pointer escapes the persisted session directory");
  }
  return { directory, pointer, sessionPath };
}

function recoverBankedWorkspace({ root, session, custody, directory }) {
  const observed = inspectWorkspace(custody.workspacePath, ["."]);
  if (observed.head === custody.baseHead) return custody;

  const registryDir = workspaceRegistryDirectory(root);
  const lease = acquireWorkspaceExecutionLease({ registryDir, workspaceId: custody.workspaceId });
  try {
    const current = readWorkspaceCustody(registryDir, custody.workspaceId);
    if (current.state !== "ACTIVE") return current;
    const inspected = inspectWorkspace(current.workspacePath, ["."]);
    if (inspected.head === current.baseHead) return current;

    let seal = null;
    let sealError = null;
    try {
      seal = readCandidateSeal(directory, session.sessionDigest, current.workspaceId, current.generation, { optional: true });
    } catch (error) {
      sealError = error;
    }

    let proof = null;
    let proofError = sealError;
    if (seal && seal.baseHead === current.baseHead) {
      try {
        proof = proveBankedCandidate({ workspacePath: current.workspacePath, seal });
      } catch (error) {
        proofError = error;
      }
    }

    const terminalState = proof
      ? "TERMINAL_COMMITTED"
      : inspected.entries.length > 0
        ? "TERMINAL_BLOCKED_DIRTY"
        : "TERMINAL_BLOCKED";
    return terminalizeWorkspaceCustody({
      registryDir,
      custody: current,
      workspaceLease: lease,
      terminalState,
      resultDigest: domainDigest(BANK_RECOVERY_RESULT_DOMAIN, {
        sessionDigest: session.sessionDigest,
        workspaceId: current.workspaceId,
        generation: current.generation,
        commitSha: inspected.head,
        candidateSealDigest: seal?.sealDigest || null,
        recovered: Boolean(proof),
        failureCode: proofError?.code || null,
      }),
      validationDigest: domainDigest(BANK_RECOVERY_VALIDATION_DOMAIN, {
        candidateSealDigest: seal?.sealDigest || null,
        bankProof: proof ? "PASS" : "FAIL",
      }),
      finalDirtyManifestDigest: dirtyManifestDigest({ inspected }),
      changedPathHashes: {},
      commitSha: inspected.head,
    });
  } finally {
    releaseWorkspaceExecutionLease({ registryDir, lease });
  }
}

function recoverBankedExecutionResult({ repositoryPath, sessionDigest, workspaceId }) {
  const root = repositoryRoot(repositoryPath);
  const registryDir = workspaceRegistryDirectory(root);
  let custody = readWorkspaceCustody(registryDir, workspaceId);
  if (custody.sessionDigest !== sessionDigest || !samePath(custody.repositoryRoot, root)) {
    fail("MH_WORK_BANK_RECOVERY_EVIDENCE", "admitted workspace custody does not belong to the execution being recovered");
  }
  const directory = stateDirectory(root);
  if (custody.state === "ACTIVE") {
    custody = recoverBankedWorkspace({ root, session: { sessionDigest }, custody, directory });
  }
  if (custody.state !== "TERMINAL_COMMITTED") return null;

  const seal = readCandidateSeal(directory, sessionDigest, workspaceId, custody.generation, { optional: true });
  if (!seal || seal.baseHead !== custody.baseHead) {
    fail("MH_WORK_BANK_RECOVERY_EVIDENCE", "TERMINAL_COMMITTED recovery is missing its exact durable candidate seal");
  }
  const proof = proveBankedCandidate({ workspacePath: custody.workspacePath, seal });
  if (proof.head !== custody.terminal.commitSha) {
    fail("MH_WORK_BANK_RECOVERY_EVIDENCE", "workspace terminal commit does not equal the mechanically proven BANK commit");
  }
  const recoveryValidationDigest = domainDigest(BANK_RECOVERY_VALIDATION_DOMAIN, {
    candidateSealDigest: seal.sealDigest,
    bankProof: "PASS",
  });
  if (custody.terminal.validationDigest !== recoveryValidationDigest) {
    fail("MH_WORK_BANK_RECOVERY_EVIDENCE", "TERMINAL_COMMITTED lacks the controller's exact BANK recovery proof");
  }

  return Object.freeze({
    schemaVersion: "work-bank-recovery-result/v1",
    outcome: "DONE",
    sessionDigest,
    recovered: true,
    changedPaths: seal.candidatePaths,
    workspace: {
      workspaceId,
      generation: custody.generation,
      state: custody.state,
      commitSha: proof.head,
    },
    bankEvidence: {
      candidateSealDigest: seal.sealDigest,
      candidateTreeOid: seal.candidateTreeOid,
      custodyRecordDigest: custody.recordDigest,
      custodyResultDigest: custody.terminal.resultDigest,
      custodyValidationDigest: custody.terminal.validationDigest,
    },
  });
}

function latestWorkSessionState(repositoryPath) {
  const root = repositoryRoot(repositoryPath);
  const latest = readLatestWorkPointer(root, { optional: true });
  if (!latest) return Object.freeze({ state: "NONE", session: null, custodyState: null });

  const { directory, pointer, sessionPath } = latest;
  let custody = readWorkspaceCustody(workspaceRegistryDirectory(root), pointer.workspace.workspaceId);
  if (!samePath(pointer.workspace.path, custody.workspacePath)) {
    fail("MH_WORKSPACE_CUSTODY_MISMATCH", "persisted workspace path does not match controller custody");
  }
  if (custody.state !== "ACTIVE") {
    return Object.freeze({ state: "TERMINAL", session: null, custodyState: custody.state });
  }

  const session = bindWorkSessionToRepository(loadWorkSession(sessionPath), root);
  const expectedFile = `${session.sessionDigest.slice("sha256:".length)}.json`;
  if (pointer.sessionDigest !== session.sessionDigest || pointer.sessionFile !== expectedFile) {
    fail("MH_WORK_RESUME", "persisted session identity does not match the workspace record");
  }
  custody = recoverBankedWorkspace({ root, session, custody, directory });
  if (custody.state !== "ACTIVE") {
    return Object.freeze({ state: "TERMINAL", session: null, custodyState: custody.state });
  }
  const active = validateCustodyWorkspace(root, session, custody);
  resumeRecords.set(session, { repositoryRoot: root, workspaceId: active.workspaceId });
  return Object.freeze({ state: "ACTIVE", session, custodyState: active.state });
}

function loadLatestWorkSession(repositoryPath) {
  const latest = latestWorkSessionState(repositoryPath);
  if (latest.state === "NONE") fail("MH_WORK_RESUME", "no resumable work session exists");
  if (latest.state !== "ACTIVE") {
    fail("MH_WORKSPACE_NOT_EXECUTABLE", `workspace is terminal or inactive: ${latest.custodyState}`);
  }
  return latest.session;
}

module.exports = {
  acceptCandidate,
  assertCandidateSealCurrent,
  deliverValidatedChanges,
  hashAcceptedPaths,
  inspectWorkspace,
  latestWorkSessionState,
  loadLatestWorkSession,
  parsePorcelainZ,
  pathAllowed,
  persistWorkSession,
  prepareWorkspace,
  proveBankedCandidate,
  publishBankedChanges,
  readCandidateSeal,
  recoverBankedExecutionResult,
  repositoryRoot,
  runGit,
  sealCandidate,
  stateDirectory,
  verifyAcceptedPathHashes,
  worktreePlan,
  workspaceRegistryDirectory,
};
