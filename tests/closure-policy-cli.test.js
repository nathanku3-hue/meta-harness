"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const {
  ROOT,
  readJsonl,
  run,
  tempDir,
} = require("./helpers/cli");

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
  assert.match(workerReportTemplate, /Outcome: <DONE\|PARTIAL_WITH_EXPLICIT_SCOPE\|REJECTED>/);
  assert.match(workerReportTemplate, /## Validation \/ evidence/);
  assert.match(workerReportTemplate, /This template is a WORKER_REPORT evidence surface/);
  assert.match(workerReportTemplate, /Final chat answers must use the shortest adaptive PM_CLOSURE/);
  assert.match(workerReportTemplate, /four-item budget applies only to normal human-facing closure/i);
  assert.match(workerReportTemplate, /human: taste\/acceptance, expert: domain knowledge, or expert: system methodology/);
  assert.match(workerReportTemplate, /remain Approval needed or Blocked, not expert-decision tags/);
  assert.match(workerReportTemplate, /SLOW and tier metadata may remain in WORKER_REPORT accountability and evidence fields/);
  assert.match(
    workerReportTemplate,
    /Silent docs-only fallback from code, test, provider_probe, commit, validation, execution, or data_output work is forbidden/,
  );
  assert.doesNotMatch(
    workerReportTemplate,
    /Silent docs-only fallback from execution work is forbidden/,
  );
});

test("worker-report first-line contract is consistent across docs and templates", () => {
  const read = (relativePath) => fs
    .readFileSync(path.join(ROOT, ...relativePath.split("/")), "utf8")
    .replace(/\r\n/g, "\n");
  const readme = read("README.md");
  const productSpec = read("docs/product/product-spec.md");
  const workerDone = read("templates/contracts/worker-done-contract.md");
  const harnessState = read("lib/harness-state.js");

  assert.match(readme, /first non-empty line is `Outcome:`/);
  assert.match(readme, /no title appears before those fields/);
  assert.match(productSpec, /first non-empty line is `Outcome:`/);
  assert.match(productSpec, /Reports must not begin with `# Worker PM Brief`/);
  assert.match(workerDone, /first non-empty line of generated worker-report artifacts must be `Outcome:/);
  assert.match(workerDone, /```text\nOutcome: <DONE\|PARTIAL_WITH_EXPLICIT_SCOPE\|REJECTED>/);
  assert.doesNotMatch(workerDone, /must be `# Worker PM Brief`/);
  assert.match(harnessState, /The first non-empty line must be Outcome:/);
  assert.doesNotMatch(harnessState, /The first non-empty line must be # Worker PM Brief/);
});

test("event and worker-report update evidence and lookback without changing canonical status", () => {
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
  assert.match(status, /Goal:\nBuild coding and research visibility/);
  assert.match(status, /Current truth:\nper-repo harness state created/);
  assert.doesNotMatch(status, /worker report normalized/);

  const events = readJsonl(path.join(harness, "events.jsonl"));
  assert.equal(events.length, 3);
  assert.equal(typeof events[1].ts, "string");
  assert.equal(events[2].actor, "codex-researcher");
  assert.equal(events[2].evidence, ".meta-harness/workers/codex-researcher.md");
  assert.equal(fs.existsSync(path.join(harness, "workers", "codex-researcher.md")), true);

  const report = fs.readFileSync(path.join(harness, "workers", "codex-researcher.md"), "utf8");
  const firstReportLine = report
    .split(/\r?\n/)
    .find((line) => line.trim().length > 0);
  assert.equal(firstReportLine, "Outcome: DONE");
  assert.match(report, /^Outcome: DONE\nRound: ROUND-001\nProgress: 10\/100 -> 20\/100\nConfidence: 9\/10/m);
  assert.doesNotMatch(report, /^# Worker Report/m);
  assert.doesNotMatch(report, /^# Worker PM Brief/m);
  assert.doesNotMatch(report, /## Result/);
  assert.doesNotMatch(report, /## Human Summary/);
  assert.doesNotMatch(report, /## Proposed Next Action/);
  assert.doesNotMatch(report, /## Codex continuation note/);
  assert.doesNotMatch(report, /## What I did/);
  assert.doesNotMatch(report, /## PM-facing status/);
  assert.doesNotMatch(report, /## User-Facing Closure/);
  assert.doesNotMatch(report, /## Ship-Fast Decision Gate/);
  assert.doesNotMatch(report, /^SAW Verdict:/m);
  assert.doesNotMatch(report, /^ClosurePacket:/m);
  assert.match(report, /Outcome: DONE/);
  assert.match(report, /Round: ROUND-001/);
  assert.match(report, /Progress: 10\/100 -> 20\/100/);
  assert.match(report, /Confidence: 9\/10/);
  assert.match(report, /Ship gate tier: FAST/);
  assert.match(report, /Task resolution: ship/);
  assert.match(report, /## What changed/);
  assert.match(report, /## Why it matters/);
  assert.match(report, /## What is blocked/);
  assert.match(report, /## What decision is needed/);
  assert.match(report, /Decision needed from user: hold/);
  assert.match(report, /Options considered: none recorded/);
  assert.match(report, /## Next action/);
  assert.match(report, /## Validation \/ evidence/);
  assert.match(report, /## Accountability/);
  assert.match(report, /Passed:\nworker report file parsed/);
  assert.match(report, /Skipped:\nnone/);
  assert.match(report, /Evidence artifacts:\n\.meta-harness\/workers\/codex-researcher\.md/);
  assert.match(report, /requested_work_type: docs/);
  assert.match(report, /actual_work_type_performed: docs/);

  const lookback = run(cwd, ["lookback", "--write"]);
  assert.match(lookback, /Build coding and research visibility/);
  assert.match(lookback, /extract product patterns/);
  assert.equal(fs.existsSync(path.join(harness, "lookback.md")), true);
});
