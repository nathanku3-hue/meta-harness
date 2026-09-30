"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  codingArgs,
  resolveCodingWorker,
  windowsPathToWsl,
  wslPathToWindows,
} = require("../lib/coding-worker");
const { FILES, readRuntimeSkill } = require("../lib/runtime-skills");

const ROOT = path.resolve(__dirname, "..");

test("WSL worker paths translate to native Windows paths", () => {
  assert.equal(wslPathToWindows("/mnt/e/Code/repo/file.json"), "E:\\Code\\repo\\file.json");
  assert.equal(wslPathToWindows("E:\\Code\\repo"), null);
  assert.equal(windowsPathToWsl("D:\\nodejs\\node.exe"), "/mnt/d/nodejs/node.exe");
  assert.equal(windowsPathToWsl("/mnt/d/nodejs/node.exe"), null);

  const args = codingArgs({
    workspacePath: "/mnt/e/Code/repo",
    schemaPath: "/mnt/e/Code/repo/.git/schema.json",
    outputPath: "/mnt/e/Code/repo/.git/output.json",
    prompt: "Do the work.",
    pathStyle: "windows",
  });
  assert.deepEqual(args.slice(args.indexOf("-C"), args.indexOf("-C") + 2), ["-C", "E:\\Code\\repo"]);
  const projectDocOverrideAt = args.indexOf("project_doc_max_bytes=0");
  const skillsOverrideAt = args.indexOf("skills.include_instructions=false");
  const execAt = args.indexOf("exec");
  assert.ok(projectDocOverrideAt > 0);
  assert.equal(args[projectDocOverrideAt - 1], "-c");
  assert.ok(projectDocOverrideAt < execAt);
  assert.ok(skillsOverrideAt > 0);
  assert.equal(args[skillsOverrideAt - 1], "-c");
  assert.ok(skillsOverrideAt < execAt);
  assert.ok(args.indexOf("--ignore-rules") > execAt);
  assert.ok(args.includes("E:\\Code\\repo\\.git\\schema.json"));
  assert.ok(args.includes("E:\\Code\\repo\\.git\\output.json"));
});

test("package-owned runtime skills are explicit while ambient Codex skills stay disabled", () => {
  assert.deepEqual(Object.keys(FILES), [
    "root",
    "coding-worker",
    "logical-planner",
    "read-only-interaction",
    "research-promotion",
  ]);
  const rootSkill = readRuntimeSkill("root");
  const codingWorkerSkill = readRuntimeSkill("coding-worker");
  assert.match(rootSkill, /META_HARNESS_RUNTIME_SKILL_V1/u);
  assert.match(rootSkill, /ENDGAME_LOOP_LAW/u);
  assert.match(rootSkill, /Scope is a safety\/capability boundary, not a value function/u);
  assert.match(rootSkill, /cheap, bounded, reversible, observable, and consistent with invariants/u);
  assert.match(rootSkill, /Scale validation pressure with uncertainty, consequence, and irreversibility/u);
  assert.match(rootSkill, /proxy metric cannot establish product success by itself/iu);
  assert.match(rootSkill, /SIDE_EFFECT_MEMBRANE_LAW/u);
  assert.match(rootSkill, /Outcome -> current Observation\/gap -> nearest reversible in-scope Action -> execute -> exact effect-boundary check/u);
  assert.match(rootSkill, /cannot by themselves make a physically available reversible action unavailable/u);
  assert.match(rootSkill, /Domain-specific authority vocabularies belong to the repository/u);
  assert.match(rootSkill, /catalogs, derived indexes, hash-parity checks, mutable status projections, and file mtime stability are observation\/audit surfaces/u);
  assert.match(rootSkill, /Never sleep, poll, or wait for a quiet\/stable window/u);
  assert.match(rootSkill, /Exact-byte binding belongs at the concrete protected or irreversible effect call/u);
  assert.match(rootSkill, /RESULT_VELOCITY_LAW/u);
  assert.match(rootSkill, /Repository-declared deterministic procedures are executable domain context/u);
  assert.match(rootSkill, /smallest reusable failed-means\/counterexample observation/u);
  assert.doesNotMatch(rootSkill, /\b(?:permission|authorization|approval|approver|owner\s+(?:gate|authority|question|work)|owner-escalation)\b/iu);
  assert.match(codingWorkerSkill, /CODING_WORKER_SKILL_V1/u);
  assert.match(codingWorkerSkill, /bound repository contract exposes a deterministic procedure or worker verb/u);
  assert.doesNotMatch(codingWorkerSkill, /nearest reversible in-scope Action|pre-execution control-state audit|proxy metric/u);
  const logicalPlannerSkill = readRuntimeSkill("logical-planner");
  assert.match(logicalPlannerSkill, /immutable discovery index/u);
  assert.match(logicalPlannerSkill, /existing declared deterministic procedure/u);
  assert.match(logicalPlannerSkill, /planner-candidate-batch\/v4/u);
  assert.doesNotMatch(logicalPlannerSkill, /Scope is a safety\/capability boundary|Scale validation pressure|proxy metric/u);
  assert.throws(() => readRuntimeSkill("execution-custody"), /unknown packaged runtime skill/u);
  assert.match(readRuntimeSkill("logical-planner"), /LOGICAL_PLANNER_AUTODISPATCH_V4/u);
  assert.throws(() => readRuntimeSkill("forward-motion"), /unknown packaged runtime skill/u);
  assert.throws(() => readRuntimeSkill("coding-worker/proposal"), /unknown packaged runtime skill/u);
  assert.match(readRuntimeSkill("read-only-interaction"), /READ_ONLY_INTERACTION_V1/u);
  assert.match(readRuntimeSkill("research-promotion"), /RESEARCH_PROMOTION_V1/u);
  assert.throws(() => readRuntimeSkill("professional-skill-selector"), /unknown packaged runtime skill/u);
  assert.throws(() => readRuntimeSkill("pre-go-experiment"), /unknown packaged runtime skill/u);
  assert.throws(() => readRuntimeSkill("../outside"), /unknown packaged runtime skill/u);

  const packaged = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  assert.ok(packaged.files.includes(".agents/skills/meta-harness-runtime/**/*.md"));
  assert.equal(packaged.files.includes("!.agents/skills/meta-harness-runtime/forward-motion/**"), false);
  assert.equal(packaged.files.includes("!.agents/skills/meta-harness-runtime/coding-worker/proposal/**"), false);
  assert.equal(packaged.files.includes("!lib/work-forward-motion.js"), false);
  assert.equal(fs.existsSync(path.join(ROOT, "lib", "work-forward-motion.js")), false);
  assert.equal(fs.existsSync(path.join(ROOT, ".agents", "skills", "meta-harness-runtime", "forward-motion", "SKILL.md")), false);
  assert.equal(fs.existsSync(path.join(ROOT, ".agents", "skills", "meta-harness-runtime", "coding-worker", "proposal", "SKILL.md")), false);

  for (const relativePath of [
    "lib/coding-worker.js",
    "lib/repo-logical-planner.js",
    "lib/read-only-interaction.js",
    "lib/repo-research-promotion.js",
  ]) {
    const source = fs.readFileSync(path.join(ROOT, relativePath), "utf8");
    assert.match(source, /renderRuntimeSkill/u, `${relativePath} must render a package-owned runtime skill`);
    assert.doesNotMatch(
      source,
      /CODING_WORKER_SKILL_V1|LOGICAL_PLANNER_AUTODISPATCH_V4|READ_ONLY_INTERACTION_V1|RESEARCH_PROMOTION_V1/u,
    );
  }

  for (const relativePath of ["lib/work-loop.js", "lib/proposal-worker-packet.js"]) {
    const source = fs.readFileSync(path.join(ROOT, relativePath), "utf8");
    assert.match(source, /renderProfessionalSkillBodies/u, `${relativePath} must inject committed professional procedures`);
    assert.match(source, /session\.base\.commit/u, `${relativePath} must bind professional procedures to the sealed product commit`);
  }
});

test("WSL resolves the existing Windows Codex launcher without installing another runtime", () => {
  const calls = [];
  const worker = resolveCodingWorker(
    { WSL_DISTRO_NAME: "Ubuntu" },
    "linux",
    (executable, args) => {
      calls.push({ executable, args });
      if (executable === "where.exe" && args[0] === "node") {
        return { status: 0, stdout: "D:\\nodejs\\node.exe\r\n", stderr: "" };
      }
      if (executable === "where.exe" && args[0] === "codex.cmd") {
        return { status: 0, stdout: "C:\\Users\\Lenovo\\AppData\\Roaming\\npm\\codex.cmd\r\n", stderr: "" };
      }
      return { status: 0, stdout: "codex-cli 0.144.1\n", stderr: "" };
    },
  );

  assert.deepEqual(calls, [
    { executable: "where.exe", args: ["node"] },
    { executable: "where.exe", args: ["codex.cmd"] },
    {
      executable: "/mnt/d/nodejs/node.exe",
      args: ["C:\\Users\\Lenovo\\AppData\\Roaming\\npm\\node_modules\\@openai\\codex\\bin\\codex.js", "--version"],
    },
  ]);
  assert.equal(worker.executable, "/mnt/d/nodejs/node.exe");
  assert.deepEqual(worker.prefixArgs, [
    "C:\\Users\\Lenovo\\AppData\\Roaming\\npm\\node_modules\\@openai\\codex\\bin\\codex.js",
  ]);
  assert.equal(worker.pathStyle, "windows");
});

test("native Linux retains the native Codex command", () => {
  const worker = resolveCodingWorker({}, "linux", () => {
    throw new Error("native Linux must not probe Windows Codex");
  });
  assert.deepEqual(worker, {
    executable: "codex",
    prefixArgs: [],
    identity: "codex-cli",
    pathStyle: "native",
  });
});

test("configured worker override is test-only and cannot replace the sandboxed worker in normal execution", () => {
  const command = JSON.stringify(["node", "fake-worker.js"]);
  assert.throws(
    () => resolveCodingWorker({ META_HARNESS_WORKER_COMMAND_JSON: command }, "linux", () => undefined),
    (error) => error.code === "MH_WORKER_CONFIG",
  );

  assert.deepEqual(
    resolveCodingWorker({
      META_HARNESS_TEST_MODE: "1",
      META_HARNESS_WORKER_COMMAND_JSON: command,
    }, "linux", () => undefined),
    {
      executable: "node",
      prefixArgs: ["fake-worker.js"],
      identity: "test-worker",
    },
  );
});
