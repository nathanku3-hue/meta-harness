"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { ROOT, assertCliError, run, runRaw, tempDir } = require("./helpers/cli");

test("default help is the ghost journey while advanced help retains diagnostics", () => {
  const output = run(ROOT, ["--help"]);
  assert.match(output, /^meta-harness\n\nA coding system that carries one accepted product result/);
  assert.match(output, /meta-harness "<result>"/);
  assert.match(output, /continues the mechanically correct active work or stops/i);
  assert.doesNotMatch(output, /meta-harness worker-report/);
  assert.doesNotMatch(output, /meta-harness merge check/);

  const advanced = run(ROOT, ["help", "--advanced"]);
  assert.match(advanced, /^meta-harness diagnostics/);
  assert.match(advanced, /meta-harness inspect/);
  assert.match(advanced, /no advanced workflow console/i);
  assert.doesNotMatch(advanced, /worker-report|merge check|repos remove/);
});

test("normal surface rejects workflow controls while retained diagnostics keep typed errors", () => {
  const productError = runRaw(ROOT, ["--not-a-normal-work-flag"]);
  assert.equal(productError.status, 2);
  assert.equal(productError.stderr, "");
  assert.match(productError.stdout, /^Blocked: normal work accepts only a product result/i);
  assertCliError(runRaw(ROOT, ["work"], { productSurface: true }), "MH_USAGE", /'work' is internal; normal usage is meta-harness/i);
  assertCliError(runRaw(ROOT, ["sync"], { productSurface: true }), "MH_USAGE", /'sync' is internal; normal usage is meta-harness/i);
  assertCliError(runRaw(ROOT, ["merge"]), "MH_USAGE", /unknown merge action: missing/);
});

test("repo adoption commands are directly invokable without reopening the workflow console", () => {
  const cwd = tempDir("meta-harness-adoption-");
  const install = runRaw(cwd, ["templates", "install"], { productSurface: true });
  assert.equal(install.status, 0, install.stderr);
  const check = runRaw(cwd, ["sync", "check", "--target", cwd], { productSurface: true });
  assert.equal(check.status, 0, check.stderr || check.stdout);

  const help = run(ROOT, ["--help"]);
  assert.doesNotMatch(help, /templates install|sync check/);
  const advanced = run(ROOT, ["help", "--advanced"]);
  assert.doesNotMatch(advanced, /templates install|sync check/);
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
