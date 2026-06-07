"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { ROOT, assertCliError, run, runRaw, tempDir } = require("./helpers/cli");

test("help output is registry generated and stable enough for operators", () => {
  const output = run(ROOT, ["--help"]);
  assert.match(output, /^meta-harness\n\nMarkdown-first Codex-native workflow visibility harness\./);
  assert.match(output, /meta-harness worker-report \[worker-id\]/);
  assert.match(output, /meta-harness repos remove <name>/);
});

test("unknown command and missing subcommand keep typed human errors", () => {
  assertCliError(runRaw(ROOT, ["unknown-command"]), "MH_USAGE", /unknown command: unknown-command/);
  assertCliError(runRaw(ROOT, ["sync"]), "MH_USAGE", /unknown sync action: missing/);
});

test("missing target keeps human error unless json mode is requested", () => {
  assertCliError(runRaw(ROOT, ["ready", "--target"]), "MH_USAGE", /--target requires an existing directory/);
});

test("json error mode writes exactly one JSON object to stdout", () => {
  const cwd = tempDir("meta-harness-json-error-");
  const result = runRaw(cwd, ["ready", "--target", "--json"]);
  assert.equal(result.status, 2);
  assert.equal(result.stderr, "");
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.schema_version, "1.0.0");
  assert.equal(parsed.ok, false);
  assert.equal(parsed.error.code, "MH_USAGE");
});
