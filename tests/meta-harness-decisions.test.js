"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");
const { _test } = require("../lib/decisions");

const ROOT = path.resolve(__dirname, "..");
const CLI = path.join(ROOT, "bin", "meta-harness.js");

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "meta-harness-decisions-"));
}

function run(cwd, args) {
  const result = spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`Command failed: ${args.join(" ")}\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`);
  }
  return result.stdout;
}

function runRaw(cwd, args) {
  return spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: "utf8" });
}

function git(cwd, args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  assert.equal(result.status, 0, `git ${args.join(" ")}\n${result.stderr}`);
}

function initGitRepo(cwd) {
  git(cwd, ["init"]);
  git(cwd, ["config", "user.email", "test@example.com"]);
  git(cwd, ["config", "user.name", "Test User"]);
}

function writeFile(cwd, relativePath, text) {
  const fullPath = path.join(cwd, relativePath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, text, "utf8");
}

function readJson(cwd, relativePath) {
  return JSON.parse(fs.readFileSync(path.join(cwd, relativePath), "utf8"));
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

function commitBaseline(cwd) {
  writeFile(cwd, "src/owned.js", "const owned = 1;\n");
  writeFile(cwd, "src/pass.js", "const pass = 1;\n");
  writeFile(cwd, "notes/user-note.md", "baseline\n");
  git(cwd, ["add", "."]);
  git(cwd, ["commit", "-m", "baseline"]);
}

function writeScope(cwd, body) {
  writeFile(cwd, ".meta-harness/scope.json", `${JSON.stringify(body, null, 2)}\n`);
}

function classify(cwd, out = ".meta-harness/dirty-work.json") {
  return run(cwd, [
    "dirty", "classify",
    "--before", ".meta-harness/snapshots/before.json",
    "--after", ".meta-harness/snapshots/after.json",
    "--scope", ".meta-harness/scope.json",
    "--out", out,
  ]);
}

function snapshot(cwd, name) {
  run(cwd, ["dirty", "snapshot", "--out", `.meta-harness/snapshots/${name}.json`]);
}

test("dirty DECISION imports are memoized and resolved same-state decisions stay resolved", () => {
  const cwd = tempDir();
  initGitRepo(cwd);
  commitBaseline(cwd);
  writeFile(cwd, "src/owned.js", "pre-existing owned edit\n");
  snapshot(cwd, "before");
  snapshot(cwd, "after");
  writeScope(cwd, { owned_paths: ["src/owned.js"] });

  classify(cwd);
  const firstDirty = readJson(cwd, ".meta-harness/dirty-work.json")
    .classifications.find((item) => item.path === "src/owned.js");
  const firstInbox = readJson(cwd, ".meta-harness/decision-inbox.json");
  assert.equal(firstInbox.decisions.length, 1);
  assert.equal(firstInbox.decisions[0].kind, "user_decision");
  assert.equal(firstInbox.decisions[0].state_hash, firstDirty.decision_state_hash);
  assert.match(firstInbox.decisions[0].identity_hash, /^[a-f0-9]{64}$/);

  const decisionId = firstInbox.decisions[0].id;
  run(cwd, ["decisions", "resolve", "--id", decisionId, "--resolution", "approved"]);
  classify(cwd, ".meta-harness/dirty-work-renamed-evidence.json");
  const reusedInbox = readJson(cwd, ".meta-harness/decision-inbox.json");
  assert.equal(reusedInbox.decisions.length, 1);
  assert.equal(reusedInbox.decisions[0].status, "approved");
  assert.match(reusedInbox.decisions[0].evidence.join("\n"), /dirty-work-renamed-evidence\.json/);
  assert.doesNotMatch(run(cwd, ["decisions", "list"]), new RegExp(decisionId));

  writeScope(cwd, { owned_paths: ["src/owned.js"], generated_paths: ["dist/"] });
  classify(cwd);
  const nextInbox = readJson(cwd, ".meta-harness/decision-inbox.json");
  assert.equal(nextInbox.decisions.length, 2);
  assert.equal(nextInbox.decisions.filter((decision) => decision.status === "open").length, 1);
});

test("dirty classify imports only DECISION items and PM brief suppresses raw dirty noise", () => {
  const cwd = tempDir();
  initGitRepo(cwd);
  commitBaseline(cwd);
  writeFile(cwd, "src/owned.js", "pre-existing owned edit\n");
  writeFile(cwd, "notes/user-note.md", "pre-existing user edit\n");
  snapshot(cwd, "before");
  writeFile(cwd, "src/pass.js", "const pass = 2;\n");
  writeFile(cwd, "dist/bundle.js", "generated\n");
  writeFile(cwd, "outside.js", "outside\n");
  writeFile(cwd, ".env.local", "DO_NOT_READ=1\n");
  git(cwd, ["add", "outside.js"]);
  snapshot(cwd, "after");
  writeScope(cwd, { owned_paths: ["src/"], generated_paths: ["dist/"] });
  classify(cwd);

  const dirty = readJson(cwd, ".meta-harness/dirty-work.json");
  assert.equal(dirty.classifications.find((item) => item.path === "src/owned.js").action, "DECISION");
  assert.equal(dirty.classifications.find((item) => item.path === "dist/bundle.js").action, "QUEUE");
  assert.equal(dirty.classifications.find((item) => item.path === "outside.js").action, "BLOCK");
  assert.equal(dirty.classifications.find((item) => item.path === ".env.local").action, "ESCALATE");
  assert.equal(dirty.classifications.find((item) => item.path === "src/pass.js").action, "PASS");

  const inbox = readJson(cwd, ".meta-harness/decision-inbox.json");
  assert.equal(inbox.decisions.length, 1);
  assert.match(inbox.decisions[0].question, /src\/owned\.js/);
  assert.doesNotMatch(inbox.decisions[0].question, /dist\/bundle\.js|outside\.js|\.env\.local|src\/pass\.js/);

  const brief = run(cwd, [
    "brief", "pm",
    "--dirty", ".meta-harness/dirty-work.json",
    "--decisions", ".meta-harness/decision-inbox.json",
    "--out", ".meta-harness/pm-brief.md",
  ]);
  assert.match(brief, /Open decisions: 1/);
  assert.match(brief, /BLOCK: outside\.js/);
  assert.match(brief, /ESCALATE: \.env\.local/);
  assert.match(brief, /Queued items: /);
  assert.match(brief, /Suppressed items: /);
  assert.doesNotMatch(brief, /dist\/bundle\.js/);
  assert.doesNotMatch(brief, /notes\/user-note\.md/);
  assert.doesNotMatch(brief, /src\/pass\.js/);
});

test("decision and brief commands resolve repo-root paths and reject bad CLI values", () => {
  const cwd = tempDir();
  initGitRepo(cwd);
  commitBaseline(cwd);
  run(cwd, [
    "decisions", "add",
    "--kind", "user_decision",
    "--question", "Approve the bounded scope?",
    "--state-hash", "source-state-1",
  ]);
  writeFile(cwd, ".meta-harness/dirty-work.json", `${JSON.stringify({
    v: 1,
    state_hash: "dirty-state",
    summary: { queued: 0, suppressed: 0, decisions: 1, blockers: 0, escalations: 0 },
    classifications: [],
  }, null, 2)}\n`);
  const subdir = path.join(cwd, "src", "nested");
  fs.mkdirSync(subdir, { recursive: true });
  assert.match(run(subdir, ["decisions", "list", "--in", ".meta-harness/decision-inbox.json"]), /Approve the bounded scope/);
  run(subdir, [
    "brief", "pm",
    "--dirty", ".meta-harness/dirty-work.json",
    "--decisions", ".meta-harness/decision-inbox.json",
    "--out", ".meta-harness/pm-brief.md",
  ]);
  assert.equal(fs.existsSync(path.join(cwd, ".meta-harness", "pm-brief.md")), true);
  assertCliError(
    runRaw(subdir, ["brief", "pm", "--dirty", ".meta-harness/dirty-work.json", "--decisions", ".meta-harness/decision-inbox.json", "--out", "../escape.md"]),
    /--out must stay inside the repository root/,
  );
  assertCliError(
    runRaw(cwd, ["decisions", "list", "--in", ""]),
    /decision inbox requires a value/,
  );
  assertCliError(
    runRaw(cwd, ["brief", "pm", "--dirty", "", "--decisions", ".meta-harness/decision-inbox.json", "--out", ".meta-harness/pm-brief.md"]),
    /--dirty requires a value/,
  );
  assertCliError(
    runRaw(cwd, ["brief", "pm", "--dirty", ".meta-harness/dirty-work.json", "--decisions", "", "--out", ".meta-harness/pm-brief.md"]),
    /--decisions requires a value/,
  );
  assertCliError(
    runRaw(cwd, ["brief", "pm", "--dirty", ".meta-harness/dirty-work.json", "--decisions", ".meta-harness/decision-inbox.json", "--out", ""]),
    /--out requires a value/,
  );
  assertCliError(
    runRaw(cwd, ["decisions", "add", "--kind", "--question", "broken", "--state-hash", "hash"]),
    /--kind requires a value/,
  );
});

test("inbox validation fails closed for invalid status missing state hash and duplicates", () => {
  const cwd = tempDir();
  initGitRepo(cwd);
  commitBaseline(cwd);

  writeFile(cwd, ".meta-harness/decision-inbox.json", `${JSON.stringify({
    v: 1,
    decisions: [{
      id: "D-invalid",
      kind: "user_decision",
      question: "Approve invalid?",
      recommended: "hold",
      state_hash: "state-invalid",
      reask_when: "source changes",
      status: "maybe",
    }],
  }, null, 2)}\n`);
  assertCliError(runRaw(cwd, ["decisions", "list"]), /invalid decision status/);

  writeFile(cwd, ".meta-harness/decision-inbox.json", `${JSON.stringify({
    v: 1,
    decisions: [{
      id: "D-missing",
      kind: "user_decision",
      question: "Approve missing state?",
      recommended: "hold",
      status: "open",
    }],
  }, null, 2)}\n`);
  assertCliError(runRaw(cwd, ["decisions", "list"]), /decision state hash requires a value/);

  const duplicate = {
    kind: "user_decision",
    question: "Approve duplicate?",
    recommended: "hold",
    state_hash: "state-dup",
    reask_when: "source changes",
    status: "open",
  };
  writeFile(cwd, ".meta-harness/decision-inbox.json", `${JSON.stringify({
    v: 1,
    decisions: [{ ...duplicate, id: "D-one" }, { ...duplicate, id: "D-one" }],
  }, null, 2)}\n`);
  assertCliError(runRaw(cwd, ["decisions", "list"]), /duplicate decision id/);

  writeFile(cwd, ".meta-harness/decision-inbox.json", `${JSON.stringify({
    v: 1,
    decisions: [{ ...duplicate, id: "D-one" }, { ...duplicate, id: "D-two" }],
  }, null, 2)}\n`);
  assertCliError(runRaw(cwd, ["decisions", "list"]), /duplicate decision state_hash/);
});

test("PM brief is bounded and templates include decision router artifacts", () => {
  const cwd = tempDir();
  initGitRepo(cwd);
  commitBaseline(cwd);
  for (let index = 0; index < 12; index += 1) {
    run(cwd, [
      "decisions", "add",
      "--kind", "user_decision",
      "--question", `Approve generated decision ${index}?`,
      "--state-hash", `state-${index}`,
    ]);
  }
  writeFile(cwd, ".meta-harness/dirty-work.json", `${JSON.stringify({
    v: 1,
    state_hash: "dirty-state-bounded",
    summary: { queued: 12, suppressed: 12, decisions: 12, blockers: 12, escalations: 0 },
    classifications: Array.from({ length: 12 }, (_, index) => ({
      path: `blocked/path-${index}.js`,
      action: "BLOCK",
      classification: "agent_created_outside_scope",
    })).concat(Array.from({ length: 12 }, (_, index) => ({
      path: `queued/noise-${index}.js`,
      action: "QUEUE",
      classification: "generated_cache_artifact",
    }))),
  }, null, 2)}\n`);
  const brief = run(cwd, [
    "brief", "pm",
    "--dirty", ".meta-harness/dirty-work.json",
    "--decisions", ".meta-harness/decision-inbox.json",
    "--out", ".meta-harness/pm-brief.md",
  ]);
  assert.match(brief, /Open decisions: 12/);
  assert.match(brief, /\.\.\. and 2 more/);
  assert.match(brief, /Queued items: 12/);
  assert.match(brief, /Suppressed items: 12/);
  assert.doesNotMatch(brief, /queued\/noise-/);

  const list = run(cwd, ["templates", "list"]);
  assert.match(list, /contracts\s+decision-inbox-contract\.md/);
  assert.match(list, /skills\s+ship-fast-decision-router\.md/);
  run(cwd, ["init", "Install decision templates"]);
  run(cwd, ["templates", "install"]);
  assert.equal(fs.existsSync(path.join(cwd, ".meta-harness", "templates", "contracts", "decision-inbox-contract.md")), true);
  assert.equal(fs.existsSync(path.join(cwd, ".meta-harness", "templates", "skills", "ship-fast-decision-router.md")), true);
});

test("decision id generation lengthens prefix collisions and fails full-hash collisions", () => {
  const identityHash = `${"a".repeat(10)}${"b".repeat(54)}`;
  const nextId = _test.makeDecisionId(identityHash, "identity:new", [{
    id: `D-${"a".repeat(10)}`,
    identity_hash: `${"a".repeat(10)}${"c".repeat(54)}`,
    identity_key: "identity:other-prefix",
  }]);
  assert.equal(nextId, `D-${"a".repeat(10)}b`);
  assert.throws(
    () => _test.makeDecisionId(identityHash, "identity:new", [{
      id: `D-${identityHash}`,
      identity_hash: identityHash,
      identity_key: "identity:other-full-hash",
    }]),
    /decision identity hash collision detected/,
  );
});
