"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { commandNames, commandRegistry, commandSpecs, renderHelp, resolveCommand } = require("../lib/command-registry");
const { isInternalCommandName } = require("../lib/product-command-surface");
const {
  READY_CHECK_IDS,
  READY_INCLUDED_CHECK_IDS,
  STRICT_REQUIRED_CHECK_IDS,
  checkIdRegistry,
} = require("../lib/check-id-registry");

test("command registry tracks canonical commands separately from aliases", () => {
  const names = commandNames();
  assert.deepEqual(new Set(names).size, names.length);
  assert.equal(names.includes("work"), true);
  for (const retired of ["execute", "release", "authority"]) {
    assert.equal(names.includes(retired), false, retired);
  }
  assert.equal(names.includes("ready"), true);
  assert.equal(names.includes("sync"), true);
  assert.equal(names.includes("brief"), true);
  assert.equal(names.includes("skill"), true);
  assert.equal(names.includes("merge"), true);
  for (const retired of ["context", "governance", "domain-governance"]) {
    assert.equal(names.includes(retired), false, retired);
    assert.equal(isInternalCommandName(retired), false, retired);
    assert.throws(() => resolveCommand([retired]), /unknown command/u, retired);
  }
  assert.equal(commandSpecs.some((spec) => Array.isArray(spec.aliases) && spec.aliases.length > 0), false);
});

test("command registry resolves every canonical command to a function", () => {
  for (const name of commandNames()) {
    const resolved = resolveCommand([name]);
    assert.equal(typeof resolved.handler, "function", name);
    assert.equal(resolved.canonicalName, name);
  }
});

test("public command and check registries are deterministic metadata surfaces", () => {
  const commands = commandRegistry();
  assert.deepEqual(commands.map((item) => item.name), commands.map((item) => item.name).slice().sort());
  assert.equal(commands.every((item) => typeof item.owner === "string" && item.owner.length > 0), true);
  assert.equal(commands.every((item) => Object.hasOwn(item, "public")), true);
  assert.deepEqual(commands.filter((item) => item.public).map((item) => item.name), []);
  assert.equal(commands.filter((item) => item.internal).length, commands.length);

  const checks = checkIdRegistry();
  assert.deepEqual(checks.map((item) => item.id), checks.map((item) => item.id).slice().sort());
  assert.equal(checks.length, 18);
  for (const retired of ["MH_CONTEXT_GATE_001", "MH_TRANSITION_GRAPH_001", "MH_DOMAIN_GOVERNANCE_001"]) {
    assert.equal(checks.some((item) => item.id === retired), false, retired);
  }
  assert.equal(checks.some((item) => item.id === "MH_TRUTH_001"), true);
  assert.equal(new Set(checks.map((item) => item.id)).size, checks.length);
  assert.equal(checks.every((item) => /^MH_[A-Z0-9_]+_\d{3}$/.test(item.id)), true);
  assert.deepEqual(READY_CHECK_IDS, READY_INCLUDED_CHECK_IDS);
  assert.equal(STRICT_REQUIRED_CHECK_IDS.includes("MH_TRUTH_001"), true);
  assert.deepEqual(READY_INCLUDED_CHECK_IDS, STRICT_REQUIRED_CHECK_IDS);
  assert.equal(checks.every((item) => typeof item.includedInReady === "boolean"), true);
  assert.equal(checks.every((item) => typeof item.strictRequired === "boolean"), true);
});

test("human help exposes the ghost journey and no lifecycle console", () => {
  const help = renderHelp();
  assert.match(help, /^meta-harness\n/);
  assert.match(help, /meta-harness "<result>"/);
  assert.match(help, /meta-harness inspect/);
  assert.doesNotMatch(help, /--goal|--resume|--session|--allow|--base|--commit|--json/);
  assert.doesNotMatch(help, /meta-harness execute|meta-harness governance|meta-harness ready/);

  const advanced = renderHelp({ advanced: true });
  assert.match(advanced, /^meta-harness diagnostics/);
  assert.match(advanced, /meta-harness inspect/);
  assert.match(advanced, /no advanced workflow console/i);
  assert.doesNotMatch(advanced, /meta-harness execute|meta-harness ready|meta-harness merge|meta-harness governance/);
});
