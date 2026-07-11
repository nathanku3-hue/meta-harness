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

test("status mentions D068 under review", () => {
  const status = fs.readFileSync(path.join(root, ".meta-harness/status.md"), "utf8");
  assert.match(status, /D068/);
  assert.match(status, /under review/i);
  assert.doesNotMatch(status, /closed under D068/i);
});

test("events include D064–D068 reconciliation", () => {
  const events = fs.readFileSync(path.join(root, ".meta-harness/events.jsonl"), "utf8");
  assert.match(events, /D064/);
  assert.match(events, /D065/);
  assert.match(events, /D066/);
  assert.match(events, /D067/);
  assert.match(events, /D068/);
  assert.match(events, /under review/i);
  assert.match(events, /reconcil/i);
});

test("decision log does not call D068 closed", () => {
  const log = fs.readFileSync(path.join(root, "docs/product/decision-log.md"), "utf8");
  const d068 = log.split("## D068:")[1] || "";
  const header = d068.slice(0, 400);
  assert.match(header, /under review/i);
  assert.doesNotMatch(header, /Status:\s*closed under D068/i);
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
