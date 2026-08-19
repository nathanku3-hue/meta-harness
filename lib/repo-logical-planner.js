"use strict";

const fs = require("node:fs");
const path = require("node:path");

const { ConfigError } = require("./errors");
const { runEphemeralStructuredModel } = require("./ephemeral-structured-model");
const {
  PLANNER_CANDIDATE_BATCH_SCHEMA,
  validatePlannerCandidateBatch,
} = require("./repo-planner-admission");
const {
  managedWorktreeRoot,
  requireManagedWorktreeIgnore,
  runGit,
} = require("./work-git");

function fail(code, message, details) {
  throw new ConfigError(message, { code, details });
}

function buildLogicalPlannerPrompt(plannerInput) {
  return [
    "LOGICAL_PLANNER_AUTODISPATCH_V2",
    "You are one fresh disposable read-only logical planner. Propose semantic product possibilities only.",
    "You do not hold execution, Claim, Git, publication, workspace, worker, or owner authority.",
    "",
    "Durable planning projection:",
    JSON.stringify(plannerInput, null, 2),
    "",
    "Planning laws:",
    "- Propose independently valuable executable Outcomes, not lifecycle tasks.",
    "- Outcome identity is product result, not path, phase, agent, review, packaging, documentation, or evidence-refresh identity.",
    "- Prefer enough useful possibilities to fill available initial capacity while respecting existing active commitments.",
    "- Existing Claims are commitments. Do not cancel, rewrite, duplicate, or route around them.",
    "- A failed means is not a failed Outcome. Consume unresolved durable handoffs and disproved assertions.",
    "- Product/owner authority, current World and authoritative execution learning, and active Claims outrank promotedResearch.",
    "- promotedResearch is mechanically attributable advisory evidence, not kernel truth, capability, owner authority, or execution authority.",
    "- A promoted CONSTRAINT is only source-reported constraint evidence; it is not a constitutional or execution restriction.",
    "- Do not silently ignore a promoted DISPROVED_ASSUMPTION. If you contradict it, identify stronger or newer evidence in the durable input.",
    "- Contradictory promoted findings may coexist. Qualify or adjudicate them using stronger durable evidence rather than silently overwriting provenance.",
    "- Promoted findings cannot grant owner authority, capability, write scope, or justify research/documentation lifecycle slices that merely restate evidence.",
    "- expectedWritePaths is only your exact predicted semantic write footprint. Do not call it allowedPaths or execution authority.",
    "- Do not request PRODUCT.md, .git, .meta-harness control material, parent traversal, or repository-root '.' as a write footprint.",
    "- Do not choose base commits, validation commands, attempt counts, delivery policy, Claims, sessions, workspaces, workers, or worker prompts.",
    "- Do not produce ownerRequest, blocked, question, manager, approver, librarian, or any owner-escalation field.",
    "- Only already-validated owner-required facts in the input may be treated as unresolved facts; you cannot create new owner authority.",
    "- Do not tell the owner to run streams, open agents, relay prompts, or transport handoffs.",
    "- Empty proposals is allowed and means only that this boot found no fresh proposal.",
    "",
    "Return planner-candidate-batch/v1 only.",
  ].join("\n");
}

function createPlannerSnapshot(repositoryPath, productCommit) {
  requireManagedWorktreeIgnore(repositoryPath);
  const worktreeRootPath = path.join(repositoryPath, ".worktrees");
  const removeRootWhenEmpty = !fs.existsSync(worktreeRootPath);
  const root = managedWorktreeRoot(repositoryPath, { create: true });
  const parent = fs.mkdtempSync(path.join(root, "planner-"));
  const snapshotPath = path.join(parent, "snapshot");
  try {
    runGit(repositoryPath, ["worktree", "add", "--detach", snapshotPath, productCommit]);
    return Object.freeze({ parent, snapshotPath, root, removeRootWhenEmpty });
  } catch (error) {
    fs.rmSync(parent, { recursive: true, force: true });
    if (removeRootWhenEmpty) {
      try { fs.rmdirSync(root); } catch (_) {}
    }
    throw error;
  }
}

function removePlannerSnapshot(repositoryPath, snapshot) {
  if (!snapshot) return;
  runGit(repositoryPath, ["worktree", "remove", "--force", snapshot.snapshotPath], { allowFailure: true });
  fs.rmSync(snapshot.parent, { recursive: true, force: true });
  if (snapshot.removeRootWhenEmpty) {
    try { fs.rmdirSync(snapshot.root); } catch (_) {}
  }
}

async function runLogicalPlanner({
  repositoryPath,
  current,
  plannerInput,
  timeoutSeconds = 300,
  model,
  env = process.env,
}) {
  if (!current?.head || plannerInput?.head?.headDigest !== current.head.headDigest
      || plannerInput.head.productCommit !== current.head.productCommit) {
    fail("MH_LOGICAL_PLANNER_BINDING", "logical planner input must bind the exact current WorldHead and product commit");
  }
  const snapshot = createPlannerSnapshot(repositoryPath, current.head.productCommit);
  const schemaPath = path.join(snapshot.parent, "planner.schema.json");
  const outputPath = path.join(snapshot.parent, "planner.output.json");
  try {
    const produced = await runEphemeralStructuredModel({
      cwd: snapshot.snapshotPath,
      prompt: buildLogicalPlannerPrompt(plannerInput),
      outputSchema: PLANNER_CANDIDATE_BATCH_SCHEMA,
      schemaPath,
      outputPath,
      timeoutSeconds,
      model,
      env,
      outputCapBytes: 4 * 1024 * 1024,
      codePrefix: "MH_LOGICAL_PLANNER",
      label: "logical planner",
      validate: validatePlannerCandidateBatch,
    });
    return Object.freeze({ planner: produced.model, batch: produced.result });
  } finally {
    removePlannerSnapshot(repositoryPath, snapshot);
  }
}

module.exports = {
  buildLogicalPlannerPrompt,
  createPlannerSnapshot,
  removePlannerSnapshot,
  runLogicalPlanner,
};
