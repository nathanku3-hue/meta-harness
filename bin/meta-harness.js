#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { ConfigError, QualityGateError, UsageError, handleCliError } = require("../lib/errors");
const eventStore = require("../lib/events");
const { readJsonFile: readJson, writeJsonFile: writeJson } = require("../lib/json");
const {
  HARNESS_DIR,
  ensureDir,
  fileExists,
  harnessPath,
  readText,
  writeIfMissing,
  writeText,
  writeTextAtomic,
} = require("../lib/paths");
const { execSync } = require("node:child_process");
const { commandQuality } = require("../lib/quality");
const { commandDirty, commandGate } = require("../lib/dirty");
const { commandBrief, commandDecisions } = require("../lib/decisions");
const { commandDistill } = require("../lib/skill-distillation");
const { copyPackagedTemplates, templateFiles } = require("../lib/templates");
const { buildExpertPacket } = require("../lib/expert-packet");
const {
  checkTemplateSync,
  scanContracts,
  checkTrustPolicy,
  checkStateLayout,
} = require("../lib/sync-check");
const { scanPmBrief } = require("../lib/pm-brief-check");
const { scanDecisionInbox } = require("../lib/decision-inbox-check");

const STREAMS = ["coding", "research", "writing", "review"];
const PHASES = ["intake", "plan", "work", "verify", "synthesize", "handoff", "lookback"];
const REQUESTED_WORK_TYPES = ["docs", "code", "test", "provider_probe", "commit", "validation", "execution", "data_output"];
const ACTUAL_WORK_TYPES = [...REQUESTED_WORK_TYPES, "none"];
const EXECUTION_STYLE_WORK_TYPES = ["code", "test", "provider_probe", "commit", "validation", "execution", "data_output"];

function listPhrase(items) {
  if (items.length <= 1) {
    return items.join("");
  }
  return `${items.slice(0, -1).join(", ")}, or ${items[items.length - 1]}`;
}

function usage() {
  return `meta-harness

Markdown-first Codex-native workflow visibility harness.

Usage:
  meta-harness init [goal] [--owner <name>]
  meta-harness status [--refresh]
  meta-harness event --stream <stream> --phase <phase> --action <text> --result <text>
  meta-harness worker-report [worker-id] --stream <stream> --task <text> --outcome <DONE|PARTIAL_WITH_EXPLICIT_SCOPE|REJECTED> --requested-work-type <type> --actual-work-type <type> [--result <text>]
  meta-harness templates list
  meta-harness templates install [--overwrite]
  meta-harness sync check --target <repo>
  meta-harness trust check --target <repo>
  meta-harness contract scan --target <repo>
  meta-harness state check --target <repo>
  meta-harness dirty snapshot --out <path>
  meta-harness dirty classify --before <path> --after <path> --scope <path> --out <path>
  meta-harness gate scope --dirty <path> --scope <path>
  meta-harness decisions list --in <path>
  meta-harness decisions add --kind <kind> --question <text> --state-hash <hash>
  meta-harness decisions resolve --id <id> --resolution <approved|rejected|deferred>
  meta-harness decisions scan --target <repo>
  meta-harness ready --target <repo> [--json] [--quick] [--read-only] [--no-exec] [--mode <local|strict|release>] [--strict-github-settings]
  meta-harness distill add --decision-id <id> --principle <text> --skill <name> --assumption <text> --reopen-when <text> [--enforcement <check>] [--owner <owner>] [--out <path>]
  meta-harness distill list --in <path>
  meta-harness distill check --in <path>
  meta-harness brief pm --dirty <path> --decisions <path> --out <path>
  meta-harness brief scan --target <repo>
  meta-harness expert-packet <round-id> [--include <path>] [--owned-path <path>] [--forbidden-path <path>] [--required-evidence <text>] [--overwrite]
  meta-harness quality init
  meta-harness quality baseline --force
  meta-harness quality check
  meta-harness quality explain
  meta-harness lookback [--write]
  meta-harness poll [--write]
  meta-harness repos list
  meta-harness repos add <name> <path> [--role <role>]
  meta-harness repos remove <name>

Streams: ${STREAMS.join(", ")}
Phases:  ${PHASES.join(" -> ")}
`;
}

function parseArgs(argv) {
  const positional = [];
  const options = {};

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      positional.push(token);
      continue;
    }

    const key = token.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    const next = argv[index + 1];
    if (next === undefined || next.startsWith("--")) {
      addOption(options, key, true);
    } else {
      addOption(options, key, next);
      index += 1;
    }
  }

  return { positional, options };
}

function addOption(options, key, value) {
  if (Object.prototype.hasOwnProperty.call(options, key)) {
    const current = options[key];
    options[key] = Array.isArray(current) ? [...current, value] : [current, value];
  } else {
    options[key] = value;
  }
}

function optionValue(value, fallback = undefined) {
  if (Array.isArray(value)) {
    return value[value.length - 1] ?? fallback;
  }
  return value ?? fallback;
}

function optionValues(value) {
  if (value === undefined || value === null || value === true) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

function fail(message, code = 2) { throw new UsageError(message, { exitCode: code }); }

function nowIso() {
  return new Date().toISOString();
}

function relativePath(targetPath, root = process.cwd()) {
  return path.relative(root, targetPath).split(path.sep).join("/");
}

function appendEvent(event) {
  ensureHarness();
  return eventStore.appendEvent(harnessPath("events.jsonl"), event, nowIso);
}

function readEvents() {
  return eventStore.readEvents(harnessPath("events.jsonl"));
}

function ensureHarness() {
  ensureDir(harnessPath());
  ensureDir(harnessPath("streams"));
  ensureDir(harnessPath("workers"));
  writeIfMissing(harnessPath("events.jsonl"), "");
  writeIfMissing(harnessPath("repos.json"), "{\n  \"repos\": []\n}\n");
}

function requireHarness() {
  if (!fileExists(harnessPath())) {
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
  return `# Worker PM Brief

Outcome: <DONE|PARTIAL_WITH_EXPLICIT_SCOPE|REJECTED>
Round: not recorded
Progress: not recorded
Confidence: not recorded
Worker:
Stream:
Task:
Phase:

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

Rules:
- The first non-empty line must be # Worker PM Brief.
- The first visible fields after the title must be Outcome, Round, Progress, and Confidence.
- The Ship-Fast Decision Gate concept is folded into What decision is needed.
- Do not use # Worker Report, numbered reviewer logs, command logs, SAW internals, or ClosurePacket lines as the primary report structure.
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

function eventTime(event) { return event.ts || event.time || "unknown time"; }

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

function renderStatus() {
  const events = readEvents();
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

function refreshStatus() {
  const status = renderStatus();
  writeTextAtomic(harnessPath("status.md"), status);
  return status;
}

function commandInit(argv) {
  const { positional, options } = parseArgs(argv);
  const goal = options.goal || positional.join(" ") || "Not set.";

  ensureHarness();
  writeIfMissing(harnessPath("phase-map.md"), phaseMapTemplate());
  writeIfMissing(harnessPath("workers", "worker-report-template.md"), workerReportTemplate());
  for (const stream of STREAMS) {
    writeIfMissing(harnessPath("streams", `${stream}.md`), streamTemplate(stream));
  }

  const events = readEvents();
  if (events.length === 0) {
    appendEvent({
      actor: options.actor || "human",
      stream: "coding",
      phase: "intake",
      action: "initialized harness",
      goal,
      result: "per-repo harness state created",
      evidence: ".meta-harness starter files exist",
      next_action: options.nextAction || "Translate the goal into a bounded worker task.",
      stop_criteria: options.stopCriteria || "Fresh human and Codex worker can resume from local harness state.",
    });
  }

  refreshStatus();
  console.log(`Initialized ${HARNESS_DIR}`);
  console.log(harnessPath("status.md"));
}

function commandStatus(argv) {
  const { options } = parseArgs(argv);
  requireHarness();
  const statusPath = harnessPath("status.md");
  const status = options.refresh || !fileExists(statusPath)
    ? refreshStatus()
    : readText(statusPath);
  process.stdout.write(status.endsWith("\n") ? status : `${status}\n`);
}

function commandEvent(argv) {
  const { options } = parseArgs(argv);
  requireHarness();
  const stream = normalizeStream(options.stream);
  const phase = normalizePhase(options.phase);
  const action = optionValue(options.action);
  const result = optionValue(options.result);
  if (typeof action !== "string" || action.length === 0) {
    fail("event requires --action <text>");
  }
  if (typeof result !== "string" || result.length === 0) {
    fail("event requires --result <text>");
  }

  const event = appendEvent({
    actor: options.actor || "human",
    stream,
    phase,
    action,
    result,
    evidence: options.evidence || options.verification,
    decision: options.decision,
    blocker: options.blocker,
    next_action: options.nextAction,
  });

  refreshStatus();
  console.log(`Recorded event: ${event.stream}/${event.phase}`);
}

function commandWorkerReport(argv) {
  const { positional, options } = parseArgs(argv);
  requireHarness();

  const workerId = slugify(positional[0] || options.worker || `worker-${Date.now()}`);
  const stream = normalizeStream(options.stream);
  const phase = normalizePhase(options.phase || "work");
  const task = options.task || "Unspecified bounded task.";
  const allowedOutcomes = new Set(["DONE", "PARTIAL_WITH_EXPLICIT_SCOPE", "REJECTED"]);
  const outcome = options.outcome;

  if (!allowedOutcomes.has(outcome)) {
    fail("worker report requires --outcome DONE|PARTIAL_WITH_EXPLICIT_SCOPE|REJECTED");
  }

  const requestedWorkType = options.requestedWorkType;
  const actualWorkType = options.actualWorkType;
  const requestedWorkTypes = new Set(REQUESTED_WORK_TYPES);
  const actualWorkTypes = new Set(ACTUAL_WORK_TYPES);
  if (!requestedWorkType || !requestedWorkTypes.has(requestedWorkType)) {
    fail(`worker report requires --requested-work-type ${REQUESTED_WORK_TYPES.join("|")}`);
  }
  if (!actualWorkType || !actualWorkTypes.has(actualWorkType)) {
    fail(`worker report requires --actual-work-type ${ACTUAL_WORK_TYPES.join("|")}`);
  }
  const blocker = options.blocker || "none";
  const executionWorkTypes = new Set(EXECUTION_STYLE_WORK_TYPES);
  if (outcome === "DONE" && actualWorkType === "none") {
    fail("actual work type none requires PARTIAL_WITH_EXPLICIT_SCOPE or REJECTED and --blocker <reason>");
  }
  if (outcome === "DONE" && executionWorkTypes.has(requestedWorkType) && ["docs", "none"].includes(actualWorkType)) {
    fail("silent docs-only fallback is forbidden; use PARTIAL_WITH_EXPLICIT_SCOPE or REJECTED and name the blocker");
  }
  if (["PARTIAL_WITH_EXPLICIT_SCOPE", "REJECTED"].includes(outcome) && !hasExplicitBlocker(blocker)) {
    fail(`${outcome} worker report requires --blocker <reason>`);
  }

  const round = options.round || "not recorded";
  const progress = options.progress || "not recorded";
  const confidence = options.confidence || "not recorded";
  const result = options.result || "No result recorded yet.";
  const validationsPassed = options.validationsPassed || "none";
  const validationsSkipped = options.validationsSkipped || "none";
  const evidenceArtifacts = options.evidenceArtifacts || options.artifacts || "none";
  const proposedNextAction = options.nextAction || "Harness should review this report and choose the next action.";
  const humanSummary = options.humanSummary || result;
  const nextGoal = options.nextGoal || "not recorded";
  const allowedScope = options.allowedScope || "not recorded";
  const forbiddenScope = options.forbiddenScope || "not recorded";
  const decisionNeeded = options.decisionNeeded || "hold";

  const report = `# Worker PM Brief

Outcome: ${outcome}
Round: ${round}
Progress: ${progress}
Confidence: ${confidence}
Worker: ${workerId}
Stream: ${stream}
Task: ${task}
Phase: ${phase}
Updated: ${nowIso()}

## What changed

${result}

## Why it matters

${humanSummary}

## What is blocked

${blocker}

## What decision is needed

Decision needed from user: ${decisionNeeded}
Options considered: ${options.alternatives || "none recorded"}
Scope limit: ${options.scopeLimit || allowedScope}
Stop rule: ${options.stopRule || "Stop if requested and actual work type diverge, or if SAW/ClosurePacket details become the primary report structure."}

## Next action

Recommended next action: ${proposedNextAction}
Goal: ${nextGoal}
Allowed scope: ${allowedScope}
Forbidden scope: ${forbiddenScope}

## Validation / evidence

Passed:
${validationsPassed}

Skipped:
${validationsSkipped}

Evidence artifacts:
${evidenceArtifacts}

## Accountability

requested_work_type: ${requestedWorkType}
actual_work_type_performed: ${actualWorkType}
credentials_touched: ${options.credentialsTouched || "false"}
provider_access_touched: ${options.providerAccessTouched || "false"}
data_output_created: ${options.dataOutputCreated || "false"}
commit_created: ${options.commitCreated || "false"}
remaining_blocker: ${blocker}
`;

  const reportPath = harnessPath("workers", `${workerId}.md`);
  fs.writeFileSync(reportPath, report, "utf8");

  appendEvent({
    actor: workerId,
    stream,
    phase,
    action: `worker report: ${task}`,
    result,
    evidence: evidenceArtifacts,
    blocker: blocker === "none" ? undefined : blocker,
    next_action: proposedNextAction,
  });
  refreshStatus();

  console.log(`Wrote worker report: ${reportPath}`);
}

function commandTemplates(argv) {
  const { positional, options } = parseArgs(argv);
  const action = positional[0] || "list";

  if (action === "list") {
    const files = templateFiles();
    if (files.length === 0) {
      console.log("No packaged templates found.");
      return;
    }
    for (const template of files) {
      console.log(`${template.category}\t${template.filename}`);
    }
    return;
  }

  if (action === "install") {
    if (!options.allowDirty) {
      try {
        const statusOut = execSync("git status --porcelain", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
        if (statusOut.trim().length > 0) {
          fail("Repository is dirty. Please commit or stash changes, or run with --allow-dirty.");
        }
      } catch (e) {
        // Skip check if not a git repo or git not in path
      }
    }
    ensureHarness();
    const destinationRoot = harnessPath("templates");
    const overwrite = Boolean(options.overwrite);
    const copied = copyPackagedTemplates(destinationRoot, overwrite);
    refreshStatus();
    console.log(`Installed templates into ${destinationRoot}`);
    for (const item of copied) {
      console.log(`- ${item}`);
    }
    if (copied.length === 0) {
      console.log("- none; existing templates kept");
    }
    return;
  }

  fail(`unknown templates action: ${action}`);
}

function requireTargetRoot(options) {
  const value = options.target;
  if (Array.isArray(value)) {
    fail("--target must be provided once");
  }
  if (value === undefined || value === null || value === true || String(value).trim() === "") {
    fail("--target requires an existing directory");
  }
  const targetRoot = path.resolve(process.cwd(), String(value));
  let stat;
  try {
    stat = fs.lstatSync(targetRoot);
  } catch (error) {
    if (error && error.code === "ENOENT") {
      fail(`--target must be an existing directory: ${value}`);
    }
    throw error;
  }
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    fail(`--target must be an existing directory: ${value}`);
  }
  return targetRoot;
}

function statusCount(items, status) {
  return items.filter((item) => item.status === status).length;
}

function renderCheckSummary(label, result) {
  const fields = [`checked=${result.checked ?? result.items.length}`];
  for (const status of ["MISSING", "DRIFT", "REJECTED", "MALFORMED", "UNREADABLE", "MIGRATION_NEEDED"]) {
    const count = statusCount(result.items, status);
    if (count > 0) {
      fields.push(`${status.toLowerCase()}=${count}`);
    }
  }
  return `${label}: ${result.status} ${fields.join(" ")}`;
}

function printCheckResult(label, result) {
  console.log(renderCheckSummary(label, result));
  for (const item of result.items.filter((entry) => entry.status !== "PASS")) {
    const columns = [item.status, item.path];
    if (item.detail) {
      columns.push(item.detail);
    }
    console.log(columns.join("\t"));
  }
  if (result.status !== "PASS") {
    process.exitCode = 1;
  }
}

function commandReadOnlyCheck(argv, config) {
  const { positional, options } = parseArgs(argv);
  if (positional.length !== 1 || positional[0] !== config.action) {
    fail(`unknown ${config.command} action: ${positional[0] || "missing"}`);
  }
  const sourceRoot = path.resolve(__dirname, "..");
  const targetRoot = requireTargetRoot(options);
  printCheckResult(config.label, config.check({ sourceRoot, targetRoot }));
}

function commandSync(argv) {
  return commandReadOnlyCheck(argv, {
    action: "check",
    command: "sync",
    label: "SYNC CHECK",
    check: checkTemplateSync,
  });
}

function commandTrust(argv) {
  return commandReadOnlyCheck(argv, {
    action: "check",
    command: "trust",
    label: "TRUST CHECK",
    check: checkTrustPolicy,
  });
}

function commandContract(argv) {
  return commandReadOnlyCheck(argv, {
    action: "scan",
    command: "contract",
    label: "CONTRACT SCAN",
    check: scanContracts,
  });
}

function commandState(argv) {
  return commandReadOnlyCheck(argv, {
    action: "check",
    command: "state",
    label: "STATE CHECK",
    check: checkStateLayout,
  });
}

function commandBriefScan(argv) {
  const { positional, options } = parseArgs(argv);
  if (positional.length > 0) {
    fail(`unknown brief scan argument: ${positional[0]}`);
  }
  const targetRoot = requireTargetRoot(options);
  printCheckResult("BRIEF SCAN", scanPmBrief({ targetRoot }));
}

function commandDecisionInboxScan(argv) {
  const { positional, options } = parseArgs(argv);
  if (positional.length > 0) {
    fail(`unknown decisions scan argument: ${positional[0]}`);
  }
  const targetRoot = requireTargetRoot(options);
  printCheckResult("DECISION INBOX SCAN", scanDecisionInbox({ targetRoot }));
}


function commandExpertPacket(argv) {
  const { positional, options } = parseArgs(argv);
  requireHarness();
  const result = buildExpertPacket({
    cwd: process.cwd(),
    roundId: positional[0] || options.round,
    options,
  });

  if (result.dryRun) {
    console.log(`Would build expert packet zip: ${result.packetZip}`);
    console.log("Planned git pathspecs:");
    for (const item of result.gitPathspecs) {
      console.log(`- ${item}`);
    }
    return;
  }

  appendEvent({
    actor: optionValue(options.actor, "meta-harness"),
    stream: "review",
    phase: "plan",
    action: `built expert packet ${positional[0] || options.round}`,
    result: `expert packet zip written to ${result.relativePacketZip}`,
    evidence: result.relativePacketZip,
    next_action: "Send the packet to the bounded expert reviewer or reconcile existing reviewer input.",
  });
  refreshStatus();

  console.log(`Built expert packet zip: ${result.packetZip}`);
  console.log("Included zip entries:");
  for (const item of result.packetFiles) {
    console.log(`- ${item}`);
  }
}

function renderLookback() {
  const events = readEvents();
  const initEvent = events.find((event) => event.action === "initialized harness") || events[0] || {};
  const lines = [
    "# Lookback",
    "",
    `Generated: ${nowIso()}`,
    "",
    "## Original Goal",
    "",
    initEvent.goal || "Not set.",
    "",
    "## Timeline",
    "",
  ];

  if (events.length === 0) {
    lines.push("- no events recorded");
  } else {
    for (const event of events) {
      lines.push(
        `- ${eventTime(event)} | ${event.stream || "unknown"} | ${event.phase || "unknown"} | ${event.action || "no action"} -> ${event.result || "no result"}`
      );
    }
  }

  const decisions = events.filter((event) => event.decision);
  lines.push("", "## Decisions", "", listOrNone(decisions.map((event) => `${eventTime(event)}: ${event.decision}`)));

  const blockers = events.filter((event) => event.blocker);
  lines.push("", "## Blockers", "", listOrNone(blockers.map((event) => `${event.stream}: ${event.blocker}`)));

  lines.push("", "## Current Next Action", "", fieldFromLatest(events, "next_action", "Plan the next bounded worker task."));

  return `${lines.join("\n")}\n`;
}

function commandLookback(argv) {
  const { options } = parseArgs(argv);
  requireHarness();
  const lookback = renderLookback();
  if (options.write) {
    fs.writeFileSync(harnessPath("lookback.md"), lookback, "utf8");
  }
  process.stdout.write(lookback);
}

function readRepoIndex() {
  ensureHarness();
  const index = readJson(harnessPath("repos.json"), { repos: [] });
  if (!Array.isArray(index.repos)) {
    throw new ConfigError("repos.json must contain a repos array");
  }
  return index;
}

function writeRepoIndex(index) {
  writeJson(harnessPath("repos.json"), index);
}

function commandRepos(argv) {
  const { positional, options } = parseArgs(argv);
  const action = positional[0] || "list";
  const index = readRepoIndex();

  if (action === "list") {
    if (index.repos.length === 0) {
      console.log("No child repos registered.");
      return;
    }
    for (const repo of index.repos) {
      console.log(`${repo.name}\t${repo.path}\t${repo.role || "child"}`);
    }
    return;
  }

  if (action === "add") {
    const name = positional[1];
    const repoPath = positional[2];
    if (!name || !repoPath) {
      fail("repos add requires <name> <path>");
    }
    const next = index.repos.filter((repo) => repo.name !== name);
    next.push({ name, path: repoPath, role: options.role || "child" });
    writeRepoIndex({ repos: next });
    console.log(`Added repo: ${name}`);
    return;
  }

  if (action === "remove") {
    const name = positional[1];
    if (!name) {
      fail("repos remove requires <name>");
    }
    writeRepoIndex({ repos: index.repos.filter((repo) => repo.name !== name) });
    console.log(`Removed repo: ${name}`);
    return;
  }

  fail(`unknown repos action: ${action}`);
}

function firstStatusLines(status) {
  const lines = status.split(/\r?\n/).filter((line) => line.trim().length > 0);
  return lines.slice(0, 12).join("\n");
}

function renderPoll() {
  requireHarness();
  const index = readRepoIndex();
  const sections = ["# Poll Summary", "", `Updated: ${nowIso()}`, "", "## Local", ""];
  const localStatusPath = harnessPath("status.md");
  sections.push(fileExists(localStatusPath) ? firstStatusLines(readText(localStatusPath)) : "No local status found.");

  sections.push("", "## Child Repos", "");
  if (index.repos.length === 0) {
    sections.push("- none");
  } else {
    for (const repo of index.repos) {
      const childStatusPath = path.resolve(process.cwd(), repo.path, HARNESS_DIR, "status.md");
      if (!fileExists(childStatusPath)) {
        sections.push(`### ${repo.name}`, "", `Missing status: ${childStatusPath}`, "");
      } else {
        sections.push(`### ${repo.name}`, "", firstStatusLines(readText(childStatusPath)), "");
      }
    }
  }

  return `${sections.join("\n")}\n`;
}

function commandPoll(argv) {
  const { options } = parseArgs(argv);
  const poll = renderPoll();
  if (options.write) {
    fs.writeFileSync(harnessPath("poll.md"), poll, "utf8");
  }
  process.stdout.write(poll);
}

function main(argv) {
  const [command, ...rest] = argv;

  if (!command || command === "help" || command === "--help" || command === "-h") {
    process.stdout.write(usage());
    return;
  }

  if (command === "init") return commandInit(rest);
  if (command === "status") return commandStatus(rest);
  if (command === "event") return commandEvent(rest);
  if (command === "worker-report") return commandWorkerReport(rest);
  if (command === "templates") return commandTemplates(rest);
  if (command === "sync") return commandSync(rest);
  if (command === "trust") return commandTrust(rest);
  if (command === "contract") return commandContract(rest);
  if (command === "state") return commandState(rest);
  if (command === "dirty") return commandDirty(rest, { cwd: process.cwd() });
  if (command === "gate") return commandGate(rest, { cwd: process.cwd() });
  if (command === "decisions" && rest[0] === "scan") return commandDecisionInboxScan(rest.slice(1));
  if (command === "decisions") return commandDecisions(rest, { cwd: process.cwd() });
  if (command === "distill") return commandDistill(rest, { cwd: process.cwd() });
  if (command === "brief" && rest[0] === "scan") return commandBriefScan(rest.slice(1));
  if (command === "brief") return commandBrief(rest, { cwd: process.cwd() });
  if (command === "ready") {
    const commandReady = require("../lib/commands/ready");
    commandReady(rest).catch(handleCliError);
    return;
  }
  if (command === "expert-packet") return commandExpertPacket(rest);
  if (command === "quality") return commandQuality(rest, {
    cwd: process.cwd(),
    harnessDir: HARNESS_DIR,
    fail: (message) => { throw new QualityGateError(message); },
    relativePath,
  });
  if (command === "lookback") return commandLookback(rest);
  if (command === "poll") return commandPoll(rest);
  if (command === "repos") return commandRepos(rest);

  fail(`unknown command: ${command}`);
}

try { main(process.argv.slice(2)); } catch (error) { handleCliError(error); }
