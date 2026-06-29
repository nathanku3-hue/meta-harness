"use strict";

const DEFAULT_MAX_CHARS_PER_FILE = 8000;

function normalizeText(value) {
  return String(value || "").replace(/\r\n/g, "\n");
}

function truncateText(text, maxChars) {
  const normalized = normalizeText(text);
  if (normalized.length <= maxChars) {
    return { text: normalized, truncated: false };
  }
  return {
    text: `${normalized.slice(0, Math.max(0, maxChars - 80))}\n\n[truncated: ${normalized.length - maxChars} chars omitted]`,
    truncated: true,
  };
}

function normalizeFiles(files = [], maxCharsPerFile = DEFAULT_MAX_CHARS_PER_FILE) {
  return files
    .map((file) => {
      const path = String(file.path || "").trim();
      if (!path) return null;
      const truncated = truncateText(file.content, maxCharsPerFile);
      return {
        path,
        content: truncated.text,
        truncated: truncated.truncated,
      };
    })
    .filter(Boolean)
    .sort((left, right) => left.path.localeCompare(right.path));
}

function linesForList(items, emptyText) {
  if (!items || items.length === 0) return [`- ${emptyText}`];
  return items.map((item) => `- ${item}`);
}

function generateResearchPrompt(input = {}) {
  const question = String(input.question || "").trim();
  if (!question) {
    throw new Error("Research prompt requires a question.");
  }

  const files = normalizeFiles(input.files || [], input.maxCharsPerFile || DEFAULT_MAX_CHARS_PER_FILE);
  const constraints = input.constraints || [
    "No local network calls or proprietary LLM API calls are available from this repo workflow.",
    "Prefer deterministic, testable CLI/library designs over daemon-heavy architecture.",
    "Preserve existing governance and readiness gates unless explicitly approved.",
  ];
  const goals = input.goals || [];

  const lines = [
    "# Deep Research Prompt",
    "",
    "## Question",
    "",
    question,
    "",
    "## Project Goals",
    "",
    ...linesForList(goals, "Use the provided repository context and identify practical implementation guidance."),
    "",
    "## Constraints",
    "",
    ...linesForList(constraints, "No additional constraints provided."),
    "",
    "## Repository Context",
    "",
  ];

  if (files.length === 0) {
    lines.push("No file context was provided.", "");
  } else {
    for (const file of files) {
      lines.push(`### ${file.path}`, "", "```text", file.content, "```", "");
      if (file.truncated) {
        lines.push(`Note: ${file.path} was truncated for prompt size.`, "");
      }
    }
  }

  lines.push(
    "## Requested Output",
    "",
    "Return a concise implementation-oriented report with:",
    "",
    "1. Key architectural recommendations.",
    "2. Edge cases and failure modes.",
    "3. Test strategy.",
    "4. Governance or security risks.",
    "5. Concrete next implementation steps.",
  );

  return `${lines.join("\n")}\n`;
}

module.exports = {
  DEFAULT_MAX_CHARS_PER_FILE,
  generateResearchPrompt,
  normalizeFiles,
  truncateText,
};
