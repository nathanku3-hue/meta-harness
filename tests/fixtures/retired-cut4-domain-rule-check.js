"use strict";

const fs = require("node:fs");
const path = require("node:path");

const DOMAIN_ROOT = "domain";
const FACT_LEDGER = [DOMAIN_ROOT, "facts", "ledger.jsonl"];
const ONTOLOGY_TERMS = [DOMAIN_ROOT, "ontology", "terms.json"];
const FACT_TO_CODE = [DOMAIN_ROOT, "mappings", "fact-to-code.json"];
const GOLDEN_CASES = [DOMAIN_ROOT, "golden-cases"];
const REVIEWS = [DOMAIN_ROOT, "reviews"];
const CODE_EXTENSIONS = new Set([".js", ".cjs", ".mjs", ".ts", ".tsx", ".py", ".go", ".rs", ".java", ".cs", ".rb", ".php"]);

function pass(id, name, reason = "") {
  return { id, name, status: "pass", reason, next_action: "" };
}

function fail(id, name, reason, nextAction) {
  return { id, name, status: "fail", reason, next_action: nextAction };
}

function skip(id, name, reason) {
  return { id, name, status: "skip", reason, next_action: "" };
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function nonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function nonEmptyArray(value) {
  return Array.isArray(value) && value.length > 0;
}

function repoPath(targetRoot, parts) {
  return path.join(targetRoot, ...parts);
}

function safeResolve(targetRoot, relativePath) {
  if (!nonEmptyString(relativePath) || path.isAbsolute(relativePath)) return null;
  const resolved = path.resolve(targetRoot, relativePath);
  const relative = path.relative(targetRoot, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) return null;
  return resolved;
}

function readJson(filePath) {
  try {
    return { ok: true, data: JSON.parse(fs.readFileSync(filePath, "utf8")) };
  } catch (error) {
    return { ok: false, reason: error && error.code === "ENOENT" ? "missing file" : `unreadable JSON: ${error.message}` };
  }
}

function readJsonLines(filePath) {
  try {
    const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/).filter((line) => line.trim());
    return { ok: true, data: lines.map((line, index) => ({ index: index + 1, value: JSON.parse(line) })) };
  } catch (error) {
    return { ok: false, reason: error && error.code === "ENOENT" ? "missing file" : `unreadable JSONL: ${error.message}` };
  }
}

function parseDateOnly(value) {
  if (!nonEmptyString(value)) return null;
  const parsed = Date.parse(`${value.slice(0, 10)}T00:00:00.000Z`);
  return Number.isFinite(parsed) ? parsed : null;
}

function uniqueMap(items, keyName, failures, label) {
  const map = new Map();
  for (const item of items) {
    const key = item[keyName];
    if (!nonEmptyString(key)) failures.push(`${label}.${keyName} is required`);
    else if (map.has(key)) failures.push(`duplicate ${label}.${keyName}: ${key}`);
    else map.set(key, item);
  }
  return map;
}

function loadFacts(targetRoot, nowMs) {
  const read = readJsonLines(repoPath(targetRoot, FACT_LEDGER));
  if (!read.ok) return { map: new Map(), expired: [], check: fail("MH_DG_FACT_LEDGER_001", "fact ledger", read.reason, "Create domain/facts/ledger.jsonl") };
  const failures = [];
  if (read.data.length === 0) failures.push("ledger must contain at least one fact");
  const facts = read.data.map((entry) => ({ ...entry.value, __line: entry.index }));
  const map = uniqueMap(facts, "fact_id", failures, "fact");
  const expired = [];
  for (const fact of facts) {
    if (!nonEmptyString(fact.source)) failures.push(`fact ${fact.fact_id || fact.__line} source is required`);
    if (!nonEmptyString(fact.effective_date) || parseDateOnly(fact.effective_date) === null) failures.push(`fact ${fact.fact_id || fact.__line} effective_date is required`);
    if (!nonEmptyString(fact.owner)) failures.push(`fact ${fact.fact_id || fact.__line} owner is required`);
    if (!nonEmptyString(fact.claim)) failures.push(`fact ${fact.fact_id || fact.__line} claim is required`);
    const expiryMs = fact.expiry_date === null || fact.expiry_date === undefined ? null : parseDateOnly(fact.expiry_date);
    if (fact.expiry_date !== null && fact.expiry_date !== undefined && expiryMs === null) failures.push(`fact ${fact.fact_id || fact.__line} expiry_date is invalid`);
    if (expiryMs !== null && expiryMs <= nowMs) expired.push(fact.fact_id || `line ${fact.__line}`);
  }
  return { map, expired, check: failures.length ? fail("MH_DG_FACT_LEDGER_001", "fact ledger", failures.join("; "), "Fix fact ledger source/effective-date/owner fields") : pass("MH_DG_FACT_LEDGER_001", "fact ledger") };
}

function loadTerms(targetRoot, facts) {
  const read = readJson(repoPath(targetRoot, ONTOLOGY_TERMS));
  if (!read.ok) return { map: new Map(), check: fail("MH_DG_ONTOLOGY_001", "ontology terms", read.reason, "Create domain/ontology/terms.json") };
  const terms = Array.isArray(read.data?.terms) ? read.data.terms : [];
  const failures = [];
  if (terms.length === 0) failures.push("terms must be nonempty");
  const map = uniqueMap(terms, "id", failures, "term");
  for (const term of terms) {
    for (const key of ["name", "definition", "owner"]) if (!nonEmptyString(term[key])) failures.push(`term ${term.id || "missing"} ${key} is required`);
    if (!nonEmptyArray(term.fact_ids)) failures.push(`term ${term.id || "missing"} fact_ids must be nonempty`);
    for (const factId of term.fact_ids || []) if (!facts.has(factId)) failures.push(`term ${term.id} references missing fact ${factId}`);
  }
  return { map, check: failures.length ? fail("MH_DG_ONTOLOGY_001", "ontology terms", failures.join("; "), "Fix ontology term ownership and fact references") : pass("MH_DG_ONTOLOGY_001", "ontology terms") };
}

function loadGoldenCases(targetRoot, facts, terms) {
  const casesRoot = repoPath(targetRoot, GOLDEN_CASES);
  if (!fs.existsSync(casesRoot)) return { map: new Map(), check: fail("MH_DG_GOLDEN_CASE_001", "golden cases", "missing directory", "Create domain/golden-cases/*.json") };
  const files = fs.readdirSync(casesRoot).filter((file) => file.endsWith(".json")).sort();
  const failures = [];
  if (files.length === 0) failures.push("no golden-case JSON files found");
  const cases = [];
  for (const file of files) {
    const read = readJson(path.join(casesRoot, file));
    if (read.ok) cases.push({ ...read.data, __file: file });
    else failures.push(`${file}: ${read.reason}`);
  }
  const map = uniqueMap(cases, "id", failures, "golden_case");
  for (const golden of cases) {
    if (!nonEmptyArray(golden.fact_ids)) failures.push(`golden ${golden.id || golden.__file} fact_ids must be nonempty`);
    if (!nonEmptyArray(golden.term_ids)) failures.push(`golden ${golden.id || golden.__file} term_ids must be nonempty`);
    if (!isObject(golden.expected_output)) failures.push(`golden ${golden.id || golden.__file} expected_output is required`);
    if (!nonEmptyString(golden.source)) failures.push(`golden ${golden.id || golden.__file} source is required`);
    for (const factId of golden.fact_ids || []) if (!facts.has(factId)) failures.push(`golden ${golden.id} references missing fact ${factId}`);
    for (const termId of golden.term_ids || []) if (!terms.has(termId)) failures.push(`golden ${golden.id} references missing term ${termId}`);
  }
  return { map, check: failures.length ? fail("MH_DG_GOLDEN_CASE_001", "golden cases", failures.join("; "), "Fix golden-case IDs, expected outputs, and references") : pass("MH_DG_GOLDEN_CASE_001", "golden cases") };
}

function loadMappings(targetRoot, facts, terms, goldenCases) {
  const read = readJson(repoPath(targetRoot, FACT_TO_CODE));
  if (!read.ok) return { mappings: [], codePaths: new Set(), check: fail("MH_DG_MAPPING_001", "fact-to-code mappings", read.reason, "Create domain/mappings/fact-to-code.json") };
  const mappings = Array.isArray(read.data?.mappings) ? read.data.mappings : [];
  const failures = [];
  const codePaths = new Set();
  if (mappings.length === 0) failures.push("mappings must be nonempty");
  for (const mapping of mappings) {
    if (!facts.has(mapping.fact_id)) failures.push(`mapping references missing fact ${mapping.fact_id || "missing"}`);
    if (!terms.has(mapping.term_id)) failures.push(`mapping references missing term ${mapping.term_id || "missing"}`);
    if (!nonEmptyString(mapping.code_path)) failures.push(`mapping for ${mapping.fact_id || "missing"} code_path is required`);
    else if (!safeResolve(targetRoot, mapping.code_path) || !fs.existsSync(safeResolve(targetRoot, mapping.code_path))) failures.push(`mapping code_path missing or outside target: ${mapping.code_path}`);
    else codePaths.add(mapping.code_path.split(/[\\/]+/).join("/"));
    if (!nonEmptyArray(mapping.golden_case_ids)) failures.push(`mapping for ${mapping.fact_id || "missing"} golden_case_ids must be nonempty`);
    for (const goldenId of mapping.golden_case_ids || []) {
      const golden = goldenCases.get(goldenId);
      if (!golden) failures.push(`mapping references missing golden case ${goldenId}`);
      else {
        if (!(golden.fact_ids || []).includes(mapping.fact_id)) failures.push(`golden ${goldenId} does not include mapped fact ${mapping.fact_id}`);
        if (!(golden.term_ids || []).includes(mapping.term_id)) failures.push(`golden ${goldenId} does not include mapped term ${mapping.term_id}`);
      }
    }
  }
  return { mappings, codePaths, check: failures.length ? fail("MH_DG_MAPPING_001", "fact-to-code mappings", failures.join("; "), "Fix fact-to-code mappings and golden-case links") : pass("MH_DG_MAPPING_001", "fact-to-code mappings") };
}


function loadReviews(targetRoot, facts, terms, goldenCases, mappings) {
  const reviewsRoot = repoPath(targetRoot, REVIEWS);
  if (!fs.existsSync(reviewsRoot)) return fail("MH_DG_REVIEW_001", "domain reviews", "missing directory", "Create domain/reviews/*.json with reviewer signoff");
  const files = fs.readdirSync(reviewsRoot).filter((file) => file.endsWith(".json")).sort();
  const failures = [];
  const reviewedFacts = new Set();
  const reviewedTerms = new Set();
  const reviewedGoldens = new Set();
  if (files.length === 0) failures.push("no review JSON files found");
  for (const file of files) {
    const read = readJson(path.join(reviewsRoot, file));
    if (!read.ok) {
      failures.push(`${file}: ${read.reason}`);
      continue;
    }
    const review = read.data;
    if (!nonEmptyString(review.id)) failures.push(`${file} id is required`);
    if (!nonEmptyString(review.reviewer)) failures.push(`${review.id || file} reviewer is required`);
    if (review.signed_off !== true) failures.push(`${review.id || file} signed_off must be true`);
    if (!nonEmptyString(review.reviewed_at) || parseDateOnly(review.reviewed_at) === null) failures.push(`${review.id || file} reviewed_at is required`);
    if (!nonEmptyArray(review.fact_ids)) failures.push(`${review.id || file} fact_ids must be nonempty`);
    if (!nonEmptyArray(review.term_ids)) failures.push(`${review.id || file} term_ids must be nonempty`);
    if (!nonEmptyArray(review.golden_case_ids)) failures.push(`${review.id || file} golden_case_ids must be nonempty`);
    for (const factId of review.fact_ids || []) facts.has(factId) ? reviewedFacts.add(factId) : failures.push(`${review.id || file} references missing fact ${factId}`);
    for (const termId of review.term_ids || []) terms.has(termId) ? reviewedTerms.add(termId) : failures.push(`${review.id || file} references missing term ${termId}`);
    for (const goldenId of review.golden_case_ids || []) goldenCases.has(goldenId) ? reviewedGoldens.add(goldenId) : failures.push(`${review.id || file} references missing golden case ${goldenId}`);
  }
  for (const mapping of mappings) {
    if (!reviewedFacts.has(mapping.fact_id)) failures.push(`mapped fact ${mapping.fact_id} lacks domain review`);
    if (!reviewedTerms.has(mapping.term_id)) failures.push(`mapped term ${mapping.term_id} lacks domain review`);
    for (const goldenId of mapping.golden_case_ids || []) if (!reviewedGoldens.has(goldenId)) failures.push(`mapped golden case ${goldenId} lacks domain review`);
  }
  return failures.length ? fail("MH_DG_REVIEW_001", "domain reviews", failures.join("; "), "Add signed domain review coverage for mapped facts, terms, and golden cases") : pass("MH_DG_REVIEW_001", "domain reviews");
}

function activationCodeFiles(activation) {
  return (activation?.patch_plan?.files || [])
    .filter((file) => CODE_EXTENSIONS.has(path.extname(String(file))))
    .map((file) => String(file).split(/[\\/]+/).join("/"));
}

function checkCodeTrace(targetRoot, activation, mappings, codePaths) {
  const failures = [];
  for (const mapping of mappings) {
    const resolved = safeResolve(targetRoot, mapping.code_path);
    const text = resolved && fs.existsSync(resolved) ? fs.readFileSync(resolved, "utf8") : "";
    if (!text.includes(mapping.fact_id)) failures.push(`code ${mapping.code_path} lacks fact_id reference ${mapping.fact_id}`);
  }
  for (const file of activationCodeFiles(activation)) {
    if (!codePaths.has(file)) failures.push(`domain code ${file} is not represented in fact-to-code mappings`);
  }
  return failures.length ? fail("MH_DG_CODE_TRACE_001", "domain code trace", failures.join("; "), "Add fact_id references and mappings for every domain code file") : pass("MH_DG_CODE_TRACE_001", "domain code trace");
}

function hasDomainRuleSurface(targetRoot) {
  return fs.existsSync(repoPath(targetRoot, FACT_LEDGER)) || fs.existsSync(repoPath(targetRoot, ONTOLOGY_TERMS)) || fs.existsSync(repoPath(targetRoot, FACT_TO_CODE)) || fs.existsSync(repoPath(targetRoot, GOLDEN_CASES)) || fs.existsSync(repoPath(targetRoot, REVIEWS));
}

function checkDomainRuleEvidence({ targetRoot, activation, now = new Date() }) {
  if (!activation) return { checks: [skip("MH_DG_FACT_LEDGER_001", "fact ledger", "activation missing")], hasSurface: hasDomainRuleSurface(targetRoot) };
  const nowMs = Date.parse(`${now.toISOString().slice(0, 10)}T00:00:00.000Z`);
  const facts = loadFacts(targetRoot, nowMs);
  const terms = loadTerms(targetRoot, facts.map);
  const golden = loadGoldenCases(targetRoot, facts.map, terms.map);
  const mappings = loadMappings(targetRoot, facts.map, terms.map, golden.map);
  const reviews = loadReviews(targetRoot, facts.map, terms.map, golden.map, mappings.mappings);
  const expiry = facts.expired.length ? fail("MH_DG_EXPIRY_001", "expired facts", `expired fact(s): ${facts.expired.join(", ")}`, "Retire, refresh, or remove expired facts before release") : pass("MH_DG_EXPIRY_001", "expired facts");
  return { hasSurface: true, checks: [facts.check, terms.check, mappings.check, golden.check, reviews, checkCodeTrace(targetRoot, activation, mappings.mappings, mappings.codePaths), expiry] };
}

module.exports = { checkDomainRuleEvidence, hasDomainRuleSurface };
