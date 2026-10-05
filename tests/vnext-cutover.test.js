"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.resolve(__dirname, "..");
const LIB = path.join(ROOT, "lib");

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, ...relativePath.split("/")), "utf8");
}

function javascriptFiles(directory) {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...javascriptFiles(target));
    else if (entry.isFile() && entry.name.endsWith(".js")) files.push(target);
  }
  return files;
}

test("new production code cannot mint Outcome Claims outside the historical compatibility module", () => {
  const constructors = /\b(?:ensureOutcomeClaim|acquireOutcomeClaim|acquireOutcomeClaimSession)\s*\(/gu;
  const offenders = javascriptFiles(LIB)
    .filter((filePath) => path.basename(filePath) !== "outcome-claim.js")
    .filter((filePath) => constructors.test(fs.readFileSync(filePath, "utf8")))
    .map((filePath) => path.relative(ROOT, filePath).replaceAll("\\", "/"));
  assert.deepEqual(offenders, []);
});

test("public repository entry has no global INVALID execution state", () => {
  const { META_ENTRY_ACTIONS } = require("../lib/repository-entry");
  assert.deepEqual([...META_ENTRY_ACTIONS], ["CONTINUE", "IDLE"]);
});

test("ordinary work module load excludes optional repo intelligence", () => {
  const workPath = require.resolve("../lib/commands/work");
  const optionalPaths = [
    "../lib/repo-work-wave",
    "../lib/repo-planner-input",
    "../lib/read-only-interaction",
    "../lib/repo-research-promotion",
  ].map((relativePath) => require.resolve(relativePath));
  delete require.cache[workPath];
  for (const optionalPath of optionalPaths) delete require.cache[optionalPath];

  require(workPath);

  for (const optionalPath of optionalPaths) {
    assert.equal(require.cache[optionalPath], undefined, `${path.relative(ROOT, optionalPath)} must stay outside ordinary module load`);
  }
  delete require.cache[workPath];
});

test("legacy execution permit minting is absent from production source", () => {
  assert.equal(fs.existsSync(path.join(LIB, "execution-permit.js")), false);
  assert.equal(fs.existsSync(path.join(ROOT, "tests", "fixtures", "legacy-execution-permit.js")), true);
});

test("normal execution accepts only OWNER_GOAL or REPO_RUN and never mints legacy execution authority", () => {
  const normalFiles = [
    "lib/work-loop.js",
    "lib/proposal-worker-packet.js",
    "lib/proposal-dispatch.js",
    "lib/devspace-proposal-host.js",
  ];
  for (const relativePath of normalFiles) {
    const text = read(relativePath);
    assert.doesNotMatch(text, /\bissueExecutionPermit\s*\(/u, relativePath);
    assert.doesNotMatch(text, /\benterExecutionAttempt\s*\(/u, relativePath);
    assert.doesNotMatch(text, /require\(["']\.\/execution-permit["']\)/u, relativePath);
  }
  const workLoop = read("lib/work-loop.js");
  assert.match(workLoop, /normal execution accepts only OWNER_GOAL or REPO_RUN sessions/u);
  assert.doesNotMatch(workLoop, /REPO_OUTCOME[\s\S]{0,120}?enterRunAttempt/u);

  const packetSource = read("lib/proposal-worker-packet.js");
  const packetCreate = packetSource.slice(packetSource.indexOf("function compileProposalWorkerPacket"));
  assert.match(packetCreate, /new proposal worker packets require a current REPO_RUN session/u);
  assert.doesNotMatch(packetCreate, /permitDigest|REPO_OUTCOME/u);

  const dispatchSource = read("lib/proposal-dispatch.js");
  const dispatchCreate = dispatchSource.slice(
    dispatchSource.indexOf("function createIntent"),
    dispatchSource.indexOf("function readProposalDispatchIntent"),
  );
  assert.match(dispatchCreate, /new external proposal dispatch requires a current REPO_RUN session/u);
  assert.doesNotMatch(dispatchCreate, /permitDigest|REPO_OUTCOME/u);
});

test("legacy execution permit machinery is not imported by production modules", () => {
  const offenders = javascriptFiles(LIB)
    .filter((filePath) => path.basename(filePath) !== "execution-permit.js")
    .filter((filePath) => /require\(["']\.\/execution-permit["']\)/u.test(fs.readFileSync(filePath, "utf8")))
    .map((filePath) => path.relative(ROOT, filePath).replaceAll("\\", "/"));
  assert.deepEqual(offenders, []);
});

test("retired INVALIDATED_REPLAN compatibility is absent from production", () => {
  const compatibilityFiles = javascriptFiles(LIB)
    .filter((filePath) => fs.readFileSync(filePath, "utf8").includes("INVALIDATED_REPLAN"))
    .map((filePath) => path.relative(ROOT, filePath).replaceAll("\\", "/"))
    .sort();
  assert.deepEqual(compatibilityFiles, []);
});

test("legacy repo-decision compiler and Decision Plane are absent from production source", () => {
  for (const relativePath of [
    "lib/repo-decision.js",
    "lib/repo-decision-plane-v2.js",
    "lib/repo-decision-plane.js",
  ]) {
    assert.equal(fs.existsSync(path.join(ROOT, relativePath)), false, `${relativePath} must not remain in production`);
  }
  for (const relativePath of [
    "tests/fixtures/legacy-repo-decision.js",
    "tests/fixtures/legacy-repo-decision-plane-v2.js",
  ]) {
    assert.equal(fs.existsSync(path.join(ROOT, relativePath)), true, `${relativePath} preserves regression-only compatibility coverage`);
  }
  const offenders = javascriptFiles(LIB)
    .filter((filePath) => /require\(["']\.\/repo-decision(?:-plane-v2)?["']\)/u.test(fs.readFileSync(filePath, "utf8")))
    .map((filePath) => path.relative(ROOT, filePath).replaceAll("\\", "/"));
  assert.deepEqual(offenders, []);
});

test("normal product path excludes retired semantic, proof, Claim, and World authority", () => {
  for (const retired of [
    "semantic-authority.js",
    "terminal-endgame.js",
    "work-proof-compiler.js",
    "work-product-proof.js",
    "work-product-proof-spec.js",
    "execution-permit.js",
    "outcome-claim.js",
    "world-authority.js",
    "world-transition.js",
    "world-attestation.js",
    "world-contract.js",
    "repo-closure-interpreter.js",
    "repo-outcome-landing.js",
    "repo-product-migration.js",
    "repo-proposal-set.js",
  ]) {
    assert.equal(fs.existsSync(path.join(LIB, retired)), false, retired);
  }
  const normalFiles = [
    "lib/commands/work.js",
    "lib/repo-work-wave.js",
    "lib/repo-planner-input.js",
    "lib/repo-planner-candidate.js",
    "lib/work-session.js",
    "lib/work-loop.js",
  ];
  const forbidden = /semanticProjection|endgameProjection|compileSemanticAuthority|productProofSpec|compileProductProofSpec|assertProductProofSpecAuthority|outcome-claim|readCurrentWorldState|commitTransition|originHeadDigest|continuesFromTransitionDigests/u;
  const hits = normalFiles.filter((relativePath) => forbidden.test(read(relativePath)));
  assert.deepEqual(hits, []);
});

test("workspace execution leases are absent from production source", () => {
  const forbidden = /workspace-execution-lease|MH_WORKSPACE_BUSY|acquireWorkspaceExecutionLease|assertWorkspaceExecutionLease|releaseWorkspaceExecutionLease|workspaceExecutionLeaseAppearsActive/u;
  const offenders = javascriptFiles(LIB)
    .filter((filePath) => forbidden.test(fs.readFileSync(filePath, "utf8")))
    .map((filePath) => path.relative(ROOT, filePath).replaceAll("\\", "/"));
  assert.deepEqual(offenders, []);
});

test("World publication locks are absent from production source", () => {
  const forbidden = /world-authority\.lock|MH_WORLD_AUTHORITY_BUSY|withWorldAuthorityLock|acquireWorldAuthorityLock|releaseWorldAuthorityLock|WORLD_AUTHORITY_LOCK/u;
  const offenders = javascriptFiles(LIB)
    .filter((filePath) => forbidden.test(fs.readFileSync(filePath, "utf8")))
    .map((filePath) => path.relative(ROOT, filePath).replaceAll("\\", "/"));
  assert.deepEqual(offenders, []);
});

test("Git product publication has one production CAS owner", () => {
  const integration = read("lib/repo-product-integration.js");
  assert.match(integration, /compareAndSwapIntegrationHead/u);
  assert.doesNotMatch(integration, /\["update-ref",\s*PRODUCT_HEAD_REF/u);
  const casOwners = javascriptFiles(LIB)
    .filter((filePath) => path.basename(filePath) !== "optimistic-integration.js")
    .filter((filePath) => /\bcompareAndSwapIntegrationHead\s*\(/u.test(fs.readFileSync(filePath, "utf8")))
    .map((filePath) => path.relative(ROOT, filePath).replaceAll("\\", "/"))
    .sort();
  assert.deepEqual(casOwners, ["lib/repo-product-integration.js"]);
  const repairOffenders = javascriptFiles(LIB)
    .filter((filePath) => /\brepairProductHeadRef\b/u.test(fs.readFileSync(filePath, "utf8")))
    .map((filePath) => path.relative(ROOT, filePath).replaceAll("\\", "/"));
  assert.deepEqual(repairOffenders, []);
});

test("normal repo work is PRODUCT + run journal + validation + Git CAS, not World projection", () => {
  const repoWorkWave = read("lib/repo-work-wave.js");
  assert.match(repoWorkWave, /readIntegrationHead/u);
  assert.match(repoWorkWave, /prepareProductIntegration/u);
  assert.match(repoWorkWave, /publishProductIntegration/u);
  assert.match(repoWorkWave, /runWork/u);
  assert.doesNotMatch(repoWorkWave, /project-world|repo-world-bootstrap|world-transition|repo-outcome-landing|outcome-claim/u);
});

test("normal product execution is isolated from source-only semantic-kernel and execution-custody maintenance", () => {
  const normalFiles = [
    "lib/commands/work.js",
    "lib/repository-entry.js",
    "lib/repo-work-wave.js",
    "lib/repo-planner-input.js",
    "lib/repo-planner-candidate.js",
    "lib/work-session.js",
    "lib/work-loop.js",
    "lib/work-git.js",
    "lib/repo-product-integration.js",
  ];
  const hits = normalFiles.filter((relativePath) =>
    /require\(["'][^"']*(?:semantic-kernel|execution-custody)/u.test(read(relativePath)));
  assert.deepEqual(hits, []);
});

test("historical context and governance machinery is absent from production source", () => {
  const offenders = javascriptFiles(LIB)
    .map((filePath) => path.relative(ROOT, filePath).replaceAll("\\", "/"))
    .filter((relativePath) =>
      /^lib\/(?:context-gate(?:-|\.js)|governance(?:-|\.js)|ready-context-gate(?:-|\.js))/.test(relativePath)
      || [
        "lib/context-command-options.js",
        "lib/context-packet-policy.js",
        "lib/context-packet.js",
        "lib/context-status-fields.js",
        "lib/domain-governance.js",
        "lib/domain-rule-check.js",
        "lib/commands/context.js",
        "lib/commands/domain-governance.js",
        "lib/commands/governance.js",
        "lib/commands/governance-migration.js",
        "lib/commands/governance-release.js",
      ].includes(relativePath));
  assert.deepEqual(offenders, []);

  const retiredProtocol = /context-gate-(?:satisfied|override)|governance_engine_hash|phase_to_expected_transition|MH_CONTEXT_GATE_001|MH_TRANSITION_GRAPH_001|MH_DOMAIN_GOVERNANCE_001|\.meta-harness\/domain-governance|activation_decision_id|pilot_chain_id/u;
  const protocolOffenders = javascriptFiles(LIB)
    .filter((filePath) => retiredProtocol.test(fs.readFileSync(filePath, "utf8")))
    .map((filePath) => path.relative(ROOT, filePath).replaceAll("\\", "/"));
  assert.deepEqual(protocolOffenders, []);

  for (const retiredTemplate of [
    "templates/contracts/context-adoption-contract.md",
    "templates/contracts/context-gate-schema.json",
    "templates/skills/context-packet.md",
    "templates/skills/context-quality-gate.md",
  ]) {
    assert.equal(fs.existsSync(path.join(ROOT, retiredTemplate)), false, retiredTemplate);
  }
});

test("repository entry recovery does not treat terminal custody labels as product authority", () => {
  const repositoryEntry = read("lib/repository-entry.js");
  assert.match(repositoryEntry, /latestOwnerGoalJournalRecovery/u);
  assert.doesNotMatch(repositoryEntry, /TERMINAL_BLOCKED|TERMINAL_BLOCKED_DIRTY|TERMINAL_ABANDONED/u);
});

test("direct recovery has one sealed-session source and no duplicate current-truth pointer or result file", () => {
  const workGit = read("lib/work-git.js");
  const workLoop = read("lib/work-loop.js");
  assert.match(workGit, /persistRunSession/u);
  assert.match(workGit, /readRunSession/u);
  assert.doesNotMatch(workGit, /work-session-pointer|latest\.json|sessionFile|recoverLatestDirectProductIntent/u);
  assert.doesNotMatch(workLoop, /state\.resultPath|\.result\.json/u);
});

test("repository contracts are sealed context, not pre-execution admission", () => {
  const binding = read("lib/repository-contract-binding.js");
  assert.match(binding, /compileRepositoryContractBindings/u);
  assert.doesNotMatch(binding, /repository-contract-binding-record|persistRepositoryContractBindingRecord|readRepositoryContractBindingRecord|journalDirectory/u);
  assert.doesNotMatch(read("lib/repo-planner-candidate.js"), /repositoryContracts|persistRepositoryContractBindingRecord/u);
  assert.doesNotMatch(read("lib/work-loop.js"), /assertRepositoryContractBindingsCurrent/u);
  assert.doesNotMatch(read("lib/proposal-worker-packet.js"), /assertRepositoryContractBindingsCurrent/u);
});

test("production semantic projection code does not describe World as execution authority", () => {
  const offenders = javascriptFiles(LIB)
    .filter((filePath) => /authoritative World|World authority|product authority/iu.test(fs.readFileSync(filePath, "utf8")))
    .map((filePath) => path.relative(ROOT, filePath).replaceAll("\\", "/"));
  assert.deepEqual(offenders, []);
});

test("model-facing surfaces do not regress to the gate-first Round-4 vocabulary", () => {
  const surfaces = [
    "AGENTS.md",
    "lib/coding-worker.js",
    "lib/repo-logical-planner.js",
    "lib/commands/work.js",
    "lib/read-only-interaction.js",
  ];
  const forbidden = [
    /continuation authority is invalid/iu,
    /smallest lawful unblock/iu,
    /explicitly authorize committing/iu,
    /custody rules?[^\n]{0,80}(?:hard-?block|block execution)/iu,
    /Claim authority/iu,
    /ExecutionPermit topology/iu,
    /constitutional owner authority/iu,
  ];
  const hits = [];
  for (const relativePath of surfaces) {
    const text = read(relativePath);
    for (const pattern of forbidden) {
      if (pattern.test(text)) hits.push(`${relativePath}: ${pattern}`);
    }
  }
  assert.deepEqual(hits, []);
});

test("injected agent contract leads with product and fixes the five convergence primitives", () => {
  const agents = read("AGENTS.md");
  assert.ok(agents.indexOf("## Product law") >= 0);
  assert.ok(agents.indexOf("## Convergence type law") > agents.indexOf("## Product law"));
  assert.ok(agents.indexOf("## Coordination law") > agents.indexOf("## Convergence type law"));
  assert.doesNotMatch(agents, /truth order/iu);
  assert.doesNotMatch(agents, /Claim authority|ExecutionPermit topology/iu);
  for (const primitive of ["Outcome", "Observation", "Invariant", "Capability", "Fact"]) {
    assert.match(agents, new RegExp(`\\b${primitive}\\b`, "u"), primitive);
  }
  assert.match(agents, /Action is an ephemeral hypothesis/iu);
  assert.match(agents, /Select the nearest reversible action/iu);
  assert.match(agents, /Failed means is not failed Outcome/iu);
});
