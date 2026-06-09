"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { ROOT, run, runRaw, tempDir, writeFile } = require("./helpers/cli");

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

function addDistillation(cwd) {
  const stdout = run(cwd, [
    "distill", "add",
    "--decision-id", "D028",
    "--principle", "Prefer explicit adoption evidence before closure.",
    "--skill", "repo-adoption-doctor",
    "--assumption", "closure claim depends on source-visible evidence",
    "--reopen-when", "public or local evidence changes",
    "--owner", "nathanku3-hue",
    "--out", ".meta-harness/skill-distillations.json",
  ]);
  return stdout.match(/S-[a-f0-9]{12}/)[0];
}

test("distill candidate creates an inactive candidate draft, never active guidance", () => {
  const cwd = tempDir();
  copySkillRepo(cwd);
  const distillationId = addDistillation(cwd);

  const result = runRaw(cwd, ["distill", "candidate", distillationId, "--target", ".", "--json"]);
  assert.equal(result.status, 0, result.stderr);
  const payload = parseJson(result.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.candidate_path, ".agents/candidate/repo-adoption-doctor");

  const skillText = fs.readFileSync(path.join(cwd, ".agents", "candidate", "repo-adoption-doctor", "SKILL.md"), "utf8");
  assert.match(skillText, /Candidate skill draft generated from distillation/);
  assert.match(skillText, /Prefer explicit adoption evidence before closure/);
  assert.equal(fs.existsSync(path.join(cwd, ".agents", "skills", "repo-adoption-doctor", "SKILL.md")), true);

  const registry = JSON.parse(fs.readFileSync(path.join(cwd, ".meta-harness", "skill-registry.json"), "utf8"));
  assert.equal(registry.skills.filter((record) => record.status === "candidate").length, 1);
  assert.equal(registry.skills.filter((record) => record.status === "prototype").length, 1);
  assert.equal(registry.skills.filter((record) => record.status === "active").length, 0);

  const check = runRaw(cwd, ["skill", "check", "--target", ".", "--json"]);
  assert.equal(check.status, 0, check.stderr);
  assert.equal(parseJson(check.stdout).active_skills, 0);

  const preflight = runRaw(cwd, ["skill", "preflight", "repo-adoption-doctor", "--target", ".", "--json"]);
  assert.equal(preflight.status, 1);
  assert.equal(parseJson(preflight.stdout).blockers.some((item) => item.id === "missing-evidence"), true);
});

test("a bad candidate can be deleted without changing active or prototype skill state", () => {
  const cwd = tempDir();
  copySkillRepo(cwd);
  const distillationId = addDistillation(cwd);
  run(cwd, ["distill", "candidate", distillationId, "--target", ".", "--json"]);

  fs.rmSync(path.join(cwd, ".agents", "candidate", "repo-adoption-doctor"), { recursive: true, force: true });
  const registryPath = path.join(cwd, ".meta-harness", "skill-registry.json");
  const registry = JSON.parse(fs.readFileSync(registryPath, "utf8"));
  registry.skills = registry.skills.filter((record) => record.status !== "candidate");
  fs.writeFileSync(registryPath, `${JSON.stringify(registry, null, 2)}\n`, "utf8");

  const check = runRaw(cwd, ["skill", "check", "--target", ".", "--json"]);
  assert.equal(check.status, 0, check.stderr);
  const payload = parseJson(check.stdout);
  assert.equal(payload.prototype_skills, 1);
  assert.equal(payload.active_skills, 0);
});
