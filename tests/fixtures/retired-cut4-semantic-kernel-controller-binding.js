"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const { domainDigest } = require("../contracts/digest");
const { immutable } = require("./contract-utils");

const PACKAGE_ROOT = path.resolve(__dirname, "..", "..");
const CONTROLLER_FILES = Object.freeze([
  "lib/semantic-kernel/active-slice-index.js",
  "lib/semantic-kernel/clock.js",
  "lib/semantic-kernel/contract-utils.js",
  "lib/semantic-kernel/controller-binding.js",
  "lib/semantic-kernel/evidence-runtime.js",
  "lib/semantic-kernel/mechanics-assessment.js",
  "lib/semantic-kernel/operation-bundle.js",
  "lib/semantic-kernel/repository-state.js",
  "lib/semantic-kernel/run-spec-v2.js",
  "lib/semantic-kernel/semantic-controller.js",
  "lib/semantic-kernel/slice-activation.js",
  "lib/semantic-kernel/slice-authorization.js",
  "lib/semantic-kernel/slice-state.js",
  "lib/git-command.js",
]);
const ALLOWED_CAPABILITIES = Object.freeze([
  "CANONICAL_PROJECT",
  "INTEGRATE",
  "MECHANICS_ASSESS",
  "PACKAGE_FREEZE",
  "PROOF_EXECUTE",
  "PUBLICATION_OBSERVE",
  "REVIEW_ORCHESTRATE",
  "RUN_SPEC_SEAL",
  "SLICE_ACTIVATE",
  "SLICE_CLOSE",
  "TERMINAL_ASSESS",
]);
const CONTROLLER_POLICY = Object.freeze({
  protocol: "meta-harness/0.4",
  oneActiveSlicePerGitCommonDirectory: true,
  integrationOperation: "fast-forward",
  requestControlledClock: false,
  requestControlledStateRoot: false,
  pre04AuthorityInterpretation: false,
  mechanicsVerdict: "MECHANICS_VERIFIED",
  terminalVerdict: "TERMINAL_SLICE_VERIFIED",
});
const CUSTODY_ROOT_POLICY = Object.freeze({
  stateRootDiscovery: "canonical-git-common-directory",
  hostScope: "machine-global",
  repositoryTrackedAuthority: false,
  workerWritable: false,
  createOnlyOperationBundles: true,
  activeIndexCompareAndSwap: true,
});
const CLOCK_POLICY = Object.freeze({
  utcSource: "system-clock",
  requestConfigurable: false,
  monotonicScope: "controller-instance",
  crossInstanceOrdering: "event-sequence-and-prior-digest",
});

function sha256File(filePath) {
  return `sha256:${crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex")}`;
}

function computeInstalledControllerProgramDigest(packageRoot = PACKAGE_ROOT) {
  const files = CONTROLLER_FILES.map((relativePath) => ({
    relativePath,
    digest: sha256File(path.join(packageRoot, relativePath)),
  }));
  return domainDigest("meta-harness-controller-program/v1", files);
}

function computeInstalledLauncherDigest(packageRoot = PACKAGE_ROOT) {
  return domainDigest("meta-harness-controller-launcher/v1", {
    relativePath: "bin/meta-harness.js",
    digest: sha256File(path.join(packageRoot, "bin", "meta-harness.js")),
  });
}

function resolveInstalledControllerBinding(packageRoot = PACKAGE_ROOT) {
  return immutable({
    controllerProgramDigest: computeInstalledControllerProgramDigest(packageRoot),
    controllerPolicyDigest: domainDigest("meta-harness-controller-policy/v1", CONTROLLER_POLICY),
    launcherDigest: computeInstalledLauncherDigest(packageRoot),
    custodyRootPolicyDigest: domainDigest("meta-harness-custody-root-policy/v1", CUSTODY_ROOT_POLICY),
    clockPolicyDigest: domainDigest("meta-harness-clock-policy/v1", CLOCK_POLICY),
    allowedCapabilities: [...ALLOWED_CAPABILITIES],
  });
}

module.exports = {
  ALLOWED_CAPABILITIES,
  CLOCK_POLICY,
  CONTROLLER_FILES,
  CONTROLLER_POLICY,
  CUSTODY_ROOT_POLICY,
  PACKAGE_ROOT,
  computeInstalledControllerProgramDigest,
  computeInstalledLauncherDigest,
  resolveInstalledControllerBinding,
};
