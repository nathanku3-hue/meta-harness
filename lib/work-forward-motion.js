"use strict";

const fs = require("node:fs");
const { spawn } = require("node:child_process");

const { ConfigError } = require("./errors");
const { writeJsonAtomic } = require("./paths");
const { codingArgs, resolveCodingWorker } = require("./coding-worker");
const { OWNER_AUTHORITY_KINDS } = require("./work-forward-motion-record");

const FORWARD_MOTION_CANDIDATE_SCHEMA = Object.freeze({
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object",
  additionalProperties: false,
  required: ["disposition", "failedMeans", "alternatives", "hardConstraint", "ownerRequest", "disprovedAssertions"],
  properties: {
    disposition: { enum: ["CONTINUE_WITH_ALTERNATIVE", "REPLAN_REQUIRED", "HARD_BLOCKED", "OWNER_REQUIRED"] },
    failedMeans: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["means", "evidence"],
        properties: {
          means: { type: "string", minLength: 1 },
          evidence: { type: "array", minItems: 1, items: { type: "string", minLength: 1 } },
        },
      },
    },
    alternatives: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["means", "disposition", "evidence", "requiredPaths"],
        properties: {
          means: { type: "string", minLength: 1 },
          disposition: { enum: ["FAILED", "RULED_OUT", "AVAILABLE"] },
          evidence: { type: "array", minItems: 1, items: { type: "string", minLength: 1 } },
          requiredPaths: { type: "array", items: { type: "string", minLength: 1 } },
        },
      },
    },
    hardConstraint: { type: ["string", "null"] },
    ownerRequest: {
      anyOf: [
        { type: "null" },
        {
          type: "object",
          additionalProperties: false,
          required: ["kind", "question", "evidence"],
          properties: {
            kind: { enum: OWNER_AUTHORITY_KINDS },
            question: { type: "string", minLength: 1 },
            evidence: { type: "array", minItems: 1, items: { type: "string", minLength: 1 } },
          },
        },
      ],
    },
    disprovedAssertions: { type: "array", items: { type: "string", minLength: 1 } },
  },
});

function fail(code, message, details) {
  throw new ConfigError(message, { code, details });
}

function list(items) {
  return items.map((entry) => `- ${entry}`).join("\n");
}

function buildForwardMotionPrompt(session, workerStop) {
  return [
    "FORWARD_MOTION_CHALLENGE_V1",
    "Evaluate one durable worker STOP. You are a fresh read-only challenger, not a planner, worker, manager, or owner.",
    "Your job is to falsify the claim that autonomous forward motion is exhausted before allowing a hard stop or owner request.",
    "",
    "Owner-authored product direction:",
    session.productDirection.content,
    "",
    `Product result: ${session.productResult}`,
    `Journey state: ${session.journeyState}`,
    `Do now: ${session.doNow}`,
    `Done when: ${session.doneWhen}`,
    "Allowed paths:",
    list(session.allowedPaths),
    "Authorized reversible actions:",
    list(session.authorizedReversibleActions),
    "Owner-only actions:",
    list(session.ownerOnlyActions),
    "Stop conditions:",
    list(session.stopOnlyIf),
    "",
    "Exact durable worker STOP evidence:",
    JSON.stringify(workerStop.workerResult.stop, null, 2),
    "",
    "Constitutional laws:",
    "- Failed means is not failed Outcome.",
    "- Search for a concrete permissible substitute before confirming a terminal stop.",
    "- Arbitrary roles such as librarian, manager, review board, approver, or another model-invented authority are not owner authority.",
    `- OWNER_REQUIRED may use only: ${OWNER_AUTHORITY_KINDS.join(", ")}.`,
    "- CONTINUE_WITH_ALTERNATIVE means the substitute stays inside this exact sealed Outcome/session. Include every additionally required write path in requiredPaths; use [] if none are added.",
    "- REPLAN_REQUIRED means autonomous work should change decomposition; it is not an owner question.",
    "- HARD_BLOCKED requires current evidence of an Outcome-level constraint and no available substitute.",
    "- OWNER_REQUIRED requires a genuine owner-exclusive capability and no available substitute.",
    "- Record unsupported assertions in disprovedAssertions.",
    "- You have no execution permit, mutation authority, Git authority, publication authority, or owner authority.",
    "",
    "Return only the structured forward-motion candidate.",
  ].join("\n");
}

function parseCandidate(outputPath) {
  let value;
  try {
    value = JSON.parse(fs.readFileSync(outputPath, "utf8"));
  } catch (error) {
    fail("MH_FORWARD_MOTION_OUTPUT", `forward-motion challenger did not produce valid JSON: ${error.message}`);
  }
  return value;
}

function runForwardMotionChallenger({
  workspacePath,
  session,
  workerStop,
  schemaPath,
  outputPath,
  timeoutSeconds = 300,
  model,
  env = process.env,
}) {
  writeJsonAtomic(schemaPath, FORWARD_MOTION_CANDIDATE_SCHEMA);
  try {
    if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
  } catch (error) {
    fail("MH_FORWARD_MOTION_OUTPUT", `cannot reset forward-motion output path: ${error.message}`);
  }
  const prompt = buildForwardMotionPrompt(session, workerStop);
  const worker = resolveCodingWorker(env);
  const args = [...worker.prefixArgs, ...codingArgs({
    workspacePath,
    schemaPath,
    outputPath,
    prompt,
    model,
    pathStyle: worker.pathStyle || "native",
  })];
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    let bytes = 0;
    let timedOut = false;
    let settled = false;
    const child = spawn(worker.executable, args, {
      cwd: workspacePath,
      env: { ...env },
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      detached: process.platform !== "win32",
    });

    function terminate() {
      if (!child.pid) return;
      try {
        if (process.platform === "win32") {
          require("node:child_process").spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
            encoding: "utf8", windowsHide: true, timeout: 15_000,
          });
        } else process.kill(-child.pid, "SIGKILL");
      } catch {
        try { process.kill(child.pid, "SIGKILL"); } catch (_) {}
      }
    }

    const timer = setTimeout(() => { timedOut = true; terminate(); }, Math.max(1, timeoutSeconds) * 1000);
    function append(target, chunk) {
      const text = Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk);
      bytes += Buffer.byteLength(text);
      if (bytes > 4 * 1024 * 1024) terminate();
      return target + text;
    }
    child.stdout.on("data", (chunk) => { stdout = append(stdout, chunk); });
    child.stderr.on("data", (chunk) => { stderr = append(stderr, chunk); });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new ConfigError(`forward-motion challenger could not start: ${error.message}`, { code: "MH_FORWARD_MOTION_SPAWN" }));
    });
    child.on("close", (exitCode, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (timedOut) return reject(new ConfigError("forward-motion challenger timed out", { code: "MH_FORWARD_MOTION_TIMEOUT" }));
      if (bytes > 4 * 1024 * 1024) return reject(new ConfigError("forward-motion challenger exceeded output limit", { code: "MH_FORWARD_MOTION_OUTPUT_CAP" }));
      if (exitCode !== 0) {
        return reject(new ConfigError(
          `forward-motion challenger exited ${exitCode}${signal ? ` (${signal})` : ""}: ${stderr.trim().slice(-2000)}`,
          { code: "MH_FORWARD_MOTION_EXIT" },
        ));
      }
      try {
        resolve({ challenger: worker.identity, candidate: parseCandidate(outputPath), stdout, stderr });
      } catch (error) {
        reject(error);
      }
    });
  });
}

module.exports = {
  FORWARD_MOTION_CANDIDATE_SCHEMA,
  buildForwardMotionPrompt,
  runForwardMotionChallenger,
};
