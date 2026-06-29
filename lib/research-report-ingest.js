"use strict";

const SCHEMA_VERSION = "1.0.0";
const MAX_ITEMS_PER_BUCKET = 12;
const SUMMARY_MAX_CHARS = 700;

const SECTION_BUCKETS = [
  { bucket: "claims", pattern: /\b(claim|claims|finding|findings|conclusion|conclusions|key point|evidence)\b/i },
  { bucket: "recommendations", pattern: /\b(recommendation|recommendations|implementation|next step|next steps|architectural)\b/i },
  { bucket: "risks", pattern: /\b(risk|risks|security|governance|failure|failures|edge case|edge cases)\b/i },
  { bucket: "open_questions", pattern: /\b(open question|open questions|unknown|unknowns|question|questions)\b/i },
  { bucket: "decision_candidates", pattern: /\b(decision|decisions|candidate|candidates|decide)\b/i },
];

const CONSTRAINT_MATCHERS = [
  { label: "No local network calls.", pattern: /\b(no|without|avoid)\b[^\n.]{0,80}\bnetwork calls?\b/i },
  { label: "No proprietary LLM API calls.", pattern: /\b(no|without|avoid)\b[^\n.]{0,80}\b(LLM|model|proprietary)[^\n.]{0,40}\bAPI calls?\b/i },
  { label: "No credentials or provider access.", pattern: /\b(no|without|avoid)\b[^\n.]{0,80}\b(credentials?|provider access|secrets?)\b/i },
  { label: "No write-enabled MCP tools.", pattern: /\b(no|without|avoid)\b[^\n.]{0,80}\bwrite-enabled MCP tools?\b/i },
  { label: "No shell execution tools.", pattern: /\b(no|without|avoid)\b[^\n.]{0,80}\bshell execution tools?\b/i },
  { label: "No HTTP/SSE, OAuth, or tunnel surface.", pattern: /\b(no|without|avoid)\b[^\n.]{0,80}\b(HTTP|SSE|OAuth|Cloudflare|tunnel)\b/i },
  { label: "No new package dependencies.", pattern: /\b(no|without|avoid)\b[^\n.]{0,80}\b(package dependencies|dependencies|dependency additions)\b/i },
  { label: "Preserve readiness and governance gates.", pattern: /\b(preserve|keep|retain)\b[^\n.]{0,80}\b(readiness|governance)\b[^\n.]{0,80}\bgates?\b/i },
  { label: "Keep work under the existing mcp command surface.", pattern: /\b(existing|same)\b[^\n.]{0,80}\bmcp\b[^\n.]{0,80}\b(command surface|surface)\b/i },
];

function normalizeText(value) {
  return String(value || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function cleanItem(value) {
  return String(value || "")
    .replace(/^\s*[-*+]\s+/, "")
    .replace(/^\s*\d+[.)]\s+/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function addUnique(target, value) {
  const cleaned = cleanItem(value);
  if (!cleaned || cleaned.length < 3) return;
  if (!target.some((item) => item.toLowerCase() === cleaned.toLowerCase())) {
    target.push(cleaned);
  }
}

function classifySection(heading) {
  const normalized = cleanItem(heading).toLowerCase();
  for (const entry of SECTION_BUCKETS) {
    if (entry.pattern.test(normalized)) return entry.bucket;
  }
  return null;
}

function emptyBuckets() {
  return {
    claims: [],
    recommendations: [],
    risks: [],
    open_questions: [],
    decision_candidates: [],
  };
}

function parseReportSections(reportText) {
  const buckets = emptyBuckets();
  let currentBucket = null;
  for (const rawLine of normalizeText(reportText).split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;
    const heading = line.match(/^#{1,6}\s+(.+)$/)?.[1];
    if (heading) {
      currentBucket = classifySection(heading);
      const inline = heading.includes(":") ? heading.split(":").slice(1).join(":") : "";
      if (currentBucket && inline.trim()) addUnique(buckets[currentBucket], inline);
      continue;
    }
    const bullet = line.match(/^[-*+]\s+(.+)$/)?.[1] || line.match(/^\d+[.)]\s+(.+)$/)?.[1];
    if (currentBucket && bullet) addUnique(buckets[currentBucket], bullet);
  }
  return buckets;
}

function summarySectionLines(reportText) {
  const lines = [];
  let inSummary = false;
  for (const rawLine of normalizeText(reportText).split("\n")) {
    const line = rawLine.trim();
    const heading = line.match(/^#{1,6}\s+(.+)$/)?.[1];
    if (heading) {
      inSummary = /\b(summary|executive summary|abstract)\b/i.test(heading);
      continue;
    }
    if (inSummary && line) lines.push(cleanItem(line));
    if (lines.length >= 4) break;
  }
  return lines.filter(Boolean);
}

function firstMeaningfulLines(reportText) {
  return normalizeText(reportText)
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#") && !/^```/.test(line))
    .map(cleanItem)
    .filter(Boolean)
    .slice(0, 4);
}

function evidenceSummary(reportText) {
  const candidates = summarySectionLines(reportText);
  const lines = candidates.length > 0 ? candidates : firstMeaningfulLines(reportText);
  const summary = lines.join(" ").slice(0, SUMMARY_MAX_CHARS).trim();
  return summary || "No evidence summary detected.";
}

function matchedRepoConstraints(reportText) {
  const text = normalizeText(reportText);
  return CONSTRAINT_MATCHERS
    .filter((entry) => entry.pattern.test(text))
    .map((entry) => entry.label)
    .sort((left, right) => left.localeCompare(right));
}

function limitBuckets(buckets) {
  return Object.fromEntries(Object.entries(buckets).map(([key, value]) => [key, value.slice(0, MAX_ITEMS_PER_BUCKET)]));
}

function buildResult({ reportText = "", sourceReportPath = "", question = "" } = {}) {
  const buckets = limitBuckets(parseReportSections(reportText));
  return {
    schema_version: SCHEMA_VERSION,
    question: String(question || "").trim(),
    source_report_path: String(sourceReportPath || "").trim(),
    claims: buckets.claims,
    recommendations: buckets.recommendations,
    risks: buckets.risks,
    open_questions: buckets.open_questions,
    repo_constraints_matched: matchedRepoConstraints(reportText),
    decision_candidates: buckets.decision_candidates,
    evidence_summary: evidenceSummary(reportText),
  };
}

function ingestResearchReport(input = {}) {
  const question = String(input.question || "").trim();
  if (!question) throw new Error("Research report ingest requires a question.");
  return buildResult(input);
}

function summarizeResearchReport(input = {}) {
  return buildResult({ ...input, question: input.question || "" });
}

function pushSection(lines, title, items, emptyText = "none detected") {
  lines.push("", `## ${title}`, "");
  if (!items || items.length === 0) {
    lines.push(`- ${emptyText}`);
    return;
  }
  for (const item of items) lines.push(`- ${item}`);
}

function renderResearchEvidenceMarkdown(result) {
  const lines = ["# Research Evidence Ingest", "", "## Question", "", result.question || "Not provided."];
  lines.push("", "## Source Report", "", result.source_report_path || "Not provided.");
  lines.push("", "## Evidence Summary", "", result.evidence_summary || "No evidence summary detected.");
  pushSection(lines, "Claims", result.claims);
  pushSection(lines, "Recommendations", result.recommendations);
  pushSection(lines, "Risks", result.risks);
  pushSection(lines, "Open Questions", result.open_questions);
  pushSection(lines, "Repo Constraints Matched", result.repo_constraints_matched);
  pushSection(lines, "Decision Candidates", result.decision_candidates);
  return `${lines.join("\n")}\n`;
}

module.exports = {
  SCHEMA_VERSION,
  ingestResearchReport,
  matchedRepoConstraints,
  parseReportSections,
  renderResearchEvidenceMarkdown,
  summarizeResearchReport,
};
