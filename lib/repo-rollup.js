"use strict";

const fs = require("node:fs");
const path = require("node:path");

const HARNESS_DIR = ".meta-harness";
const SCHEMA_VERSION = "1.0.0";
const NOT_CHANGED = Object.freeze([
  "child_repos",
  "child_status",
  "child_events",
  "parent_status",
  "parent_events",
]);

function emptySummary() {
  return {
    total: 0,
    ready: 0,
    warned: 0,
    failed: 0,
    unknown: 0,
    missing: 0,
    invalid: 0,
  };
}

function fileExists(filePath, fsApi = fs) {
  try {
    return fsApi.existsSync(filePath) && fsApi.statSync(filePath).isFile();
  } catch (_error) {
    return false;
  }
}

function dirExists(dirPath, fsApi = fs) {
  try {
    return fsApi.existsSync(dirPath) && fsApi.statSync(dirPath).isDirectory();
  } catch (_error) {
    return false;
  }
}

function readText(filePath, fsApi = fs) {
  return fsApi.readFileSync(filePath, "utf8");
}

function safeReadJson(filePath, fsApi = fs) {
  try {
    return { ok: true, value: JSON.parse(readText(filePath, fsApi)) };
  } catch (error) {
    return { ok: false, error: error && error.message ? error.message : String(error) };
  }
}

function normalizeRepo(rawRepo, index) {
  const name = rawRepo && rawRepo.name ? String(rawRepo.name) : `repo-${index + 1}`;
  const repoPath = rawRepo && rawRepo.path ? String(rawRepo.path) : "";
  const role = rawRepo && rawRepo.role ? String(rawRepo.role) : "child";
  return { name, path: repoPath, role };
}

function readRepoIndex(root, fsApi = fs) {
  const indexPath = path.join(root, HARNESS_DIR, "repos.json");
  if (!fileExists(indexPath, fsApi)) {
    return { repos: [] };
  }
  const parsed = safeReadJson(indexPath, fsApi);
  if (!parsed.ok || !parsed.value || !Array.isArray(parsed.value.repos)) {
    return { repos: [] };
  }
  return { repos: parsed.value.repos.map(normalizeRepo) };
}

function firstNonEmptyLines(text, limit = 6) {
  return String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .slice(0, limit);
}

function extractField(text, label) {
  const expression = new RegExp(`^${label}:\\s*(.+)$`, "im");
  const match = String(text || "").match(expression);
  return match ? match[1].trim() : null;
}

function classifyStatusText(text) {
  const normalized = String(text || "").toLowerCase();
  if (/\b(fail|failed|failing|blocked|blocker)\b/.test(normalized)) {
    return "failed";
  }
  if (/phase:\s*closed\b/.test(normalized)
      || /\b(done-done|ready|pass|passed|complete|completed)\b/.test(normalized)) {
    return "ready";
  }
  return "unknown";
}

function countReadyWarnings(ready) {
  if (Number.isInteger(ready.warned)) {
    return ready.warned;
  }
  if (Number.isInteger(ready.warnings)) {
    return ready.warnings;
  }
  if (Array.isArray(ready.checks)) {
    return ready.checks.filter((check) => check && check.status === "warn").length;
  }
  return 0;
}

function classifyReadyJson(ready) {
  if (!ready || typeof ready !== "object" || !Object.prototype.hasOwnProperty.call(ready, "ok")) {
    return "invalid";
  }
  if (ready.ok === false) {
    return "failed";
  }
  if (ready.ok === true && countReadyWarnings(ready) > 0) {
    return "warned";
  }
  if (ready.ok === true) {
    return "ready";
  }
  return "invalid";
}

function summarizeReadyJson(ready) {
  const summary = [];
  if (Object.prototype.hasOwnProperty.call(ready, "passed")) {
    summary.push(`passed=${ready.passed}`);
  }
  if (Object.prototype.hasOwnProperty.call(ready, "failed")) {
    summary.push(`failed=${ready.failed}`);
  }
  if (Object.prototype.hasOwnProperty.call(ready, "warned")) {
    summary.push(`warned=${ready.warned}`);
  }
  if (Object.prototype.hasOwnProperty.call(ready, "skipped")) {
    summary.push(`skipped=${ready.skipped}`);
  }
  return summary;
}

function repoArtifactPaths(root, repo) {
  const absolutePath = repo.path ? path.resolve(root, repo.path) : root;
  const harnessPath = path.join(absolutePath, HARNESS_DIR);
  return {
    absolutePath,
    readyPath: path.join(harnessPath, "ready.json"),
    statusPath: path.join(harnessPath, "status.md"),
    pollPath: path.join(harnessPath, "poll.md"),
  };
}

function summarizeRepo(root, repo, fsApi = fs) {
  const paths = repoArtifactPaths(root, repo);
  const result = {
    name: repo.name,
    path: repo.path,
    role: repo.role,
    state: "unknown",
    source: null,
    phase: null,
    updated: null,
    evidence: [],
  };

  if (!repo.path || !dirExists(paths.absolutePath, fsApi)) {
    return {
      ...result,
      state: "missing",
      reason: repo.path ? "configured child repo path does not exist" : "configured child repo path is empty",
    };
  }

  if (fileExists(paths.readyPath, fsApi)) {
    const parsed = safeReadJson(paths.readyPath, fsApi);
    if (!parsed.ok) {
      return {
        ...result,
        state: "invalid",
        source: `${HARNESS_DIR}/ready.json`,
        reason: "ready.json could not be parsed",
      };
    }
    const state = classifyReadyJson(parsed.value);
    return {
      ...result,
      state,
      source: `${HARNESS_DIR}/ready.json`,
      phase: parsed.value.phase || null,
      updated: parsed.value.generated_at || parsed.value.updated || null,
      evidence: summarizeReadyJson(parsed.value),
      reason: state === "invalid" ? "ready.json does not expose an ok boolean" : undefined,
    };
  }

  if (fileExists(paths.statusPath, fsApi)) {
    const status = readText(paths.statusPath, fsApi);
    return {
      ...result,
      state: classifyStatusText(status),
      source: `${HARNESS_DIR}/status.md`,
      phase: extractField(status, "Phase"),
      updated: extractField(status, "Updated"),
      evidence: firstNonEmptyLines(status),
    };
  }

  if (fileExists(paths.pollPath, fsApi)) {
    const poll = readText(paths.pollPath, fsApi);
    return {
      ...result,
      state: "unknown",
      source: `${HARNESS_DIR}/poll.md`,
      evidence: firstNonEmptyLines(poll),
      reason: "poll.md is secondary evidence; no ready.json or status.md found",
    };
  }

  return {
    ...result,
    state: "unknown",
    reason: "no ready/status/poll artifact found",
  };
}

function computeOk(summary) {
  if (summary.total === 0) {
    return true;
  }
  return summary.failed === 0
    && summary.missing === 0
    && summary.invalid === 0
    && summary.unknown === 0;
}

function buildRepoRollup(root, options = {}) {
  const fsApi = options.fs || fs;
  const summary = emptySummary();
  const index = readRepoIndex(root, fsApi);
  const repos = index.repos.map((repo) => summarizeRepo(root, repo, fsApi));

  summary.total = repos.length;
  for (const repo of repos) {
    if (Object.prototype.hasOwnProperty.call(summary, repo.state)) {
      summary[repo.state] += 1;
    } else {
      summary.unknown += 1;
    }
  }

  return {
    schema_version: SCHEMA_VERSION,
    generated_from: "local_files",
    ok: computeOk(summary),
    summary,
    repos,
    not_changed: [...NOT_CHANGED],
  };
}

function renderRepoLine(repo) {
  const details = [];
  if (repo.phase) {
    details.push(`Phase: ${repo.phase}`);
  }
  if (repo.updated) {
    details.push(`Updated: ${repo.updated}`);
  }
  if (repo.source) {
    details.push(`Source: ${repo.source}`);
  }
  if (repo.reason) {
    details.push(repo.reason);
  }
  const suffix = details.length > 0 ? ` — ${details.join("; ")}` : "";
  return `- ${repo.name}\t${repo.state}\t${repo.role}\t${repo.path}${suffix}`;
}

function renderRepoRollupMarkdown(rollup) {
  const lines = [
    "# Repo Rollup",
    "",
    `Generated from: ${rollup.generated_from}`,
    `Read-only: ${rollup.not_changed.join(", ")}`,
    "",
    `ROLLUP: ${rollup.summary.ready}/${rollup.summary.total} repos ready`,
    "",
    `ready=${rollup.summary.ready} warned=${rollup.summary.warned} failed=${rollup.summary.failed} unknown=${rollup.summary.unknown} missing=${rollup.summary.missing} invalid=${rollup.summary.invalid}`,
    "",
    "## Child Repos",
    "",
  ];

  if (rollup.repos.length === 0) {
    lines.push("- none");
  } else {
    for (const repo of rollup.repos) {
      lines.push(renderRepoLine(repo));
    }
  }

  return `${lines.join("\n")}\n`;
}

module.exports = {
  buildRepoRollup,
  renderRepoRollupMarkdown,
};
