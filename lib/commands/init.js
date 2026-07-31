"use strict";

const fs = require("node:fs");
const path = require("node:path");

const { withBootstrapLock } = require("../bootstrap-lock");
const { fail, parseArgs } = require("../cli-args");
const { writeLine } = require("../cli-context");
const {
  HARNESS_DIR,
  STREAMS,
  ensureHarness,
  harnessPath,
  phaseMapTemplate,
  streamTemplate,
  workerReportTemplate,
} = require("../harness-state");
const { writeIfMissing } = require("../paths");
const { renderCanonicalStatus } = require("../truth-reconciler");
const {
  assertContainedPath,
  assertHarnessAbsent,
  assertRepositoryRoot,
} = require("../truth-paths");

function writeStarterFiles(context) {
  ensureHarness(context);
  writeIfMissing(harnessPath(context, "phase-map.md"), phaseMapTemplate());
  writeIfMissing(harnessPath(context, "workers", "worker-report-template.md"), workerReportTemplate());
  for (const stream of STREAMS) {
    writeIfMissing(harnessPath(context, "streams", `${stream}.md`), streamTemplate(stream));
  }
  writeIfMissing(harnessPath(context, "status.md"), renderCanonicalStatus());
}

function promoteBootstrap(context) {
  const { root } = assertRepositoryRoot(context.cwd);
  const targetHarness = assertHarnessAbsent(root);
  const stageRoot = fs.mkdtempSync(path.join(root, ".meta-harness-bootstrap-"));
  const stageContext = { ...context, cwd: stageRoot };
  const stagedHarness = path.join(stageRoot, HARNESS_DIR);

  try {
    assertContainedPath(root, stageRoot, {
      leafType: "directory",
      label: "bootstrap staging directory",
    });
    writeStarterFiles(stageContext);
    assertHarnessAbsent(root);
    fs.renameSync(stagedHarness, targetHarness);
  } finally {
    fs.rmSync(stageRoot, { recursive: true, force: true });
  }
}

module.exports = async function runInit(args, context) {
  const { positional, options } = parseArgs(args);
  if (positional.length > 0 || Object.keys(options).length > 0) {
    fail("init accepts no authority receipt, public key, state-root, repository-id, or clock options");
  }

  const { root } = assertRepositoryRoot(context.cwd);
  assertHarnessAbsent(root);
  withBootstrapLock(context, () => {
    assertHarnessAbsent(root);
    promoteBootstrap(context);
  });

  writeLine(context, `Initialized advisory ${HARNESS_DIR} files.`);
  writeLine(context, "Run `meta-harness authority bootstrap --owner-public-key-file <path>` to install the external owner pin.");
};
