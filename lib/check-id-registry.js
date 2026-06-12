"use strict";

const { SHIPGATE_CHECK_ID } = require("./ship-gate-constants");

const READY_CHECK_IDS = Object.freeze([
  "MH_BRIEF_001",
  "MH_CONTEXT_GATE_001",
  "MH_CONTRACT_001",
  "MH_DECISION_001",
  "MH_DOMAIN_GOVERNANCE_001",
  "MH_GITHUB_SETTINGS_001",
  "MH_GITCHECK_001",
  "MH_NPM_SCRIPTS_001",
  "MH_PACKAGE_001",
  "MH_QUALITY_001",
  "MH_READY_JSON_001",
  "MH_REPRO_001",
  "MH_STATE_ROOT_LEAK_001",
  "MH_SECURITY_001",
  SHIPGATE_CHECK_ID,
  "MH_STATE_001",
  "MH_SYNC_001",
  "MH_TEST_001",
  "MH_TRUST_001",
].sort((left, right) => left.localeCompare(right)));

const CHECK_ID_REGISTRY = Object.freeze(
  READY_CHECK_IDS.map((id) => Object.freeze({
    id,
    family: id.split("_")[1].toLowerCase(),
    owner: "nathanku3-hue",
    public: true,
    source: "ready",
  })),
);

function checkIdRegistry() {
  return CHECK_ID_REGISTRY.map((entry) => ({ ...entry }));
}

module.exports = {
  CHECK_ID_REGISTRY,
  READY_CHECK_IDS,
  checkIdRegistry,
};
