#!/usr/bin/env node
"use strict";

/**
 * Install minimal worktree-custody policy projection into discovered repositories.
 * Does not copy the entire Meta-Harness tree.
 */

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");

const {
  CONTRACT_VERSION,
  CHECK_ID,
  ensureLocalWorktreesExclude,
  hasLocalWorktreesExclude,
  getContractDocument,
  checkWorktreeCustody,
  writeLifecycle,
  listWorktreesPorcelain,
  isApprovedLinkedPath,
  resolveOwner,
  nativePath,
  pathsEqual,
} = require("../lib/worktree-custody");

const MH_ROOT = path.resolve(__dirname, "..");
const MH_VERSION = require("../package.json").version;
const MH_COMMIT = (() => {
  const res = spawnSync("git", ["rev-parse", "HEAD"], { cwd: MH_ROOT, encoding: "utf8", windowsHide: true });
  return res.status === 0 ? res.stdout.trim() : "unknown";
})();

function sha256Text(text) {
  return crypto.createHash("sha256").update(text, "utf8").digest("hex");
}

function isGitRepo(dir) {
  const gitPath = path.join(dir, ".git");
  if (!fs.existsSync(gitPath)) return false;
  // skip pure worktree checkouts (file pointer) as install targets for owner projection
  // still allow if directory (primary)
  try {
    return fs.statSync(gitPath).isDirectory();
  } catch {
    return false;
  }
}

function discoverRepos(codeRoot) {
  codeRoot = nativePath(codeRoot);
  const found = [];
  const top = fs.readdirSync(codeRoot, { withFileTypes: true });
  for (const ent of top) {
    if (!ent.isDirectory()) continue;
    if (ent.name.startsWith(".") || ent.name === "node_modules" || ent.name === "_archive") continue;
    const p = path.join(codeRoot, ent.name);
    if (isGitRepo(p)) found.push(p);
    // one level nested
    let children;
    try {
      children = fs.readdirSync(p, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const child of children) {
      if (!child.isDirectory()) continue;
      if (child.name.startsWith(".") || child.name === "node_modules") continue;
      const cp = path.join(p, child.name);
      if (isGitRepo(cp)) found.push(cp);
    }
  }
  return found.sort();
}

function installProjection(repoRoot, { stampLifecycle = true, auditCreatorRoots = true } = {}) {
  repoRoot = nativePath(repoRoot);
  const contract = getContractDocument();
  const contractJson = `${JSON.stringify(contract, null, 2)}\n`;
  const policyHash = sha256Text(contractJson);

  const mhDir = path.join(repoRoot, ".meta-harness");
  const contractsDir = path.join(mhDir, "contracts");
  const custodyDir = path.join(mhDir, "worktree-custody");
  fs.mkdirSync(contractsDir, { recursive: true });
  fs.mkdirSync(custodyDir, { recursive: true });

  fs.writeFileSync(path.join(contractsDir, "worktree-custody.json"), contractJson, "utf8");
  fs.writeFileSync(
    path.join(custodyDir, "installation.json"),
    `${JSON.stringify({
      schema_version: "1.0.0",
      check_id: CHECK_ID,
      contract_version: CONTRACT_VERSION,
      meta_harness_version: MH_VERSION,
      meta_harness_commit: MH_COMMIT,
      meta_harness_source: MH_ROOT,
      policy_hash: policyHash,
      installed_at: new Date().toISOString(),
      approved_owner_root: resolveOwner(repoRoot).ownerRoot || repoRoot,
    }, null, 2)}\n`,
    "utf8",
  );

  const excludePath = ensureLocalWorktreesExclude(repoRoot);
  fs.mkdirSync(path.join(repoRoot, ".worktrees"), { recursive: true });

  if (stampLifecycle) {
    const owner = resolveOwner(repoRoot);
    if (owner.ok) {
      const listed = listWorktreesPorcelain(owner.ownerRoot);
      if (listed.ok) {
        for (const entry of listed.entries) {
          if (pathsEqual(entry.path, owner.ownerRoot)) continue;
          if (!fs.existsSync(entry.path)) continue;
          const approved = isApprovedLinkedPath(entry.path, owner.ownerRoot);
          if (!approved.approved) continue;
          const marker = path.join(entry.path, ".worktree-lifecycle", "active.json");
          if (!fs.existsSync(marker)) {
            writeLifecycle(entry.path, {
              owner: "install-worktree-custody",
              stream: "WORKTREE-CONFINEMENT-AND-C-MIGRATION-0",
              closeWhen: "product stream complete",
              head: entry.head,
              branch: entry.branch || null,
              path: entry.path,
            });
          }
        }
      }
    }
  }

  // Positive/negative self-tests (policy unit, not full create/close in every dirty repo)
  const positive = (() => {
    try {
      const dest = path.join(repoRoot, ".worktrees", `__mh_policy_probe_${Date.now()}`);
      const { assertManagedDestination } = require("../lib/worktree-custody");
      const v = assertManagedDestination(repoRoot, dest);
      return { ok: v.ok, detail: v.findings };
    } catch (error) {
      return { ok: false, detail: error.message };
    }
  })();

  const negativeCases = [
    "C:\\test-worktree",
    path.join(process.env.USERPROFILE || "C:\\Users\\Lenovo", ".devspace", "worktrees", "test"),
    path.join(process.env.USERPROFILE || "C:\\Users\\Lenovo", ".cursor", "worktrees", "test"),
    "E:\\test-worktree",
    path.join(path.dirname(repoRoot), `${path.basename(repoRoot)}-task`),
    "E:\\mnt\\e\\code\\leak",
    "/mnt/e/code/leak",
  ];
  const { assertManagedDestination } = require("../lib/worktree-custody");
  const negative = negativeCases.map((dest) => {
    const v = assertManagedDestination(repoRoot, dest);
    return { dest, refused: !v.ok, findings: v.findings.map((f) => f.code) };
  });
  const negativeAllRefuse = negative.every((n) => n.refused);

  const custodyCheck = checkWorktreeCustody({
    targetRoot: repoRoot,
    mode: "ci",
    requireLifecycle: true,
    auditCreatorRoots,
  });
  const projected = true;
  const projectionTestsPassed = positive.ok && negativeAllRefuse;
  const compliant = custodyCheck.status === "pass";
  const installed = projected && projectionTestsPassed && compliant;

  return {
    repository: repoRoot,
    canonical_root: resolveOwner(repoRoot).ownerRoot || repoRoot,
    meta_harness_version: MH_VERSION,
    meta_harness_commit: MH_COMMIT,
    policy_hash: policyHash,
    installed_timestamp: new Date().toISOString(),
    local_exclude_present: hasLocalWorktreesExclude(repoRoot),
    exclude_path: excludePath,
    positive_test: positive,
    negative_test: { all_refuse: negativeAllRefuse, cases: negative },
    projected,
    projection_tests_passed: projectionTestsPassed,
    custody_check_status: custodyCheck.status,
    custody_check_reason: custodyCheck.reason || "",
    compliant,
    exemption: null,
    installed,
  };
}

function summarizeRecords(records) {
  return {
    repositories_installed: records.filter((r) => r.installed).length,
    repositories_exempted: records.filter((r) => r.exemption).length,
    repositories_failed: records.filter((r) => !r.installed && !r.exemption).length,
  };
}

function main() {
  const args = process.argv.slice(2);
  const codeRoot = nativePath(args.find((a) => !a.startsWith("--")) || "E:\\Code");
  const inventoryArg = args.find((a) => a.startsWith("--inventory="))?.slice("--inventory=".length);
  const inventoryPath = nativePath(
    inventoryArg || path.join(codeRoot, "devspace", "worktree-inventory", "worktree-custody-install-inventory.json"),
  );
  const exemptionsArg = args.find((a) => a.startsWith("--exemptions="))?.slice("--exemptions=".length) || "";
  const exemptionsPath = exemptionsArg ? nativePath(exemptionsArg) : "";

  let exemptions = {};
  if (exemptionsPath && fs.existsSync(exemptionsPath)) {
    exemptions = JSON.parse(fs.readFileSync(exemptionsPath, "utf8"));
  }

  const repos = discoverRepos(codeRoot);
  const records = [];

  for (const repo of repos) {
    if (exemptions[repo]) {
      records.push({
        repository: repo,
        installed: false,
        exemption: exemptions[repo],
        installed_timestamp: new Date().toISOString(),
      });
      console.log(`EXEMPT ${repo}: ${exemptions[repo]}`);
      continue;
    }
    try {
      const rec = installProjection(repo);
      records.push(rec);
      const report = `${rec.installed ? "INSTALL" : "FAIL"} ${repo} installed=${rec.installed} exclude=${rec.local_exclude_present} positive=${rec.positive_test.ok} negative=${rec.negative_test.all_refuse} custody=${rec.custody_check_status}`;
      if (rec.installed) console.log(report);
      else console.error(report);
    } catch (error) {
      records.push({
        repository: repo,
        installed: false,
        error: error.message,
        installed_timestamp: new Date().toISOString(),
      });
      console.error(`FAIL ${repo}: ${error.message}`);
    }
  }

  // Ensure every discovered repo is installed and compliant, or explicitly exempted.
  const counts = summarizeRecords(records);
  const inventory = {
    phase: "WORKTREE-CONFINEMENT-AND-C-MIGRATION-0",
    generated_at: new Date().toISOString(),
    meta_harness_source: MH_ROOT,
    meta_harness_version: MH_VERSION,
    meta_harness_commit: MH_COMMIT,
    code_root: path.resolve(codeRoot),
    repositories_discovered: repos.length,
    ...counts,
    records,
  };

  fs.mkdirSync(path.dirname(inventoryPath), { recursive: true });
  fs.writeFileSync(inventoryPath, `${JSON.stringify(inventory, null, 2)}\n`, "utf8");
  console.log(`\nInventory: ${inventoryPath}`);
  console.log(
    `discovered=${inventory.repositories_discovered} installed=${inventory.repositories_installed} exempted=${inventory.repositories_exempted} failed=${inventory.repositories_failed}`,
  );
  process.exit(inventory.repositories_failed > 0 ? 1 : 0);
}

if (require.main === module) {
  main();
}

module.exports = { installProjection, discoverRepos, summarizeRecords };
