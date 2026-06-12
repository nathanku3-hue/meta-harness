"use strict";

const fs = require("node:fs");
const path = require("node:path");

const { scanTextForSecrets } = require("./redaction-check");
const {
  ARTIFACT_PATTERN,
  CONTEXT_LOCAL_DIR,
  CONTEXT_TRACKED_DIR,
} = require("./context-gate-constants");
const {
  fail,
  isInsidePath,
  parseIsoDate,
  repoRelative,
  safeRoundId,
  slashPath,
} = require("./context-gate-utils");
const { validateContextGateArtifact } = require("./context-gate-validation");

function defaultRoundId(cwd) {
  let maxRound = 0;
  for (const relDir of [CONTEXT_LOCAL_DIR, CONTEXT_TRACKED_DIR]) {
    const directory = path.join(cwd, relDir);
    if (!fs.existsSync(directory) || !fs.statSync(directory).isDirectory()) {
      continue;
    }
    for (const entry of fs.readdirSync(directory)) {
      const match = entry.match(ARTIFACT_PATTERN);
      if (match) {
        maxRound = Math.max(maxRound, Number(match[1]));
      }
    }
  }
  return `ROUND-${String(maxRound + 1).padStart(3, "0")}`;
}

function outputPaths(options) {
  const cwd = path.resolve(options.cwd || options.targetRoot || process.cwd());
  const roundId = safeRoundId(options.roundId);
  const trackedDir = path.resolve(cwd, CONTEXT_TRACKED_DIR);
  let jsonPath;
  let markdownPath;

  if (options.out) {
    const resolvedOut = path.resolve(cwd, String(options.out));
    if (!isInsidePath(resolvedOut, cwd)) {
      fail(`context output path must stay inside the repository: ${options.out}`);
    }
    const ext = path.extname(resolvedOut).toLowerCase();
    if (ext === ".json") {
      jsonPath = resolvedOut;
      markdownPath = path.join(path.dirname(resolvedOut), `${path.basename(resolvedOut, ext)}.md`);
    } else if (ext === ".md") {
      markdownPath = resolvedOut;
      jsonPath = path.join(path.dirname(resolvedOut), `${path.basename(resolvedOut, ext)}.json`);
    } else {
      jsonPath = path.join(resolvedOut, `${roundId}.json`);
      markdownPath = path.join(resolvedOut, `${roundId}.md`);
    }
  } else {
    const baseDir = options.commitArtifact
      ? path.join(cwd, CONTEXT_TRACKED_DIR)
      : path.join(cwd, CONTEXT_LOCAL_DIR);
    jsonPath = path.join(baseDir, `${roundId}.json`);
    markdownPath = path.join(baseDir, `${roundId}.md`);
  }

  if (!options.commitArtifact && (isInsidePath(jsonPath, trackedDir) || isInsidePath(markdownPath, trackedDir))) {
    fail("refusing to write context artifacts under .meta-harness/context without --commit-artifact");
  }

  return { jsonPath, markdownPath };
}

function assertCommittedArtifactClean(cwd, jsonPath, jsonString, markdownPath, markdownString) {
  const jsonResult = scanTextForSecrets(jsonString, { path: repoRelative(cwd, jsonPath) });
  const markdownResult = scanTextForSecrets(markdownString, { path: repoRelative(cwd, markdownPath) });
  const findings = [...(jsonResult.findings || []), ...(markdownResult.findings || [])];
  if (findings.length > 0) {
    fail(`Redaction check failed for committed context artifact: ${findings.map((finding) => finding.id).join(", ")}`);
  }
}

function contextArtifactCandidates(cwd) {
  const candidates = [];
  for (const relDir of [CONTEXT_LOCAL_DIR, CONTEXT_TRACKED_DIR]) {
    const directory = path.join(cwd, relDir);
    if (!fs.existsSync(directory) || !fs.statSync(directory).isDirectory()) {
      continue;
    }
    for (const entry of fs.readdirSync(directory)) {
      const match = entry.match(ARTIFACT_PATTERN);
      if (!match) {
        continue;
      }
      candidates.push({
        roundNumber: Number(match[1]),
        roundId: `ROUND-${match[1]}`,
        path: path.join(directory, entry),
        source: slashPath(relDir),
      });
    }
  }
  return candidates;
}

function readContextArtifact(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    fail(`selected context artifact is malformed JSON: ${filePath}: ${error.message}`);
  }
}

function parseContextArtifactCandidate(candidate) {
  try {
    const artifact = JSON.parse(fs.readFileSync(candidate.path, "utf8"));
    const generatedAt = parseIsoDate(artifact.generated_at);
    return {
      ...candidate,
      artifact,
      generatedAt,
      generatedAtMs: generatedAt ? generatedAt.getTime() : Number.NEGATIVE_INFINITY,
      parseError: undefined,
    };
  } catch (error) {
    return {
      ...candidate,
      artifact: undefined,
      generatedAt: undefined,
      generatedAtMs: Number.NEGATIVE_INFINITY,
      parseError: error,
    };
  }
}

function selectLatestContextArtifact(options = {}) {
  const cwd = path.resolve(options.cwd || options.targetRoot || process.cwd());
  const candidates = contextArtifactCandidates(cwd);
  if (candidates.length === 0) {
    return {
      artifact: undefined,
      path: undefined,
      applicable: false,
      reason: "no context gate surface",
    };
  }

  const highestRound = Math.max(...candidates.map((candidate) => candidate.roundNumber));
  const highestCandidates = candidates
    .filter((candidate) => candidate.roundNumber === highestRound)
    .map(parseContextArtifactCandidate)
    .sort((left, right) => {
      const timeDelta = right.generatedAtMs - left.generatedAtMs;
      if (timeDelta !== 0) return timeDelta;
      return slashPath(left.path).localeCompare(slashPath(right.path));
    });

  const selected = highestCandidates[0];
  if (selected.parseError) {
    readContextArtifact(selected.path);
  }
  if (!selected.generatedAt) {
    fail(`selected context artifact has invalid generated_at: ${selected.path}`);
  }
  const validation = validateContextGateArtifact(selected.artifact, options.validation || {});
  if (!validation.ok) {
    fail(`selected context artifact failed validation: ${validation.errors.join("; ")}`);
  }

  return {
    artifact: selected.artifact,
    path: selected.path,
    source: selected.source,
    applicable: true,
  };
}

module.exports = {
  assertCommittedArtifactClean,
  defaultRoundId,
  outputPaths,
  selectLatestContextArtifact,
};
