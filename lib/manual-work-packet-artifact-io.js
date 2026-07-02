"use strict";

const path = require("node:path");
const { fail } = require("./cli-args");
const { HARNESS_DIR } = require("./harness-state");
const { buildManualWorkPacketArtifactValidation } = require("./repo-rollup-manual-work-packet-artifact-validation");

function isAbsoluteInput(value) {
  return path.isAbsolute(value) || /^[A-Za-z]:[\\/]/.test(value) || value.startsWith("\\\\");
}

function containsPath(parentPath, childPath) {
  const relative = path.relative(parentPath, childPath);
  return relative === "" || (relative && !relative.startsWith("..") && !path.isAbsolute(relative));
}

function resolveManualWorkPacketBoundaryPath(context, rawPath, flagName, repos = []) {
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

function resolveManualWorkPacketOutputPath(context, rawPath, repos = []) {
  return resolveManualWorkPacketBoundaryPath(context, rawPath, "--write-manual-work-packet", repos);
}

function assertReadyManualWorkPacket(rollup) {
  const packet = rollup && rollup.manual_work_packet;
  if (!packet || packet.verdict !== "ready_for_manual_work") {
    fail("manual_work_packet must be ready_for_manual_work before writing");
  }
}

function buildManualWorkPacketArtifact(rollup) {
  return {
    schema_version: "1.0.0",
    kind: "approved_manual_work_packet_artifact",
    source: "poll_rollup_manual_work_packet",
    rollup_schema_version: rollup.schema_version || null,
    generated_from: rollup.generated_from || null,
    packet_id: rollup.manual_work_packet.packet_id || null,
    manual_work_packet: rollup.manual_work_packet,
    writes_files: true,
    writes_parent_files: true,
    writes_child_files: false,
    executes_child_commands: false,
    creates_tasks: false,
    creates_queues: false,
    applies_patches: false,
    refreshes_readiness: false,
    records_decision: false,
    records_approval: false,
  };
}

function writeManualWorkPacketArtifact(context, outputPath, artifact, options) {
  if (context.fs.existsSync(outputPath)) {
    const stat = context.fs.statSync(outputPath);
    if (stat.isDirectory()) fail("--write-manual-work-packet must be a file path under .meta-harness/");
    if (options.force === undefined) fail("--write-manual-work-packet output already exists; use --force to overwrite");
  }
  context.fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  context.fs.writeFileSync(outputPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
}

function validationResult(rawPath, readError, artifact) {
  return buildManualWorkPacketArtifactValidation({
    requested: true,
    path: rawPath,
    artifact,
    readError,
    pathOk: true,
    childPathOk: true,
  });
}

function readManualWorkPacketArtifactForValidation(context, rawPath, repos = []) {
  const artifactPath = resolveManualWorkPacketBoundaryPath(context, rawPath, "--verify-manual-work-packet", repos);
  if (!context.fs.existsSync(artifactPath)) return validationResult(rawPath, "missing");
  try {
    if (!context.fs.statSync(artifactPath).isFile()) return validationResult(rawPath, "parse");
    return validationResult(rawPath, null, JSON.parse(context.fs.readFileSync(artifactPath, "utf8")));
  } catch (_error) {
    return validationResult(rawPath, "parse");
  }
}

module.exports = {
  assertReadyManualWorkPacket,
  buildManualWorkPacketArtifact,
  readManualWorkPacketArtifactForValidation,
  resolveManualWorkPacketOutputPath,
  writeManualWorkPacketArtifact,
};
