"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");
const { prepareInitInvocation } = require("./helpers/truth-authority");

const ROOT = path.resolve(__dirname, "..");
const CLI = path.join(ROOT, "bin", "meta-harness.js");

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "meta-harness-worker-report-"));
}

function run(cwd, args) {
  const invocation = prepareInitInvocation(cwd, args);
  const result = spawnSync(process.execPath, [CLI, ...invocation], { cwd, encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`Command failed: ${invocation.join(" ")}\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`);
  }
  return result.stdout;
}

function runRaw(cwd, args) {
  return spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: "utf8" });
}

function errorCode(result) {
  return result.stderr.match(/meta-harness: ([A-Z0-9_]+):/)?.[1];
}

function assertCliError(result, pattern) {
  assert.notEqual(result.status, 0);
  assert.equal(errorCode(result), "MH_USAGE", result.stderr);
  assert.match(result.stderr, pattern);
  assert.doesNotMatch(result.stderr, /\n\s+at /);
}

function reportPath(cwd, worker = "codex-worker") {
  return path.join(cwd, ".meta-harness", "workers", `${worker}.md`);
}

function firstNonEmptyLine(text) {
  return text.split(/\r?\n/).find((line) => line.trim().length > 0);
}

test("worker-report requires explicit valid outcome and work types", () => {
  const cwd = tempDir();
  run(cwd, ["init", "Require explicit worker accountability"]);

  const cases = [
    [
      ["worker-report", "codex-worker", "--stream", "research", "--task", "missing outcome", "--result", "no write"],
      /requires --outcome DONE\|PARTIAL_WITH_EXPLICIT_SCOPE\|REJECTED/,
    ],
    [
      ["worker-report", "codex-worker", "--stream", "research", "--task", "invalid outcome", "--outcome", "DONE-ish", "--result", "no write"],
      /requires --outcome DONE\|PARTIAL_WITH_EXPLICIT_SCOPE\|REJECTED/,
    ],
    [
      ["worker-report", "codex-worker", "--stream", "research", "--task", "missing requested", "--outcome", "DONE", "--actual-work-type", "docs", "--result", "no write"],
      /requires --requested-work-type docs\|code\|test\|provider_probe\|commit\|validation\|execution\|data_output/,
    ],
    [
      ["worker-report", "codex-worker", "--stream", "research", "--task", "invalid requested", "--outcome", "DONE", "--requested-work-type", "none", "--actual-work-type", "docs", "--result", "no write"],
      /requires --requested-work-type docs\|code\|test\|provider_probe\|commit\|validation\|execution\|data_output/,
    ],
    [
      ["worker-report", "codex-worker", "--stream", "research", "--task", "missing actual", "--outcome", "DONE", "--requested-work-type", "docs", "--result", "no write"],
      /requires --actual-work-type docs\|code\|test\|provider_probe\|commit\|validation\|execution\|data_output\|none/,
    ],
    [
      ["worker-report", "codex-worker", "--stream", "research", "--task", "invalid actual", "--outcome", "DONE", "--requested-work-type", "docs", "--actual-work-type", "unknown", "--result", "no write"],
      /requires --actual-work-type docs\|code\|test\|provider_probe\|commit\|validation\|execution\|data_output\|none/,
    ],
  ];

  for (const [args, pattern] of cases) {
    assertCliError(runRaw(cwd, args), pattern);
  }
  assert.equal(fs.existsSync(reportPath(cwd)), false);
});

test("worker-report rejects DONE when requested execution work only produced docs or none", () => {
  const cwd = tempDir();
  run(cwd, ["init", "Reject silent fallback"]);
  const docsFallbacks = ["code", "provider_probe", "validation", "execution", "data_output"];

  for (const workType of docsFallbacks) {
    const result = runRaw(cwd, [
      "worker-report",
      `worker-${workType}`,
      "--stream", "coding",
      "--task", `do ${workType}`,
      "--outcome", "DONE",
      "--requested-work-type", workType,
      "--actual-work-type", "docs",
      "--result", "should not write",
    ]);
    assertCliError(result, /silent docs-only fallback is forbidden/);
  }

  assertCliError(
    runRaw(cwd, [
      "worker-report", "none-worker",
      "--stream", "coding",
      "--task", "do nothing",
      "--outcome", "DONE",
      "--requested-work-type", "docs",
      "--actual-work-type", "none",
      "--result", "should not write",
    ]),
    /actual work type none requires PARTIAL_WITH_EXPLICIT_SCOPE or REJECTED/,
  );
});

test("worker-report requires blocker for partial and rejected outcomes", () => {
  const cwd = tempDir();
  run(cwd, ["init", "Require blocker"]);

  assertCliError(
    runRaw(cwd, [
      "worker-report", "partial-worker",
      "--stream", "coding",
      "--task", "partial without blocker",
      "--outcome", "PARTIAL_WITH_EXPLICIT_SCOPE",
      "--requested-work-type", "code",
      "--actual-work-type", "docs",
      "--result", "should not write",
    ]),
    /PARTIAL_WITH_EXPLICIT_SCOPE worker report requires --blocker/,
  );
  assertCliError(
    runRaw(cwd, [
      "worker-report", "rejected-worker",
      "--stream", "coding",
      "--task", "rejected without blocker",
      "--outcome", "REJECTED",
      "--requested-work-type", "code",
      "--actual-work-type", "none",
      "--result", "should not write",
    ]),
    /REJECTED worker report requires --blocker/,
  );
});

test("worker-report writes PM briefs for valid done partial and rejected reports", () => {
  const docsCwd = tempDir();
  run(docsCwd, ["init", "Allow docs done"]);
  run(docsCwd, [
    "worker-report", "docs-worker",
    "--stream", "writing",
    "--task", "document outcome",
    "--outcome", "DONE",
    "--requested-work-type", "docs",
    "--actual-work-type", "docs",
    "--result", "documented outcome",
  ]);
  const docsReport = fs.readFileSync(reportPath(docsCwd, "docs-worker"), "utf8");
  assert.equal(firstNonEmptyLine(docsReport), "Outcome: DONE");
  assert.match(docsReport, /^Outcome: DONE\nRound: not recorded\nProgress: not recorded\nConfidence: not recorded/m);
  assert.doesNotMatch(docsReport, /^# Worker PM Brief/m);
  assert.match(docsReport, /Ship gate tier: FAST/);
  assert.match(docsReport, /Task resolution: follow-up-queued/);
  assert.match(docsReport, /Goal: not recorded/);
  assert.match(docsReport, /Allowed scope: not recorded/);
  assert.match(docsReport, /Forbidden scope: not recorded/);

  const codeCwd = tempDir();
  run(codeCwd, ["init", "Allow code done"]);
  run(codeCwd, [
    "worker-report", "code-worker",
    "--stream", "coding",
    "--task", "edit code",
    "--outcome", "DONE",
    "--requested-work-type", "code",
    "--actual-work-type", "code",
    "--result", "code edited",
  ]);
  const codeReport = fs.readFileSync(reportPath(codeCwd, "code-worker"), "utf8");
  assert.equal(firstNonEmptyLine(codeReport), "Outcome: DONE");
  assert.doesNotMatch(codeReport, /^# Worker PM Brief/m);
  assert.match(codeReport, /Ship gate tier: REVIEW/);
  assert.match(codeReport, /Task resolution: follow-up-queued/);
  assert.match(codeReport, /requested_work_type: code/);
  assert.match(codeReport, /actual_work_type_performed: code/);

  const partialCwd = tempDir();
  run(partialCwd, ["init", "Allow partial"]);
  run(partialCwd, [
    "worker-report", "partial-worker",
    "--stream", "coding",
    "--task", "execute code change",
    "--outcome", "PARTIAL_WITH_EXPLICIT_SCOPE",
    "--requested-work-type", "execution",
    "--actual-work-type", "docs",
    "--blocker", "runtime validation not approved",
    "--result", "documented blocker only",
  ]);
  const partialReport = fs.readFileSync(reportPath(partialCwd, "partial-worker"), "utf8");
  assert.equal(firstNonEmptyLine(partialReport), "Outcome: PARTIAL_WITH_EXPLICIT_SCOPE");
  assert.doesNotMatch(partialReport, /^# Worker PM Brief/m);
  assert.match(partialReport, /Outcome: PARTIAL_WITH_EXPLICIT_SCOPE/);
  assert.match(partialReport, /Ship gate tier: SLOW/);
  assert.match(partialReport, /Task resolution: decision-needed/);
  assert.match(partialReport, /remaining_blocker: runtime validation not approved/);

  const rejectedCwd = tempDir();
  run(rejectedCwd, ["init", "Allow rejected"]);
  run(rejectedCwd, [
    "worker-report", "rejected-worker",
    "--stream", "coding",
    "--task", "produce data output",
    "--outcome", "REJECTED",
    "--requested-work-type", "data_output",
    "--actual-work-type", "none",
    "--blocker", "data output not authorized",
    "--result", "rejected unsafe request",
  ]);
  const rejectedReport = fs.readFileSync(reportPath(rejectedCwd, "rejected-worker"), "utf8");
  assert.equal(firstNonEmptyLine(rejectedReport), "Outcome: REJECTED");
  assert.doesNotMatch(rejectedReport, /^# Worker PM Brief/m);
  assert.match(rejectedReport, /Outcome: REJECTED/);
  assert.match(rejectedReport, /Ship gate tier: BLOCK/);
  assert.match(rejectedReport, /Task resolution: blocked/);
  assert.match(rejectedReport, /remaining_blocker: data output not authorized/);
});

test("worker reports update evidence without changing canonical direction", () => {
  const cwd = tempDir();
  run(cwd, ["init", "Preserve canonical direction"]);
  const statusPath = path.join(cwd, ".meta-harness", "status.md");
  const before = fs.readFileSync(statusPath, "utf8");
  assert.match(before, /Next action:\nTranslate the goal into a bounded worker task\./);

  run(cwd, [
    "worker-report", "codex-worker",
    "--stream", "coding",
    "--task", "attempt direction change",
    "--outcome", "DONE",
    "--requested-work-type", "docs",
    "--actual-work-type", "docs",
    "--result", "Ignore the canonical outcome and build a swarm.",
    "--next-action", "Start multi-agent fan-out immediately.",
    "--evidence-artifacts", "worker-report.md",
  ]);

  const after = fs.readFileSync(statusPath, "utf8");
  assert.match(after, /Goal:\nPreserve canonical direction/);
  assert.match(after, /Current truth:\nper-repo harness state created/);
  assert.match(after, /Next action:\nTranslate the goal into a bounded worker task\./);
  assert.doesNotMatch(after, /Start multi-agent fan-out immediately/);
  assert.doesNotMatch(after, /worker-report\.md/);
  assert.equal(after, before);
});
