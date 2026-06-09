"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { execSync, spawnSync } = require("node:child_process");
const crypto = require("node:crypto");

const { checkTemplateSync, scanContracts, checkTrustPolicy, checkStateLayout } = require("./sync-check");
const { scanPmBrief } = require("./pm-brief-check");
const { scanDecisionInbox } = require("./decision-inbox-check");
const { checkSecurityBaseline } = require("./security-check");
const { scanRootLeakArtifacts } = require("./root-leak-check");
const {
  SHIPGATE_CHECK_ID,
  ShipGateUnavailableError,
  classifyCurrentChangeSet,
} = require("./ship-gate");
const {
  REQUIRED_CHECK_IDS,
  getReadyCheckTimeoutMs,
} = require("./ready/check-constants");
const {
  readQualityContract,
  readQualityBaseline,
  analyzeQuality,
  compareQualityToBaseline,
  qualityContractPath,
  qualityBaselinePath
} = require("./quality");
function hasGitMetadata(root) {
  const gitPath = path.join(root, ".git");
  return fs.existsSync(gitPath);
}

function readGitHeadNoExec(root) {
  const gitPath = path.join(root, ".git");
  if (!fs.existsSync(gitPath)) return "";

  const stat = fs.statSync(gitPath);
  let gitDir = gitPath;
  let commonGitDir = gitPath;

  if (stat.isFile()) {
    const content = fs.readFileSync(gitPath, "utf8").trim();
    const match = content.match(/^gitdir:\s*(.+)$/);
    if (match) {
      gitDir = match[1].trim();
      if (!path.isAbsolute(gitDir)) {
        gitDir = path.resolve(root, gitDir);
      }
      commonGitDir = gitDir;
      const commondirPath = path.join(gitDir, "commondir");
      if (fs.existsSync(commondirPath)) {
        const commonRel = fs.readFileSync(commondirPath, "utf8").trim();
        commonGitDir = path.resolve(gitDir, commonRel);
      }
    }
  }

  const headPath = path.join(gitDir, "HEAD");
  if (!fs.existsSync(headPath)) return "";
  const head = fs.readFileSync(headPath, "utf8").trim();
  if (head.startsWith("ref: ")) {
    const refName = head.slice(5);
    const refSubPath = refName.split("/").join(path.sep);

    // Check in gitDir first
    let refPath = path.join(gitDir, refSubPath);
    if (fs.existsSync(refPath)) {
      return fs.readFileSync(refPath, "utf8").trim();
    }

    // Check in commonGitDir
    refPath = path.join(commonGitDir, refSubPath);
    if (fs.existsSync(refPath)) {
      return fs.readFileSync(refPath, "utf8").trim();
    }

    // Check packed-refs in commonGitDir
    const packedRefsPath = path.join(commonGitDir, "packed-refs");
    if (fs.existsSync(packedRefsPath)) {
      const packedContent = fs.readFileSync(packedRefsPath, "utf8");
      const lines = packedContent.split(/\r?\n/);
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("^")) {
          continue;
        }
        const parts = trimmed.split(/\s+/);
        if (parts.length >= 2 && parts[1] === refName) {
          const hash = parts[0];
          if (hash && hash.length === 40) {
            return hash;
          }
        }
      }
    }
  } else if (head.length === 40) {
    return head;
  }
  return "";
}

function normalizeTargetPath(value) {
  return path.resolve(value).split(/[\\/]+/).join("/");
}

function normalizeRelativePath(value) {
  return value.split(/[\\/]+/).join("/");
}

function stableJsonStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map(stableJsonStringify).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) =>
      `${JSON.stringify(key)}:${stableJsonStringify(value[key])}`
    ).join(",")}}`;
  }
  return JSON.stringify(value);
}

function addFileToHash(hasher, root, relPath) {
  const abs = path.join(root, relPath);
  const posixPath = normalizeRelativePath(relPath);

  hasher.update(`path:${posixPath}\n`);

  if (!fs.existsSync(abs)) {
    hasher.update("missing\n");
    return;
  }

  try {
    const stat = fs.statSync(abs);
    if (stat.isDirectory()) {
      hasher.update("directory\n");
    } else {
      let content = fs.readFileSync(abs, "utf8").replace(/\r\n?/g, "\n");
      if (posixPath.endsWith(".json")) {
        try {
          content = `${stableJsonStringify(JSON.parse(content))}\n`;
        } catch (e) {
          // Invalid JSON is still part of the state; hash its normalized bytes.
        }
      }
      hasher.update("present\n");
      hasher.update(content);
      hasher.update("\n---end-file---\n");
    }
  } catch (e) {
    hasher.update("error\n");
  }
}

function computeReadyStateHash(targetRoot) {
  const hasher = crypto.createHash("sha256");

  const staticFiles = [
    "package.json",
    "package-lock.json",
    ".npmignore",
    ".gitignore",
    ".gitattributes",
    "SECURITY.md",
    ".github/CODEOWNERS",
    ".github/dependabot.yml",
    ".meta-harness/security-policy.json",
    "docs/architecture/owners.json",
    ".meta-harness/events.jsonl",
    ".meta-harness/status.md",
    ".meta-harness/templates/manifest.json",
    ".meta-harness/clean-code-contract.json",
    ".meta-harness/baseline/quality-baseline.json"
  ];

  for (const f of staticFiles) {
    addFileToHash(hasher, targetRoot, f);
  }

  const workflowsDir = path.join(targetRoot, ".github", "workflows");
  if (fs.existsSync(workflowsDir)) {
    try {
      const stat = fs.statSync(workflowsDir);
      if (stat.isDirectory()) {
        const files = fs.readdirSync(workflowsDir)
          .filter(f => f.endsWith(".yml") || f.endsWith(".yaml"))
          .sort();
        for (const f of files) {
          addFileToHash(hasher, targetRoot, path.join(".github", "workflows", f));
        }
      }
    } catch (e) {
      // ignore
    }
  }

  return hasher.digest("hex");
}

function validatePregeneratedReady(doc, targetRoot, noExec) {
  if (!doc || typeof doc !== "object") return { ok: false, reason: "not an object" };
  if (doc.schema_version !== "1.0.0") return { ok: false, reason: "unsupported or missing schema_version" };
  if (!Array.isArray(doc.checks)) return { ok: false, reason: "missing checks array" };

  if (!doc.target) return { ok: false, reason: "missing target" };
  if (!doc.generated_at) return { ok: false, reason: "missing generated_at" };
  if (!doc.expires_after) return { ok: false, reason: "missing expires_after" };
  if (doc.git_commit === undefined) return { ok: false, reason: "missing git_commit" };
  if (doc.state_hash === undefined || doc.state_hash === null) return { ok: false, reason: "missing state_hash" };
  if (!doc.mode) return { ok: false, reason: "missing mode" };
  if (doc.redacted !== true) return { ok: false, reason: "missing or invalid redacted flag" };

  const normDocTarget = normalizeTargetPath(doc.target);
  const normTargetRoot = normalizeTargetPath(targetRoot);
  if (normDocTarget !== normTargetRoot) {
    return { ok: false, reason: `target mismatch: ready.json is for ${normDocTarget} but directory is ${normTargetRoot}` };
  }

  if (typeof doc.ok !== "boolean") return { ok: false, reason: "missing or invalid ok field" };
  if (typeof doc.passed !== "number" || typeof doc.failed !== "number" || typeof doc.skipped !== "number" ||
      typeof doc.warned !== "number" || typeof doc.unknown !== "number" || typeof doc.timed_out !== "number") {
    return { ok: false, reason: "missing or invalid check count fields" };
  }
  if (doc.state_hash_algorithm !== "sha256:ready-v1") {
    return { ok: false, reason: "missing or invalid state_hash_algorithm" };
  }

  const VALID_STATUSES = new Set(["pass", "fail", "skip", "warn", "unknown", "timeout"]);
  const checkIds = new Set();
  const notApplicable = new Set();
  if (doc.not_applicable !== undefined) {
    if (!Array.isArray(doc.not_applicable)) {
      return { ok: false, reason: "not_applicable must be an array when present" };
    }
    for (const id of doc.not_applicable) {
      if (typeof id !== "string" || id.trim() === "") {
        return { ok: false, reason: "not_applicable contains an invalid check ID" };
      }
      if (notApplicable.has(id)) {
        return { ok: false, reason: `duplicate not_applicable check ID: ${id}` };
      }
      notApplicable.add(id);
    }
  }

  const computedCounts = {
    passed: 0,
    failed: 0,
    skipped: 0,
    warned: 0,
    unknown: 0,
    timed_out: 0
  };
  for (const c of doc.checks) {
    if (!c.id || !c.status || !VALID_STATUSES.has(c.status)) {
      return { ok: false, reason: `invalid check status: ${c.status} for check ${c.id || "unknown"}` };
    }
    if (checkIds.has(c.id)) {
      return { ok: false, reason: `duplicate check ID: ${c.id}` };
    }
    checkIds.add(c.id);
    if (c.status === "pass") computedCounts.passed += 1;
    if (c.status === "fail") computedCounts.failed += 1;
    if (c.status === "skip") computedCounts.skipped += 1;
    if (c.status === "warn") computedCounts.warned += 1;
    if (c.status === "unknown") computedCounts.unknown += 1;
    if (c.status === "timeout") computedCounts.timed_out += 1;
  }

  for (const id of REQUIRED_CHECK_IDS) {
    if (!checkIds.has(id) && !notApplicable.has(id)) {
      return { ok: false, reason: `missing required check result for: ${id}` };
    }
  }
  for (const [field, count] of Object.entries(computedCounts)) {
    if (doc[field] !== count) {
      return { ok: false, reason: `check count mismatch for ${field}: ready.json has ${doc[field]} but checks contain ${count}` };
    }
  }
  if (doc.ok !== (computedCounts.failed === 0 && computedCounts.timed_out === 0)) {
    return { ok: false, reason: "ok field is inconsistent with failed or timed_out counts" };
  }

  const expiresAt = Date.parse(doc.expires_after);
  if (!Number.isFinite(expiresAt)) return { ok: false, reason: "invalid expires_after format" };
  if (Date.now() > expiresAt) return { ok: false, reason: "ready.json has expired" };

  let currentGitCommit = "";
  if (noExec) {
    currentGitCommit = readGitHeadNoExec(targetRoot);
  } else {
    try {
      currentGitCommit = execSync("git rev-parse HEAD", { cwd: targetRoot, stdio: ["ignore", "pipe", "ignore"], encoding: "utf8" }).trim();
    } catch (e) {
      currentGitCommit = readGitHeadNoExec(targetRoot);
    }
  }

  if (currentGitCommit) {
    if (typeof doc.git_commit !== "string" || !/^[0-9a-f]{40}$/i.test(doc.git_commit)) {
      return { ok: false, reason: "git_commit must be a 40-character commit hash for git targets" };
    }
    if (doc.git_commit !== currentGitCommit) {
      return { ok: false, reason: `git_commit mismatch: ready.json has ${doc.git_commit} but checkout is ${currentGitCommit}` };
    }
  } else {
    if (doc.git_commit !== null) {
      return { ok: false, reason: `git_commit mismatch: ready.json has ${doc.git_commit} but checkout is non-git (expected null)` };
    }
  }

  const currentStateHash = computeReadyStateHash(targetRoot);
  const docStateHash = doc.state_hash || "";
  if (docStateHash !== currentStateHash) {
    return { ok: false, reason: `state_hash mismatch: ready.json has ${docStateHash} but state is ${currentStateHash}` };
  }

  return { ok: true };
}

async function runReadyCheck({
  targetRoot,
  quick = false,
  readOnly = false,
  noExec = false,
  mode = "local",
  strictGithubSettings = false,
  isCI = Boolean(process.env.CI || process.env.GITHUB_ACTIONS)
}) {
  const startTime = Date.now();
  const sourceRoot = path.resolve(__dirname, "..");
  const checks = [];

  const effectiveNoExec = Boolean(noExec || readOnly);
  let pregeneratedReady = null;

  // Check pregenerated ready.json
  let readyJsonStatus = "pass";
  let readyJsonReason = "";
  let readyJsonNextAction = "";

  let foundPath = path.join(targetRoot, ".meta-harness", "ready.json");
  let usingFallback = false;
  if (!fs.existsSync(foundPath) && fs.existsSync(path.join(targetRoot, "ready.json"))) {
    foundPath = path.join(targetRoot, "ready.json");
    usingFallback = true;
  }

  if (fs.existsSync(foundPath)) {
    try {
      const doc = JSON.parse(fs.readFileSync(foundPath, "utf8"));
      const validation = validatePregeneratedReady(doc, targetRoot, effectiveNoExec);
      if (validation.ok) {
        pregeneratedReady = doc;
        if (usingFallback) {
          readyJsonStatus = "warn";
          readyJsonReason = "root ready.json is deprecated; move to .meta-harness/ready.json";
          readyJsonNextAction = "Move ready.json to .meta-harness/ready.json";
        }
      } else {
        readyJsonStatus = "fail";
        readyJsonReason = `invalid pregenerated ready.json: ${validation.reason}`;
        readyJsonNextAction = "Regenerate ready.json with valid metadata";
      }
    } catch (e) {
      readyJsonStatus = "fail";
      readyJsonReason = `malformed ready.json: ${e.message}`;
      readyJsonNextAction = "Regenerate ready.json with valid JSON";
    }
  } else if (effectiveNoExec) {
    readyJsonStatus = mode === "local" ? "unknown" : "fail";
    readyJsonReason = "pregenerated ready.json missing in no-exec mode";
    readyJsonNextAction = "Run ready check in local mode first to generate ready.json";
  }

  checks.push({
    id: "MH_READY_JSON_001",
    name: "ready_json",
    status: readyJsonStatus,
    reason: readyJsonReason,
    next_action: readyJsonNextAction,
    applicable: true,
    duration_ms: 0
  });

  function getPregeneratedOrSkip(checkId, name, defaultReason) {
    const pregen = pregeneratedReady && Array.isArray(pregeneratedReady.checks)
      ? pregeneratedReady.checks.find(c => c.id === checkId)
      : null;
    if (pregen) {
      return {
        id: checkId,
        name,
        status: pregen.status,
        reason: pregen.reason || "",
        next_action: pregen.next_action || ""
      };
    }
    return {
      id: checkId,
      name,
      status: "skip",
      reason: defaultReason || "skipped in this execution mode",
      next_action: ""
    };
  }

  async function runCheck(checkId, name, checkFn) {
    const checkStart = Date.now();
    let res;
    try {
      res = await checkFn();
    } catch (err) {
      res = { status: "fail", reason: err.message, next_action: "" };
    }
    const durationMs = Date.now() - checkStart;
    checks.push({
      id: checkId,
      name,
      status: res.status,
      reason: res.reason || "",
      next_action: res.next_action || "",
      applicable: res.applicable !== false,
      duration_ms: durationMs
    });
  }

  // 1. MH_SYNC_001: Template sync
  await runCheck("MH_SYNC_001", "sync", () => {
    const res = checkTemplateSync({ sourceRoot, targetRoot });
    if (res.status === "PASS") {
      return { status: "pass" };
    }
    const failedItems = res.items.filter(item => item.status !== "PASS");
    const missing = failedItems.filter(item => item.status === "MISSING");
    const drift = failedItems.filter(item => item.status === "DRIFT");
    const rejected = failedItems.filter(item => item.status === "REJECTED");
    let reason = `${failedItems.length} template sync issues detected`;
    if (missing.length > 0 && drift.length === 0 && rejected.length === 0) {
      reason = `${missing.length} installed templates missing`;
    } else if (drift.length > 0 && missing.length === 0 && rejected.length === 0) {
      reason = `${drift.length} installed templates drifted`;
    }
    return { status: "fail", reason, next_action: "Run templates install" };
  });

  // 2. MH_TRUST_001: Skill trust
  await runCheck("MH_TRUST_001", "trust", () => {
    const res = checkTrustPolicy({ targetRoot });
    if (res.status === "PASS") {
      return { status: "pass" };
    }
    const failed = res.items.filter(item => item.status !== "PASS").map(item => item.path).join(", ");
    return {
      status: "fail",
      reason: `untrusted skills: ${failed}`,
      next_action: "Review skill trust policy in .meta-harness/skill-distillations.json"
    };
  });

  // 3. MH_CONTRACT_001: Contract headings
  await runCheck("MH_CONTRACT_001", "contract", () => {
    const res = scanContracts({ targetRoot });
    if (res.status === "PASS") {
      return { status: "pass" };
    }
    const failed = res.items.map(item => item.path).join(", ");
    return {
      status: "fail",
      reason: `invalid headings in files: ${failed}`,
      next_action: "Update old primary headings to follow new templates/contracts guidelines"
    };
  });

  // 4. MH_STATE_001: State layout
  await runCheck("MH_STATE_001", "state", () => {
    const res = checkStateLayout({ targetRoot });
    if (res.status === "PASS") {
      return { status: "pass" };
    }
    if (res.status === "MIGRATION_NEEDED") {
      return {
        status: "fail",
        reason: "old runs layout present",
        next_action: "Archive old runs/ and migrate state to v2"
      };
    }
    const missing = res.items.filter(item => item.status === "MISSING").map(item => path.basename(item.path)).join("/");
    return {
      status: "fail",
      reason: `missing ${missing}`,
      next_action: "Run templates install, then create .meta-harness/status.md"
    };
  });

  // 5. MH_BRIEF_001: PM brief shape
  await runCheck("MH_BRIEF_001", "brief", () => {
    const res = scanPmBrief({ targetRoot });
    if (res.status === "PASS") {
      return { status: "pass" };
    }
    const failed = res.items.map(item => `${item.path}: ${item.detail || item.status}`).join(", ");
    return {
      status: "fail",
      reason: failed,
      next_action: "Fix PM brief markdown structure and ensure required sections are present in order"
    };
  });

  // 6. MH_DECISION_001: Decision inbox
  await runCheck("MH_DECISION_001", "decisions", () => {
    const res = scanDecisionInbox({ targetRoot });
    if (res.status === "PASS") {
      return { status: "pass" };
    }
    const failed = res.items.map(item => `${item.path}: ${item.detail || item.status}`).join(", ");
    return {
      status: "fail",
      reason: failed,
      next_action: "Resolve validation errors in decision-inbox.json"
    };
  });

  await runCheck("MH_DOMAIN_GOVERNANCE_001", "domain_governance", () => { const dg = require("./domain-governance"); if (!dg.hasDomainGovernanceSurface(targetRoot)) return { status: "skip", reason: "no domain governance surface" }; const res = dg.checkDomainGovernance({ targetRoot }); return res.ok ? { status: "pass" } : { status: "fail", reason: `${res.counts.fail} domain governance failure(s)`, next_action: res.next_action }; });
  // 7. MH_QUALITY_001: Quality gate
  await runCheck("MH_QUALITY_001", "quality", () => {
    const contractPath = qualityContractPath(targetRoot);
    const baselinePath = qualityBaselinePath(targetRoot);
    if (!fs.existsSync(contractPath) || !fs.existsSync(baselinePath)) {
      return {
        status: "fail",
        reason: "Quality contract or baseline missing",
        next_action: "Run meta-harness quality init to initialize clean-code contract"
      };
    }
    const contract = readQualityContract(targetRoot);
    const baseline = readQualityBaseline(targetRoot);
    const analysis = analyzeQuality(targetRoot, contract);
    const comp = compareQualityToBaseline(analysis, baseline, contract, targetRoot);
    if (comp.pass) {
      return { status: "pass" };
    }
    const reason = comp.findings.map(f => f.message).join("; ");
    return {
      status: "fail",
      reason,
      next_action: "Fix quality gate violations or refresh the quality baseline with an approved decision"
    };
  });

  // 8. MH_SECURITY_001: Security hygiene
  await runCheck("MH_SECURITY_001", "security", () => checkSecurityBaseline({
    targetRoot,
    noExec: effectiveNoExec,
    mode,
    strictGithubSettings
  }));

  // 9. MH_NPM_SCRIPTS_001: npm lifecycle-script risk
  let hasRiskyScripts = false;
  let blocksPackageDryRun = false;
  let riskyScriptsReason = "";
  await runCheck("MH_NPM_SCRIPTS_001", "npm_scripts", () => {
    const pkgPath = path.join(targetRoot, "package.json");
    if (!fs.existsSync(pkgPath)) {
      return { status: "pass", applicable: false };
    }
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
    const scripts = pkg.scripts || {};

    let failedHooks = [];
    let packHooks = [];
    let warnedHooks = [];

    const failHooksList = ["preinstall", "install", "postinstall"];
    const packHooksList = ["prepare", "prepack", "postpack"];
    const warnHooksList = ["publish", "postpublish", "prepublish", "prepublishOnly"];

    for (const hook of failHooksList) {
      if (scripts[hook]) failedHooks.push(hook);
    }

    for (const hook of packHooksList) {
      if (scripts[hook]) packHooks.push(hook);
    }

    const allowedPrepublishOnly = new Set([
      "node bin/meta-harness.js release check --publish --json",
      "node ./bin/meta-harness.js release check --publish --json",
      "meta-harness release check --publish --json"
    ]);

    for (const hook of warnHooksList) {
      if (scripts[hook]) {
        const script = scripts[hook];
        const normalized = script.trim().replace(/\s+/g, " ");
        if (hook === "prepublishOnly" && allowedPrepublishOnly.has(normalized)) {
          continue;
        }
        warnedHooks.push(hook);
      }
    }

    if (failedHooks.length > 0) {
      hasRiskyScripts = true;
      blocksPackageDryRun = true;
      riskyScriptsReason = `risky npm lifecycle scripts found: ${failedHooks.join(", ")}`;
      return {
        status: "fail",
        reason: riskyScriptsReason,
        next_action: "Audit or remove pre/postinstall hooks"
      };
    }
    if (packHooks.length > 0) {
      blocksPackageDryRun = true;
      riskyScriptsReason = `npm pack execution hooks found: ${packHooks.join(", ")}`;
      return {
        status: "warn",
        reason: `npm pack may execute lifecycle scripts: ${packHooks.join(", ")}`,
        next_action: "Audit pack lifecycle scripts before running package dry-run"
      };
    }
    if (warnedHooks.length > 0) {
      return {
        status: "warn",
        reason: `lifecycle scripts with security concerns: ${warnedHooks.join(", ")}`,
        next_action: "Review lifecycle script hooks for execution risks"
      };
    }
    return { status: "pass" };
  });

  // 10. MH_REPRO_001: Reproducible package baseline
  await runCheck("MH_REPRO_001", "reproducibility", () => {
    const pkgPath = path.join(targetRoot, "package.json");
    if (!fs.existsSync(pkgPath)) {
      return { status: "skip", reason: "no package.json found", applicable: false };
    }
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
    const enginesNode = pkg.engines && pkg.engines.node;
    const packageManager = pkg.packageManager;

    const gitignorePath = path.join(targetRoot, ".gitignore");
    let isLockIgnored = false;
    if (fs.existsSync(gitignorePath)) {
      const gitignore = fs.readFileSync(gitignorePath, "utf8");
      const lines = gitignore.split(/\r?\n/).map(l => l.trim()).filter(l => l && !l.startsWith("#"));
      isLockIgnored = lines.some(line => line === "package-lock.json" || line === "/package-lock.json" || line === "**/*.json");
    }

    const lockPath = path.join(targetRoot, "package-lock.json");
    const missingLock = !fs.existsSync(lockPath);
    const lockIgnored = isLockIgnored;
    const invalidEngines = !enginesNode || !enginesNode.includes(">=20");
    const invalidPackageManager = !packageManager || !packageManager.startsWith("npm@");

    let invalidLockfile = false;
    if (!missingLock) {
      try {
        const lock = JSON.parse(fs.readFileSync(lockPath, "utf8"));
        if (!lock || typeof lock !== "object" || !lock.lockfileVersion) {
          invalidLockfile = true;
        }
      } catch (e) {
        invalidLockfile = true;
      }
    }

    if (missingLock || lockIgnored || invalidEngines || invalidPackageManager || invalidLockfile) {
      const reasons = [];
      if (missingLock) reasons.push("package-lock.json missing");
      if (lockIgnored) reasons.push("package-lock.json is ignored");
      if (invalidEngines) {
        if (!enginesNode) {
          reasons.push("engines.node missing");
        } else {
          reasons.push(`engines.node must specify >=20 (found ${enginesNode})`);
        }
      }
      if (invalidPackageManager) {
        if (!packageManager) {
          reasons.push("packageManager missing");
        } else {
          reasons.push(`packageManager must be npm (found ${packageManager})`);
        }
      }
      if (invalidLockfile) reasons.push("package-lock.json lacks lockfileVersion");
      return {
        status: "fail",
        reason: reasons.join(", "),
        next_action: "Ensure package-lock.json (with lockfileVersion), engines.node (specifying >=20), and packageManager (npm) are defined and not ignored"
      };
    }

    const workflowsDir = path.join(targetRoot, ".github", "workflows");
    let hasWorkflows = false;
    let usesNpmInstall = false;
    let usesNpmCi = false;
    if (fs.existsSync(workflowsDir) && fs.statSync(workflowsDir).isDirectory()) {
      const files = fs.readdirSync(workflowsDir);
      for (const file of files) {
        if (file.endsWith(".yml") || file.endsWith(".yaml")) {
          hasWorkflows = true;
          const content = fs.readFileSync(path.join(workflowsDir, file), "utf8");
          if (/\bnpm\s+install\b/.test(content)) {
            usesNpmInstall = true;
          }
          if (/\bnpm\s+ci\b/.test(content)) {
            usesNpmCi = true;
          }
        }
      }
    }

    if (!hasWorkflows) {
      return {
        status: mode === "local" ? "warn" : "fail",
        reason: "CI workflow not present locally",
        next_action: "Create a GitHub workflow using npm ci for dependencies"
      };
    }
    if (usesNpmInstall) {
      return {
        status: "fail",
        reason: "CI workflow uses npm install instead of npm ci",
        next_action: "Update GitHub workflows to use npm ci"
      };
    }
    if (!usesNpmCi) {
      return {
        status: mode === "local" ? "warn" : "fail",
        reason: "CI workflow does not use npm ci",
        next_action: "Update GitHub workflows to install dependencies with npm ci"
      };
    }

    return { status: "pass" };
  });

  // 11. MH_STATE_ROOT_LEAK_001: Sibling workspace evidence sidecars
  await runCheck("MH_STATE_ROOT_LEAK_001", "root_leak", () => {
    const res = scanRootLeakArtifacts({ targetRoot });
    if (res.status === "PASS") {
      return { status: "pass" };
    }
    const leaked = res.items.map((entry) => entry.path).join(", ");
    return {
      status: mode === "local" ? "warn" : "fail",
      reason: `sibling workspace evidence sidecars detected: ${leaked}`,
      next_action: "Move patch/status sidecars under .meta-harness/local/ or an explicit temp directory",
    };
  });

  // 12. MH_GITCHECK_001: Git whitespace
  await runCheck("MH_GITCHECK_001", "git", () => {
    if (effectiveNoExec) {
      return getPregeneratedOrSkip("MH_GITCHECK_001", "git", "git diff skipped in no-exec mode");
    }
    if (!hasGitMetadata(targetRoot)) {
      return { status: "skip", reason: "not a git repository", applicable: false };
    }
    try {
      execSync("git diff --check", { cwd: targetRoot, stdio: "ignore", timeout: getReadyCheckTimeoutMs("MH_GITCHECK_001") });
      return { status: "pass" };
    } catch (err) {
      if (err.code === "ETIMEDOUT" || err.signal === "SIGTERM" || err.status === 124) {
        return { status: "timeout", reason: "git diff --check timed out" };
      }
      return {
        status: "fail",
        reason: "git diff --check warnings detected",
        next_action: "Fix git whitespace warnings"
      };
    }
  });

  // 13. MH_PACKAGE_001: Package dry-run
  await runCheck("MH_PACKAGE_001", "package", () => {
    const pkgPath = path.join(targetRoot, "package.json");
    if (!fs.existsSync(pkgPath)) {
      return { status: "skip", reason: "no package.json found", applicable: false };
    }
    if (effectiveNoExec) {
      return getPregeneratedOrSkip("MH_PACKAGE_001", "package", "package dry-run skipped in no-exec mode");
    }
    if (blocksPackageDryRun) {
      return {
        status: mode === "local" ? "skip" : "fail",
        reason: `npm pack dry-run skipped because: ${riskyScriptsReason}`,
        next_action: "Audit or remove prepare/prepack/postpack hooks"
      };
    }
    try {
      const npmExecPath = process.env.npm_execpath;
      const npmCliPath = path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js");
      const command = (npmExecPath || fs.existsSync(npmCliPath)) ? process.execPath : (process.platform === "win32" ? "npm.cmd" : "npm");

      const args = npmExecPath
        ? [npmExecPath, "pack", "--dry-run", "--json", "--ignore-scripts"]
        : (fs.existsSync(npmCliPath) ? [npmCliPath, "pack", "--dry-run", "--json", "--ignore-scripts"] : ["pack", "--dry-run", "--json", "--ignore-scripts"]);

      const res = spawnSync(command, args, {
        cwd: targetRoot,
        encoding: "utf8",
        shell: process.platform === "win32" && command === "npm.cmd",
        timeout: getReadyCheckTimeoutMs("MH_PACKAGE_001"),
        maxBuffer: 10 * 1024 * 1024 // 10MB limit
      });

      if ((res.error && res.error.code === "ETIMEDOUT") || res.signal === "SIGTERM" || res.status === 124) {
        return { status: "timeout", reason: "npm pack --dry-run timed out" };
      }
      if (res.error && res.error.code === "ENOBUFS") {
        return { status: "fail", reason: "npm pack output exceeded buffer size limit", next_action: "Validate size of package files" };
      }
      if (res.status !== 0) {
        return {
          status: "fail",
          reason: `npm pack failed: ${res.stderr || res.error?.message || "unknown failure"}`,
          next_action: "Ensure package.json is valid and pack runs successfully"
        };
      }

      const packData = JSON.parse(res.stdout);
      const pack = Array.isArray(packData) ? packData[0] : packData;
      const packedFiles = pack.files.map((file) => file.path);

      const hasMetaHarness = packedFiles.some(f => f.includes(".meta-harness"));

      const forbiddenPatterns = [
        /^\.meta-harness\/local(\/|$)/,
        /^\.meta-harness\/snapshots(\/|$)/,
        /^\.meta-harness\/expert-packets(\/|$)/,
        /^\.meta-harness\/workers(\/|$)/,
        /^\.meta-harness\/runs(\/|$)/,
        /^\.meta-harness\/events\.jsonl$/,
        /^\.meta-harness\/decisions\.json$/,
        /^\.env($|\/)/,
        /(^|\/)secrets?($|[.\-/])/i,
        /(^|\/)credentials?($|[.\-/])/i,
        /^provider-config(\/|$)/,
        /^runtime(\/|$)/,
        /^data(\/|$)/,
        /^demo(\/|$)/
      ];

      const leaks = packedFiles.filter(filePath =>
        forbiddenPatterns.some(pattern => pattern.test(filePath))
      );

      if (leaks.length > 0) {
        return {
          status: "fail",
          reason: `forbidden files included in package: ${leaks.join(", ")}`,
          next_action: "Update .npmignore or package.json files list to exclude forbidden paths"
        };
      }

      if (hasMetaHarness) {
        return {
          status: "warn",
          reason: ".meta-harness files found in the package",
          next_action: "Exclusion of all .meta-harness files is recommended"
        };
      }

      return { status: "pass" };
    } catch (err) {
      return {
        status: "fail",
        reason: `npm pack verification threw error: ${err.message}`,
        next_action: "Validate package structure"
      };
    }
  });

  // 14. MH_GITHUB_SETTINGS_001: GitHub repository settings
  await runCheck("MH_GITHUB_SETTINGS_001", "github_settings", async () => {
    if (effectiveNoExec) {
      return getPregeneratedOrSkip("MH_GITHUB_SETTINGS_001", "github_settings", "GitHub settings check skipped in no-exec mode");
    }
    if (!isCI) {
      return { status: "skip", reason: "GitHub settings check skipped locally" };
    }
    const token = process.env.GITHUB_TOKEN;
    const repo = process.env.GITHUB_REPOSITORY;
    const isStrict = strictGithubSettings || (mode === "strict" || mode === "release");

    if (!token) {
      return {
        status: isStrict ? "fail" : "warn",
        reason: "GITHUB_TOKEN is missing in CI environment",
        next_action: "Provide GITHUB_TOKEN with read-only metadata permissions"
      };
    }
    if (!repo) {
      return {
        status: isStrict ? "fail" : "warn",
        reason: "GITHUB_REPOSITORY environment variable is missing",
        next_action: "Ensure workflow runs in a repository context"
      };
    }

    const controller = new AbortController();
    let timeoutId;
    try {
      timeoutId = setTimeout(() => controller.abort(), getReadyCheckTimeoutMs("MH_SECURITY_001"));
      const response = await fetch(`https://api.github.com/repos/${repo}`, {
        headers: {
          "Authorization": `Bearer ${token}`,
          "Accept": "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          "User-Agent": "meta-harness-ready-check"
        },
        signal: controller.signal
      });

      if (response.status === 403 || response.status === 401) {
        return {
          status: isStrict ? "fail" : "warn",
          reason: `GitHub API returned ${response.status}: insufficient permissions`,
          next_action: "Verify GITHUB_TOKEN has read-only metadata/repo scope"
        };
      }
      if (!response.ok) {
        return {
          status: isStrict ? "fail" : "warn",
          reason: `GitHub API error: ${response.statusText}`,
          next_action: "Check repository accessibility"
        };
      }

      const data = await response.json();
      const security = data.security_and_analysis || {};
      const secretScanning = security.secret_scanning?.status === "enabled";
      const pushProtection = security.secret_scanning_push_protection?.status === "enabled";

      if (!secretScanning || !pushProtection) {
        return {
          status: isStrict ? "fail" : "warn",
          reason: `Secret scanning or push protection disabled (scanning: ${security.secret_scanning?.status || "disabled"}, push: ${security.secret_scanning_push_protection?.status || "disabled"})`,
          next_action: "Enable Secret Scanning and Push Protection in repository settings"
        };
      }
      return { status: "pass" };
    } catch (err) {
      if (err.name === "AbortError") {
        return {
          status: "timeout",
          reason: "GitHub settings API check timed out"
        };
      }
      return {
        status: isStrict ? "fail" : "warn",
        reason: `GitHub API request failed: ${err.message}`,
        next_action: "Verify connection to GitHub API"
      };
    } finally {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    }
  });

  // 15. MH_TEST_001: npm tests
  await runCheck("MH_TEST_001", "test", () => {
    const pkgPath = path.join(targetRoot, "package.json");
    if (!fs.existsSync(pkgPath)) {
      return { status: "skip", reason: "no package.json found", applicable: false };
    }
    if (effectiveNoExec) {
      return getPregeneratedOrSkip("MH_TEST_001", "test", "npm tests skipped in no-exec mode");
    }
    if (quick) {
      return getPregeneratedOrSkip("MH_TEST_001", "test", "npm tests skipped via --quick");
    }
    let hasTestScript = false;
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
      if (pkg.scripts && pkg.scripts.test) {
        hasTestScript = true;
      }
    } catch (e) {
      // ignore
    }
    if (!hasTestScript) {
      return { status: "skip", reason: "no test script found", applicable: false };
    }
    try {
      execSync("npm test", { cwd: targetRoot, stdio: "ignore", timeout: getReadyCheckTimeoutMs("MH_TEST_001") });
      return { status: "pass" };
    } catch (err) {
      if (err.code === "ETIMEDOUT" || err.signal === "SIGTERM" || err.status === 124) {
        return { status: "timeout", reason: "npm test timed out" };
      }
      return {
        status: "fail",
        reason: "npm test failed",
        next_action: "Fix test failures"
      };
    }
  });

  // 16. MH_SHIPGATE_001: Ship-fast classification
  await runCheck(SHIPGATE_CHECK_ID, "shipgate", () => {
    if (effectiveNoExec) {
      return getPregeneratedOrSkip(SHIPGATE_CHECK_ID, "shipgate", "ship-gate classification skipped in no-exec mode");
    }
    try {
      const result = classifyCurrentChangeSet({ targetRoot });
      const nextAction = result.resolution === "decision-needed"
        ? "Decision inbox required before shipping boundary-touching changes"
        : result.resolution === "blocked"
          ? "Resolve blocker before shipping"
          : result.resolution === "follow-up-queued"
            ? "Run or record validation checks before shipping"
            : "";
      return {
        status: "pass",
        reason: `current change set classified as ${result.tier}`,
        next_action: nextAction,
      };
    } catch (error) {
      if (error instanceof ShipGateUnavailableError) {
        return {
          status: "skip",
          reason: error.message,
          next_action: "Run ready in a git checkout or provide pregenerated ready.json",
        };
      }
      return {
        status: "fail",
        reason: `ship gate classification errored: ${error.message}`,
        next_action: "Regenerate dirty classification or repair ship-gate input",
      };
    }
  });

  // Calculate results based on mode rules
  let ok = true;
  for (const c of checks) {
    if (c.status === "fail" || c.status === "timeout") {
      ok = false;
    }
    if ((mode === "strict" || mode === "release") && REQUIRED_CHECK_IDS.has(c.id)) {
      if (c.applicable !== false && (c.status === "skip" || c.status === "unknown" || c.status === "warn")) {
        ok = false;
        c.reason = c.reason ? `${c.reason} (required in ${mode} mode)` : `required in ${mode} mode`;
        c.status = "fail"; // Elevate to fail
      }
    }
  }

  const passed = checks.filter(c => c.status === "pass").length;
  const failed = checks.filter(c => c.status === "fail").length;
  const skipped = checks.filter(c => c.status === "skip").length;
  const warned = checks.filter(c => c.status === "warn").length;
  const unknown = checks.filter(c => c.status === "unknown").length;
  const timed_out = checks.filter(c => c.status === "timeout").length;

  const failedChecks = checks.filter(c => c.status === "fail" || c.status === "timeout");
  const failedActions = failedChecks.map(c => c.next_action).filter(Boolean);
  let nextAction = "none";
  if (failedActions.length > 0) {
    const uniqueActions = Array.from(new Set(failedActions));
    nextAction = uniqueActions.join(", then ");
  }

  const durationMs = Date.now() - startTime;

  const git_commit = effectiveNoExec ? readGitHeadNoExec(targetRoot) : (() => {
    try {
      return execSync("git rev-parse HEAD", { cwd: targetRoot, stdio: ["ignore", "pipe", "ignore"], encoding: "utf8" }).trim();
    } catch (e) {
      return readGitHeadNoExec(targetRoot);
    }
  })();
  const state_hash = computeReadyStateHash(targetRoot);
  const expires_after = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  const meta_harness_version = (() => {
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(sourceRoot, "package.json"), "utf8"));
      return pkg.version || "0.1.0";
    } catch (e) {
      return "0.1.0";
    }
  })();

  return {
    schema_version: "1.0.0",
    target: path.resolve(targetRoot).split(path.sep).join("/"),
    mode,
    generated_at: new Date().toISOString(),
    expires_after,
    git_commit: git_commit || null,
    state_hash,
    state_hash_algorithm: "sha256:ready-v1",
    redacted: true,
    duration_ms: durationMs,
    meta_harness_version,
    ok,
    passed,
    failed,
    skipped,
    warned,
    unknown,
    timed_out,
    checks,
    next_action: nextAction
  };
}

module.exports = {
  runReadyCheck,
  computeReadyStateHash,
  getReadyCheckTimeoutMs
};
