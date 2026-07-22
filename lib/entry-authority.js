"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { evaluateEntryAuthority } = require("./contracts/entry-authority");

const GIT_TIMEOUT_MS = 30_000;
const GIT_MAX_BUFFER = 128 * 1024 * 1024;

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function toPortablePath(value) {
  return String(value).replace(/\\/g, "/");
}

function safeResult(verdict, code, detail) {
  return {
    kind: "entry_authority",
    verdict,
    ok: false,
    reasons: [{ code, detail }],
    redirect: null,
    next_action: "obtain one verified expected repository identity from an external trusted boundary",
    mutates: false,
    writes_files: false,
    executes_child_commands: false,
    spawns_process: false,
    network: false,
    creates_worktree: false,
    creates_ref: false,
  };
}

function runGitReadOnly(cwd, args) {
  const result = spawnSync("git", ["--no-optional-locks", ...args], {
    cwd,
    encoding: "utf8",
    windowsHide: true,
    shell: false,
    timeout: GIT_TIMEOUT_MS,
    maxBuffer: GIT_MAX_BUFFER,
    env: {
      ...process.env,
      GIT_OPTIONAL_LOCKS: "0",
      GIT_TERMINAL_PROMPT: "0",
      GIT_PAGER: "cat",
      PAGER: "cat",
    },
  });
  if (result.error || result.status !== 0) {
    const error = new Error(
      `git ${args.join(" ")} failed: ${String(result.stderr || result.stdout || result.error?.message || "unknown error").trim()}`,
    );
    error.code = result.error?.code === "ETIMEDOUT" ? "ENTRY_GIT_TIMEOUT" : "ENTRY_GIT_FAILED";
    throw error;
  }
  return String(result.stdout || "").trim();
}

function tryGitReadOnly(cwd, args) {
  return spawnSync("git", ["--no-optional-locks", ...args], {
    cwd,
    encoding: "utf8",
    windowsHide: true,
    shell: false,
    timeout: GIT_TIMEOUT_MS,
    maxBuffer: GIT_MAX_BUFFER,
    env: {
      ...process.env,
      GIT_OPTIONAL_LOCKS: "0",
      GIT_TERMINAL_PROMPT: "0",
      GIT_PAGER: "cat",
      PAGER: "cat",
    },
  });
}

function canonicalRemoteRepositoryId(remoteUrl) {
  const value = String(remoteUrl || "").trim().replace(/\\/g, "/");
  if (!value) return "remote:unresolved";

  const githubPatterns = [
    /^https?:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/i,
    /^ssh:\/\/git@github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/i,
    /^git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?$/i,
    /^github\.com:([^/]+)\/([^/]+?)(?:\.git)?$/i,
  ];
  for (const pattern of githubPatterns) {
    const match = value.match(pattern);
    if (match) return `github:${match[1]}/${match[2]}`.toLowerCase();
  }

  return `remote:${value.replace(/\.git$/i, "")}`;
}

function validateProductPath(relativePath) {
  if (typeof relativePath !== "string" || relativePath.length === 0 || relativePath.includes("\0")) {
    throw Object.assign(new Error("product path must be a non-empty relative path"), { code: "ENTRY_PRODUCT_PATH_INVALID" });
  }
  const portable = toPortablePath(relativePath);
  if (path.posix.isAbsolute(portable) || /^[A-Za-z]:\//.test(portable)) {
    throw Object.assign(new Error("product path must be relative"), { code: "ENTRY_PRODUCT_PATH_INVALID" });
  }
  const normalized = path.posix.normalize(portable);
  if (normalized === ".." || normalized.startsWith("../") || normalized === ".") {
    throw Object.assign(new Error("product path must stay inside the repository"), { code: "ENTRY_PRODUCT_PATH_INVALID" });
  }
  return normalized;
}

function collectFilesUnder(repositoryRoot, relativePath, out) {
  const absolute = path.resolve(repositoryRoot, ...relativePath.split("/"));
  const relativeCheck = path.relative(repositoryRoot, absolute);
  if (relativeCheck.startsWith("..") || path.isAbsolute(relativeCheck)) {
    throw Object.assign(new Error("product path escapes repository root"), { code: "ENTRY_PRODUCT_PATH_ESCAPE" });
  }
  if (!fs.existsSync(absolute)) return;
  const stat = fs.lstatSync(absolute);
  if (!stat.isDirectory()) {
    out.add(toPortablePath(path.relative(repositoryRoot, absolute)));
    return;
  }
  for (const entry of fs.readdirSync(absolute, { withFileTypes: true })) {
    const childRelative = `${relativePath}/${entry.name}`;
    const childAbsolute = path.join(absolute, entry.name);
    if (entry.isDirectory()) {
      collectFilesUnder(repositoryRoot, childRelative, out);
    } else {
      out.add(toPortablePath(path.relative(repositoryRoot, childAbsolute)));
    }
  }
}

function collectProductCustody(repositoryRoot, expectedCommit, productPaths) {
  if (!Array.isArray(productPaths)) {
    throw Object.assign(new Error("productPaths must be an array"), { code: "ENTRY_PRODUCT_PATHS_INVALID" });
  }
  const files = new Set();
  for (const rawPath of productPaths) {
    collectFilesUnder(repositoryRoot, validateProductPath(rawPath), files);
  }
  const productFiles = [...files].sort();
  if (productFiles.length === 0) {
    return {
      productBytesPresent: false,
      productBytesReachableFromNamedAuthority: true,
      productFileCount: 0,
      unreachableProductFileCount: 0,
    };
  }

  let unreachable = 0;
  for (const file of productFiles) {
    const check = tryGitReadOnly(repositoryRoot, ["cat-file", "-e", `${expectedCommit}:${file}`]);
    if (check.error || check.status !== 0) unreachable += 1;
  }
  return {
    productBytesPresent: true,
    productBytesReachableFromNamedAuthority: unreachable === 0,
    productFileCount: productFiles.length,
    unreachableProductFileCount: unreachable,
  };
}

function collectObservedCheckoutFacts({ checkoutPath, expected, productPaths = [] } = {}) {
  if (typeof checkoutPath !== "string" || checkoutPath.length === 0) {
    throw Object.assign(new Error("checkoutPath is required"), { code: "ENTRY_CHECKOUT_PATH_REQUIRED" });
  }
  if (!isPlainObject(expected)
    || !isPlainObject(expected.repository)
    || !isPlainObject(expected.authority)) {
    throw Object.assign(new Error("externally trusted expected identity is required"), { code: "ENTRY_EXPECTED_REQUIRED" });
  }

  const requestedPath = path.resolve(checkoutPath);
  const repositoryRoot = path.resolve(runGitReadOnly(requestedPath, ["rev-parse", "--show-toplevel"]));
  const head = runGitReadOnly(repositoryRoot, ["rev-parse", "HEAD"]);
  let objectFormat = runGitReadOnly(repositoryRoot, ["rev-parse", "--show-object-format"]);
  if (objectFormat !== "sha1" && objectFormat !== "sha256") {
    objectFormat = head.length === 64 ? "sha256" : "sha1";
  }
  const symbolicRef = tryGitReadOnly(repositoryRoot, ["symbolic-ref", "-q", "HEAD"]);
  const ref = symbolicRef.status === 0 && String(symbolicRef.stdout || "").trim()
    ? String(symbolicRef.stdout).trim()
    : "DETACHED";
  const status = runGitReadOnly(repositoryRoot, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]);
  const remoteUrl = runGitReadOnly(repositoryRoot, ["remote", "get-url", "origin"]);
  const custody = collectProductCustody(
    repositoryRoot,
    expected.authority.commit,
    productPaths,
  );

  return {
    observed: {
      repositoryId: canonicalRemoteRepositoryId(remoteUrl),
      objectFormat,
      observedHeadRevision: head,
      repositoryRoot: toPortablePath(repositoryRoot),
      ref,
      clean: status.length === 0,
      productBytesPresent: custody.productBytesPresent,
      productBytesReachableFromNamedAuthority: custody.productBytesReachableFromNamedAuthority,
    },
    evidence: {
      origin: remoteUrl,
      dirtyCount: status ? status.split("\0").filter(Boolean).length : 0,
      productFileCount: custody.productFileCount,
      unreachableProductFileCount: custody.unreachableProductFileCount,
    },
    runs_read_only_git_inspection: true,
    executes_child_commands: true,
    mutates: false,
    writes_files: false,
    network: false,
    creates_worktree: false,
    creates_ref: false,
  };
}

function assessEntryAuthority(options = {}) {
  let collection;
  try {
    collection = collectObservedCheckoutFacts(options);
  } catch (error) {
    return {
      kind: "entry_authority_assessment",
      verdict: "BLOCK",
      ok: false,
      input: null,
      observed: null,
      evidence: null,
      result: safeResult("BLOCK", error.code || "ENTRY_OBSERVATION_FAILED", error.message),
      rendered: `BLOCK — ${error.code || "ENTRY_OBSERVATION_FAILED"}: ${error.message}`,
      runs_read_only_git_inspection: false,
      executes_child_commands: false,
      mutates: false,
      writes_files: false,
      network: false,
      creates_worktree: false,
      creates_ref: false,
    };
  }

  const input = { expected: options.expected, observed: collection.observed };
  const result = evaluateEntryAuthority(input);
  return {
    kind: "entry_authority_assessment",
    verdict: result.verdict,
    ok: result.ok,
    input,
    observed: collection.observed,
    evidence: collection.evidence,
    result,
    rendered: renderEntryAuthorityResult(result),
    runs_read_only_git_inspection: true,
    executes_child_commands: true,
    mutates: false,
    writes_files: false,
    network: false,
    creates_worktree: false,
    creates_ref: false,
  };
}

function attachEntryAuthorityToRollup(rollup, options) {
  const assessment = assessEntryAuthority(options);
  rollup.entry_authority = assessment.result;
  if (assessment.input) rollup.entry_authority_input = assessment.input;
  rollup.entry_authority_observation = assessment.observed;
  rollup.entry_authority_evidence = assessment.evidence;
  rollup.runs_read_only_git_inspection = assessment.runs_read_only_git_inspection === true
    || rollup.runs_read_only_git_inspection === true;
  return assessment;
}

function renderEntryAuthorityResult(result) {
  if (!result || typeof result.verdict !== "string") return "BLOCK — invalid entry-authority result";
  if (result.verdict === "PASS_CURRENT") return "PASS_CURRENT";
  if (result.verdict === "REDIRECT" && result.redirect) {
    return `REDIRECT — ${result.redirect.path} ${result.redirect.ref} ${result.redirect.commit}`;
  }
  if (result.verdict === "CUSTODY_REQUIRED") {
    return "CUSTODY_REQUIRED — product bytes lack named Git authority";
  }
  const first = Array.isArray(result.reasons) && result.reasons.length > 0
    ? result.reasons[0]
    : { code: "ENTRY_AUTHORITY_BLOCK", detail: "trusted expected identity is absent or contradictory" };
  return `BLOCK — ${first.code}: ${first.detail}`;
}

function renderEntryAuthorityMarkdown(result) {
  if (!result) return [];
  const lines = ["", "## Entry Authority", "", `- result: ${renderEntryAuthorityResult(result)}`];
  lines.push(`- ok: ${result.ok === true}`);
  lines.push(`- mutates: ${result.mutates === true}`);
  lines.push(`- executes_child_commands: ${result.executes_child_commands === true}`);
  lines.push(`- network: ${result.network === true}`);
  return lines;
}

module.exports = {
  assessEntryAuthority,
  attachEntryAuthorityToRollup,
  canonicalRemoteRepositoryId,
  collectObservedCheckoutFacts,
  renderEntryAuthorityMarkdown,
  renderEntryAuthorityResult,
};
