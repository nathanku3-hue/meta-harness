"use strict";

const fs = require("node:fs");
const path = require("node:path");

const { validateContextGateArtifactDoc } = require("./context-gate-validation");

function normalizeRelativePath(value) {
  return value.split(/[\\/]+/).join("/");
}

function listContextGateArtifacts(targetRoot) {
  const roots = [
    path.join(targetRoot, ".meta-harness", "local", "context"),
    path.join(targetRoot, ".meta-harness", "context"),
  ];
  const artifacts = [];

  for (const dir of roots) {
    if (!fs.existsSync(dir)) continue;
    const stat = fs.statSync(dir);
    if (!stat.isDirectory()) continue;

    for (const item of fs.readdirSync(dir).sort((left, right) => left.localeCompare(right))) {
      const match = item.match(/^ROUND-(\d{3,})\.json$/);
      if (!match) continue;
      const artifactPath = path.join(dir, item);
      const artifactStat = fs.statSync(artifactPath);
      if (!artifactStat.isFile()) continue;
      artifacts.push({
        path: artifactPath,
        relativePath: normalizeRelativePath(path.relative(targetRoot, artifactPath)),
        roundNumber: Number.parseInt(match[1], 10),
        roundId: `ROUND-${match[1]}`,
      });
    }
  }

  return artifacts;
}

function parseContextGateCandidate(candidate) {
  try {
    const doc = JSON.parse(fs.readFileSync(candidate.path, "utf8"));
    const generatedAtMs = typeof doc?.generated_at === "string" ? Date.parse(doc.generated_at) : Number.NEGATIVE_INFINITY;
    return {
      ...candidate,
      doc,
      generatedAtMs: Number.isFinite(generatedAtMs) ? generatedAtMs : Number.NEGATIVE_INFINITY,
      parseError: null,
    };
  } catch (error) {
    return {
      ...candidate,
      doc: null,
      generatedAtMs: Number.NEGATIVE_INFINITY,
      parseError: error,
    };
  }
}

function sortContextGateCandidates(candidates) {
  return candidates.sort((left, right) => {
    if (right.roundNumber !== left.roundNumber) {
      return right.roundNumber - left.roundNumber;
    }
    if (right.generatedAtMs !== left.generatedAtMs) {
      return right.generatedAtMs - left.generatedAtMs;
    }
    return left.relativePath.localeCompare(right.relativePath);
  });
}

function selectLatestContextGateArtifact(targetRoot, options = {}) {
  const artifacts = listContextGateArtifacts(targetRoot);
  if (artifacts.length === 0) return null;

  const parsed = artifacts.map(parseContextGateCandidate);
  if (options.expectedTransition) {
    const matching = parsed.filter((artifact) =>
      !artifact.parseError &&
      artifact.doc &&
      artifact.doc.transition === options.expectedTransition
    );
    if (matching.length === 0) {
      return {
        missingExpected: true,
        expectedTransition: options.expectedTransition,
        artifactCount: artifacts.length,
      };
    }
    return sortContextGateCandidates(matching)[0];
  }

  const highestRound = Math.max(...artifacts.map((artifact) => artifact.roundNumber));
  return sortContextGateCandidates(parsed.filter((artifact) => artifact.roundNumber === highestRound))[0];
}

function buildContextGateEvaluation(options) {
  return require("./ready-context-gate-evaluation").buildContextGateEvaluation(options);
}

function checkContextGateArtifact(options) {
  return require("./ready-context-gate-evaluation").checkContextGateArtifact(options);
}

module.exports = {
  buildContextGateEvaluation,
  checkContextGateArtifact,
  selectLatestContextGateArtifact,
  validateContextGateArtifactDoc,
};
