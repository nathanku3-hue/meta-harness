"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const { ConfigError, FileSystemError } = require("./errors");
const { gitExecutableForWorkspace } = require("./git-command");
const {
  nativePath,
  pathIdentity,
  runGitInspection,
  scanRepositoryLayout,
} = require("./root-leak-check");

const POLICY_SCHEMA = "portfolio-custody-policy/v1";
const REPORT_SCHEMA = "portfolio-custody-audit/v1";
const REQUIRED_REPOSITORY_FIELDS = [
  "canonicalPath",
  "remote",
  "declaredIntegrationBranch",
  "permittedPrimaryBranches",
  "vendorClassification",
  "maximumActiveWorktrees",
  "maximumInactiveWorktrees",
  "terminalCustodyMode",
  "externalEvidenceRoot",
  "externalArchiveRoot",
  "physicalParityRequired",
  "primaryCleanRequired",
  "exceptions",
];
const TERMINAL_MODES = new Set([
  "remote",
  "bundle",
  "remote-or-bundle",
  "remote-and-bundle",
  "external-receipt",
]);

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
  }
  return value;
}

function sha256Bytes(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function digestObject(value) {
  return sha256Bytes(Buffer.from(JSON.stringify(stableValue(value)), "utf8"));
}

function toDisplayPath(value) {
  return String(value || "").replace(/\\/g, "/");
}

function gitPathArgument(value) {
  const normalized = toDisplayPath(value);
  const mounted = /^\/mnt\/([A-Za-z])(?:\/(.*))?$/.exec(normalized);
  if (!mounted) return value;
  return `${mounted[1].toUpperCase()}:/${mounted[2] || ""}`;
}

function resolveInputPath(value, cwd = process.cwd()) {
  const raw = String(value || "").trim();
  if (!raw) throw new ConfigError("path value is required");
  if (/^[A-Za-z]:[\\/]/.test(raw) || raw.startsWith("/") || raw.startsWith("\\\\")) {
    return nativePath(raw);
  }
  return nativePath(path.resolve(cwd, raw));
}

function loadJson(filePath, label) {
  let bytes;
  try {
    bytes = fs.readFileSync(filePath);
  } catch (error) {
    throw new ConfigError(`${label} is not readable: ${filePath}`, { cause: error });
  }
  try {
    return { value: JSON.parse(bytes.toString("utf8")), bytes };
  } catch (error) {
    throw new ConfigError(`${label} is not valid JSON: ${filePath}`, { cause: error });
  }
}

function validatePolicy(policy) {
  if (!policy || typeof policy !== "object" || Array.isArray(policy)) {
    throw new ConfigError("portfolio policy must be a JSON object");
  }
  if (policy.schema !== POLICY_SCHEMA) {
    throw new ConfigError(`portfolio policy schema must be ${POLICY_SCHEMA}`);
  }
  if (!Array.isArray(policy.repositories) || policy.repositories.length === 0) {
    throw new ConfigError("portfolio policy repositories must be a non-empty array");
  }

  const ids = new Set();
  const paths = new Set();
  for (const [index, repository] of policy.repositories.entries()) {
    if (!repository || typeof repository !== "object" || Array.isArray(repository)) {
      throw new ConfigError(`repositories[${index}] must be an object`);
    }
    const id = String(repository.id || "").trim();
    if (!id) throw new ConfigError(`repositories[${index}].id is required`);
    if (ids.has(id)) throw new ConfigError(`duplicate repository id: ${id}`);
    ids.add(id);
    for (const field of REQUIRED_REPOSITORY_FIELDS) {
      if (!(field in repository)) throw new ConfigError(`${id}.${field} is required`);
    }
    const identity = pathIdentity(repository.canonicalPath);
    if (paths.has(identity)) throw new ConfigError(`duplicate canonicalPath: ${repository.canonicalPath}`);
    paths.add(identity);
    if (!Array.isArray(repository.permittedPrimaryBranches)) {
      throw new ConfigError(`${id}.permittedPrimaryBranches must be an array`);
    }
    if (!Array.isArray(repository.exceptions)) {
      throw new ConfigError(`${id}.exceptions must be an array`);
    }
    if (!Number.isInteger(repository.maximumActiveWorktrees) || repository.maximumActiveWorktrees < 0) {
      throw new ConfigError(`${id}.maximumActiveWorktrees must be a non-negative integer`);
    }
    if (!Number.isInteger(repository.maximumInactiveWorktrees) || repository.maximumInactiveWorktrees < 0) {
      throw new ConfigError(`${id}.maximumInactiveWorktrees must be a non-negative integer`);
    }
    if (!TERMINAL_MODES.has(repository.terminalCustodyMode)) {
      throw new ConfigError(`${id}.terminalCustodyMode is unsupported: ${repository.terminalCustodyMode}`);
    }
  }
  return policy;
}

function parseStatus(text) {
  const counts = { tracked: 0, untracked: 0, ignored: 0 };
  const entries = [];
  const records = String(text || "").split("\0");
  for (let index = 0; index < records.length; index += 1) {
    const raw = records[index];
    if (!raw) continue;
    const xy = raw.slice(0, 2);
    const filePath = raw.slice(3);
    const renameOrCopy = xy.includes("R") || xy.includes("C");
    const sourcePath = renameOrCopy ? records[index + 1] || null : null;
    if (renameOrCopy) index += 1;
    const normalized = filePath.replace(/\\/g, "/").replace(/\/$/, "");
    if (xy === "!!" && [".worktrees", ".worktree-owners"].includes(normalized)) continue;
    const kind = xy === "??" ? "untracked" : xy === "!!" ? "ignored" : "tracked";
    counts[kind] += 1;
    entries.push({ kind, xy, path: filePath, source_path: sourcePath });
  }
  return { counts, entries, clean: counts.tracked === 0 && counts.untracked === 0 };
}

function runGitLarge(args, cwd) {
  const executable = gitExecutableForWorkspace({ cwd: nativePath(cwd), fs });
  const result = spawnSync(executable, args, {
    cwd: nativePath(cwd),
    encoding: "utf8",
    windowsHide: true,
    timeout: 180000,
    maxBuffer: 256 * 1024 * 1024,
  });
  return {
    ok: result.status === 0,
    status: result.status,
    stdout: result.stdout || "",
    stderr: (result.stderr || result.error?.message || "").trim(),
  };
}

function inspectPrimary(root) {
  const branch = runGitInspection(["symbolic-ref", "--quiet", "--short", "HEAD"], root);
  const head = runGitInspection(["rev-parse", "--verify", "HEAD^{commit}"], root);
  const status = runGitLarge([
    "status",
    "--porcelain=v1",
    "--untracked-files=all",
    "--ignored=matching",
    "-z",
  ], root);
  const remoteNames = runGitInspection(["remote"], root);
  const remoteUrls = {};
  if (remoteNames.ok) {
    for (const name of remoteNames.stdout.split(/\r?\n/).map((item) => item.trim()).filter(Boolean)) {
      const remote = runGitInspection(["remote", "get-url", name], root);
      if (remote.ok) remoteUrls[name] = remote.stdout;
    }
  }
  const parsedStatus = status.ok ? parseStatus(status.stdout) : {
    counts: { tracked: 0, untracked: 0, ignored: 0 },
    entries: [],
    clean: false,
  };
  return {
    readable: branch.ok || head.ok,
    branch: branch.ok ? branch.stdout : null,
    detached: head.ok && !branch.ok,
    head: head.ok ? head.stdout : null,
    status_readable: status.ok,
    status: parsedStatus,
    remotes: remoteUrls,
    errors: [branch, head, status, remoteNames]
      .filter((result) => !result.ok)
      .map((result) => result.stderr || "Git inspection failed"),
  };
}

function windowsProcesses() {
  const script = [
    "$ErrorActionPreference='Stop'",
    "Get-CimInstance Win32_Process | Select-Object ProcessId,ExecutablePath,CommandLine | ConvertTo-Json -Compress",
  ].join("; ");
  const result = spawnSync("powershell.exe", ["-NoProfile", "-Command", script], {
    encoding: "utf8",
    windowsHide: true,
    timeout: 30000,
    maxBuffer: 32 * 1024 * 1024,
  });
  if (result.status !== 0 || !String(result.stdout || "").trim()) return [];
  try {
    const parsed = JSON.parse(result.stdout);
    return (Array.isArray(parsed) ? parsed : [parsed]).map((entry) => ({
      pid: Number(entry.ProcessId),
      executable: entry.ExecutablePath || null,
      commandLine: entry.CommandLine || "",
    })).filter((entry) => Number.isInteger(entry.pid) && entry.pid > 0);
  } catch {
    return [];
  }
}

function unixProcesses() {
  const result = spawnSync("ps", ["-eo", "pid=,args="], {
    encoding: "utf8",
    timeout: 30000,
    maxBuffer: 32 * 1024 * 1024,
  });
  if (result.status !== 0) return [];
  return String(result.stdout || "").split(/\r?\n/).map((line) => {
    const match = /^\s*(\d+)\s+(.*)$/.exec(line);
    return match ? { pid: Number(match[1]), executable: null, commandLine: match[2] } : null;
  }).filter(Boolean);
}

function discoverProcesses() {
  if (process.platform === "win32" || fs.existsSync("/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe")) {
    const processes = windowsProcesses();
    if (processes.length > 0) return processes;
  }
  return unixProcesses();
}

function normalizedCommandLine(value) {
  return String(value || "").replace(/\\/g, "/").toLowerCase();
}

function processAssignments(paths, processes) {
  const ordered = paths
    .filter(Boolean)
    .map((item) => ({ path: item, identity: pathIdentity(item), needle: toDisplayPath(item).toLowerCase() }))
    .sort((left, right) => right.needle.length - left.needle.length);
  const assignments = new Map(ordered.map((entry) => [entry.identity, []]));
  for (const processEntry of processes || []) {
    const commandLine = normalizedCommandLine(processEntry.commandLine);
    const matched = ordered.find((entry) => commandLine.includes(entry.needle));
    if (!matched) continue;
    assignments.get(matched.identity).push({
      pid: processEntry.pid,
      executable: processEntry.executable || null,
      command_line: processEntry.commandLine || "",
    });
  }
  return assignments;
}

function readExceptionReceipt(exception, repositoryRoot) {
  if (!exception.receiptPath) return { configured: false, readable: false, value: null, path: null };
  const receiptPath = resolveInputPath(exception.receiptPath, repositoryRoot);
  try {
    return {
      configured: true,
      readable: true,
      value: JSON.parse(fs.readFileSync(receiptPath, "utf8")),
      path: toDisplayPath(receiptPath),
    };
  } catch (error) {
    return {
      configured: true,
      readable: false,
      value: null,
      path: toDisplayPath(receiptPath),
      error: error.message,
    };
  }
}

function evaluateExceptions(repository, now) {
  return repository.exceptions.map((exception, index) => {
    const expiresAt = exception.expiresAt ? Date.parse(exception.expiresAt) : null;
    const expired = Number.isFinite(expiresAt) && expiresAt <= now.getTime();
    const receipt = readExceptionReceipt(exception, repository.canonicalPath);
    const conditionBound = Boolean(String(exception.reviewCondition || "").trim());
    return {
      id: exception.id || `${repository.id}-exception-${index + 1}`,
      kind: exception.kind || "unspecified",
      path: exception.path ? toDisplayPath(nativePath(exception.path)) : null,
      path_identity: exception.path ? pathIdentity(exception.path) : null,
      owner: exception.owner || null,
      review_condition: exception.reviewCondition || null,
      expires_at: exception.expiresAt || null,
      expired,
      condition_bound: conditionBound,
      receipt,
      active: !expired && conditionBound && (!receipt.configured || receipt.readable),
    };
  });
}

function recursiveBundleFiles(root, limit = 100) {
  const resolved = nativePath(root);
  if (!fs.existsSync(resolved)) return [];
  const bundles = [];
  const pending = [resolved];
  while (pending.length > 0 && bundles.length < limit) {
    const directory = pending.pop();
    let entries = [];
    try {
      entries = fs.readdirSync(directory, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) pending.push(entryPath);
      else if (entry.isFile() && entry.name.toLowerCase().endsWith(".bundle")) bundles.push(entryPath);
      if (bundles.length >= limit) break;
    }
  }
  return bundles.sort();
}

function inspectTerminalCustody(repository, primary) {
  const remoteContains = primary.head
    ? runGitInspection(["branch", "-r", "--contains", primary.head, "--format=%(refname:short)"], repository.canonicalPath)
    : { ok: false, stdout: "" };
  const allRemoteRefs = remoteContains.ok
    ? remoteContains.stdout.split(/\r?\n/).map((entry) => entry.trim()).filter(Boolean)
    : [];
  const remoteRefs = repository.remote
    ? allRemoteRefs.filter((entry) => entry === repository.remote || entry.startsWith(`${repository.remote}/`))
    : [];
  const bundleFiles = recursiveBundleFiles(repository.externalArchiveRoot);
  const matchingBundles = [];
  if (primary.head) {
    for (const bundlePath of bundleFiles) {
      const result = runGitInspection(["bundle", "list-heads", gitPathArgument(bundlePath)], repository.canonicalPath);
      if (result.ok && result.stdout.split(/\r?\n/).some((line) => line.startsWith(`${primary.head} `))) {
        matchingBundles.push(toDisplayPath(bundlePath));
      }
    }
  }
  const remote = remoteRefs.length > 0;
  const bundle = matchingBundles.length > 0;
  const externalReceipt = repository.exceptions.some((exception) => {
    if (!exception.receiptPath) return false;
    try {
      const parsed = JSON.parse(fs.readFileSync(resolveInputPath(exception.receiptPath, repository.canonicalPath), "utf8"));
      return parsed && parsed.custodyVerified === true;
    } catch {
      return false;
    }
  });
  const mode = repository.terminalCustodyMode;
  const pass = mode === "remote"
    ? remote
    : mode === "bundle"
      ? bundle
      : mode === "remote-or-bundle"
        ? remote || bundle
        : mode === "remote-and-bundle"
          ? remote && bundle
          : externalReceipt;
  return {
    mode,
    pass,
    remote_contains_head: remote,
    remote_refs: remoteRefs,
    bundle_contains_head: bundle,
    matching_bundles: matchingBundles,
    external_receipt_verified: externalReceipt,
  };
}

function worktreeRecords(layout, assignments, exceptions) {
  return (layout.registeredWorktrees || []).map((entry) => {
    const identity = pathIdentity(entry.path);
    const processEntries = assignments.get(identity) || [];
    const exception = exceptions.find((candidate) => candidate.path_identity === identity && candidate.active) || null;
    const physical = (layout.physicalWorktrees || []).some((candidate) => candidate.path_identity === identity);
    const active = processEntries.length > 0 || Boolean(exception);
    return {
      path: entry.path,
      path_identity: identity,
      head: entry.head || null,
      branch: entry.branch || null,
      detached: Boolean(entry.detached),
      classification: entry.classification,
      registered: true,
      physical,
      prunable: Boolean(entry.prunable),
      active,
      active_reason: processEntries.length > 0 ? "process" : exception ? "policy-exception" : null,
      processes: processEntries,
      exception_id: exception?.id || null,
    };
  });
}

function inspectRepository(repository, processes, now) {
  const root = nativePath(repository.canonicalPath);
  const primary = inspectPrimary(root);
  const layout = scanRepositoryLayout({ targetRoot: root, creatorRoots: [] });
  const exceptions = evaluateExceptions(repository, now);
  const allPaths = [root, ...(layout.registeredWorktrees || []).map((entry) => entry.path), ...(layout.physicalWorktrees || []).map((entry) => entry.path)];
  const assignments = processAssignments(allPaths, processes);
  const worktrees = worktreeRecords(layout, assignments, exceptions);
  const active = worktrees.filter((entry) => entry.active).length;
  const inactive = worktrees.filter((entry) => entry.physical && !entry.active).length;
  const unexplainedPhysical = (layout.physicalWorktrees || []).filter((entry) => {
    if (entry.registered) return false;
    return !exceptions.some((exception) => exception.active && exception.path_identity === entry.path_identity);
  });
  const prunable = worktrees.filter((entry) => entry.prunable);
  const branchAllowed = primary.branch !== null && repository.permittedPrimaryBranches.includes(primary.branch);
  const parityPass = !repository.physicalParityRequired || (
    unexplainedPhysical.length === 0
    && (layout.counts?.registered_only || 0) === 0
    && (layout.counts?.broken_pointers || 0) === 0
  );
  const capacity = {
    active,
    inactive,
    maximum_active: repository.maximumActiveWorktrees,
    maximum_inactive: repository.maximumInactiveWorktrees,
    active_pass: active <= repository.maximumActiveWorktrees,
    inactive_pass: inactive <= repository.maximumInactiveWorktrees,
  };
  capacity.pass = capacity.active_pass && capacity.inactive_pass;
  const terminalCustody = inspectTerminalCustody(repository, primary);
  const findings = [];
  if (!primary.readable) findings.push({ code: "PRIMARY_UNREADABLE", detail: "primary Git state is not readable" });
  if (!primary.status_readable) findings.push({ code: "PRIMARY_STATUS_UNREADABLE", detail: "full tracked, untracked, and ignored status could not be collected" });
  if (!branchAllowed) findings.push({ code: "PRIMARY_BRANCH_POLICY", detail: `primary branch ${primary.branch || "DETACHED"} is not permitted` });
  if (repository.primaryCleanRequired && !primary.status.clean) findings.push({ code: "PRIMARY_DIRTY", detail: "primary checkout is not clean" });
  if (!parityPass) findings.push({ code: "PHYSICAL_PARITY", detail: "physical and registered worktree state is unexplained" });
  if (!capacity.pass) findings.push({ code: "WORKTREE_CAPACITY", detail: `active=${active}, inactive=${inactive}` });
  if (!terminalCustody.pass) findings.push({ code: "TERMINAL_CUSTODY", detail: `${repository.terminalCustodyMode} custody is not satisfied for HEAD` });
  for (const exception of exceptions.filter((entry) => entry.expired)) {
    findings.push({ code: "EXPIRED_EXCEPTION", detail: exception.id });
  }

  return {
    id: repository.id,
    baseline_classification: repository.baselineClassification || null,
    canonical_path: toDisplayPath(root),
    remote_policy: repository.remote,
    declared_integration_branch: repository.declaredIntegrationBranch,
    integration_branch_resolution: repository.integrationBranchResolution || null,
    permitted_primary_branches: repository.permittedPrimaryBranches,
    vendor_classification: repository.vendorClassification,
    primary: {
      branch: primary.branch,
      head: primary.head,
      detached: primary.detached,
      clean: primary.status.clean,
      counts: primary.status.counts,
      branch_allowed: branchAllowed,
      clean_required: repository.primaryCleanRequired,
      processes: assignments.get(pathIdentity(root)) || [],
      remotes: primary.remotes,
      errors: primary.errors,
    },
    layout: {
      status: layout.status,
      counts: layout.counts,
      registered_worktrees: layout.registeredWorktrees,
      physical_worktrees: layout.physicalWorktrees,
      administration_entries: layout.administrationEntries,
      unexplained_physical_only: unexplainedPhysical,
      prunable_registrations: prunable,
      issues: layout.issues,
    },
    worktrees,
    capacity,
    physical_parity: {
      required: repository.physicalParityRequired,
      pass: parityPass,
    },
    terminal_custody: terminalCustody,
    external_evidence_root: toDisplayPath(nativePath(repository.externalEvidenceRoot)),
    external_archive_root: toDisplayPath(nativePath(repository.externalArchiveRoot)),
    exceptions,
    expired_exceptions: exceptions.filter((entry) => entry.expired),
    findings,
    pass: findings.length === 0,
  };
}

function buildPortfolioReport({ policyPath, processEntries, now = new Date() } = {}) {
  const resolvedPolicyPath = resolveInputPath(policyPath);
  const loaded = loadJson(resolvedPolicyPath, "portfolio policy");
  const policy = validatePolicy(loaded.value);
  const processes = processEntries || discoverProcesses();
  const repositories = policy.repositories.map((repository) => inspectRepository(repository, processes, now));
  const summary = {
    repositories: repositories.length,
    passing: repositories.filter((entry) => entry.pass).length,
    with_findings: repositories.filter((entry) => !entry.pass).length,
    tracked: repositories.reduce((total, entry) => total + entry.primary.counts.tracked, 0),
    untracked: repositories.reduce((total, entry) => total + entry.primary.counts.untracked, 0),
    ignored: repositories.reduce((total, entry) => total + entry.primary.counts.ignored, 0),
    registered_worktrees: repositories.reduce((total, entry) => total + entry.worktrees.length, 0),
    physical_worktrees: repositories.reduce((total, entry) => total + (entry.layout.physical_worktrees || []).length, 0),
    active_worktrees: repositories.reduce((total, entry) => total + entry.capacity.active, 0),
    inactive_worktrees: repositories.reduce((total, entry) => total + entry.capacity.inactive, 0),
    prunable_registrations: repositories.reduce((total, entry) => total + entry.layout.prunable_registrations.length, 0),
    expired_exceptions: repositories.reduce((total, entry) => total + entry.expired_exceptions.length, 0),
  };
  const report = {
    schema: REPORT_SCHEMA,
    generated_at: now.toISOString(),
    mode: "report-only",
    policy: {
      path: toDisplayPath(resolvedPolicyPath),
      schema: policy.schema,
      sha256: sha256Bytes(loaded.bytes),
    },
    summary,
    repositories,
    verdict: summary.with_findings === 0 ? "PASS" : "FINDINGS",
    report_payload_sha256: null,
  };
  report.report_payload_sha256 = digestObject(report);
  return report;
}

function ensureParent(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function writePortfolioReport({ policyPath, outputPath, copyPath, processEntries, now } = {}) {
  const report = buildPortfolioReport({ policyPath, processEntries, now });
  const output = resolveInputPath(outputPath);
  const bytes = Buffer.from(`${JSON.stringify(report, null, 2)}\n`, "utf8");
  try {
    ensureParent(output);
    fs.writeFileSync(output, bytes);
  } catch (error) {
    throw new FileSystemError(`unable to write portfolio report ${output}: ${error.message}`, { cause: error });
  }
  let copy = null;
  if (copyPath) {
    const resolvedCopy = resolveInputPath(copyPath);
    try {
      ensureParent(resolvedCopy);
      fs.writeFileSync(resolvedCopy, bytes);
      const byteIdentical = fs.readFileSync(resolvedCopy).equals(bytes);
      if (!byteIdentical) throw new Error("copy is not byte-identical");
      copy = { path: toDisplayPath(resolvedCopy), byte_identical: true, sha256: sha256Bytes(bytes) };
    } catch (error) {
      throw new FileSystemError(`unable to write portfolio report copy ${resolvedCopy}: ${error.message}`, { cause: error });
    }
  }
  return {
    ok: true,
    mode: "report-only",
    verdict: report.verdict,
    output_path: toDisplayPath(output),
    output_sha256: sha256Bytes(bytes),
    output_bytes: bytes.length,
    second_copy: copy,
    summary: report.summary,
    report,
  };
}

module.exports = {
  POLICY_SCHEMA,
  REPORT_SCHEMA,
  buildPortfolioReport,
  discoverProcesses,
  gitPathArgument,
  resolveInputPath,
  validatePolicy,
  writePortfolioReport,
};
