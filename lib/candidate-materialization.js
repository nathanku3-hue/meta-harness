"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const { ConfigError } = require("./errors");
const { gitExecutableForWorkspace } = require("./git-command");
const { validateWorkerOperations } = require("./work-materializer");
const { captureWorkspaceBoundary } = require("./work-git");
const {
  persistCandidateMaterialization,
  validateCandidateMaterialization,
} = require("./candidate-materialization-record");

const GIT_TIMEOUT_MS = 120_000;
const GIT_MAX_BUFFER = 64 * 1024 * 1024;
const OID_RE = /^[a-f0-9]{40,64}$/u;

function fail(code, message, details) {
  throw new ConfigError(message, { code, details });
}

function runGit(cwd, args, { env = process.env, input = undefined, binary = false } = {}) {
  const executable = gitExecutableForWorkspace({ cwd, fs });
  const result = spawnSync(executable, args, {
    cwd,
    env,
    input,
    encoding: binary ? null : "utf8",
    shell: false,
    windowsHide: true,
    timeout: GIT_TIMEOUT_MS,
    maxBuffer: GIT_MAX_BUFFER,
    stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
  });
  if (result.error || result.status !== 0) {
    const stderr = binary ? Buffer.from(result.stderr || []).toString("utf8") : String(result.stderr || "");
    const stdout = binary ? Buffer.from(result.stdout || []).toString("utf8") : String(result.stdout || "");
    fail(
      "MH_CANDIDATE_MATERIALIZATION_GIT",
      `git ${args.join(" ")} failed: ${String(stderr || stdout || result.error?.message || "unknown error").trim()}`,
      { status: result.status, causeCode: result.error?.code },
    );
  }
  return result;
}

function temporaryIndex(stateDirectory) {
  fs.mkdirSync(path.resolve(stateDirectory), { recursive: true });
  return path.join(path.resolve(stateDirectory), `.materialization-index.${process.pid}.${crypto.randomUUID()}`);
}

function treeEntry(workspacePath, treeOid, relativePath) {
  const result = runGit(workspacePath, ["ls-tree", "-z", treeOid, "--", relativePath]);
  const text = String(result.stdout || "");
  if (!text) return null;
  const first = text.split("\0").filter(Boolean);
  if (first.length !== 1) fail("MH_CANDIDATE_MATERIALIZATION_TREE", `tree path is ambiguous: ${relativePath}`);
  const match = /^(\d{6}) blob ([a-f0-9]{40,64})\t([\s\S]+)$/u.exec(first[0]);
  if (!match || match[3] !== relativePath) {
    fail("MH_CANDIDATE_MATERIALIZATION_TREE", `tree entry is not a regular blob: ${relativePath}`);
  }
  return Object.freeze({ mode: match[1], oid: match[2] });
}

function updateIndexEntry(workspacePath, env, relativePath, entry) {
  runGit(workspacePath, ["update-index", "--add", "--cacheinfo", `${entry.mode},${entry.oid},${relativePath}`], { env });
}

function hashWriteContent(workspacePath, relativePath, content) {
  const result = runGit(workspacePath, ["hash-object", "-w", "--stdin", `--path=${relativePath}`], { input: content });
  const oid = String(result.stdout || "").trim();
  if (!OID_RE.test(oid)) fail("MH_CANDIDATE_MATERIALIZATION_TREE", `WRITE did not produce a valid blob identity: ${relativePath}`);
  return oid;
}

function compileCandidateMaterialization({
  stateDirectory,
  workspacePath,
  allowedPaths,
  sessionDigest,
  workspaceId,
  generation,
  attemptEntryDigest,
  resultRecordDigest,
  baselineTreeOid,
  operations,
  now = new Date(),
}) {
  if (!OID_RE.test(String(baselineTreeOid || ""))) {
    fail("MH_CANDIDATE_MATERIALIZATION_TREE", "materialization requires an exact baseline Git tree identity");
  }
  const current = captureWorkspaceBoundary(workspacePath, ["."]);
  if (current.indexDiff !== "" || current.treeOid !== baselineTreeOid) {
    fail("MH_CANDIDATE_MATERIALIZATION_BASELINE", "workspace must still equal the exact packet baseline before target-tree compilation", {
      expectedTreeOid: baselineTreeOid,
      actualTreeOid: current.treeOid,
    });
  }
  const validated = validateWorkerOperations(workspacePath, operations, allowedPaths);
  if (validated.length === 0) return null;

  const touchedPaths = new Set();
  const indexPath = temporaryIndex(stateDirectory);
  const env = { ...process.env, GIT_INDEX_FILE: indexPath };
  try {
    runGit(workspacePath, ["read-tree", baselineTreeOid], { env });
    for (const operation of validated) {
      if (operation.type === "WRITE") {
        touchedPaths.add(operation.path);
        const baseline = treeEntry(workspacePath, baselineTreeOid, operation.path);
        const oid = hashWriteContent(workspacePath, operation.path, operation.content);
        updateIndexEntry(workspacePath, env, operation.path, { mode: baseline?.mode || "100644", oid });
      } else if (operation.type === "DELETE") {
        touchedPaths.add(operation.path);
        if (!treeEntry(workspacePath, baselineTreeOid, operation.path)) {
          fail("MH_CANDIDATE_MATERIALIZATION_TREE", `DELETE source is absent from packet baseline tree: ${operation.path}`);
        }
        runGit(workspacePath, ["update-index", "--force-remove", "--", operation.path], { env });
      } else {
        touchedPaths.add(operation.from);
        touchedPaths.add(operation.to);
        const source = treeEntry(workspacePath, baselineTreeOid, operation.from);
        const target = treeEntry(workspacePath, baselineTreeOid, operation.to);
        if (!source || target) {
          fail("MH_CANDIDATE_MATERIALIZATION_TREE", `MOVE does not match packet baseline tree: ${operation.from} -> ${operation.to}`);
        }
        runGit(workspacePath, ["update-index", "--force-remove", "--", operation.from], { env });
        updateIndexEntry(workspacePath, env, operation.to, source);
      }
    }
    const targetTreeOid = String(runGit(workspacePath, ["write-tree"], { env }).stdout || "").trim();
    if (!OID_RE.test(targetTreeOid)) fail("MH_CANDIDATE_MATERIALIZATION_TREE", "materialization target tree identity is invalid");
    return persistCandidateMaterialization({
      stateDirectory,
      resultRecordDigest,
      sessionDigest,
      workspaceId,
      generation,
      attemptEntryDigest,
      baselineTreeOid,
      targetTreeOid,
      touchedPaths: [...touchedPaths].sort(),
      now,
    });
  } finally {
    try { fs.rmSync(indexPath, { force: true }); } catch (_) {}
  }
}

function safeTarget(workspacePath, relativePath, { createParents = false } = {}) {
  const root = path.resolve(workspacePath);
  const parts = relativePath.split("/");
  let current = root;
  for (let index = 0; index < parts.length - 1; index += 1) {
    current = path.join(current, parts[index]);
    if (!fs.existsSync(current)) {
      if (!createParents) return { target: path.join(root, ...parts), parentMissing: true };
      fs.mkdirSync(current);
      continue;
    }
    const stat = fs.lstatSync(current);
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      fail("MH_CANDIDATE_MATERIALIZATION_FOREIGN", `materialization path parent changed unexpectedly: ${relativePath}`);
    }
  }
  const target = path.join(root, ...parts);
  const prefix = `${root}${path.sep}`.toLowerCase();
  if (!target.toLowerCase().startsWith(prefix)) {
    fail("MH_CANDIDATE_MATERIALIZATION_FOREIGN", `materialization path escapes workspace: ${relativePath}`);
  }
  return { target, parentMissing: false };
}

function currentEntry(workspacePath, relativePath) {
  const resolved = safeTarget(workspacePath, relativePath);
  if (resolved.parentMissing || !fs.existsSync(resolved.target)) return null;
  const target = resolved.target;
  const stat = fs.lstatSync(target);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    fail("MH_CANDIDATE_MATERIALIZATION_FOREIGN", `materialization target is no longer a regular file: ${relativePath}`);
  }
  const bytes = fs.readFileSync(target);
  const oid = String(runGit(workspacePath, ["hash-object", "--stdin", `--path=${relativePath}`], { input: bytes }).stdout || "").trim();
  if (!OID_RE.test(oid)) fail("MH_CANDIDATE_MATERIALIZATION_TREE", `current path did not produce a valid blob identity: ${relativePath}`);
  const mode = process.platform === "win32" ? "100644" : ((stat.mode & 0o111) ? "100755" : "100644");
  return Object.freeze({ mode, oid });
}

function sameEntry(current, expected) {
  if (!current || !expected) return current === expected;
  if (current.oid !== expected.oid) return false;
  if (process.platform === "win32") return true;
  return current.mode === expected.mode;
}

function changedTreePaths(workspacePath, leftTreeOid, rightTreeOid) {
  if (leftTreeOid === rightTreeOid) return [];
  const text = String(runGit(workspacePath, ["diff-tree", "-r", "--no-commit-id", "--name-only", "-z", leftTreeOid, rightTreeOid]).stdout || "");
  return text.split("\0").filter(Boolean).sort();
}

function writeTargetAtomically(workspacePath, stateDirectory, relativePath, entry) {
  const target = safeTarget(workspacePath, relativePath, { createParents: true }).target;
  const bytes = Buffer.from(runGit(workspacePath, ["cat-file", "blob", entry.oid], { binary: true }).stdout || []);
  const tempRoot = path.resolve(stateDirectory);
  fs.mkdirSync(tempRoot, { recursive: true });
  const temp = path.join(tempRoot, `.materialize-file.${process.pid}.${crypto.randomUUID()}`);
  let fd;
  try {
    fd = fs.openSync(temp, "wx", 0o600);
    fs.writeFileSync(fd, bytes);
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;
    if (process.platform !== "win32") fs.chmodSync(temp, entry.mode === "100755" ? 0o755 : 0o644);
    fs.renameSync(temp, target);
  } catch (error) {
    try { if (fd !== undefined) fs.closeSync(fd); } catch (_) {}
    try { fs.rmSync(temp, { force: true }); } catch (_) {}
    fail("MH_CANDIDATE_MATERIALIZATION_WRITE", `cannot realize target path ${relativePath}: ${error.message}`);
  }
}

function assertPlanBinding(plan, { resultRecordDigest, sessionDigest, workspaceId, generation, attemptEntryDigest, baselineTreeOid }) {
  const validated = validateCandidateMaterialization(plan);
  if (validated.resultRecordDigest !== resultRecordDigest
      || validated.sessionDigest !== sessionDigest
      || validated.workspaceId !== workspaceId
      || validated.generation !== generation
      || validated.attemptEntryDigest !== attemptEntryDigest
      || validated.baselineTreeOid !== baselineTreeOid) {
    fail("MH_CANDIDATE_MATERIALIZATION_STALE", "durable materialization target does not match the exact captured proposal generation");
  }
  return validated;
}

function reconcileCandidateMaterialization({ workspacePath, stateDirectory, plan }) {
  const validated = validateCandidateMaterialization(plan);
  const initial = captureWorkspaceBoundary(workspacePath, ["."]);
  if (initial.indexDiff !== "") {
    fail("MH_CANDIDATE_MATERIALIZATION_FOREIGN", "real Git index changed during candidate materialization");
  }
  const foreign = changedTreePaths(workspacePath, validated.baselineTreeOid, initial.treeOid)
    .filter((itemPath) => !validated.touchedPaths.includes(itemPath));
  if (foreign.length > 0) {
    fail("MH_CANDIDATE_MATERIALIZATION_FOREIGN", "workspace contains state outside the durable target-tree write set", { paths: foreign });
  }

  for (const relativePath of validated.touchedPaths) {
    const baseline = treeEntry(workspacePath, validated.baselineTreeOid, relativePath);
    const target = treeEntry(workspacePath, validated.targetTreeOid, relativePath);
    const current = currentEntry(workspacePath, relativePath);
    if (!sameEntry(current, baseline) && !sameEntry(current, target)) {
      fail("MH_CANDIDATE_MATERIALIZATION_FOREIGN", `path is neither its baseline nor target identity: ${relativePath}`);
    }
  }

  for (const relativePath of validated.touchedPaths) {
    const targetEntry = treeEntry(workspacePath, validated.targetTreeOid, relativePath);
    const current = currentEntry(workspacePath, relativePath);
    if (sameEntry(current, targetEntry)) continue;
    const target = safeTarget(workspacePath, relativePath, { createParents: Boolean(targetEntry) }).target;
    if (!targetEntry) {
      if (fs.existsSync(target)) fs.unlinkSync(target);
    } else {
      writeTargetAtomically(workspacePath, stateDirectory, relativePath, targetEntry);
    }
  }

  const finalBoundary = captureWorkspaceBoundary(workspacePath, ["."]);
  if (finalBoundary.indexDiff !== "" || finalBoundary.treeOid !== validated.targetTreeOid) {
    fail("MH_CANDIDATE_MATERIALIZATION_TARGET", "workspace did not converge exactly to the durable target Git tree", {
      expectedTreeOid: validated.targetTreeOid,
      actualTreeOid: finalBoundary.treeOid,
    });
  }
  return Object.freeze({
    materializedPaths: [...validated.touchedPaths],
    targetTreeOid: validated.targetTreeOid,
    boundary: finalBoundary,
  });
}

module.exports = {
  assertPlanBinding,
  compileCandidateMaterialization,
  reconcileCandidateMaterialization,
  treeEntry,
};
