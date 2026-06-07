"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { UsageError } = require("../lib/errors");
const { optionValue, optionValues, parseArgs, requireTargetRoot } = require("../lib/cli-args");
const { tempDir } = require("./helpers/cli");

test("parseArgs preserves positionals booleans values and repeated options", () => {
  const parsed = parseArgs(["sync", "check", "--target", ".", "--read-only", "--include", "a", "--include", "b"]);
  assert.deepEqual(parsed.positional, ["sync", "check"]);
  assert.equal(parsed.options.target, ".");
  assert.equal(parsed.options.readOnly, true);
  assert.deepEqual(parsed.options.include, ["a", "b"]);
});

test("optionValue and optionValues normalize repeated and missing values", () => {
  assert.equal(optionValue(["first", "last"]), "last");
  assert.equal(optionValue(undefined, "fallback"), "fallback");
  assert.deepEqual(optionValues(["a", "b"]), ["a", "b"]);
  assert.deepEqual(optionValues("one"), ["one"]);
  assert.deepEqual(optionValues(true), []);
});

test("requireTargetRoot validates exactly one existing non-symlink directory", () => {
  const cwd = tempDir("meta-harness-args-");
  fs.mkdirSync(path.join(cwd, "target"));
  assert.equal(requireTargetRoot({ target: "target" }, { cwd }), path.join(cwd, "target"));
  assert.throws(() => requireTargetRoot({}, { cwd }), UsageError);
  assert.throws(() => requireTargetRoot({ target: ["a", "b"] }, { cwd }), /must be provided once/);
  assert.throws(() => requireTargetRoot({ target: "missing" }, { cwd }), /existing directory/);
});
