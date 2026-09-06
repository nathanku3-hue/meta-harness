"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.resolve(__dirname, "..");

test("source checkout has no accidental nul shell artifact", () => {
  assert.equal(fs.existsSync(path.join(ROOT, "nul")), false);
});
