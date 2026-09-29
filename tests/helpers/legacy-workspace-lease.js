"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const { domainDigest, isDigest } = require("../../lib/contracts/digest");

const SCHEMA = "workspace-execution-lease/v1";
const DOMAIN = "meta-harness-workspace-execution-lease/v1";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function leasePath(registryDir, workspaceId) {
  if (!UUID_RE.test(String(workspaceId || ""))) fail("MH_WORKSPACE_LEASE", "legacy lease workspaceId is invalid");
  return path.join(path.resolve(registryDir), `${workspaceId}.execution.lock`);
}

function body(value) {
  return {
    schemaVersion: SCHEMA,
    workspaceId: value.workspaceId,
    pid: value.pid,
    token: value.token,
    acquiredAt: value.acquiredAt,
  };
}

function computeWorkspaceLeaseDigest(value) {
  return domainDigest(DOMAIN, body(value));
}

function validateWorkspaceExecutionLease(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)
      || value.schemaVersion !== SCHEMA
      || !UUID_RE.test(String(value.workspaceId || ""))
      || !Number.isInteger(value.pid) || value.pid <= 0
      || !UUID_RE.test(String(value.token || ""))
      || !Number.isFinite(Date.parse(value.acquiredAt))
      || !isDigest(value.leaseDigest)
      || value.leaseDigest !== computeWorkspaceLeaseDigest(value)) {
    fail("MH_WORKSPACE_LEASE", "legacy workspace execution lease is invalid");
  }
  return Object.freeze(JSON.parse(JSON.stringify(value)));
}

function readWorkspaceExecutionLease(registryDir, workspaceId) {
  try {
    return validateWorkspaceExecutionLease(JSON.parse(fs.readFileSync(leasePath(registryDir, workspaceId), "utf8")));
  } catch (error) {
    if (error?.code?.startsWith?.("MH_")) throw error;
    fail("MH_WORKSPACE_LEASE", `legacy workspace execution lease is unreadable: ${error.message}`);
  }
}

function processIsLive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code !== "ESRCH";
  }
}

function acquireWorkspaceExecutionLease({ registryDir, workspaceId, now = new Date() }) {
  fs.mkdirSync(path.resolve(registryDir), { recursive: true });
  const filePath = leasePath(registryDir, workspaceId);
  const create = () => {
    const raw = {
      schemaVersion: SCHEMA,
      workspaceId,
      pid: process.pid,
      token: crypto.randomUUID(),
      acquiredAt: now.toISOString(),
    };
    const lease = validateWorkspaceExecutionLease({ ...raw, leaseDigest: computeWorkspaceLeaseDigest(raw) });
    let fd;
    try {
      fd = fs.openSync(filePath, "wx", 0o600);
      fs.writeFileSync(fd, `${JSON.stringify(lease, null, 2)}\n`, "utf8");
      fs.fsyncSync(fd);
      return lease;
    } catch (error) {
      if (error?.code === "EEXIST") return null;
      throw error;
    } finally {
      if (fd !== undefined) fs.closeSync(fd);
    }
  };

  const created = create();
  if (created) return created;
  const existing = readWorkspaceExecutionLease(registryDir, workspaceId);
  if (processIsLive(existing.pid)) fail("MH_WORKSPACE_BUSY", "legacy workspace already has an active execution lease");
  fs.unlinkSync(filePath);
  const recovered = create();
  if (!recovered) fail("MH_WORKSPACE_BUSY", "legacy workspace lease was acquired concurrently");
  return recovered;
}

function assertWorkspaceExecutionLease({ registryDir, lease, workspaceId }) {
  const expected = validateWorkspaceExecutionLease(lease);
  if (expected.workspaceId !== workspaceId) fail("MH_WORKSPACE_LEASE", "legacy lease belongs to another workspace");
  const current = readWorkspaceExecutionLease(registryDir, workspaceId);
  if (current.leaseDigest !== expected.leaseDigest || current.token !== expected.token || current.pid !== expected.pid) {
    fail("MH_WORKSPACE_LEASE", "legacy lease no longer matches");
  }
  return current;
}

function releaseWorkspaceExecutionLease({ registryDir, lease }) {
  const expected = validateWorkspaceExecutionLease(lease);
  const filePath = leasePath(registryDir, expected.workspaceId);
  if (!fs.existsSync(filePath)) return;
  const current = readWorkspaceExecutionLease(registryDir, expected.workspaceId);
  if (current.leaseDigest !== expected.leaseDigest || current.token !== expected.token) {
    fail("MH_WORKSPACE_LEASE", "refusing to release another legacy lease");
  }
  fs.unlinkSync(filePath);
}

function workspaceExecutionLeasesOwnedByPid(registryDir, pid = process.pid) {
  const directory = path.resolve(registryDir);
  if (!fs.existsSync(directory)) return Object.freeze([]);
  const leases = fs.readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /^[0-9a-f-]{36}\.execution\.lock$/u.test(entry.name))
    .map((entry) => entry.name.slice(0, -".execution.lock".length))
    .map((workspaceId) => readWorkspaceExecutionLease(directory, workspaceId))
    .filter((lease) => lease.pid === pid);
  return Object.freeze(leases);
}

module.exports = {
  acquireWorkspaceExecutionLease,
  assertWorkspaceExecutionLease,
  computeWorkspaceLeaseDigest,
  readWorkspaceExecutionLease,
  releaseWorkspaceExecutionLease,
  validateWorkspaceExecutionLease,
  workspaceExecutionLeasesOwnedByPid,
};
