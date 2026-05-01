#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const HARNESS_DIR = ".meta-harness";
const STREAMS = ["coding", "research", "writing", "review"];
const PHASES = ["intake", "plan", "work", "verify", "synthesize", "handoff", "lookback"];

function usage() {
  return `meta-harness

Markdown-first Codex-native workflow visibility harness.

Usage:
  meta-harness init [goal] [--owner <name>]
  meta-harness status [--refresh]
  meta-harness event --stream <stream> --phase <phase> --action <text> --result <text>
  meta-harness worker-report [worker-id] --stream <stream> --task <text> [--result <text>]
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
      options[key] = true;
    } else {
      options[key] = next;
      index += 1;
    }
  }

  return { positional, options };
}

function fail(message, code = 1) {
  console.error(`meta-harness: ${message}`);
  process.exit(code);
}

function nowIso() {
  return new Date().toISOString();
}

function harnessPath(...parts) {
  return path.join(process.cwd(), HARNESS_DIR, ...parts);
}

function ensureDir(targetPath) {
  fs.mkdirSync(targetPath, { recursive: true });
}

function fileExists(targetPath) {
  return fs.existsSync(targetPath);
}

function readText(targetPath, fallback = "") {
  if (!fileExists(targetPath)) {
    return fallback;
  }
  return fs.readFileSync(targetPath, "utf8");
}

function writeIfMissing(targetPath, content) {
  if (!fileExists(targetPath)) {
    fs.writeFileSync(targetPath, content, "utf8");
  }
}

function readJson(targetPath, fallback) {
  if (!fileExists(targetPath)) {
    return fallback;
  }
  try {
    return JSON.parse(readText(targetPath));
  } catch (error) {
    fail(`invalid JSON in ${targetPath}: ${error.message}`);
  }
}

function writeJson(targetPath, value) {
  fs.writeFileSync(targetPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function appendEvent(event) {
  ensureHarness();
  const payload = Object.fromEntries(
    Object.entries({
      time: nowIso(),
      ...event,
    }).filter(([, value]) => value !== undefined && value !== null && value !== "")
  );
  fs.appendFileSync(harnessPath("events.jsonl"), `${JSON.stringify(payload)}\n`, "utf8");
  return payload;
}

function readEvents() {
  const eventsPath = harnessPath("events.jsonl");
  if (!fileExists(eventsPath)) {
    return [];
  }

  return readText(eventsPath)
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        fail(`invalid JSON in ${eventsPath} line ${index + 1}: ${error.message}`);
      }
    });
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
  return `# Worker Report

Worker:
Stream:
Task:
Phase:

## Result

## Changed Artifacts

## Evidence

## Blockers

## Proposed Next Action

## Human Summary

## Codex Continuation Note
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
    .map((event) => `${event.decision} (${event.time || "unknown time"})`);
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
  fs.writeFileSync(harnessPath("status.md"), status, "utf8");
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
  if (!options.action) {
    fail("event requires --action <text>");
  }
  if (!options.result) {
    fail("event requires --result <text>");
  }

  const event = appendEvent({
    actor: options.actor || "human",
    stream,
    phase,
    action: options.action,
    result: options.result,
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
  const result = options.result || "No result recorded yet.";
  const evidence = options.evidence || "No evidence recorded yet.";
  const blocker = options.blocker || "none";
  const proposedNextAction = options.nextAction || "Harness should review this report and choose the next action.";
  const humanSummary = options.humanSummary || result;
  const codexNote = options.codexNote || proposedNextAction;

  const report = `# Worker Report

Worker: ${workerId}
Stream: ${stream}
Task: ${task}
Phase: ${phase}
Updated: ${nowIso()}

## Result

${result}

## Changed Artifacts

${options.artifacts || "none"}

## Evidence

${evidence}

## Blockers

${blocker}

## Proposed Next Action

${proposedNextAction}

## Human Summary

${humanSummary}

## Codex Continuation Note

${codexNote}
`;

  const reportPath = harnessPath("workers", `${workerId}.md`);
  fs.writeFileSync(reportPath, report, "utf8");

  appendEvent({
    actor: workerId,
    stream,
    phase,
    action: `worker report: ${task}`,
    result,
    evidence,
    blocker: blocker === "none" ? undefined : blocker,
    next_action: proposedNextAction,
  });
  refreshStatus();

  console.log(`Wrote worker report: ${reportPath}`);
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
        `- ${event.time || "unknown time"} | ${event.stream || "unknown"} | ${event.phase || "unknown"} | ${event.action || "no action"} -> ${event.result || "no result"}`
      );
    }
  }

  const decisions = events.filter((event) => event.decision);
  lines.push("", "## Decisions", "", listOrNone(decisions.map((event) => `${event.time}: ${event.decision}`)));

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
    fail("repos.json must contain a repos array");
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
  if (command === "lookback") return commandLookback(rest);
  if (command === "poll") return commandPoll(rest);
  if (command === "repos") return commandRepos(rest);

  fail(`unknown command: ${command}`);
}

main(process.argv.slice(2));
