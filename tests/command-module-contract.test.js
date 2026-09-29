"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { ROOT } = require("./helpers/cli");

const COMMANDS_DIR = path.join(ROOT, "lib", "commands");
const LIFECYCLE_PATTERN = /(?:\bnpm\s+(?:publish|pack|install|ci)\b|\b(?:prepublishOnly|prepare|prepack|postpack)\b)/;

test("command modules keep process and console side effects out of handlers", () => {
  for (const name of fs.readdirSync(COMMANDS_DIR).filter((file) => file.endsWith(".js"))) {
    const text = fs.readFileSync(path.join(COMMANDS_DIR, name), "utf8");
    assert.doesNotMatch(text, /process\.exit|process\.argv|process\.cwd|console\./, name);
    assert.doesNotMatch(text, /process\./, name);
  }
});

test("internal command modules do not retain the retired release/publication route", () => {
  assert.equal(fs.existsSync(path.join(COMMANDS_DIR, "release.js")), false);
  for (const name of fs.readdirSync(COMMANDS_DIR).filter((file) => file.endsWith(".js"))) {
    const text = fs.readFileSync(path.join(COMMANDS_DIR, name), "utf8");
    assert.doesNotMatch(text, LIFECYCLE_PATTERN, name);
    assert.doesNotMatch(text, /createReleaseCandidate|publishAndReconcile|verifyPublication/, name);
  }
});
