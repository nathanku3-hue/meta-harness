"use strict";

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { buildExecutionReadiness } = require("../lib/execution-readiness");
const { getRepoGitState } = require("../lib/repo-git-state");
const { resolveSelectedRepo } = require("../lib/selected-repo-resolver");

const BIN = path.join(__dirname, "..", "bin", "meta-harness.js");
const tmp = (p = "mh-er-") => fs.mkdtempSync(path.join(os.tmpdir(), p));
const git = (cwd, args) => {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  assert.equal(r.status, 0, `git ${args.join(" ")}\n${r.stderr}`);
};
const initGit = (cwd) => {
  git(cwd, ["init"]);
  git(cwd, ["config", "user.email", "t@e.com"]);
  git(cwd, ["config", "user.name", "T"]);
  fs.writeFileSync(path.join(cwd, "README.md"), "seed\n");
  git(cwd, ["add", "README.md"]);
  git(cwd, ["commit", "-m", "init"]);
};
const pass = () => ({ verdict: "pass", ok: true });
const fail = () => ({ verdict: "invalid", ok: false });
const art = (name = "child-app") => ({
  kind: "operator_execution_plan_artifact",
  operator_execution_plan: { verdict: "ready_for_operator", ok: true, selected_repo: name },
});
const okRes = (p) => ({ ok: true, name: "child-app", path: p });
const build = (over = {}) => buildExecutionReadiness({
  operatorPlanArtifact: art(),
  operatorPlanArtifactValidation: pass(),
  selectedRepoResolution: okRes("child"),
  cwd: process.cwd(),
  ...over,
});
const wj = (fp, v) => {
  fs.mkdirSync(path.dirname(fp), { recursive: true });
  fs.writeFileSync(fp, `${JSON.stringify(v, null, 2)}\n`);
};
const cli = (cwd, args) => spawnSync(process.execPath, [BIN, ...args], { cwd, encoding: "utf8" });

function setupParent() {
  const parent = tmp("mh-er-p-");
  const child = tmp("mh-er-c-");
  const ph = path.join(parent, ".meta-harness");
  const ch = path.join(child, ".meta-harness");
  fs.mkdirSync(ph, { recursive: true });
  fs.mkdirSync(ch, { recursive: true });
  fs.writeFileSync(path.join(ph, "status.md"), "# S\n");
  fs.writeFileSync(path.join(ph, "events.jsonl"), "{}\n");
  fs.writeFileSync(path.join(ch, "status.md"), "# S\n");
  fs.writeFileSync(path.join(ch, "events.jsonl"), "{}\n");
  wj(path.join(ch, "ready.json"), {
    schema_version: "1.0.0", generated_at: "2026-06-30T04:00:00.000Z",
    expires_after: "2099-01-01T00:00:00.000Z", target: "/tmp/child", ok: false, redacted: true,
    passed: 0, failed: 1, warned: 0, skipped: 0,
    checks: [{ id: "MH_SYNC_001", name: "sync", status: "fail", reason: "x" }],
  });
  wj(path.join(ph, "repos.json"), { repos: [{ name: "child-app", path: child, role: "child" }] });
  return { parent, child };
}

test("resolver: match / missing / ambiguous / invalid", () => {
  assert.equal(resolveSelectedRepo(art(), [{ name: "child-app", path: "child" }]).ok, true);
  assert.equal(resolveSelectedRepo(art("ghost"), [{ name: "o", path: "x" }]).code, "missing_repo");
  assert.equal(resolveSelectedRepo(art("dup"), [{ name: "dup", path: "a" }, { name: "dup", path: "b" }]).code, "ambiguous_repo");
  const bad = art();
  bad.operator_execution_plan.verdict = "blocked";
  bad.operator_execution_plan.ok = false;
  assert.equal(resolveSelectedRepo(bad, []).code, "ARTIFACT_INVALID");
});

test("getRepoGitState: missing + clean redacted", () => {
  assert.equal(getRepoGitState(path.join(os.tmpdir(), "mh-er-none-" + Date.now())).exists, false);
  const cwd = tmp();
  initGit(cwd);
  const s = getRepoGitState(cwd);
  assert.equal(s.isGitRepo && s.has_head && s.is_clean, true);
  assert.deepEqual(Object.keys(s.dirty).sort(), ["count", "has_staged", "has_untracked", "is_clean"]);
  assert.equal(JSON.stringify(s).includes("README.md"), false);
});

test("ready: clean git child", () => {
  const child = tmp();
  initGit(child);
  const r = build({ selectedRepoResolution: okRes(child) });
  assert.equal(r.verdict, "ready");
  assert.equal(r.ok, true);
  assert.equal(r.runs_read_only_git_inspection, true);
  assert.equal(r.executes_child_commands, false);
});

test("dirty child: no paths emitted", () => {
  const child = tmp();
  initGit(child);
  fs.writeFileSync(path.join(child, "secret-dirty-file.xyz"), "x\n");
  const r = build({ selectedRepoResolution: okRes(child) });
  assert.equal(r.verdict, "dirty");
  assert.equal(r.ok, false);
  assert.equal(r.runs_read_only_git_inspection, true);
  assert.equal(JSON.stringify(r).includes("secret-dirty-file.xyz"), false);
  assert.ok(r.captured.dirty.count >= 1);
});

test("non-git / missing path", () => {
  const child = tmp();
  fs.writeFileSync(path.join(child, "only.txt"), "n\n");
  let r = build({ selectedRepoResolution: okRes(child) });
  assert.equal(r.verdict, "not_git_repo");
  assert.equal(r.runs_read_only_git_inspection, true);
  r = build({ selectedRepoResolution: okRes(path.join(os.tmpdir(), "mh-er-miss-" + Date.now())) });
  assert.equal(r.verdict, "missing_repo");
  assert.equal(r.runs_read_only_git_inspection, true);
});

test("ambiguous / resolution fail: inspection false", () => {
  let r = build({
    operatorPlanArtifact: art("dup"),
    selectedRepoResolution: { ok: false, code: "ambiguous_repo", detail: "multi" },
  });
  assert.equal(r.verdict, "ambiguous_repo");
  assert.equal(r.runs_read_only_git_inspection, false);
  r = build({ selectedRepoResolution: { ok: false, code: "missing_repo", detail: "no" } });
  assert.equal(r.verdict, "missing_repo");
  assert.equal(r.runs_read_only_git_inspection, false);
});

test("invalid validation blocks ready even with clean git", () => {
  const child = tmp();
  initGit(child);
  const r = build({
    operatorPlanArtifactValidation: fail(),
    selectedRepoResolution: okRes(child),
  });
  assert.equal(r.verdict, "artifact_invalid");
  assert.equal(r.ok, false);
  assert.equal(r.runs_read_only_git_inspection, false);
  const r2 = build({
    operatorPlanArtifactValidation: { verdict: "pass", ok: false },
    selectedRepoResolution: okRes(child),
  });
  assert.equal(r2.verdict, "artifact_invalid");
});

test("poll: validation failure always emits execution_readiness", () => {
  const { parent } = setupParent();
  wj(path.join(parent, ".meta-harness", "bad.json"), { not: "valid" });
  const result = cli(parent, ["poll", "--rollup", "--json", "--verify-operator-execution-plan", ".meta-harness/bad.json"]);
  assert.equal(result.status, 0, result.stderr);
  const roll = JSON.parse(result.stdout);
  assert.equal(roll.operator_execution_plan_artifact_validation.ok, false);
  assert.ok(roll.execution_readiness);
  assert.equal(roll.execution_readiness.verdict, "artifact_invalid");
  assert.equal(roll.execution_readiness.runs_read_only_git_inspection, false);
  assert.equal(roll.runs_read_only_git_inspection, false);
});

test("poll: good artifact non-git child emits not_git_repo", () => {
  const { parent } = setupParent();
  const initial = cli(parent, ["poll", "--rollup", "--json"]);
  assert.equal(initial.status, 0, initial.stderr);
  const receipt = {
    packet_id: JSON.parse(initial.stdout).autonomy_plan.packet_id,
    decision_id: "approve_for_manual_work",
    reviewer: "R", reviewed_at: "2026-07-02T00:00:00.000Z", reason: "ok",
  };
  assert.equal(cli(parent, [
    "poll", "--rollup", "--json", "--autonomy-approval-receipt", JSON.stringify(receipt),
    "--write-manual-work-packet", ".meta-harness/manual-work-packet.json",
  ]).status, 0);
  assert.equal(cli(parent, [
    "poll", "--rollup", "--json",
    "--verify-manual-work-packet", ".meta-harness/manual-work-packet.json",
    "--write-operator-execution-plan", ".meta-harness/operator-execution-plan.json",
  ]).status, 0);
  const verify = cli(parent, [
    "poll", "--rollup", "--json",
    "--verify-operator-execution-plan", ".meta-harness/operator-execution-plan.json",
  ]);
  assert.equal(verify.status, 0, verify.stderr);
  const roll = JSON.parse(verify.stdout);
  assert.equal(roll.operator_execution_plan_artifact_validation.ok, true);
  assert.equal(roll.execution_readiness.verdict, "not_git_repo");
  assert.equal(roll.execution_readiness.runs_read_only_git_inspection, true);
});
