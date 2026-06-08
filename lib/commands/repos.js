"use strict";

const { ConfigError } = require("../errors");
const { fail, parseArgs } = require("../cli-args");
const { writeLine } = require("../cli-context");
const { readJsonFile: readJson, writeJsonFile: writeJson } = require("../json");
const { ensureHarness, harnessPath } = require("../harness-state");

function readRepoIndex(context) {
  ensureHarness(context);
  const index = readJson(harnessPath(context, "repos.json"), { repos: [] });
  if (!Array.isArray(index.repos)) {
    throw new ConfigError("repos.json must contain a repos array");
  }
  return index;
}

function writeRepoIndex(context, index) {
  writeJson(harnessPath(context, "repos.json"), index);
}

module.exports = async function runRepos(args, context) {
  const { positional, options } = parseArgs(args);
  const action = positional[0] || "list";
  const index = readRepoIndex(context);

  if (action === "list") {
    if (index.repos.length === 0) {
      writeLine(context, "No child repos registered.");
      return;
    }
    for (const repo of index.repos) {
      writeLine(context, `${repo.name}\t${repo.path}\t${repo.role || "child"}`);
    }
    return;
  }

  if (action === "add") {
    const name = positional[1];
    const repoPath = positional[2];
    if (!name || !repoPath) {
      fail("repos add requires <name> <path>");
    }
    const next = index.repos.filter((repo) => repo.name !== name);
    next.push({ name, path: repoPath, role: options.role || "child" });
    writeRepoIndex(context, { repos: next });
    writeLine(context, `Added repo: ${name}`);
    return;
  }

  if (action === "remove") {
    const name = positional[1];
    if (!name) {
      fail("repos remove requires <name>");
    }
    writeRepoIndex(context, { repos: index.repos.filter((repo) => repo.name !== name) });
    writeLine(context, `Removed repo: ${name}`);
    return;
  }

  fail(`unknown repos action: ${action}`);
};

module.exports.readRepoIndex = readRepoIndex;
