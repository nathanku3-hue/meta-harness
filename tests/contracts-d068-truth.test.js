"use strict";

/**
 * Phase 23A active-lifecycle truth (D068 + D069 closed; D070 next).
 * Filename retained for stable discovery; asserts current canonical truth surfaces.
 */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.join(__dirname, "..");

const PUBLIC_ALLOWLIST = new Set([
  "validateRunSpec",
  "computeRunSpecDigest",
  "validateRunSpecApproval",
  "validateExecutionReadinessFacts",
  "authorizeAttempt",
  "validateAttemptAuthorization",
  "validateWorkspaceAttestation",
  "evaluateWorkspaceStart",
  "evaluateImplementationFacts",
]);

const AUTHORITY_CHAIN_OBJECTS = [
  "RunSpec",
  "RunSpecApproval",
  "ExecutionReadinessFacts",
  "AttemptAuthorization",
  "WorkspaceAttestation",
  "WorkspaceStartCheck",
  "ImplementationFacts",
  "ImplementationAssessment",
];

const D068_SQUASH_SHA = "be82763264503427a12af400e8413b10cdbf7363";
const D068_SQUASH_SHORT = "be82763";
const D068_REVIEWED_HEAD = "4b259c9";
const D068_PREMERGE_BASE = "f926868";

const D069_SQUASH_SHA = "e8e7713cc99b58faad1a2aaa0ecaf836e4e25958";
const D069_SQUASH_SHORT = "e8e7713";
const D069_REVIEWED_HEAD = "245fa3d";
const D069_PREMERGE_BASE = "5afe075";
const D069_TREE = "5c16edf";

function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

function section(text, heading) {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [
    new RegExp(
      `(?:^|\\n)##[ \\t]+${escaped}[^\\n]*\\n([\\s\\S]*?)(?=\\n##[ \\t]|$)`,
      "i",
    ),
    new RegExp(
      `(?:^|\\n)${escaped}:?\\s*\\n([\\s\\S]*?)(?=\\n(?:[A-Z][A-Za-z0-9 /-]{2,40}):?\\s*\\n|\\n##[ \\t]|$)`,
      "i",
    ),
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m) return m[1];
  }
  assert.fail(`missing section: ${heading}`);
}

function extractFencedBlock(sectionText) {
  const m = sectionText.match(/```text\n([\s\S]*?)```/);
  assert.ok(m, "missing ```text authority chain block");
  return m[1];
}

function parseEvents() {
  const raw = read(".meta-harness/events.jsonl");
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, i) => {
      try {
        return JSON.parse(line);
      } catch (err) {
        assert.fail(`events.jsonl line ${i + 1} is not valid JSON: ${err.message}`);
      }
    });
}

function roadmapTableRows() {
  const md = read("docs/product/roadmap.md");
  const summary = section(md, "Phase Summary");
  const rows = [];
  for (const line of summary.split(/\r?\n/)) {
    if (!line.startsWith("|")) continue;
    if (/^\|\s*Phase\s*\|/i.test(line) || /^\|\s*-+/.test(line)) continue;
    const cells = line
      .split("|")
      .slice(1, -1)
      .map((c) => c.trim());
    if (cells.length < 4) continue;
    rows.push({ id: cells[0], name: cells[1], state: cells[2], detail: cells[3] });
  }
  return rows;
}

function findRoadmapRow(rows, idPattern) {
  const row = rows.find((r) => idPattern.test(r.id));
  assert.ok(row, `missing roadmap row matching ${idPattern}`);
  return row;
}

test("status records D070 A0 seam decision and authorizes artifact-based A1", () => {
  const status = read(".meta-harness/status.md");
  const lastVerified = section(status, "Last verified");
  const nextAction = section(status, "Next action");
  const goal = section(status, "Goal");
  const currentTruth = section(status, "Current truth");

  assert.match(lastVerified, /D069[\s\S]*12\/12 PASS/i);
  assert.match(lastVerified, /A0\.1[\s\S]*read-only/i);
  assert.match(lastVerified, /A0\.2[\s\S]*GO/i);
  assert.match(lastVerified, /M src\/fixture\.txt/i);

  assert.match(goal, /D070-A1/i);
  assert.match(goal, /dogfood/i);
  assert.match(nextAction, /D070-A1/i);
  assert.match(nextAction, /schema-bound change artifact/i);
  assert.match(nextAction, /controller materialize/i);
  assert.match(currentTruth, /closed under/i);
  assert.match(currentTruth, new RegExp(D068_SQUASH_SHORT));
  assert.match(currentTruth, new RegExp(D069_SQUASH_SHORT));
  assert.match(currentTruth, /A0\.1 NO-GO/i);
  assert.match(currentTruth, /A0\.2 GO/i);
  assert.match(currentTruth, /controller-materialized artifacts/i);

  assert.doesNotMatch(lastVerified, /under review/i);
  assert.doesNotMatch(nextAction, /open D069/i);
  assert.doesNotMatch(nextAction, /squash-merge\s+PR\s*#?24/i);
  assert.doesNotMatch(goal, /Open D069/i);
  assert.doesNotMatch(currentTruth, /Next:\s*D069/i);
  assert.doesNotMatch(status, /D069 is open\/next/i);
  assert.doesNotMatch(status, /D069 open\/next/i);
  assert.doesNotMatch(nextAction, /force(?:-|\s)?with(?:-|\s)?lease|force-push|force push/i);
  assert.doesNotMatch(nextAction, /parallel\s+R1A/i);

  assert.doesNotMatch(status, /D068 under review/i);
  assert.doesNotMatch(status, /D068 remains open/i);
  assert.doesNotMatch(status, /D069 under review/i);
  assert.doesNotMatch(status, /D069 remains open/i);
  assert.doesNotMatch(status, /PR #24 pending/i);

  const contractIndexSource = read("lib/contracts/index.js");
  assert.doesNotMatch(contractIndexSource, /under review/i);
  assert.match(contractIndexSource, /frozen|closed/i);
});

test("events retain D068 history and append D069 closure", () => {
  const events = parseEvents();
  assert.ok(events.length >= 3);

  for (const ev of events) {
    assert.notEqual(ev.ts, "2026-07-11T20:30:00Z");
    assert.notEqual(ev.time, "2026-07-11T20:30:00Z");
  }

  const d068 = events.filter((e) => e.decision === "D068");
  assert.ok(d068.length >= 2, "expected pre-merge and closure D068 events");

  const recon = d068.find(
    (e) =>
      typeof e.evidence === "string" &&
      e.evidence.includes("ed9aecd") &&
      typeof e.result === "string" &&
      /approved for merge|remains open until/i.test(e.result),
  );
  assert.ok(recon, "missing pre-merge reconciliation event");
  assert.equal(recon.ts, recon.time);
  assert.ok(!Number.isNaN(Date.parse(recon.ts)), `unparseable recon ts: ${recon.ts}`);

  const d068Closure = [...d068].reverse().find(
    (e) =>
      typeof e.result === "string" &&
      /closed by squash merge|closed under/i.test(e.result) &&
      typeof e.evidence === "string" &&
      e.evidence.includes(D068_SQUASH_SHORT),
  );
  assert.ok(d068Closure, "missing D068 closure event");
  assert.equal(d068Closure.ts, d068Closure.time);
  assert.match(String(d068Closure.evidence), new RegExp(D068_SQUASH_SHA));
  assert.match(String(d068Closure.evidence), /PR\s*#?23/i);
  assert.match(String(d068Closure.evidence), new RegExp(D068_REVIEWED_HEAD));
  assert.match(String(d068Closure.evidence), new RegExp(D068_PREMERGE_BASE));
  assert.match(String(d068Closure.evidence), /tree-object equality PASS/i);
  assert.match(String(d068Closure.evidence), /ancestry PASS/i);

  const d069 = events.filter((e) => e.decision === "D069");
  assert.ok(d069.length >= 1, "expected D069 closure event");
  const d069Closure = [...d069].reverse().find(
    (e) =>
      typeof e.result === "string" &&
      /closed by squash merge|closed under/i.test(e.result) &&
      typeof e.evidence === "string" &&
      e.evidence.includes(D069_SQUASH_SHORT),
  );
  assert.ok(d069Closure, "missing D069 closure event");
  assert.equal(d069Closure.ts, d069Closure.time);
  assert.ok(!Number.isNaN(Date.parse(d069Closure.ts)), `unparseable D069 ts: ${d069Closure.ts}`);
  assert.ok(
    Date.parse(d069Closure.ts) > Date.parse(d068Closure.ts),
    "D069 closure must be later than D068 closure",
  );
  assert.match(String(d069Closure.evidence), new RegExp(D069_SQUASH_SHA));
  assert.match(String(d069Closure.evidence), /PR\s*#?24/i);
  assert.match(String(d069Closure.evidence), new RegExp(D069_REVIEWED_HEAD));
  assert.match(String(d069Closure.evidence), new RegExp(D069_PREMERGE_BASE));
  assert.match(String(d069Closure.evidence), /tree-object equality PASS/i);
  assert.match(String(d069Closure.evidence), /ancestry PASS/i);
  assert.match(String(d069Closure.next_action || ""), /D070/i);

  const joined = JSON.stringify(events);
  assert.match(joined, /D064/);
  assert.match(joined, /D065/);
  assert.match(joined, /D066/);
  assert.match(joined, /D067/);
  assert.match(joined, /D068/);
  assert.match(joined, /D069/);
});

test("decision log D068 and D069 headers are closed under squash SHAs", () => {
  const log = read("docs/product/decision-log.md");
  const d068 = log.split("## D068:")[1] || "";
  const header = d068.slice(0, 600);
  assert.match(header, /Status:\s*\*\*closed under D068\*\*/i);
  assert.match(header, new RegExp(D068_SQUASH_SHA));
  assert.doesNotMatch(header, /under review in PR/i);
  assert.doesNotMatch(header, /remains open until/i);
  assert.doesNotMatch(header, /amendment in progress/i);

  const body = d068.slice(0, 3500);
  assert.match(body, /D069.*D070|D070/i);
  assert.match(body, /dogfood/i);
  assert.match(body, /R1A/i);
  assert.doesNotMatch(body, /D069 local controller walking slice → R1A deletion/i);

  const d069 = log.split("## D069:")[1] || "";
  const d069Header = d069.slice(0, 800);
  assert.match(d069Header, /Status:\s*\*\*closed under D069\*\*/i);
  assert.match(d069Header, new RegExp(D069_SQUASH_SHA));
  assert.doesNotMatch(d069Header, /under review/i);
  assert.doesNotMatch(d069Header, /remains open/i);
  assert.match(d069, /fixed-fixture sequential/i);
  assert.match(d069, /IMPLEMENTATION_VERIFIED/);
  assert.match(d069, /D070-A0|D070/);
  assert.match(d069, /do \*\*not\*\* claim|do not claim/i);
  assert.match(d069, /Real asynchronous overlap/i);
  assert.match(d069, /AO-owned execution/i);
  assert.doesNotMatch(d069Header, /AO-owned execution claimed as proven/i);
});

test("active Phase 23A authority chain is RunSpecApproval-rooted", () => {
  const plan = read("docs/product/phase-23a-execution-plan.md");
  const chainSection = section(plan, "Authority chain");
  const chain = extractFencedBlock(chainSection);

  let prev = -1;
  for (const name of AUTHORITY_CHAIN_OBJECTS) {
    const idx = chain.indexOf(name);
    assert.ok(idx >= 0, `authority chain missing ${name}`);
    assert.ok(idx > prev, `authority chain order broken at ${name}`);
    prev = idx;
  }
  assert.match(chain, /ImplementationAssessment\s*\(IMPLEMENTATION_VERIFIED\)/);

  assert.doesNotMatch(chain, /operator-plan/i);
  assert.doesNotMatch(chain, /worker-entry\s+gate/i);
  assert.doesNotMatch(chain, /approved operator-plan artifact/i);

  assert.match(plan, /closed under/i);
  assert.match(plan, new RegExp(D069_SQUASH_SHORT));
  assert.match(plan, /D070/);
  assert.doesNotMatch(plan, /Next:\s*D069 local controller/i);
  assert.doesNotMatch(plan, /D068 remains open/i);
  assert.doesNotMatch(plan, /R1A delete unused[\s\S]*D070 AO/i);
});

test("roadmap schedules artifact-based D070 A1 → dogfood → observed controls → R1A", () => {
  const rows = roadmapTableRows();

  const d068 = findRoadmapRow(rows, /23A-PR1R|D068/);
  assert.match(d068.id, /D068/);
  assert.match(d068.state + " " + d068.detail, /closed under/i);
  assert.match(d068.state + " " + d068.detail, new RegExp(D068_SQUASH_SHORT));
  assert.doesNotMatch(d068.state, /under review/i);

  const d069 = findRoadmapRow(rows, /D069|23A-PR2/);
  assert.match(d069.name, /Local Controller Walking Slice/i);
  assert.match(d069.state + " " + d069.detail, /closed under/i);
  assert.match(d069.state + " " + d069.detail, new RegExp(D069_SQUASH_SHORT));
  assert.doesNotMatch(d069.state, /next/i);
  assert.doesNotMatch(d069.name + d069.detail, /AO capability|provenance probe/i);

  const d070 = findRoadmapRow(rows, /D070|23A-PR3/);
  assert.match(d070.name + " " + d070.detail, /AO Substitution|substitute AO|walking slice|AO path/i);
  assert.match(d070.state + " " + d070.detail, /A0 decided|A1 next/i);
  assert.match(d070.detail, /workspace-write[\s\S]*NO-GO/i);
  assert.match(d070.detail, /schema-bound[\s\S]*A1/i);
  assert.doesNotMatch(d070.state + " " + d070.detail, /after R1A/i);

  const dogfood = findRoadmapRow(rows, /^23A-PR4$/);
  assert.match(dogfood.name, /Dogfood/i);
  assert.match(dogfood.state + " " + dogfood.detail, /immediately after A1|after D070/i);

  const observedControls = findRoadmapRow(rows, /23A-PR4B/);
  assert.match(observedControls.name + " " + observedControls.detail, /Concurrency|cancellation/i);
  assert.match(observedControls.state + " " + observedControls.detail, /only if dogfood requires|observed requirement/i);

  const r1a = findRoadmapRow(rows, /^R1A$/);
  assert.match(r1a.name + " " + r1a.detail, /deletion|imports|traces|Evidence-Based Core Reduction/i);
  assert.match(r1a.state + " " + r1a.detail, /after AO-backed dogfood|after dogfood/i);
  assert.doesNotMatch(r1a.state + " " + r1a.detail, /after D069(?!\s)/i);
  assert.doesNotMatch(r1a.state + " " + r1a.detail, /parallel after merge/i);

  const ids = rows.map((r) => r.id).join("\n");
  assert.doesNotMatch(ids, /^R1$/m);
  const names = rows.map((r) => r.name).join("\n");
  assert.doesNotMatch(names, /AO capability\s*\/\s*provenance probe/i);
  assert.doesNotMatch(names, /Concrete local runtime/i);
});

test("production contracts export exact public allowlist", () => {
  const contracts = require("../lib/contracts");
  const keys = Object.keys(contracts).sort();
  const expected = [...PUBLIC_ALLOWLIST].sort();
  assert.deepEqual(keys, expected);
  for (const name of expected) {
    assert.equal(typeof contracts[name], "function", name);
  }
  for (const banned of [
    "sealAuthorizationReceipt",
    "sealWorkspaceAttestation",
    "validateAuthorizationContext",
    "validateTrustedFactsStructure",
    "digestOf",
    "domainDigest",
    "canonicalize",
    "isWithinAuthorizationWindow",
    "validateAuthorizationReceipt",
    "validateAttestationForStart",
    "assessDelivery",
    "buildRunSpec",
  ]) {
    assert.equal(contracts[banned], undefined, banned);
  }
});
