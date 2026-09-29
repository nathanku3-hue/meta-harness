"use strict";

const { readOwnerObjectiveState } = require("./owner-objective-state");
const { readIntegrationHead } = require("./optimistic-integration");
const { pinProductDirection, projectProductDirectionForPlanner } = require("./product-direction");
const { listProfessionalSkillMetadata } = require("./professional-skill-catalog");

const REPO_PLANNER_INPUT_SCHEMA = "repo-planner-input/v5";

function ownerIntent(repositoryPath, productDirection) {
  const objective = readOwnerObjectiveState(repositoryPath, { optional: true });
  return Object.freeze({
    productFrame: projectProductDirectionForPlanner(productDirection),
    activeDirective: objective ? Object.freeze({
      revision: objective.revision,
      content: objective.content,
      contentDigest: objective.contentDigest,
      ...(objective.ingressDigest ? { ingressDigest: objective.ingressDigest } : {}),
    }) : null,
  });
}

function commitmentState(entry) {
  if (entry.type === "CLOSURE") return "closure_awaiting_integration";
  if (entry.type === "RUNNING_ELSEWHERE") return "running_elsewhere";
  if (entry.type === "EXTERNAL_OPEN") return "external_open";
  if (entry.type === "EXECUTABLE" && entry.continuation === "PENDING_WORKSPACE") return "pending";
  return "executable";
}

function projectActiveCommitments(recovered) {
  return Object.freeze(recovered.map((entry) => {
    const session = entry.session || null;
    return Object.freeze({
      runKey: entry.runKey || session?.sessionDigest || entry.closure?.sessionDigest || null,
      sessionDigest: session?.sessionDigest || entry.closure?.sessionDigest || null,
      outcomeDigest: entry.outcomeDigest || session?.origin?.outcomeDigest || entry.closure?.origin?.outcomeDigest || null,
      state: commitmentState(entry),
      productResult: session?.productResult || null,
      doneWhen: session?.doneWhen || null,
      allowedPaths: Object.freeze([...(session?.allowedPaths || [])]),
    });
  }));
}

function projectObservations(observations) {
  return Object.freeze((observations || []).map((entry) => Object.freeze({
    sessionDigest: entry.sessionDigest || null,
    outcomeDigest: entry.outcomeDigest || null,
    productResult: entry.productResult || null,
    outcome: entry.outcome || null,
    observableResult: entry.observableResult || null,
    blocker: entry.blocker || null,
    failedMeans: Object.freeze([...(entry.failedMeans || [])]),
  })));
}

function compileRepoPlannerInput({ repositoryPath, recovered = [], observations = [], evidence = [] }) {
  const productDirection = pinProductDirection(repositoryPath);
  const productCommit = readIntegrationHead(repositoryPath);
  return Object.freeze({
    schemaVersion: REPO_PLANNER_INPUT_SCHEMA,
    ownerIntent: ownerIntent(repositoryPath, productDirection),
    product: Object.freeze({ commit: productCommit }),
    activeCommitments: projectActiveCommitments(recovered),
    observations: projectObservations(observations),
    evidence: Object.freeze(JSON.parse(JSON.stringify(evidence || []))),
    professionalSkills: listProfessionalSkillMetadata(repositoryPath, { productCommit }),
  });
}

module.exports = {
  AUTONOMOUS_CONTINUATION_DISPOSITIONS: new Set(),
  REPO_PLANNER_INPUT_SCHEMA,
  compileRepoPlannerInput,
  latestUnresolvedHandoffs: () => Object.freeze([]),
};
