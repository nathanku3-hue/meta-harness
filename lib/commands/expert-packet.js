"use strict";

const { optionValue, parseArgs } = require("../cli-args");
const { writeLine } = require("../cli-context");
const { buildExpertPacket } = require("../expert-packet");
const { appendEvent, refreshStatus, requireHarness } = require("../harness-state");

module.exports = async function runExpertPacket(args, context) {
  const { positional, options } = parseArgs(args);
  requireHarness(context);
  const result = buildExpertPacket({
    cwd: context.cwd,
    roundId: positional[0] || options.round,
    options,
  });

  if (result.dryRun) {
    writeLine(context, `Would build expert packet zip: ${result.packetZip}`);
    writeLine(context, "Planned git pathspecs:");
    for (const item of result.gitPathspecs) {
      writeLine(context, `- ${item}`);
    }
    return;
  }

  appendEvent(context, {
    actor: optionValue(options.actor, "meta-harness"),
    stream: "review",
    phase: "plan",
    action: `built expert packet ${positional[0] || options.round}`,
    result: `expert packet zip written to ${result.relativePacketZip}`,
    evidence: result.relativePacketZip,
    next_action: "Send the packet to the bounded expert reviewer or reconcile existing reviewer input.",
  });
  refreshStatus(context);

  writeLine(context, `Built expert packet zip: ${result.packetZip}`);
  writeLine(context, "Included zip entries:");
  for (const item of result.packetFiles) {
    writeLine(context, `- ${item}`);
  }
};
