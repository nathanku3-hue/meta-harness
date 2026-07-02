"use strict";

const path = require("node:path");
const { fail, optionValue, parseArgs } = require("../cli-args");
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
const { buildRepoRollup, renderRepoRollupMarkdown } = require("../repo-rollup");
const { readRepoIndex } = require("./repos");

function firstStatusLines(status) {
  const lines = status.split(/\r?\n/).filter((line) => line.trim().length > 0);
  return lines.slice(0, 12).join("\n");
}

function parseApprovalReceiptJson(raw, label) {
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      fail(`${label} must be a JSON object`);
    }
    return parsed;
  } catch (error) {
    if (error && error.name === "UsageError") throw error;
    fail(`${label} must be valid JSON`);
  }
}

function readApprovalReceiptOption(options, context) {
  const inlineReceipt = optionValue(options.autonomyApprovalReceipt);
  const receiptFile = optionValue(options.autonomyApprovalReceiptFile);
  if (inlineReceipt !== undefined && receiptFile !== undefined) {
    fail("Use only one of --autonomy-approval-receipt or --autonomy-approval-receipt-file");
  }
  if (inlineReceipt !== undefined) {
    if (inlineReceipt === true || String(inlineReceipt).trim() === "") {
      fail("--autonomy-approval-receipt requires a JSON object");
    }
    return parseApprovalReceiptJson(String(inlineReceipt), "--autonomy-approval-receipt");
  }
  if (receiptFile !== undefined) {
    if (receiptFile === true || String(receiptFile).trim() === "") {
      fail("--autonomy-approval-receipt-file requires a file path");
    }
    const filePath = path.resolve(context.cwd, String(receiptFile));
    if (!fileExists(filePath)) {
      fail(`--autonomy-approval-receipt-file not found: ${receiptFile}`);
    }
    return parseApprovalReceiptJson(readText(filePath), "--autonomy-approval-receipt-file");
  }
  return undefined;
}

function readManualWorkPacketOutputOption(options) {
  const value = options.writeManualWorkPacket;
  if (value === undefined) return null;
  if (Array.isArray(value)) fail("--write-manual-work-packet must be provided once");
  if (value === true || String(value).trim() === "") {
    fail("--write-manual-work-packet requires a file path");
  }
  return String(value);
}

function readManualWorkPacketVerifyOption(options) {
  const value = options.verifyManualWorkPacket;
  if (value === undefined) return null;
  if (Array.isArray(value)) fail("--verify-manual-work-packet must be provided once");
  if (value === true || String(value).trim() === "") {
    fail("--verify-manual-work-packet requires a file path");
  }
  return String(value);
}

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
  if (options.rollup) {
    requireHarness(context);
    if (options.write) {
      fail("poll --rollup is read-only; --write is not supported with --rollup");
    }
    const manualWorkPacketOutput = readManualWorkPacketOutputOption(options);
    const manualWorkPacketVerify = readManualWorkPacketVerifyOption(options);
    const packetBoundaryRepos = manualWorkPacketOutput || manualWorkPacketVerify ? readRepoIndex(context).repos : [];
    let manualWorkPacketArtifactValidation;
    let verifiedManualWorkPacket;
    if (manualWorkPacketVerify) {
      const res = readManualWorkPacketArtifactForRollup(context, manualWorkPacketVerify, packetBoundaryRepos);
      manualWorkPacketArtifactValidation = res.validation;
      verifiedManualWorkPacket = res.verifiedManualWorkPacket;
    }
    const rollup = buildRepoRollup(context.cwd, {
      fs: context.fs,
      autonomyApprovalReceipt: readApprovalReceiptOption(options, context),
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
    writeOut(
      context,
      options.json ? `${JSON.stringify(rollup, null, 2)}\n` : renderRepoRollupMarkdown(rollup)
    );
    return;
  }

  if (options.writeManualWorkPacket !== undefined) {
    fail("--write-manual-work-packet requires poll --rollup");
  }
  if (options.verifyManualWorkPacket !== undefined) {
    fail("--verify-manual-work-packet requires poll --rollup");
  }
  const poll = renderPoll(context);
  if (options.write) {
    context.fs.writeFileSync(harnessPath(context, "poll.md"), poll, "utf8");
  }
  writeOut(context, poll);
};
