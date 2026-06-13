"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const { stableJson, stateHash } = require("../lib/state-hash");

const FIXTURE_PATH = path.join(__dirname, "fixtures", "governance", "canonical-hash-fixtures.json");

test("canonical governance, evidence, and evaluation hash fixtures match stableJson output", () => {
  const fixtures = JSON.parse(fs.readFileSync(FIXTURE_PATH, "utf8"));

  for (const [name, fixture] of Object.entries(fixtures)) {
    assert.equal(stableJson(fixture.input), fixture.stable_json, name);
    assert.equal(stateHash(fixture.input), fixture.sha256, name);
  }
});
