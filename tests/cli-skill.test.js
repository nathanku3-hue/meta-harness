"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { canonicalSkillBundleHash } = require("../lib/skill-registry");
const { ROOT, readJsonl, runRaw, snapshotTree, tempDir, writeFile } = require("./helpers/cli");

function copySkillRepo(targetRoot) {
  fs.cpSync(
    path.join(ROOT, ".agents", "skills", "repo-adoption-doctor"),
    path.join(targetRoot, ".agents", "skills", "repo-adoption-doctor"),
    { recursive: true },
  );
  fs.mkdirSync(path.join(targetRoot, ".meta-harness"), { recursive: true });
  fs.copyFileSync(
    path.join(ROOT, ".meta-harness", "skill-registry.json"),
    path.join(targetRoot, ".meta-harness", "skill-registry.json"),
  );
  writeFile(targetRoot, "package.json", "{\n  \"name\": \"fixture\",\n  \"license\": \"MIT\"\n}\n");
}

function parseJson(stdout) {
  return JSON.parse(stdout);
}

function readRegistry(targetRoot) {
  return JSON.parse(fs.readFileSync(path.join(targetRoot, ".meta-harness", "skill-registry.json"), "utf8"));
}

function writeRegistry(targetRoot, registry) {
  fs.writeFileSync(
    path.join(targetRoot, ".meta-harness", "skill-registry.json"),
    `${JSON.stringify(registry, null, 2)}\n`,
    "utf8",
  );
}

function addCandidate(targetRoot, options = {}) {
  const skillName = "repo-adoption-doctor";
  const candidateRel = `.agents/candidate/${skillName}`;
  fs.cpSync(
    path.join(targetRoot, ".agents", "skills", skillName),
    path.join(targetRoot, ".agents", "candidate", skillName),
    { recursive: true },
  );
  const registry = readRegistry(targetRoot);
  const baseline = registry.skills.find((record) => record.name === skillName);
  const evidence = options.evidence === false ? {} : {
    eval_evidence: { command: baseline.eval_command, passed_at: "2026-06-09T00:00:00.000Z" },
    complexity_evidence: "quality complexity report reviewed",
    rollback_evidence: "rollback plan reviewed",
  };
  const candidate = {
    ...baseline,
    path: candidateRel,
    status: "candidate",
    candidate_date: "2026-06-09",
    ...evidence,
  };
  candidate.content_hash = canonicalSkillBundleHash(targetRoot, candidate.path);
  registry.skills.push(candidate);
  writeRegistry(targetRoot, registry);
}

test("skill check emits stable JSON for a valid registry", () => {
  const result = runRaw(ROOT, ["skill", "check", "--target", ".", "--json"]);
  assert.equal(result.status, 0, result.stderr);
  const payload = parseJson(result.stdout);
  assert.equal(payload.schema_version, "1.0.0");
  assert.equal(payload.ok, true);
  assert.equal(payload.registry, "PASS");
  assert.equal(payload.prototype_skills, 1);
});

test("skill check keeps candidate records inactive", () => {
  const cwd = tempDir();
  copySkillRepo(cwd);
  addCandidate(cwd);

  const result = runRaw(cwd, ["skill", "check", "--target", ".", "--json"]);
  assert.equal(result.status, 0, result.stderr);
  const payload = parseJson(result.stdout);
  assert.equal(payload.active_skills, 0);
  assert.equal(payload.prototype_skills, 1);
});

test("skill check fails closed with machine-readable JSON for corrupt registry", () => {
  const cwd = tempDir();
  fs.mkdirSync(path.join(cwd, ".meta-harness"), { recursive: true });
  writeFile(cwd, ".meta-harness/skill-registry.json", "{not-json");

  const result = runRaw(cwd, ["skill", "check", "--target", ".", "--json"]);
  assert.equal(result.status, 1);
  const payload = parseJson(result.stdout);
  assert.equal(payload.ok, false);
  assert.equal(payload.error_code, "MH_CONFIG");
  assert.match(payload.message, /invalid JSON/);
});

test("skill doctor separates diagnostic findings from strict failure", () => {
  const cwd = tempDir();
  writeFile(cwd, ".gitignore", "node_modules/\n");

  const nonStrict = runRaw(cwd, ["skill", "doctor", "--target", ".", "--json"]);
  assert.equal(nonStrict.status, 0, nonStrict.stderr);
  const payload = parseJson(nonStrict.stdout);
  assert.equal(payload.ok, false);
  assert.equal(payload.findings.some((finding) => finding.id === "ADOPT_STATE_MISSING_STATUS"), true);

  const strict = runRaw(cwd, ["skill", "doctor", "--target", ".", "--json", "--strict"]);
  assert.equal(strict.status, 2);
  const strictPayload = parseJson(strict.stdout);
  assert.equal(strictPayload.error_code, "MH_SKILL_FINDINGS");
});

test("skill preflight passes with explicit evidence and writes nothing", () => {
  const cwd = tempDir();
  copySkillRepo(cwd);
  addCandidate(cwd);
  const before = snapshotTree(cwd);

  const result = runRaw(cwd, ["skill", "preflight", "repo-adoption-doctor", "--target", ".", "--json"]);
  assert.equal(result.status, 0, result.stderr);
  const payload = parseJson(result.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.preflight, "PASS");
  assert.equal(payload.candidate.path, ".agents/candidate/repo-adoption-doctor");
  assert.deepEqual(snapshotTree(cwd), before);
});

test("skill preflight blocks missing evidence and writes nothing", () => {
  const cwd = tempDir();
  copySkillRepo(cwd);
  addCandidate(cwd, { evidence: false });
  const before = snapshotTree(cwd);

  const result = runRaw(cwd, ["skill", "preflight", "repo-adoption-doctor", "--target", ".", "--json"]);
  assert.equal(result.status, 1);
  const payload = parseJson(result.stdout);
  assert.equal(payload.ok, false);
  assert.equal(payload.preflight, "BLOCKED");
  assert.equal(payload.blockers.some((item) => item.message.includes("eval_evidence")), true);
  assert.deepEqual(snapshotTree(cwd), before);
});

test("skill disable dry-run and quarantine operate only on a temp repo", () => {
  const cwd = tempDir();
  copySkillRepo(cwd);

  const dryRun = runRaw(cwd, ["skill", "disable", "repo-adoption-doctor", "--target", ".", "--json", "--dry-run"]);
  assert.equal(dryRun.status, 0, dryRun.stderr);
  assert.equal(parseJson(dryRun.stdout).status, "would-quarantine");
  assert.equal(fs.existsSync(path.join(cwd, ".agents", "skills", "repo-adoption-doctor")), true);

  const disabled = runRaw(cwd, ["skill", "disable", "repo-adoption-doctor", "--target", ".", "--json"]);
  assert.equal(disabled.status, 0, disabled.stderr);
  const payload = parseJson(disabled.stdout);
  assert.equal(payload.status, "quarantined");
  assert.equal(fs.existsSync(path.join(cwd, ".agents", "skills", "repo-adoption-doctor")), false);
  assert.equal(fs.existsSync(path.join(cwd, ...payload.to.split("/"))), true);

  const registry = JSON.parse(fs.readFileSync(path.join(cwd, ".meta-harness", "skill-registry.json"), "utf8"));
  assert.equal(registry.skills[0].status, "quarantined");
  const events = readJsonl(path.join(cwd, ".meta-harness", "events.jsonl"));
  assert.equal(events.at(-1).action, "skill.disable");
  assert.equal(events.at(-1).redacted, true);
  assert.equal(events.at(-1).skill_content_hash.startsWith("sha256:"), true);
});

test("skill disable rejects path traversal skill names", () => {
  const cwd = tempDir();
  copySkillRepo(cwd);

  const result = runRaw(cwd, ["skill", "disable", "../x", "--target", ".", "--json"]);
  assert.notEqual(result.status, 0);
  const payload = parseJson(result.stdout);
  assert.equal(payload.error_code, "MH_USAGE");
  assert.match(payload.message, /invalid skill name/);
});
