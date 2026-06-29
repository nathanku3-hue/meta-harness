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

  const checks = checkIdRegistry();
  assert.deepEqual(checks.map((item) => item.id), checks.map((item) => item.id).slice().sort());
  assert.equal(checks.length, 20);
  assert.equal(checks.some((item) => item.id === "MH_CONTEXT_GATE_001"), true);
  assert.equal(checks.some((item) => item.id === "MH_TRANSITION_GRAPH_001"), true);
  assert.equal(new Set(checks.map((item) => item.id)).size, checks.length);
  assert.equal(checks.every((item) => /^MH_[A-Z0-9_]+_\d{3}$/.test(item.id)), true);
  assert.deepEqual(READY_CHECK_IDS, READY_INCLUDED_CHECK_IDS);
  assert.equal(STRICT_REQUIRED_CHECK_IDS.includes("MH_CONTEXT_GATE_001"), true);
  assert.equal(READY_INCLUDED_CHECK_IDS.includes("MH_TRANSITION_GRAPH_001"), true);
  assert.equal(STRICT_REQUIRED_CHECK_IDS.includes("MH_TRANSITION_GRAPH_001"), false);
  assert.notDeepEqual(READY_INCLUDED_CHECK_IDS, STRICT_REQUIRED_CHECK_IDS);
  const transitionGraph = checks.find((item) => item.id === "MH_TRANSITION_GRAPH_001");
  assert.equal(transitionGraph.includedInReady, true);
  assert.equal(transitionGraph.strictRequired, false);
  assert.equal(checks.every((item) => typeof item.includedInReady === "boolean"), true);
  assert.equal(checks.every((item) => typeof item.strictRequired === "boolean"), true);
});

test("help text is generated from registry usage lines", () => {
  const help = renderHelp();
  assert.match(help, /^meta-harness\n/);
  assert.match(help, /meta-harness ready --target <repo>/);
  assert.match(help, /meta-harness merge check --pr <n> --scope <scope>/);
  assert.match(help, /meta-harness skill check --target <repo>/);
  assert.match(help, /meta-harness skill preflight <skill-name> --target <repo> \[--json\]/);
  assert.match(help, /meta-harness skill promote <skill-name> --target <repo> --decision-id <id>/);
  assert.match(help, /meta-harness skill rollback <skill-name> --target <repo> --decision-id <id>/);
  assert.match(help, /meta-harness distill candidate <distillation-id> --target <repo>/);
  assert.match(help, /meta-harness release check \[--target <repo>\] \[--json\] \[--publish\]/);
  assert.match(help, /meta-harness governance snapshot \[--target <repo>\] \[--out <path>\] \[--json\]/);
  assert.match(help, /meta-harness governance diff \[--snapshot <path>\] \[--target <repo>\] \[--json\]/);
  assert.match(help, /meta-harness governance replay --snapshot <path> --artifact <path> --target <repo> \[--json\]/);
  assert.match(help, /meta-harness governance migration plan --spec <path> --snapshot <path> \[--json\]/);
  assert.match(help, /meta-harness governance migration apply --spec <path> --snapshot <path> --out <path> \[--json\]/);
  assert.match(help, /meta-harness governance migration verify --spec <path> --before <path> --after <path> \[--json\]/);
  assert.match(help, /meta-harness governance migration impact --spec <path> --snapshot <path> --artifacts-dir <path> \[--json\]/);
  assert.match(help, /meta-harness governance release check --release <path> --before <path> --snapshot <path> --migration <path> \[--artifacts-dir <path>\] \[--json\]/);
  assert.match(help, /meta-harness governance release report --release <path> \[--diff <path>\] \[--impact <path>\] \[--migration-verification <path>\] \[--out <path>\]/);
  assert.match(help, /meta-harness decisions scan --target <repo>/);
  assert.match(help, /meta-harness context check --from <phase> --to <phase>/);
  assert.match(help, /meta-harness context packet <round-id> --for <worker\|review\|planning>/);
  assert.match(help, /meta-harness context ask <round-id>/);
  assert.match(help, /Streams: coding, research, writing, review/);
});
