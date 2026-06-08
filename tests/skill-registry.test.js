"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const {
  canonicalSkillBundleHash,
  validateSkillRegistry,
} = require("../lib/skill-registry");
const { ROOT, tempDir, writeFile } = require("./helpers/cli");

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

test("skill registry validates schema, frontmatter, license inheritance, and bundle hash", () => {
  const cwd = tempDir();
  copySkillRepo(cwd);

  const result = validateSkillRegistry(cwd);
  assert.equal(result.ok, true, result.errors.join("\n"));
  assert.equal(
    canonicalSkillBundleHash(cwd, ".agents/skills/repo-adoption-doctor"),
    result.registry.skills[0].content_hash,
  );
});

test("skill registry rejects frontmatter and registry drift", () => {
  const cwd = tempDir();
  copySkillRepo(cwd);
  const skillPath = path.join(cwd, ".agents", "skills", "repo-adoption-doctor", "SKILL.md");
  fs.writeFileSync(
    skillPath,
    fs.readFileSync(skillPath, "utf8").replace("allowed_tools: [read_file, list_dir, grep_search]", "allowed_tools: [read_file]"),
    "utf8",
  );

  const result = validateSkillRegistry(cwd);
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /allowed_tools does not match/);
  assert.match(result.errors.join("\n"), /content_hash does not match/);
});

test("skill registry rejects unreviewed executable or reference surfaces", () => {
  const cwd = tempDir();
  copySkillRepo(cwd);
  writeFile(cwd, ".agents/skills/repo-adoption-doctor/scripts/run.js", "\"use strict\";\n");

  const result = validateSkillRegistry(cwd);
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /scripts\/ requires explicit package review/);
});

test("skill registry rejects public-derived skills without provenance", () => {
  const cwd = tempDir();
  copySkillRepo(cwd);
  const registryPath = path.join(cwd, ".meta-harness", "skill-registry.json");
  const registry = JSON.parse(fs.readFileSync(registryPath, "utf8"));
  registry.skills[0].source = "public-derived";
  delete registry.skills[0].source_commit;
  delete registry.skills[0].content_hash;
  delete registry.skills[0].eval_command;
  fs.writeFileSync(registryPath, `${JSON.stringify(registry, null, 2)}\n`, "utf8");

  const result = validateSkillRegistry(cwd);
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /source_url is required/);
  assert.match(result.errors.join("\n"), /eval_command is required/);
  assert.match(result.errors.join("\n"), /source_commit or content_hash/);
});
