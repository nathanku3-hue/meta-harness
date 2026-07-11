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

function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

function section(text, heading) {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // Prefer markdown H2, then plain label lines used by status.md.
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

test("status Last verified and Next action describe merge-approved open D068", () => {
  const status = read(".meta-harness/status.md");
  const lastVerified = section(status, "Last verified");
  const nextAction = section(status, "Next action");

  assert.match(lastVerified, /ed9aecd/);
  assert.match(lastVerified, /65\s+focused/i);
  assert.match(lastVerified, /106\s+(?:full[- ]suite\s+)?files/i);

  assert.match(nextAction, /squash-merge\s+PR\s*#?23/i);
  assert.match(nextAction, /closure/i);
  assert.match(nextAction, /D069/i);

  assert.doesNotMatch(lastVerified, /amend in progress/i);
  assert.doesNotMatch(nextAction, /force(?:-|\s)?with(?:-|\s)?lease|force-push|force push/i);
  assert.doesNotMatch(nextAction, /parallel\s+R1A/i);
  assert.doesNotMatch(nextAction, /AO probe/i);
  assert.doesNotMatch(status, /closed under D068/i);
  assert.match(status, /under review/i);
});

test("events parse as JSONL and pin D068 pre-merge reconciliation", () => {
  const events = parseEvents();
  assert.ok(events.length >= 2);

  for (const ev of events) {
    assert.notEqual(ev.ts, "2026-07-11T20:30:00Z");
    assert.notEqual(ev.time, "2026-07-11T20:30:00Z");
  }

  const d068 = events.filter((e) => e.decision === "D068");
  assert.ok(d068.length >= 1, "expected at least one D068 event");

  const recon = [...d068].reverse().find(
    (e) =>
      typeof e.evidence === "string" &&
      e.evidence.includes("ed9aecd") &&
      typeof e.result === "string" &&
      /approved for merge|remains open until/i.test(e.result),
  );
  assert.ok(recon, "missing D068 pre-merge reconciliation event with ed9aecd");
  assert.equal(recon.ts, recon.time);
  assert.ok(!Number.isNaN(Date.parse(recon.ts)), `unparseable ts: ${recon.ts}`);
  assert.match(String(recon.next_action || ""), /squash-merge/i);
  assert.match(String(recon.next_action || ""), /closure/i);

  const joined = JSON.stringify(events);
  assert.match(joined, /D064/);
  assert.match(joined, /D065/);
  assert.match(joined, /D066/);
  assert.match(joined, /D067/);
  assert.match(joined, /reconcil/i);
});

test("decision log D068 header remains open until merge", () => {
  const log = read("docs/product/decision-log.md");
  const d068 = log.split("## D068:")[1] || "";
  const header = d068.slice(0, 500);
  assert.match(header, /under review/i);
  assert.match(header, /ed9aecd/);
  assert.doesNotMatch(header, /Status:\s*closed under D068/i);
  assert.doesNotMatch(header, /amendment in progress/i);
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
});

test("roadmap active rows schedule walking slice before R1A and AO", () => {
  const rows = roadmapTableRows();

  const d068 = findRoadmapRow(rows, /23A-PR1R|D068/);
  assert.match(d068.id, /D068/);
  assert.match(d068.state + " " + d068.detail, /under review|merge-approved|PR\s*#?23/i);
  assert.doesNotMatch(d068.state, /^closed$/i);

  const d069 = findRoadmapRow(rows, /D069|23A-PR2/);
  assert.match(d069.name, /Local Controller Walking Slice/i);
  assert.match(d069.state + " " + d069.detail, /next|walking/i);
  assert.doesNotMatch(d069.name + d069.detail, /AO capability|provenance probe/i);

  const r1a = findRoadmapRow(rows, /^R1A$/);
  assert.match(r1a.name + " " + r1a.detail, /deletion|imports|traces|Evidence-Based Core Reduction/i);
  assert.match(r1a.state + " " + r1a.detail, /after D069/i);
  assert.doesNotMatch(r1a.state + " " + r1a.detail, /parallel after merge/i);
  assert.doesNotMatch(r1a.state, /planned\s*\(\s*parallel/i);

  const d070 = findRoadmapRow(rows, /D070|23A-PR3/);
  assert.match(d070.name + " " + d070.detail, /AO Substitution|substitute AO|working slice/i);
  assert.match(d070.state + " " + d070.detail, /after R1A/i);
  assert.doesNotMatch(d070.name + " " + d070.detail, /first local runtime|Concrete local runtime/i);

  // Old active assignments must not remain as live table rows.
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
