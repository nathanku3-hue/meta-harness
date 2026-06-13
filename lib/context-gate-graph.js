"use strict";

const fs = require("node:fs");
const path = require("node:path");

const { PHASES } = require("./harness-state");
const {
  ALLOWED_TRANSITIONS,
  OPTIONAL_GATE_TRANSITIONS,
  REQUIRED_GATE_TRANSITIONS,
} = require("./context-gate-constants");
const { PHASE_TO_EXPECTED_TRANSITION } = require("./context-gate-adoption");
const { contextGateGovernance } = require("./context-gate-utils");

const CONTRACT_RELATIVE_PATH = path.join("templates", "contracts", "context-adoption-contract.md");

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value instanceof Set) return Array.from(value);
  return [];
}

function uniqueSorted(items) {
  return Array.from(new Set(items)).sort((left, right) => left.localeCompare(right));
}

function adjacentTransitions(phases) {
  const transitions = [];
  for (let index = 0; index < phases.length - 1; index += 1) {
    transitions.push(`${phases[index]}->${phases[index + 1]}`);
  }
  return transitions;
}

function transitionFrom(transition) {
  return typeof transition === "string" ? transition.split("->")[0] : "";
}

function transitionTo(transition) {
  return typeof transition === "string" ? transition.split("->")[1] : "";
}

function sameMembers(left, right) {
  return left.length === right.length && left.every((item, index) => item === right[index]);
}

function issue(severity, code, message, details = {}) {
  return { severity, code, message, ...details };
}

function compareSet({ actual, expected, code, label }) {
  const actualSorted = uniqueSorted(actual);
  const expectedSorted = uniqueSorted(expected);
  if (sameMembers(actualSorted, expectedSorted)) return [];
  return [issue("fail", code, `${label} must match the canonical phase graph`, {
    expected: expectedSorted,
    actual: actualSorted,
  })];
}

function parseContractTransitions(contractText) {
  const transitionPattern = /`([a-z]+->[a-z]+)`/g;
  const transitions = [];
  let match;
  while ((match = transitionPattern.exec(contractText)) !== null) {
    transitions.push(match[1]);
  }
  return transitions;
}

function sectionText(contractText, heading) {
  const start = contractText.indexOf(heading);
  if (start === -1) return "";
  const rest = contractText.slice(start + heading.length);
  const nextHeading = rest.search(/\n[A-Z][^\n]+:\s*\n/);
  return nextHeading === -1 ? rest : rest.slice(0, nextHeading);
}

function contractDriftIssues({
  contractText,
  allowedTransitions,
  requiredTransitions,
  optionalTransitions,
}) {
  if (typeof contractText !== "string") {
    return [issue("warn", "contract_missing", "packaged context adoption contract could not be read")];
  }

  const issues = [];
  const requiredSectionTransitions = parseContractTransitions(sectionText(contractText, "Required context gates:"));
  const optionalSectionTransitions = parseContractTransitions(sectionText(contractText, "Advisory context gates:"));
  const documentedTransitions = [...requiredSectionTransitions, ...optionalSectionTransitions];
  const documentedTransitionSet = uniqueSorted(documentedTransitions);
  const allowed = uniqueSorted(allowedTransitions);
  const unsupported = documentedTransitionSet.filter((transition) => !allowed.includes(transition));
  const missing = allowed.filter((transition) => !documentedTransitionSet.includes(transition));
  if (unsupported.length > 0 || missing.length > 0) {
    issues.push(issue("warn", "contract_transition_drift", "packaged contract transition list drifts from constants", {
      missing,
      unsupported,
    }));
  }

  if (!sameMembers(uniqueSorted(requiredSectionTransitions), uniqueSorted(requiredTransitions))) {
    issues.push(issue("warn", "contract_required_drift", "packaged contract required gates drift from constants", {
      expected: uniqueSorted(requiredTransitions),
      actual: uniqueSorted(requiredSectionTransitions),
    }));
  }
  if (!sameMembers(uniqueSorted(optionalSectionTransitions), uniqueSorted(optionalTransitions))) {
    issues.push(issue("warn", "contract_optional_drift", "packaged contract advisory gates drift from constants", {
      expected: uniqueSorted(optionalTransitions),
      actual: uniqueSorted(optionalSectionTransitions),
    }));
  }

  return issues;
}

function validateTransitionGraph(options = {}) {
  const rules = contextGateGovernance(options.governance, {
    phases: PHASES,
    allowedTransitions: ALLOWED_TRANSITIONS,
    requiredGateTransitions: REQUIRED_GATE_TRANSITIONS,
    optionalGateTransitions: OPTIONAL_GATE_TRANSITIONS,
    phaseToExpectedTransition: PHASE_TO_EXPECTED_TRANSITION,
  });
  const phaseList = asArray(options.phases === undefined ? rules.phases : options.phases);
  const allowed = asArray(options.allowedTransitions === undefined ? rules.allowedTransitions : options.allowedTransitions);
  const required = asArray(options.requiredTransitions === undefined ? rules.requiredGateTransitions : options.requiredTransitions);
  const optional = asArray(options.optionalTransitions === undefined ? rules.optionalGateTransitions : options.optionalTransitions);
  const phaseToExpectedTransition = options.phaseToExpectedTransition === undefined
    ? rules.phaseToExpectedTransition
    : options.phaseToExpectedTransition;
  const contractText = options.contractText;
  const checkContract = options.checkContract === undefined ? true : options.checkContract;
  const expectedTransitions = adjacentTransitions(phaseList);
  const issues = [];

  if (phaseList.length < 2) {
    issues.push(issue("fail", "phase_count", "PHASES must contain at least two phases", {
      actual: phaseList,
    }));
  }
  const duplicatePhases = phaseList.filter((phase, index) => phaseList.indexOf(phase) !== index);
  if (duplicatePhases.length > 0) {
    issues.push(issue("fail", "phase_duplicates", "PHASES must not contain duplicates", {
      actual: uniqueSorted(duplicatePhases),
    }));
  }

  issues.push(...compareSet({
    actual: allowed,
    expected: expectedTransitions,
    code: "allowed_transitions",
    label: "ALLOWED_TRANSITIONS",
  }));

  const malformed = allowed.filter((transition) =>
    typeof transition !== "string" ||
    transition.split("->").length !== 2 ||
    !phaseList.includes(transitionFrom(transition)) ||
    !phaseList.includes(transitionTo(transition))
  );
  if (malformed.length > 0) {
    issues.push(issue("fail", "malformed_transitions", "transitions must use known phases in from->to form", {
      actual: uniqueSorted(malformed),
    }));
  }

  const requiredUnknown = required.filter((transition) => !allowed.includes(transition));
  const optionalUnknown = optional.filter((transition) => !allowed.includes(transition));
  if (requiredUnknown.length > 0) {
    issues.push(issue("fail", "required_unknown", "REQUIRED_GATE_TRANSITIONS contains unsupported transitions", {
      actual: uniqueSorted(requiredUnknown),
    }));
  }
  if (optionalUnknown.length > 0) {
    issues.push(issue("fail", "optional_unknown", "OPTIONAL_GATE_TRANSITIONS contains unsupported transitions", {
      actual: uniqueSorted(optionalUnknown),
    }));
  }

  const overlap = required.filter((transition) => optional.includes(transition));
  if (overlap.length > 0) {
    issues.push(issue("fail", "required_optional_overlap", "required and advisory transitions must be disjoint", {
      actual: uniqueSorted(overlap),
    }));
  }

  issues.push(...compareSet({
    actual: [...required, ...optional],
    expected: allowed,
    code: "transition_partition",
    label: "required plus advisory transitions",
  }));

  const expectedMap = Object.fromEntries([
    ...phaseList.slice(0, -1).map((phase, index) => [phase, expectedTransitions[index]]),
    [phaseList[phaseList.length - 1], null],
  ]);
  const actualMap = phaseToExpectedTransition || {};
  const mapKeys = uniqueSorted(Object.keys(actualMap));
  const expectedKeys = uniqueSorted(Object.keys(expectedMap));
  if (!sameMembers(mapKeys, expectedKeys)) {
    issues.push(issue("fail", "phase_map_keys", "PHASE_TO_EXPECTED_TRANSITION keys must match PHASES", {
      expected: expectedKeys,
      actual: mapKeys,
    }));
  }
  for (const phase of expectedKeys) {
    if (actualMap[phase] !== expectedMap[phase]) {
      issues.push(issue("fail", "phase_map_transition", `PHASE_TO_EXPECTED_TRANSITION.${phase} must match the next phase`, {
        expected: expectedMap[phase],
        actual: actualMap[phase],
      }));
    }
  }

  if (checkContract) {
    issues.push(...contractDriftIssues({
      contractText,
      allowedTransitions: allowed,
      requiredTransitions: required,
      optionalTransitions: optional,
    }));
  }

  const failed = issues.filter((item) => item.severity === "fail");
  const warned = issues.filter((item) => item.severity === "warn");
  if (failed.length > 0) {
    return {
      status: "fail",
      reason: `${failed.length} transition graph invariant(s) failed`,
      next_action: "Fix context gate phase constants and adoption transition metadata",
      issues,
    };
  }
  if (warned.length > 0) {
    return {
      status: "warn",
      reason: `${warned.length} packaged context adoption contract drift warning(s)`,
      next_action: "Update templates/contracts/context-adoption-contract.md to match code constants",
      issues,
    };
  }
  return {
    status: "pass",
    reason: "transition graph constants are internally consistent",
    next_action: "",
    issues,
  };
}

function checkContextGateGraph({ sourceRoot = path.resolve(__dirname, ".."), governance } = {}) {
  const contractPath = path.join(sourceRoot, CONTRACT_RELATIVE_PATH);
  let contractText;
  try {
    contractText = fs.readFileSync(contractPath, "utf8");
  } catch (error) {
    contractText = undefined;
  }
  return validateTransitionGraph({ contractText, governance });
}

function checkContextGateGraphForReady(options = {}) {
  const graph = checkContextGateGraph(options);
  return graph.status === "fail"
    ? { ...graph, status: "warn", reason: `advisory transition graph finding: ${graph.reason}` }
    : graph;
}

module.exports = {
  checkContextGateGraph,
  checkContextGateGraphForReady,
  validateTransitionGraph,
};
