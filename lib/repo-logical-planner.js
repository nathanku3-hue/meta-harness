"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const { ConfigError } = require("./errors");
const { readIntegrationHead } = require("./optimistic-integration");
const {
  runEphemeralStructuredModel,
  windowsPathToWsl,
} = require("./ephemeral-structured-model");
const {
  PLANNER_CANDIDATE_BATCH_SCHEMA,
  validatePlannerCandidateBatch,
} = require("./repo-planner-candidate");
const { renderRuntimeSkill } = require("./runtime-skills");
const { runGit } = require("./work-git");

function fail(code, message, details) {
  throw new ConfigError(message, { code, details });
}

function buildLogicalPlannerPrompt(plannerInput) {
  const { ownerIntent, ...planningData } = plannerInput;
  if (!ownerIntent?.productFrame) {
    fail("MH_LOGICAL_PLANNER_INTENT", "logical planner input must contain ownerIntent.productFrame");
  }
  const frame = ownerIntent.productFrame;
  const directive = ownerIntent.activeDirective;
  return renderRuntimeSkill("logical-planner", {
    PRODUCT_VERSION: frame.version,
    PRODUCT_DIGEST: frame.productDirectionDigest,
    ENDGAME: frame.endgame,
    TARGET_USER: frame.targetUser,
    CORE_USER_JOURNEY: frame.coreUserJourney,
    TASTE_PREFER: frame.tastePrefer,
    TASTE_REJECT: frame.tasteReject,
    NON_NEGOTIABLES: frame.nonNegotiables,
    SHIPPING_DEFINITION: frame.shippingDefinition,
    OWNER_OBJECTIVE: directive
      ? `[revision ${directive.revision}; ${directive.contentDigest}]\n${directive.content}`
      : "(none; optimize the standing PRODUCT direction and current observed state)",
    PLANNING_DATA: JSON.stringify(planningData, null, 2),
  });
}

function neutralPlannerTempBase() {
  if (!process.env.WSL_DISTRO_NAME) return os.tmpdir();
  const result = spawnSync("cmd.exe", ["/d", "/s", "/c", "echo %TEMP%"], {
    encoding: "utf8",
    windowsHide: true,
  });
  const converted = result.status === 0 ? windowsPathToWsl(String(result.stdout || "").trim()) : null;
  if (converted && fs.existsSync(converted)) return converted;
  fail("MH_LOGICAL_PLANNER_TEMP", "cannot resolve a Windows-visible neutral planner temp directory from WSL");
}

function createPlannerSnapshot(repositoryPath, productCommit) {
  const parent = fs.mkdtempSync(path.join(neutralPlannerTempBase(), "meta-harness-planner-"));
  const plannerPath = path.join(parent, "planner");
  const snapshotPath = path.join(parent, "snapshot");
  try {
    fs.mkdirSync(plannerPath, { recursive: true });
    runGit(repositoryPath, ["worktree", "add", "--detach", snapshotPath, productCommit]);
    return Object.freeze({ parent, plannerPath, snapshotPath });
  } catch (error) {
    fs.rmSync(parent, { recursive: true, force: true });
    throw error;
  }
}

function removePlannerSnapshot(repositoryPath, snapshot) {
  if (!snapshot) return;
  runGit(repositoryPath, ["worktree", "remove", "--force", snapshot.snapshotPath], { allowFailure: true });
  fs.rmSync(snapshot.parent, { recursive: true, force: true });
}

async function runLogicalPlanner({
  repositoryPath,
  plannerInput,
  timeoutSeconds = 300,
  model,
  env = process.env,
  signal,
}) {
  const productCommit = readIntegrationHead(repositoryPath);
  if (plannerInput?.product?.commit !== productCommit) {
    fail("MH_LOGICAL_PLANNER_BINDING", "logical planner input must bind the exact current Git product head");
  }
  const snapshot = createPlannerSnapshot(repositoryPath, productCommit);
  const schemaPath = path.join(snapshot.parent, "planner.schema.json");
  const outputPath = path.join(snapshot.parent, "planner.output.json");
  try {
    const produced = await runEphemeralStructuredModel({
      cwd: snapshot.plannerPath,
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
      skipGitRepoCheck: true,
      signal,
    });
    return Object.freeze({ planner: produced.model, batch: produced.result });
  } finally {
    removePlannerSnapshot(repositoryPath, snapshot);
  }
}

module.exports = {
  buildLogicalPlannerPrompt,
  createPlannerSnapshot,
  neutralPlannerTempBase,
  removePlannerSnapshot,
  runLogicalPlanner,
};
