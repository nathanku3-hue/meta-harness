"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { getReadyCheckTimeoutMs } = require("../lib/ready-check");

test("ready check gives npm tests a longer timeout than generic checks", () => {
  assert.equal(getReadyCheckTimeoutMs("MH_GITCHECK_001"), 30000);
  assert.equal(getReadyCheckTimeoutMs("MH_SECURITY_001"), 30000);
  assert.equal(getReadyCheckTimeoutMs("MH_PACKAGE_001"), 60000);
  assert.equal(getReadyCheckTimeoutMs("MH_TEST_001"), 120000);
  assert.ok(getReadyCheckTimeoutMs("MH_TEST_001") > getReadyCheckTimeoutMs("MH_GITCHECK_001"));
});
