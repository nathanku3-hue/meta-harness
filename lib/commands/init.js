"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

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

function requiresBootstrap(context) {
  const eventsPath = path.join(context.cwd, HARNESS_DIR, "events.jsonl");
  return !fs.existsSync(eventsPath) || fs.readFileSync(eventsPath, "utf8").trim().length === 0;
}

function withBootstrapLock(context, operation) {
  const lockPath = path.join(path.resolve(context.cwd), ".meta-harness-bootstrap.lock");
  let descriptor;
  try {
    descriptor = fs.openSync(lockPath, "wx");
  } catch (error) {
    if (!error || error.code !== "EEXIST") throw error;
    throw new ConfigError("truth authority bootstrap is already in progress", {
      code: "MH_TRUTH_AUTHORITY",
      exitCode: 1,
    });
  }
  try {
    return operation();
  } finally {
    fs.closeSync(descriptor);
    fs.unlinkSync(lockPath);
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
  const root = path.resolve(context.cwd);
  const targetHarness = path.join(root, HARNESS_DIR);
  const stageRoot = fs.mkdtempSync(path.join(root, ".meta-harness-bootstrap-"));
  const stageContext = { ...context, cwd: stageRoot };
  const stagedHarness = path.join(stageRoot, HARNESS_DIR);
  const backupHarness = path.join(root, `.meta-harness-backup-${crypto.randomUUID()}`);
  let targetMoved = false;

  try {
    if (fs.existsSync(targetHarness)) {
      fs.cpSync(targetHarness, stagedHarness, { recursive: true });
    }
    writeStarterFiles(stageContext);
    installPublicAuthority(stageRoot, authorityDocument);
    appendCanonicalReceipt(stageContext, receipt, { requireInitialSnapshot: true });
    refreshStatus(stageContext);

    if (fs.existsSync(targetHarness)) {
      fs.renameSync(targetHarness, backupHarness);
      targetMoved = true;
    }
    try {
      fs.renameSync(stagedHarness, targetHarness);
    } catch (error) {
      if (targetMoved) {
        fs.renameSync(backupHarness, targetHarness);
        targetMoved = false;
      }
      throw error;
    }
    if (targetMoved) fs.rmSync(backupHarness, { recursive: true, force: true });
  } finally {
    fs.rmSync(stageRoot, { recursive: true, force: true });
    if (targetMoved && !fs.existsSync(targetHarness) && fs.existsSync(backupHarness)) {
      fs.renameSync(backupHarness, targetHarness);
    }
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

  const bootstrapRequired = requiresBootstrap(context);
  const authorityInputProvided = options.authorityPublicKeyFile !== undefined
    || options.authorityReceiptFile !== undefined;
  if (!bootstrapRequired && authorityInputProvided) {
    throw new ConfigError("initial canonical state already exists", {
      code: "MH_TRUTH_AUTHORITY",
      exitCode: 1,
    });
  }
  let authorityDocument;
  let receipt;
  if (bootstrapRequired) {
    authorityDocument = readJsonInput(
      context,
      optionValue(options.authorityPublicKeyFile),
      "truth authority public key",
      "--authority-public-key-file",
    );
    receipt = readJsonInput(
      context,
      optionValue(options.authorityReceiptFile),
      "authority receipt",
      "--authority-receipt-file",
    );
  }

  if (bootstrapRequired) {
    preflightInitialCanonicalReceipt(context, authorityDocument, receipt);
    withBootstrapLock(context, () => {
      if (!requiresBootstrap(context)) {
        throw new ConfigError("initial canonical state was created by another bootstrap", {
          code: "MH_TRUTH_AUTHORITY",
          exitCode: 1,
        });
      }
      preflightInitialCanonicalReceipt(context, authorityDocument, receipt);
      promoteBootstrap(context, authorityDocument, receipt);
    });
  } else {
    writeStarterFiles(context);
    refreshStatus(context);
  }
  writeLine(context, `Initialized ${HARNESS_DIR}`);
  writeLine(context, harnessPath(context, "status.md"));
};
