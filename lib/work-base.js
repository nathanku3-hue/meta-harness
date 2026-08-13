"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const { ConfigError } = require("./errors");
const { gitExecutableForWorkspace } = require("./git-command");

const GIT_TIMEOUT_MS = 120_000;
const GIT_MAX_BUFFER = 64 * 1024 * 1024;
const OID_RE = /^[a-f0-9]{40,64}$/u;
const REMOTE_RE = /^[A-Za-z0-9._-]+$/u;
const LOCAL_REF_RE = /^(?:HEAD|refs\/(?:heads|remotes)\/[A-Za-z0-9._/-]+|[A-Za-z0-9._-]+\/[A-Za-z0-9._/-]+)$/u;

function fail(code, message, details) {
  throw new ConfigError(message, { code, details });
}

function git(cwd, args, { allowFailure = false } = {}) {
  const root = path.resolve(cwd);
  const executable = gitExecutableForWorkspace({ cwd: root, fs });
  const result = spawnSync(executable, args, {
    cwd: root,
    encoding: "utf8",
    shell: false,
    windowsHide: true,
    timeout: GIT_TIMEOUT_MS,
    maxBuffer: GIT_MAX_BUFFER,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (!allowFailure && (result.error || result.status !== 0)) {
    fail(
      "MH_WORK_BASE_GIT",
      `git ${args.join(" ")} failed while resolving work base: ${String(result.stderr || result.stdout || result.error?.message || "unknown error").trim()}`,
      { status: result.status, causeCode: result.error?.code },
    );
  }
  return result;
}

function exactKeys(value, expected, label) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    fail("MH_WORK_BASE_SHAPE", `${label} must be a plain object`);
  }
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (JSON.stringify(actual) !== JSON.stringify(wanted)) {
    fail("MH_WORK_BASE_SHAPE", `${label} has missing or unexpected fields`, { actual, expected: wanted });
  }
}

function nonEmpty(value, label) {
  if (typeof value !== "string" || value.trim() === "") {
    fail("MH_WORK_BASE_VALUE", `${label} must be a non-empty string`);
  }
  return value;
}

function commitOid(value, label = "base.commit") {
  const commit = nonEmpty(value, label).trim();
  if (!OID_RE.test(commit)) fail("MH_WORK_BASE_COMMIT", `${label} must be a lowercase Git object id`);
  return commit;
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

function validateResolvedBase(value, label = "workSession.base") {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("MH_WORK_BASE_SHAPE", `${label} must be an object`);
  }
  if (value.type === "REMOTE_REF") {
    exactKeys(value, ["type", "remote", "ref", "commit"], label);
    const remote = nonEmpty(value.remote, `${label}.remote`);
    if (!REMOTE_RE.test(remote)) fail("MH_WORK_BASE_VALUE", `${label}.remote is not a safe Git remote name`);
    const ref = nonEmpty(value.ref, `${label}.ref`);
    if (!/^refs\/heads\/[A-Za-z0-9._/-]+$/u.test(ref)) {
      fail("MH_WORK_BASE_VALUE", `${label}.ref must be a concrete refs/heads/* identity`);
    }
    commitOid(value.commit, `${label}.commit`);
  } else if (value.type === "LOCAL_REF") {
    exactKeys(value, ["type", "ref", "commit"], label);
    const ref = nonEmpty(value.ref, `${label}.ref`);
    if (!LOCAL_REF_RE.test(ref)) fail("MH_WORK_BASE_VALUE", `${label}.ref is not an accepted explicit local ref`);
    commitOid(value.commit, `${label}.commit`);
  } else if (value.type === "EXACT_COMMIT") {
    exactKeys(value, ["type", "commit"], label);
    commitOid(value.commit, `${label}.commit`);
  } else {
    fail("MH_WORK_BASE_TYPE", `${label}.type must be REMOTE_REF, LOCAL_REF, or EXACT_COMMIT`);
  }
  return deepFreeze(JSON.parse(JSON.stringify(value)));
}

function assertBaseCommitAvailable(repositoryPath, commit) {
  const oid = commitOid(commit);
  const result = git(repositoryPath, ["rev-parse", "--verify", "--quiet", `${oid}^{commit}`], { allowFailure: true });
  const resolved = String(result.stdout || "").trim();
  if (result.status !== 0 || !OID_RE.test(resolved) || resolved !== oid) {
    fail("MH_WORK_BASE_UNAVAILABLE", `sealed base commit is not available in the repository object database: ${oid}`);
  }
  return oid;
}

function parseRemoteDefault(output, remote) {
  const lines = String(output || "").split(/\r?\n/u).map((line) => line.trim()).filter(Boolean);
  const symbolic = lines.map((line) => line.match(/^ref:\s+(refs\/heads\/[A-Za-z0-9._/-]+)\s+HEAD$/u)).find(Boolean);
  const head = lines.map((line) => line.match(/^([a-f0-9]{40,64})\s+HEAD$/u)).find(Boolean);
  if (!symbolic || !head) {
    fail("MH_WORK_BASE_REMOTE", `remote ${remote} does not advertise a symbolic default branch and exact HEAD commit`);
  }
  return { ref: symbolic[1], commit: head[1] };
}

function resolveDefaultRemoteBase(repositoryPath, { remote = "origin" } = {}) {
  if (!REMOTE_RE.test(String(remote))) fail("MH_WORK_BASE_VALUE", "default base remote is not a safe Git remote name");
  const first = parseRemoteDefault(git(repositoryPath, ["ls-remote", "--symref", remote, "HEAD"]).stdout, remote);
  git(repositoryPath, ["fetch", "--no-tags", "--no-write-fetch-head", remote, first.commit]);
  const after = parseRemoteDefault(git(repositoryPath, ["ls-remote", "--symref", remote, "HEAD"]).stdout, remote);
  if (after.ref !== first.ref || after.commit !== first.commit) {
    fail("MH_WORK_BASE_RACE", `remote ${remote} default identity changed during base resolution; retry NEW work`, {
      before: first,
      after,
    });
  }
  assertBaseCommitAvailable(repositoryPath, first.commit);
  return validateResolvedBase({ type: "REMOTE_REF", remote, ref: first.ref, commit: first.commit });
}

function resolveExplicitLocalBase(repositoryPath, revisionInput) {
  const revision = nonEmpty(revisionInput, "--base").trim();
  if (revision.startsWith("-")) fail("MH_WORK_BASE_VALUE", "--base must not begin with '-'");
  const lower = revision.toLowerCase();
  if (OID_RE.test(lower) && revision.length === lower.length) {
    assertBaseCommitAvailable(repositoryPath, lower);
    return validateResolvedBase({ type: "EXACT_COMMIT", commit: lower });
  }
  if (!LOCAL_REF_RE.test(revision)) {
    fail(
      "MH_WORK_BASE_VALUE",
      "--base must be HEAD, an exact commit OID, refs/heads/*, refs/remotes/*, or an explicit slash-qualified local ref such as origin/feature",
    );
  }
  const result = git(repositoryPath, ["rev-parse", "--verify", "--quiet", `${revision}^{commit}`], { allowFailure: true });
  const commit = String(result.stdout || "").trim();
  if (result.status !== 0 || !OID_RE.test(commit)) {
    fail("MH_WORK_BASE_UNAVAILABLE", `explicit local base does not resolve to an available commit: ${revision}`);
  }
  return validateResolvedBase({ type: "LOCAL_REF", ref: revision, commit });
}

module.exports = {
  assertBaseCommitAvailable,
  resolveDefaultRemoteBase,
  resolveExplicitLocalBase,
  validateResolvedBase,
};
