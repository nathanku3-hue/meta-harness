"use strict";

/** Immutable terminal evidence preparation, publication, and replay verification. */

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const { validateRunSpecApproval } = require("../../lib/contracts/run-spec-approval");
const { validateAttemptAuthorization } = require("../../lib/contracts/attempt-authorization");
const {
  codedError,
  isPlainObject,
  isNonEmptyString,
  publishNoReplace,
  sha256File,
  assertClaimDigest,
  assertJournalDigest,
  assertAssessmentDigest,
} = require("./support");
const { canonicalReceiptPath } = require("./custody-replay");

const MANIFEST_SCHEMA = "execution-custody-manifest/v1";
const MANIFEST_NAME = "custody-manifest.json";
const REQUIRED_FILES = Object.freeze([
  "run-spec-approval.json",
  "authorization-request.json",
  "readiness.json",
  "authorization-receipt.json",
  "workspace-attestation.json",
  "start-check.json",
  "ao-process-meta.json",
  "change-artifact.json",
  "change-artifact.schema.json",
  "git.name-status",
  "git.patch",
  "validation.stdout",
  "validation.stderr",
  "implementation-facts.json",
  "implementation-assessment.json",
  "terminal-journal.json",
]);

function jsonBytes(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function sha256Bytes(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function manifestDigest(body) {
  return `sha256:${sha256Bytes(jsonBytes(body))}`;
}

function parseJsonFile(filePath, label) {
  let bytes;
  try {
    bytes = fs.readFileSync(filePath);
  } catch (err) {
    throw codedError("CUSTODY_TERMINAL_EVIDENCE_CORRUPT", `${label} unreadable: ${err.message}`);
  }
  try {
    return { bytes, value: JSON.parse(bytes.toString("utf8")) };
  } catch (err) {
    throw codedError("CUSTODY_TERMINAL_EVIDENCE_CORRUPT", `${label} invalid JSON: ${err.message}`);
  }
}

function stageFile(stageDir, name, bytes, entries) {
  publishNoReplace(path.join(stageDir, name), bytes);
  entries.push({ name, sha256: sha256Bytes(bytes), bytes: bytes.length });
}

function verifyEvidenceDirectory({ directory, stateRoot, authReqHex, receipt, claim, journal }) {
  const manifest = parseJsonFile(path.join(directory, MANIFEST_NAME), MANIFEST_NAME).value;
  if (!isPlainObject(manifest) || manifest.schemaVersion !== MANIFEST_SCHEMA) {
    throw codedError("CUSTODY_TERMINAL_EVIDENCE_CORRUPT", "custody manifest schema invalid");
  }
  const body = { ...manifest };
  delete body.terminalManifestDigest;
  if (!isNonEmptyString(manifest.terminalManifestDigest)
    || manifestDigest(body) !== manifest.terminalManifestDigest) {
    throw codedError("CUSTODY_TERMINAL_EVIDENCE_CORRUPT", "custody manifest digest mismatch");
  }
  if (manifest.authorizationRequestDigest !== receipt.authorizationRequestDigest
    || manifest.authorizationReceiptDigest !== receipt.receiptDigest
    || manifest.runSpecDigest !== receipt.runSpecDigest
    || manifest.claimDigest !== claim.claimDigest
    || manifest.startCheckDigest !== journal.startCheckDigest
    || manifest.factsDigest !== journal.factsDigest
    || manifest.implementationAssessmentDigest !== journal.implementationAssessmentDigest
    || manifest.verifiedHeadRevision !== journal.verifiedHeadRevision
    || manifest.durableRef !== journal.durableRef) {
    throw codedError("CUSTODY_TERMINAL_EVIDENCE_CORRUPT", "custody manifest terminal bindings mismatch");
  }

  if (!Array.isArray(manifest.files)) {
    throw codedError("CUSTODY_TERMINAL_EVIDENCE_CORRUPT", "custody manifest files must be an array");
  }
  const entryMap = new Map();
  for (const entry of manifest.files) {
    if (!isPlainObject(entry)
      || !REQUIRED_FILES.includes(entry.name)
      || !/^[a-f0-9]{64}$/.test(String(entry.sha256 || ""))
      || !Number.isInteger(entry.bytes)
      || entry.bytes < 0
      || entryMap.has(entry.name)) {
      throw codedError("CUSTODY_TERMINAL_EVIDENCE_CORRUPT", "custody manifest file entry invalid");
    }
    entryMap.set(entry.name, entry);
  }
  for (const name of REQUIRED_FILES) {
    const entry = entryMap.get(name);
    if (!entry) {
      throw codedError("CUSTODY_TERMINAL_EVIDENCE_CORRUPT", `custody manifest missing ${name}`);
    }
    const filePath = path.join(directory, name);
    let stat;
    try { stat = fs.statSync(filePath); } catch (err) {
      throw codedError("CUSTODY_TERMINAL_EVIDENCE_CORRUPT", `${name} missing: ${err.message}`);
    }
    if (!stat.isFile() || stat.size !== entry.bytes || sha256File(filePath) !== entry.sha256) {
      throw codedError("CUSTODY_TERMINAL_EVIDENCE_CORRUPT", `${name} digest or size mismatch`);
    }
  }

  const approval = parseJsonFile(path.join(directory, "run-spec-approval.json"), "run-spec-approval.json").value;
  const approvalCheck = validateRunSpecApproval(approval);
  if (!approvalCheck.ok || approval.runSpecDigest !== receipt.runSpecDigest) {
    throw codedError("CUSTODY_TERMINAL_EVIDENCE_CORRUPT", "stored RunSpecApproval invalid or conflicting");
  }
  const storedReceiptRead = parseJsonFile(
    path.join(directory, "authorization-receipt.json"),
    "authorization-receipt.json",
  );
  const receiptCheck = validateAttemptAuthorization(storedReceiptRead.value);
  if (!receiptCheck.ok || storedReceiptRead.value.receiptDigest !== receipt.receiptDigest) {
    throw codedError("CUSTODY_TERMINAL_EVIDENCE_CORRUPT", "stored receipt invalid or conflicting");
  }
  const canonicalBytes = fs.readFileSync(canonicalReceiptPath(stateRoot, receipt.authorizationId));
  if (!canonicalBytes.equals(storedReceiptRead.bytes)) {
    throw codedError("CUSTODY_RECEIPT_COPY_CONFLICT", "evidence receipt differs from canonical index");
  }

  const storedClaim = parseJsonFile(
    path.join(stateRoot, "attempts", authReqHex, "claim.json"),
    "claim.json",
  ).value;
  assertClaimDigest(storedClaim);
  if (storedClaim.claimDigest !== claim.claimDigest) {
    throw codedError("CUSTODY_TERMINAL_EVIDENCE_CORRUPT", "claim digest differs from manifest binding");
  }
  const storedJournal = parseJsonFile(
    path.join(directory, "terminal-journal.json"),
    "terminal-journal.json",
  ).value;
  assertJournalDigest(storedJournal);
  if (storedJournal.journalDigest !== journal.journalDigest) {
    throw codedError("CUSTODY_TERMINAL_EVIDENCE_CORRUPT", "terminal journal differs from binding");
  }
  const assessment = parseJsonFile(
    path.join(directory, "implementation-assessment.json"),
    "implementation-assessment.json",
  ).value;
  assertAssessmentDigest(assessment);
  if (assessment.implementationAssessmentDigest !== journal.implementationAssessmentDigest) {
    throw codedError("CUSTODY_TERMINAL_EVIDENCE_CORRUPT", "assessment binding mismatch");
  }

  return { manifest, terminalManifestDigest: manifest.terminalManifestDigest, assessment };
}

function prepareTerminalEvidence(options) {
  const {
    stateRoot,
    authReqHex,
    runSpecApproval,
    authorizationRequest,
    readiness,
    receipt,
    attestation,
    startCheck,
    claim,
    aoProcessMetaPath,
    changeArtifactPath,
    changeArtifactSchemaPath,
    workingDir,
    implementationFacts,
    assessment,
    terminalJournal,
    verifiedHeadRevision,
    durableRef,
    publishedAt,
  } = options;
  const attemptDir = path.join(stateRoot, "attempts", authReqHex);
  const evidenceDir = path.join(attemptDir, "evidence");
  if (fs.existsSync(evidenceDir)) {
    throw codedError("CUSTODY_TERMINAL_EVIDENCE_EXISTS", "terminal evidence directory already exists");
  }
  const stageDir = path.join(attemptDir, `.terminal-stage-${crypto.randomBytes(12).toString("hex")}`);
  fs.mkdirSync(stageDir, { recursive: false });
  const entries = [];

  try {
    stageFile(stageDir, "run-spec-approval.json", jsonBytes(runSpecApproval), entries);
    stageFile(stageDir, "authorization-request.json", jsonBytes(authorizationRequest), entries);
    stageFile(stageDir, "readiness.json", jsonBytes(readiness), entries);
    const canonicalReceiptBytes = fs.readFileSync(
      canonicalReceiptPath(stateRoot, authorizationRequest.authorizationId),
    );
    stageFile(stageDir, "authorization-receipt.json", canonicalReceiptBytes, entries);
    stageFile(stageDir, "workspace-attestation.json", jsonBytes(attestation), entries);
    stageFile(stageDir, "start-check.json", jsonBytes(startCheck), entries);
    stageFile(stageDir, "ao-process-meta.json", fs.readFileSync(aoProcessMetaPath), entries);
    stageFile(stageDir, "change-artifact.json", fs.readFileSync(changeArtifactPath), entries);
    stageFile(stageDir, "change-artifact.schema.json", fs.readFileSync(changeArtifactSchemaPath), entries);
    for (const name of ["git.name-status", "git.patch", "validation.stdout", "validation.stderr"]) {
      stageFile(stageDir, name, fs.readFileSync(path.join(workingDir, name)), entries);
    }
    stageFile(stageDir, "implementation-facts.json", jsonBytes(implementationFacts), entries);
    stageFile(stageDir, "implementation-assessment.json", jsonBytes(assessment), entries);
    stageFile(stageDir, "terminal-journal.json", jsonBytes(terminalJournal), entries);

    const body = {
      schemaVersion: MANIFEST_SCHEMA,
      authorizationRequestDigest: receipt.authorizationRequestDigest,
      authorizationReceiptDigest: receipt.receiptDigest,
      runSpecDigest: receipt.runSpecDigest,
      claimDigest: claim.claimDigest,
      startCheckDigest: startCheck.startCheckDigest,
      factsDigest: implementationFacts.factsDigest,
      implementationAssessmentDigest: assessment.implementationAssessmentDigest,
      verifiedHeadRevision,
      durableRef,
      publishedAt,
      files: entries.slice().sort((left, right) => left.name.localeCompare(right.name)),
    };
    const terminalManifestDigest = manifestDigest(body);
    const manifest = { ...body, terminalManifestDigest };
    publishNoReplace(path.join(stageDir, MANIFEST_NAME), jsonBytes(manifest));

    const context = { stateRoot, authReqHex, receipt, claim, journal: terminalJournal };
    verifyEvidenceDirectory({ directory: stageDir, ...context });
    return { stageDir, evidenceDir, manifest, terminalManifestDigest, context };
  } catch (err) {
    try { fs.rmSync(stageDir, { recursive: true, force: true }); } catch { /* ignore */ }
    throw err;
  }
}

function publishPreparedTerminalEvidence(prepared) {
  const { stageDir, evidenceDir, context } = prepared;
  try {
    fs.mkdirSync(evidenceDir, { recursive: false });
  } catch (err) {
    throw codedError(
      "CUSTODY_TERMINAL_PUBLISH_FAILED",
      `terminal evidence directory no-replace claim failed: ${err.message}`,
      { causeCode: err && err.code },
    );
  }

  try {
    for (const name of REQUIRED_FILES) {
      fs.copyFileSync(
        path.join(stageDir, name),
        path.join(evidenceDir, name),
        fs.constants.COPYFILE_EXCL,
      );
    }
    fs.copyFileSync(
      path.join(stageDir, MANIFEST_NAME),
      path.join(evidenceDir, MANIFEST_NAME),
      fs.constants.COPYFILE_EXCL,
    );
    const verified = verifyEvidenceDirectory({ directory: evidenceDir, ...context });
    fs.rmSync(stageDir, { recursive: true, force: true });
    return { evidenceDir, ...verified };
  } catch (err) {
    try { fs.rmSync(stageDir, { recursive: true, force: true }); } catch { /* ignore */ }
    throw codedError(
      "CUSTODY_TERMINAL_PUBLISH_FAILED",
      `terminal evidence publication failed closed: ${err.message}`,
      { causeCode: err && err.code },
    );
  }
}

function discardPreparedTerminalEvidence(prepared) {
  if (!prepared || !prepared.stageDir) return;
  try { fs.rmSync(prepared.stageDir, { recursive: true, force: true }); } catch { /* ignore */ }
}

function verifyTerminalEvidence({ stateRoot, authReqHex, receipt, claim, journal }) {
  const evidenceDir = path.join(stateRoot, "attempts", authReqHex, "evidence");
  const verified = verifyEvidenceDirectory({
    directory: evidenceDir,
    stateRoot,
    authReqHex,
    receipt,
    claim,
    journal,
  });
  return { evidenceDir, ...verified };
}

module.exports = {
  MANIFEST_SCHEMA,
  REQUIRED_FILES,
  prepareTerminalEvidence,
  publishPreparedTerminalEvidence,
  discardPreparedTerminalEvidence,
  verifyTerminalEvidence,
};
