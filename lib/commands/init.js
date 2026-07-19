"use strict";

const fs = require("node:fs");
const path = require("node:path");

const { withBootstrapLock } = require("../bootstrap-lock");
const { fail, optionValue, parseArgs } = require("../cli-args");
const { writeLine } = require("../cli-context");
const { ConfigError } = require("../errors");
const {
  HARNESS_DIR,
  STREAMS,
  ensureHarness,
  harnessPath,
  phaseMapTemplate,
  refreshStatus,
  streamTemplate,
  workerReportTemplate,
} = require("../harness-state");
const { writeIfMissing } = require("../paths");
const { installPublicAuthority } = require("../truth-authority");
const {
  appendCanonicalReceipt,
  preflightInitialCanonicalReceipt,
} = require("../truth-mutation");
const {
  assertContainedPath,
  assertHarnessAbsent,
  assertRepositoryRoot,
} = require("../truth-paths");

function readJsonInput(context, value, label, optionName) {
  if (!value || value === true) fail(`init requires ${optionName} <path>`);
  const filePath = path.resolve(context.cwd, String(value));
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    throw new ConfigError(`${label} is unreadable or invalid JSON: ${error.message}`, {
      code: "MH_TRUTH_AUTHORITY",
      exitCode: 1,
    });
  }
}

function writeStarterFiles(context) {
  ensureHarness(context);
  writeIfMissing(harnessPath(context, "phase-map.md"), phaseMapTemplate());
  writeIfMissing(harnessPath(context, "workers", "worker-report-template.md"), workerReportTemplate());
  for (const stream of STREAMS) {
    writeIfMissing(harnessPath(context, "streams", `${stream}.md`), streamTemplate(stream));
  }
}

function promoteBootstrap(context, authorityDocument, receipt) {
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
    installPublicAuthority(stageRoot, authorityDocument);
    appendCanonicalReceipt(stageContext, receipt, { requireInitialSnapshot: true });
    refreshStatus(stageContext);
    assertHarnessAbsent(root);
    fs.renameSync(stagedHarness, targetHarness);
  } finally {
    fs.rmSync(stageRoot, { recursive: true, force: true });
  }
}

module.exports = async function runInit(args, context) {
  const { positional, options } = parseArgs(args);
  if (positional.length > 0
    || options.goal !== undefined
    || options.actor !== undefined
    || options.nextAction !== undefined
    || options.stopCriteria !== undefined) {
    fail("initial canonical content comes only from --authority-receipt-file");
  }

  const { root } = assertRepositoryRoot(context.cwd);
  assertHarnessAbsent(root);

  const authorityDocument = readJsonInput(
    context,
    optionValue(options.authorityPublicKeyFile),
    "truth authority public key",
    "--authority-public-key-file",
  );
  const receipt = readJsonInput(
    context,
    optionValue(options.authorityReceiptFile),
    "authority receipt",
    "--authority-receipt-file",
  );

  preflightInitialCanonicalReceipt(context, authorityDocument, receipt);
  withBootstrapLock(context, () => {
    assertHarnessAbsent(root);
    preflightInitialCanonicalReceipt(context, authorityDocument, receipt);
    promoteBootstrap(context, authorityDocument, receipt);
  });

  writeLine(context, `Initialized ${HARNESS_DIR}`);
  writeLine(context, harnessPath(context, "status.md"));
};
