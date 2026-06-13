"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const { run, tempDir } = require("./helpers/cli");
const { PHASES } = require("../lib/harness-state");
const {
  ALLOWED_TRANSITIONS,
  OPTIONAL_GATE_TRANSITIONS,
  REQUIRED_GATE_TRANSITIONS,
} = require("../lib/context-gate-constants");
const { PHASE_TO_EXPECTED_TRANSITION } = require("../lib/context-gate-adoption");
const graphModule = require("../lib/context-gate-graph");
const {
  checkContextGateGraph,
  validateTransitionGraph,
} = graphModule;

const CONTRACT_PATH = path.resolve(__dirname, "..", "templates", "contracts", "context-adoption-contract.md");

function packagedContract() {
  return fs.readFileSync(CONTRACT_PATH, "utf8");
}

test("context gate transition graph constants are internally consistent", () => {
  const result = checkContextGateGraph();

  assert.equal(result.status, "pass");
  assert.equal(result.issues.length, 0);
  assert.equal(PHASE_TO_EXPECTED_TRANSITION.plan, "plan->work");
  assert.equal(PHASE_TO_EXPECTED_TRANSITION.lookback, null);
});

test("transition graph rejects unsupported allowed transitions", () => {
  const result = validateTransitionGraph({
    phases: PHASES,
    allowedTransitions: [...ALLOWED_TRANSITIONS, "verify->handoff"],
    requiredTransitions: REQUIRED_GATE_TRANSITIONS,
    optionalTransitions: OPTIONAL_GATE_TRANSITIONS,
    phaseToExpectedTransition: PHASE_TO_EXPECTED_TRANSITION,
    contractText: packagedContract(),
  });

  assert.equal(result.status, "fail");
  assert.match(result.reason, /transition graph invariant/);
  assert.ok(result.issues.some((item) => item.code === "allowed_transitions"));
});

test("transition graph validates an injected governance snapshot without contract text", () => {
  const result = validateTransitionGraph({
    governance: {
      phases: ["verify", "release"],
      allowed_transitions: ["verify->release"],
      required_gate_transitions: ["verify->release"],
      optional_gate_transitions: [],
      phase_to_expected_transition: {
        verify: "verify->release",
        release: null,
      },
    },
    checkContract: false,
  });

  assert.equal(result.status, "pass");
  assert.deepEqual(result.issues, []);
});

test("transition graph rejects transitions outside an injected governance snapshot", () => {
  const result = validateTransitionGraph({
    governance: {
      phases: ["verify", "release"],
      allowed_transitions: ["verify->release", "release->done"],
      required_gate_transitions: ["verify->release"],
      optional_gate_transitions: ["release->done"],
      phase_to_expected_transition: {
        verify: "verify->release",
        release: null,
      },
    },
    checkContract: false,
  });

  assert.equal(result.status, "fail");
  assert.ok(result.issues.some((item) => item.code === "allowed_transitions"));
});

test("transition graph rejects phase-to-transition drift", () => {
  const result = validateTransitionGraph({
    phases: PHASES,
    allowedTransitions: ALLOWED_TRANSITIONS,
    requiredTransitions: REQUIRED_GATE_TRANSITIONS,
    optionalTransitions: OPTIONAL_GATE_TRANSITIONS,
    phaseToExpectedTransition: {
      ...PHASE_TO_EXPECTED_TRANSITION,
      verify: "verify->handoff",
    },
    contractText: packagedContract(),
  });

  assert.equal(result.status, "fail");
  assert.ok(result.issues.some((item) =>
    item.code === "phase_map_transition" &&
    item.expected === "verify->synthesize" &&
    item.actual === "verify->handoff"
  ));
});

test("transition graph reports packaged contract drift as advisory", () => {
  const contractText = packagedContract().replace("- `handoff->lookback`\n", "");
  const result = validateTransitionGraph({
    phases: PHASES,
    allowedTransitions: ALLOWED_TRANSITIONS,
    requiredTransitions: REQUIRED_GATE_TRANSITIONS,
    optionalTransitions: OPTIONAL_GATE_TRANSITIONS,
    phaseToExpectedTransition: PHASE_TO_EXPECTED_TRANSITION,
    contractText,
  });

  assert.equal(result.status, "warn");
  assert.match(result.reason, /contract drift warning/);
  assert.ok(result.issues.every((item) => item.severity === "warn"));
  assert.ok(result.issues.some((item) => item.code === "contract_transition_drift"));
});

test("transition graph rejects required and advisory overlap", () => {
  const result = validateTransitionGraph({
    phases: PHASES,
    allowedTransitions: ALLOWED_TRANSITIONS,
    requiredTransitions: [...REQUIRED_GATE_TRANSITIONS, "synthesize->handoff"],
    optionalTransitions: OPTIONAL_GATE_TRANSITIONS,
    phaseToExpectedTransition: PHASE_TO_EXPECTED_TRANSITION,
    contractText: packagedContract(),
  });

  assert.equal(result.status, "fail");
  assert.ok(result.issues.some((item) => item.code === "required_optional_overlap"));
});

test("transition graph warning remains advisory in strict ready mode", async () => {
  const cwd = tempDir("meta-harness-transition-graph-ready-");
  run(cwd, ["init", "Transition graph advisory ready"]);

  const original = graphModule.checkContextGateGraphForReady;
  const readyPath = require.resolve("../lib/ready-check");
  const previousReady = require.cache[readyPath];
  delete require.cache[readyPath];
  graphModule.checkContextGateGraphForReady = () => ({
    status: "warn",
    reason: "synthetic graph warning",
    next_action: "Fix synthetic graph warning",
    issues: [{ severity: "warn", code: "synthetic", message: "synthetic graph warning" }],
  });

  try {
    const { runReadyCheck } = require("../lib/ready-check");
    const result = await runReadyCheck({
      targetRoot: cwd,
      quick: true,
      readOnly: true,
      mode: "strict",
    });
    const check = result.checks.find((item) => item.id === "MH_TRANSITION_GRAPH_001");
    assert.equal(check.status, "warn");
    assert.doesNotMatch(check.reason, /required in strict mode/);
  } finally {
    graphModule.checkContextGateGraphForReady = original;
    delete require.cache[readyPath];
    if (previousReady) require.cache[readyPath] = previousReady;
  }
});
