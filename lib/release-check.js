"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const {
  analyzeQuality,
  compareQualityToBaseline,
  qualityBaselinePath,
  qualityContractPath,
  readQualityBaseline,
  readQualityContract,
} = require("./quality");
const { runReadyCheck } = require("./ready-check");

const RELEASE_POLICY_RELATIVE_PATH = ".meta-harness/release-policy.json";
const RELEASE_POLICY_SCHEMA_VERSION = "1";
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
  externalEvidence: "REL_EXTERNAL_GITHUB_SECURITY_001",
  fullReleaseEvidence: "REL_FULL_RELEASE_EVIDENCE_001",
});
const ALLOWED_PREPUBLISH_ONLY = new Set([
  "node bin/meta-harness.js release check",
  "node ./bin/meta-harness.js release check",
  "meta-harness release check",
]);
const BLOCKED_LIFECYCLE_SCRIPTS = ["prepare", "prepack", "postpack", "publish", "postpublish", "preinstall", "install", "postinstall"];

function toSlash(value) { return String(value).split(path.sep).join("/"); }
function normalizeRegistryUrl(value) { return String(value || "").trim().replace(/\/+$/, ""); }
function isPlainObject(value) { return Boolean(value && typeof value === "object" && !Array.isArray(value)); }
function isNonEmptyString(value) { return typeof value === "string" && value.trim().length > 0; }
function isSemverish(value) { return /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(String(value || "")); }
function normalizedScript(value) { return String(value || "").trim().replace(/\s+/g, " "); }
function readJsonFile(filePath) {
  try { return { ok: true, value: JSON.parse(fs.readFileSync(filePath, "utf8")) }; } catch (error) { return { ok: false, error }; }
}
function check(id, name, status, reason = "", nextAction = "", options = {}) {
  return {
    id,
    name,
    status,
    reason,
    next_action: nextAction,
    required_for_local: Boolean(options.requiredForLocal),
    required_for_release: options.requiredForRelease !== false,
    ...(options.details === undefined ? {} : { details: options.details }),
  };
}
function pass(id, name, reason = "", options = {}) { return check(id, name, "pass", reason, "", options); }
function fail(id, name, reason, nextAction, options = {}) { return check(id, name, "fail", reason, nextAction, options); }
function unknown(id, name, reason, nextAction, options = {}) { return check(id, name, "unknown", reason, nextAction, options); }

function readPackageJson(targetRoot) {
  const packagePath = path.join(targetRoot, "package.json");
  if (!fs.existsSync(packagePath)) return { exists: false, path: packagePath, pkg: null, error: null };
  const parsed = readJsonFile(packagePath);
  return { exists: true, path: packagePath, pkg: parsed.ok ? parsed.value : null, error: parsed.ok ? null : parsed.error };
}

function validateReleasePolicy(policy) {
  const missing = [];
  if (!isPlainObject(policy)) return ["policy must be a JSON object"];
  if (policy.schema_version !== RELEASE_POLICY_SCHEMA_VERSION) missing.push(`schema_version=${RELEASE_POLICY_SCHEMA_VERSION}`);
  if (!isPlainObject(policy.package)) missing.push("package"); else for (const key of ["name", "registry", "tag_prefix"]) if (!isNonEmptyString(policy.package[key])) missing.push(`package.${key}`);
  if (isPlainObject(policy.package) && !["public", "restricted"].includes(policy.package.access)) missing.push("package.access");
  if (!isPlainObject(policy.publish)) missing.push("publish"); else for (const key of ["workflow", "trusted_publisher_environment"]) if (policy.publish[key] != null && !isNonEmptyString(policy.publish[key])) missing.push(`publish.${key}`);
  return missing;
}

function checkReleasePolicy(targetRoot) {
  const sourcePath = path.join(targetRoot, RELEASE_POLICY_RELATIVE_PATH);
  const failPair = (policy, source, reason, nextAction) => ({ policy, source, checks: [
    fail(CHECK_IDS.policy, "release-policy", reason, nextAction, { requiredForLocal: true }),
    fail(CHECK_IDS.identitySource, "identity-source", policy ? "release policy is present but invalid" : "release policy missing", "Fix release policy before checking package identity", { requiredForLocal: true }),
  ] });
  if (!fs.existsSync(sourcePath)) return failPair(null, null, `${RELEASE_POLICY_RELATIVE_PATH} missing`, "Create .meta-harness/release-policy.json with expected package identity");
  const parsed = readJsonFile(sourcePath);
  if (!parsed.ok) return failPair(null, RELEASE_POLICY_RELATIVE_PATH, `release-policy.json is invalid JSON: ${parsed.error.message}`, "Fix .meta-harness/release-policy.json");
  const missing = validateReleasePolicy(parsed.value);
  if (missing.length > 0) return failPair(parsed.value, RELEASE_POLICY_RELATIVE_PATH, `release policy missing: ${missing.join(", ")}`, "Fill required release policy fields");
  return { policy: parsed.value, source: RELEASE_POLICY_RELATIVE_PATH, checks: [
    pass(CHECK_IDS.policy, "release-policy", RELEASE_POLICY_RELATIVE_PATH, { requiredForLocal: true }),
    pass(CHECK_IDS.identitySource, "identity-source", RELEASE_POLICY_RELATIVE_PATH, { requiredForLocal: true }),
  ] };
}

function packageRepositoryPresent(repository) {
  return isNonEmptyString(repository) || (isPlainObject(repository) && isNonEmptyString(repository.url));
}
function packageBinPresent(bin) { return isNonEmptyString(bin) || (isPlainObject(bin) && Object.keys(bin).length > 0); }
function badPackageInfo(info, id, name, action) {
  if (!info.exists) return fail(id, name, "package.json missing", "Add package.json before release checking", { requiredForLocal: true });
  if (info.error) return fail(id, name, `package.json is invalid JSON: ${info.error.message}`, action || "Fix package.json", { requiredForLocal: true });
  return null;
}

function checkPackageMetadata(packageInfo, policy) {
  const bad = badPackageInfo(packageInfo, CHECK_IDS.packageMetadata, "package-metadata", "Fix package.json");
  if (bad) return bad;
  const pkg = packageInfo.pkg;
  const missing = [];
  if (!isNonEmptyString(pkg.name)) missing.push("name");
  if (!isSemverish(pkg.version)) missing.push("version");
  if (!isNonEmptyString(pkg.license)) missing.push("license");
  if (!packageRepositoryPresent(pkg.repository)) missing.push("repository");
  if (!packageBinPresent(pkg.bin)) missing.push("bin");
  if (!Array.isArray(pkg.files) || pkg.files.length === 0) missing.push("files[]");
  if (!isPlainObject(pkg.engines) || !isNonEmptyString(pkg.engines.node) || !pkg.engines.node.includes(">=20")) missing.push("engines.node>=20");
  if (!isNonEmptyString(pkg.packageManager) || !pkg.packageManager.startsWith("npm@")) missing.push("packageManager npm@...");
  if (!isPlainObject(pkg.devEngines?.runtime) || pkg.devEngines.runtime.name !== "node") missing.push("devEngines.runtime");
  if (!isPlainObject(pkg.devEngines?.packageManager) || pkg.devEngines.packageManager.name !== "npm") missing.push("devEngines.packageManager");
  if (policy && isPlainObject(pkg.publishConfig)) {
    if (isNonEmptyString(pkg.publishConfig.registry) && normalizeRegistryUrl(pkg.publishConfig.registry) !== normalizeRegistryUrl(policy.package.registry)) missing.push("publishConfig.registry matches release policy");
    if (isNonEmptyString(pkg.publishConfig.access) && pkg.publishConfig.access !== policy.package.access) missing.push("publishConfig.access matches release policy");
  }
  const unique = Array.from(new Set(missing));
  return unique.length === 0
    ? pass(CHECK_IDS.packageMetadata, "package-metadata", "package metadata is complete", { requiredForLocal: true })
    : fail(CHECK_IDS.packageMetadata, "package-metadata", `package metadata missing or invalid: ${unique.join(", ")}`, "Add release-safe package metadata", { requiredForLocal: true, details: { missing: unique } });
}

function checkPackageIdentity(packageInfo, policy) {
  const bad = badPackageInfo(packageInfo, CHECK_IDS.packageIdentity, "package-identity", "Fix package.json");
  if (bad) return bad;
  if (!policy) return fail(CHECK_IDS.packageIdentity, "package-identity", "release policy missing", "Create release policy before checking package identity", { requiredForLocal: true });
  const pkg = packageInfo.pkg;
  const reasons = [];
  if (pkg.name !== policy.package.name) reasons.push(`package name ${pkg.name || "missing"} does not match policy ${policy.package.name}`);
  if (!isSemverish(pkg.version)) reasons.push(`package version is not valid semver: ${pkg.version || "missing"}`);
  if (pkg.private === true) reasons.push("package is private");
  return reasons.length === 0
    ? pass(CHECK_IDS.packageIdentity, "package-identity", `${pkg.name}@${pkg.version}`, { requiredForLocal: true })
    : fail(CHECK_IDS.packageIdentity, "package-identity", reasons.join("; "), "Align package.json identity with release policy", { requiredForLocal: true });
}

function checkNpmLifecycle(packageInfo) {
  const bad = badPackageInfo(packageInfo, CHECK_IDS.lifecycle, "npm-lifecycle", "Fix package.json before lifecycle inspection");
  if (bad) return bad;
  const scripts = isPlainObject(packageInfo.pkg.scripts) ? packageInfo.pkg.scripts : {};
  const blocked = BLOCKED_LIFECYCLE_SCRIPTS.filter((name) => isNonEmptyString(scripts[name]));
  if (isNonEmptyString(scripts.prepublishOnly) && !ALLOWED_PREPUBLISH_ONLY.has(normalizedScript(scripts.prepublishOnly))) blocked.push("prepublishOnly");
  return blocked.length === 0
    ? pass(CHECK_IDS.lifecycle, "npm-lifecycle", "no blocked lifecycle scripts", { requiredForLocal: true })
    : fail(CHECK_IDS.lifecycle, "npm-lifecycle", `blocked lifecycle scripts: ${blocked.join(", ")}`, "Remove release-risk lifecycle scripts or use the canonical prepublishOnly guard", { requiredForLocal: true, details: { blocked } });
}

function packageLockIgnored(targetRoot) {
  const gitignorePath = path.join(targetRoot, ".gitignore");
  if (!fs.existsSync(gitignorePath)) return false;
  return fs.readFileSync(gitignorePath, "utf8").split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith("#")).some((line) => (
    line === "package-lock.json" || line === "/package-lock.json" || line === "**/package-lock.json" || line === "*.json" || line === "**/*.json"
  ));
}
function workflowFiles(targetRoot) {
  const workflowRoot = path.join(targetRoot, ".github", "workflows");
  if (!fs.existsSync(workflowRoot) || !fs.statSync(workflowRoot).isDirectory()) return [];
  return fs.readdirSync(workflowRoot).filter((file) => file.endsWith(".yml") || file.endsWith(".yaml")).sort((left, right) => left.localeCompare(right)).map((file) => path.join(workflowRoot, file));
}

function checkReproducibility(targetRoot, packageInfo) {
  if (!packageInfo.exists) return fail(CHECK_IDS.reproducibility, "reproducibility", "package.json missing", "Add package.json and package-lock.json", { requiredForLocal: true });
  const reasons = [];
  const lockPath = path.join(targetRoot, "package-lock.json");
  if (!fs.existsSync(lockPath)) reasons.push("package-lock.json missing");
  else {
    const lock = readJsonFile(lockPath);
    if (!lock.ok) reasons.push(`package-lock.json invalid JSON: ${lock.error.message}`);
    else if (!lock.value.lockfileVersion) reasons.push("package-lock.json lacks lockfileVersion");
  }
  if (packageLockIgnored(targetRoot)) reasons.push("package-lock.json is ignored");
  if (packageInfo.pkg) {
    if (!packageInfo.pkg.engines?.node || !String(packageInfo.pkg.engines.node).includes(">=20")) reasons.push("engines.node must specify >=20");
    if (!isNonEmptyString(packageInfo.pkg.packageManager) || !packageInfo.pkg.packageManager.startsWith("npm@")) reasons.push("packageManager must be npm@...");
  }
  const workflows = workflowFiles(targetRoot);
  const workflowText = workflows.map((file) => fs.readFileSync(file, "utf8")).join("\n");
  if (workflows.length === 0) reasons.push("CI workflow not present locally");
  else {
    if (/\bnpm\s+install\b/.test(workflowText)) reasons.push("CI workflow uses npm install instead of npm ci");
    if (!/\bnpm\s+ci\b/.test(workflowText)) reasons.push("CI workflow does not use npm ci");
  }
  return reasons.length === 0
    ? pass(CHECK_IDS.reproducibility, "reproducibility", "lockfile and CI install posture are release-ready", { requiredForLocal: true })
    : fail(CHECK_IDS.reproducibility, "reproducibility", reasons.join(", "), "Commit a valid lockfile and ensure CI uses npm ci", { requiredForLocal: true, details: { reasons } });
}

function checkPackDryRunEligibility(packageInfo, lifecycleCheck) {
  const bad = badPackageInfo(packageInfo, CHECK_IDS.packDryRun, "pack-dry-run", "Fix package.json before package dry-run eligibility");
  if (bad) return { ...bad, required_for_release: false };
  const options = { requiredForLocal: true, requiredForRelease: false };
  if (lifecycleCheck.status !== "pass") return fail(CHECK_IDS.packDryRun, "pack-dry-run", "blocked lifecycle scripts make package dry-run unsafe", "Remove blocked lifecycle scripts before running pack dry-run", options);
  if (!Array.isArray(packageInfo.pkg.files) || packageInfo.pkg.files.length === 0) return fail(CHECK_IDS.packDryRun, "pack-dry-run", "package files allowlist missing", "Add package.json files allowlist before package dry-run", options);
  return pass(CHECK_IDS.packDryRun, "pack-dry-run", "eligible for package dry-run; Phase 10A does not execute it", { ...options, details: { evidence_kind: "read_only_eligibility" } });
}

function checkQualityBaseline(targetRoot) {
  const contractPath = qualityContractPath(targetRoot);
  const baselinePath = qualityBaselinePath(targetRoot);
  if (!fs.existsSync(contractPath) || !fs.existsSync(baselinePath)) {
    return fail(CHECK_IDS.quality, "quality-baseline", "quality contract or baseline missing", "Run meta-harness quality init, then fix or baseline quality findings", { requiredForLocal: true });
  }
  try {
    const contract = readQualityContract(targetRoot);
    const baseline = readQualityBaseline(targetRoot);
    const result = compareQualityToBaseline(analyzeQuality(targetRoot, contract), baseline, contract, targetRoot);
    return result.pass
      ? pass(CHECK_IDS.quality, "quality-baseline", "quality baseline is clean", { requiredForLocal: true })
      : fail(CHECK_IDS.quality, "quality-baseline", result.findings.map((finding) => finding.message).join("; "), "Fix quality findings or refresh the baseline with an approved decision", { requiredForLocal: true, details: { findings: result.findings } });
  } catch (error) {
    return fail(CHECK_IDS.quality, "quality-baseline", error.message, "Fix quality contract or baseline before release checking", { requiredForLocal: true });
  }
}

async function checkReady(targetRoot) {
  const ready = await runReadyCheck({ targetRoot, readOnly: true, noExec: true, mode: "local" });
  const details = { passed: ready.passed, failed: ready.failed, skipped: ready.skipped, warned: ready.warned, unknown: ready.unknown, timed_out: ready.timed_out };
  if (ready.ok) return { ready, check: pass(CHECK_IDS.ready, "ready", "read-only ready check has no local failures", { requiredForLocal: true, details }) };
  return { ready, check: fail(CHECK_IDS.ready, "ready", ready.next_action && ready.next_action !== "none" ? ready.next_action : "ready check failed", "Fix ready check failures before release", {
    requiredForLocal: true,
    details: { ...details, failed_checks: ready.checks.filter((item) => item.status === "fail" || item.status === "timeout") },
  }) };
}

function checkTestReadiness(packageInfo, ready) {
  const bad = badPackageInfo(packageInfo, CHECK_IDS.test, "npm-test", "Fix package.json before checking npm test readiness");
  if (bad) return { ...bad, required_for_release: false };
  const options = { requiredForLocal: true, requiredForRelease: false };
  const readyTest = ready?.checks?.find((item) => item.id === "MH_TEST_001");
  if (readyTest && (readyTest.status === "fail" || readyTest.status === "timeout")) {
    return fail(CHECK_IDS.test, "npm-test", readyTest.reason || `ready reported npm test ${readyTest.status}`, readyTest.next_action || "Fix npm test failures", { ...options, details: { ready_status: readyTest.status } });
  }
  if (readyTest?.status === "pass") return pass(CHECK_IDS.test, "npm-test", "npm test pass reused from read-only ready evidence", { ...options, details: { ready_status: "pass", evidence_kind: "read_only" } });
  const scripts = isPlainObject(packageInfo.pkg.scripts) ? packageInfo.pkg.scripts : {};
  if (!isNonEmptyString(scripts.test)) return fail(CHECK_IDS.test, "npm-test", "package.json scripts.test missing", "Add an npm test script or provide ready evidence with MH_TEST_001 pass", options);
  return pass(CHECK_IDS.test, "npm-test", "test script is defined; execution is not run by Phase 10A read-only release check", { ...options, details: { ready_status: readyTest?.status || "not_reported", evidence_kind: "read_only_eligibility" } });
}

function externalEvidenceRecord(policy) { return policy?.external_evidence?.github_security || policy?.evidence?.github_security || null; }
function checkExternalEvidence(policy) {
  const evidence = externalEvidenceRecord(policy);
  const missing = (details = {}) => unknown(CHECK_IDS.externalEvidence, "github-security-evidence", "external GitHub/security evidence missing or not evaluated", "Record GitHub repository security evidence before release", { requiredForLocal: false, ...details });
  if (!evidence) return missing();
  const status = normalizedScript(evidence.status).toLowerCase().replace(/-/g, "_");
  if (["pass", "passed", "verified"].includes(status)) {
    if (!isNonEmptyString(evidence.source)) return unknown(CHECK_IDS.externalEvidence, "github-security-evidence", "external evidence is marked pass but has no source", "Record the evidence source before release", { requiredForLocal: false, details: { evidence } });
    return pass(CHECK_IDS.externalEvidence, "github-security-evidence", "external GitHub/security evidence recorded", { requiredForLocal: false, details: { evidence } });
  }
  if (["fail", "failed", "block", "blocked"].includes(status)) {
    return check(CHECK_IDS.externalEvidence, "github-security-evidence", "fail", evidence.reason || "external GitHub/security evidence is failing", "Resolve external GitHub/security release evidence before release", { requiredForLocal: false, details: { evidence } });
  }
  return missing({ details: { evidence } });
}

function gitStatusPorcelain(targetRoot) {
  const result = spawnSync("git", ["status", "--porcelain"], { cwd: targetRoot, encoding: "utf8", shell: false, stdio: ["ignore", "pipe", "pipe"], timeout: 10_000 });
  if (result.status !== 0 || result.error) {
    return { ok: false, reason: (result.stderr || result.error?.message || "git status failed").trim() };
  }
  return { ok: true, entries: String(result.stdout || "").split(/\r?\n/).filter(Boolean) };
}

function checkCleanTree(targetRoot) {
  const status = gitStatusPorcelain(targetRoot);
  if (!status.ok) return unknown(CHECK_IDS.cleanTree, "clean-tree", `git working tree status unavailable: ${status.reason}`, "Run release checks from a Git working tree before release", { requiredForLocal: false, details: { git_status: "unavailable" } });
  if (status.entries.length === 0) return pass(CHECK_IDS.cleanTree, "clean-tree", "git working tree is clean", { requiredForLocal: false, details: { git_status: "clean", dirty_count: 0, dirty: false } });
  return fail(CHECK_IDS.cleanTree, "clean-tree", `${status.entries.length} uncommitted or untracked git entries`, "Commit or stash changes before release", {
    requiredForLocal: false,
    details: { git_status: "dirty", dirty: true, dirty_count: status.entries.length, dirty_entries: status.entries.slice(0, 50), truncated: status.entries.length > 50 },
  });
}

function checkFullReleaseEvidence() {
  return unknown(CHECK_IDS.fullReleaseEvidence, "full-release-evidence", "Phase 10A local checks are read-only and do not provide full release evidence", "Add future full release evidence before claiming release readiness", {
    requiredForLocal: false, details: { phase: "10A", missing: ["executed test result", "package dry-run output", "publish-mode external evidence"] },
  });
}

function runCommand(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: options.cwd, encoding: "utf8", shell: false, stdio: ["ignore", "pipe", "pipe"], timeout: options.timeout || 10_000 });
  if (result.status !== 0 || result.error) return null;
  return String(result.stdout || "").trim() || null;
}
function gitValue(targetRoot, args) { return runCommand("git", args, { cwd: targetRoot }); }
function npmVersion() { return runCommand(process.platform === "win32" ? "npm.cmd" : "npm", ["--version"]); }
function metaHarnessVersion() {
  const parsed = readJsonFile(path.resolve(__dirname, "..", "package.json"));
  return parsed.ok ? parsed.value.version || null : null;
}
function statusCounts(checks) {
  return Object.fromEntries(["pass", "fail", "skip", "warn", "unknown", "timeout"].map((status) => [status, checks.filter((item) => item.status === status).length]));
}
function firstNextAction(checks, predicate) {
  const item = checks.find((candidate) => predicate(candidate) && candidate.next_action);
  return item ? item.next_action : "";
}
function localCheckBlocked(item) { return item.required_for_local && (item.status === "fail" || item.status === "timeout" || item.status === "unknown"); }
function releaseCheckReady(item) { return item.required_for_release === false || item.status === "pass"; }

async function runReleaseCheck(options = {}) {
  const targetRoot = path.resolve(options.targetRoot || process.cwd());
  const startedAtMs = Date.now();
  const packageInfo = readPackageJson(targetRoot);
  const policyResult = checkReleasePolicy(targetRoot);
  const lifecycle = checkNpmLifecycle(packageInfo);
  const readyResult = await checkReady(targetRoot);
  const cleanTree = checkCleanTree(targetRoot);
  const checks = [
    cleanTree,
    ...policyResult.checks,
    checkPackageIdentity(packageInfo, policyResult.policy),
    checkPackageMetadata(packageInfo, policyResult.policy),
    lifecycle,
    checkReproducibility(targetRoot, packageInfo),
    checkQualityBaseline(targetRoot),
    readyResult.check,
    checkTestReadiness(packageInfo, readyResult.ready),
    checkPackDryRunEligibility(packageInfo, lifecycle),
    checkExternalEvidence(policyResult.policy),
    checkFullReleaseEvidence(),
  ];
  const completedAtMs = Date.now();
  const localOk = !checks.some(localCheckBlocked);
  const releaseReady = localOk && checks.every(releaseCheckReady);
  const releaseNextAction = firstNextAction(checks, (item) => item.required_for_release !== false && item.status !== "pass");
  return { schema_version: "1", local_ok: localOk, ok: localOk, release_ready: releaseReady, mode: "local", publish: false,
    target: toSlash(targetRoot), package_name: packageInfo.pkg?.name || null, version: packageInfo.pkg?.version || null,
    started_at: new Date(startedAtMs).toISOString(), completed_at: new Date(completedAtMs).toISOString(), duration_ms: completedAtMs - startedAtMs,
    git_commit: gitValue(targetRoot, ["rev-parse", "HEAD"]) || null, tree_hash: gitValue(targetRoot, ["rev-parse", "HEAD^{tree}"]) || null,
    git_tree_clean: cleanTree.status === "pass" ? true : cleanTree.status === "fail" ? false : null, git_dirty_count: cleanTree.details?.dirty_count ?? null,
    node_version: process.version, npm_version: npmVersion(), meta_harness_version: metaHarnessVersion(), release_policy_source: policyResult.source,
    external_evidence_status: checks.find((item) => item.id === CHECK_IDS.externalEvidence)?.status || "unknown", counts: statusCounts(checks), checks,
    next_action: localOk ? (releaseReady ? "none" : releaseNextAction || "Record external GitHub/security evidence before release") : firstNextAction(checks, localCheckBlocked) || "Fix local release check failures" };
}

module.exports = {
  CHECK_IDS,
  RELEASE_POLICY_RELATIVE_PATH,
  runReleaseCheck,
  _test: { checkExternalEvidence, checkPackageMetadata, checkReleasePolicy, validateReleasePolicy },
};
