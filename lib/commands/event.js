"use strict";

const fs = require("node:fs");
const path = require("node:path");

const { fail, optionValue, parseArgs } = require("../cli-args");
const { writeLine } = require("../cli-context");
const { ConfigError } = require("../errors");
const {
  appendEvent,
  normalizePhase,
  normalizeStream,
  refreshStatus,
  requireHarness,
} = require("../harness-state");
const { appendCanonicalReceipt } = require("../truth-mutation");

function readAuthorityReceipt(context, value) {
  if (!value || value === true) fail("event --canonical requires --authority-receipt-file <path>");
  const filePath = path.resolve(context.cwd, String(value));
  let receipt;
  try {
    receipt = JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    throw new ConfigError(`authority receipt is unreadable or invalid JSON: ${error.message}`, {
      code: "MH_TRUTH_AUTHORITY",
      exitCode: 1,
    });
  }
  return receipt;
}

module.exports = async function runEvent(args, context) {
  const { options } = parseArgs(args);
  requireHarness(context);

  if (options.canonical) {
    for (const forbidden of ["actor", "authority", "goal", "stopCriteria", "nextAction", "result", "action", "phase", "stream"]) {
      if (options[forbidden] !== undefined) {
        fail("canonical event content comes only from --authority-receipt-file");
      }
    }
    const receipt = readAuthorityReceipt(context, optionValue(options.authorityReceiptFile));
    const event = appendCanonicalReceipt(context, receipt);
    refreshStatus(context);
    writeLine(context, `Recorded canonical event: ${event.stream}/${event.phase}`);
    return;
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

  refreshStatus(context);
  writeLine(context, `Recorded event: ${event.stream}/${event.phase}`);
};
