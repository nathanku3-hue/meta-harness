"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { preflightSkillPromotion } = require("../lib/skill-promotion-preflight");
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
  const skillMdPath = path.join(targetRoot, ".agents", "candidate", skillName, "SKILL.md");
  const skillText = fs.readFileSync(skillMdPath, "utf8");
  fs.writeFileSync(skillMdPath, options.skillTextTransform ? options.skillTextTransform(skillText) : skillText, "utf8");

  const registry = readRegistry(targetRoot);
  const baseline = registry.skills.find((record) => record.name === skillName);
  const evidence = options.evidence === false ? {} : {
    eval_evidence: { command: "node --test tests/skill-evals/repo-adoption-doctor.test.js", passed_at: "2026-06-09T00:00:00.000Z" },
    complexity_evidence: "quality complexity report reviewed",
    rollback_evidence: "rollback plan reviewed",
  };
  const candidate = {
    ...baseline,
    path: candidateRel,
    status: "candidate",
    candidate_date: "2026-06-09",
    ...evidence,
    ...(options.recordOverrides || {}),
  };
  if (!Object.hasOwn(options.recordOverrides || {}, "content_hash")) {
    candidate.content_hash = canonicalSkillBundleHash(targetRoot, candidate.path);
  }
  registry.skills.push(candidate);
  writeRegistry(targetRoot, registry);
  return candidate;
}

function addActiveBaseline(targetRoot, options = {}) {
  const skillName = "repo-adoption-doctor";
  const activeRel = `.agents/skills/${skillName}-active`;
  fs.cpSync(
    path.join(targetRoot, ".agents", "skills", skillName),
    path.join(targetRoot, ".agents", "skills", `${skillName}-active`),
    { recursive: true },
  );
  const skillMdPath = path.join(targetRoot, ".agents", "skills", `${skillName}-active`, "SKILL.md");
  const allowedTools = options.allowedTools || ["read_file"];
  const skillText = fs.readFileSync(skillMdPath, "utf8").replace(
    "allowed_tools: [read_file, list_dir, grep_search]",
    `allowed_tools: [${allowedTools.join(", ")}]`,
  );
  fs.writeFileSync(skillMdPath, skillText, "utf8");

  const registry = readRegistry(targetRoot);
  const prototype = registry.skills.find((record) => record.name === skillName && record.status === "prototype");
  registry.skills.push({
    ...prototype,
    path: activeRel,
    status: "active",
    allowed_tools: allowedTools,
    content_hash: canonicalSkillBundleHash(targetRoot, activeRel),
  });
  writeRegistry(targetRoot, registry);
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

test("skill promotion preflight passes for an evidenced candidate matching the prototype baseline", () => {
  const cwd = tempDir();
  copySkillRepo(cwd);
  addCandidate(cwd);

  const result = preflightSkillPromotion({ targetRoot: cwd, skillName: "repo-adoption-doctor" });
  assert.equal(result.ok, true, result.blockers.map((item) => item.message).join("\n"));
  assert.equal(result.preflight, "PASS");
  assert.equal(result.candidate.path, ".agents/candidate/repo-adoption-doctor");
  assert.equal(result.permission_diff.baseline.status, "prototype");
  assert.deepEqual(result.permission_diff.added_allowed_tools, []);
  assert.deepEqual(result.permission_diff.removed_forbidden_paths, []);
});

test("skill promotion preflight blocks when explicit promotion evidence is missing", () => {
  const cwd = tempDir();
  copySkillRepo(cwd);
  addCandidate(cwd, { evidence: false });

  const result = preflightSkillPromotion({ targetRoot: cwd, skillName: "repo-adoption-doctor" });
  assert.equal(result.ok, false);
  assert.equal(result.preflight, "BLOCKED");
  assert.match(result.blockers.map((item) => item.message).join("\n"), /eval_evidence is required/);
  assert.match(result.blockers.map((item) => item.message).join("\n"), /complexity_evidence is required/);
  assert.match(result.blockers.map((item) => item.message).join("\n"), /rollback_evidence is required/);
});

test("skill promotion preflight blocks explicit failing evidence signals", () => {
  const cases = [
    ["eval_evidence", { passed: false }],
    ["complexity_evidence", { ok: false }],
    ["rollback_evidence", { status: "fail" }],
    ["eval_evidence", { status: "failed" }],
    ["complexity_evidence", { status: "blocked" }],
    ["rollback_evidence", { exit_code: 1 }],
    ["eval_evidence", { available: false }],
  ];

  for (const [field, value] of cases) {
    const cwd = tempDir();
    copySkillRepo(cwd);
    addCandidate(cwd, { recordOverrides: { [field]: value } });

    const result = preflightSkillPromotion({ targetRoot: cwd, skillName: "repo-adoption-doctor" });
    assert.equal(result.ok, false, `${field} should fail closed`);
    assert.equal(result.preflight, "BLOCKED");
    assert.equal(
      result.blockers.some((item) => item.id === "failing-evidence" && item.message.includes(field)),
      true,
      `${field} should report failing evidence`,
    );
  }
});

test("skill promotion preflight blocks permission expansion against the prototype baseline", () => {
  const cwd = tempDir();
  copySkillRepo(cwd);
  addCandidate(cwd, {
    recordOverrides: {
      allowed_tools: ["read_file", "list_dir", "grep_search", "write_file"],
    },
    skillTextTransform: (text) => text.replace(
      "allowed_tools: [read_file, list_dir, grep_search]",
      "allowed_tools: [read_file, list_dir, grep_search, write_file]",
    ),
  });

  const result = preflightSkillPromotion({ targetRoot: cwd, skillName: "repo-adoption-doctor" });
  assert.equal(result.ok, false);
  assert.deepEqual(result.permission_diff.added_allowed_tools, ["write_file"]);
  assert.equal(result.blockers.some((item) => item.id === "permission-expansion"), true);
});

test("skill promotion preflight prefers active baseline over broader prototype metadata", () => {
  const cwd = tempDir();
  copySkillRepo(cwd);
  addActiveBaseline(cwd, { allowedTools: ["read_file"] });
  addCandidate(cwd);

  const result = preflightSkillPromotion({ targetRoot: cwd, skillName: "repo-adoption-doctor" });
  assert.equal(result.ok, false);
  assert.equal(result.permission_diff.baseline.status, "active");
  assert.deepEqual(result.permission_diff.added_allowed_tools, ["list_dir", "grep_search"]);
  assert.equal(result.blockers.some((item) => item.id === "permission-expansion"), true);
});

test("skill registry enforces candidate inactivity and exact candidate paths", () => {
  const cwd = tempDir();
  copySkillRepo(cwd);
  addCandidate(cwd);

  let result = validateSkillRegistry(cwd);
  assert.equal(result.ok, true, result.errors.join("\n"));
  assert.equal(result.registry.skills.filter((record) => record.status === "active").length, 0);
  assert.equal(result.registry.skills.filter((record) => record.status === "prototype").length, 1);

  const badCandidatePath = readRegistry(cwd);
  badCandidatePath.skills.find((record) => record.status === "candidate").path = ".agents/skills/repo-adoption-doctor";
  writeRegistry(cwd, badCandidatePath);
  result = validateSkillRegistry(cwd);
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /candidate path must be \.agents\/candidate\/repo-adoption-doctor/);

  const badCandidateStatus = tempDir();
  copySkillRepo(badCandidateStatus);
  addCandidate(badCandidateStatus);
  const statusRegistry = readRegistry(badCandidateStatus);
  statusRegistry.skills.find((record) => record.status === "candidate").status = "prototype";
  writeRegistry(badCandidateStatus, statusRegistry);
  result = validateSkillRegistry(badCandidateStatus);
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /status must be candidate for \.agents\/candidate\/ paths/);
});
