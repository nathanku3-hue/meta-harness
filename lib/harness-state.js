"use strict";

const path = require("node:path");
const eventStore = require("./events");
const {
  HARNESS_DIR,
  ensureDir,
  fileExists,
  readText,
  writeIfMissing,
  writeTextAtomic,
} = require("./paths");
const { fail } = require("./cli-args");

const STREAMS = ["coding", "research", "writing", "review"];
const PHASES = ["intake", "plan", "work", "verify", "synthesize", "handoff", "lookback"];
const REQUESTED_WORK_TYPES = ["docs", "code", "test", "provider_probe", "commit", "validation", "execution", "data_output"];
const ACTUAL_WORK_TYPES = [...REQUESTED_WORK_TYPES, "none"];
const EXECUTION_STYLE_WORK_TYPES = ["code", "test", "provider_probe", "commit", "validation", "execution", "data_output"];

function nowIso() {
  return new Date().toISOString();
}

function toSlash(value) {
  return value.split(path.sep).join("/");
}

function relativePath(targetPath, root = process.cwd()) {
  return toSlash(path.relative(root, targetPath));
}

function harnessPath(context = {}, ...parts) {
  return path.join(context.cwd || process.cwd(), HARNESS_DIR, ...parts);
}

function listPhrase(items) {
  if (items.length <= 1) {
    return items.join("");
  }
  return `${items.slice(0, -1).join(", ")}, or ${items[items.length - 1]}`;
}

function appendEvent(context, event) {
  ensureHarness(context);
  return eventStore.appendEvent(harnessPath(context, "events.jsonl"), event, nowIso);
}

function readEvents(context) {
  return eventStore.readEvents(harnessPath(context, "events.jsonl"));
}

function ensureHarness(context = {}) {
  ensureDir(harnessPath(context));
  ensureDir(harnessPath(context, "contracts"));
  ensureDir(harnessPath(context, "streams"));
  ensureDir(harnessPath(context, "workers"));
  writeIfMissing(harnessPath(context, "events.jsonl"), "");
  writeIfMissing(harnessPath(context, "repos.json"), "{\n  \"repos\": []\n}\n");
}

function requireHarness(context = {}) {
  if (!fileExists(harnessPath(context))) {
    fail("no .meta-harness directory found. Run `meta-harness init` first.");
  }
}

function normalizeStream(value) {
  const stream = value || "coding";
  if (!STREAMS.includes(stream)) {
    fail(`invalid stream "${stream}". Expected one of: ${STREAMS.join(", ")}`);
  }
  return stream;
}

function normalizePhase(value) {
  const phase = value || "work";
  if (!PHASES.includes(phase)) {
    fail(`invalid phase "${phase}". Expected one of: ${PHASES.join(", ")}`);
  }
  return phase;
}

function slugify(value) {
  const slug = String(value || "worker")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "worker";
}

function phaseMapTemplate() {
  return `# Phase Map

Fixed MVP tram-stop map:

\`\`\`text
intake -> plan -> work -> verify -> synthesize -> handoff -> lookback
\`\`\`

| Phase | Meaning |
| --- | --- |
| intake | Capture human intent and acceptance taste. |
| plan | Translate intent into bounded worker tasks. |
| work | Workers produce code, research, drafts, or review findings. |
| verify | Check evidence, tests, citations, or review results. |
| synthesize | Convert worker outputs into official status truth. |
| handoff | Prepare continuation state for a fresh human or Codex worker. |
| lookback | Generate timeline and decision rationale from events. |
`;
}

function streamTemplate(stream) {
  return `# ${stream[0].toUpperCase()}${stream.slice(1)} Stream

State: idle
Owner: unassigned
Updated: not yet

## Current Truth

- none

## Active Task

- none

## Evidence

- none

## Blockers

- none

## Proposed Next Action

- none
`;
}

function workerReportTemplate() {
  return `Outcome: <DONE|PARTIAL_WITH_EXPLICIT_SCOPE|REJECTED>
Round: not recorded
Progress: not recorded
Confidence: not recorded
Worker:
Stream:
Task:
Phase:
Updated:
Ship gate tier: <FAST|REVIEW|SLOW|BLOCK>
Task resolution: <ship|blocked|decision-needed|follow-up-queued>

## What changed

<One paragraph answering what actually changed, what artifact/result was produced, and practical effect.>

## Why it matters

<One short paragraph: current top-level state, unblocked/blocked state, and whether execution-ready, docs-only, design-only, or rejected.>

## What is blocked

<blocker + exact reason, or none>

## What decision is needed

Decision needed from user: <approve|redirect|hold>
Options considered:
Scope limit:
Stop rule:

## Next action

Recommended next action:
Goal:
Allowed scope:
Forbidden scope:

## Validation / evidence

Passed:

Skipped:

Evidence artifacts:

## Accountability

requested_work_type: <${REQUESTED_WORK_TYPES.join("|")}>
actual_work_type_performed: <${ACTUAL_WORK_TYPES.join("|")}>
credentials_touched: false
provider_access_touched: false
data_output_created: false
commit_created: false
remaining_blocker:
ship_gate_tier: <FAST|REVIEW|SLOW|BLOCK>
task_resolution: <ship|blocked|decision-needed|follow-up-queued>

Rules:
- The first non-empty line must be Outcome: <DONE|PARTIAL_WITH_EXPLICIT_SCOPE|REJECTED>.
- The first visible fields must be Outcome, Round, Progress, and Confidence, with no title before them.
- Ship gate tier and Task resolution must appear immediately after Updated.
- The Ship-Fast Decision Gate concept is visible in top metadata and folded into What decision is needed.
- This template is a WORKER_REPORT evidence surface, not the default final chat answer or an ORCHESTRATOR_HANDOVER.
- Final chat answers must use the shortest adaptive PM_CLOSURE that preserves result, useful reason or nearest evidence, remaining next action, and the highest-priority real user decision. Omit empty or none items; labels are optional.
- The four-item budget applies only to normal human-facing closure. Requested audits, reviews, safety evidence, and orchestrator handover state are separate surfaces and do not convert PM_CLOSURE into an audit packet.
- Decision-needed questions use exactly one owner tag: human: taste/acceptance, expert: domain knowledge, or expert: system methodology.
- Authority, credentials, publishing, provider access, execution permission, protected-boundary access, and commit or rollout permission remain Approval needed or Blocked, not expert-decision tags.
- SLOW and tier metadata may remain in WORKER_REPORT accountability and evidence fields, but do not appear in normal chat or PM_CLOSURE output.
- Hide internal labels, hashes, absolute paths, allowlists, command logs, and accountability booleans from final chat unless the user asks for them.
- If the user asks for approval text, emit only the pasteable approval block and do not add an audit recap.
- Do not use # Worker PM Brief, # Worker Report, numbered reviewer logs, command logs, SAW internals, or ClosurePacket lines as the primary report structure.
- SAW Verdict and ClosurePacket details belong only under Validation / evidence.
- Missing requested_work_type or actual_work_type_performed fails closed.
- PARTIAL_WITH_EXPLICIT_SCOPE and REJECTED require an explicit blocker.
- actual_work_type_performed=none requires PARTIAL_WITH_EXPLICIT_SCOPE or REJECTED and an explicit blocker.
- Silent docs-only fallback from ${listPhrase(EXECUTION_STYLE_WORK_TYPES)} work is forbidden.
`;
}

function latest(events, predicate = () => true) {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    if (predicate(events[index])) {
      return events[index];
    }
  }
  return undefined;
}

function fieldFromLatest(events, key, fallback = "none") {
  const event = latest(events, (item) => item[key]);
  return event ? event[key] : fallback;
}

function listOrNone(items) {
  if (items.length === 0) {
    return "- none";
  }
  return items.map((item) => `- ${item}`).join("\n");
}

function eventTime(event) {
  return event.ts || event.time || "unknown time";
}

function hasExplicitBlocker(value) {
  return typeof value === "string" && value.trim().length > 0 && value.trim().toLowerCase() !== "none";
}

function latestStreamFacts(events) {
  return STREAMS.map((stream) => {
    const event = latest(events, (item) => item.stream === stream);
    if (!event) {
      return `- ${stream}: idle`;
    }
    const result = event.result || event.action || "updated";
    return `- ${stream}: ${result}`;
  }).join("\n");
}

function renderStatus(context = {}) {
  const events = readEvents(context);
  const initEvent = events.find((event) => event.action === "initialized harness") || events[0] || {};
  const latestEvent = events[events.length - 1] || {};
  const decisions = events
    .filter((event) => event.decision)
    .map((event) => `${event.decision} (${eventTime(event)})`);
  const blockers = events
    .filter((event) => event.blocker)
    .map((event) => `${event.stream || "unknown"}: ${event.blocker}`);

  return `# Status

Goal:
${initEvent.goal || "Not set."}

Phase:
${latestEvent.phase || "intake"}

Current truth:
${latestEvent.result || "Harness initialized; no worker result recorded yet."}

Active streams:
${latestStreamFacts(events)}

Pending human decisions:
${listOrNone(decisions)}

Blockers:
${listOrNone(blockers)}

Last verified:
${fieldFromLatest(events, "evidence", "not verified")}

Next action:
${fieldFromLatest(events, "next_action", "Plan the next bounded worker task.")}

Stop criteria:
${initEvent.stop_criteria || "Fresh human and Codex worker can resume from local harness state."}

Updated:
${nowIso()}
`;
}

function refreshStatus(context = {}) {
  const status = renderStatus(context);
  writeTextAtomic(harnessPath(context, "status.md"), status);
  return status;
}

module.exports = {
  ACTUAL_WORK_TYPES,
  EXECUTION_STYLE_WORK_TYPES,
  HARNESS_DIR,
  PHASES,
  REQUESTED_WORK_TYPES,
  STREAMS,
  appendEvent,
  eventTime,
  fieldFromLatest,
  hasExplicitBlocker,
  harnessPath,
  latest,
  listOrNone,
  normalizePhase,
  normalizeStream,
  nowIso,
  phaseMapTemplate,
  readEvents,
  refreshStatus,
  relativePath,
  renderStatus,
  requireHarness,
  ensureHarness,
  slugify,
  streamTemplate,
  workerReportTemplate,
};
