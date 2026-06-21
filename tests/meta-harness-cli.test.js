"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const {
  ROOT,
  assertCliError,
  assertSkillFrontMatter,
  errorCode,
  fencedBlockCount,
  readJsonl,
  run,
  runRaw,
  snapshotTree,
  tempDir,
  writeFile,
} = require("./helpers/cli");

function validPmBrief() {
  return [
    "# PM Brief",
    "",
    "## Decisions",
    "",
    "- ship",
    "",
    "## Blockers",
    "",
    "- none",
    "",
    "## Evidence",
    "",
    "- tests",
    "",
  ].join("\n");
}

function validDecisionInbox() {
  return {
    v: 1,
    decisions: [{
      id: "D-001",
      kind: "user_decision",
      question: "Approve bounded scope?",
      recommended: "hold",
      state_hash: "state-1",
      assumption_hash: "assumption-1",
      reask_when: "source state changes",
      status: "open",
      evidence: [".meta-harness/dirty-work.json"],
    }],
  };
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
  assert.match(workerReportTemplate, /Outcome: <DONE\|PARTIAL_WITH_EXPLICIT_SCOPE\|REJECTED>/);
  assert.match(workerReportTemplate, /## Validation \/ evidence/);
  assert.match(workerReportTemplate, /This template is an artifact, not the default final chat answer/);
  assert.match(workerReportTemplate, /Final chat answers must compress this report into Status, Why, Next, and Decision needed/);
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
  const read = (relativePath) => fs.readFileSync(path.join(ROOT, ...relativePath.split("/")), "utf8");
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

test("status refresh accepts legacy time-only event records", () => {
  const cwd = tempDir();
  run(cwd, ["init", "Legacy event compatibility"]);
  const legacyEvent = {
    time: "2026-06-03T15:59:48.136Z",
    actor: "human",
    stream: "coding",
    phase: "intake",
    action: "initialized harness",
    result: "legacy harness state created",
  };
  fs.writeFileSync(path.join(cwd, ".meta-harness", "events.jsonl"), `${JSON.stringify(legacyEvent)}\n`, "utf8");

  const status = run(cwd, ["status", "--refresh"]);

  assert.match(status, /legacy harness state created/);
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
  assert.match(list, /skills\s+expert-front-card\.md/);
  assert.match(list, /skills\s+scope-selector\.md/);
  assert.match(list, /skills\s+post-worker-github-actions\.md/);
  assert.match(list, /skills\s+subagent-workcell\.md/);
  assert.match(list, /skills\s+distilled-taste-capsule\.md/);
  assert.match(list, /contracts\s+decision-reuse-contract\.md/);
  assert.match(list, /contracts\s+decision-inbox-scan-contract\.md/);
  assert.match(list, /contracts\s+skill-sync-contract\.md/);
  assert.match(list, /contracts\s+skill-distillation-contract\.md/);
  assert.match(list, /contracts\s+subagent-workcell-contract\.md/);
  assert.match(list, /contracts\s+trust-policy-contract\.md/);
  assert.match(list, /contracts\s+pm-brief-scan-contract\.md/);
  assert.match(list, /contracts\s+worker-done-contract\.md/);

  run(cwd, ["templates", "install", "--allow-dirty"]);
  const harness = path.join(cwd, ".meta-harness");
  const expertFrontCard = path.join(harness, "templates", "skills", "expert-front-card.md");
  const scopeSelector = path.join(harness, "templates", "skills", "scope-selector.md");
  const postWorkerGithubActions = path.join(harness, "templates", "skills", "post-worker-github-actions.md");
  const subagentWorkcell = path.join(harness, "templates", "skills", "subagent-workcell.md");
  const distilledTasteCapsule = path.join(harness, "templates", "skills", "distilled-taste-capsule.md");
  const decisionReuseContract = path.join(harness, "templates", "contracts", "decision-reuse-contract.md");
  const decisionInboxScanContract = path.join(harness, "templates", "contracts", "decision-inbox-scan-contract.md");
  const skillSyncContract = path.join(harness, "templates", "contracts", "skill-sync-contract.md");
  const skillDistillationContract = path.join(harness, "templates", "contracts", "skill-distillation-contract.md");
  const subagentWorkcellContract = path.join(harness, "templates", "contracts", "subagent-workcell-contract.md");
  const trustPolicyContract = path.join(harness, "templates", "contracts", "trust-policy-contract.md");
  const pmBriefScanContract = path.join(harness, "templates", "contracts", "pm-brief-scan-contract.md");
  const workerDone = path.join(harness, "templates", "contracts", "worker-done-contract.md");

  assert.equal(fs.existsSync(expertFrontCard), true);
  assert.equal(fs.existsSync(scopeSelector), true);
  assert.equal(fs.existsSync(postWorkerGithubActions), true);
  assert.equal(fs.existsSync(subagentWorkcell), true);
  assert.equal(fs.existsSync(distilledTasteCapsule), true);
  assert.equal(fs.existsSync(decisionReuseContract), true);
  assert.equal(fs.existsSync(decisionInboxScanContract), true);
  assert.equal(fs.existsSync(skillSyncContract), true);
  assert.equal(fs.existsSync(skillDistillationContract), true);
  assert.equal(fs.existsSync(subagentWorkcellContract), true);
  assert.equal(fs.existsSync(trustPolicyContract), true);
  assert.equal(fs.existsSync(pmBriefScanContract), true);
  assert.equal(fs.existsSync(workerDone), true);
  const expertFrontCardText = fs.readFileSync(expertFrontCard, "utf8");
  const subagentWorkcellText = fs.readFileSync(subagentWorkcell, "utf8");
  const distilledTasteCapsuleText = fs.readFileSync(distilledTasteCapsule, "utf8");
  assertSkillFrontMatter(expertFrontCardText, "expert-front-card");
  assertSkillFrontMatter(subagentWorkcellText, "subagent-workcell");
  assertSkillFrontMatter(distilledTasteCapsuleText, "distilled-taste-capsule");
  assert.match(expertFrontCardText, /exactly one `Question:` field/);
  assert.match(subagentWorkcellText, /Keep fanout to 2 subagents by default/);
  assert.match(distilledTasteCapsuleText, /no automatic skill mutation in v0/i);
  assert.match(fs.readFileSync(decisionReuseContract, "utf8"), /Do not re-ask a decision/);
  assert.match(fs.readFileSync(decisionInboxScanContract, "utf8"), /extended in Phase 6 to require `assumption_hash`/);
  assert.match(fs.readFileSync(skillSyncContract, "utf8"), /PASS\nMISSING\nDRIFT/);
  assert.match(fs.readFileSync(skillDistillationContract, "utf8"), /S-<first12hex/);
  assert.match(fs.readFileSync(subagentWorkcellContract, "utf8"), /PM brief \+ artifact paths \+ decision inbox entries only/);
  assert.match(fs.readFileSync(trustPolicyContract, "utf8"), /local capsule names/);
  assert.match(fs.readFileSync(pmBriefScanContract, "utf8"), /Existing `brief pm` generator output may fail/);
  assert.match(fs.readFileSync(scopeSelector, "utf8"), /Chosen Scope:/);
  const postWorkerText = fs.readFileSync(postWorkerGithubActions, "utf8");
  assert.match(postWorkerText, /Post-Worker GitHub Actions/);
  assert.match(postWorkerText, /worker-report v2/);
  assert.match(postWorkerText, /skip `worker-report-template\.md`/);
  assert.match(postWorkerText, /Do not pass secrets/);
  assert.match(postWorkerText, /Summarize SAW evidence as evidence only/);
  const workerDoneText = fs.readFileSync(workerDone, "utf8");
  assert.match(workerDoneText, /Worker Done \/ PM Brief Contract/);
  assert.match(workerDoneText, /```text\nOutcome: <DONE\|PARTIAL_WITH_EXPLICIT_SCOPE\|REJECTED>/);
  assert.doesNotMatch(workerDoneText, /^# Worker PM Brief$/m);
  assert.match(workerDoneText, /What decision is needed/);
  assert.match(workerDoneText, /Ship-Fast Decision Gate concept is visible/);
  assert.match(workerDoneText, /## User-Facing Closure/);
  assert.match(workerDoneText, /Do not paste the full worker report into chat/);
  assert.match(workerDoneText, /Approval text requests return only pasteable approval text/);
  assert.match(workerDoneText, /## Worker Accountability/);
  assert.match(workerDoneText, /## Blockers And Next Action/);
  assert.match(workerDoneText, /## Accountability/);
  assert.doesNotMatch(workerDoneText, /WorkerVerdict/);
  assert.doesNotMatch(workerDoneText, /text \+/);
  assert.equal(fencedBlockCount(workerDoneText) % 2, 0);
  assert.match(workerDoneText, /Silent docs-only fallback from code, test, provider_probe, commit, validation, execution, or data_output work is forbidden/);
});

test("templates overwrite migrates the worker template without rewriting status", () => {
  const cwd = tempDir();
  run(cwd, ["init", "Preserve status during template rollout"]);
  const harness = path.join(cwd, ".meta-harness");
  const statusPath = path.join(harness, "status.md");
  const workerTemplatePath = path.join(harness, "workers", "worker-report-template.md");
  const preservedStatus = "# Status\n\nCurrent truth:\nkeep this exact status\n";
  fs.writeFileSync(statusPath, preservedStatus, "utf8");
  fs.writeFileSync(workerTemplatePath, "# Worker PM Brief\n\nOutcome: DONE\n", "utf8");

  run(cwd, ["templates", "install", "--overwrite", "--allow-dirty"]);

  const workerTemplate = fs.readFileSync(workerTemplatePath, "utf8");
  const firstLine = workerTemplate.split(/\r?\n/).find((line) => line.trim().length > 0);
  assert.equal(firstLine, "Outcome: <DONE|PARTIAL_WITH_EXPLICIT_SCOPE|REJECTED>");
  assert.doesNotMatch(workerTemplate, /^# Worker PM Brief/m);
  assert.equal(fs.readFileSync(statusPath, "utf8"), preservedStatus);
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

test("sync check CLI reports match and drift without writing", () => {
  const cwd = tempDir();
  run(cwd, ["init", "Sync check target"]);
  run(cwd, ["templates", "install", "--allow-dirty"]);

  const passBefore = snapshotTree(cwd);
  const pass = runRaw(cwd, ["sync", "check", "--target", cwd]);
  assert.equal(pass.status, 0);
  assert.match(pass.stdout, /SYNC CHECK: PASS checked=\d+/);
  assert.deepEqual(snapshotTree(cwd), passBefore);

  fs.writeFileSync(path.join(cwd, ".meta-harness", "templates", "skills", "scope-selector.md"), "drift\n", "utf8");
  const driftBefore = snapshotTree(cwd);
  const drift = runRaw(cwd, ["sync", "check", "--target", cwd]);
  assert.notEqual(drift.status, 0);
  assert.match(drift.stdout, /SYNC CHECK: FAIL/);
  assert.match(drift.stdout, /DRIFT\tskills\/scope-selector\.md/);
  assert.deepEqual(snapshotTree(cwd), driftBefore);
});

test("trust check CLI rejects bad skill references without writing", () => {
  const cwd = tempDir();
  writeFile(cwd, ".meta-harness/skill-distillations.json", JSON.stringify({
    v: 1,
    distillations: [{ skill: "https://example.com/skill.md" }],
  }));

  const before = snapshotTree(cwd);
  const result = runRaw(cwd, ["trust", "check", "--target", cwd]);
  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /TRUST CHECK: FAIL checked=1 rejected=1/);
  assert.match(result.stdout, /REJECTED\t\.meta-harness\/skill-distillations\.json#distillations\[0\]\.skill/);
  assert.deepEqual(snapshotTree(cwd), before);
});

test("contract scan CLI rejects old exact headings without writing", () => {
  const cwd = tempDir();
  writeFile(cwd, ".meta-harness/workers/old.md", "# Worker Report\n\n## Result\n");

  const before = snapshotTree(cwd);
  const result = runRaw(cwd, ["contract", "scan", "--target", cwd]);
  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /CONTRACT SCAN: FAIL checked=1 rejected=2/);
  assert.match(result.stdout, /REJECTED\t\.meta-harness\/workers\/old\.md\told primary heading: # Worker Report/);
  assert.deepEqual(snapshotTree(cwd), before);
});

test("contract scan CLI rejects verbose active final-response guidance without writing", () => {
  const cwd = tempDir();
  writeFile(cwd, "AGENTS.md", [
    "Final responses must use the Ship-Fast PM Brief.",
    "The final answer must start with `Outcome`, `Round`, `Progress`, and `Confidence`.",
  ].join("\n"));

  const before = snapshotTree(cwd);
  const result = runRaw(cwd, ["contract", "scan", "--target", cwd]);

  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /CONTRACT SCAN: FAIL checked=1 rejected=2/);
  assert.match(result.stdout, /REJECTED\tAGENTS\.md\tactive guidance requires the worker-report artifact/);
  assert.deepEqual(snapshotTree(cwd), before);
});

test("state check CLI reports old layout migration-needed without writing", () => {
  const cwd = tempDir();
  writeFile(cwd, ".meta-harness/runs/RUN-001/status.md", "# Old Status\n");
  writeFile(cwd, ".meta-harness/runs/RUN-001/events.jsonl", "");

  const before = snapshotTree(cwd);
  const result = runRaw(cwd, ["state", "check", "--target", cwd]);
  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /STATE CHECK: MIGRATION_NEEDED checked=3 missing=2 migration_needed=1/);
  assert.match(result.stdout, /MIGRATION_NEEDED\t\.meta-harness\/runs/);
  assert.match(result.stdout, /MISSING\t\.meta-harness\/status\.md/);
  assert.equal(fs.existsSync(path.join(cwd, ".meta-harness", "status.md")), false);
  assert.equal(fs.existsSync(path.join(cwd, ".meta-harness", "events.jsonl")), false);
  assert.deepEqual(snapshotTree(cwd), before);
});

test("brief scan CLI exits zero on target-form PM brief without requiring git", () => {
  const cwd = tempDir();
  writeFile(cwd, ".meta-harness/pm-brief.md", validPmBrief());

  const before = snapshotTree(cwd);
  const result = runRaw(cwd, ["brief", "scan", "--target", cwd]);

  assert.equal(result.status, 0);
  assert.match(result.stdout, /BRIEF SCAN: PASS checked=1/);
  assert.equal(result.stderr, "");
  assert.deepEqual(snapshotTree(cwd), before);
});

test("brief scan CLI exits nonzero on rejected section without writing", () => {
  const cwd = tempDir();
  writeFile(cwd, ".meta-harness/pm-brief.md", [
    "# PM Brief",
    "",
    "## Decisions",
    "",
    "## Raw Logs",
    "",
    "## Blockers",
    "",
    "## Evidence",
    "",
  ].join("\n"));

  const before = snapshotTree(cwd);
  const result = runRaw(cwd, ["brief", "scan", "--target", cwd]);

  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /BRIEF SCAN: FAIL checked=1 rejected=1/);
  assert.match(result.stdout, /REJECTED\t\.meta-harness\/pm-brief\.md\tunexpected heading: ## Raw Logs/);
  assert.deepEqual(snapshotTree(cwd), before);
});

test("brief scan CLI target without value is UsageError", () => {
  const cwd = tempDir();

  assertCliError(runRaw(cwd, ["brief", "scan", "--target"]), "MH_USAGE", /--target requires an existing directory/);
});

test("decision inbox scan CLI exits zero on target-form inbox without requiring git", () => {
  const cwd = tempDir();
  writeFile(cwd, ".meta-harness/decision-inbox.json", `${JSON.stringify(validDecisionInbox(), null, 2)}\n`);

  const before = snapshotTree(cwd);
  const result = runRaw(cwd, ["decisions", "scan", "--target", cwd]);

  assert.equal(result.status, 0);
  assert.match(result.stdout, /DECISION INBOX SCAN: PASS checked=1/);
  assert.equal(result.stderr, "");
  assert.deepEqual(snapshotTree(cwd), before);
});

test("decision inbox scan CLI exits nonzero on rejected status without writing", () => {
  const cwd = tempDir();
  const inbox = validDecisionInbox();
  inbox.decisions[0].status = "blocked";
  writeFile(cwd, ".meta-harness/decision-inbox.json", `${JSON.stringify(inbox, null, 2)}\n`);

  const before = snapshotTree(cwd);
  const result = runRaw(cwd, ["decisions", "scan", "--target", cwd]);

  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /DECISION INBOX SCAN: FAIL checked=1 rejected=1/);
  assert.match(result.stdout, /REJECTED\t\.meta-harness\/decision-inbox\.json#decisions\[0\]\.status\tinvalid status: blocked/);
  assert.deepEqual(snapshotTree(cwd), before);
});

test("decision inbox scan CLI target without value is UsageError", () => {
  const cwd = tempDir();

  assertCliError(runRaw(cwd, ["decisions", "scan", "--target"]), "MH_USAGE", /--target requires an existing directory/);
});

test("read-only checks reject missing or non-directory targets", () => {
  const cwd = tempDir();
  assertCliError(runRaw(cwd, ["sync", "check", "--target"]), "MH_USAGE", /--target requires an existing directory/);

  writeFile(cwd, "target.txt", "not a directory\n");
  assertCliError(
    runRaw(cwd, ["sync", "check", "--target", "target.txt"]),
    "MH_USAGE",
    /--target must be an existing directory/,
  );
});
