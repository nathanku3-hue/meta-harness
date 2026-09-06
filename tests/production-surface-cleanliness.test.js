"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.resolve(__dirname, "..");

test("retired repository Decision Plane modules are absent from production source", () => {
  for (const relativePath of [
    "lib/repo-decision.js",
    "lib/repo-decision-plane-v2.js",
    "lib/repo-decision-plane.js",
  ]) {
    assert.equal(fs.existsSync(path.join(ROOT, relativePath)), false, `${relativePath} must not remain in production`);
  }
});
