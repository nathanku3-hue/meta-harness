"use strict";

const assert = require("node:assert/strict");

const { version: CURRENT_PACKAGE_VERSION } = require("../../package.json");

function nextMinorVersion(version = CURRENT_PACKAGE_VERSION) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(version));
  assert.ok(match, `package version must be strict semver: ${version}`);
  return `${match[1]}.${Number(match[2]) + 1}.0`;
}

const NEXT_MINOR_VERSION = nextMinorVersion();

module.exports = {
  CURRENT_PACKAGE_VERSION,
  NEXT_MINOR_VERSION,
  nextMinorVersion,
};
