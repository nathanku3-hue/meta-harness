"use strict";

const fs = require("node:fs");
const path = require("node:path");
const {
  analyzeQuality,
  compareQualityToBaseline,
  qualityBaselinePath,
  qualityContractPath,
  readQualityBaseline,
  readQualityContract,
} = require("./quality");
const { runReadyCheck } = require("./ready-check");
const { validateReleaseEvidenceRequirements } = require("./release-evidence");
const { commandSummary, runNpm } = require("./release-package-check");

const RELEASE_POLICY_RELATIVE_PATH = ".meta-harness/release-policy.json";
const RELEASE_POLICY_SCHEMA_VERSION = "1";
const IDS = Object.freeze({
  policy: "REL_RELEASE_POLICY_001",
  identitySource: "REL_PACKAGE_IDENTITY_SOURCE_001",
  packageIdentity: "REL_PACKAGE_ID_001",
  packageMetadata: "REL_PACKAGE_METADATA_001",
  lifecycle: "REL_NPM_LIFECYCLE_001",
  prepublishOnly: "REL_PREPUBLISH_ONLY_001",
  reproducibility: "REL_REPRO_001",
  quality: "REL_QUALITY_BASELINE_001",
  ready: "REL_READY_001",
  test: "REL_TEST_001",
  rollbackPolicy: "REL_ROLLBACK_POLICY_001",
});
const ALLOWED_PREPUBLISH_ONLY = new Set([
  "node bin/meta-harness.js release check --publish --json",
  "node ./bin/meta-harness.js release check --publish --json",
  "meta-harness release check --publish --json",
]);
const BLOCKED_LIFECYCLE_SCRIPTS = ["prepare", "prepack", "postpack", "publish", "postpublish", "preinstall", "install", "postinstall"];

function isPlainObject(value) { return Boolean(value && typeof value === "object" && !Array.isArray(value)); }
function isNonEmptyString(value) { return typeof value === "string" && value.trim().length > 0; }
function isSemverish(value) { return /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(String(value || "")); }
function normalizeRegistryUrl(value) { return String(value || "").trim().replace(/\/+$/, ""); }
function normalizedScript(value) { return String(value || "").trim().replace(/\s+/g, " "); }
function readJsonFile(filePath) {
  try { return { ok: true, value: JSON.parse(fs.readFileSync(filePath, "utf8")) }; } catch (error) { return { ok: false, error }; }
}
function check(id, name, status, reason = "", nextAction = "", options = {}) {
  return { id, name, status, reason, next_action: nextAction, required_for_local: Boolean(options.requiredForLocal), required_for_release: options.requiredForRelease !== false, ...(options.details === undefined ? {} : { details: options.details }) };
}
function pass(id, name, reason = "", options = {}) { return check(id, name, "pass", reason, "", options); }
function fail(id, name, reason, nextAction, options = {}) { return check(id, name, "fail", reason, nextAction, options); }

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
  if (!isPlainObject(policy.rollback_policy)) missing.push("rollback_policy");
  missing.push(...validateReleaseEvidenceRequirements(policy));
  return missing;
}

function checkReleasePolicy(targetRoot) {
  const sourcePath = path.join(targetRoot, RELEASE_POLICY_RELATIVE_PATH);
  const failPair = (policy, source, reason, nextAction) => ({ policy, source, checks: [
    fail(IDS.policy, "release-policy", reason, nextAction, { requiredForLocal: true }),
    fail(IDS.identitySource, "identity-source", policy ? "release policy is present but invalid" : "release policy missing", "Fix release policy before checking package identity", { requiredForLocal: true }),
  ] });
  if (!fs.existsSync(sourcePath)) return failPair(null, null, `${RELEASE_POLICY_RELATIVE_PATH} missing`, "Create .meta-harness/release-policy.json with expected package identity");
  const parsed = readJsonFile(sourcePath);
  if (!parsed.ok) return failPair(null, RELEASE_POLICY_RELATIVE_PATH, `release-policy.json is invalid JSON: ${parsed.error.message}`, "Fix .meta-harness/release-policy.json");
  const missing = validateReleasePolicy(parsed.value);
  if (missing.length > 0) return failPair(parsed.value, RELEASE_POLICY_RELATIVE_PATH, `release policy missing: ${missing.join(", ")}`, "Fill required release policy fields");
  return { policy: parsed.value, source: RELEASE_POLICY_RELATIVE_PATH, checks: [
    pass(IDS.policy, "release-policy", RELEASE_POLICY_RELATIVE_PATH, { requiredForLocal: true }),
    pass(IDS.identitySource, "identity-source", RELEASE_POLICY_RELATIVE_PATH, { requiredForLocal: true }),
  ] };
}

function packageRepositoryPresent(repository) { return isNonEmptyString(repository) || (isPlainObject(repository) && isNonEmptyString(repository.url)); }
function packageBinPresent(bin) { return isNonEmptyString(bin) || (isPlainObject(bin) && Object.keys(bin).length > 0); }
function badPackageInfo(info, id, name, action) {
  if (!info.exists) return fail(id, name, "package.json missing", "Add package.json before release checking", { requiredForLocal: true });
  if (info.error) return fail(id, name, `package.json is invalid JSON: ${info.error.message}`, action || "Fix package.json", { requiredForLocal: true });
  return null;
}

function checkPackageMetadata(packageInfo, policy) {
  const bad = badPackageInfo(packageInfo, IDS.packageMetadata, "package-metadata", "Fix package.json");
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
    ? pass(IDS.packageMetadata, "package-metadata", "package metadata is complete", { requiredForLocal: true })
    : fail(IDS.packageMetadata, "package-metadata", `package metadata missing or invalid: ${unique.join(", ")}`, "Add release-safe package metadata", { requiredForLocal: true, details: { missing: unique } });
}

function checkPackageIdentity(packageInfo, policy) {
  const bad = badPackageInfo(packageInfo, IDS.packageIdentity, "package-identity", "Fix package.json");
  if (bad) return bad;
  if (!policy) return fail(IDS.packageIdentity, "package-identity", "release policy missing", "Create release policy before checking package identity", { requiredForLocal: true });
  const pkg = packageInfo.pkg;
  const reasons = [];
  if (pkg.name !== policy.package.name) reasons.push(`package name ${pkg.name || "missing"} does not match policy ${policy.package.name}`);
  if (!isSemverish(pkg.version)) reasons.push(`package version is not valid semver: ${pkg.version || "missing"}`);
  if (pkg.private === true) reasons.push("package is private");
  return reasons.length === 0 ? pass(IDS.packageIdentity, "package-identity", `${pkg.name}@${pkg.version}`, { requiredForLocal: true }) : fail(IDS.packageIdentity, "package-identity", reasons.join("; "), "Align package.json identity with release policy", { requiredForLocal: true });
}

function checkNpmLifecycle(packageInfo) {
  const bad = badPackageInfo(packageInfo, IDS.lifecycle, "npm-lifecycle", "Fix package.json before lifecycle inspection");
  if (bad) return bad;
  const scripts = isPlainObject(packageInfo.pkg.scripts) ? packageInfo.pkg.scripts : {};
  const blocked = BLOCKED_LIFECYCLE_SCRIPTS.filter((name) => isNonEmptyString(scripts[name]));
  if (isNonEmptyString(scripts.prepublishOnly) && !ALLOWED_PREPUBLISH_ONLY.has(normalizedScript(scripts.prepublishOnly))) blocked.push("prepublishOnly");
  return blocked.length === 0 ? pass(IDS.lifecycle, "npm-lifecycle", "no blocked lifecycle scripts", { requiredForLocal: true }) : fail(IDS.lifecycle, "npm-lifecycle", `blocked lifecycle scripts: ${blocked.join(", ")}`, "Remove release-risk lifecycle scripts or use the canonical prepublishOnly guard", { requiredForLocal: true, details: { blocked } });
}

function checkPrepublishOnly(packageInfo) {
  const bad = badPackageInfo(packageInfo, IDS.prepublishOnly, "prepublishOnly", "Fix package.json before checking publish guard");
  if (bad) return bad;
  const script = normalizedScript(packageInfo.pkg.scripts?.prepublishOnly);
  if (!script) return fail(IDS.prepublishOnly, "prepublishOnly", "canonical prepublishOnly release guard missing", "Add prepublishOnly: node bin/meta-harness.js release check --publish --json", { requiredForLocal: true });
  if (!ALLOWED_PREPUBLISH_ONLY.has(script)) return fail(IDS.prepublishOnly, "prepublishOnly", `non-canonical prepublishOnly: ${script}`, "Use the canonical publish-mode release check guard", { requiredForLocal: true, details: { script } });
  return pass(IDS.prepublishOnly, "prepublishOnly", "canonical publish-mode release guard is installed", { requiredForLocal: true, details: { script } });
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
  if (!packageInfo.exists) return fail(IDS.reproducibility, "reproducibility", "package.json missing", "Add package.json and package-lock.json", { requiredForLocal: true });
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
  const workflowText = workflowFiles(targetRoot).map((file) => fs.readFileSync(file, "utf8")).join("\n");
  if (!workflowText) reasons.push("CI workflow not present locally");
  else {
    if (/\bnpm\s+install\b/.test(workflowText)) reasons.push("CI workflow uses npm install instead of npm ci");
    if (!/\bnpm\s+ci\b/.test(workflowText)) reasons.push("CI workflow does not use npm ci");
  }
  return reasons.length === 0 ? pass(IDS.reproducibility, "reproducibility", "lockfile and CI install posture are release-ready", { requiredForLocal: true }) : fail(IDS.reproducibility, "reproducibility", reasons.join(", "), "Commit a valid lockfile and ensure CI uses npm ci", { requiredForLocal: true, details: { reasons } });
}

function checkQualityBaseline(targetRoot) {
  const contractPath = qualityContractPath(targetRoot);
  const baselinePath = qualityBaselinePath(targetRoot);
  if (!fs.existsSync(contractPath) || !fs.existsSync(baselinePath)) return fail(IDS.quality, "quality-baseline", "quality contract or baseline missing", "Run meta-harness quality init, then fix or baseline quality findings", { requiredForLocal: true });
  try {
    const contract = readQualityContract(targetRoot);
    const baseline = readQualityBaseline(targetRoot);
    const result = compareQualityToBaseline(analyzeQuality(targetRoot, contract), baseline, contract, targetRoot);
    return result.pass ? pass(IDS.quality, "quality-baseline", "quality baseline is clean", { requiredForLocal: true }) : fail(IDS.quality, "quality-baseline", result.findings.map((finding) => finding.message).join("; "), "Fix quality findings or refresh the baseline with an approved decision", { requiredForLocal: true, details: { findings: result.findings } });
  } catch (error) {
    return fail(IDS.quality, "quality-baseline", error.message, "Fix quality contract or baseline before release checking", { requiredForLocal: true });
  }
}

async function checkReady(targetRoot, publishMode) {
  const ready = await runReadyCheck({ targetRoot, readOnly: !publishMode, noExec: !publishMode, mode: "local" });
  const details = { passed: ready.passed, failed: ready.failed, skipped: ready.skipped, warned: ready.warned, unknown: ready.unknown, timed_out: ready.timed_out, mode: ready.mode };
  if (ready.ok) return { ready, check: pass(IDS.ready, "ready", publishMode ? "full local ready check has no failures" : "read-only ready check has no local failures", { requiredForLocal: true, details }) };
  return { ready, check: fail(IDS.ready, "ready", ready.next_action && ready.next_action !== "none" ? ready.next_action : "ready check failed", "Fix ready check failures before release", { requiredForLocal: true, details: { ...details, failed_checks: ready.checks.filter((item) => item.status === "fail" || item.status === "timeout") } }) };
}

function checkTestReadiness(targetRoot, packageInfo, ready, publishMode) {
  const bad = badPackageInfo(packageInfo, IDS.test, "npm-test", "Fix package.json before checking npm test readiness");
  if (bad) return { ...bad, required_for_release: false };
  const readyTest = ready?.checks?.find((item) => item.id === "MH_TEST_001");
  if (readyTest && (readyTest.status === "fail" || readyTest.status === "timeout")) return fail(IDS.test, "npm-test", readyTest.reason || `ready reported npm test ${readyTest.status}`, readyTest.next_action || "Fix npm test failures", { requiredForLocal: true, details: { ready_status: readyTest.status } });
  if (readyTest?.status === "pass") return pass(IDS.test, "npm-test", publishMode ? "npm test pass reused from full ready execution" : "npm test pass reused from read-only ready evidence", { requiredForLocal: true, details: { ready_status: "pass", evidence_kind: publishMode ? "ready_executed" : "read_only" } });
  const scripts = isPlainObject(packageInfo.pkg.scripts) ? packageInfo.pkg.scripts : {};
  if (!isNonEmptyString(scripts.test)) return fail(IDS.test, "npm-test", "package.json scripts.test missing", "Add an npm test script or provide ready evidence with MH_TEST_001 pass", { requiredForLocal: true });
  if (!publishMode) return pass(IDS.test, "npm-test", "test script is defined; local mode does not execute it", { requiredForLocal: true, requiredForRelease: false, details: { ready_status: readyTest?.status || "not_reported", evidence_kind: "read_only_eligibility" } });
  const result = runNpm(["test"], { cwd: targetRoot, timeout: 120_000 });
  if (result.error || result.status !== 0) return fail(IDS.test, "npm-test", `npm test failed: ${commandSummary(result)}`, "Fix tests before release", { requiredForLocal: true, details: { exit_status: result.status, signal: result.signal || null } });
  return pass(IDS.test, "npm-test", "npm test executed successfully", { requiredForLocal: true, details: { evidence_kind: "executed" } });
}

function checkRollbackPolicy(targetRoot, policy) {
  const policyOk = policy?.rollback_policy?.tag_delete_allowed_only_if_package_unpublished === true && policy?.rollback_policy?.partial_publish_requires_incident === true;
  const docPath = path.join(targetRoot, "docs", "product", "phase-10-patch-plan.md");
  const docOk = fs.existsSync(docPath) && /Incident And Rollback Policy/.test(fs.readFileSync(docPath, "utf8"));
  if (policyOk || docOk) return pass(IDS.rollbackPolicy, "rollback-policy", "release rollback/incident boundaries are recorded", { requiredForLocal: true, details: { policy: Boolean(policyOk), docs: Boolean(docOk) } });
  return fail(IDS.rollbackPolicy, "rollback-policy", "release rollback/incident boundaries are missing", "Record rollback policy before release", { requiredForLocal: true });
}

module.exports = {
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
};
