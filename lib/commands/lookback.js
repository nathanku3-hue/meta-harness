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

function statusField(text, label) {
  const lines = String(text || "").replace(/\r\n/g, "\n").split("\n");
  const escaped = label.replace(/[.*+?^$\{\}()|[\]\\]/g, "\\$&");
  const labelPattern = new RegExp(`^${escaped}\\s*:\\s*$`, "i");
  const headingPattern = /^[A-Z][A-Za-z0-9 /_-]{1,60}\s*:\s*$/;
  const start = lines.findIndex((line) => labelPattern.test(line.trim()));
  if (start === -1) return "";
  const body = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (body.length > 0 && headingPattern.test(line.trim())) break;
    body.push(line);
  }
  return body.join("\n").trim();
}

function renderLookback(context) {
  const events = readEvents(context);
  const initEvent = events.find((event) => event.action === "initialized harness") || events[0] || {};
  let statusGoal = "";
  try {
    statusGoal = statusField(
      context.fs.readFileSync(harnessPath(context, "status.md"), "utf8"),
      "Goal",
    );
  } catch {
    statusGoal = "";
  }
  const lines = [
    "# Lookback",
    "",
    `Generated: ${nowIso()}`,
    "",
    "## Original Goal",
    "",
    initEvent.goal || statusGoal || "Not set.",
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
