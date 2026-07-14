"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const commandExecute = require("../lib/commands/execute");
const {
  FileSystemError,
  QualityGateError,
  UsageError,
} = require("../lib/errors");
const { ROOT, assertCliError, runRaw } = require("./helpers/cli");

const ABSOLUTE_REQUEST = path.resolve(ROOT, "request.json");

function captureContext() {
  let stdout = "";
  let stderr = "";
  return {
    context: {
      stdout: { write(value) { stdout += String(value); } },
      stderr: { write(value) { stderr += String(value); } },
    },
    stdout() { return stdout; },
    stderr() { return stderr; },
  };
}

test("execute parser accepts exactly one absolute request and optional json flag", () => {
  assert.deepEqual(commandExecute.parseExecuteArgs(["--request", ABSOLUTE_REQUEST]), {
    requestPath: ABSOLUTE_REQUEST,
    json: false,
  });
  assert.deepEqual(commandExecute.parseExecuteArgs(["--json", "--request", ABSOLUTE_REQUEST]), {
    requestPath: ABSOLUTE_REQUEST,
    json: true,
  });
});

test("execute parser rejects permissive duplicate, value, positional, and relative forms", () => {
  const invalid = [
    { argv: [], pattern: /requires --request/ },
    { argv: ["--request"], pattern: /requires an absolute path value/ },
    { argv: ["--request", "relative.json"], pattern: /absolute normalized path/ },
    { argv: ["--request", ABSOLUTE_REQUEST, "--request", ABSOLUTE_REQUEST], pattern: /exactly once/ },
    { argv: ["--request", ABSOLUTE_REQUEST, "--json", "--json"], pattern: /at most once/ },
    { argv: ["--request", ABSOLUTE_REQUEST, "--json=true"], pattern: /unknown execute option/ },
    { argv: ["--request", ABSOLUTE_REQUEST, "--json", "true"], pattern: /unexpected execute positional/ },
    { argv: ["--request", ABSOLUTE_REQUEST, "--unknown"], pattern: /unknown execute option/ },
    { argv: ["positional", "--request", ABSOLUTE_REQUEST], pattern: /unexpected execute positional/ },
  ];
  for (const item of invalid) {
    assert.throws(
      () => commandExecute.parseExecuteArgs(item.argv),
      (error) => error instanceof UsageError && item.pattern.test(error.message),
      item.argv.join(" "),
    );
  }
});

test("execute errors map into the stable exit categories without rewriting the global framework", () => {
  const usage = commandExecute.mapExecutionError(Object.assign(new Error("bad request"), {
    code: "CUSTODY_EXECUTION_REQUEST",
  }));
  assert.equal(usage instanceof UsageError, true);
  assert.equal(usage.exitCode, 2);
  assert.equal(usage.code, "CUSTODY_EXECUTION_REQUEST");

  const filesystem = commandExecute.mapExecutionError(Object.assign(new Error("unsafe root"), {
    code: "CUSTODY_EXECUTION_ROOT_EXISTS",
  }));
  assert.equal(filesystem instanceof FileSystemError, true);
  assert.equal(filesystem.exitCode, 3);
  assert.equal(filesystem.code, "CUSTODY_EXECUTION_ROOT_EXISTS");

  const quality = commandExecute.mapExecutionError(Object.assign(new Error("verification failed"), {
    code: "CUSTODY_EXECUTION_EXPORT",
  }));
  assert.equal(quality instanceof QualityGateError, true);
  assert.equal(quality.exitCode, 1);
  assert.equal(quality.code, "CUSTODY_EXECUTION_EXPORT");
});

test("execute human success output is bounded and operational", () => {
  const capture = captureContext();
  commandExecute.printHuman(capture.context, {
    verifiedHeadRevision: "a".repeat(40),
    durableRef: `refs/meta-harness/attempts/${"b".repeat(64)}`,
    receiptPath: ABSOLUTE_REQUEST,
    portableExportPath: path.resolve(ROOT, "portable"),
  });
  assert.equal(capture.stderr(), "");
  assert.equal(capture.stdout(), [
    "VERIFIED",
    `Child commit: ${"a".repeat(40)}`,
    `Durable ref: refs/meta-harness/attempts/${"b".repeat(64)}`,
    `Receipt: ${ABSOLUTE_REQUEST}`,
    `Portable export: ${path.resolve(ROOT, "portable")}`,
    "REPLAY: confirmed, zero spawns",
    "",
  ].join("\n"));
});

test("CLI usage failures retain exact exit 2 in human and one-document JSON modes", () => {
  assertCliError(
    runRaw(ROOT, ["execute"]),
    "MH_USAGE",
    /execute requires --request <absolute-path>/,
  );
  const json = runRaw(ROOT, ["execute", "--request", "relative.json", "--json"]);
  assert.equal(json.status, 2);
  assert.equal(json.stderr, "");
  const parsed = JSON.parse(json.stdout);
  assert.equal(parsed.ok, false);
  assert.equal(parsed.error.code, "MH_USAGE");
  assert.match(parsed.error.message, /absolute normalized path/);
  assert.equal(json.stdout.trim().split(/\r?\n/).filter(Boolean).length > 0, true);
});
