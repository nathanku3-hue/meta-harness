"use strict";

const { writeOut } = require("./cli-context");
const { inspectProjectStartup } = require("./project-init");
const {
  assertRepositoryEntryValid,
  publicRepositoryEntry,
  resolveRepositoryEntry,
} = require("./repository-entry");

function renderRepositoryInspection(context, { json = false } = {}) {
  const entry = resolveRepositoryEntry(context.cwd);
  let startupContext = null;
  if (entry.repositoryRoot) {
    startupContext = inspectProjectStartup(entry.repositoryRoot);
  }

  if (json) {
    const publicEntry = publicRepositoryEntry(entry);
    const payload = startupContext
      ? {
          schemaVersion: "meta-entry/v2",
          action: publicEntry.action,
          result: publicEntry.result,
          startupContext,
        }
      : publicEntry;
    writeOut(context, `${JSON.stringify(payload, null, 2)}\n`);
    return;
  }

  assertRepositoryEntryValid(entry);
  if (entry.action === "CONTINUE") {
    writeOut(context, `State: active\n${entry.result ? `Result: ${entry.result}\n` : ""}Next: continuation is automatic.\n`);
    return;
  }
  writeOut(context, "State: idle\nNext: state a product result when something is worth changing.\n");
}

module.exports = { renderRepositoryInspection };
