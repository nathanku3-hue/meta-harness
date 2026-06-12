"use strict";

const { sectionAfterLabel } = require("./context-gate-state");

const PLACEHOLDER_STATUS_VALUES = new Set([
  "empty",
  "n a",
  "n/a",
  "na",
  "none",
  "not applicable",
  "not set",
  "not yet",
  "pending",
  "placeholder",
  "tbd",
  "to be determined",
  "to do",
  "todo",
  "unknown",
  "unset",
]);

const PLACEHOLDER_STATUS_PATTERNS = [
  /^add (details|status|context|notes|value|summary)$/,
  /^no (goal|current truth|next action|stop criteria|pending human decisions?|decisions?)$/,
  /^no (goal|current truth|next action|stop criteria|pending human decisions?|decisions?) (set|recorded|defined|yet)$/,
  /^(goal|current truth|next action|stop criteria|pending human decisions?|decisions?) (not set|pending|todo|tbd|unknown)$/,
];

function normalizePlaceholderLine(line) {
  return String(line || "")
    .trim()
    .replace(/^[-*+]\s*/, "")
    .replace(/^#+\s*/, "")
    .replace(/^`+|`+$/g, "")
    .replace(/[*_~]/g, "")
    .replace(/^[\s"'([{]+/, "")
    .replace(/[\s"')\]}]+$/, "")
    .replace(/[.!?;:]+$/g, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function placeholderLine(line) {
  const normalized = normalizePlaceholderLine(line);
  return !normalized ||
    PLACEHOLDER_STATUS_VALUES.has(normalized) ||
    PLACEHOLDER_STATUS_PATTERNS.some((pattern) => pattern.test(normalized));
}

function placeholderStatusValue(value) {
  const cleaned = String(value || "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .trim();
  if (!cleaned) {
    return true;
  }
  const lines = cleaned.split(/\r?\n/).filter((line) => normalizePlaceholderLine(line));
  return lines.length === 0 || lines.every((line) => placeholderLine(line));
}

function semanticStatusField(text, label) {
  const value = sectionAfterLabel(text, label);
  return placeholderStatusValue(value) ? "" : value;
}

function markdownSectionAfterHeading(text, heading) {
  const lines = String(text || "").replace(/\r\n/g, "\n").split("\n");
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const headingPattern = new RegExp(`^(#{1,6})\\s+${escaped}\\s*$`, "i");
  const start = lines.findIndex((line) => headingPattern.test(line.trim()));
  if (start === -1) {
    return "";
  }

  const startLevel = lines[start].trim().match(/^#+/)[0].length;
  const body = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index];
    const headingMatch = line.trim().match(/^(#{1,6})\s+/);
    if (headingMatch && headingMatch[1].length <= startLevel) {
      break;
    }
    body.push(line);
  }
  return body.join("\n").trim();
}

function semanticMarkdownSection(text, heading) {
  const value = markdownSectionAfterHeading(text, heading);
  return placeholderStatusValue(value) ? "" : value;
}

module.exports = {
  semanticMarkdownSection,
  semanticStatusField,
};
