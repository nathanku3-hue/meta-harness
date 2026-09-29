"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const { evaluateReleaseEvidence } = require("./release-evidence");
const { packageReleaseChecks, runNpm } = require("./release-package-check");
const {
  RELEASE_POLICY_RELATIVE_PATH,
  checkNpmLifecycle,
  checkPackageIdentity,
  checkPackageMetadata,
  checkPrepublishOnly,
  checkQualityBaseline,
  checkReady,
  checkReleasePolicy,
  checkReproducibility,
  checkRollbackPolicy,
  checkTestReadiness,
  readJsonFile,
  readPackageJson,
  validateReleasePolicy,
} = require("./release-local-checks");

const CHECK_IDS = Object.freeze({
  cleanTree: "REL_CLEAN_TREE_001",
  policy: "REL_RELEASE_POLICY_001",
  identitySource: "REL_PACKAGE_IDENTITY_SOURCE_001",
  packageIdentity: "REL_PACKAGE_ID_001",
  packageMetadata: "REL_PACKAGE_METADATA_001",
  lifecycle: "REL_NPM_LIFECYCLE_001",
  reproducibility: "REL_REPRO_001",
  quality: "REL_QUALITY_BASELINE_001",
  ready: "REL_READY_001",
  test: "REL_TEST_001",
  packDryRun: "REL_PACK_DRY_RUN_001",
  forbiddenPath: "REL_FORBIDDEN_PATH_001",
  tarballPathCanon: "REL_TARBALL_PATH_CANON_001",
  packEquiv: "REL_PACK_EQUIV_001",
  tempNpmEnv: "REL_TEMP_NPM_ENV_001",
  smokeIgnoreScripts: "REL_SMOKE_IGNORE_SCRIPTS_001",
  tarballSmoke: "REL_TARBALL_SMOKE_001",
  cliSmoke: "REL_CLI_SMOKE_001",
  versionTag: "REL_VERSION_TAG_001",
  prepublishOnly: "REL_PREPUBLISH_ONLY_001",
  depReview: "REL_DEP_REVIEW_001",
  trustedPublishing: "REL_TRUSTED_PUBLISHING_001",
  publishPermissions: "REL_PUBLISH_PERMISSIONS_001",
  publishEnv: "REL_PUBLISH_ENV_001",
  trustedPublisherEnv: "REL_TRUSTED_PUBLISHER_ENV_001",
  externalEvidence: "REL_EXTERNAL_GITHUB_SECURITY_001",
  fullReleaseEvidence: "REL_FULL_RELEASE_EVIDENCE_001",
  rollbackPolicy: "REL_ROLLBACK_POLICY_001",
});
const RELEASE_TAG_PATTERN = /^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

function toSlash(value) { return String(value).split(path.sep).join("/"); }
function isPlainObject(value) { return Boolean(value && typeof value === "object" && !Array.isArray(value)); }
function check(id, name, status, reason = "", nextAction = "", options = {}) {
  return { id, name, status, reason, next_action: nextAction, required_for_local: Boolean(options.requiredForLocal), required_for_release: options.requiredForRelease !== false, ...(options.details === undefined ? {} : { details: options.details }) };
}
function pass(id, name, reason = "", options = {}) { return check(id, name, "pass", reason, "", options); }
function fail(id, name, reason, nextAction, options = {}) { return check(id, name, "fail", reason, nextAction, options); }
function unknown(id, name, reason, nextAction, options = {}) { return check(id, name, "unknown", reason, nextAction, options); }
function skip(id, name, reason, nextAction = "", options = {}) { return check(id, name, "skip", reason, nextAction, options); }

function failedOverlayPolicy(policy, reason) {
  return { ...policy, external_evidence: {
    github_security: { status: "fail", source: ".meta-harness/local/release-evidence.json", reason },
    full_release: { status: "fail", source: ".meta-harness/local/release-evidence.json", reason },
  } };
}
function mergeReleaseEvidenceOverlay(targetRoot, policy) {
  const overlayPath = path.join(targetRoot, ".meta-harness", "local", "release-evidence.json");
  if (!policy || !fs.existsSync(overlayPath)) return { policy, source: RELEASE_POLICY_RELATIVE_PATH, overlay: null, error: null };
  const parsed = readJsonFile(overlayPath);
  const source = `${RELEASE_POLICY_RELATIVE_PATH} + .meta-harness/local/release-evidence.json`;
  if (!parsed.ok) return { policy: failedOverlayPolicy(policy, `release evidence overlay invalid JSON: ${parsed.error.message}`), source, overlay: null, error: parsed.error };
  const overlay = parsed.value;
  const externalEvidence = isPlainObject(overlay.external_evidence) ? overlay.external_evidence : isPlainObject(overlay.evidence) ? overlay.evidence : null;
  if (!externalEvidence) return { policy: failedOverlayPolicy(policy, "release evidence overlay missing external_evidence"), source, overlay, error: new Error("release evidence overlay missing external_evidence") };
  return { policy: { ...policy, external_evidence: externalEvidence }, source, overlay, error: null };
}

function evidenceCheck(id, name, evidenceResult, currentCommit) {
  const base = check(id, name, evidenceResult.status, evidenceResult.reason, evidenceResult.next_action, { requiredForLocal: false, details: evidenceResult.details });
  const evidenceCommit = evidenceResult.details?.evidence?.commit;
  if (base.status === "pass" && currentCommit && evidenceCommit && evidenceCommit !== currentCommit) {
    return fail(id, name, `evidence commit ${evidenceCommit} does not match current commit ${currentCommit}`, "Recollect release evidence for the exact commit being released", { requiredForLocal: false, details: { ...evidenceResult.details, current_commit: currentCommit } });
  }
  return base;
}

function gitStatusPorcelain(targetRoot) {
  const result = spawnSync("git", ["status", "--porcelain"], { cwd: targetRoot, encoding: "utf8", shell: false, stdio: ["ignore", "pipe", "pipe"], timeout: 10_000 });
  if (result.status !== 0 || result.error) return { ok: false, reason: (result.stderr || result.error?.message || "git status failed").trim() };
  return { ok: true, entries: String(result.stdout || "").split(/\r?\n/).filter(Boolean) };
}
function checkCleanTree(targetRoot) {
  const status = gitStatusPorcelain(targetRoot);
  if (!status.ok) return unknown(CHECK_IDS.cleanTree, "clean-tree", `git working tree status unavailable: ${status.reason}`, "Run release checks from a Git working tree before release", { requiredForLocal: false, details: { git_status: "unavailable" } });
  if (status.entries.length === 0) return pass(CHECK_IDS.cleanTree, "clean-tree", "git working tree is clean", { requiredForLocal: false, details: { git_status: "clean", dirty_count: 0, dirty: false } });
  return fail(CHECK_IDS.cleanTree, "clean-tree", `${status.entries.length} uncommitted or untracked git entries`, "Commit or stash changes before release", { requiredForLocal: false, details: { git_status: "dirty", dirty: true, dirty_count: status.entries.length, dirty_entries: status.entries.slice(0, 50), truncated: status.entries.length > 50 } });
}
function runCommand(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: options.cwd, encoding: "utf8", shell: false, stdio: ["ignore", "pipe", "pipe"], timeout: options.timeout || 10_000 });
  if (result.status !== 0 || result.error) return null;
  return String(result.stdout || "").trim() || null;
}
function gitValue(targetRoot, args) { return runCommand("git", args, { cwd: targetRoot }); }
function npmVersion() { return runNpm(["--version"], { timeout: 10_000 }).stdout?.trim() || null; }
function metaHarnessVersion() {
  const parsed = readJsonFile(path.resolve(__dirname, "..", "package.json"));
  return parsed.ok ? parsed.value.version || null : null;
}
function statusCounts(checks) { return Object.fromEntries(["pass", "fail", "skip", "warn", "unknown", "timeout"].map((status) => [status, checks.filter((item) => item.status === status).length])); }
function firstNextAction(checks, predicate) { return checks.find((candidate) => predicate(candidate) && candidate.next_action)?.next_action || ""; }
function localCheckBlocked(item) { return item.required_for_local && (item.status === "fail" || item.status === "timeout" || item.status === "unknown"); }
function releaseCheckReady(item) { return item.required_for_release === false || item.status === "pass"; }

function checkVersionTag(targetRoot, packageInfo, policy, publishMode) {
  if (!packageInfo.exists || packageInfo.error) return fail(CHECK_IDS.versionTag, "version-tag", packageInfo.error ? `package.json is invalid JSON: ${packageInfo.error.message}` : "package.json missing", "Fix package.json before version/tag checking", { requiredForLocal: false });
  const expectedTag = `${policy?.package?.tag_prefix || "v"}${packageInfo.pkg.version}`;
  const tags = (gitValue(targetRoot, ["tag", "--points-at", "HEAD"]) || "").split(/\r?\n/).filter(Boolean);
  const releaseTags = tags.filter((tag) => tag === expectedTag || RELEASE_TAG_PATTERN.test(tag));
  if (!publishMode && releaseTags.length === 0) return skip(CHECK_IDS.versionTag, "version-tag", "no release tag points at current commit in local mode", "Create exact release tag before publish mode", { requiredForLocal: false, details: { expected_tag: expectedTag } });
  if (releaseTags.includes(expectedTag)) return pass(CHECK_IDS.versionTag, "version-tag", `current commit has exact release tag ${expectedTag}`, { requiredForLocal: false, details: { expected_tag: expectedTag, tags } });
  return fail(CHECK_IDS.versionTag, "version-tag", `current commit is not tagged ${expectedTag}`, "Create and verify the exact release tag before publish", { requiredForLocal: false, details: { expected_tag: expectedTag, tags } });
}

function workflowFiles(targetRoot) {
  const workflowRoot = path.join(targetRoot, ".github", "workflows");
  if (!fs.existsSync(workflowRoot) || !fs.statSync(workflowRoot).isDirectory()) return [];
  return fs.readdirSync(workflowRoot).filter((file) => /\.ya?ml$/i.test(file)).sort((left, right) => left.localeCompare(right)).map((file) => path.join(workflowRoot, file));
}
function workflowText(targetRoot) { return workflowFiles(targetRoot).map((file) => ({ file, text: fs.readFileSync(file, "utf8") })); }
function checkDependencyReview(targetRoot, policy, publishMode) {
  const evidence = policy?.external_evidence?.github_security;
  if (["pass", "passed", "verified", "not_applicable_no_dependency_delta"].includes(String(evidence?.dependency_review || "").toLowerCase())) return pass(CHECK_IDS.depReview, "dependency-review", "dependency review posture accepted by recorded release evidence", { requiredForLocal: false, details: { evidence: evidence.dependency_review } });
  if (workflowText(targetRoot).some(({ text }) => /dependency-review-action/.test(text))) return pass(CHECK_IDS.depReview, "dependency-review", "Dependency Review Action workflow posture is present", { requiredForLocal: false });
  return publishMode ? fail(CHECK_IDS.depReview, "dependency-review", "dependency review evidence is missing", "Add Dependency Review workflow evidence or record no dependency delta in release evidence", { requiredForLocal: false }) : skip(CHECK_IDS.depReview, "dependency-review", "dependency review evidence is checked in publish mode", "Run release check --publish with dependency review evidence", { requiredForLocal: false });
}
function checkTrustedPublishing(policy, publishMode) {
  const workflow = policy?.publish?.workflow;
  const trustedEnv = policy?.publish?.trusted_publisher_environment;
  if (!workflow && !trustedEnv) return pass(CHECK_IDS.trustedPublishing, "trusted-publishing", "no publish automation or trusted publisher environment is configured in Phase 10 scope", { requiredForLocal: false, details: { configured: false } });
  const evidence = policy?.external_evidence?.full_release?.artifacts?.trusted_publishing || policy?.external_evidence?.github_security?.trusted_publishing;
  if (String(evidence || "").toLowerCase() === "pass") return pass(CHECK_IDS.trustedPublishing, "trusted-publishing", "trusted publishing evidence recorded", { requiredForLocal: false });
  return publishMode ? fail(CHECK_IDS.trustedPublishing, "trusted-publishing", "trusted publishing is configured but evidence is missing", "Record OIDC/trusted-publishing evidence before publish", { requiredForLocal: false }) : skip(CHECK_IDS.trustedPublishing, "trusted-publishing", "trusted publishing evidence is required only when publish automation is configured", "Record trusted-publishing evidence before publish", { requiredForLocal: false });
}
function checkPublishPermissions(targetRoot, policy) {
  const workflowName = policy?.publish?.workflow;
  if (!workflowName) return pass(CHECK_IDS.publishPermissions, "publish-permissions", "no publish workflow is configured; existing workflows remain read-only", { requiredForLocal: false });
  const files = workflowText(targetRoot).filter(({ file }) => path.basename(file) === workflowName || toSlash(file).endsWith(`/${workflowName}`));
  if (files.length === 0) return fail(CHECK_IDS.publishPermissions, "publish-permissions", `publish workflow ${workflowName} is configured but missing`, "Add the configured publish workflow or clear publish.workflow", { requiredForLocal: false });
  const broad = files.filter(({ text }) => /contents:\s*write|packages:\s*write|actions:\s*write/i.test(text));
  return broad.length > 0 ? fail(CHECK_IDS.publishPermissions, "publish-permissions", "publish workflow has broad write permissions", "Restrict publish workflow permissions and use id-token: write only for OIDC publish job", { requiredForLocal: false }) : pass(CHECK_IDS.publishPermissions, "publish-permissions", "publish workflow permissions are minimally scoped", { requiredForLocal: false });
}
function checkPublishEnvironment(policy, publishMode) {
  const trustedEnv = policy?.publish?.trusted_publisher_environment;
  if (!trustedEnv) return pass(CHECK_IDS.publishEnv, "publish-environment", "no protected publish environment is configured", { requiredForLocal: false, details: { configured: false } });
  const evidence = policy?.external_evidence?.full_release?.artifacts?.publish_environment;
  if (String(evidence || "").toLowerCase() === "pass") return pass(CHECK_IDS.publishEnv, "publish-environment", "protected publish environment evidence recorded", { requiredForLocal: false });
  return publishMode ? fail(CHECK_IDS.publishEnv, "publish-environment", `protected publish environment ${trustedEnv} lacks evidence`, "Record protected environment evidence before publish", { requiredForLocal: false }) : skip(CHECK_IDS.publishEnv, "publish-environment", "protected publish environment evidence is checked in publish mode", "Record environment evidence before publish", { requiredForLocal: false });
}
function checkTrustedPublisherEnvironment(policy, publishMode) {
  const trustedEnv = policy?.publish?.trusted_publisher_environment;
  if (!trustedEnv) return pass(CHECK_IDS.trustedPublisherEnv, "trusted-publisher-environment", "no trusted publisher environment is configured", { requiredForLocal: false, details: { configured: false } });
  const evidence = policy?.external_evidence?.full_release?.artifacts?.trusted_publisher_environment;
  if (evidence === trustedEnv || String(evidence || "").toLowerCase() === "pass") return pass(CHECK_IDS.trustedPublisherEnv, "trusted-publisher-environment", "trusted-publisher environment evidence matches policy", { requiredForLocal: false });
  return publishMode ? fail(CHECK_IDS.trustedPublisherEnv, "trusted-publisher-environment", `trusted publisher environment evidence missing or mismatched for ${trustedEnv}`, "Align workflow environment and trusted-publisher configuration", { requiredForLocal: false }) : skip(CHECK_IDS.trustedPublisherEnv, "trusted-publisher-environment", "trusted publisher environment consistency is checked in publish mode", "Record trusted-publisher environment evidence before publish", { requiredForLocal: false });
}

async function runReleaseCheck(options = {}) {
  const targetRoot = path.resolve(options.targetRoot || process.cwd());
  const publishMode = Boolean(options.publish);
  const startedAtMs = Date.now();
  const packageInfo = readPackageJson(targetRoot);
  const policyResult = checkReleasePolicy(targetRoot);
  const lifecycle = checkNpmLifecycle(packageInfo);
  const prepublishOnly = checkPrepublishOnly(packageInfo);
  const readyResult = await checkReady(targetRoot, publishMode);
  const cleanTree = checkCleanTree(targetRoot);
  const currentCommit = gitValue(targetRoot, ["rev-parse", "HEAD"]) || null;
  const evidencePolicy = mergeReleaseEvidenceOverlay(targetRoot, policyResult.policy);
  const releaseEvidence = evaluateReleaseEvidence(evidencePolicy.policy);
  const packagePublishMode = publishMode && releaseEvidence.ok;
  const checks = [
    cleanTree, ...policyResult.checks,
    checkPackageIdentity(packageInfo, policyResult.policy), checkPackageMetadata(packageInfo, policyResult.policy), lifecycle, prepublishOnly,
    checkReproducibility(targetRoot, packageInfo), checkQualityBaseline(targetRoot), readyResult.check,
    checkTestReadiness(targetRoot, packageInfo, readyResult.ready, publishMode),
    ...packageReleaseChecks(targetRoot, packageInfo, lifecycle, packagePublishMode, CHECK_IDS),
    checkVersionTag(targetRoot, packageInfo, evidencePolicy.policy, publishMode), checkDependencyReview(targetRoot, evidencePolicy.policy, publishMode),
    checkTrustedPublishing(evidencePolicy.policy, publishMode), checkPublishPermissions(targetRoot, evidencePolicy.policy),
    checkPublishEnvironment(evidencePolicy.policy, publishMode), checkTrustedPublisherEnvironment(evidencePolicy.policy, publishMode),
    evidenceCheck(CHECK_IDS.externalEvidence, "github-security-evidence", releaseEvidence.githubSecurity, currentCommit),
    evidenceCheck(CHECK_IDS.fullReleaseEvidence, "full-release-evidence", releaseEvidence.fullRelease, currentCommit), checkRollbackPolicy(targetRoot, evidencePolicy.policy),
  ];
  const completedAtMs = Date.now();
  const localOk = !checks.some(localCheckBlocked);
  const releaseReady = localOk && checks.every(releaseCheckReady);
  const releaseNextAction = firstNextAction(checks, (item) => item.required_for_release !== false && item.status !== "pass");
  return { schema_version: "1", local_ok: localOk, ok: publishMode ? releaseReady : localOk, release_ready: releaseReady, mode: publishMode ? "publish" : "local", publish: publishMode,
    target: toSlash(targetRoot), package_name: packageInfo.pkg?.name || null, version: packageInfo.pkg?.version || null,
    started_at: new Date(startedAtMs).toISOString(), completed_at: new Date(completedAtMs).toISOString(), duration_ms: completedAtMs - startedAtMs,
    git_commit: currentCommit, tree_hash: gitValue(targetRoot, ["rev-parse", "HEAD^{tree}"]) || null,
    git_tree_clean: cleanTree.status === "pass" ? true : cleanTree.status === "fail" ? false : null, git_dirty_count: cleanTree.details?.dirty_count ?? null,
    node_version: process.version, npm_version: npmVersion(), meta_harness_version: metaHarnessVersion(), release_policy_source: policyResult.source, release_evidence_source: evidencePolicy.source,
    external_evidence_ok: releaseEvidence.ok,
    external_evidence_status: checks.find((item) => item.id === CHECK_IDS.externalEvidence)?.status || "unknown",
    full_release_evidence_status: checks.find((item) => item.id === CHECK_IDS.fullReleaseEvidence)?.status || "unknown",
    counts: statusCounts(checks), checks,
    next_action: localOk ? (releaseReady ? "none" : releaseNextAction || "Record external GitHub/security evidence before release") : firstNextAction(checks, localCheckBlocked) || "Fix local release check failures" };
}

module.exports = {
  CHECK_IDS,
  RELEASE_POLICY_RELATIVE_PATH,
  runReleaseCheck,
  _test: { checkDependencyReview, mergeReleaseEvidenceOverlay, checkExternalEvidence: (policy) => evidenceCheck(CHECK_IDS.externalEvidence, "github-security-evidence", evaluateReleaseEvidence(policy).githubSecurity, null), checkPackageMetadata, checkReleasePolicy, checkRollbackPolicy, validateReleasePolicy },
};
