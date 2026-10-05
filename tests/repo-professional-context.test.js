"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const {
  listProfessionalSkillMetadata,
  renderProfessionalSkillBodies,
} = require("../lib/professional-skill-catalog");
const { initializeIntegrationHead } = require("../lib/optimistic-integration");
const { compileRepoPlannerInput } = require("../lib/repo-planner-input");
const { writeProductMd } = require("./helpers/product-direction");

function git(root, args) {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8", windowsHide: true });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || `git ${args.join(" ")} failed`);
  return String(result.stdout || "").trim();
}

function write(root, relativePath, content) {
  const target = path.join(root, ...relativePath.split("/"));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content, "utf8");
}

function skill(name, description, body) {
  return `---\nname: ${name}\ndescription: ${description}\n---\n\n${body}\n`;
}

function repo(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "meta-harness-professional-context-"));
  git(root, ["init"]);
  git(root, ["config", "user.name", "Professional Context Test"]);
  git(root, ["config", "user.email", "professional-context@example.invalid"]);
  write(root, "README.md", "fixture\n");
  writeProductMd(root);
  git(root, ["add", "."]);
  git(root, ["commit", "-m", "baseline"]);
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function commitContext(root, { body = "version one", missing = false } = {}) {
  write(root, ".agents/skills/api-contract-review/SKILL.md", skill(
    "api-contract-review",
    "Review API behavior against the declared contract.",
    body,
  ));
  write(root, ".agents/skills/quant-shadow/SKILL.md", skill(
    "quant-shadow",
    "Undeclared control procedure.",
    "Must remain invisible.",
  ));
  const skills = [{ name: "api-contract-review", path: ".agents/skills/api-contract-review/SKILL.md" }];
  if (missing) skills.push({ name: "missing-procedure", path: ".agents/skills/missing-procedure/SKILL.md" });
  write(root, ".meta-harness-project.json", `${JSON.stringify({
    schemaVersion: "meta-harness-project/v1",
    professionalContext: { skills },
  }, null, 2)}\n`);
  git(root, ["add", "."]);
  git(root, ["commit", "-m", `professional context ${body}`]);
  return git(root, ["rev-parse", "HEAD"]);
}

test("declaration-only eligibility ignores undeclared directories and dirty skill edits", (t) => {
  const root = repo(t);
  const productCommit = commitContext(root);
  const metadata = listProfessionalSkillMetadata(root, { productCommit });
  assert.deepEqual(metadata.map((entry) => entry.name), ["api-contract-review"]);
  const firstDigest = metadata[0].contentDigest;
  const rendered = renderProfessionalSkillBodies(root, { productCommit });
  assert.match(rendered, /Repository professional procedures/u);
  assert.match(rendered, /api-contract-review/u);
  assert.match(rendered, /version one/u);
  assert.doesNotMatch(rendered, /quant-shadow|Must remain invisible/u);

  write(root, ".agents/skills/api-contract-review/SKILL.md", skill(
    "api-contract-review",
    "Review API behavior against the declared contract.",
    "DIRTY BYTES MUST BE INVISIBLE",
  ));
  const sameMetadata = listProfessionalSkillMetadata(root, { productCommit });
  assert.equal(sameMetadata[0].contentDigest, firstDigest);
  assert.doesNotMatch(renderProfessionalSkillBodies(root, { productCommit }), /DIRTY BYTES/u);
});

test("coding context injects only professionally relevant bodies while keeping a discovery index", (t) => {
  const root = repo(t);
  write(root, ".agents/skills/api-contract-review/SKILL.md", skill(
    "api-contract-review",
    "Review API behavior against the declared contract.",
    "API BODY SHOULD BE SELECTED",
  ));
  write(root, ".agents/skills/database-tuning/SKILL.md", skill(
    "database-tuning",
    "Tune database indexes and query plans.",
    "DATABASE BODY SHOULD STAY OUT",
  ));
  write(root, ".meta-harness-project.json", `${JSON.stringify({
    schemaVersion: "meta-harness-project/v1",
    professionalContext: { skills: [
      { name: "api-contract-review", path: ".agents/skills/api-contract-review/SKILL.md" },
      { name: "database-tuning", path: ".agents/skills/database-tuning/SKILL.md" },
    ] },
  }, null, 2)}\n`);
  git(root, ["add", "."]);
  git(root, ["commit", "-m", "two professional procedures"]);
  const productCommit = git(root, ["rev-parse", "HEAD"]);

  const rendered = renderProfessionalSkillBodies(root, {
    productCommit,
    query: "Fix API endpoint contract parsing.",
  });
  assert.match(rendered, /api-contract-review/u);
  assert.match(rendered, /database-tuning/u);
  assert.match(rendered, /API BODY SHOULD BE SELECTED/u);
  assert.doesNotMatch(rendered, /DATABASE BODY SHOULD STAY OUT/u);
});

test("a committed procedure revision becomes visible only under the later productCommit", (t) => {
  const root = repo(t);
  const firstCommit = commitContext(root);
  const first = listProfessionalSkillMetadata(root, { productCommit: firstCommit })[0];
  write(root, ".agents/skills/api-contract-review/SKILL.md", skill(
    "api-contract-review",
    "Review API behavior against the declared contract.",
    "version two",
  ));
  git(root, ["add", "."]);
  git(root, ["commit", "-m", "update declared procedure"]);
  const secondCommit = git(root, ["rev-parse", "HEAD"]);
  assert.equal(listProfessionalSkillMetadata(root, { productCommit: firstCommit })[0].contentDigest, first.contentDigest);
  const second = listProfessionalSkillMetadata(root, { productCommit: secondCommit })[0];
  assert.notEqual(second.contentDigest, first.contentDigest);
  assert.match(renderProfessionalSkillBodies(root, { productCommit: secondCommit }), /version two/u);
});

test("missing advisory SOP is omitted without blocking ordinary product context", (t) => {
  const root = repo(t);
  const baseline = git(root, ["rev-parse", "HEAD"]);
  assert.deepEqual(listProfessionalSkillMetadata(root, { productCommit: baseline }), []);
  const broken = commitContext(root, { missing: true });
  const metadata = listProfessionalSkillMetadata(root, { productCommit: broken });
  assert.deepEqual(metadata.map((entry) => entry.name), ["api-contract-review"]);
  assert.doesNotMatch(renderProfessionalSkillBodies(root, { productCommit: broken }), /missing-procedure/u);
});

test("malformed advisory professional skill is omitted without blocking ordinary product context", (t) => {
  const root = repo(t);
  write(root, ".agents/skills/api-contract-review/SKILL.md", skill(
    "api-contract-review",
    "Review API behavior against the declared contract.",
    "healthy body",
  ));
  write(root, ".agents/skills/broken/SKILL.md", "not frontmatter\n");
  write(root, ".meta-harness-project.json", `${JSON.stringify({
    schemaVersion: "meta-harness-project/v1",
    professionalContext: { skills: [
      { name: "api-contract-review", path: ".agents/skills/api-contract-review/SKILL.md" },
      { name: "broken", path: ".agents/skills/broken/SKILL.md" },
    ] },
  }, null, 2)}\n`);
  git(root, ["add", "."]);
  git(root, ["commit", "-m", "malformed optional procedure"]);
  const productCommit = git(root, ["rev-parse", "HEAD"]);

  const metadata = listProfessionalSkillMetadata(root, { productCommit });
  assert.deepEqual(metadata.map((entry) => entry.name), ["api-contract-review"]);
});

test("planner input surfaces immutable repository-declared professional skill metadata", (t) => {
  const root = repo(t);
  const productCommit = commitContext(root);
  initializeIntegrationHead({ repositoryPath: root, baseCommit: productCommit });
  const input = compileRepoPlannerInput({ repositoryPath: root });
  assert.deepEqual(input.professionalSkills.map((entry) => entry.name), ["api-contract-review"]);
  assert.equal(input.professionalSkills[0].relativePath, ".agents/skills/api-contract-review/SKILL.md");
  assert.match(input.professionalSkills[0].contentDigest, /^sha256:[a-f0-9]{64}$/u);
  assert.equal(Object.hasOwn(input.professionalSkills[0], "content"), false);
});


test("package metadata does not globally expose Quant professional SOPs", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8"));
  assert.equal(pkg.files.some((entry) => /\.agents\/skills\/quant-/u.test(entry)), false);
});
