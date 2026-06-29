"use strict";

const DIFF_FILE_PATTERN = /^diff --git a\/(.+?) b\/(.+)$/;
const HEADING_PATTERN = /^#+\s+(.+)$/;

function lineCount(text) {
  if (!text) return 0;
  return text.endsWith("\n") ? text.slice(0, -1).split("\n").length : text.split("\n").length;
}

function parseChangedFiles(diffText = "") {
  const files = [];
  let current = null;

  for (const line of String(diffText).split(/\r?\n/)) {
    const match = line.match(DIFF_FILE_PATTERN);
    if (match) {
      current = {
        path: match[2],
        previous_path: match[1] === match[2] ? null : match[1],
        additions: 0,
        removals: 0,
      };
      files.push(current);
      continue;
    }
    if (!current) continue;
    if (line.startsWith("+") && !line.startsWith("+++")) current.additions += 1;
    if (line.startsWith("-") && !line.startsWith("---")) current.removals += 1;
  }

  return files.sort((left, right) => left.path.localeCompare(right.path));
}

function extractLogSignals(logText = "") {
  const signals = [];
  const seen = new Set();
  for (const rawLine of String(logText).split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const heading = line.match(HEADING_PATTERN)?.[1];
    const candidate = heading || line.replace(/^[-*]\s+/, "");
    if (!candidate || seen.has(candidate)) continue;
    seen.add(candidate);
    signals.push(candidate);
    if (signals.length >= 12) break;
  }
  return signals;
}

function classifyRisks(files, logText = "") {
  const risks = [];
  const filePaths = files.map((file) => file.path);
  if (filePaths.some((path) => path === "package.json" || path === "package-lock.json")) {
    risks.push("Package metadata changed; verify reproducibility and release gates.");
  }
  if (filePaths.some((path) => path.startsWith("lib/commands/") || path === "lib/command-registry.js")) {
    risks.push("CLI command surface changed; verify help routing and command-module contracts.");
  }
  if (filePaths.some((path) => path.startsWith(".github/"))) {
    risks.push("Workflow configuration changed; verify security and CI behavior.");
  }
  if (/\b(todo|fixme|hack|temporary|follow[- ]?up)\b/i.test(logText)) {
    risks.push("Task log contains deferred-work markers; review before closure.");
  }
  return risks.sort((left, right) => left.localeCompare(right));
}

function decisionCandidates(files, signals) {
  const candidates = [];
  if (files.length > 0) {
    candidates.push(`Record implementation impact across ${files.length} changed file${files.length === 1 ? "" : "s"}.`);
  }
  for (const signal of signals.slice(0, 3)) {
    candidates.push(`Confirm whether this execution signal changes governance: ${signal}`);
  }
  return candidates;
}

function extractInsights(input = {}) {
  const diffText = String(input.diffText || "");
  const logText = String(input.logText || "");
  const files = parseChangedFiles(diffText);
  const totalAdditions = files.reduce((sum, file) => sum + file.additions, 0);
  const totalRemovals = files.reduce((sum, file) => sum + file.removals, 0);
  const signals = extractLogSignals(logText);
  const risks = classifyRisks(files, logText);

  return {
    schema_version: "1.0.0",
    summary: {
      changed_files: files.length,
      additions: totalAdditions,
      removals: totalRemovals,
      diff_lines: lineCount(diffText),
      log_lines: lineCount(logText),
    },
    changed_files: files,
    execution_signals: signals,
    risks,
    decision_candidates: decisionCandidates(files, signals),
  };
}

function renderInsightMarkdown(insights) {
  const lines = [
    "# Harness Insight Summary",
    "",
    "## Change Summary",
    "",
    `- Changed files: ${insights.summary.changed_files}`,
    `- Additions: ${insights.summary.additions}`,
    `- Removals: ${insights.summary.removals}`,
    "",
    "## Changed Files",
    "",
  ];

  if (insights.changed_files.length === 0) {
    lines.push("- none");
  } else {
    for (const file of insights.changed_files) {
      lines.push(`- ${file.path} (+${file.additions} -${file.removals})`);
    }
  }

  lines.push("", "## Execution Signals", "");
  if (insights.execution_signals.length === 0) {
    lines.push("- none");
  } else {
    for (const signal of insights.execution_signals) lines.push(`- ${signal}`);
  }

  lines.push("", "## Risks", "");
  if (insights.risks.length === 0) {
    lines.push("- none detected");
  } else {
    for (const risk of insights.risks) lines.push(`- ${risk}`);
  }

  lines.push("", "## Decision Candidates", "");
  if (insights.decision_candidates.length === 0) {
    lines.push("- none");
  } else {
    for (const candidate of insights.decision_candidates) lines.push(`- ${candidate}`);
  }

  return `${lines.join("\n")}\n`;
}

module.exports = {
  extractInsights,
  parseChangedFiles,
  renderInsightMarkdown,
};
