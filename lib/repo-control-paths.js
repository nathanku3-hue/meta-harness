"use strict";

const fs = require("node:fs");
const path = require("node:path");

const { ConfigError } = require("./errors");

const REPO_CHARTER_RELATIVE_PATH = path.join(".meta-harness", "repo-charter.json");

function repoPlannerEnabled(repositoryPath) {
  const charterPath = path.resolve(repositoryPath, REPO_CHARTER_RELATIVE_PATH);
  try {
    const stat = fs.lstatSync(charterPath);
    return stat.isFile() && !stat.isSymbolicLink();
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw new ConfigError(`repo charter is unreadable: ${error.message}`, {
      code: "MH_PLANNER_INPUT_READ",
    });
  }
}

module.exports = {
  repoPlannerEnabled,
};
