"use strict";

const fs = require("node:fs");
const path = require("node:path");

const { UsageError } = require("./errors");

function slashPath(cwd, filePath) {
  return path.relative(cwd, filePath).split(path.sep).join("/");
}

function contextArtifactPaths(cwd, roundId) {
  return [
    path.join(cwd, ".meta-harness", "local", "context", `${roundId}.json`),
    path.join(cwd, ".meta-harness", "context", `${roundId}.json`),
  ];
}

function readContextQuestions(cwd, roundId) {
  for (const artifactPath of contextArtifactPaths(cwd, roundId)) {
    if (!fs.existsSync(artifactPath)) continue;
    let artifact;
    try {
      artifact = JSON.parse(fs.readFileSync(artifactPath, "utf8"));
    } catch (error) {
      throw new UsageError(`malformed context artifact ${slashPath(cwd, artifactPath)}: ${error.message}`);
    }
    return {
      round_id: artifact.round_id || roundId,
      verdict: artifact.verdict || "unknown",
      questions: Array.isArray(artifact.questions) ? artifact.questions.slice(0, 3) : [],
      source: slashPath(cwd, artifactPath),
    };
  }
  throw new UsageError(`context artifact not found for ${roundId}`);
}

module.exports = {
  readContextQuestions,
};
