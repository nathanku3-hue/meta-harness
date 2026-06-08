"use strict";

const { optionValue, parseArgs } = require("../cli-args");
const { writeLine } = require("../cli-context");
const {
  appendEvent,
  normalizePhase,
  normalizeStream,
  refreshStatus,
  requireHarness,
} = require("../harness-state");
const { fail } = require("../cli-args");

module.exports = async function runEvent(args, context) {
  const { options } = parseArgs(args);
  requireHarness(context);
  const stream = normalizeStream(options.stream);
  const phase = normalizePhase(options.phase);
  const action = optionValue(options.action);
  const result = optionValue(options.result);
  if (typeof action !== "string" || action.length === 0) {
    fail("event requires --action <text>");
  }
  if (typeof result !== "string" || result.length === 0) {
    fail("event requires --result <text>");
  }

  const event = appendEvent(context, {
    actor: options.actor || "human",
    stream,
    phase,
    action,
    result,
    evidence: options.evidence || options.verification,
    decision: options.decision,
    blocker: options.blocker,
    next_action: options.nextAction,
  });

  refreshStatus(context);
  writeLine(context, `Recorded event: ${event.stream}/${event.phase}`);
};
