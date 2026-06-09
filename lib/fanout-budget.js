"use strict";

const { UsageError } = require("./errors");

const DEFAULT_FANOUT_BUDGET = Object.freeze({
  max_concurrent_scouts: 3,
  max_context_per_scout_kb: 100,
  max_total_fanout_kb: 300,
  timeout_seconds: 120,
});

function fail(message) {
  throw new UsageError(message);
}

function positiveInteger(value, name) {
  if (!Number.isInteger(value) || value <= 0) {
    fail(`${name} must be a positive integer`);
  }
  return value;
}

function normalizeFanoutBudget(input = {}) {
  const budget = {
    ...DEFAULT_FANOUT_BUDGET,
    ...input,
  };

  return {
    max_concurrent_scouts: positiveInteger(budget.max_concurrent_scouts, "max_concurrent_scouts"),
    max_context_per_scout_kb: positiveInteger(budget.max_context_per_scout_kb, "max_context_per_scout_kb"),
    max_total_fanout_kb: positiveInteger(budget.max_total_fanout_kb, "max_total_fanout_kb"),
    timeout_seconds: positiveInteger(budget.timeout_seconds, "timeout_seconds"),
  };
}

function scoutContextKb(scout) {
  return positiveInteger(scout.context_budget_kb ?? DEFAULT_FANOUT_BUDGET.max_context_per_scout_kb, "scout.context_budget_kb");
}

function validateScoutFanout(scouts, inputBudget = {}) {
  if (!Array.isArray(scouts)) {
    fail("scouts must be an array");
  }

  const budget = normalizeFanoutBudget(inputBudget);
  const checks = [];
  const totalContextKb = scouts.reduce((total, scout) => total + scoutContextKb(scout), 0);
  const maxScoutContextKb = scouts.reduce((max, scout) => Math.max(max, scoutContextKb(scout)), 0);
  const scoutCount = scouts.length;

  checks.push({
    name: "max_concurrent_scouts",
    status: scoutCount <= budget.max_concurrent_scouts ? "pass" : "fail",
    observed: scoutCount,
    limit: budget.max_concurrent_scouts,
  });
  checks.push({
    name: "max_context_per_scout_kb",
    status: maxScoutContextKb <= budget.max_context_per_scout_kb ? "pass" : "fail",
    observed: maxScoutContextKb,
    limit: budget.max_context_per_scout_kb,
  });
  checks.push({
    name: "max_total_fanout_kb",
    status: totalContextKb <= budget.max_total_fanout_kb ? "pass" : "fail",
    observed: totalContextKb,
    limit: budget.max_total_fanout_kb,
  });

  return {
    ok: checks.every((check) => check.status === "pass"),
    budget,
    scout_count: scoutCount,
    total_context_kb: totalContextKb,
    checks,
  };
}

function assertScoutFanoutWithinBudget(scouts, budget) {
  const result = validateScoutFanout(scouts, budget);
  if (!result.ok) {
    const failures = result.checks
      .filter((check) => check.status === "fail")
      .map((check) => `${check.name} observed ${check.observed} > limit ${check.limit}`)
      .join("; ");
    fail(`scout fanout budget exceeded: ${failures}`);
  }
  return result;
}

module.exports = {
  DEFAULT_FANOUT_BUDGET,
  assertScoutFanoutWithinBudget,
  normalizeFanoutBudget,
  validateScoutFanout,
};
