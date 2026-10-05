"use strict";

const INTERNAL_COMMAND_NAMES = Object.freeze([
  "brief",
  "context",
  "contract",
  "decisions",
  "dirty",
  "distill",
  "domain-governance",
  "event",
  "expert-packet",
  "gate",
  "governance",
  "init",
  "layout",
  "lookback",
  "mcp",
  "merge",
  "poll",
  "portfolio",
  "quality",
  "ready",
  "repos",
  "skill",
  "state",
  "status",
  "sync",
  "templates",
  "trust",
  "work",
  "worker-report",
]);

const INTERNAL_COMMAND_SET = new Set(INTERNAL_COMMAND_NAMES);

function isInternalCommandName(value) {
  return INTERNAL_COMMAND_SET.has(String(value || ""));
}

function renderHelp({ advanced = false } = {}) {
  if (!advanced) {
    return `meta-harness

A coding system that carries one accepted product result into code, validation, repair, and a locally banked result.

Usage:
  meta-harness "<result>"
  meta-harness
  meta-harness inspect

State the software result once. With no result, Meta-Harness continues the mechanically correct active work or stops.
Normal work does not require workflow commands, session selection, resume flags, validation selection, or commit decisions.
Use \`meta-harness inspect\` only when you want a coarse diagnostic view.
`;
  }
  return `meta-harness diagnostics

The product CLI has no advanced workflow console.

Usage:
  meta-harness inspect

Historical workflow commands are source-only maintenance tools. They are not part of the packaged product surface.
`;
}

module.exports = {
  INTERNAL_COMMAND_NAMES,
  isInternalCommandName,
  renderHelp,
};
