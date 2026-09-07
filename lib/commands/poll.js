"use strict";

const path = require("node:path");
const { fail, parseArgs } = require("../cli-args");
const { writeOut } = require("../cli-context");
const { HARNESS_DIR, harnessPath, nowIso, requireHarness } = require("../harness-state");
const { fileExists, readText } = require("../paths");
const {
  assertReadyManualWorkPacket,
  buildManualWorkPacketArtifact,
  readManualWorkPacketArtifactForRollup,
  resolveManualWorkPacketOutputPath,
  writeManualWorkPacketArtifact,
} = require("../manual-work-packet-artifact-io");
const {
  assertReadyOperatorPlan,
  buildOperatorExecutionPlanArtifact,
  readOperatorExecutionPlanArtifact,
  resolveOperatorExecutionPlanOutputPath,
  writeOperatorExecutionPlanArtifact,
} = require("../operator-execution-plan-artifact-io");
const operatorPlanArtifactValidation = require("../repo-rollup-operator-execution-plan-artifact-validation");
const { attachExecutionReadinessToRollup } = require("../execution-readiness");
const { attachWorkerEntryGateToRollup } = require("../worker-entry-gate");
const { buildRepoRollup, renderRepoRollupMarkdown } = require("../repo-rollup");
const { readRepoIndex } = require("./repos");

function firstStatusLines(status) {
  const lines = status.split(/\r?\n/).filter((line) => line.trim().length > 0);
  return lines.slice(0, 12).join("\n");
}

function readSinglePathOption(options, flag, label) {
  const v = options[flag];
  if (v === undefined) return null;
  if (Array.isArray(v)) fail(`${label} must be provided once`);
  if (v === true || !String(v).trim()) fail(`${label} requires a file path`);
  return String(v);
}
function readManualWorkPacketOutputOption(o) { return readSinglePathOption(o, "writeManualWorkPacket", "--write-manual-work-packet"); }
function readManualWorkPacketVerifyOption(o) { return readSinglePathOption(o, "verifyManualWorkPacket", "--verify-manual-work-packet"); }
function readOperatorPlanOutput(o) { return readSinglePathOption(o, "writeOperatorExecutionPlan", "--write-operator-execution-plan"); }
function readOperatorPlanVerify(o) { return readSinglePathOption(o, "verifyOperatorExecutionPlan", "--verify-operator-execution-plan"); }

function renderPoll(context) {
  requireHarness(context);
  const index = readRepoIndex(context);
  const sections = ["# Poll Summary", "", `Updated: ${nowIso()}`, "", "## Local", ""];
  const localStatusPath = harnessPath(context, "status.md");
  sections.push(fileExists(localStatusPath) ? firstStatusLines(readText(localStatusPath)) : "No local status found.");

  sections.push("", "## Child Repos", "");
  if (index.repos.length === 0) {
    sections.push("- none");
  } else {
    for (const repo of index.repos) {
      const childStatusPath = path.resolve(context.cwd, repo.path, HARNESS_DIR, "status.md");
      if (!fileExists(childStatusPath)) {
        sections.push(`### ${repo.name}`, "", `Missing status: ${childStatusPath}`, "");
      } else {
        sections.push(`### ${repo.name}`, "", firstStatusLines(readText(childStatusPath)), "");
      }
    }
  }

  return `${sections.join("\n")}\n`;
}

module.exports = async function runPoll(args, context) {
  const { options } = parseArgs(args);
  if (options.autonomyApprovalReceipt !== undefined || options.autonomyApprovalReceiptFile !== undefined) {
    fail("autonomy approval receipt input is retired; manual work packets are derived directly from current rollup facts");
  }
  if (options.rollup) {
    requireHarness(context);
    if (options.write) {
      fail("poll --rollup is read-only; --write is not supported with --rollup");
    }
    const manualWorkPacketOutput = readManualWorkPacketOutputOption(options);
    const manualWorkPacketVerify = readManualWorkPacketVerifyOption(options);
    const operatorPlanOutput = readOperatorPlanOutput(options);
    const operatorPlanVerify = readOperatorPlanVerify(options);
    const packetBoundaryRepos = manualWorkPacketOutput || manualWorkPacketVerify || operatorPlanOutput || operatorPlanVerify ? readRepoIndex(context).repos : [];
    let manualWorkPacketArtifactValidation;
    let verifiedManualWorkPacket;
    if (manualWorkPacketVerify) {
      const res = readManualWorkPacketArtifactForRollup(context, manualWorkPacketVerify, packetBoundaryRepos);
      manualWorkPacketArtifactValidation = res.validation;
      verifiedManualWorkPacket = res.verifiedManualWorkPacket;
    }
    const rollup = buildRepoRollup(context.cwd, {
      fs: context.fs,
      manualWorkPacketArtifactValidation,
      verifiedManualWorkPacket,
    });
    if (manualWorkPacketOutput) {
      assertReadyManualWorkPacket(rollup);
      writeManualWorkPacketArtifact(
        context,
        resolveManualWorkPacketOutputPath(context, manualWorkPacketOutput, packetBoundaryRepos),
        buildManualWorkPacketArtifact(rollup),
        options
      );
    }
    if (operatorPlanOutput) {
      if (!manualWorkPacketVerify) {
        fail("--write-operator-execution-plan requires --verify-manual-work-packet");
      }
      assertReadyOperatorPlan(rollup);
      writeOperatorExecutionPlanArtifact(
        context,
        resolveOperatorExecutionPlanOutputPath(context, operatorPlanOutput, packetBoundaryRepos),
        buildOperatorExecutionPlanArtifact(rollup),
        options
      );
    }

    let operatorExecutionPlanArtifactValidation;
    let opArtifactReadRes;
    if (operatorPlanVerify) {
      opArtifactReadRes = readOperatorExecutionPlanArtifact(context, operatorPlanVerify, packetBoundaryRepos);
      operatorExecutionPlanArtifactValidation = operatorPlanArtifactValidation.buildOperatorExecutionPlanArtifactValidation({
        requested: true,
        path: operatorPlanVerify,
        artifact: opArtifactReadRes.artifact,
        readError: opArtifactReadRes.readError,
        pathOk: true,
        childPathOk: true,
      });
    }
    // 22A-H + 22B: always emit execution_readiness then worker_entry_gate on verify-op
    if (operatorExecutionPlanArtifactValidation) {
      rollup.operator_execution_plan_artifact_validation = operatorExecutionPlanArtifactValidation;
      attachExecutionReadinessToRollup(rollup, {
        operatorPlanArtifact: opArtifactReadRes?.artifact || null,
        operatorPlanArtifactValidation: operatorExecutionPlanArtifactValidation,
        packetBoundaryRepos,
        cwd: context.cwd,
      });
      attachWorkerEntryGateToRollup(rollup);
    }

    writeOut(
      context,
      options.json ? `${JSON.stringify(rollup, null, 2)}\n` : renderRepoRollupMarkdown(rollup)
    );
    return;
  }

  if (options.writeManualWorkPacket !== undefined) fail("--write-manual-work-packet requires poll --rollup");
  if (options.verifyManualWorkPacket !== undefined) fail("--verify-manual-work-packet requires poll --rollup");
  if (options.writeOperatorExecutionPlan !== undefined) fail("--write-operator-execution-plan requires poll --rollup");
  if (options.verifyOperatorExecutionPlan !== undefined) fail("--verify-operator-execution-plan requires poll --rollup");
  const poll = renderPoll(context);
  if (options.write) {
    context.fs.writeFileSync(harnessPath(context, "poll.md"), poll, "utf8");
  }
  writeOut(context, poll);
};
