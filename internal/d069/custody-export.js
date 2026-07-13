"use strict";

/**
 * D072 privacy-safe portable custody export.
 * Local custody remains exact and authoritative. The portable pack contains a
 * prerequisite thin bundle, exact safe objects, redacted projections, and a
 * canonical manifest written last.
 */

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const {
  codedError,
  isPlainObject,
  publishNoReplace,
  sha256File,
} = require("./support");
const {
  ensureIsolatedGitHome,
  runGit,
} = require("./git-ops");
const { verifyTerminalEvidence } = require("./terminal-evidence");

const EXPORT_SCHEMA = "d072-portable-custody-export/v1";
const SAFE_EXACT_FILES = Object.freeze([
  "authorization-request.json",
  "readiness.json",
  "authorization-receipt.json",
  "start-check.json",
  "change-artifact.json",
  "change-artifact.schema.json",
  "git.name-status",
  "git.patch",
  "validation.stdout",
  "validation.stderr",
  "implementation-assessment.json",
  "terminal-journal.json",
]);

function jsonBytes(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function sha256Bytes(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function parseJson(filePath, label) {
  let bytes;
  try {
    bytes = fs.readFileSync(filePath);
  } catch (err) {
    throw codedError("D072_EXPORT_SOURCE", `${label} unreadable: ${err.message}`);
  }
  try {
    return { bytes, value: JSON.parse(bytes.toString("utf8")) };
  } catch (err) {
    throw codedError("D072_EXPORT_SOURCE", `${label} invalid JSON: ${err.message}`);
  }
}

function writePortable(stageDir, relativePath, bytes, exported) {
  const target = path.join(stageDir, relativePath);
  publishNoReplace(target, bytes);
  exported.push({
    path: relativePath.replace(/\\/g, "/"),
    sha256: sha256Bytes(bytes),
    bytes: bytes.length,
  });
}

function sourceHashes(evidenceDir, manifest) {
  const out = [];
  for (const entry of manifest.files || []) {
    const sourcePath = path.join(evidenceDir, entry.name);
    out.push({
      name: entry.name,
      sha256: sha256File(sourcePath),
      bytes: fs.statSync(sourcePath).size,
      exactBytesIncluded: SAFE_EXACT_FILES.includes(entry.name),
      independentlyRecomputable: SAFE_EXACT_FILES.includes(entry.name),
    });
  }
  return out.sort((left, right) => left.name.localeCompare(right.name));
}

function buildApprovalProjection(approval) {
  return {
    schemaVersion: "d072-run-spec-approval-projection/v1",
    approvalId: approval.approvalId,
    approvedBy: approval.approvedBy,
    approvedAt: approval.approvedAt,
    approvalDigest: approval.approvalDigest,
    runSpecDigest: approval.runSpecDigest,
    run: {
      runId: approval.runSpec && approval.runSpec.runId,
      repository: approval.runSpec && approval.runSpec.repository,
      objective: approval.runSpec && approval.runSpec.objective,
      scope: approval.runSpec && approval.runSpec.scope,
      changePolicy: approval.runSpec && approval.runSpec.changePolicy,
      validationCommandCount: approval.runSpec
        && approval.runSpec.validation
        && Array.isArray(approval.runSpec.validation.commands)
        ? approval.runSpec.validation.commands.length
        : null,
    },
    redactions: ["validation.commands.argv", "validation command host paths"],
  };
}

function buildAttestationProjection(attestation) {
  return {
    schemaVersion: "d072-workspace-attestation-projection/v1",
    runId: attestation.runId,
    attemptId: attestation.attemptId,
    provider: attestation.provider,
    repositoryId: attestation.repositoryId,
    objectFormat: attestation.objectFormat,
    workspaceRef: attestation.workspaceRef,
    branch: attestation.branch,
    baseRevision: attestation.baseRevision,
    currentHead: attestation.currentHead,
    clean: attestation.clean,
    runSpecDigest: attestation.runSpecDigest,
    authorizationReceiptDigest: attestation.authorizationReceiptDigest,
    workspacePolicyDigest: attestation.workspacePolicyDigest,
    collectedAt: attestation.collectedAt,
    attestationDigest: attestation.attestationDigest,
    repositoryRoot: "<redacted-local-path>",
    redactions: ["repositoryRoot"],
  };
}

function buildAoProjection(meta) {
  return {
    schemaVersion: "d072-ao-process-meta-projection/v1",
    spawnOrdinal: meta.spawnOrdinal,
    exitCode: meta.exitCode,
    timedOut: meta.timedOut,
    capBreached: meta.capBreached,
    stdoutSha256: meta.stdoutSha256,
    stderrSha256: meta.stderrSha256,
    stdoutBytes: meta.stdoutBytes,
    stderrBytes: meta.stderrBytes,
    eventCount: meta.eventCount,
    eventTypeCounts: meta.eventTypeCounts,
    terminalType: meta.terminalType,
    promptSha256: meta.promptSha256,
    identity: meta.identity && {
      launcherSha256: meta.identity.launcherSha256,
      nativeSha256: meta.identity.nativeSha256,
      version: meta.identity.version,
    },
    killInfo: meta.killInfo,
    failureCode: meta.failureCode,
    redactions: ["identity executable paths", "argv", "environment", "raw AO streams"],
  };
}

function buildFactsProjection(facts) {
  return {
    schemaVersion: "d072-implementation-facts-projection/v1",
    bindings: facts.bindings,
    git: facts.git,
    commands: Array.isArray(facts.commands)
      ? facts.commands.map((command) => ({
        commandId: command.commandId,
        cwdRelative: command.cwdRelative,
        timeoutSeconds: command.timeoutSeconds,
        networkPolicy: command.networkPolicy,
        startedAt: command.startedAt,
        endedAt: command.endedAt,
        exitCode: command.exitCode,
        timedOut: command.timedOut,
        headBefore: command.headBefore,
        headAfter: command.headAfter,
        networkAttempted: command.networkAttempted,
        stdoutArtifact: command.stdoutArtifact,
        stderrArtifact: command.stderrArtifact,
        argv: ["<redacted-trusted-command>"],
        environmentPolicy: { allow: [] },
      }))
      : [],
    collectedAt: facts.collectedAt,
    factsDigest: facts.factsDigest,
    redactions: ["commands.argv", "environment allowlist values", "host paths"],
  };
}

function publishExportDirectoryNoReplace(stageDir, finalDir) {
  const manifestName = "custody-export-manifest.json";
  const files = [];
  function visit(directory, relative = "") {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const childRelative = relative ? path.join(relative, entry.name) : entry.name;
      const child = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(child, childRelative);
      else if (entry.isFile()) files.push(childRelative);
      else throw codedError("D072_EXPORT_PUBLISH", `unsupported staged entry: ${childRelative}`);
    }
  }
  visit(stageDir);
  if (!files.includes(manifestName)) {
    throw codedError("D072_EXPORT_PUBLISH", "portable manifest missing from staging");
  }
  try {
    fs.mkdirSync(finalDir, { recursive: false });
  } catch (err) {
    throw codedError(
      "D072_EXPORT_EXISTS",
      `portable export no-replace claim failed: ${err.message}`,
      { causeCode: err && err.code },
    );
  }
  try {
    for (const relative of files.filter((name) => name !== manifestName).sort()) {
      const target = path.join(finalDir, relative);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(path.join(stageDir, relative), target, fs.constants.COPYFILE_EXCL);
    }
    fs.copyFileSync(
      path.join(stageDir, manifestName),
      path.join(finalDir, manifestName),
      fs.constants.COPYFILE_EXCL,
    );
    fs.rmSync(stageDir, { recursive: true, force: true });
  } catch (err) {
    throw codedError(
      "D072_EXPORT_PUBLISH",
      `portable export publication failed closed: ${err.message}`,
      { causeCode: err && err.code },
    );
  }
}

function assertNoPortableLeakage(stageDir, exported, sensitiveValues) {
  const findings = [];
  const pathPattern = /(?:[A-Za-z]:\\(?:Users|home|code|Program Files|Windows)\\|\/(?:home|Users)\/)/i;
  const secretPattern = /(?:api[_-]?key|access[_-]?token|refresh[_-]?token|authorization:\s*bearer|password\s*[=:])/i;

  for (const entry of exported) {
    const filePath = path.join(stageDir, entry.path);
    const text = fs.readFileSync(filePath, "utf8");
    if (pathPattern.test(text)) findings.push(`${entry.path}: absolute host path`);
    if (secretPattern.test(text)) findings.push(`${entry.path}: credential-shaped text`);
    for (const sensitive of sensitiveValues) {
      if (!sensitive) continue;
      const raw = String(sensitive);
      const escaped = JSON.stringify(raw).slice(1, -1);
      if (text.includes(raw) || (escaped && text.includes(escaped))) {
        findings.push(`${entry.path}: retained sensitive local value`);
      }
    }
  }
  if (findings.length > 0) {
    throw codedError(
      "D072_EXPORT_LEAKAGE",
      `portable custody leakage scan failed: ${findings.join("; ")}`,
      { findings },
    );
  }
  return { ok: true, scannedFiles: exported.length, findings: [] };
}

function exportPortableCustody(options) {
  const {
    repositoryPath,
    stateRoot,
    exportsRoot,
    authReqHex,
    baseRevision,
    verifiedHeadRevision,
    durableRef,
    terminalManifestDigest,
    gitExecutablePath,
    sensitiveValues = [],
  } = options || {};
  for (const [label, value] of Object.entries({
    repositoryPath,
    stateRoot,
    exportsRoot,
    authReqHex,
    baseRevision,
    verifiedHeadRevision,
    durableRef,
    terminalManifestDigest,
    gitExecutablePath,
  })) {
    if (typeof value !== "string" || value.length === 0) {
      throw codedError("D072_EXPORT_OPTIONS", `${label} required`);
    }
  }

  const evidenceDir = path.join(stateRoot, "attempts", authReqHex, "evidence");
  const localManifestRead = parseJson(
    path.join(evidenceDir, "custody-manifest.json"),
    "local custody manifest",
  );
  const localManifest = localManifestRead.value;
  if (!isPlainObject(localManifest)
    || localManifest.terminalManifestDigest !== terminalManifestDigest
    || localManifest.verifiedHeadRevision !== verifiedHeadRevision
    || localManifest.durableRef !== durableRef) {
    throw codedError("D072_EXPORT_BINDING", "local terminal manifest does not match export request");
  }
  const receipt = parseJson(
    path.join(evidenceDir, "authorization-receipt.json"),
    "authorization receipt",
  ).value;
  const claim = parseJson(
    path.join(stateRoot, "attempts", authReqHex, "claim.json"),
    "claim",
  ).value;
  const journal = parseJson(
    path.join(stateRoot, "attempts", authReqHex, "journal.current.json"),
    "operational journal",
  ).value;
  const verifiedLocal = verifyTerminalEvidence({ stateRoot, authReqHex, receipt, claim, journal });
  if (verifiedLocal.terminalManifestDigest !== terminalManifestDigest) {
    throw codedError("D072_EXPORT_BINDING", "verified local evidence digest does not match export request");
  }

  const exportName = `d072-${verifiedHeadRevision.slice(0, 12)}-${authReqHex.slice(0, 12)}`;
  fs.mkdirSync(exportsRoot, { recursive: true });
  const finalDir = path.join(exportsRoot, exportName);
  if (fs.existsSync(finalDir)) {
    throw codedError("D072_EXPORT_EXISTS", `portable export already exists: ${exportName}`);
  }
  const stageDir = path.join(exportsRoot, `.stage-${exportName}-${crypto.randomBytes(8).toString("hex")}`);
  fs.mkdirSync(stageDir, { recursive: false });
  const exported = [];

  try {
    const bundleName = "verified-result.bundle";
    const bundlePath = path.join(stageDir, bundleName);
    const gitHome = ensureIsolatedGitHome(stateRoot);
    runGit(
      gitExecutablePath,
      repositoryPath,
      ["bundle", "create", bundlePath, durableRef, `^${baseRevision}`],
      gitHome,
    );
    exported.push({
      path: bundleName,
      sha256: sha256File(bundlePath),
      bytes: fs.statSync(bundlePath).size,
    });

    for (const name of SAFE_EXACT_FILES) {
      writePortable(
        stageDir,
        path.join("evidence", name),
        fs.readFileSync(path.join(evidenceDir, name)),
        exported,
      );
    }

    const approval = parseJson(path.join(evidenceDir, "run-spec-approval.json"), "RunSpecApproval").value;
    const attestation = parseJson(
      path.join(evidenceDir, "workspace-attestation.json"),
      "workspace attestation",
    ).value;
    const aoMeta = parseJson(path.join(evidenceDir, "ao-process-meta.json"), "AO metadata").value;
    const facts = parseJson(path.join(evidenceDir, "implementation-facts.json"), "implementation facts").value;
    writePortable(
      stageDir,
      path.join("projections", "run-spec-approval.json"),
      jsonBytes(buildApprovalProjection(approval)),
      exported,
    );
    writePortable(
      stageDir,
      path.join("projections", "workspace-attestation.json"),
      jsonBytes(buildAttestationProjection(attestation)),
      exported,
    );
    writePortable(
      stageDir,
      path.join("projections", "ao-process-meta.json"),
      jsonBytes(buildAoProjection(aoMeta)),
      exported,
    );
    writePortable(
      stageDir,
      path.join("projections", "implementation-facts.json"),
      jsonBytes(buildFactsProjection(facts)),
      exported,
    );

    const leakage = assertNoPortableLeakage(
      stageDir,
      exported.filter((entry) => entry.path !== bundleName),
      [repositoryPath, stateRoot, exportsRoot, ...sensitiveValues],
    );

    const manifestBody = {
      schemaVersion: EXPORT_SCHEMA,
      exportName,
      thinBundle: {
        path: bundleName,
        resultRef: durableRef,
        resultCommit: verifiedHeadRevision,
        prerequisiteBaseRevision: baseRevision,
        containsBaseObject: false,
      },
      localCustody: {
        terminalManifestDigest,
        exactLocalEvidenceRetainedSeparately: true,
        ignoredLocalCustodyNotPortable: true,
      },
      sourceObjectHashes: sourceHashes(evidenceDir, localManifest),
      exportedObjects: exported.slice().sort((left, right) => left.path.localeCompare(right.path)),
      privacyReview: {
        exactHostSpecificSourceBytesExcluded: true,
        rawAoStreamsExcluded: true,
        credentialsAndEnvironmentValuesExcluded: true,
        leakageScan: leakage,
      },
      verificationContract: {
        repositoryMustAlreadyContainPrerequisiteBase: true,
        verifyBundleThenFetchResultRef: true,
        resultParentMustEqualPrerequisiteBase: true,
        sourceHashesWithExactBytesIncludedFalseAreLocalAttestationsOnly: true,
      },
    };
    const exportManifestDigest = `sha256:${sha256Bytes(jsonBytes(manifestBody))}`;
    const manifest = { ...manifestBody, exportManifestDigest };
    // Portable manifest is the final staged and final published file.
    publishNoReplace(path.join(stageDir, "custody-export-manifest.json"), jsonBytes(manifest));
    publishExportDirectoryNoReplace(stageDir, finalDir);
    return {
      exportDir: finalDir,
      exportName,
      exportManifestDigest,
      manifest,
      bundlePath: path.join(finalDir, bundleName),
    };
  } catch (err) {
    try { fs.rmSync(stageDir, { recursive: true, force: true }); } catch { /* ignore */ }
    throw err;
  }
}

module.exports = {
  EXPORT_SCHEMA,
  SAFE_EXACT_FILES,
  exportPortableCustody,
};
