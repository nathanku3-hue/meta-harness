"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { run, runRaw } = require("./helpers/cli");

const FIXTURE_ROOT = path.join(__dirname, "fixtures", "context-gate");

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "meta-harness-cli-context-"));
}

function copyFixture(name) {
  const targetRoot = tempDir();
  fs.cpSync(path.join(FIXTURE_ROOT, name), targetRoot, { recursive: true });
  return targetRoot;
}

function writeFile(root, relativePath, content) {
  const filePath = path.join(root, ...relativePath.split("/"));
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf8");
}

function unwrapGateEnvelope(value) {
  return value.output || value.gate || value.context || value;
}

function writePrebuiltGate(root) {
  const output = fs.readFileSync(path.join(FIXTURE_ROOT, "outputs", "ROUND-001.json"), "utf8");
  writeFile(root, ".meta-harness/local/context/ROUND-001.json", output);
}

test("context check emits valid JSON and writes local ignored artifacts by default", () => {
  const cwd = copyFixture("complete");

  const stdout = run(cwd, ["context", "check", "--from", "plan", "--to", "work", "--json"]);
  const gate = unwrapGateEnvelope(JSON.parse(stdout));

  assert.equal(gate.transition, "plan->work");
  assert.match(gate.round_id, /^ROUND-[0-9]{3,}$/);
  assert.equal(typeof gate.overall_score, "number");
  assert.ok(["blocked", "narrowed", "proceed", "excellent"].includes(gate.verdict));

  const contextDir = path.join(cwd, ".meta-harness", "local", "context");
  const jsonOutputs = fs.readdirSync(contextDir).filter((name) => /^ROUND-\d+\.json$/.test(name));
  const mdOutputs = fs.readdirSync(contextDir).filter((name) => /^ROUND-\d+\.md$/.test(name));
  assert.equal(jsonOutputs.length >= 1, true);
  assert.equal(mdOutputs.length >= 1, true);
});

test("context packet emits a JSON envelope with compact packet markdown", () => {
  const cwd = copyFixture("complete");
  writePrebuiltGate(cwd);

  const stdout = run(cwd, ["context", "packet", "ROUND-001", "--for", "worker", "--json"]);
  const data = JSON.parse(stdout);

  assert.equal(data.round_id, "ROUND-001");
  assert.equal(data.for, "worker");
  assert.equal(typeof data.packet_markdown, "string");
  assert.match(data.packet_markdown, /Goal/i);
  assert.match(data.packet_markdown, /Evidence/i);
  assert.equal(data.packet_markdown.length < 12000, true);
});

test("context ask returns at most three blocker-clearing questions", () => {
  const cwd = copyFixture("complete");
  writePrebuiltGate(cwd);

  const stdout = run(cwd, ["context", "ask", "ROUND-001", "--json"]);
  const data = JSON.parse(stdout);

  assert.equal(data.round_id, "ROUND-001");
  assert.ok(Array.isArray(data.questions));
  assert.equal(data.questions.length <= 3, true);
});

test("context check rejects invalid phase transitions", () => {
  const cwd = copyFixture("complete");

  const res = runRaw(cwd, ["context", "check", "--from", "plan", "--to", "launch", "--json"]);

  assert.notEqual(res.status, 0);
  assert.match(`${res.stdout}\n${res.stderr}`, /invalid|transition|phase/i);
});

test("context packet requires a round id", () => {
  const cwd = copyFixture("complete");

  const res = runRaw(cwd, ["context", "packet", "--for", "worker", "--json"]);

  assert.notEqual(res.status, 0);
  assert.match(`${res.stdout}\n${res.stderr}`, /round/i);
});

test("context commit-artifact refuses redaction failures before tracked writes", () => {
  const cwd = copyFixture("unsafe-commit");

  const res = runRaw(cwd, [
    "context",
    "check",
    "--from",
    "plan",
    "--to",
    "work",
    "--round",
    "ROUND-001",
    "--commit-artifact",
    "--json",
  ]);

  assert.notEqual(res.status, 0);
  assert.match(`${res.stdout}\n${res.stderr}`, /redaction|secret-like|BEARER_TOKEN/i);
  assert.equal(fs.existsSync(path.join(cwd, ".meta-harness", "context", "ROUND-001.json")), false);
});

test("context check rejects tracked output paths without commit-artifact", () => {
  const cwd = copyFixture("complete");

  const res = runRaw(cwd, [
    "context",
    "check",
    "--from",
    "plan",
    "--to",
    "work",
    "--round",
    "ROUND-001",
    "--out",
    ".meta-harness/context/ROUND-001.json",
  ]);

  assert.notEqual(res.status, 0);
  assert.match(`${res.stdout}\n${res.stderr}`, /commit-artifact|tracked context|\.meta-harness\/context/i);
  assert.equal(fs.existsSync(path.join(cwd, ".meta-harness", "context", "ROUND-001.json")), false);
});
