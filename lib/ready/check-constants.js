"use strict";

const { SHIPGATE_CHECK_ID } = require("../ship-gate");

const REQUIRED_CHECK_IDS = new Set([
  "MH_SYNC_001",
  "MH_TRUST_001",
  "MH_CONTRACT_001",
  "MH_STATE_001",
  "MH_BRIEF_001",
  "MH_DECISION_001",
  "MH_QUALITY_001",
  "MH_GITCHECK_001",
  "MH_PACKAGE_001",
  "MH_SECURITY_001",
  "MH_NPM_SCRIPTS_001",
  "MH_REPRO_001",
  "MH_TEST_001",
  "MH_GITHUB_SETTINGS_001",
  SHIPGATE_CHECK_ID,
  "MH_READY_JSON_001"
]);

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
