#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { commandQuality } = require("../lib/quality");

const HARNESS_DIR = ".meta-harness";
const TEMPLATE_ROOT = path.resolve(__dirname, "..", "templates");
const STREAMS = ["coding", "research", "writing", "review"];
const PHASES = ["intake", "plan", "work", "verify", "synthesize", "handoff", "lookback"];
const EXPERT_PACKET_FILES = [
  "README_DECISION_CARD.md",
  "candidate_scope_memo.md",
  "low_confidence_and_boundaries.md",
];
const DEFAULT_EXPERT_PACKET_GIT_PATHS = [
  "README.md",
  "docs/product/prd.md",
  "docs/product/product-spec.md",
  "docs/product/decision-log.md",
  ".meta-harness/status.md",
  ".meta-harness/events.jsonl",
  "templates",
];
const FORBIDDEN_PACKET_PARTS = new Set([
  ".git",
  ".mypy_cache",
  ".pytest_cache",
  ".ruff_cache",
  ".venv",
  "__pycache__",
  "node_modules",
  "runtime",
]);
const MAX_PACKET_FILE_BYTES = 2_000_000;
const GIT_OUTPUT_LINE_CAP = 200;
const GIT_OUTPUT_BYTE_CAP = 50_000;
const GIT_TIMEOUT_MS = 20_000;
const CRC32_TABLE = buildCrc32Table();

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
  meta-harness expert-packet <round-id> [--include <path>] [--overwrite]
  meta-harness quality init
  meta-harness quality baseline
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

function fail(message, code = 1) {
  console.error(`meta-harness: ${message}`);
  process.exit(code);
}

function nowIso() {
  return new Date().toISOString();
}

function buildCrc32Table() {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
    }
    table[index] = value >>> 0;
  }
  return table;
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = CRC32_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(date) {
  const year = Math.max(1980, date.getFullYear());
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const hours = date.getHours();
  const minutes = date.getMinutes();
  const seconds = Math.floor(date.getSeconds() / 2);
  return {
    time: ((hours << 11) | (minutes << 5) | seconds) & 0xffff,
    date: (((year - 1980) << 9) | (month << 5) | day) & 0xffff,
  };
}

function collectZipFiles(sourceDir, currentDir = sourceDir, collected = []) {
  const entries = fs.readdirSync(currentDir, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    const fullPath = path.join(currentDir, entry.name);
    if (entry.isDirectory()) {
      collectZipFiles(sourceDir, fullPath, collected);
      continue;
    }
    if (!entry.isFile()) {
      continue;
    }
    collected.push({
      fullPath,
      name: path.relative(sourceDir, fullPath).split(path.sep).join("/"),
      stat: fs.statSync(fullPath),
    });
  }
  return collected;
}

function writeZipArchive(sourceDir, destinationPath) {
  const files = collectZipFiles(sourceDir);
  const localChunks = [];
  const centralChunks = [];
  let offset = 0;

  for (const file of files) {
    const data = fs.readFileSync(file.fullPath);
    const name = Buffer.from(file.name, "utf8");
    const checksum = crc32(data);
    const { time, date } = dosDateTime(file.stat.mtime);
    const localOffset = offset;
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0, 6);
    localHeader.writeUInt16LE(0, 8);
    localHeader.writeUInt16LE(time, 10);
    localHeader.writeUInt16LE(date, 12);
    localHeader.writeUInt32LE(checksum, 14);
    localHeader.writeUInt32LE(data.length, 18);
    localHeader.writeUInt32LE(data.length, 22);
    localHeader.writeUInt16LE(name.length, 26);
    localHeader.writeUInt16LE(0, 28);
    localChunks.push(localHeader, name, data);
    offset += localHeader.length + name.length + data.length;

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0, 8);
    centralHeader.writeUInt16LE(0, 10);
    centralHeader.writeUInt16LE(time, 12);
    centralHeader.writeUInt16LE(date, 14);
    centralHeader.writeUInt32LE(checksum, 16);
    centralHeader.writeUInt32LE(data.length, 20);
    centralHeader.writeUInt32LE(data.length, 24);
    centralHeader.writeUInt16LE(name.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(localOffset, 42);
    centralChunks.push(centralHeader, name);
  }

  const centralSize = centralChunks.reduce((total, chunk) => total + chunk.length, 0);
  const endRecord = Buffer.alloc(22);
  endRecord.writeUInt32LE(0x06054b50, 0);
  endRecord.writeUInt16LE(0, 4);
  endRecord.writeUInt16LE(0, 6);
  endRecord.writeUInt16LE(files.length, 8);
  endRecord.writeUInt16LE(files.length, 10);
  endRecord.writeUInt32LE(centralSize, 12);
  endRecord.writeUInt32LE(offset, 16);
  endRecord.writeUInt16LE(0, 20);

  ensureDir(path.dirname(destinationPath));
  fs.writeFileSync(destinationPath, Buffer.concat([...localChunks, ...centralChunks, endRecord]));
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

function relativePath(targetPath, root = process.cwd()) {
  return path.relative(root, targetPath).split(path.sep).join("/");
}

function isInside(targetPath, rootPath) {
  const relative = path.relative(rootPath, targetPath);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function resolveInsideCwd(rawPath, label) {
  const resolved = path.resolve(process.cwd(), rawPath);
  if (!isInside(resolved, process.cwd())) {
    fail(`${label} must stay inside the current repository: ${rawPath}`);
  }
  return resolved;
}

function packetPathHasForbiddenPart(targetPath) {
  const relative = path.relative(process.cwd(), targetPath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    return true;
  }
  const lowered = relative.split(path.sep).map((part) => part.toLowerCase());
  return lowered.some((part) => FORBIDDEN_PACKET_PARTS.has(part));
}

function ensureSafePacketPath(targetPath, label) {
  if (!isInside(targetPath, process.cwd())) {
    fail(`${label} must stay inside the current repository: ${targetPath}`);
  }
  if (packetPathHasForbiddenPart(targetPath)) {
    fail(`refusing forbidden ${label}: ${relativePath(targetPath)}`);
  }
}

function copyFileChecked(sourcePath, destinationPath) {
  const resolved = resolveInsideCwd(sourcePath, "packet source");
  ensureSafePacketPath(resolved, "packet source");
  const stats = fs.statSync(resolved);
  if (!stats.isFile()) {
    fail(`packet source is not a file: ${relativePath(resolved)}`);
  }
  if (stats.size > MAX_PACKET_FILE_BYTES) {
    fail(`packet source exceeds ${MAX_PACKET_FILE_BYTES} bytes: ${relativePath(resolved)}`);
  }
  ensureDir(path.dirname(destinationPath));
  fs.copyFileSync(resolved, destinationPath);
}

function copyDirectoryChecked(sourceDir, destinationDir, skipped = []) {
  const entries = fs.readdirSync(sourceDir, { withFileTypes: true });
  for (const entry of entries) {
    const source = path.join(sourceDir, entry.name);
    if (packetPathHasForbiddenPart(source)) {
      skipped.push(relativePath(source));
      continue;
    }
    const destination = path.join(destinationDir, entry.name);
    if (entry.isDirectory()) {
      copyDirectoryChecked(source, destination, skipped);
    } else if (entry.isFile()) {
      const stats = fs.statSync(source);
      if (stats.size > MAX_PACKET_FILE_BYTES) {
        skipped.push(relativePath(source));
        continue;
      }
      ensureDir(path.dirname(destination));
      fs.copyFileSync(source, destination);
    }
  }
  return skipped;
}

function safeRoundId(roundId) {
  const value = String(roundId || "").trim();
  if (!value) {
    fail("expert-packet requires a non-empty round id");
  }
  if (!/^[A-Za-z0-9._-]+$/.test(value) || value === "." || value === "..") {
    fail("round id may contain only letters, numbers, dot, underscore, and hyphen");
  }
  return value;
}

function writePacketStub(destinationPath, title, roundId, body) {
  fs.writeFileSync(
    destinationPath,
    `# ${title}\n\nRoundID: ${roundId}\n\n${body.trim()}\n`,
    "utf8"
  );
}

function limitCommandOutput(text) {
  const normalized = String(text || "").replace(/\r\n/g, "\n");
  const lines = normalized.split(/\n/);
  if (Buffer.byteLength(normalized, "utf8") <= GIT_OUTPUT_BYTE_CAP && lines.length <= GIT_OUTPUT_LINE_CAP) {
    return normalized;
  }
  return `${lines.slice(0, GIT_OUTPUT_LINE_CAP).join("\n")}\n... truncated after ${GIT_OUTPUT_LINE_CAP} lines or ${GIT_OUTPUT_BYTE_CAP} bytes ...\n`;
}

function runGitCapture(args, pathspecs = []) {
  const command = [...args];
  if (pathspecs.length > 0) {
    command.push("--", ...pathspecs);
  }
  const result = spawnSync("git", command, {
    cwd: process.cwd(),
    encoding: "utf8",
    shell: false,
    timeout: GIT_TIMEOUT_MS,
  });
  if (result.error || result.status !== 0) {
    return `git ${command.join(" ")} unavailable: ${(result.stderr || result.error?.message || "not a git repository").trim()}\n`;
  }
  return limitCommandOutput(result.stdout);
}

function existingGitPathspecs(extraPaths = []) {
  const seen = new Set();
  const pathspecs = [];
  for (const rawPath of [...DEFAULT_EXPERT_PACKET_GIT_PATHS, ...extraPaths]) {
    const resolved = resolveInsideCwd(rawPath, "git capture path");
    if (!fs.existsSync(resolved)) {
      continue;
    }
    ensureSafePacketPath(resolved, "git capture path");
    const relative = relativePath(resolved);
    if (!seen.has(relative)) {
      seen.add(relative);
      pathspecs.push(relative);
    }
  }
  return pathspecs;
}

function templateFiles() {
  const files = [];
  for (const category of ["skills", "contracts"]) {
    const categoryDir = path.join(TEMPLATE_ROOT, category);
    if (!fileExists(categoryDir)) {
      continue;
    }
    for (const filename of fs.readdirSync(categoryDir).sort()) {
      const source = path.join(categoryDir, filename);
      if (fs.statSync(source).isFile()) {
        files.push({ category, filename, source });
      }
    }
  }
  return files;
}

function copyPackagedTemplates(destinationRoot, overwrite = true) {
  const copied = [];
  for (const template of templateFiles()) {
    const relative = path.join(template.category, template.filename);
    const destination = path.join(destinationRoot, relative);
    if (fileExists(destination) && !overwrite) {
      continue;
    }
    ensureDir(path.dirname(destination));
    fs.copyFileSync(template.source, destination);
    copied.push(relativePath(destination, destinationRoot));
  }
  return copied;
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
  return `Outcome: <DONE|PARTIAL_WITH_EXPLICIT_SCOPE|REJECTED>
Round:
Progress: <before>/100 -> <after>/100
Confidence: <0-10>/10
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

## Evidence

Passed:

Skipped:

Evidence artifacts:

## Accountability

requested_work_type: <docs|code|test|provider_probe|commit|validation|execution|data_output>
actual_work_type_performed: <docs|code|test|provider_probe|commit|validation|execution|data_output|none>
credentials_touched: false
provider_access_touched: false
data_output_created: false
commit_created: false
remaining_blocker:

Rules:
- The first non-empty line must be Outcome, followed by Round, Progress, and Confidence.
- The Ship-Fast Decision Gate concept is folded into What decision is needed.
- Do not add any title before Outcome, and do not use # Worker Report, numbered reviewer logs, command logs, SAW internals, or ClosurePacket lines as the primary report structure.
- SAW Verdict and ClosurePacket details belong only under Evidence.
- Silent docs-only fallback from code, test, provider_probe, commit, validation, execution, or data_output work is forbidden.
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
  const allowedOutcomes = new Set(["DONE", "PARTIAL_WITH_EXPLICIT_SCOPE", "REJECTED"]);
  const outcome = options.outcome;

  if (!allowedOutcomes.has(outcome)) {
    fail("worker report requires --outcome DONE|PARTIAL_WITH_EXPLICIT_SCOPE|REJECTED");
  }

  const requestedWorkType = options.requestedWorkType;
  const actualWorkType = options.actualWorkType;
  const requestedWorkTypes = new Set([
    "docs",
    "code",
    "test",
    "provider_probe",
    "commit",
    "validation",
    "execution",
    "data_output",
  ]);
  const actualWorkTypes = new Set([...requestedWorkTypes, "none"]);
  if (!requestedWorkType || !requestedWorkTypes.has(requestedWorkType)) {
    fail("worker report requires --requested-work-type docs|code|test|provider_probe|commit|validation|execution|data_output");
  }
  if (!actualWorkType || !actualWorkTypes.has(actualWorkType)) {
    fail("worker report requires --actual-work-type docs|code|test|provider_probe|commit|validation|execution|data_output|none");
  }
  const executionWorkTypes = new Set(["code", "test", "provider_probe", "commit", "validation", "execution", "data_output"]);
  if (outcome === "DONE" && executionWorkTypes.has(requestedWorkType) && ["docs", "none"].includes(actualWorkType)) {
    fail("silent docs-only fallback is forbidden; use PARTIAL_WITH_EXPLICIT_SCOPE or REJECTED and name the blocker");
  }

  const round = options.round || task;
  const progress = options.progress || "not recorded";
  const confidence = options.confidence || "not recorded";
  const result = options.result || "No result recorded yet.";
  const validationsPassed = options.validationsPassed || "none";
  const validationsSkipped = options.validationsSkipped || "none";
  const evidenceArtifacts = options.evidenceArtifacts || options.artifacts || "none";
  const blocker = options.blocker || "none";
  const proposedNextAction = options.nextAction || "Harness should review this report and choose the next action.";
  const humanSummary = options.humanSummary || result;
  const nextGoal = options.nextGoal || "not recorded";
  const allowedScope = options.allowedScope || "not recorded";
  const forbiddenScope = options.forbiddenScope || "not recorded";
  const decisionNeeded = options.decisionNeeded || "hold";

  const report = `Outcome: ${outcome}
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

## Evidence

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

function copyOptionalMemo(source, destination, roundId, title, body) {
  if (source) {
    copyFileChecked(source, destination);
    return;
  }
  writePacketStub(destination, title, roundId, body);
}

function copyHarnessTruth(packetDir) {
  const copied = [];
  const harnessRoot = harnessPath();
  if (!fileExists(harnessRoot)) {
    return copied;
  }

  const rootFiles = ["status.md", "events.jsonl", "phase-map.md", "repos.json", "poll.md", "lookback.md"];
  for (const filename of rootFiles) {
    const source = path.join(harnessRoot, filename);
    if (fileExists(source) && fs.statSync(source).isFile()) {
      const destination = path.join(packetDir, HARNESS_DIR, filename);
      ensureDir(path.dirname(destination));
      fs.copyFileSync(source, destination);
      copied.push(`${HARNESS_DIR}/${filename}`);
    }
  }

  for (const dirname of ["streams", "workers", "templates"]) {
    const source = path.join(harnessRoot, dirname);
    if (fileExists(source) && fs.statSync(source).isDirectory()) {
      const destination = path.join(packetDir, HARNESS_DIR, dirname);
      copyDirectoryChecked(source, destination);
      copied.push(`${HARNESS_DIR}/${dirname}/`);
    }
  }
  return copied;
}

function copyIncludedPaths(packetDir, includePaths, outputRoot) {
  const copied = [];
  const skipped = [];
  for (const rawPath of includePaths) {
    const source = resolveInsideCwd(rawPath, "include path");
    ensureSafePacketPath(source, "include path");
    if (isInside(source, outputRoot) || isInside(outputRoot, source)) {
      fail(`include path must not overlap packet output root: ${relativePath(source)}`);
    }
    const relative = relativePath(source);
    const destination = path.join(packetDir, "included", relative);
    if (fs.statSync(source).isDirectory()) {
      copyDirectoryChecked(source, destination, skipped);
      copied.push(`included/${relative}/`);
    } else {
      copyFileChecked(relative, destination);
      copied.push(`included/${relative}`);
    }
  }
  return { copied, skipped };
}

function writeExpertPacketManifest(packetDir, roundId, included, skipped, gitPathspecs) {
  const lines = [
    "# Expert Packet Manifest",
    "",
    `RoundID: ${roundId}`,
    "Builder: meta-harness expert-packet",
    "Deliverable: single zip archive only; do not publish sidecar diffs, next-scope notes, or loose packet files beside the zip.",
    "",
    "Included root files:",
    ...EXPERT_PACKET_FILES.map((filename) => `- ${filename}`),
    "- PACKET_MANIFEST.md",
    "- git_status.txt",
    "- git_diff_name_status.txt",
    "- git_log_oneline_20.txt",
    "",
    "Included packet paths:",
    ...(included.length > 0 ? included.map((item) => `- ${item}`) : ["- none"]),
    "",
    "Git capture pathspecs:",
    ...(gitPathspecs.length > 0 ? gitPathspecs.map((item) => `- ${item}`) : ["- none"]),
    "",
    "Skipped paths:",
    ...(skipped.length > 0 ? skipped.map((item) => `- ${item}`) : ["- none"]),
    "",
    "Excluded by design:",
    "- .git/",
    "- node_modules/",
    "- .venv/",
    "- runtime/",
    "- Python and test caches",
    "- files larger than the packet size cap",
  ];
  fs.writeFileSync(path.join(packetDir, "PACKET_MANIFEST.md"), `${lines.join("\n")}\n`, "utf8");
}

function commandExpertPacket(argv) {
  const { positional, options } = parseArgs(argv);
  requireHarness();
  const roundId = safeRoundId(positional[0] || options.round);
  const outputRoot = resolveInsideCwd(optionValue(options.outputRoot, path.join(HARNESS_DIR, "expert-packets")), "output root");
  if (!isInside(outputRoot, process.cwd()) || packetPathHasForbiddenPart(outputRoot)) {
    fail(`refusing packet output root: ${relativePath(outputRoot)}`);
  }

  const packetDir = path.join(outputRoot, `.${roundId}.packet-staging`);
  const packetZip = path.join(outputRoot, `${roundId}.zip`);
  const overwrite = Boolean(options.overwrite);
  const dryRun = Boolean(options.dryRun);
  const includePaths = optionValues(options.include);
  const gitPathspecs = existingGitPathspecs([...includePaths, ...optionValues(options.gitPath)]);

  if (dryRun) {
    console.log(`Would build expert packet zip: ${packetZip}`);
    console.log("Planned git pathspecs:");
    for (const item of gitPathspecs) {
      console.log(`- ${item}`);
    }
    return;
  }

  if (fileExists(packetZip) || fileExists(packetDir)) {
    if (!overwrite) {
      fail(`expert packet already exists: ${packetZip}`);
    }
    if (!isInside(packetDir, outputRoot)) {
      fail(`refusing to overwrite packet outside output root: ${packetDir}`);
    }
    if (!isInside(packetZip, outputRoot)) {
      fail(`refusing to overwrite packet outside output root: ${packetZip}`);
    }
    if (fileExists(packetZip)) {
      fs.rmSync(packetZip, { force: true });
    }
    fs.rmSync(packetDir, { recursive: true, force: true });
  }
  ensureDir(outputRoot);
  ensureDir(packetDir);

  copyOptionalMemo(
    optionValue(options.decisionCard),
    path.join(packetDir, "README_DECISION_CARD.md"),
    roundId,
    "Expert Decision Card",
    "Question: fill in the exact decision or review question.\n\nScope: fill in allowed actions, non-goals, and owned files.\n\nExpected Output: verdict, risks, and next action."
  );
  copyOptionalMemo(
    optionValue(options.candidateScopeMemo) || optionValue(options.scopeMemo),
    path.join(packetDir, "candidate_scope_memo.md"),
    roundId,
    "Candidate Scope Memo",
    "Chosen scope, rejected alternatives, stop rules, file budget, and demo target should be filled by the orchestrator."
  );
  copyOptionalMemo(
    optionValue(options.lowConfidenceAndBoundaries) || optionValue(options.boundaries),
    path.join(packetDir, "low_confidence_and_boundaries.md"),
    roundId,
    "Low Confidence And Boundaries",
    "Record low-confidence items, approval gates, blocked actions, and out-of-boundary work before review."
  );

  const included = [];
  included.push(...copyHarnessTruth(packetDir));
  included.push(...copyPackagedTemplates(path.join(packetDir, "harness_templates"), true).map((item) => `harness_templates/${item}`));
  const includeResult = copyIncludedPaths(packetDir, includePaths, outputRoot);
  included.push(...includeResult.copied);

  fs.writeFileSync(path.join(packetDir, "git_status.txt"), runGitCapture(["status", "--short"], gitPathspecs), "utf8");
  fs.writeFileSync(path.join(packetDir, "git_diff_name_status.txt"), runGitCapture(["diff", "--name-status"], gitPathspecs), "utf8");
  fs.writeFileSync(
    path.join(packetDir, "git_log_oneline_20.txt"),
    `# git log is limited to declared expert-packet paths.\n\n${runGitCapture(["log", "--oneline", "-20"], gitPathspecs)}`,
    "utf8"
  );
  writeExpertPacketManifest(packetDir, roundId, included, includeResult.skipped, gitPathspecs);

  appendEvent({
    actor: optionValue(options.actor, "meta-harness"),
    stream: "review",
    phase: "plan",
    action: `built expert packet ${roundId}`,
    result: `expert packet zip written to ${relativePath(packetZip)}`,
    evidence: relativePath(packetZip),
    next_action: "Send the packet to the bounded expert reviewer or reconcile existing reviewer input.",
  });
  refreshStatus();

  const packetFiles = fs.readdirSync(packetDir, { recursive: true })
    .map((item) => String(item))
    .filter((item) => fs.statSync(path.join(packetDir, item)).isFile())
    .map((item) => item.split(path.sep).join("/"))
    .sort();
  writeZipArchive(packetDir, packetZip);
  fs.rmSync(packetDir, { recursive: true, force: true });

  console.log(`Built expert packet zip: ${packetZip}`);
  console.log("Included zip entries:");
  for (const item of packetFiles) {
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
  if (command === "templates") return commandTemplates(rest);
  if (command === "expert-packet") return commandExpertPacket(rest);
  if (command === "quality") return commandQuality(rest, {
    cwd: process.cwd(),
    harnessDir: HARNESS_DIR,
    fail,
    relativePath,
  });
  if (command === "lookback") return commandLookback(rest);
  if (command === "poll") return commandPoll(rest);
  if (command === "repos") return commandRepos(rest);

  fail(`unknown command: ${command}`);
}

main(process.argv.slice(2));
