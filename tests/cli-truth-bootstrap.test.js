"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const test = require("node:test");

const { canonicalize } = require("../lib/contracts/canonical-json");
const { domainDigest } = require("../lib/contracts/digest");
const {
  CAPABILITY,
  LEGACY_RECEIPT_SCHEMA,
  createTruthProposal,
  eventFromTruthReceipt,
  normalizePublicAuthority,
  signerKeyId,
} = require("../lib/truth-authority");
const { BOOTSTRAP_LOCK_STALE_MS } = require("../lib/bootstrap-lock");
const { inspectCanonicalHistory } = require("../lib/truth-reconciler");
const {
  CLI, assertCliError, readJsonl, run, runRaw, tempDir,
} = require("./helpers/cli");
const {
  createExternalAuthority,
  signTruthReceipt,
} = require("./helpers/truth-authority");

function writeJson(root, name, value) {
  const filePath = path.join(root, name);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  return filePath;
}

function externalInputs(authorityDocument, receipt) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "meta-harness-bootstrap-input-"));
  return {
    publicPath: writeJson(root, "authority.json", authorityDocument),
    receiptPath: writeJson(root, "receipt.json", receipt),
  };
}

function initArgs(authorityDocument, receipt) {
  const inputs = externalInputs(authorityDocument, receipt);
  return [
    "init",
    "--authority-public-key-file", inputs.publicPath,
    "--authority-receipt-file", inputs.receiptPath,
  ];
}

function runAsync(cwd, args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI, ...args], { cwd, shell: false, windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("close", (status) => resolve({ status, stdout, stderr }));
  });
}

function initialReceipt(authority, options = {}) {
  const issuedAt = options.issuedAt || new Date().toISOString();
  const operation = options.operation || "snapshot";
  return signTruthReceipt({
    authority: options.signingAuthority || authority,
    issuedAt,
    ttlSeconds: options.ttlSeconds || 300,
    priorSnapshotDigest: options.priorSnapshotDigest || null,
    proposal: {
      operation,
      stream: "coding",
      phase: "intake",
      action: "initialized harness",
      result: "per-repo harness state created",
      goal: "Signed canonical status",
      next_action: "Translate the goal into a bounded worker task.",
      stop_criteria: "Stop on contradiction.",
      evidence: null,
      decision: null,
      occurred_at: issuedAt,
      rejected_event_digests: operation === "reconcile" ? [`sha256:${"1".repeat(64)}`] : [],
    },
  });
}

function treeSnapshot(root) {
  const snapshot = {};
  function walk(relative) {
    const absolute = path.join(root, relative);
    for (const entry of fs.readdirSync(absolute, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const child = path.join(relative, entry.name);
      if (entry.isDirectory()) {
        snapshot[`dir:${child}`] = true;
        walk(child);
      } else if (entry.isSymbolicLink()) {
        snapshot[`link:${child}`] = fs.readlinkSync(path.join(root, child));
      } else {
        snapshot[`file:${child}`] = fs.readFileSync(path.join(root, child)).toString("base64");
      }
    }
  }
  walk("");
  return snapshot;
}

test("init consumes external authority and stores verifier material only", () => {
  const cwd = tempDir("truth-init-");
  run(cwd, ["init", "Signed canonical status"]);
  const authorityPath = path.join(cwd, ".meta-harness", "contracts", "truth-authority-public.json");
  const authority = JSON.parse(fs.readFileSync(authorityPath, "utf8"));
  assert.equal(authority.schema_version, "meta-harness-truth-authority-public/v1");
  assert.equal(typeof authority.repository_id, "string");
  assert.equal(typeof authority.public_key.x, "string");
  assert.equal(Object.prototype.hasOwnProperty.call(authority.public_key, "d"), false);
  assert.equal(fs.existsSync(path.join(cwd, ".meta-harness", "local", "truth-authority-private.json")), false);
  const events = readJsonl(path.join(cwd, ".meta-harness", "events.jsonl"));
  assert.equal(events.length, 1);
  assert.equal(events[0].actor, "controller");
  assert.equal(events[0].authority_receipt.repository_id, authority.repository_id);
  assert.match(run(cwd, ["status"]), /Signed canonical status/);
});

test("init rejects self-authored canonical content and missing external authority without writes", () => {
  const selfAuthored = tempDir("truth-init-self-authored-");
  assertCliError(runRaw(selfAuthored, ["init", "worker-selected goal"]), "MH_USAGE", /content comes only/i);
  assert.deepEqual(treeSnapshot(selfAuthored), {});
  const missing = tempDir("truth-init-missing-");
  assertCliError(runRaw(missing, ["init"]), "MH_USAGE", /authority-public-key-file/i);
  assert.deepEqual(treeSnapshot(missing), {});
});

test("invalid bootstrap contracts and receipts leave the target byte-identical", () => {
  const cases = [
    ["invalid signature", (authority) => { const receipt = initialReceipt(authority); receipt.signature = `${receipt.signature.slice(0, -2)}aa`; return [authority.publicDocument, receipt, /signature is invalid/i]; }],
    ["expired", (authority) => [authority.publicDocument, initialReceipt(authority, { issuedAt: "2026-01-01T00:00:00.000Z", ttlSeconds: 1 }), /outside its validity window/i]],
    ["overlong", (authority) => [authority.publicDocument, initialReceipt(authority, { ttlSeconds: 301 }), /must not exceed 300 seconds/i]],
    ["wrong repository", (authority) => [authority.publicDocument, initialReceipt(authority, { signingAuthority: { ...authority, repositoryId: "test-repository:other" } }), /different repository identity/i]],
    ["wrong prior", (authority) => [authority.publicDocument, initialReceipt(authority, { priorSnapshotDigest: `sha256:${"0".repeat(64)}` }), /not bound to the current canonical snapshot/i]],
    ["non-snapshot", (authority) => [authority.publicDocument, initialReceipt(authority, { operation: "reconcile" }), /must authorize a snapshot/i]],
    ["tampered proposal", (authority) => { const receipt = initialReceipt(authority); receipt.proposal.goal = "tampered"; return [authority.publicDocument, receipt, /proposal_digest|signature/i]; }],
    ["RSA authority", (authority) => { const rsa = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 }).publicKey.export({ format: "jwk" }); return [{ ...authority.publicDocument, public_key: rsa }, initialReceipt(authority), /OKP Ed25519/i]; }],
  ];
  for (const [name, build] of cases) {
    const cwd = tempDir(`truth-bootstrap-${name.replace(/\s+/g, "-")}-`);
    const authority = createExternalAuthority();
    const [document, receipt, pattern] = build(authority);
    const before = treeSnapshot(cwd);
    assertCliError(runRaw(cwd, initArgs(document, receipt)), "MH_TRUTH_AUTHORITY", pattern);
    assert.deepEqual(treeSnapshot(cwd), before, name);
  }
});

test("failed bootstrap cannot pre-claim authority and a legitimate retry succeeds", () => {
  const cwd = tempDir("truth-bootstrap-retry-");
  const hostile = createExternalAuthority("audit:hostile");
  const rejected = initialReceipt(hostile);
  rejected.signature = "invalid";
  assertCliError(runRaw(cwd, initArgs(hostile.publicDocument, rejected)), "MH_TRUTH_AUTHORITY", /signature is invalid/i);
  assert.equal(fs.existsSync(path.join(cwd, ".meta-harness")), false);
  const legitimate = createExternalAuthority("audit:legitimate");
  const result = runRaw(cwd, initArgs(legitimate.publicDocument, initialReceipt(legitimate)));
  assert.equal(result.status, 0, result.stderr);
});

test("concurrent bootstrap accepts exactly one authority", async () => {
  const cwd = tempDir("truth-bootstrap-concurrent-");
  const first = createExternalAuthority("audit:concurrent:first");
  const second = createExternalAuthority("audit:concurrent:second");
  const results = await Promise.all([
    runAsync(cwd, initArgs(first.publicDocument, initialReceipt(first))),
    runAsync(cwd, initArgs(second.publicDocument, initialReceipt(second))),
  ]);
  assert.deepEqual(results.map((result) => result.status).sort(), [0, 1]);
  const failure = results.find((result) => result.status !== 0);
  assert.match(failure.stderr, /bootstrap is already in progress|already initialized/i);
  assert.equal(readJsonl(path.join(cwd, ".meta-harness", "events.jsonl")).length, 1);
  assert.equal(fs.existsSync(path.join(cwd, ".meta-harness-bootstrap.lock")), false);
});

test("initialized repositories return explicit no-write result", () => {
  const cwd = tempDir("truth-init-one-shot-");
  run(cwd, ["init", "One shot"]);
  const before = treeSnapshot(cwd);
  const authority = createExternalAuthority("audit:second-init");
  assertCliError(runRaw(cwd, initArgs(authority.publicDocument, initialReceipt(authority))), "MH_ALREADY_INITIALIZED", /already initialized/i);
  assert.deepEqual(treeSnapshot(cwd), before);
});

test("stale dead-owner bootstrap lock recovers, live-owner lock remains", () => {
  const staleRoot = tempDir("truth-bootstrap-stale-");
  const stalePath = path.join(staleRoot, ".meta-harness-bootstrap.lock");
  fs.writeFileSync(stalePath, `${JSON.stringify({ schema_version: "meta-harness-bootstrap-lock/v1", pid: 2147483647, created_at: new Date(Date.now() - BOOTSTRAP_LOCK_STALE_MS - 1000).toISOString(), token: "stale" })}\n`);
  const authority = createExternalAuthority("audit:stale-lock");
  const result = runRaw(staleRoot, initArgs(authority.publicDocument, initialReceipt(authority)));
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.existsSync(stalePath), false);

  const liveRoot = tempDir("truth-bootstrap-live-");
  const livePath = path.join(liveRoot, ".meta-harness-bootstrap.lock");
  fs.writeFileSync(livePath, `${JSON.stringify({ schema_version: "meta-harness-bootstrap-lock/v1", pid: process.pid, created_at: new Date(Date.now() - BOOTSTRAP_LOCK_STALE_MS - 1000).toISOString(), token: "live" })}\n`);
  const liveAuthority = createExternalAuthority("audit:live-lock");
  assertCliError(runRaw(liveRoot, initArgs(liveAuthority.publicDocument, initialReceipt(liveAuthority))), "MH_TRUTH_AUTHORITY", /already in progress/i);
  assert.equal(fs.existsSync(livePath), true);
});

test("linked harness bootstrap targets are rejected without external writes", { skip: process.platform === "win32" }, () => {
  const cwd = tempDir("truth-init-linked-");
  const outside = tempDir("truth-init-outside-");
  fs.symlinkSync(outside, path.join(cwd, ".meta-harness"), "dir");
  const authority = createExternalAuthority("audit:linked-bootstrap");
  const before = treeSnapshot(outside);
  assertCliError(runRaw(cwd, initArgs(authority.publicDocument, initialReceipt(authority))), "MH_TRUTH_PATH", /symlink|junction|reparse/i);
  assert.deepEqual(treeSnapshot(outside), before);
});

test("legacy Ed25519 history remains readable while non-Ed25519 legacy keys are rejected", () => {
  const cwd = tempDir("truth-legacy-read-");
  const authority = createExternalAuthority("audit:legacy-read");
  writeJson(cwd, ".meta-harness/contracts/truth-authority-public.json", authority.publicKey);
  const issuedAt = new Date().toISOString();
  const proposal = createTruthProposal({ operation: "snapshot", stream: "coding", phase: "verify", action: "verify legacy", result: "legacy history remains readable", goal: "preserve D078 evidence", next_action: "migrate only through a reviewed candidate", stop_criteria: "stop on verification loss", evidence: null, decision: null, occurred_at: issuedAt, rejected_event_digests: [] });
  const body = { schema_version: LEGACY_RECEIPT_SCHEMA, receipt_id: "legacy-readable", capability: CAPABILITY, prior_snapshot_digest: null, proposal, proposal_digest: domainDigest("truth-proposal/v1", proposal), signer_key_id: signerKeyId(authority.publicKey), issued_at: issuedAt, expires_at: new Date(Date.parse(issuedAt) + 300000).toISOString() };
  const signature = crypto.sign(null, Buffer.from(`truth-authority-receipt/v1\u001e${canonicalize(body)}`, "utf8"), crypto.createPrivateKey({ key: authority.privateKey, format: "jwk" })).toString("base64url");
  const history = inspectCanonicalHistory([eventFromTruthReceipt({ ...body, signature })], { targetRoot: cwd });
  assert.equal(history.ok, true);
  const rsa = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 }).publicKey.export({ format: "jwk" });
  assert.throws(() => normalizePublicAuthority(rsa), /OKP Ed25519/i);
});
