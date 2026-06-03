"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const ROOT = path.resolve(__dirname, "..");
const CLI = path.join(ROOT, "bin", "meta-harness.js");

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "meta-harness-"));
}

function run(cwd, args, options = {}) {
  const result = spawnSync(process.execPath, [CLI, ...args], {
    cwd,
    encoding: "utf8",
    ...options,
  });
  if (result.status !== 0) {
    throw new Error(`Command failed: ${args.join(" ")}\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`);
  }
  return result.stdout;
}

function runRaw(cwd, args, options = {}) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd,
    encoding: "utf8",
    ...options,
  });
}

function readJsonl(filePath) {
  return fs.readFileSync(filePath, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

test("init creates per-repo markdown harness state", () => {
  const cwd = tempDir();
  run(cwd, ["init", "Ship the Codex-native status harness"]);

  const harness = path.join(cwd, ".meta-harness");
  assert.equal(fs.existsSync(path.join(harness, "status.md")), true);
  assert.equal(fs.existsSync(path.join(harness, "phase-map.md")), true);
  assert.equal(fs.existsSync(path.join(harness, "events.jsonl")), true);
  assert.equal(fs.existsSync(path.join(harness, "streams", "coding.md")), true);
  assert.equal(fs.existsSync(path.join(harness, "workers", "worker-report-template.md")), true);

  const status = fs.readFileSync(path.join(harness, "status.md"), "utf8");
  assert.match(status, /Ship the Codex-native status harness/);

  const workerReportTemplate = fs.readFileSync(
    path.join(harness, "workers", "worker-report-template.md"),
    "utf8",
  );
  const firstTemplateLine = workerReportTemplate
    .split(/\r?\n/)
    .find((line) => line.trim().length > 0);
  assert.equal(firstTemplateLine, "Outcome: <DONE|PARTIAL_WITH_EXPLICIT_SCOPE|REJECTED>");
  assert.doesNotMatch(workerReportTemplate, /# Worker PM Brief/);
  assert.match(
    workerReportTemplate,
    /Silent docs-only fallback from code, test, provider_probe, commit, validation, execution, or data_output work is forbidden/,
  );
  assert.doesNotMatch(
    workerReportTemplate,
    /Silent docs-only fallback from execution work is forbidden/,
  );
});

test("event and worker-report update status and lookback", () => {
  const cwd = tempDir();
  run(cwd, ["init", "Build coding and research visibility"]);
  run(cwd, [
    "event",
    "--stream", "research",
    "--phase", "work",
    "--action", "surveyed adjacent projects",
    "--result", "copy visibility and persistence, reject full swarm",
    "--evidence", "product research note",
    "--next-action", "create worker task contract",
  ]);
  run(cwd, [
    "worker-report",
    "codex-researcher",
    "--stream", "research",
    "--task", "extract product patterns",
    "--outcome", "DONE",
    "--round", "ROUND-001",
    "--progress", "10/100 -> 20/100",
    "--confidence", "9/10",
    "--result", "worker report normalized",
    "--human-summary", "Research worker output is normalized and ready for PM synthesis.",
    "--validations-passed", "worker report file parsed",
    "--validations-skipped", "none",
    "--evidence-artifacts", ".meta-harness/workers/codex-researcher.md",
    "--requested-work-type", "docs",
    "--actual-work-type", "docs",
    "--next-action", "synthesize status",
  ]);

  const harness = path.join(cwd, ".meta-harness");
  const status = run(cwd, ["status", "--refresh"]);
  assert.match(status, /worker report normalized/);
  assert.match(status, /research: worker report normalized/);

  const events = readJsonl(path.join(harness, "events.jsonl"));
  assert.equal(events.length, 3);
  assert.equal(events[2].actor, "codex-researcher");
  assert.equal(events[2].evidence, ".meta-harness/workers/codex-researcher.md");
  assert.equal(fs.existsSync(path.join(harness, "workers", "codex-researcher.md")), true);

  const report = fs.readFileSync(path.join(harness, "workers", "codex-researcher.md"), "utf8");
  const firstReportLine = report
    .split(/\r?\n/)
    .find((line) => line.trim().length > 0);
  assert.equal(firstReportLine, "Outcome: DONE");
  assert.match(report, /^Outcome: DONE\nRound: ROUND-001\nProgress: 10\/100 -> 20\/100\nConfidence: 9\/10/m);
  assert.doesNotMatch(report, /# Worker PM Brief/);
  assert.doesNotMatch(report, /^# Worker Report/m);
  assert.doesNotMatch(report, /## Result/);
  assert.doesNotMatch(report, /## Human Summary/);
  assert.doesNotMatch(report, /## Proposed Next Action/);
  assert.doesNotMatch(report, /## Codex continuation note/);
  assert.doesNotMatch(report, /## What I did/);
  assert.doesNotMatch(report, /## PM-facing status/);
  assert.doesNotMatch(report, /## Ship-Fast Decision Gate/);
  assert.doesNotMatch(report, /## Validation \/ evidence/);
  assert.doesNotMatch(report, /^SAW Verdict:/m);
  assert.doesNotMatch(report, /^ClosurePacket:/m);
  assert.match(report, /Outcome: DONE/);
  assert.match(report, /Round: ROUND-001/);
  assert.match(report, /Progress: 10\/100 -> 20\/100/);
  assert.match(report, /Confidence: 9\/10/);
  assert.match(report, /## What changed/);
  assert.match(report, /## Why it matters/);
  assert.match(report, /## What is blocked/);
  assert.match(report, /## What decision is needed/);
  assert.match(report, /Decision needed from user: hold/);
  assert.match(report, /Options considered: none recorded/);
  assert.match(report, /## Next action/);
  assert.match(report, /## Evidence/);
  assert.match(report, /## Accountability/);
  assert.match(report, /Passed:\nworker report file parsed/);
  assert.match(report, /Evidence artifacts:\n\.meta-harness\/workers\/codex-researcher\.md/);
  assert.match(report, /requested_work_type: docs/);
  assert.match(report, /actual_work_type_performed: docs/);

  const lookback = run(cwd, ["lookback", "--write"]);
  assert.match(lookback, /Build coding and research visibility/);
  assert.match(lookback, /extract product patterns/);
  assert.equal(fs.existsSync(path.join(harness, "lookback.md")), true);
});

test("worker-report requires explicit valid outcome", () => {
  const cwd = tempDir();
  run(cwd, ["init", "Require explicit worker outcome"]);

  const missing = runRaw(cwd, [
    "worker-report",
    "codex-researcher",
    "--stream", "research",
    "--task", "missing outcome",
    "--result", "should not write",
  ]);
  assert.notEqual(missing.status, 0);
  assert.match(missing.stderr, /requires --outcome DONE\|PARTIAL_WITH_EXPLICIT_SCOPE\|REJECTED/);
  assert.doesNotMatch(missing.stdout, /Worker PM Brief/);
  assert.equal(fs.existsSync(path.join(cwd, ".meta-harness", "workers", "codex-researcher.md")), false);

  const invalid = runRaw(cwd, [
    "worker-report",
    "codex-researcher",
    "--stream", "research",
    "--task", "invalid outcome",
    "--outcome", "DONE-ish",
    "--result", "should not write",
  ]);
  assert.notEqual(invalid.status, 0);
  assert.match(invalid.stderr, /requires --outcome DONE\|PARTIAL_WITH_EXPLICIT_SCOPE\|REJECTED/);
  assert.doesNotMatch(invalid.stdout, /Worker PM Brief/);
  assert.equal(fs.existsSync(path.join(cwd, ".meta-harness", "workers", "codex-researcher.md")), false);
});

test("worker-report requires explicit valid work type fields", () => {
  const cwd = tempDir();
  run(cwd, ["init", "Require explicit work types"]);

  const missingRequested = runRaw(cwd, [
    "worker-report",
    "codex-researcher",
    "--stream", "research",
    "--task", "missing requested work type",
    "--outcome", "DONE",
    "--actual-work-type", "docs",
    "--result", "should not write",
  ]);
  assert.notEqual(missingRequested.status, 0);
  assert.match(missingRequested.stderr, /requires --requested-work-type docs\|code\|test\|provider_probe\|commit\|validation\|execution\|data_output/);
  assert.equal(fs.existsSync(path.join(cwd, ".meta-harness", "workers", "codex-researcher.md")), false);

  const missingActual = runRaw(cwd, [
    "worker-report",
    "codex-researcher",
    "--stream", "research",
    "--task", "missing actual work type",
    "--outcome", "DONE",
    "--requested-work-type", "docs",
    "--result", "should not write",
  ]);
  assert.notEqual(missingActual.status, 0);
  assert.match(missingActual.stderr, /requires --actual-work-type docs\|code\|test\|provider_probe\|commit\|validation\|execution\|data_output\|none/);
  assert.equal(fs.existsSync(path.join(cwd, ".meta-harness", "workers", "codex-researcher.md")), false);
});

test("worker-report rejects silent docs-only fallback for execution work", () => {
  const cwd = tempDir();
  run(cwd, ["init", "Reject execution fallback"]);

  const executionDocs = runRaw(cwd, [
    "worker-report",
    "codex-worker",
    "--stream", "coding",
    "--task", "execute code change",
    "--outcome", "DONE",
    "--requested-work-type", "execution",
    "--actual-work-type", "docs",
    "--result", "should not write",
  ]);
  assert.notEqual(executionDocs.status, 0);
  assert.match(executionDocs.stderr, /silent docs-only fallback is forbidden/);
  assert.equal(fs.existsSync(path.join(cwd, ".meta-harness", "workers", "codex-worker.md")), false);
});

test("worker-report rejects silent docs-only fallback for data output work", () => {
  const cwd = tempDir();
  run(cwd, ["init", "Reject data output fallback"]);

  const dataOutputDocs = runRaw(cwd, [
    "worker-report",
    "codex-worker",
    "--stream", "coding",
    "--task", "produce data output",
    "--outcome", "DONE",
    "--requested-work-type", "data_output",
    "--actual-work-type", "docs",
    "--result", "should not write",
  ]);
  assert.notEqual(dataOutputDocs.status, 0);
  assert.match(dataOutputDocs.stderr, /silent docs-only fallback is forbidden/);
  assert.equal(fs.existsSync(path.join(cwd, ".meta-harness", "workers", "codex-worker.md")), false);
});

test("worker-report allows partial or rejected reports with blockers", () => {
  const partialCwd = tempDir();
  run(partialCwd, ["init", "Allow explicit partial report"]);
  run(partialCwd, [
    "worker-report",
    "codex-worker",
    "--stream", "coding",
    "--task", "execute code change",
    "--outcome", "PARTIAL_WITH_EXPLICIT_SCOPE",
    "--requested-work-type", "execution",
    "--actual-work-type", "docs",
    "--blocker", "runtime validation not approved",
    "--result", "documented blocker only",
  ]);
  const partialReport = fs.readFileSync(path.join(partialCwd, ".meta-harness", "workers", "codex-worker.md"), "utf8");
  assert.match(partialReport, /Outcome: PARTIAL_WITH_EXPLICIT_SCOPE/);
  assert.match(partialReport, /remaining_blocker: runtime validation not approved/);

  const rejectedCwd = tempDir();
  run(rejectedCwd, ["init", "Allow explicit rejected report"]);
  run(rejectedCwd, [
    "worker-report",
    "codex-worker",
    "--stream", "coding",
    "--task", "produce data output",
    "--outcome", "REJECTED",
    "--requested-work-type", "data_output",
    "--actual-work-type", "none",
    "--blocker", "data output not authorized",
    "--result", "rejected unsafe request",
  ]);
  const rejectedReport = fs.readFileSync(path.join(rejectedCwd, ".meta-harness", "workers", "codex-worker.md"), "utf8");
  assert.match(rejectedReport, /Outcome: REJECTED/);
  assert.match(rejectedReport, /remaining_blocker: data output not authorized/);
});

test("repos and poll read child repo status without launching workers", () => {
  const parent = tempDir();
  const child = tempDir();

  run(parent, ["init", "Parent harness"]);
  run(child, ["init", "Child harness"]);
  run(child, [
    "event",
    "--stream", "coding",
    "--phase", "verify",
    "--action", "ran checks",
    "--result", "child checks pass",
  ]);

  run(parent, ["repos", "add", "child-app", child]);
  const list = run(parent, ["repos", "list"]);
  assert.match(list, /child-app/);

  const poll = run(parent, ["poll", "--write"]);
  assert.match(poll, /Parent harness/);
  assert.match(poll, /child-app/);
  assert.match(poll, /Child harness/);
  assert.equal(fs.existsSync(path.join(parent, ".meta-harness", "poll.md")), true);
});

test("templates install copies reusable scope and handoff contracts", () => {
  const cwd = tempDir();
  run(cwd, ["init", "Prepare bounded delegated work"]);

  const list = run(cwd, ["templates", "list"]);
  assert.match(list, /skills\s+scope-selector\.md/);
  assert.match(list, /contracts\s+worker-done-contract\.md/);

  run(cwd, ["templates", "install"]);
  const harness = path.join(cwd, ".meta-harness");
  const scopeSelector = path.join(harness, "templates", "skills", "scope-selector.md");
  const workerDone = path.join(harness, "templates", "contracts", "worker-done-contract.md");

  assert.equal(fs.existsSync(scopeSelector), true);
  assert.equal(fs.existsSync(workerDone), true);
  assert.match(fs.readFileSync(scopeSelector, "utf8"), /Chosen Scope:/);
  const workerDoneText = fs.readFileSync(workerDone, "utf8");
  assert.match(workerDoneText, /Worker Done \/ PM Brief Contract/);
  assert.match(workerDoneText, /Outcome: <DONE\|PARTIAL_WITH_EXPLICIT_SCOPE\|REJECTED>/);
  assert.match(workerDoneText, /What decision is needed/);
  assert.match(workerDoneText, /Ship-Fast Decision Gate concept is folded/);
  assert.match(workerDoneText, /## Accountability/);
  assert.match(workerDoneText, /Silent docs-only fallback from code, test, provider_probe, commit, validation, execution, or data_output work is forbidden/);
});

test("expert-packet builds bounded local review packet", () => {
  const cwd = tempDir();
  run(cwd, ["init", "Build expert review packet"]);
  fs.writeFileSync(path.join(cwd, "focused-note.md"), "# Focused Note\n\nEvidence only.\n", "utf8");
  run(cwd, [
    "event",
    "--stream", "review",
    "--phase", "plan",
    "--action", "selected bounded expert review",
    "--result", "packet scope is one focused note",
  ]);

  const output = run(cwd, ["expert-packet", "ROUND-001", "--include", "focused-note.md"]);
  assert.match(output, /Built expert packet zip:/);

  const packetDir = path.join(cwd, ".meta-harness", "expert-packets", "ROUND-001");
  const packetZip = `${packetDir}.zip`;
  assert.equal(fs.existsSync(packetDir), false);
  assert.equal(fs.existsSync(packetZip), true);

  const zipBytes = fs.readFileSync(packetZip);
  assert.equal(zipBytes.readUInt32LE(0), 0x04034b50);
  const zipText = zipBytes.toString("utf8");
  assert.match(zipText, /README_DECISION_CARD\.md/);
  assert.match(zipText, /\.meta-harness\/status\.md/);
  assert.match(zipText, /included\/focused-note\.md/);
  assert.match(zipText, /harness_templates\/skills\/scope-selector\.md/);
  assert.match(zipText, /PACKET_MANIFEST\.md/);
  assert.match(zipText, /git_status\.txt/);
  assert.match(zipText, /single zip archive only/);
  assert.match(zipText, /Excluded by design/);
});

test("expert-packet rejects includes that overlap packet output", () => {
  const cwd = tempDir();
  run(cwd, ["init", "Reject recursive packet includes"]);

  const result = runRaw(cwd, ["expert-packet", "ROUND-001", "--include", ".meta-harness"]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /include path must not overlap packet output root/);
});
