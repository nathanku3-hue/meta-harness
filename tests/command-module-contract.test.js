"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { ROOT } = require("./helpers/cli");

const COMMANDS_DIR = path.join(ROOT, "lib", "commands");
const ALLOWED_PROCESS_TEXT = new Set([]);
const LIFECYCLE_PATTERN = /\bnpm\s+(publish|pack|install|ci)|prepublishOnly|prepare|prepack|postpack/;

test("command modules keep process and console side effects out of handlers", () => {
  for (const name of fs.readdirSync(COMMANDS_DIR).filter((file) => file.endsWith(".js"))) {
    const text = fs.readFileSync(path.join(COMMANDS_DIR, name), "utf8");
    assert.doesNotMatch(text, /process\.exit|process\.argv|process\.cwd|console\./, name);
    if (!ALLOWED_PROCESS_TEXT.has(name)) {
      assert.doesNotMatch(text, /process\./, name);
    }
  }
});

test("command modules do not invoke npm lifecycle or publish paths", () => {
  for (const name of fs.readdirSync(COMMANDS_DIR).filter((file) => file.endsWith(".js"))) {
    const text = fs.readFileSync(path.join(COMMANDS_DIR, name), "utf8");
    assert.doesNotMatch(text, LIFECYCLE_PATTERN, name);
  }
});
