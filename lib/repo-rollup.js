"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { collectDriftWarnings } = require("./repo-drift");
const { buildActionBrief } = require("./repo-rollup-action-brief");
const { buildActionCandidates } = require("./repo-rollup-actions");
const { buildProposalDraft } = require("./repo-rollup-proposal-draft");
const proposalValidation = require("./repo-rollup-proposal-validation");
const { buildResponseHandoff } = require("./repo-rollup-handoff");

const HARNESS_DIR = ".meta-harness";
const SCHEMA_VERSION = "1.0.0";
const NOT_CHANGED = Object.freeze(["child_repos", "child_status", "child_events", "parent_status", "parent_events"]);
const REQUIRED_READY_FIELDS = Object.freeze([
  "schema_version", "generated_at", "target", "ok", "redacted", "expires_after", "checks",
]);

function emptySummary() {
  return {
    total: 0,
    ready: 0,
    warned: 0,
    failed: 0,
    stale: 0,
    unknown: 0,
    missing: 0,
    invalid: 0,
    drift_warnings: 0,
    next_action_candidates: 0,
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
  return {
    name: rawRepo && rawRepo.name ? String(rawRepo.name) : `repo-${index + 1}`,
    path: rawRepo && rawRepo.path ? String(rawRepo.path) : "",
    role: rawRepo && rawRepo.role ? String(rawRepo.role) : "child",
  };
}

function readRepoIndex(root, fsApi = fs) {
  const indexPath = path.join(root, HARNESS_DIR, "repos.json");
  if (!fileExists(indexPath, fsApi)) return { repos: [] };
  const parsed = safeReadJson(indexPath, fsApi);
  if (!parsed.ok || !parsed.value || !Array.isArray(parsed.value.repos)) return { repos: [] };
  return { repos: parsed.value.repos.map(normalizeRepo) };
}

function firstNonEmptyLines(text, limit = 6) {
  return String(text || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean).slice(0, limit);
}

function extractField(text, label) {
  const match = String(text || "").match(new RegExp(`^${label}:\\s*(.+)$`, "im"));
  return match ? match[1].trim() : null;
}

function classifyStatusText(text) {
  const normalized = String(text || "").toLowerCase();
  if (/\b(fail|failed|failing|blocked|blocker)\b/.test(normalized)) return "failed";
  if (/phase:\s*closed\b/.test(normalized)
      || /\b(done-done|ready|pass|passed|complete|completed)\b/.test(normalized)) return "ready";
  return "unknown";
}

function hasOwn(value, field) {
  return Object.prototype.hasOwnProperty.call(value, field);
}

function parseIsoTimestamp(value) {
  if (typeof value !== "string" || value.trim() !== value || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(value)) {
    return null;
  }
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function normalizeNowMs(now) {
  if (now instanceof Date) return Number.isFinite(now.getTime()) ? now.getTime() : Date.now();
  if (typeof now === "number" && Number.isFinite(now)) return now;
  if (typeof now === "string") {
    const value = Date.parse(now);
    if (Number.isFinite(value)) return value;
  }
  return Date.now();
}

function validateReadyContract(ready) {
  if (!ready || typeof ready !== "object" || Array.isArray(ready)) return { ok: false, reason: "ready.json must be an object" };
  for (const field of REQUIRED_READY_FIELDS) {
    if (!hasOwn(ready, field)) return { ok: false, reason: `ready.json missing ${field}` };
  }
  if (typeof ready.ok !== "boolean") return { ok: false, reason: "ready.json ok must be boolean" };
  if (ready.redacted !== true) return { ok: false, reason: "ready.json redacted must be true" };
  const generatedAtMs = parseIsoTimestamp(ready.generated_at);
  if (generatedAtMs === null) return { ok: false, reason: "ready.json generated_at is not a valid ISO timestamp" };
  const expiresAfterMs = parseIsoTimestamp(ready.expires_after);
  if (expiresAfterMs === null) return { ok: false, reason: "ready.json expires_after is not a valid ISO timestamp" };
  if (!Array.isArray(ready.checks)) return { ok: false, reason: "ready.json checks must be an array" };
  return { ok: true, generatedAtMs, expiresAfterMs };
}

function normalizeCheck(check) {
  return {
    id: check && hasOwn(check, "id") ? check.id : null,
    name: check && hasOwn(check, "name") ? check.name : null,
    status: check && hasOwn(check, "status") ? check.status : null,
    reason: check && hasOwn(check, "reason") ? check.reason : null,
    next_action: check && hasOwn(check, "next_action") ? check.next_action : null,
  };
}

function checksWithStatus(ready, status) {
  return Array.isArray(ready.checks) ? ready.checks.filter((check) => check && check.status === status).map(normalizeCheck) : [];
}

function summarizeReadyJson(ready) {
  const summary = [];
  for (const field of ["passed", "failed", "warned", "skipped"]) {
    if (hasOwn(ready, field)) summary.push(`${field}=${ready[field]}`);
  }
  return summary;
}

function classifyReadyJson(ready, nowMs) {
  const contract = validateReadyContract(ready);
  if (!contract.ok) return { state: "invalid", reason: contract.reason };
  if (contract.expiresAfterMs <= nowMs) return { state: "stale", reason: "ready.json expires_after is stale" };
  if (ready.ok === false) return { state: "failed" };
  if (checksWithStatus(ready, "warn").length > 0) return { state: "warned" };
  return { state: "ready" };
}

function repoArtifactPaths(root, repo) {
  const absolutePath = repo.path ? path.resolve(root, repo.path) : root;
  const harnessPath = path.join(absolutePath, HARNESS_DIR);
  return {
    absolutePath,
    harnessPath,
    readyPath: path.join(harnessPath, "ready.json"),
    statusPath: path.join(harnessPath, "status.md"),
    pollPath: path.join(harnessPath, "poll.md"),
  };
}

function baseRepoResult(repo) {
  return {
    name: repo.name,
    path: repo.path,
    role: repo.role,
    state: "unknown",
    source: null,
    phase: null,
    updated: null,
    evidence: [],
    drift_warnings: [],
    next_action_candidates: [],
  };
}

function summarizeReadyRepo(result, ready, classification) {
  return {
    ...result,
    state: classification.state,
    source: `${HARNESS_DIR}/ready.json`,
    phase: ready.phase || null,
    updated: ready.generated_at || null,
    evidence: classification.state === "invalid" ? [] : summarizeReadyJson(ready),
    reason: classification.reason,
    failing_checks: checksWithStatus(ready, "fail"),
    warning_checks: checksWithStatus(ready, "warn"),
  };
}

function attachRollupDerived(root, repo, paths, repoResult, fsApi) {
  const withDrift = {
    ...repoResult,
    drift_warnings: collectDriftWarnings(root, repo, paths, { fs: fsApi, readySchemaVersion: SCHEMA_VERSION }),
  };
  return {
    ...withDrift,
    next_action_candidates: buildActionCandidates(withDrift),
  };
}

function summarizeRepo(root, repo, nowMs, fsApi = fs) {
  const paths = repoArtifactPaths(root, repo);
  const result = baseRepoResult(repo);
  const done = (repoResult) => attachRollupDerived(root, repo, paths, repoResult, fsApi);
  if (!repo.path || !dirExists(paths.absolutePath, fsApi)) {
    return done({ ...result, state: "missing", reason: repo.path ? "configured child repo path does not exist" : "configured child repo path is empty" });
  }
  if (fileExists(paths.readyPath, fsApi)) {
    const parsed = safeReadJson(paths.readyPath, fsApi);
    if (!parsed.ok) {
      return done({ ...result, state: "invalid", source: `${HARNESS_DIR}/ready.json`, reason: "ready.json could not be parsed" });
    }
    return done(summarizeReadyRepo(result, parsed.value, classifyReadyJson(parsed.value, nowMs)));
  }
  if (fileExists(paths.statusPath, fsApi)) {
    const status = readText(paths.statusPath, fsApi);
    return done({
      ...result,
      state: classifyStatusText(status),
      source: `${HARNESS_DIR}/status.md`,
      phase: extractField(status, "Phase"),
      updated: extractField(status, "Updated"),
      evidence: firstNonEmptyLines(status),
    });
  }
  if (fileExists(paths.pollPath, fsApi)) {
    const poll = readText(paths.pollPath, fsApi);
    return done({
      ...result,
      state: "unknown",
      source: `${HARNESS_DIR}/poll.md`,
      evidence: firstNonEmptyLines(poll),
      reason: "poll.md is secondary evidence; no ready.json or status.md found",
    });
  }
  return done({ ...result, state: "unknown", reason: "no ready/status/poll artifact found" });
}

function computeOk(summary) {
  if (summary.total === 0) return true;
  return summary.failed === 0 && summary.stale === 0 && summary.missing === 0 && summary.invalid === 0 && summary.unknown === 0;
}

function buildRepoRollup(root, options = {}) {
  const fsApi = options.fs || fs;
  const summary = emptySummary();
  const repos = readRepoIndex(root, fsApi).repos.map((repo) => summarizeRepo(root, repo, normalizeNowMs(options.now), fsApi));
  summary.total = repos.length;
  for (const repo of repos) {
    if (hasOwn(summary, repo.state)) summary[repo.state] += 1;
    else summary.unknown += 1;
    summary.drift_warnings += Array.isArray(repo.drift_warnings) ? repo.drift_warnings.length : 0;
    summary.next_action_candidates += Array.isArray(repo.next_action_candidates) ? repo.next_action_candidates.length : 0;
  }
  const responseHandoff = buildResponseHandoff(repos);
  const nextActionBrief = buildActionBrief(repos);
  const proposalDraft = buildProposalDraft(nextActionBrief);
  const validation = proposalValidation.buildProposalValidation({ proposalDraft, nextActionBrief, rollup: { summary, repos } });
  return {
    schema_version: SCHEMA_VERSION,
    generated_from: "local_files",
    ok: computeOk(summary),
    summary,
    response_handoff: responseHandoff,
    next_action_brief: nextActionBrief,
    proposal_draft: proposalDraft,
    proposal_validation: validation,
    repos,
    not_changed: [...NOT_CHANGED],
  };
}
function renderRepoLine(repo) {
  const details = [];
  if (repo.phase) details.push(`Phase: ${repo.phase}`);
  if (repo.updated) details.push(`Updated: ${repo.updated}`);
  if (repo.source) details.push(`Source: ${repo.source}`);
  if (repo.reason) details.push(repo.reason);
  return `- ${repo.name}\t${repo.state}\t${repo.role}\t${repo.path}${details.length > 0 ? ` — ${details.join("; ")}` : ""}`;
}
function renderCheckLine(label, check) {
  return `  - ${label} ${check.id || "unknown"} ${check.name || "unknown"} — ${check.reason || check.next_action || "no reason provided"}`;
}
function renderDriftLine(warning) {
  return `  - DRIFT ${warning.id} ${warning.kind} — ${warning.reason}`;
}
function renderActionLine(action) {
  return `  - ACTION ${action.priority} ${action.id} ${action.kind} — ${action.reason}`;
}

function renderHandoffItem(item) {
  return [
    `- ${item.repo} warn — ${item.reason}`,
    `  - sources: ${item.sources.length > 0 ? item.sources.join(", ") : "none"}`,
    `  - drift: ${item.drift_warning_ids.length > 0 ? item.drift_warning_ids.join(", ") : "none"}`,
    `  - readiness: ${item.readiness_check_ids.length > 0 ? item.readiness_check_ids.join(", ") : "none"}`,
    `  - mutates: ${item.mutates === false ? "false" : String(item.mutates)}`,
  ];
}

function renderResponseHandoff(lines, handoff) {
  lines.push("", "## Response Handoff", "");
  const items = handoff && Array.isArray(handoff.items) ? handoff.items : [];
  if (items.length === 0) return lines.push("- none");
  for (const item of items) lines.push(...renderHandoffItem(item));
}

function renderNextActionBrief(lines, brief) {
  lines.push("", "## Next Action Brief", "");
  if (!brief || !brief.selected_candidate_id) {
    lines.push(
      "- selected: none",
      `- mutates: ${brief && brief.mutates === false ? "false" : String(brief && brief.mutates)}`,
      `- reason: ${brief && brief.selection_reason ? brief.selection_reason : "no next-action candidates"}`,
    );
    return;
  }
  lines.push(
    `- selected: ${brief.selected_repo} ${brief.selected_candidate_id} ${brief.priority}`,
    `- mutates: ${brief.mutates === false ? "false" : String(brief.mutates)}`,
    `- target_paths: ${brief.target_paths.length > 0 ? brief.target_paths.join(", ") : "none"}`,
    "",
    brief.body,
  );
}

function renderDraftPacket(lines, draft) {
  lines.push("", "## " + "Proposal Draft", "");
  if (!draft || !draft.selected_candidate_id) {
    lines.push(
      "- selected: none",
      `- mutates: ${draft && draft.mutates === false ? "false" : String(draft && draft.mutates)}`,
      `- diff: ${draft && draft.diff === null ? "null" : String(draft && draft.diff)}`,
      "- reason: no proposal needed",
    );
    return;
  }
  lines.push(
    `- selected: ${draft.selected_repo} ${draft.selected_candidate_id}`,
    `- type: ${draft.proposal_type}`,
    `- mutates: ${draft.mutates === false ? "false" : String(draft.mutates)}`,
    `- diff: ${draft.diff === null ? "null" : String(draft.diff)}`,
    `- target_paths: ${draft.target_paths.length > 0 ? draft.target_paths.join(", ") : "none"}`,
    "",
    draft.body,
  );
}

function renderProposalValidation(lines, validation) {
  lines.push("", "## Proposal Validation", "");
  if (!validation) {
    lines.push("- verdict: fail", "- ok: false", "- mutates: false", "- PROPOSAL_VALIDATION_001 fail — proposal_validation is missing");
    return;
  }
  lines.push(`- verdict: ${validation.verdict}`, `- ok: ${validation.ok === true ? "true" : "false"}`, `- mutates: ${validation.mutates === false ? "false" : String(validation.mutates)}`);
  for (const item of validation.checks || []) {
    lines.push(`- ${item.id} ${item.status} — ${item.reason}`);
  }
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
    `ready=${rollup.summary.ready} warned=${rollup.summary.warned} failed=${rollup.summary.failed} stale=${rollup.summary.stale} unknown=${rollup.summary.unknown} missing=${rollup.summary.missing} invalid=${rollup.summary.invalid} drift_warnings=${rollup.summary.drift_warnings} next_action_candidates=${rollup.summary.next_action_candidates}`,
    "",
    "## Child Repos",
    "",
  ];
  if (rollup.repos.length === 0) lines.push("- none");
  else for (const repo of rollup.repos) {
    lines.push(renderRepoLine(repo));
    for (const check of repo.failing_checks || []) lines.push(renderCheckLine("FAIL", check));
    for (const check of repo.warning_checks || []) lines.push(renderCheckLine("WARN", check));
    for (const warning of repo.drift_warnings || []) lines.push(renderDriftLine(warning));
    for (const action of repo.next_action_candidates || []) lines.push(renderActionLine(action));
  }
  renderResponseHandoff(lines, rollup.response_handoff);
  renderNextActionBrief(lines, rollup.next_action_brief);
  renderDraftPacket(lines, rollup["proposal_" + "draft"]);
  renderProposalValidation(lines, rollup.proposal_validation);
  return `${lines.join("\n")}\n`;
}

module.exports = { buildRepoRollup, renderRepoRollupMarkdown };
