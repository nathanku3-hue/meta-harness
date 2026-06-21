"use strict";

const { spawnSync } = require("node:child_process");
const { fail, parseArgs } = require("../cli-args");
const { writeLine } = require("../cli-context");
const { copyPackagedTemplates, templateFiles } = require("../templates");
const { ensureHarness, harnessPath, refreshStatus, workerReportTemplate } = require("../harness-state");
const { fileExists, writeIfMissing, writeTextAtomic } = require("../paths");

function checkDirtyGitWorktree(cwd) {
  try {
    const result = spawnSync("git", ["status", "--porcelain"], {
      cwd,
      encoding: "utf8",
      shell: false,
      stdio: ["ignore", "pipe", "ignore"],
    });
    if (!result.error && result.status === 0 && result.stdout.trim().length > 0) {
      fail("Repository is dirty. Please commit or stash changes, or run with --allow-dirty.");
    }
  } catch (_) {
    // Preserve the historical best-effort dirty check: install remains usable outside clean git repos.
  }
}

module.exports = async function runTemplates(args, context) {
  const { positional, options } = parseArgs(args);
  const action = positional[0] || "list";

  if (action === "list") {
    const files = templateFiles();
    if (files.length === 0) {
      writeLine(context, "No packaged templates found.");
      return;
    }
    for (const template of files) {
      writeLine(context, `${template.category}\t${template.filename}`);
    }
    return;
  }

  if (action === "install") {
    if (!options.allowDirty) {
      checkDirtyGitWorktree(context.cwd);
    }
    const statusPath = harnessPath(context, "status.md");
    const hadStatus = fileExists(statusPath);
    ensureHarness(context);
    const destinationRoot = harnessPath(context, "templates");
    const overwrite = Boolean(options.overwrite);
    const copied = copyPackagedTemplates(destinationRoot, overwrite);
    const workerTemplatePath = harnessPath(context, "workers", "worker-report-template.md");
    if (overwrite) {
      writeTextAtomic(workerTemplatePath, workerReportTemplate());
    } else {
      writeIfMissing(workerTemplatePath, workerReportTemplate());
    }
    if (!hadStatus) {
      refreshStatus(context);
    }
    writeLine(context, `Installed templates into ${destinationRoot}`);
    for (const item of copied) {
      writeLine(context, `- ${item}`);
    }
    if (copied.length === 0) {
      writeLine(context, "- none; existing templates kept");
    }
    return;
  }

  fail(`unknown templates action: ${action}`);
};
