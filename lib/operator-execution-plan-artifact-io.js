"use strict";

const path = require("node:path");
const { fail } = require("./cli-args");
const { HARNESS_DIR } = require("./harness-state");

function isAbsoluteInput(value) {
  return path.isAbsolute(value) || /^[A-Za-z]:[\\/]/.test(value) || value.startsWith("\\\\");
}

function containsPath(parentPath, childPath) {
  const relative = path.relative(parentPath, childPath);
  return relative === "" || (relative && !relative.startsWith("..") && !path.isAbsolute(relative));
}

function resolveOperatorExecutionPlanBoundaryPath(context, rawPath, flagName, repos = []) {
  if (isAbsoluteInput(rawPath)) fail(`${flagName} path must be relative`);
  const root = path.resolve(context.cwd);
  const harnessRoot = path.resolve(root, HARNESS_DIR);
  const artifactPath = path.resolve(root, rawPath);
  if (artifactPath === harnessRoot) fail(`${flagName} must be a file path under .meta-harness/`);
  if (!containsPath(harnessRoot, artifactPath)) fail(`${flagName} path must be under .meta-harness/`);
  for (const repo of repos) {
    if (!repo || !repo.path) continue;
    if (containsPath(path.resolve(root, String(repo.path)), artifactPath)) fail(`${flagName} must not target a child repo`);
  }
  return artifactPath;
}

function resolveOperatorExecutionPlanOutputPath(context, rawPath, repos = []) {
  return resolveOperatorExecutionPlanBoundaryPath(context, rawPath, "--write-operator-execution-plan", repos);
}

function assertReadyOperatorPlan(rollup) {
  const plan = rollup && rollup.operator_execution_plan;
  if (!plan || plan.verdict !== "ready_for_operator" || plan.ok !== true) {
    fail("operator_execution_plan must be ready_for_operator before writing");
  }
}

function buildOperatorExecutionPlanArtifact(rollup) {
  const validation = rollup && rollup.manual_work_packet_artifact_validation ? rollup.manual_work_packet_artifact_validation : null;
  const plan = rollup && rollup.operator_execution_plan ? rollup.operator_execution_plan : null;
  return {
    schema_version: "1.0.0",
    kind: "operator_execution_plan_artifact",
    source: "poll_rollup_operator_execution_plan",
    rollup_schema_version: rollup && rollup.schema_version ? rollup.schema_version : null,
    generated_from: rollup && rollup.generated_from ? rollup.generated_from : null,
    packet_id: (plan && plan.packet_id) || (validation && validation.packet_id) || null,
    manual_work_packet_artifact_validation: validation,
    operator_execution_plan: plan,
    mutates: false,
    writes_files: true,
    writes_parent_files: true,
    writes_child_files: false,
    executes_child_commands: false,
    applies_patches: false,
    creates_tasks: false,
    creates_queues: false,
    refreshes_readiness: false,
    records_decision: false,
    records_approval: false,
  };
}

function writeOperatorExecutionPlanArtifact(context, outputPath, artifact, options) {
  if (context.fs.existsSync(outputPath)) {
    const stat = context.fs.statSync(outputPath);
    if (stat.isDirectory()) fail("--write-operator-execution-plan must be a file path under .meta-harness/");
    if (options.force === undefined) fail("--write-operator-execution-plan output already exists; use --force to overwrite");
  }
  context.fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  context.fs.writeFileSync(outputPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
}

function readOperatorExecutionPlanArtifact(context, rawPath, repos = []) {
  const artifactPath = resolveOperatorExecutionPlanBoundaryPath(context, rawPath, "--verify-operator-execution-plan", repos);
  if (!context.fs.existsSync(artifactPath)) return { readError: "missing", artifact: undefined };
  try {
    if (!context.fs.statSync(artifactPath).isFile()) return { readError: "parse", artifact: undefined };
    return { readError: null, artifact: JSON.parse(context.fs.readFileSync(artifactPath, "utf8")) };
  } catch (_error) {
    return { readError: "parse", artifact: undefined };
  }
}

module.exports = {
  assertReadyOperatorPlan,
  buildOperatorExecutionPlanArtifact,
  readOperatorExecutionPlanArtifact,
  resolveOperatorExecutionPlanOutputPath,
  writeOperatorExecutionPlanArtifact,
};
