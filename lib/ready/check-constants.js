"use strict";

const { READY_CHECK_IDS } = require("../check-id-registry");

const REQUIRED_CHECK_IDS = new Set(READY_CHECK_IDS);

const READY_CHECK_TIMEOUT_MS = Object.freeze({
  DEFAULT: 30000,
  MH_PACKAGE_001: 60000,
  MH_SECURITY_001: 30000,
  MH_TEST_001: 120000
});

function getReadyCheckTimeoutMs(checkId) {
  return READY_CHECK_TIMEOUT_MS[checkId] || READY_CHECK_TIMEOUT_MS.DEFAULT;
}

module.exports = {
  REQUIRED_CHECK_IDS,
  getReadyCheckTimeoutMs,
};
