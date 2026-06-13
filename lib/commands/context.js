"use strict";
const path = require("node:path");
const { fail, optionValue, parseArgs, requireTargetRoot } = require("../cli-args");
const { writeLine, writeOut } = require("../cli-context");
const { UsageError } = require("../errors");
const { PHASES, requireHarness } = require("../harness-state");
const { overrideFromOptions } = require("../context-command-options");
const { readContextQuestions } = require("../context-questions");
const PACKET_AUDIENCES = new Set(["worker", "review", "planning"]);

function loadCore(modulePath, exportNames, label) {
  let core;
  try {
    core = require(modulePath);
  } catch (error) {
    if (error && error.code === "MODULE_NOT_FOUND" && String(error.message).includes(modulePath)) {
      throw new UsageError(`${label} core is not available yet (${modulePath})`);
    }
    throw error;
  }

  for (const name of exportNames) {
    if (typeof core[name] === "function") {
      return core[name];
    }
  }
  throw new UsageError(`${label} core does not export one of: ${exportNames.join(", ")}`);
}

function transitionFromOptions(options) {
  if (options.transition !== undefined) {
    fail("use --from <phase> --to <phase>; --transition is not supported");
  }

  const from = optionValue(options.from);
  const to = optionValue(options.to);
  if (!from || from === true) fail("context check requires --from <phase>");
  if (!to || to === true) fail("context check requires --to <phase>");
  if (!PHASES.includes(from)) fail(`invalid --from phase "${from}". Expected one of: ${PHASES.join(", ")}`);
  if (!PHASES.includes(to)) fail(`invalid --to phase "${to}". Expected one of: ${PHASES.join(", ")}`);
  if (PHASES.indexOf(to) !== PHASES.indexOf(from) + 1) {
    fail(`invalid transition ${from}->${to}; expected adjacent phases in order`);
  }
  return { from, to, transition: `${from}->${to}` };
}

function roundFromValue(value, label) {
  const roundId = optionValue(value);
  if (!roundId || roundId === true) {
    fail(`${label} requires a round ID`);
  }
  if (!/^ROUND-\d{3,}$/.test(roundId)) {
    fail(`invalid round ID "${roundId}". Expected ROUND-NNN`);
  }
  return roundId;
}

function writeJson(context, payload) {
  writeOut(context, `${JSON.stringify(payload, null, 2)}\n`);
}

function resolveContextTargetRoot(options, context) {
  const targetRoot = options.target === undefined
    ? path.resolve(context.cwd)
    : requireTargetRoot(options, context);
  requireHarness({ ...context, cwd: targetRoot });
  return targetRoot;
}

function printCheckResult(context, result) {
  if (typeof result === "string") {
    writeOut(context, result.endsWith("\n") ? result : `${result}\n`);
    return;
  }
  if (result?.markdown) {
    writeOut(context, result.markdown.endsWith("\n") ? result.markdown : `${result.markdown}\n`);
    return;
  }
  const artifact = result?.artifact || result?.gate || result;
  writeLine(context, `CONTEXT CHECK: ${artifact?.verdict || "complete"} ${artifact?.transition || ""}`.trim());
  if (artifact?.round_id) writeLine(context, `Round: ${artifact.round_id}`);
  if (artifact?.overall_score !== undefined) writeLine(context, `Score: ${artifact.overall_score}`);
  if (Array.isArray(artifact?.questions) && artifact.questions.length > 0) {
    writeLine(context, "Questions:");
    for (const question of artifact.questions.slice(0, 3)) {
      writeLine(context, `- ${question}`);
    }
  }
}

async function runCheck(args, context) {
  const { options } = parseArgs(args);
  const targetRoot = resolveContextTargetRoot(options, context);
  const transition = transitionFromOptions(options);
  const roundId = options.round === undefined ? undefined : roundFromValue(options.round, "--round");
  const overrideContextGate = overrideFromOptions(options);
  const runContextGateCheck = loadCore("../context-gate", ["runContextGate", "runContextGateCheck", "runContextCheck", "checkContextGate", "contextCheck"], "context gate");

  const result = await runContextGateCheck({
    cwd: context.cwd,
    targetRoot,
    from: transition.from,
    to: transition.to,
    transition: transition.transition,
    roundId,
    out: optionValue(options.out),
    commitArtifact: Boolean(options.commitArtifact), explain: Boolean(options.explain), json: Boolean(options.json),
    overrideContextGate,
    options,
  });

  if (overrideContextGate) {
    context.stderr.write(`WARNING: Context gate overridden: ${overrideContextGate.reason}\n`);
  }

  if (options.json) {
    const payload = options.explain && result?.artifact ? { artifact: result.artifact, explanation: result.explanation || null, provenance: result.provenance || null, remediation: result.remediation || "" } : result?.artifact || result?.gate || result;
    writeJson(context, payload);
  } else {
    printCheckResult(context, result);
    if (options.explain && result?.diagnostic) writeLine(context, `\n${result.diagnostic}`);
  }
}

async function runPacket(args, context) {
  const { positional, options } = parseArgs(args);
  const targetRoot = resolveContextTargetRoot(options, context);
  const roundId = roundFromValue(positional[0], "context packet");
  const audience = optionValue(options.for);
  if (!audience || audience === true) fail("context packet requires --for <worker|review|planning>");
  if (!PACKET_AUDIENCES.has(audience)) {
    fail(`invalid --for value "${audience}". Expected worker, review, or planning`);
  }

  const buildContextPacket = loadCore("../context-packet", ["buildContextPacket", "createContextPacket", "runContextPacket", "contextPacket"], "context packet");

  const result = await buildContextPacket({
    cwd: context.cwd,
    targetRoot,
    roundId,
    audience,
    out: optionValue(options.out),
    json: Boolean(options.json),
    options,
  });

  if (options.json) {
    if (typeof result === "string") {
      writeJson(context, { round_id: roundId, for: audience, packet_markdown: result });
    } else {
      const packetMarkdown = result?.packet_markdown || result?.markdown || result?.packet || "";
      writeJson(context, { round_id: result?.round_id || roundId, for: result?.for || audience, ...result, packet_markdown: packetMarkdown });
    }
    return;
  }
  writeOut(context, typeof result === "string" ? (result.endsWith("\n") ? result : `${result}\n`) : `${result.packet_markdown || result.markdown || ""}\n`);
}

async function runAsk(args, context) {
  const { positional, options } = parseArgs(args);
  const targetRoot = resolveContextTargetRoot(options, context);
  const roundId = roundFromValue(positional[0], "context ask");
  const result = readContextQuestions(targetRoot, roundId);

  if (options.json) {
    writeJson(context, result);
    return;
  }
  if (result.questions.length === 0) {
    writeLine(context, `No context questions for ${roundId}.`);
    return;
  }
  for (const question of result.questions) {
    writeLine(context, `- ${question}`);
  }
}

module.exports = async function runContext(args, context) {
  const [subcommand, ...rest] = args;
  const handler = { check: runCheck, packet: runPacket, ask: runAsk }[subcommand];
  if (handler) return handler(rest, context);
  fail("usage: meta-harness context <check|packet|ask>");
};
