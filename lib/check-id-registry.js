"use strict";

const { SHIPGATE_CHECK_ID } = require("./ship-gate-constants");

const READY_CHECKS = Object.freeze([
  { id: "MH_BRIEF_001", includedInReady: true, strictRequired: true },
  { id: "MH_CONTEXT_GATE_001", includedInReady: true, strictRequired: true },
  { id: "MH_CONTRACT_001", includedInReady: true, strictRequired: true },
  { id: "MH_DECISION_001", includedInReady: true, strictRequired: true },
  { id: "MH_DOMAIN_GOVERNANCE_001", includedInReady: true, strictRequired: true },
  { id: "MH_GITHUB_SETTINGS_001", includedInReady: true, strictRequired: true },
  { id: "MH_GITCHECK_001", includedInReady: true, strictRequired: true },
  { id: "MH_NPM_SCRIPTS_001", includedInReady: true, strictRequired: true },
  { id: "MH_PACKAGE_001", includedInReady: true, strictRequired: true },
  { id: "MH_QUALITY_001", includedInReady: true, strictRequired: true },
  { id: "MH_READY_JSON_001", includedInReady: true, strictRequired: true },
  { id: "MH_REPRO_001", includedInReady: true, strictRequired: true },
  { id: "MH_SECURITY_001", includedInReady: true, strictRequired: true },
  { id: SHIPGATE_CHECK_ID, includedInReady: true, strictRequired: true },
  { id: "MH_STATE_001", includedInReady: true, strictRequired: true },
  { id: "MH_STATE_ROOT_LEAK_001", includedInReady: true, strictRequired: true },
  { id: "MH_SYNC_001", includedInReady: true, strictRequired: true },
  { id: "MH_TEST_001", includedInReady: true, strictRequired: true },
  { id: "MH_TRANSITION_GRAPH_001", includedInReady: true, strictRequired: false },
  { id: "MH_TRUST_001", includedInReady: true, strictRequired: true },
  { id: "MH_TRUTH_001", includedInReady: true, strictRequired: true },
].sort((left, right) => left.id.localeCompare(right.id)).map((entry) => Object.freeze(entry)));

const READY_CHECK_IDS = Object.freeze(
  READY_CHECKS.map((entry) => entry.id)
);

const READY_INCLUDED_CHECK_IDS = Object.freeze(
  READY_CHECKS
    .filter((entry) => entry.includedInReady)
    .map((entry) => entry.id)
);

const STRICT_REQUIRED_CHECK_IDS = Object.freeze(
  READY_CHECKS
    .filter((entry) => entry.strictRequired)
    .map((entry) => entry.id)
);

const CHECK_ID_REGISTRY = Object.freeze(
  READY_CHECKS.map((check) => Object.freeze({
    ...check,
    family: check.id.split("_")[1].toLowerCase(),
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
  READY_CHECKS,
  READY_CHECK_IDS,
  READY_INCLUDED_CHECK_IDS,
  STRICT_REQUIRED_CHECK_IDS,
  checkIdRegistry,
};
