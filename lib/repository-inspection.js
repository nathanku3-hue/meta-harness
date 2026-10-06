"use strict";

const { writeOut } = require("./cli-context");
const { inspectProjectStartup } = require("./project-startup-context");
const {
  assertRepositoryEntryValid,
  publicRepositoryEntry,
  resolveRepositoryEntry,
} = require("./repository-entry");

function advisoryStartupContext(startupContext) {
  if (!startupContext || startupContext.status !== "BLOCKED") return startupContext;
  return Object.freeze({
    ...startupContext,
    status: "READY",
    blockers: Object.freeze([]),
  });
}

function renderRepositoryInspection(context, { json = false } = {}) {
  const entry = resolveRepositoryEntry(context.cwd);
  let startupContext = null;
  if (entry.repositoryRoot) {
    startupContext = advisoryStartupContext(inspectProjectStartup(entry.repositoryRoot));
  }

  if (json) {
    const publicEntry = publicRepositoryEntry(entry);
    // Startup context is diagnostic context, never execution authority.
    // Only publish it into meta-entry/v2 when it is actually usable. A stale,
    // oversized, missing, or otherwise BLOCKED projection must not become a
    // host-level stop for reversible in-scope work; callers can inspect the
    // declaration directly when they need the diagnostic details.
    const payload = startupContext?.status === "READY"
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

module.exports = { advisoryStartupContext, renderRepositoryInspection };
