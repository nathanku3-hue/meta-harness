"use strict";

const fs = require("node:fs");
const path = require("node:path");

const INBOX_RELATIVE_PATH = ".meta-harness/decision-inbox.json";
const ALLOWED_KINDS = new Set(["user_decision"]);
const ALLOWED_STATUSES = new Set(["open", "approved", "rejected", "deferred"]);
const ALLOWED_RECOMMENDED = new Set(["approve", "reject", "defer", "hold"]);

function safeLstat(targetPath) {
  try {
    return { status: "ok", stat: fs.lstatSync(targetPath) };
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return { status: "missing" };
    }
    return { status: "error", error };
  }
}

function readUtf8(targetPath) {
  try {
    return { status: "ok", text: fs.readFileSync(targetPath, "utf8") };
  } catch (error) {
    return { status: "error", error };
  }
}

function errorDetail(prefix, error) {
  return `${prefix}: ${error && error.code ? error.code : "unreadable"}`;
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function fieldPath(index, field) {
  return `${INBOX_RELATIVE_PATH}#decisions[${index}]${field ? `.${field}` : ""}`;
}

function item(status, targetPath, detail) {
  return { status, path: targetPath, detail };
}

function trimmedString(value) {
  return typeof value === "string" ? value.trim() : undefined;
}

function requiredString(decision, index, field, problems) {
  const value = trimmedString(decision[field]);
  if (!value) {
    problems.push(item("REJECTED", fieldPath(index, field), `missing required field: ${field}`));
    return undefined;
  }
  return value;
}

function validateQuestion(question, index, problems) {
  if (/[\r\n]/.test(question)) {
    problems.push(item("REJECTED", fieldPath(index, "question"), "decision question must be one explicit question"));
    return;
  }
  if (question.includes(";")) {
    problems.push(item("REJECTED", fieldPath(index, "question"), "decision question must be one explicit question"));
    return;
  }
  if ((question.match(/\?/g) || []).length > 1) {
    problems.push(item("REJECTED", fieldPath(index, "question"), "decision question must be one explicit question"));
  }
}

function validateEvidence(decision, index, problems) {
  if (decision.evidence === undefined || decision.evidence === null) {
    return;
  }
  if (!Array.isArray(decision.evidence)) {
    problems.push(item("REJECTED", fieldPath(index, "evidence"), "evidence must be an array"));
    return;
  }
  for (let itemIndex = 0; itemIndex < decision.evidence.length; itemIndex += 1) {
    if (!trimmedString(decision.evidence[itemIndex])) {
      problems.push(item("REJECTED", `${fieldPath(index, "evidence")}[${itemIndex}]`, "evidence item must be a non-empty string"));
    }
  }
}

function checkDuplicate(value, index, field, seen, problems) {
  if (!value) {
    return;
  }
  if (seen.has(value)) {
    problems.push(item("REJECTED", fieldPath(index, field), `duplicate ${field}: ${value}`));
    return;
  }
  seen.set(value, index);
}

function validateDecision(decision, index, seen, problems) {
  if (!isPlainObject(decision)) {
    problems.push(item("MALFORMED", fieldPath(index), "decision must be a JSON object"));
    return;
  }

  const id = requiredString(decision, index, "id", problems);
  checkDuplicate(id, index, "id", seen.ids, problems);

  const kind = requiredString(decision, index, "kind", problems);
  if (kind && !ALLOWED_KINDS.has(kind)) {
    problems.push(item("REJECTED", fieldPath(index, "kind"), `invalid kind: ${kind}`));
  }

  const question = requiredString(decision, index, "question", problems);
  if (question) {
    validateQuestion(question, index, problems);
  }

  const recommended = requiredString(decision, index, "recommended", problems);
  if (recommended && !ALLOWED_RECOMMENDED.has(recommended)) {
    problems.push(item("REJECTED", fieldPath(index, "recommended"), `invalid recommended: ${recommended}`));
  }

  const stateHash = requiredString(decision, index, "state_hash", problems);
  checkDuplicate(stateHash, index, "state_hash", seen.stateHashes, problems);

  requiredString(decision, index, "reask_when", problems);

  const status = requiredString(decision, index, "status", problems);
  if (status && !ALLOWED_STATUSES.has(status)) {
    problems.push(item("REJECTED", fieldPath(index, "status"), `invalid status: ${status}`));
  }

  validateEvidence(decision, index, problems);
}

function validateInbox(value) {
  if (!isPlainObject(value)) {
    return [item("MALFORMED", INBOX_RELATIVE_PATH, "decision inbox must be a JSON object")];
  }
  if (!Array.isArray(value.decisions)) {
    return [item("MALFORMED", `${INBOX_RELATIVE_PATH}#decisions`, "decision inbox must contain a decisions array")];
  }

  const problems = [];
  const seen = { ids: new Map(), stateHashes: new Map() };
  for (let index = 0; index < value.decisions.length; index += 1) {
    validateDecision(value.decisions[index], index, seen, problems);
  }
  return problems;
}

function parseJson(text) {
  try {
    return { status: "ok", value: JSON.parse(text) };
  } catch (error) {
    return { status: "error", error };
  }
}

function scanInboxFile(inboxPath) {
  const statResult = safeLstat(inboxPath);
  if (statResult.status === "missing") {
    return { status: "PASS", checked: 0, items: [] };
  }
  if (statResult.status === "error") {
    return {
      status: "FAIL",
      checked: 1,
      items: [item("UNREADABLE", INBOX_RELATIVE_PATH, errorDetail("unreadable decision inbox", statResult.error))],
    };
  }
  if (statResult.stat.isSymbolicLink() || !statResult.stat.isFile()) {
    return {
      status: "FAIL",
      checked: 1,
      items: [item("REJECTED", INBOX_RELATIVE_PATH, "decision inbox surface is not a regular file")],
    };
  }

  const readResult = readUtf8(inboxPath);
  if (readResult.status === "error") {
    return {
      status: "FAIL",
      checked: 1,
      items: [item("UNREADABLE", INBOX_RELATIVE_PATH, errorDetail("unreadable decision inbox", readResult.error))],
    };
  }

  const parseResult = parseJson(readResult.text);
  if (parseResult.status === "error") {
    return {
      status: "FAIL",
      checked: 1,
      items: [item("MALFORMED", INBOX_RELATIVE_PATH, `malformed JSON: ${parseResult.error.message}`)],
    };
  }

  const items = validateInbox(parseResult.value);
  if (items.length === 0) {
    return { status: "PASS", checked: 1, items: [{ status: "PASS", path: INBOX_RELATIVE_PATH }] };
  }
  return { status: "FAIL", checked: 1, items };
}

function scanDecisionInbox({ targetRoot }) {
  const resolvedTarget = path.resolve(targetRoot);
  const harnessRoot = path.join(resolvedTarget, ".meta-harness");
  const harnessStat = safeLstat(harnessRoot);
  if (harnessStat.status === "missing") {
    return { status: "PASS", checked: 0, items: [] };
  }
  if (harnessStat.status === "error") {
    return {
      status: "FAIL",
      checked: 1,
      items: [item("UNREADABLE", ".meta-harness", errorDetail("unreadable harness directory", harnessStat.error))],
    };
  }
  if (harnessStat.stat.isSymbolicLink() || !harnessStat.stat.isDirectory()) {
    return {
      status: "FAIL",
      checked: 1,
      items: [item("REJECTED", ".meta-harness", "decision inbox root is not a real directory")],
    };
  }

  return scanInboxFile(path.join(harnessRoot, "decision-inbox.json"));
}

module.exports = { scanDecisionInbox };
