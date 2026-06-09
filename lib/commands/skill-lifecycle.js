"use strict";

const { fail, requireTargetRoot } = require("../cli-args");
const { writeLine } = require("../cli-context");
const { promoteSkill, rollbackSkill } = require("../skill-promotion");

function jsonLine(context, payload) {
  writeLine(context, JSON.stringify(payload, null, 2));
}

function runLifecycle(positional, options, context, action, fn) {
  const skillName = positional[1];
  if (!skillName) {
    fail(`skill ${action} requires a skill name`);
  }
  const targetRoot = requireTargetRoot(options, context);
  const result = fn({
    targetRoot,
    skillName,
    decisionId: typeof options.decisionId === "string" ? options.decisionId : "",
    dryRun: Boolean(options.dryRun),
  });
  const payload = { schema_version: "1.0.0", ok: true, ...result };
  if (options.json) {
    jsonLine(context, payload);
  } else {
    writeLine(context, `${result.status}\t${result.skill}\t${result.from} -> ${result.to}`);
  }
  return { exitCode: 0 };
}

function runPromote(positional, options, context) {
  return runLifecycle(positional, options, context, "promote", promoteSkill);
}

function runRollback(positional, options, context) {
  return runLifecycle(positional, options, context, "rollback", rollbackSkill);
}

module.exports = { runPromote, runRollback };
