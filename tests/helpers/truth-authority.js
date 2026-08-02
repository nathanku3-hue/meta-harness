"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { canonicalize } = require("../../lib/contracts/canonical-json");
const { domainDigest } = require("../../lib/contracts/digest");
const { readEvents } = require("../../lib/harness-state");
const {
  AUTHORITY_SCHEMA,
  CAPABILITY,
  RECEIPT_SCHEMA,
  createTruthProposal,
  signerKeyId,
} = require("../../lib/truth-authority");
const { inspectCanonicalHistory } = require("../../lib/truth-reconciler");

const AUTHORITIES = new Map();
const RECEIPT_BODY_KEYS = Object.freeze([
  "schema_version", "receipt_id", "capability", "repository_id", "prior_snapshot_digest",
  "proposal", "proposal_digest", "signer_key_id", "issued_at", "expires_at",
]);

function rootKey(targetRoot) {
  return path.resolve(targetRoot);
}

function createExternalAuthority(repositoryId = `test-repository:${crypto.randomUUID()}`) {
  const pair = crypto.generateKeyPairSync("ed25519");
  const publicKey = pair.publicKey.export({ format: "jwk" });
  return {
    repositoryId,
    publicDocument: {
      schema_version: AUTHORITY_SCHEMA,
      repository_id: repositoryId,
      public_key: publicKey,
    },
    publicKey,
    privateKey: pair.privateKey.export({ format: "jwk" }),
  };
}

function registerAuthority(targetRoot, authority) {
  AUTHORITIES.set(rootKey(targetRoot), authority);
  return authority;
}

function authorityForTarget(targetRoot) {
  const authority = AUTHORITIES.get(rootKey(targetRoot));
  if (!authority) throw new Error(`No external test authority registered for ${targetRoot}`);
  return authority;
}

function installTestAuthority(targetRoot, authority = createExternalAuthority()) {
  const authorityPath = path.join(targetRoot, ".meta-harness", "contracts", "truth-authority-public.json");
  fs.mkdirSync(path.dirname(authorityPath), { recursive: true });
  fs.writeFileSync(authorityPath, `${JSON.stringify(authority.publicDocument, null, 2)}\n`, "utf8");
  registerAuthority(targetRoot, authority);
  return authority;
}

function receiptBody(receipt) {
  return Object.fromEntries(RECEIPT_BODY_KEYS.map((key) => [key, receipt[key]]));
}

function signTruthReceipt({
  authority,
  proposal,
  priorSnapshotDigest = null,
  receiptId = crypto.randomUUID(),
  issuedAt = new Date().toISOString(),
  ttlSeconds = 300,
} = {}) {
  const normalizedProposal = createTruthProposal(proposal);
  const expiresAt = new Date(Date.parse(issuedAt) + (ttlSeconds * 1000)).toISOString();
  const body = {
    schema_version: RECEIPT_SCHEMA,
    receipt_id: receiptId,
    capability: CAPABILITY,
    repository_id: authority.repositoryId,
    prior_snapshot_digest: priorSnapshotDigest,
    proposal: normalizedProposal,
    proposal_digest: domainDigest("truth-proposal/v1", normalizedProposal),
    signer_key_id: signerKeyId(authority.publicKey),
    issued_at: issuedAt,
    expires_at: expiresAt,
  };
  const bytes = Buffer.from(`truth-authority-receipt/v2\u001e${canonicalize(receiptBody(body))}`, "utf8");
  const signature = crypto.sign(
    null,
    bytes,
    crypto.createPrivateKey({ key: authority.privateKey, format: "jwk" }),
  ).toString("base64url");
  return { ...body, signature };
}

function mintReceiptForTarget(targetRoot, overrides = {}) {
  const authority = authorityForTarget(targetRoot);
  const events = readEvents({ cwd: targetRoot });
  const history = inspectCanonicalHistory(events, { targetRoot });
  const issuedAt = overrides.occurred_at || overrides.issuedAt || new Date().toISOString();
  const proposal = createTruthProposal({
    operation: overrides.operation || "snapshot",
    stream: overrides.stream || "coding",
    phase: overrides.phase || "plan",
    action: overrides.action || "advance canonical truth",
    result: overrides.result || "Verifier-only canonical authority remains active.",
    goal: overrides.goal || "Block contradictory canonical truth.",
    next_action: overrides.next_action || "Continue the authorized slice only.",
    stop_criteria: overrides.stop_criteria || "Stop on any contradiction.",
    evidence: overrides.evidence,
    decision: overrides.decision,
    occurred_at: issuedAt,
    rejected_event_digests: overrides.rejected_event_digests || [],
  });
  return signTruthReceipt({
    authority,
    proposal,
    priorSnapshotDigest: overrides.prior_snapshot_digest === undefined
      ? history.snapshotDigest
      : overrides.prior_snapshot_digest,
    issuedAt,
    ttlSeconds: overrides.ttl_seconds || 300,
    receiptId: overrides.receipt_id,
  });
}

function prepareInitInvocation(targetRoot, args) {
  if (args[0] !== "init" || args.includes("--authority-receipt-file")) return args;
  const goal = args.slice(1).filter((value) => !String(value).startsWith("--")).join(" ") || "Not set.";
  const authority = registerAuthority(targetRoot, createExternalAuthority());
  const issuedAt = new Date().toISOString();
  const receipt = signTruthReceipt({
    authority,
    issuedAt,
    proposal: {
      operation: "snapshot",
      stream: "coding",
      phase: "intake",
      action: "initialized harness",
      goal,
      result: "per-repo harness state created",
      evidence: ".meta-harness starter files exist",
      decision: null,
      next_action: "Translate the goal into a bounded worker task.",
      stop_criteria: "Fresh human and Codex worker can resume from local harness state.",
      occurred_at: issuedAt,
      rejected_event_digests: [],
    },
  });
  const authorityDir = fs.mkdtempSync(path.join(os.tmpdir(), "meta-harness-external-authority-"));
  const publicPath = path.join(authorityDir, "truth-authority-public.json");
  const receiptPath = path.join(authorityDir, "truth-authority-receipt.json");
  fs.writeFileSync(publicPath, `${JSON.stringify(authority.publicDocument, null, 2)}\n`, "utf8");
  fs.writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
  return [
    "init",
    "--authority-public-key-file", publicPath,
    "--authority-receipt-file", receiptPath,
  ];
}

module.exports = {
  authorityForTarget,
  createExternalAuthority,
  installTestAuthority,
  mintReceiptForTarget,
  prepareInitInvocation,
  registerAuthority,
  signTruthReceipt,
};
