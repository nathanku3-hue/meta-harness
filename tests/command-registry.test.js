"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { commandNames, commandSpecs, renderHelp, resolveCommand } = require("../lib/command-registry");

test("command registry tracks canonical commands separately from aliases", () => {
  const names = commandNames();
  assert.deepEqual(new Set(names).size, names.length);
  assert.equal(names.includes("ready"), true);
  assert.equal(names.includes("sync"), true);
  assert.equal(names.includes("brief"), true);
  assert.equal(names.includes("skill"), true);
  assert.equal(commandSpecs.some((spec) => Array.isArray(spec.aliases) && spec.aliases.length > 0), false);
});

test("command registry resolves every canonical command to a function", () => {
  for (const name of commandNames()) {
    const resolved = resolveCommand([name]);
    assert.equal(typeof resolved.handler, "function", name);
    assert.equal(resolved.canonicalName, name);
  }
});

test("help text is generated from registry usage lines", () => {
  const help = renderHelp();
  assert.match(help, /^meta-harness\n/);
  assert.match(help, /meta-harness ready --target <repo>/);
  assert.match(help, /meta-harness skill check --target <repo>/);
  assert.match(help, /meta-harness decisions scan --target <repo>/);
  assert.match(help, /Streams: coding, research, writing, review/);
});
