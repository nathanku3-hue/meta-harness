"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { commandNames, commandRegistry, commandSpecs, renderHelp, resolveCommand } = require("../lib/command-registry");
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
  assert.equal(names.includes("execute"), true);
  assert.equal(names.filter((name) => name === "execute").length, 1);
  assert.equal(names.includes("ready"), true);
  assert.equal(names.includes("sync"), true);
  assert.equal(names.includes("brief"), true);
  assert.equal(names.includes("skill"), true);
  assert.equal(names.includes("merge"), true);
  assert.equal(names.includes("release"), true);
  assert.equal(names.includes("context"), true);
  assert.equal(names.includes("governance"), true);
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
  assert.deepEqual(commands.filter((item) => item.public).map((item) => item.name), ["work"]);
  assert.equal(commands.filter((item) => item.internal).length, commands.length - 1);

  const checks = checkIdRegistry();
  assert.deepEqual(checks.map((item) => item.id), checks.map((item) => item.id).slice().sort());
  assert.equal(checks.length, 21);
  assert.equal(checks.some((item) => item.id === "MH_CONTEXT_GATE_001"), true);
  assert.equal(checks.some((item) => item.id === "MH_TRANSITION_GRAPH_001"), true);
  assert.equal(checks.some((item) => item.id === "MH_TRUTH_001"), true);
  assert.equal(new Set(checks.map((item) => item.id)).size, checks.length);
  assert.equal(checks.every((item) => /^MH_[A-Z0-9_]+_\d{3}$/.test(item.id)), true);
  assert.deepEqual(READY_CHECK_IDS, READY_INCLUDED_CHECK_IDS);
  assert.equal(STRICT_REQUIRED_CHECK_IDS.includes("MH_CONTEXT_GATE_001"), true);
  assert.equal(STRICT_REQUIRED_CHECK_IDS.includes("MH_TRUTH_001"), true);
  assert.equal(READY_INCLUDED_CHECK_IDS.includes("MH_TRANSITION_GRAPH_001"), true);
  assert.equal(STRICT_REQUIRED_CHECK_IDS.includes("MH_TRANSITION_GRAPH_001"), false);
  assert.notDeepEqual(READY_INCLUDED_CHECK_IDS, STRICT_REQUIRED_CHECK_IDS);
  const transitionGraph = checks.find((item) => item.id === "MH_TRANSITION_GRAPH_001");
  assert.equal(transitionGraph.includedInReady, true);
  assert.equal(transitionGraph.strictRequired, false);
  assert.equal(checks.every((item) => typeof item.includedInReady === "boolean"), true);
  assert.equal(checks.every((item) => typeof item.strictRequired === "boolean"), true);
});

test("default help is one product-facing coding journey and advanced help retains evidence tools", () => {
  const help = renderHelp();
  assert.match(help, /^meta-harness\n/);
  assert.match(help, /meta-harness work <repository> --goal <result>/);
  assert.doesNotMatch(help, /meta-harness execute --request/);
  assert.doesNotMatch(help, /meta-harness governance snapshot/);

  const advanced = renderHelp({ advanced: true });
  assert.match(advanced, /^meta-harness advanced commands/);
  assert.equal(
    advanced.split("meta-harness execute --request <absolute-path> [--json]").length - 1,
    1,
  );
  assert.match(advanced, /meta-harness ready --target <repo>/);
  assert.match(advanced, /meta-harness merge check --pr <n> --scope <scope>/);
  assert.match(advanced, /meta-harness skill check --target <repo>/);
  assert.match(advanced, /meta-harness release candidate <create\|verify-preterminal\|verify-publication>/);
  assert.match(advanced, /meta-harness governance snapshot \[--target <repo>\]/);
  assert.match(advanced, /meta-harness context packet <round-id> --for <review\|planning>/);
  assert.match(advanced, /Streams: coding, research, writing, review/);
});
