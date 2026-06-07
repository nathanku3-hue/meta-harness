"use strict";

const { parseArgs } = require("../cli-args");
const { writeOut } = require("../cli-context");
const {
  eventTime,
  fieldFromLatest,
  harnessPath,
  listOrNone,
  nowIso,
  readEvents,
  requireHarness,
} = require("../harness-state");

function renderLookback(context) {
  const events = readEvents(context);
  const initEvent = events.find((event) => event.action === "initialized harness") || events[0] || {};
  const lines = [
    "# Lookback",
    "",
    `Generated: ${nowIso()}`,
    "",
    "## Original Goal",
    "",
    initEvent.goal || "Not set.",
    "",
    "## Timeline",
    "",
  ];

  if (events.length === 0) {
    lines.push("- no events recorded");
  } else {
    for (const event of events) {
      lines.push(`- ${eventTime(event)} | ${event.stream || "unknown"} | ${event.phase || "unknown"} | ${event.action || "no action"} -> ${event.result || "no result"}`);
    }
  }

  const decisions = events.filter((event) => event.decision);
  lines.push("", "## Decisions", "", listOrNone(decisions.map((event) => `${eventTime(event)}: ${event.decision}`)));

  const blockers = events.filter((event) => event.blocker);
  lines.push("", "## Blockers", "", listOrNone(blockers.map((event) => `${event.stream}: ${event.blocker}`)));

  lines.push("", "## Current Next Action", "", fieldFromLatest(events, "next_action", "Plan the next bounded worker task."));
  return `${lines.join("\n")}\n`;
}

module.exports = async function runLookback(args, context) {
  const { options } = parseArgs(args);
  requireHarness(context);
  const lookback = renderLookback(context);
  if (options.write) {
    context.fs.writeFileSync(harnessPath(context, "lookback.md"), lookback, "utf8");
  }
  writeOut(context, lookback);
};
