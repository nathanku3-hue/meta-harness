"use strict";

const { isProtectedRepoDecisionPlanePath } = require("./repo-control-paths");
const repoProposalSet = require("./repo-proposal-set");
const repoWorkWave = require("./repo-work-wave");

// Active repository control-plane exports intentionally exclude legacy repo-decision/v3
// compilation. Historical Decision evidence remains readable through repo-decision-plane-v2.
module.exports = {
  ...repoProposalSet,
  ...repoWorkWave,
  isProtectedRepoDecisionPlanePath,
};
