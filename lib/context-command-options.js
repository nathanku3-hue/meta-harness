"use strict";

const { fail, optionValue } = require("./cli-args");
const { validateBypass } = require("./context-gate-adoption");

function overrideFromOptions(options) {
  const hasReason = options.overrideContextGate !== undefined;
  const hasCode = options.overrideContextGateCode !== undefined;
  if (!hasReason && !hasCode) return null;

  const validation = validateBypass({
    reason: optionValue(options.overrideContextGate),
    code: optionValue(options.overrideContextGateCode),
    actor: optionValue(options.actor, "human"),
  });
  if (!validation.ok) {
    fail(`invalid context gate override: ${validation.reason}`);
  }
  return validation.override;
}

module.exports = { overrideFromOptions };
