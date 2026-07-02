"use strict";

const path = require("node:path");
const { fail, optionValue, parseArgs } = require("../cli-args");
const { writeOut } = require("../cli-context");
const { HARNESS_DIR, harnessPath, nowIso, requireHarness } = require("../harness-state");
const { fileExists, readText } = require("../paths");
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

function isAbsoluteInput(value) {
  return path.isAbsolute(value) || /^[A-Za-z]:[\\/]/.test(value) || value.startsWith("\\\\");
}

function containsPath(parentPath, childPath) {
  const relative = path.relative(parentPath, childPath);
  return relative === "" || (relative && !relative.startsWith("..") && !path.isAbsolute(relative));
}

function resolveManualWorkPacketOutputPath(context, rawPath) {
  if (isAbsoluteInput(rawPath)) fail("--write-manual-work-packet path must be relative");
  const root = path.resolve(context.cwd);
  const harnessRoot = path.resolve(root, HARNESS_DIR);
  const outputPath = path.resolve(root, rawPath);
  if (outputPath === harnessRoot) {
    fail("--write-manual-work-packet must be a file path under .meta-harness/");
  }
  if (!containsPath(harnessRoot, outputPath)) {
    fail("--write-manual-work-packet path must be under .meta-harness/");
  }
  const index = readRepoIndex(context);
  for (const repo of index.repos) {
    if (!repo || !repo.path) continue;
    const childRoot = path.resolve(root, String(repo.path));
    if (containsPath(childRoot, outputPath)) {
      fail("--write-manual-work-packet must not target a child repo");
    }
  }
  return outputPath;
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
    if (stat.isDirectory()) {
      fail("--write-manual-work-packet must be a file path under .meta-harness/");
    }
    if (options.force === undefined) {
      fail("--write-manual-work-packet output already exists; use --force to overwrite");
    }
  }
  context.fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  context.fs.writeFileSync(outputPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
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
    const rollup = buildRepoRollup(context.cwd, {
      fs: context.fs,
      autonomyApprovalReceipt: readApprovalReceiptOption(options, context),
    });
    if (manualWorkPacketOutput) {
      assertReadyManualWorkPacket(rollup);
      writeManualWorkPacketArtifact(
        context,
        resolveManualWorkPacketOutputPath(context, manualWorkPacketOutput),
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
  const poll = renderPoll(context);
  if (options.write) {
    context.fs.writeFileSync(harnessPath(context, "poll.md"), poll, "utf8");
  }
  writeOut(context, poll);
};
