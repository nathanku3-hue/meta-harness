"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const ROOT = path.resolve(__dirname, "..");
const TESTS = path.join(ROOT, "tests");
const ARCHIVE = path.join(ROOT, "docs", "ops", "audits", "archive-0.3-tests");
const MANIFEST = path.join(ARCHIVE, "manifest.json");

const ACTIVE_HARD_CUT_TESTS = new Set([
  "semantic-kernel-checkpoint-a.test.js",
  "semantic-kernel-contract-chain.test.js",
  "owner-tool.test.js",
]);

const RETIRED_PATTERNS = [
  /contracts\/(?:attempt-authorization|authorize|execution-readiness-facts|implementation-assessment|implementation-facts|run-spec-approval|workspace-attestation|workspace-start)/,
  /execution-custody\/(?:agent-custody|agent-process|attempt|change-artifact|controller-process|custody-export|custody-replay|execution-bindings|git-ops|implement|portable-verifier|terminal-evidence)/,
  /truth-authority(?:-contract)?|truth-mutation/,
  /release-package-check|release-check/,
  /run-spec\/v1|run-spec-approval\/v1|attempt-authorization\/v1|implementation-assessment\/v1/,
  /execution-custody-manifest\/v1|meta-harness-execution-request\/v1|meta-harness-execution-receipt\/v1|meta-harness-execute-result\/v1/,
  /meta-harness-truth-authority-public\/v1|meta-harness-truth-authority-receipt\/v[12]|meta-harness-truth-proposal\/v1/,
  /truth-authority-public-key\/v1|canonical_truth_mutation|allowLegacyAuthority|allowLegacy/,
  /IMPLEMENTATION_VERIFIED/,
];

function sha256(bytes) {
  return `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
}

function shouldArchive(fileName, text) {
  if (ACTIVE_HARD_CUT_TESTS.has(fileName)) return false;
  return RETIRED_PATTERNS.some((pattern) => pattern.test(text));
}

function main() {
  fs.mkdirSync(ARCHIVE, { recursive: true });
  if (fs.existsSync(MANIFEST)) {
    throw new Error(`archive manifest already exists: ${MANIFEST}`);
  }
  const archived = [];
  for (const fileName of fs.readdirSync(TESTS).filter((name) => name.endsWith(".test.js")).sort()) {
    const source = path.join(TESTS, fileName);
    const bytes = fs.readFileSync(source);
    const text = bytes.toString("utf8");
    if (!shouldArchive(fileName, text)) continue;
    const destination = path.join(ARCHIVE, fileName);
    if (fs.existsSync(destination)) throw new Error(`archive destination exists: ${destination}`);
    fs.renameSync(source, destination);
    archived.push({
      originalPath: `tests/${fileName}`,
      archivedPath: `docs/ops/audits/archive-0.3-tests/${fileName}`,
      contentDigest: sha256(bytes),
      reason: "Pre-0.4 execution, truth-authority, release-rebuild, replay, or compatibility expectation retired by the hard cut.",
    });
  }
  const manifest = {
    schemaVersion: "meta-harness-retired-test-archive/v1",
    protocolCut: "meta-harness/0.4",
    archived,
  };
  fs.writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx", mode: 0o600 });
  process.stdout.write(`${JSON.stringify({ archivedCount: archived.length, manifest: path.relative(ROOT, MANIFEST) })}\n`);
}

main();
