"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const { ConfigError } = require("./errors");
const { modelControlViolations } = require("./model-control-boundary");
const { runEphemeralStructuredModel, windowsPathToWsl } = require("./ephemeral-structured-model");
const { renderRuntimeSkill } = require("./runtime-skills");
const { readOwnerObjectiveState } = require("./owner-objective-state");
const { readIntegrationHead } = require("./optimistic-integration");
const { listProfessionalSkillMetadata } = require("./professional-skill-catalog");
const { readResearchPromotion } = require("./research-evidence-store");
const { listRunSessions, readRunEventsForSession } = require("./run-journal");
const { readSourceBearingOwnerIngress } = require("./source-bearing-owner-ingress");
const { commonGitDirectory } = require("./work-git");

const READ_ONLY_INTERACTION_SCHEMA_VERSION = "read-only-interaction/v1";
const READ_ONLY_INTERACTION_SNAPSHOT_SCHEMA_VERSION = "read-only-interaction-snapshot/v2";
const MAX_JSON_BYTES = 512 * 1024;
const MAX_ANSWER_BYTES = 64 * 1024;

const READ_ONLY_INTERACTION_RESPONSE_SCHEMA = Object.freeze({
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object",
  additionalProperties: false,
  required: ["answer"],
  properties: {
    answer: { type: "string", minLength: 1 },
  },
});

function fail(code, message, details) {
  throw new ConfigError(message, { code, details });
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function readActiveCommitments(repositoryPath) {
  const projected = [];
  const gitCommonDirectory = commonGitDirectory(repositoryPath);
  for (const session of listRunSessions({ gitCommonDirectory })) {
    if (session.origin?.type !== "REPO_RUN") continue;
    const events = readRunEventsForSession({ gitCommonDirectory, sessionDigest: session.sessionDigest });
    if (events.some((event) => event.type === "integration/result"
        && ["LANDED", "ALREADY_LANDED"].includes(event.data?.status))) continue;
    if (events.some((event) => event.type === "run/settled")) continue;
    projected.push(Object.freeze({
      runKey: session.sessionDigest,
      outcomeDigest: session.origin.outcomeDigest,
      acquiredAt: events[0]?.at || null,
      desiredState: session.productResult,
      evidenceRequirement: session.doneWhen,
      writePaths: Object.freeze([...session.allowedPaths]),
    }));
  }
  projected.sort((left, right) => String(left.acquiredAt || "").localeCompare(String(right.acquiredAt || ""))
    || left.runKey.localeCompare(right.runKey));
  return Object.freeze(projected);
}

function readSettledObservations(repositoryPath) {
  const projected = [];
  const gitCommonDirectory = commonGitDirectory(repositoryPath);
  for (const session of listRunSessions({ gitCommonDirectory })) {
    if (session.origin?.type !== "REPO_RUN") continue;
    const events = readRunEventsForSession({ gitCommonDirectory, sessionDigest: session.sessionDigest });
    const settled = [...events].reverse().find((event) => event.type === "run/settled") || null;
    if (!settled) continue;
    projected.push(Object.freeze({
      sessionDigest: session.sessionDigest,
      outcomeDigest: session.origin.outcomeDigest,
      productResult: session.productResult,
      outcome: settled.data?.outcome || null,
      observableResult: settled.data?.observableResult || null,
      blocker: settled.data?.blocker || null,
      failedMeans: Object.freeze([...(settled.data?.failedMeans || [])]),
      observedAt: settled.at,
    }));
  }
  projected.sort((left, right) => String(left.observedAt || "").localeCompare(String(right.observedAt || ""))
    || left.sessionDigest.localeCompare(right.sessionDigest));
  return Object.freeze(projected.slice(-24));
}

function readBoundPromotedEvidence(repositoryPath, objective) {
  if (!objective?.ingressDigest) return Object.freeze([]);
  const ingress = readSourceBearingOwnerIngress(repositoryPath, objective.ingressDigest);
  const findings = [];
  for (const source of ingress.sources) {
    const promotion = readResearchPromotion(repositoryPath, source.contentDigest, { optional: true });
    if (!promotion) continue;
    for (const finding of promotion.findings) {
      findings.push(Object.freeze({
        findingDigest: finding.findingDigest,
        kind: finding.kind,
        statement: finding.statement,
        scope: finding.scope,
        source: Object.freeze({
          ingressDigest: objective.ingressDigest,
          name: source.name,
          contentDigest: source.contentDigest,
        }),
        evidenceQuotes: Object.freeze(finding.evidence.map((entry) => entry.quote)),
      }));
    }
  }
  findings.sort((left, right) => left.findingDigest.localeCompare(right.findingDigest));
  return Object.freeze(findings);
}

function buildReadOnlyInteractionSnapshot(repositoryPath) {
  const objective = readOwnerObjectiveState(repositoryPath, { optional: true });
  const productCommit = readIntegrationHead(repositoryPath, { optional: true });
  const activeCommitments = readActiveCommitments(repositoryPath);
  const observations = readSettledObservations(repositoryPath);
  const promotedEvidence = readBoundPromotedEvidence(repositoryPath, objective);

  const snapshot = deepFreeze({
    schemaVersion: READ_ONLY_INTERACTION_SNAPSHOT_SCHEMA_VERSION,
    objective: objective ? {
      revision: objective.revision,
      content: objective.content,
      contentDigest: objective.contentDigest,
      ingressDigest: objective.ingressDigest || null,
    } : null,
    productCommit,
    activeWork: activeCommitments.map((entry) => ({
      desiredState: entry.desiredState,
      evidenceRequirement: entry.evidenceRequirement,
      writePaths: entry.writePaths,
    })),
    observations,
    promotedEvidence,
    professionalSkillMetadata: productCommit
      ? listProfessionalSkillMetadata(repositoryPath, { productCommit })
      : Object.freeze([]),
  });
  const byteLength = Buffer.byteLength(JSON.stringify(snapshot), "utf8");
  if (byteLength > MAX_JSON_BYTES) {
    fail("MH_READ_ONLY_INTERACTION_BUDGET", `read-only interaction snapshot exceeds ${MAX_JSON_BYTES} bytes`, { byteLength });
  }
  return snapshot;
}

function nonEmptyResponseString(value, label) {
  if (typeof value !== "string" || value.trim() === "") {
    fail("MH_READ_ONLY_INTERACTION_RESULT", `${label} must be non-empty`);
  }
  return value.trim();
}

function validateReadOnlyInteractionResponse(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("MH_READ_ONLY_INTERACTION_RESULT", "read-only interaction result must be an object");
  }
  const keys = Object.keys(value).sort();
  if (JSON.stringify(keys) !== JSON.stringify(["answer"])) {
    fail("MH_READ_ONLY_INTERACTION_RESULT", "read-only interaction result has unexpected fields");
  }
  const answer = nonEmptyResponseString(value.answer, "read-only interaction answer");
  const controlViolations = modelControlViolations(answer);
  if (controlViolations.length > 0) {
    fail("MH_READ_ONLY_INTERACTION_MODEL_CONTROL", "read-only interaction attempted to manufacture required human input", {
      violations: controlViolations,
    });
  }
  if (Buffer.byteLength(answer, "utf8") > MAX_ANSWER_BYTES) {
    fail("MH_READ_ONLY_INTERACTION_RESULT", `read-only interaction answer exceeds ${MAX_ANSWER_BYTES} bytes`);
  }
  return Object.freeze({ answer });
}

function buildReadOnlyInteractionPrompt(rawTurn, snapshot) {
  return renderRuntimeSkill("read-only-interaction", {
    RAW_TURN: JSON.stringify({ rawTurn }),
    SNAPSHOT: JSON.stringify(snapshot, null, 2),
    SCHEMA_VERSION: READ_ONLY_INTERACTION_SCHEMA_VERSION,
  });
}

function neutralInteractionTempBase(env = process.env) {
  if (!env.WSL_DISTRO_NAME) return os.tmpdir();
  const result = spawnSync("cmd.exe", ["/d", "/s", "/c", "echo %TEMP%"], {
    encoding: "utf8",
    windowsHide: true,
  });
  const converted = result.status === 0 ? windowsPathToWsl(String(result.stdout || "").trim()) : null;
  if (converted && fs.existsSync(converted)) return converted;
  fail("MH_READ_ONLY_INTERACTION_TEMP", "cannot resolve a neutral Windows-visible temporary directory");
}

function sanitizedModelEnv(env) {
  const clean = { ...(env || {}) };
  delete clean.META_HARNESS_INTERNAL_DEVSPACE_PROPOSAL_ENDPOINT;
  delete clean.META_HARNESS_INTERNAL_DEVSPACE_PROPOSAL_TOKEN;
  delete clean.META_HARNESS_INTERNAL_HOST_RESULT;
  return clean;
}

async function answerReadOnlyInteraction({
  repositoryPath,
  rawTurn,
  timeoutSeconds = 120,
  model,
  env = process.env,
  signal,
  modelRunner = runEphemeralStructuredModel,
}) {
  if (typeof rawTurn !== "string" || rawTurn.trim() === "") {
    fail("MH_READ_ONLY_INTERACTION_TURN", "read-only interaction requires a non-empty owner turn");
  }
  const snapshot = buildReadOnlyInteractionSnapshot(repositoryPath);
  const parent = fs.mkdtempSync(path.join(neutralInteractionTempBase(env), "meta-harness-interaction-"));
  const schemaPath = path.join(parent, "interaction.schema.json");
  const outputPath = path.join(parent, "interaction.output.json");
  try {
    const produced = await modelRunner({
      cwd: parent,
      prompt: buildReadOnlyInteractionPrompt(rawTurn, snapshot),
      outputSchema: READ_ONLY_INTERACTION_RESPONSE_SCHEMA,
      schemaPath,
      outputPath,
      timeoutSeconds,
      model,
      env: sanitizedModelEnv(env),
      outputCapBytes: 256 * 1024,
      codePrefix: "MH_READ_ONLY_INTERACTION",
      label: "read-only interaction responder",
      validate: validateReadOnlyInteractionResponse,
      skipGitRepoCheck: true,
      signal,
    });
    const validated = validateReadOnlyInteractionResponse(produced.result);
    return Object.freeze({
      schemaVersion: READ_ONLY_INTERACTION_SCHEMA_VERSION,
      answer: validated.answer,
    });
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
  }
}

async function runReadOnlyInteraction(options) {
  return answerReadOnlyInteraction({
    ...options,
    rawTurn: options?.rawTurn ?? options?.turn,
  });
}

module.exports = {
  READ_ONLY_INTERACTION_RESPONSE_SCHEMA,
  READ_ONLY_INTERACTION_SCHEMA_VERSION,
  READ_ONLY_INTERACTION_SNAPSHOT_SCHEMA_VERSION,
  answerReadOnlyInteraction,
  buildReadOnlyInteractionPrompt,
  buildReadOnlyInteractionSnapshot,
  runReadOnlyInteraction,
  validateReadOnlyInteractionResponse,
};
