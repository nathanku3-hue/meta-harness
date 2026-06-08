"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { commandNames, commandRegistry, commandSpecs, renderHelp, resolveCommand } = require("../lib/command-registry");
const { checkIdRegistry } = require("../lib/check-id-registry");

test("command registry tracks canonical commands separately from aliases", () => {
  const names = commandNames();
  assert.deepEqual(new Set(names).size, names.length);
  assert.equal(names.includes("ready"), true);
  assert.equal(names.includes("sync"), true);
  assert.equal(names.includes("brief"), true);
  assert.equal(names.includes("skill"), true);
  assert.equal(names.includes("merge"), true);
  assert.equal(names.includes("release"), true);
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
  assert.deepEqual(commands.map((item) => item.name), commands.map((item) => item.name).toSorted());
  assert.equal(commands.every((item) => typeof item.owner === "string" && item.owner.length > 0), true);
  assert.equal(commands.every((item) => Object.hasOwn(item, "public")), true);

  const checks = checkIdRegistry();
  assert.deepEqual(checks.map((item) => item.id), checks.map((item) => item.id).toSorted());
  assert.equal(new Set(checks.map((item) => item.id)).size, checks.length);
  assert.equal(checks.every((item) => /^MH_[A-Z0-9_]+_\d{3}$/.test(item.id)), true);
});

test("help text is generated from registry usage lines", () => {
  const help = renderHelp();
  assert.match(help, /^meta-harness\n/);
  assert.match(help, /meta-harness ready --target <repo>/);
  assert.match(help, /meta-harness merge check --pr <n> --scope <scope>/);
  assert.match(help, /meta-harness skill check --target <repo>/);
  assert.match(help, /meta-harness release check \[--target <repo>\] \[--json\] \[--publish\]/);
  assert.match(help, /meta-harness decisions scan --target <repo>/);
  assert.match(help, /Streams: coding, research, writing, review/);
});
