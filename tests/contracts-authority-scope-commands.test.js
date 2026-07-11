"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { evaluateScope, checkScope } = require("../lib/contracts/scope");

test("deny overrides allow", () => {
  const scope = {
    allow: ["src/**"],
    deny: ["src/secret/**"],
  };
  const r = checkScope(scope, [
    { status: "M", path: "src/a.js" },
    { status: "M", path: "src/secret/key.js" },
  ]);
  assert.equal(r.ok, false);
});

test("paths outside allow fail closed", () => {
  const r = checkScope(
    { allow: ["src/**"], deny: [] },
    [{ status: "M", path: "migrations/x.sql" }],
  );
  assert.equal(r.ok, false);
});

test("evaluateScope reports per-path decisions", () => {
  const out = evaluateScope(
    { allow: ["src/**"], deny: [] },
    [{ status: "M", path: "src/a.js" }],
  );
  assert.equal(out.allowed.length, 1);
  assert.equal(out.violations.length, 0);
  assert.equal(out.ambiguous.length, 0);
});
