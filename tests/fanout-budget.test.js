"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  DEFAULT_FANOUT_BUDGET,
  assertScoutFanoutWithinBudget,
  normalizeFanoutBudget,
  validateScoutFanout,
} = require("../lib/fanout-budget");

test("default fanout budget matches phase 8 limits", () => {
  assert.deepEqual(DEFAULT_FANOUT_BUDGET, {
    max_concurrent_scouts: 3,
    max_context_per_scout_kb: 100,
    max_total_fanout_kb: 300,
    timeout_seconds: 120,
  });
  assert.deepEqual(normalizeFanoutBudget(), DEFAULT_FANOUT_BUDGET);
});

test("three 100KB scouts fit the default fanout budget", () => {
  const result = validateScoutFanout([
    { role: "repo-scout", context_budget_kb: 100 },
    { role: "security-scout", context_budget_kb: 100 },
    { role: "test-scout", context_budget_kb: 100 },
  ]);

  assert.equal(result.ok, true);
  assert.equal(result.scout_count, 3);
  assert.equal(result.total_context_kb, 300);
  assert.deepEqual(result.checks.map((check) => check.status), ["pass", "pass", "pass", "pass"]);
});

test("fanout budget blocks too many scouts or too much context", () => {
  const tooMany = validateScoutFanout([
    { role: "repo-scout", context_budget_kb: 1 },
    { role: "security-scout", context_budget_kb: 1 },
    { role: "test-scout", context_budget_kb: 1 },
    { role: "extra-scout", context_budget_kb: 1 },
  ]);
  assert.equal(tooMany.ok, false);
  assert.equal(tooMany.checks.find((check) => check.name === "max_concurrent_scouts").status, "fail");

  const tooLarge = validateScoutFanout([{ role: "repo-scout", context_budget_kb: 101 }]);
  assert.equal(tooLarge.ok, false);
  assert.equal(tooLarge.checks.find((check) => check.name === "max_context_per_scout_kb").status, "fail");

  assert.throws(() => assertScoutFanoutWithinBudget([{ role: "repo-scout", context_budget_kb: 301 }]), /fanout budget exceeded/);
});

test("fanout budget blocks scouts that exceed the timeout limit", () => {
  const tooLong = validateScoutFanout([
    { role: "repo-scout", timeout_seconds: 121 }
  ]);
  assert.equal(tooLong.ok, false);
  assert.equal(tooLong.checks.find((check) => check.name === "timeout_seconds").status, "fail");

  assert.throws(() => assertScoutFanoutWithinBudget([{ role: "repo-scout", timeout_seconds: 121 }]), /fanout budget exceeded/);
});

test("fanout budget rejects invalid numeric values", () => {
  assert.throws(() => normalizeFanoutBudget({ max_concurrent_scouts: 0 }), /positive integer/);
  assert.throws(() => validateScoutFanout([{ context_budget_kb: -1 }]), /positive integer/);
});
