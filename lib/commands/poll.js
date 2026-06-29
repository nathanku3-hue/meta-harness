"use strict";

const path = require("node:path");
const { fail, parseArgs } = require("../cli-args");
const { writeOut } = require("../cli-context");
const { HARNESS_DIR, harnessPath, nowIso, requireHarness } = require("../harness-state");
const { fileExists, readText } = require("../paths");
const { buildRepoRollup, renderRepoRollupMarkdown } = require("../repo-rollup");
const { readRepoIndex } = require("./repos");

function firstStatusLines(status) {
  const lines = status.split(/\r?\n/).filter((line) => line.trim().length > 0);
  return lines.slice(0, 12).join("\n");
}

function renderPoll(context) {
  requireHarness(context);
  const index = readRepoIndex(context);
  const sections = ["# Poll Summary", "", `Updated: ${nowIso()}`, "", "## Local", ""];
  const localStatusPath = harnessPath(context, "status.md");
  sections.push(fileExists(localStatusPath) ? firstStatusLines(readText(localStatusPath)) : "No local status found.");

  sections.push("", "## Child Repos", "");
  if (index.repos.length === 0) {
    sections.push("- none");
  } else {
    for (const repo of index.repos) {
      const childStatusPath = path.resolve(context.cwd, repo.path, HARNESS_DIR, "status.md");
      if (!fileExists(childStatusPath)) {
        sections.push(`### ${repo.name}`, "", `Missing status: ${childStatusPath}`, "");
      } else {
        sections.push(`### ${repo.name}`, "", firstStatusLines(readText(childStatusPath)), "");
      }
    }
  }

  return `${sections.join("\n")}\n`;
}

module.exports = async function runPoll(args, context) {
  const { options } = parseArgs(args);
  if (options.rollup) {
    requireHarness(context);
    if (options.write) {
      fail("poll --rollup is read-only; --write is not supported with --rollup");
    }
    const rollup = buildRepoRollup(context.cwd, { fs: context.fs });
    writeOut(
      context,
      options.json ? `${JSON.stringify(rollup, null, 2)}\n` : renderRepoRollupMarkdown(rollup)
    );
    return;
  }

  const poll = renderPoll(context);
  if (options.write) {
    context.fs.writeFileSync(harnessPath(context, "poll.md"), poll, "utf8");
  }
  writeOut(context, poll);
};
