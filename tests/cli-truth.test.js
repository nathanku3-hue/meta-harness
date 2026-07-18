"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const test = require("node:test");

const {
  createTruthProposal,
  ledgerEventDigest,
} = require("../lib/truth-authority");
const { inspectCanonicalHistory } = require("../lib/truth-reconciler");
const {
  CLI,
  assertCliError,
  readJsonl,
  run,
  runRaw,
  tempDir,
} = require("./helpers/cli");
const {
  authorityForTarget,
  createExternalAuthority,
  mintReceiptForTarget,
  registerAuthority,
  signTruthReceipt,
} = require("./helpers/truth-authority");

function writeJson(root, name, value) {
  const filePath = path.join(root, name);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  return filePath;
}

function runAsync(cwd, args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI, ...args], {
      cwd,
      shell: false,
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("close", (status) => resolve({ status, stdout, stderr }));
  });
}

test("status blocks any extra, duplicate, reordered, missing, or stale projection content", () => {
  const cwd = tempDir("truth-status-exact-");
  run(cwd, ["init", "Canonical status target"]);
  const statusPath = path.join(cwd, ".meta-harness", "status.md");
  const canonicalStatus = fs.readFileSync(statusPath, "utf8");
  const staleStatus = canonicalStatus.replace("Translate the goal into a bounded worker task.", "Restart D076 release mechanics.");
  fs.writeFileSync(statusPath, staleStatus, "utf8");
  const blocked = runRaw(cwd, ["status"]);
  assertCliError(blocked, "MH_TRUTH_CONTRADICTION", /does not exactly match canonical truth/i);
  assert.equal(fs.readFileSync(statusPath, "utf8"), staleStatus);
  const refreshed = run(cwd, ["status", "--refresh"]);
  assert.equal(refreshed, canonicalStatus);
});

test("public canonical mutation rejects self-asserted roles and accepts only an external receipt", () => {
  const cwd = tempDir("truth-authority-cli-");
  run(cwd, ["init", "Canonical event target"]);
  const eventPath = path.join(cwd, ".meta-harness", "events.jsonl");
  const before = fs.readFileSync(eventPath, "utf8");
  const selfAsserted = runRaw(cwd, ["event", "--canonical", "--actor", "controller", "--authority", "FAKE-AUTHORITY", "--stream", "coding", "--phase", "plan", "--action", "impersonate authority", "--result", "fake", "--goal", "fake", "--next-action", "fake", "--stop-criteria", "fake"]);
  assertCliError(selfAsserted, "MH_USAGE", /content comes only from --authority-receipt-file/i);
  assert.equal(fs.readFileSync(eventPath, "utf8"), before);
  const receipt = mintReceiptForTarget(cwd);
  writeJson(cwd, "truth-receipt.json", receipt);
  run(cwd, ["event", "--canonical", "--authority-receipt-file", "truth-receipt.json"]);
  const events = readJsonl(eventPath);
  assert.equal(events.length, 2);
  assert.equal(events[1].actor, "controller");
  assert.equal(events[1].authority, receipt.signer_key_id);
  const replay = runRaw(cwd, ["event", "--canonical", "--authority-receipt-file", "truth-receipt.json"]);
  assertCliError(replay, "MH_TRUTH_AUTHORITY", /already been used/i);
  assert.equal(readJsonl(eventPath).length, 2);
});

test("tampered signed proposal is rejected before append", () => {
  const cwd = tempDir("truth-tamper-cli-");
  run(cwd, ["init", "Tamper target"]);
  const eventPath = path.join(cwd, ".meta-harness", "events.jsonl");
  const receipt = mintReceiptForTarget(cwd);
  receipt.proposal.goal = "tampered after signing";
  writeJson(cwd, "tampered.json", receipt);
  const before = fs.readFileSync(eventPath, "utf8");
  assertCliError(runRaw(cwd, ["event", "--canonical", "--authority-receipt-file", "tampered.json"]), "MH_TRUTH_AUTHORITY", /proposal_digest|signature/i);
  assert.equal(fs.readFileSync(eventPath, "utf8"), before);
});

test("signed history cannot downgrade when the public authority contract is removed", () => {
  const cwd = tempDir("truth-key-missing-");
  run(cwd, ["init", "Pinned authority target"]);
  fs.unlinkSync(path.join(cwd, ".meta-harness", "contracts", "truth-authority-public.json"));
  assertCliError(runRaw(cwd, ["status"]), "MH_TRUTH_CONTRADICTION", /truth authority public key is missing/i);
});

test("replacing the public authority cannot authorize a hostile reconciliation", () => {
  const cwd = tempDir("truth-key-replacement-");
  run(cwd, ["init", "Pinned authority target"]);
  const eventPath = path.join(cwd, ".meta-harness", "events.jsonl");
  const originalEvents = readJsonl(eventPath);
  const replacement = createExternalAuthority("replacement-repository");
  fs.writeFileSync(path.join(cwd, ".meta-harness", "contracts", "truth-authority-public.json"), `${JSON.stringify(replacement.publicDocument, null, 2)}\n`, "utf8");
  const occurredAt = new Date().toISOString();
  const receipt = signTruthReceipt({
    authority: replacement,
    issuedAt: occurredAt,
    priorSnapshotDigest: null,
    receiptId: "hostile-key-replacement",
    proposal: createTruthProposal({ operation: "reconcile", stream: "coding", phase: "plan", action: "replace authority", result: "hostile replacement", goal: "replace canonical truth", next_action: "continue hostile mutation", stop_criteria: "never", occurred_at: occurredAt, rejected_event_digests: [ledgerEventDigest(originalEvents[0])] }),
  });
  writeJson(cwd, "hostile.json", receipt);
  assertCliError(runRaw(cwd, ["event", "--canonical", "--authority-receipt-file", "hostile.json"]), "MH_TRUTH_CONTRADICTION", /does not match the append-only signer anchor/i);
  assert.deepEqual(readJsonl(eventPath), originalEvents);
});

test("expired and wrong-prior receipts are rejected before append", () => {
  const cwd = tempDir("truth-binding-cli-");
  run(cwd, ["init", "Binding target"]);
  const eventPath = path.join(cwd, ".meta-harness", "events.jsonl");
  const before = fs.readFileSync(eventPath, "utf8");
  const wrongPrior = mintReceiptForTarget(cwd, { prior_snapshot_digest: `sha256:${"0".repeat(64)}` });
  writeJson(cwd, "wrong-prior.json", wrongPrior);
  assertCliError(runRaw(cwd, ["event", "--canonical", "--authority-receipt-file", "wrong-prior.json"]), "MH_TRUTH_AUTHORITY", /not bound to the current canonical snapshot/i);
  const old = "2026-01-01T00:00:00.000Z";
  const expired = mintReceiptForTarget(cwd, { occurred_at: old, ttl_seconds: 1 });
  writeJson(cwd, "expired.json", expired);
  assertCliError(runRaw(cwd, ["event", "--canonical", "--authority-receipt-file", "expired.json"]), "MH_TRUTH_AUTHORITY", /outside its validity window/i);
  assert.equal(fs.readFileSync(eventPath, "utf8"), before);
});

test("repository-bound receipt cannot be replayed into another repository sharing the same key", () => {
  const first = tempDir("truth-repository-a-");
  run(first, ["init", "Repository A"]);
  const firstAuthority = authorityForTarget(first);
  const second = tempDir("truth-repository-b-");
  const secondAuthority = { ...firstAuthority, repositoryId: "test-repository:b", publicDocument: { ...firstAuthority.publicDocument, repository_id: "test-repository:b" } };
  registerAuthority(second, secondAuthority);
  const initialAt = new Date().toISOString();
  const secondInitial = signTruthReceipt({ authority: secondAuthority, issuedAt: initialAt, proposal: { operation: "snapshot", stream: "coding", phase: "intake", action: "initialized harness", result: "repository B initialized", goal: "Repository B", next_action: "continue B", stop_criteria: "stop on contradiction", evidence: null, decision: null, occurred_at: initialAt, rejected_event_digests: [] } });
  const publicPath = writeJson(second, "external-public.json", secondAuthority.publicDocument);
  const initialPath = writeJson(second, "external-initial.json", secondInitial);
  assert.equal(runRaw(second, ["init", "--authority-public-key-file", publicPath, "--authority-receipt-file", initialPath]).status, 0);
  const foreignPath = writeJson(second, "foreign-receipt.json", mintReceiptForTarget(first, { receipt_id: "cross-repository-replay" }));
  assertCliError(runRaw(second, ["event", "--canonical", "--authority-receipt-file", foreignPath]), "MH_TRUTH_AUTHORITY", /different repository identity/i);
});

test("concurrent submissions of one receipt produce exactly one append", async () => {
  const cwd = tempDir("truth-concurrent-replay-");
  run(cwd, ["init", "Concurrent replay target"]);
  const eventPath = path.join(cwd, ".meta-harness", "events.jsonl");
  const receiptPath = writeJson(cwd, "concurrent-receipt.json", mintReceiptForTarget(cwd, { receipt_id: "concurrent-replay" }));
  const lockPath = path.join(cwd, ".meta-harness", "local", "locks", "events.lock");
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  fs.writeFileSync(lockPath, "test-barrier", { flag: "wx" });
  const args = ["event", "--canonical", "--authority-receipt-file", receiptPath];
  const first = runAsync(cwd, args);
  const second = runAsync(cwd, args);
  await new Promise((resolve) => setTimeout(resolve, 150));
  fs.unlinkSync(lockPath);
  const results = await Promise.all([first, second]);
  assert.deepEqual(results.map((result) => result.status).sort(), [0, 1]);
  assert.equal(readJsonl(eventPath).length, 2);
});

test("canonical ledger replacement symlink is rejected without external append", { skip: process.platform === "win32" }, () => {
  const cwd = tempDir("truth-ledger-link-");
  run(cwd, ["init", "Ledger confinement"]);
  const ledger = path.join(cwd, ".meta-harness", "events.jsonl");
  const outside = path.join(tempDir("truth-ledger-outside-"), "events.jsonl");
  fs.writeFileSync(outside, fs.readFileSync(ledger));
  fs.unlinkSync(ledger);
  fs.symlinkSync(outside, ledger, "file");
  const before = fs.readFileSync(outside, "utf8");
  const receiptPath = writeJson(cwd, "linked-ledger-receipt.json", mintReceiptForTarget(cwd));
  assertCliError(runRaw(cwd, ["event", "--canonical", "--authority-receipt-file", receiptPath]), "MH_TRUTH_PATH", /symlink|junction|reparse/i);
  assert.equal(fs.readFileSync(outside, "utf8"), before);
});

test("linked workers path cannot trigger mutating re-init", () => {
  const cwd = tempDir("truth-workers-link-");
  run(cwd, ["init", "Linked worker confinement"]);
  const outside = tempDir("truth-workers-outside-");
  const workers = path.join(cwd, ".meta-harness", "workers");
  fs.rmSync(workers, { recursive: true, force: true });
  fs.symlinkSync(outside, workers, process.platform === "win32" ? "junction" : "dir");
  const before = fs.readdirSync(outside);
  assertCliError(runRaw(cwd, ["init"]), "MH_ALREADY_INITIALIZED", /already initialized/i);
  assert.deepEqual(fs.readdirSync(outside), before);
});

test("linked canonical lock parent is rejected before append", () => {
  const cwd = tempDir("truth-lock-parent-link-");
  run(cwd, ["init", "Lock path confinement"]);
  const outside = tempDir("truth-lock-parent-outside-");
  const local = path.join(cwd, ".meta-harness", "local");
  fs.rmSync(local, { recursive: true, force: true });
  fs.symlinkSync(outside, local, process.platform === "win32" ? "junction" : "dir");
  const before = fs.readdirSync(outside);
  const receiptPath = writeJson(cwd, "linked-lock-receipt.json", mintReceiptForTarget(cwd));
  assertCliError(runRaw(cwd, ["event", "--canonical", "--authority-receipt-file", receiptPath]), "MH_TRUTH_PATH", /symlink|junction|reparse/i);
  assert.deepEqual(fs.readdirSync(outside), before);
});

test("linked harness status parent is rejected before refresh", () => {
  const cwd = tempDir("truth-status-parent-link-");
  run(cwd, ["init", "Status parent confinement"]);
  const harness = path.join(cwd, ".meta-harness");
  const outsideRoot = tempDir("truth-status-parent-outside-");
  const outsideHarness = path.join(outsideRoot, "harness");
  fs.renameSync(harness, outsideHarness);
  fs.symlinkSync(outsideHarness, harness, process.platform === "win32" ? "junction" : "dir");
  const statusPath = path.join(outsideHarness, "status.md");
  const before = fs.readFileSync(statusPath, "utf8");
  assertCliError(runRaw(cwd, ["status", "--refresh"]), "MH_TRUTH_PATH", /symlink|junction|reparse/i);
  assert.equal(fs.readFileSync(statusPath, "utf8"), before);
});

test("linked authority contract parent is rejected before canonical read", () => {
  const cwd = tempDir("truth-authority-parent-link-");
  run(cwd, ["init", "Authority path confinement"]);
  const contracts = path.join(cwd, ".meta-harness", "contracts");
  const outside = tempDir("truth-authority-parent-outside-");
  fs.renameSync(path.join(contracts, "truth-authority-public.json"), path.join(outside, "truth-authority-public.json"));
  fs.rmSync(contracts, { recursive: true, force: true });
  fs.symlinkSync(outside, contracts, process.platform === "win32" ? "junction" : "dir");
  const before = fs.readFileSync(path.join(outside, "truth-authority-public.json"), "utf8");
  assertCliError(runRaw(cwd, ["status"]), "MH_TRUTH_PATH", /symlink|junction|reparse/i);
  assert.equal(fs.readFileSync(path.join(outside, "truth-authority-public.json"), "utf8"), before);
});

test("packaged runtime exposes no key generation, private-key loading, or receipt signer", () => {
  const runtime = require("../lib/truth-authority");
  for (const forbidden of ["PRIVATE_KEY_RELATIVE_PATH", "createTruthAuthorityReceipt", "ensureTruthAuthority", "loadPrivateKey", "privateKeyPath"]) {
    assert.equal(Object.prototype.hasOwnProperty.call(runtime, forbidden), false, forbidden);
  }
  const sources = ["truth-authority.js", "truth-authority-contract.js"].map((name) => fs.readFileSync(path.join(__dirname, "..", "lib", name), "utf8")).join("\n");
  assert.doesNotMatch(sources, /generateKeyPairSync|createPrivateKey|crypto\.sign|truth-authority-private\.json/);
  const cwd = tempDir("truth-worker-read-access-");
  run(cwd, ["init", "Worker cannot mint truth"]);
  const targetFiles = fs.readdirSync(path.join(cwd, ".meta-harness", "local"), { recursive: true });
  assert.equal(targetFiles.some((name) => /private|signer/i.test(String(name))), false);
  assert.equal(inspectCanonicalHistory(readJsonl(path.join(cwd, ".meta-harness", "events.jsonl")), { targetRoot: cwd }).ok, true);
});
