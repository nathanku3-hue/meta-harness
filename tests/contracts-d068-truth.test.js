"use strict";

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

const SQUASH_SHA = "be82763264503427a12af400e8413b10cdbf7363";
const SQUASH_SHORT = "be82763";
const REVIEWED_HEAD = "4b259c9";
const PREMERGE_BASE = "f926868";

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

test("status Last verified and Next action describe closed D068 and open D069", () => {
  const status = read(".meta-harness/status.md");
  const lastVerified = section(status, "Last verified");
  const nextAction = section(status, "Next action");
  const goal = section(status, "Goal");
  const currentTruth = section(status, "Current truth");

  assert.match(lastVerified, new RegExp(SQUASH_SHORT));
  assert.match(lastVerified, /tree-object equality PASS/i);
  assert.match(lastVerified, /ancestry PASS/i);
  assert.match(lastVerified, /PASS/);

  assert.match(goal, /D069/i);
  assert.match(nextAction, /D069/i);
  assert.match(currentTruth, /closed under/i);
  assert.match(currentTruth, new RegExp(SQUASH_SHORT));

  assert.doesNotMatch(lastVerified, /under review/i);
  assert.doesNotMatch(nextAction, /squash-merge\s+PR\s*#?23/i);
  assert.doesNotMatch(nextAction, /push pending|checks pending|squash merge pending/i);
  assert.doesNotMatch(goal, /squash-merge\s+PR\s*#?23/i);
  assert.doesNotMatch(currentTruth, /remains open until PR/i);
  assert.doesNotMatch(status, /PR #23 pending/i);
  assert.doesNotMatch(nextAction, /force(?:-|\s)?with(?:-|\s)?lease|force-push|force push/i);
  assert.doesNotMatch(nextAction, /parallel\s+R1A/i);
  assert.doesNotMatch(nextAction, /AO probe/i);
});

test("events retain pre-merge reconciliation and append D068 closure", () => {
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

  const closure = [...d068].reverse().find(
    (e) =>
      typeof e.result === "string" &&
      /closed by squash merge|closed under/i.test(e.result) &&
      typeof e.evidence === "string" &&
      e.evidence.includes(SQUASH_SHORT),
  );
  assert.ok(closure, "missing D068 closure event");
  assert.equal(closure.ts, closure.time);
  assert.ok(!Number.isNaN(Date.parse(closure.ts)), `unparseable closure ts: ${closure.ts}`);
  assert.ok(
    Date.parse(closure.ts) > Date.parse(recon.ts),
    "closure event must be later than pre-merge reconciliation",
  );
  assert.match(String(closure.evidence), new RegExp(SQUASH_SHA));
  assert.match(String(closure.evidence), /PR\s*#?23/i);
  assert.match(String(closure.evidence), new RegExp(REVIEWED_HEAD));
  assert.match(String(closure.evidence), new RegExp(PREMERGE_BASE));
  assert.match(String(closure.evidence), /tree-object equality PASS/i);
  assert.match(String(closure.evidence), /ancestry PASS/i);
  assert.match(String(closure.next_action || ""), /D069/i);

  const joined = JSON.stringify(events);
  assert.match(joined, /D064/);
  assert.match(joined, /D065/);
  assert.match(joined, /D066/);
  assert.match(joined, /D067/);
});

test("decision log D068 header is closed under squash SHA", () => {
  const log = read("docs/product/decision-log.md");
  const d068 = log.split("## D068:")[1] || "";
  const header = d068.slice(0, 600);
  assert.match(header, /Status:\s*\*\*closed under D068\*\*/i);
  assert.match(header, new RegExp(SQUASH_SHA));
  assert.doesNotMatch(header, /under review in PR/i);
  assert.doesNotMatch(header, /remains open until/i);
  assert.doesNotMatch(header, /amendment in progress/i);

  const body = d068.slice(0, 3500);
  assert.match(body, /D069.*D070|D070/i);
  assert.match(body, /dogfood/i);
  assert.match(body, /R1A/i);
  assert.doesNotMatch(body, /D069 local controller walking slice → R1A deletion/i);
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
  assert.match(plan, new RegExp(SQUASH_SHORT));
  assert.doesNotMatch(plan, /D068 remains open/i);
  assert.doesNotMatch(plan, /R1A delete unused[\s\S]*D070 AO/i);
});

test("roadmap active rows schedule D069 → D070 → dogfood → R1A", () => {
  const rows = roadmapTableRows();

  const d068 = findRoadmapRow(rows, /23A-PR1R|D068/);
  assert.match(d068.id, /D068/);
  assert.match(d068.state + " " + d068.detail, /closed under/i);
  assert.match(d068.state + " " + d068.detail, new RegExp(SQUASH_SHORT));
  assert.doesNotMatch(d068.state, /under review/i);

  const d069 = findRoadmapRow(rows, /D069|23A-PR2/);
  assert.match(d069.name, /Local Controller Walking Slice/i);
  assert.match(d069.state + " " + d069.detail, /next|walking/i);
  assert.doesNotMatch(d069.state, /closed|completed/i);
  assert.doesNotMatch(d069.name + d069.detail, /AO capability|provenance probe/i);

  const d070 = findRoadmapRow(rows, /D070|23A-PR3/);
  assert.match(d070.name + " " + d070.detail, /AO Substitution|substitute AO|walking slice/i);
  assert.match(d070.state + " " + d070.detail, /after D069/i);
  assert.doesNotMatch(d070.state + " " + d070.detail, /after R1A/i);

  const dogfood = findRoadmapRow(rows, /23A-PR4/);
  assert.match(dogfood.name, /Dogfood/i);
  assert.match(dogfood.state + " " + dogfood.detail, /after D070|later/i);

  const r1a = findRoadmapRow(rows, /^R1A$/);
  assert.match(r1a.name + " " + r1a.detail, /deletion|imports|traces|Evidence-Based Core Reduction/i);
  assert.match(r1a.state + " " + r1a.detail, /after dogfood|after D070/i);
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
