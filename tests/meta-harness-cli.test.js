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

function errorCode(result) {
  return result.stderr.match(/meta-harness: ([A-Z0-9_]+):/)?.[1];
}

function readJsonl(filePath) {
  return fs.readFileSync(filePath, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function assertCliError(result, code, pattern) {
  assert.notEqual(result.status, 0);
  assert.equal(errorCode(result), code, result.stderr);
  assert.match(result.stderr, pattern);
  assert.doesNotMatch(result.stderr, /\n\s+at /);
}

function fencedBlockCount(text) {
  return (text.match(/```/g) || []).length;
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
  assert.equal(firstTemplateLine, "# Worker PM Brief");
  assert.match(workerReportTemplate, /Outcome: <DONE\|PARTIAL_WITH_EXPLICIT_SCOPE\|REJECTED>/);
  assert.match(workerReportTemplate, /## Validation \/ evidence/);
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
  assert.equal(typeof events[1].ts, "string");
  assert.equal(events[2].actor, "codex-researcher");
  assert.equal(events[2].evidence, ".meta-harness/workers/codex-researcher.md");
  assert.equal(fs.existsSync(path.join(harness, "workers", "codex-researcher.md")), true);

  const report = fs.readFileSync(path.join(harness, "workers", "codex-researcher.md"), "utf8");
  const firstReportLine = report
    .split(/\r?\n/)
    .find((line) => line.trim().length > 0);
  assert.equal(firstReportLine, "# Worker PM Brief");
  assert.match(report, /^# Worker PM Brief\n\nOutcome: DONE\nRound: ROUND-001\nProgress: 10\/100 -> 20\/100\nConfidence: 9\/10/m);
  assert.doesNotMatch(report, /^# Worker Report/m);
  assert.doesNotMatch(report, /## Result/);
  assert.doesNotMatch(report, /## Human Summary/);
  assert.doesNotMatch(report, /## Proposed Next Action/);
  assert.doesNotMatch(report, /## Codex continuation note/);
  assert.doesNotMatch(report, /## What I did/);
  assert.doesNotMatch(report, /## PM-facing status/);
  assert.doesNotMatch(report, /## Ship-Fast Decision Gate/);
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

test("event validation fails closed for bad JSONL and CLI input", () => {
  const eventPath = (cwd) => path.join(cwd, ".meta-harness", "events.jsonl");
  const blankCwd = tempDir();
  run(blankCwd, ["init", "Validate blank lines"]);
  fs.appendFileSync(eventPath(blankCwd), "\n\n", "utf8");
  assert.match(run(blankCwd, ["status", "--refresh"]), /Validate blank lines/);

  const malformed = [
    ["{not-json", ["status", "--refresh"], /invalid JSON.*events\.jsonl line 2/],
    ["42", ["lookback"], /events\.jsonl line 2 must be a JSON object/],
    [JSON.stringify({ ts: "2026-01-01T00:00:00.000Z", actor: "human", stream: "coding", phase: "work", action: "x" }), ["status", "--refresh"], /field "result"/],
  ];
  for (const [line, command, pattern] of malformed) {
    const cwd = tempDir();
    run(cwd, ["init", "Validate events"]);
    fs.appendFileSync(eventPath(cwd), `${line}\n`, "utf8");
    assertCliError(runRaw(cwd, command), "MH_CONFIG", pattern);
  }

  const missingActionCwd = tempDir();
  run(missingActionCwd, ["init", "Validate CLI"]);
  assertCliError(runRaw(missingActionCwd, ["event", "--result", "done"]), "MH_USAGE", /event requires --action/);
  const missingResultCwd = tempDir();
  run(missingResultCwd, ["init", "Validate CLI"]);
  assertCliError(runRaw(missingResultCwd, ["event", "--action", "did it"]), "MH_USAGE", /event requires --result/);
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
  assert.match(list, /skills\s+post-worker-github-actions\.md/);
  assert.match(list, /contracts\s+worker-done-contract\.md/);

  run(cwd, ["templates", "install"]);
  const harness = path.join(cwd, ".meta-harness");
  const scopeSelector = path.join(harness, "templates", "skills", "scope-selector.md");
  const postWorkerGithubActions = path.join(harness, "templates", "skills", "post-worker-github-actions.md");
  const workerDone = path.join(harness, "templates", "contracts", "worker-done-contract.md");

  assert.equal(fs.existsSync(scopeSelector), true);
  assert.equal(fs.existsSync(postWorkerGithubActions), true);
  assert.equal(fs.existsSync(workerDone), true);
  assert.match(fs.readFileSync(scopeSelector, "utf8"), /Chosen Scope:/);
  const postWorkerText = fs.readFileSync(postWorkerGithubActions, "utf8");
  assert.match(postWorkerText, /Post-Worker GitHub Actions/);
  assert.match(postWorkerText, /worker-report v2/);
  assert.match(postWorkerText, /skip `worker-report-template\.md`/);
  assert.match(postWorkerText, /Do not pass secrets/);
  assert.match(postWorkerText, /Summarize SAW evidence as evidence only/);
  const workerDoneText = fs.readFileSync(workerDone, "utf8");
  assert.match(workerDoneText, /Worker Done \/ PM Brief Contract/);
  assert.match(workerDoneText, /# Worker PM Brief/);
  assert.match(workerDoneText, /Outcome: <DONE\|PARTIAL_WITH_EXPLICIT_SCOPE\|REJECTED>/);
  assert.match(workerDoneText, /What decision is needed/);
  assert.match(workerDoneText, /Ship-Fast Decision Gate concept is folded/);
  assert.match(workerDoneText, /## Worker Accountability/);
  assert.match(workerDoneText, /## Blockers And Next Action/);
  assert.match(workerDoneText, /## Accountability/);
  assert.doesNotMatch(workerDoneText, /WorkerVerdict/);
  assert.doesNotMatch(workerDoneText, /text \+/);
  assert.equal(fencedBlockCount(workerDoneText) % 2, 0);
  assert.match(workerDoneText, /Silent docs-only fallback from code, test, provider_probe, commit, validation, execution, or data_output work is forbidden/);
});

test("post-worker workflow keeps reusable checks read-only and parameterized", () => {
  const workflow = fs.readFileSync(path.join(ROOT, ".github", "workflows", "post-worker-saw.yml"), "utf8");
  assert.match(workflow, /workflow_call:/);
  assert.match(workflow, /base_sha:/);
  assert.match(workflow, /head_sha:/);
  assert.match(workflow, /contents: read/);
  assert.match(workflow, /persist-credentials: false/);
  assert.match(workflow, /actions\/checkout@34e114876b0b11c390a56381ad16ebd13914f8d5/);
  assert.doesNotMatch(workflow, /actions\/checkout@v4/);
  assert.match(workflow, /filter\(\(file\) => !file\.endsWith\("worker-report-template\.md"\)\)/);
  assert.match(workflow, /No worker reports matched/);
  assert.match(workflow, /secrets\\\./);
  assert.match(workflow, /SAW wrapper: PASS/);
});

test("quality gate initializes managed repo contract and blocks a new monolith", () => {
  const cwd = tempDir();

  run(cwd, ["quality", "init"]);

  const harness = path.join(cwd, ".meta-harness");
  assert.equal(fs.existsSync(path.join(harness, "clean-code-contract.json")), true);
  assert.equal(fs.existsSync(path.join(harness, "baseline", "quality-baseline.json")), true);
  assert.match(run(cwd, ["quality", "init"]), /Kept \.meta-harness\/baseline\/quality-baseline\.json/);

  const clean = runRaw(cwd, ["quality", "check"]);
  assert.equal(clean.status, 0);
  assert.match(clean.stdout, /Quality gate: PASS/);

  assert.match(run(cwd, ["quality", "explain"]), /ratchet/);
  const refusedBaseline = runRaw(cwd, ["quality", "baseline"]);
  assert.notEqual(refusedBaseline.status, 0);
  assert.match(refusedBaseline.stderr, /requires --force after audit/);
  run(cwd, ["quality", "baseline", "--force"]);

  fs.writeFileSync(
    path.join(cwd, "new-monolith.js"),
    Array.from({ length: 501 }, (_, index) => `const line${index} = ${index};`).join("\n"),
    "utf8",
  );

  const blocked = runRaw(cwd, ["quality", "check"]);
  assert.notEqual(blocked.status, 0);
  assert.equal(errorCode(blocked), "MH_QUALITY_GATE");
  assert.match(`${blocked.stdout}\n${blocked.stderr}`, /new overbudget file/);
  assert.match(`${blocked.stdout}\n${blocked.stderr}`, /new-monolith\.js/);
});

test("package dry-run includes quality module", () => {
  const npmExecPath = process.env.npm_execpath;
  const command = npmExecPath ? process.execPath : (process.platform === "win32" ? "npm.cmd" : "npm");
  const args = npmExecPath ? [npmExecPath, "pack", "--dry-run", "--json"] : ["pack", "--dry-run", "--json"];
  const result = spawnSync(command, args, {
    cwd: ROOT,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, `ERROR:\n${result.error}\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`);
  const [pack] = JSON.parse(result.stdout);
  const packedFiles = pack.files.map((file) => file.path);
  assert.equal(packedFiles.includes("lib/quality.js"), true);
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
