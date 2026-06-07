"use strict";

const { parseArgs } = require("../cli-args");
const { writeLine } = require("../cli-context");
const {
  HARNESS_DIR,
  STREAMS,
  appendEvent,
  ensureHarness,
  harnessPath,
  phaseMapTemplate,
  refreshStatus,
  readEvents,
  streamTemplate,
  workerReportTemplate,
} = require("../harness-state");
const { writeIfMissing } = require("../paths");

module.exports = async function runInit(args, context) {
  const { positional, options } = parseArgs(args);
  const goal = options.goal || positional.join(" ") || "Not set.";

  ensureHarness(context);
  writeIfMissing(harnessPath(context, "phase-map.md"), phaseMapTemplate());
  writeIfMissing(harnessPath(context, "workers", "worker-report-template.md"), workerReportTemplate());
  for (const stream of STREAMS) {
    writeIfMissing(harnessPath(context, "streams", `${stream}.md`), streamTemplate(stream));
  }

  const events = readEvents(context);
  if (events.length === 0) {
    appendEvent(context, {
      actor: options.actor || "human",
      stream: "coding",
      phase: "intake",
      action: "initialized harness",
      goal,
      result: "per-repo harness state created",
      evidence: ".meta-harness starter files exist",
      next_action: options.nextAction || "Translate the goal into a bounded worker task.",
      stop_criteria: options.stopCriteria || "Fresh human and Codex worker can resume from local harness state.",
    });
  }

  refreshStatus(context);
  writeLine(context, `Initialized ${HARNESS_DIR}`);
  writeLine(context, harnessPath(context, "status.md"));
};
