"use strict";

const { fail, optionValue, parseArgs } = require("../cli-args");
const { writeLine } = require("../cli-context");
const {
  appendEvent,
  normalizePhase,
  normalizeStream,
  requireHarness,
} = require("../harness-state");

module.exports = async function runEvent(args, context) {
  const { options } = parseArgs(args);
  requireHarness(context);

  if (options.canonical || options.authorityReceiptFile !== undefined || options.authority !== undefined) {
    fail("pre-0.4 canonical event mutation is unsupported; closure will use deterministic terminal projection");
  }

  const stream = normalizeStream(options.stream);
  const phase = normalizePhase(options.phase);
  const action = optionValue(options.action);
  const result = optionValue(options.result);
  if (typeof action !== "string" || action.length === 0) fail("event requires --action <text>");
  if (typeof result !== "string" || result.length === 0) fail("event requires --result <text>");

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

  writeLine(context, `Recorded advisory event: ${event.stream}/${event.phase}`);
  writeLine(context, "Product acceptance and canonical state were not evaluated.");
};
