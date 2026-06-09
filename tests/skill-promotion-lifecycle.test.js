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
  const skillMd = path.join(targetRoot, ".agents", "candidate", skillName, "SKILL.md");
  if (options.skillTextTransform) {
    fs.writeFileSync(skillMd, options.skillTextTransform(fs.readFileSync(skillMd, "utf8")), "utf8");
  }
  const registry = readRegistry(targetRoot);
  const baseline = registry.skills.find((record) => record.name === skillName);
  const candidate = {
    ...baseline,
    path: candidateRel,
    status: "candidate",
    candidate_date: "2026-06-09T00:00:00.000Z",
    eval_evidence: { command: baseline.eval_command, passed: true },
    complexity_evidence: { ok: true, report: "quality check clean" },
    rollback_evidence: { ok: true, path: baseline.path, hash: baseline.content_hash },
    ...(options.recordOverrides || {}),
  };
  candidate.content_hash = canonicalSkillBundleHash(targetRoot, candidate.path);
  registry.skills.push(candidate);
  writeRegistry(targetRoot, registry);
}

test("skill promote and rollback complete the governed lifecycle", () => {
  const cwd = tempDir();
  copySkillRepo(cwd);
  const originalHash = readRegistry(cwd).skills[0].content_hash;
  addCandidate(cwd, {
    skillTextTransform: (text) => `${text}\n## Distilled Lesson\n\nPrefer explicit adoption evidence before closure.\n`,
  });

  const promoted = runRaw(cwd, ["skill", "promote", "repo-adoption-doctor", "--target", ".", "--decision-id", "D028", "--json"]);
  assert.equal(promoted.status, 0, promoted.stderr);
  const promotion = parseJson(promoted.stdout);
  assert.equal(promotion.status, "promoted");
  assert.equal(fs.existsSync(path.join(cwd, ".agents", "candidate", "repo-adoption-doctor")), false);
  assert.equal(fs.existsSync(path.join(cwd, ".agents", "skills", "repo-adoption-doctor", "SKILL.md")), true);

  let registry = readRegistry(cwd);
  const active = registry.skills.find((record) => record.name === "repo-adoption-doctor" && record.status === "active");
  assert.equal(active.promotion_decision, "D028");
  assert.equal(active.rollback_hash, originalHash);
  assert.match(active.rollback_path, /^\.agents\/quarantine\/repo-adoption-doctor-superseded-/);
  assert.equal(registry.skills.some((record) => record.status === "quarantined" && record.content_hash === originalHash), true);
  assert.equal(readJsonl(path.join(cwd, ".meta-harness", "events.jsonl")).at(-1).action, "skill.promote");

  const rolledBack = runRaw(cwd, ["skill", "rollback", "repo-adoption-doctor", "--target", ".", "--decision-id", "D029", "--json"]);
  assert.equal(rolledBack.status, 0, rolledBack.stderr);
  const rollback = parseJson(rolledBack.stdout);
  assert.equal(rollback.status, "rolled-back");
  registry = readRegistry(cwd);
  const restored = registry.skills.find((record) => record.name === "repo-adoption-doctor" && record.status === "active");
  assert.equal(restored.content_hash, originalHash);
  assert.equal(restored.restored_by_decision, "D029");
  assert.equal(readJsonl(path.join(cwd, ".meta-harness", "events.jsonl")).at(-1).action, "skill.rollback");
});

test("skill promote blocks missing evidence and writes nothing", () => {
  const cwd = tempDir();
  copySkillRepo(cwd);
  addCandidate(cwd, { recordOverrides: { eval_evidence: undefined, complexity_evidence: undefined, rollback_evidence: undefined } });
  fs.mkdirSync(path.join(cwd, ".meta-harness", "local", "locks"), { recursive: true });
  const before = snapshotTree(cwd);

  const result = runRaw(cwd, ["skill", "promote", "repo-adoption-doctor", "--target", ".", "--decision-id", "D028", "--json"]);
  assert.notEqual(result.status, 0);
  const payload = parseJson(result.stdout);
  assert.equal(payload.ok, false);
  assert.match(payload.message, /promotion preflight blocked/);
  assert.deepEqual(snapshotTree(cwd), before);
});

test("permission expansion can be authorized only by an explicit decision", () => {
  const cwd = tempDir();
  copySkillRepo(cwd);
  addCandidate(cwd, {
    recordOverrides: { allowed_tools: ["read_file", "list_dir", "grep_search", "write_file"] },
    skillTextTransform: (text) => text.replace(
      "allowed_tools: [read_file, list_dir, grep_search]",
      "allowed_tools: [read_file, list_dir, grep_search, write_file]",
    ),
  });

  const blocked = runRaw(cwd, ["skill", "preflight", "repo-adoption-doctor", "--target", ".", "--json"]);
  assert.equal(blocked.status, 1);
  assert.equal(parseJson(blocked.stdout).blockers.some((item) => item.id === "permission-expansion"), true);

  const authorized = runRaw(cwd, ["skill", "preflight", "repo-adoption-doctor", "--target", ".", "--permission-decision", "D030", "--json"]);
  assert.equal(authorized.status, 0, authorized.stderr);
  assert.equal(parseJson(authorized.stdout).permission_authorization, "D030");
});
