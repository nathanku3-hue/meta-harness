"use strict";

const { fail, optionValues, parseArgs } = require("../cli-args");
const { writeLine } = require("../cli-context");
const { classifyWorkerReport } = require("../ship-gate");
const {
  ACTUAL_WORK_TYPES,
  EXECUTION_STYLE_WORK_TYPES,
  REQUESTED_WORK_TYPES,
  appendEvent,
  harnessPath,
  hasExplicitBlocker,
  normalizePhase,
  normalizeStream,
  nowIso,
  refreshStatus,
  requireHarness,
  slugify,
} = require("../harness-state");

function explicitStatus(rawOptions) {
  const value = rawOptions.checksStatus || rawOptions.checkStatus || rawOptions.testsStatus || rawOptions.testStatus;
  if (value === undefined || value === null || value === true) {
    return undefined;
  }
  return String(value).trim().toLowerCase();
}

function validationStatus(rawOptions) {
  const explicit = explicitStatus(rawOptions);
  if (explicit) {
    return explicit;
  }
  const failed = String(rawOptions.validationsFailed || "none").trim().toLowerCase();
  if (failed && failed !== "none") {
    return "fail";
  }
  const passed = String(rawOptions.validationsPassed || "none").trim().toLowerCase();
  const skipped = String(rawOptions.validationsSkipped || "none").trim().toLowerCase();
  if (passed && passed !== "none" && (!skipped || skipped === "none")) {
    return "pass";
  }
  return "unknown";
}

function normalizeWorkerReportInput(positional, rawOptions) {
  const workerId = slugify(positional[0] || rawOptions.worker || `worker-${Date.now()}`);
  const stream = normalizeStream(rawOptions.stream);
  const phase = normalizePhase(rawOptions.phase || "work");
  const task = rawOptions.task || "Unspecified bounded task.";
  const outcome = rawOptions.outcome;
  const allowedOutcomes = new Set(["DONE", "PARTIAL_WITH_EXPLICIT_SCOPE", "REJECTED"]);

  if (!allowedOutcomes.has(outcome)) {
    fail("worker report requires --outcome DONE|PARTIAL_WITH_EXPLICIT_SCOPE|REJECTED");
  }

  const requestedWorkType = rawOptions.requestedWorkType;
  const actualWorkType = rawOptions.actualWorkType;
  if (!requestedWorkType || !new Set(REQUESTED_WORK_TYPES).has(requestedWorkType)) {
    fail(`worker report requires --requested-work-type ${REQUESTED_WORK_TYPES.join("|")}`);
  }
  if (!actualWorkType || !new Set(ACTUAL_WORK_TYPES).has(actualWorkType)) {
    fail(`worker report requires --actual-work-type ${ACTUAL_WORK_TYPES.join("|")}`);
  }

  const blocker = rawOptions.blocker || "none";
  if (outcome === "DONE" && actualWorkType === "none") {
    fail("actual work type none requires PARTIAL_WITH_EXPLICIT_SCOPE or REJECTED and --blocker <reason>");
  }
  if (outcome === "DONE" && new Set(EXECUTION_STYLE_WORK_TYPES).has(requestedWorkType) && ["docs", "none"].includes(actualWorkType)) {
    fail("silent docs-only fallback is forbidden; use PARTIAL_WITH_EXPLICIT_SCOPE or REJECTED and name the blocker");
  }
  if (["PARTIAL_WITH_EXPLICIT_SCOPE", "REJECTED"].includes(outcome) && !hasExplicitBlocker(blocker)) {
    fail(`${outcome} worker report requires --blocker <reason>`);
  }

  return {
    workerId,
    stream,
    phase,
    task,
    outcome,
    requestedWorkType,
    actualWorkType,
    blocker,
    result: rawOptions.result || "No result recorded yet.",
    evidenceArtifacts: rawOptions.evidenceArtifacts || rawOptions.artifacts || "none",
    proposedNextAction: rawOptions.nextAction || "Harness should review this report and choose the next action.",
    allowedScope: rawOptions.allowedScope || "not recorded",
    changedPaths: [
      ...optionValues(rawOptions.changedPath),
      ...optionValues(rawOptions.changedPaths),
    ],
    round: rawOptions.round || "not recorded",
    progress: rawOptions.progress || "not recorded",
    confidence: rawOptions.confidence || "not recorded",
    humanSummary: rawOptions.humanSummary,
    decisionNeeded: rawOptions.decisionNeeded || "hold",
    alternatives: rawOptions.alternatives || "none recorded",
    scopeLimit: rawOptions.scopeLimit,
    stopRule: rawOptions.stopRule || "Stop if requested and actual work type diverge, or if SAW/ClosurePacket details become the primary report structure.",
    nextGoal: rawOptions.nextGoal || "not recorded",
    forbiddenScope: rawOptions.forbiddenScope || "not recorded",
    validationsPassed: rawOptions.validationsPassed || "none",
    validationsSkipped: rawOptions.validationsSkipped || "none",
    commitCreated: rawOptions.commitCreated || "false",
    validationStatus: validationStatus(rawOptions),
    credentialsTouched: rawOptions.credentialsTouched,
    providerAccessTouched: rawOptions.providerAccessTouched,
    dataOutputCreated: rawOptions.dataOutputCreated,
    securityBoundaryExpanded: rawOptions.securityBoundaryExpanded,
    workflowPermissionIncrease: rawOptions.workflowPermissionIncrease,
    secretsInherited: rawOptions.secretsInherited,
    pullRequestTargetAdded: rawOptions.pullRequestTargetAdded,
    workflowUntrustedInputToAgentOrScript: rawOptions.workflowUntrustedInputToAgentOrScript,
    runtimeOrDataOutputTouched: rawOptions.runtimeOrDataOutputTouched,
    domainOrArchitectureTouched: rawOptions.domainOrArchitectureTouched,
    packageOrReleaseTouched: rawOptions.packageOrReleaseTouched,
  };
}

function workerReportShipGateInput(reportInput) {
  return {
    outcome: reportInput.outcome,
    requested_work_type: reportInput.requestedWorkType,
    actual_work_type: reportInput.actualWorkType,
    changed_paths: reportInput.changedPaths,
    checks_status: reportInput.validationStatus,
    credentials_touched: reportInput.credentialsTouched,
    provider_access_touched: reportInput.providerAccessTouched,
    data_output_created: reportInput.dataOutputCreated,
    security_boundary_expanded: reportInput.securityBoundaryExpanded,
    workflow_permission_increase: reportInput.workflowPermissionIncrease,
    secrets_inherited: reportInput.secretsInherited,
    pull_request_target_added: reportInput.pullRequestTargetAdded,
    workflow_untrusted_input_to_agent_or_script: reportInput.workflowUntrustedInputToAgentOrScript,
    runtime_or_data_output_touched: reportInput.runtimeOrDataOutputTouched,
    domain_or_architecture_touched: reportInput.domainOrArchitectureTouched,
    package_or_release_touched: reportInput.packageOrReleaseTouched,
  };
}

function renderReport(reportInput, shipGate) {
  return `# Worker PM Brief

Outcome: ${reportInput.outcome}
Round: ${reportInput.round}
Progress: ${reportInput.progress}
Confidence: ${reportInput.confidence}
Worker: ${reportInput.workerId}
Stream: ${reportInput.stream}
Task: ${reportInput.task}
Phase: ${reportInput.phase}
Updated: ${nowIso()}
Ship gate tier: ${shipGate.tier}
Task resolution: ${shipGate.resolution}

## What changed

${reportInput.result}

## Why it matters

${reportInput.humanSummary || reportInput.result}

## What is blocked

${reportInput.blocker}

## What decision is needed

Decision needed from user: ${reportInput.decisionNeeded}
Options considered: ${reportInput.alternatives}
Scope limit: ${reportInput.scopeLimit || reportInput.allowedScope}
Stop rule: ${reportInput.stopRule}

## Next action

Recommended next action: ${reportInput.proposedNextAction}
Goal: ${reportInput.nextGoal}
Allowed scope: ${reportInput.allowedScope}
Forbidden scope: ${reportInput.forbiddenScope}

## Validation / evidence

Passed:
${reportInput.validationsPassed}

Skipped:
${reportInput.validationsSkipped}

Evidence artifacts:
${reportInput.evidenceArtifacts}

## Accountability

requested_work_type: ${reportInput.requestedWorkType}
actual_work_type_performed: ${reportInput.actualWorkType}
credentials_touched: ${reportInput.credentialsTouched || "false"}
provider_access_touched: ${reportInput.providerAccessTouched || "false"}
data_output_created: ${reportInput.dataOutputCreated || "false"}
commit_created: ${reportInput.commitCreated}
remaining_blocker: ${reportInput.blocker}
ship_gate_tier: ${shipGate.tier}
task_resolution: ${shipGate.resolution}
`;
}

module.exports = async function runWorkerReport(args, context) {
  const parsed = parseArgs(args);
  requireHarness(context);

  const reportInput = normalizeWorkerReportInput(parsed.positional, parsed.options);
  const shipGate = classifyWorkerReport(workerReportShipGateInput(reportInput));
  const report = renderReport(reportInput, shipGate);
  const reportPath = harnessPath(context, "workers", `${reportInput.workerId}.md`);
  context.fs.writeFileSync(reportPath, report, "utf8");

  appendEvent(context, {
    actor: reportInput.workerId,
    stream: reportInput.stream,
    phase: reportInput.phase,
    action: `worker report: ${reportInput.task}`,
    result: reportInput.result,
    evidence: reportInput.evidenceArtifacts,
    blocker: reportInput.blocker === "none" ? undefined : reportInput.blocker,
    next_action: reportInput.proposedNextAction,
    ship_gate_tier: shipGate.tier,
    task_resolution: shipGate.resolution,
  });
  refreshStatus(context);

  writeLine(context, `Wrote worker report: ${reportPath}`);
};
