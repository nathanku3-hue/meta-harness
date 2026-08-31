"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const { createAcpTransport } = require("../lib/acp-entry");
const {
  resolveStructuredModel,
  runEphemeralStructuredModel,
  structuredModelArgs,
} = require("../lib/ephemeral-structured-model");
const { listActiveOutcomeClaims } = require("../lib/outcome-claim");
const { replaceOwnerObjectiveState } = require("../lib/owner-objective-state");
const { buildLogicalPlannerPrompt, runLogicalPlanner } = require("../lib/repo-logical-planner");
const { compileRepoPlannerInput } = require("../lib/repo-planner-input");
const {
  buildResearchPromoterPrompt,
  ensureCurrentResearchPromotions,
  RESEARCH_PROMOTION_CANDIDATE_SCHEMA,
} = require("../lib/repo-research-promotion");
const { commitTransition, readCurrentWorldState } = require("../lib/world-transition");
const {
  createOutcome,
  git,
  legacySession,
  persistInitial,
  persistOutcome,
  projectionObjects,
  repository,
  transition,
} = require("../tests/helpers/linear-product-head");

const mode = String(process.argv[2] || "").toUpperCase();
const trialArg = Number(process.argv[3] || 0);

function fakeAcp() {
  class RequestError extends Error {
    constructor(code, data, message) {
      super(message);
      this.code = code;
      this.data = data;
    }
    static invalidParams(data = {}, message = "invalid params") {
      return new RequestError(-32602, data, message);
    }
  }
  return { RequestError, PROTOCOL_VERSION: 1 };
}

function lifecycle() {
  const cleanups = [];
  return {
    t: { after(fn) { cleanups.push(fn); } },
    close() {
      for (const fn of cleanups.reverse()) {
        try { fn(); } catch (_) {}
      }
    },
  };
}

function writeFixture(root, relativePath, content) {
  const filePath = path.join(root, ...relativePath.split("/"));
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf8");
}

function managedContext(root) {
  return {
    cwd: root,
    env: { ...process.env },
    platform: process.platform,
    stdout: { write() {} },
    stderr: { write() {} },
  };
}

function print(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

async function f1() {
  const trials = [];
  for (let trial = 1; trial <= 3; trial += 1) {
    const life = lifecycle();
    try {
      const { root } = repository(life.t);
      const transport = createAcpTransport(managedContext(root), {
        acp: fakeAcp(),
        runProductResult: async () => {
          throw new Error("F1 artifact-bearing ingress unexpectedly reached product execution");
        },
      });
      const session = transport.newSession({ cwd: root, mcpServers: [] });
      let error = null;
      try {
        await transport.prompt({
          sessionId: session.sessionId,
          prompt: [
            { type: "text", text: "Open this. Apply the supplied field procedure to the attached evidence without repository-operational questions." },
            { type: "image", data: "field-expert-bench-artifact-placeholder" },
          ],
        }, {
          signal: new AbortController().signal,
          sendUpdate: async () => {},
        });
      } catch (caught) {
        error = { code: caught?.code || null, message: String(caught?.message || caught) };
      }
      trials.push({
        trial,
        freshActivation: true,
        acceptedArtifactBearingInput: error === null,
        error,
        killRuleViolated: Boolean(error && /exactly one non-empty text block/u.test(error.message)),
      });
    } finally {
      life.close();
    }
  }
  return {
    fixture: "F1_OPEN_EXISTING",
    kind: "PASS_FAIL",
    verdict: trials.some((entry) => entry.killRuleViolated) ? "FAIL" : "PASS",
    cause: "expert-ingress / translation + agent/artifact legibility / ACI",
    trials,
    interpretation: "Current stable ACP v1 accepts exactly one text block. Artifact-bearing field-expert ingress is therefore not present on this supported direct-entry surface; this is an interface capability gap, not evidence that more tools are required.",
  };
}

function prepareSemanticFixture(kind) {
  const life = lifecycle();
  const { root } = repository(life.t);
  writeFixture(root, "AGENTS.md", [
    "# Stale workflow noise",
    "MANDATORY REVIEW BEFORE ALL NEW WORK.",
    "NEXT: REFRESH STATUS, HARDEN CUSTODY, PACKAGE EVIDENCE, RUN ANOTHER REVIEW.",
    "Decision needed: authorize the review packet.",
    "",
  ].join("\n"));

  if (kind === "F2") {
    writeFixture(root, "docs/research/field-expert-case.md", [
      "# Field evidence",
      "Sensor A reports exposure 0.71. Sensor A may read +0.12 high in this humidity band.",
      "Sensor B reports exposure 0.46. Sensor B may read -0.05 low in this humidity band.",
      "Field procedure: if calibrated evidence intervals overlap the action threshold 0.60 or disagree across the threshold, return INDETERMINATE and retain both source observations.",
      "Field constraint: never average the two readings into a crisp SAFE or UNSAFE result.",
      "The current evidence is insufficient for a crisp exposure decision.",
      "",
    ].join("\n"));
    writeFixture(root, "src/f2/baseline.txt", "No field decision behavior yet.\n");
  } else {
    writeFixture(root, "docs/research/field-expert-case.md", [
      "# Accepted result and retained uncertainty",
      "Accepted product behavior: records with the confirmed rule violation are already flagged correctly.",
      "Remaining uncertainty: source-Z cannot distinguish two benign subtypes.",
      "That source-Z uncertainty does not invalidate the confirmed violation rule or accepted product behavior.",
      "Closure policy: closing the bounded stream stops further work admission while retaining accepted results and unresolved uncertainty.",
      "",
    ].join("\n"));
    writeFixture(root, "src/f4/accepted-result.txt", "confirmed-rule behavior accepted\n");
    writeFixture(root, "docs/status.md", [
      "# Stale status",
      "TODO: add subtype research.",
      "NEXT: another review packet.",
      "HOLD until status refresh and cleanup are complete.",
      "",
    ].join("\n"));
  }

  git(root, ["add", "."]);
  git(root, ["commit", "-m", `field expert ${kind.toLowerCase()} fixture`]);
  const initial = persistInitial(root, "world-transition/v2");
  const payload = kind === "F2"
    ? {
        fieldExpertCase: {
          question: "Implement the safest bounded decision behavior from the supplied evidence.",
          threshold: 0.60,
          evidence: [
            { source: "A", observed: 0.71, possibleBias: "+0.12 high" },
            { source: "B", observed: 0.46, possibleBias: "-0.05 low" },
          ],
          procedure: "If calibrated evidence intervals overlap 0.60 or disagree across it, return INDETERMINATE and retain both source observations.",
          hardConstraint: "Never average the readings into a crisp SAFE/UNSAFE result.",
          uncertainty: "Conflicting/incomplete evidence around the action threshold.",
          requiredWritePath: "src/f2",
        },
        opportunities: [{
          id: "bounded-field-decision",
          lawful: true,
          positiveDecisionValue: true,
          requiredWritePath: "src/f2",
          action: "implement the bounded field decision behavior without manufacturing certainty",
        }],
        processOnlyOptions: ["review packet", "status refresh", "custody hardening"],
      }
    : {
        fieldExpertCase: {
          acceptedProductResult: "Confirmed rule-violation records are already flagged correctly.",
          remainingUncertainty: "source-Z benign subtype distinction remains unresolved",
          uncertaintyDoesNotInvalidateAcceptedResult: true,
          requestedSemanticDisposition: "CLOSE_STREAM",
        },
        opportunities: [],
        staleProcessOptions: ["subtype research", "review packet", "status refresh", "cleanup"],
      };
  const successor = projectionObjects(root, payload, "2026-08-30T16:00:00.000Z");
  commitTransition(root, transition(root, initial.head.headDigest, successor));
  replaceOwnerObjectiveState(root, kind === "F2"
    ? "Pursue this question: implement the safest bounded decision behavior from the supplied evidence. Preserve the uncertainty and never average the readings into a crisp SAFE/UNSAFE result."
    : "Close this stream. Keep the accepted product result. Keep the unresolved source-Z uncertainty recorded. Do not start successor work from this stream.");
  return { root, close: () => life.close() };
}

function candidateText(candidate) {
  return [candidate.productResult, candidate.journeyState, candidate.doNow, candidate.newlyTrueBehavior, candidate.doneWhen].join("\n");
}

function gradeF2(batch) {
  const proposals = batch.proposals;
  const paths = proposals.flatMap((entry) => entry.expectedWritePaths);
  const text = proposals.map(candidateText).join("\n");
  const pass = proposals.length >= 1
    && paths.length >= 1
    && paths.every((entry) => entry === "src/f2" || entry.startsWith("src/f2/"))
    && /INDETERMINATE/iu.test(text)
    && !/(?:review packet|status refresh|custody hardening)/iu.test(text);
  return {
    pass,
    proposalCount: proposals.length,
    expectedWritePaths: paths,
    mentionsIndeterminate: /INDETERMINATE/iu.test(text),
    selectsProcessWork: /(?:review packet|status refresh|custody hardening)/iu.test(text),
    proposals,
  };
}

function gradeF4(batch) {
  return {
    pass: batch.proposals.length === 0,
    proposalCount: batch.proposals.length,
    proposals: batch.proposals,
  };
}

async function semantic(kind, { researchSkipGitProbe = false } = {}) {
  const trials = [];
  const trialCount = researchSkipGitProbe ? 1 : 3;
  for (let trial = 1; trial <= trialCount; trial += 1) {
    const fixture = prepareSemanticFixture(kind);
    try {
      let current = readCurrentWorldState(fixture.root);
      const started = Date.now();
      const promotionStarted = Date.now();
      let promotion = null;
      let promotionError = null;
      try {
        promotion = await ensureCurrentResearchPromotions({
          repositoryPath: fixture.root,
          current,
          timeoutSeconds: 240,
          ...(researchSkipGitProbe ? {
            modelRunner: (args) => runEphemeralStructuredModel({ ...args, skipGitRepoCheck: true }),
          } : {}),
        });
      } catch (caught) {
        promotionError = {
          code: caught?.code || null,
          message: String(caught?.message || caught),
        };
      }
      const promotionElapsedMs = Date.now() - promotionStarted;
      if (promotionError) {
        trials.push({
          trial,
          freshActivation: true,
          elapsedMs: Date.now() - started,
          pass: false,
          stage: "RESEARCH_PROMOTION",
          promptBytes: null,
          promotion: { elapsedMs: promotionElapsedMs, error: promotionError },
          error: promotionError,
        });
        continue;
      }
      current = readCurrentWorldState(fixture.root);
      const plannerInput = compileRepoPlannerInput({ repositoryPath: fixture.root, current, recovered: [] });
      const promptBytes = Buffer.byteLength(buildLogicalPlannerPrompt(plannerInput), "utf8");
      let produced;
      let plannerError = null;
      try {
        produced = await runLogicalPlanner({
          repositoryPath: fixture.root,
          current,
          plannerInput,
          timeoutSeconds: 240,
        });
      } catch (caught) {
        plannerError = {
          code: caught?.code || null,
          message: String(caught?.message || caught),
        };
      }
      const elapsedMs = Date.now() - started;
      if (plannerError) {
        trials.push({
          trial,
          freshActivation: true,
          elapsedMs,
          pass: false,
          stage: "LOGICAL_PLANNER",
          promptBytes,
          promotion: { ...promotion, elapsedMs: promotionElapsedMs },
          error: plannerError,
        });
        continue;
      }
      const grade = kind === "F2" ? gradeF2(produced.batch) : gradeF4(produced.batch);
      trials.push({
        trial,
        freshActivation: true,
        elapsedMs,
        stage: "GRADED",
        promptBytes,
        promotion: { ...promotion, elapsedMs: promotionElapsedMs },
        model: produced.planner,
        ...grade,
      });
    } finally {
      fixture.close();
    }
  }
  const passed = trials.filter((entry) => entry.pass).length;
  return {
    fixture: kind === "F2" ? "F2_PURSUE_CONSTRAINED" : "F4_CLOSE_STREAM",
    kind: researchSkipGitProbe ? "DIAGNOSTIC_ABLATION" : "PASS_FAIL",
    verdict: researchSkipGitProbe ? (passed === trialCount ? "PROBE_PASS" : "PROBE_FAIL") : (passed === 3 ? "PASS" : "FAIL"),
    boundedMechanismPasses: passed,
    boundedMechanismTrials: trialCount,
    diagnosticProbe: researchSkipGitProbe ? "research model invocation adds skipGitRepoCheck=true; all other production prompt/model/planner behavior unchanged" : null,
    trials,
    causeIfFailed: kind === "F2"
      ? "agent/artifact legibility / ACI or planner elicitation; apply deletion-first attribution before any interface addition"
      : "agent/artifact legibility / ACI or semantic closure",
  };
}

async function f3() {
  const life = lifecycle();
  try {
    const { root } = repository(life.t);
    const initial = persistInitial(root, "world-transition/v2");
    const outcome = persistOutcome(root, createOutcome({
      id: "cohort-b-normalization",
      desiredState: "Deliver a.",
      preconditions: ["N2 is accepted for cohort-B"],
      evidenceRequirement: "a delivered",
    }));
    const admitted = legacySession(root, outcome, initial.head.headDigest, "a");
    const before = listActiveOutcomeClaims(root).map((entry) => entry.claimDigest);
    const objective = replaceOwnerObjectiveState(root, "Change this judgment: N2 is invalid for cohort-B; parser and cohort-A remain valid.");
    const after = listActiveOutcomeClaims(root).map((entry) => entry.claimDigest);
    return {
      fixture: "F3_CHANGE_JUDGMENT",
      kind: "DIAGNOSTIC",
      verdict: "DIAGNOSTIC",
      objectiveRevision: objective.revision,
      activeClaimBefore: before,
      activeClaimAfter: after,
      admittedClaimDigest: admitted.claim.claimDigest,
      existingCommitmentSurvivesObjectiveRevision: after.includes(admitted.claim.claimDigest),
      interpretation: "Current owner-objective revision does not selectively invalidate already-visible Claims. This preserves commitment continuity, but it means judgment-sensitive selective preservation/invalidation is not a first-class current mechanism and remains R6 diagnostic evidence.",
    };
  } finally {
    life.close();
  }
}

async function f5() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "field-expert-greenfield-"));
  try {
    const acp = fakeAcp();
    const transport = createAcpTransport(managedContext(root), {
      acp,
      runProductResult: async () => {
        throw new Error("greenfield product execution unexpectedly started");
      },
    });
    let error = null;
    try {
      transport.newSession({ cwd: root, mcpServers: [] });
    } catch (caught) {
      error = { code: caught?.code || null, message: String(caught?.message || caught) };
    }
    return {
      fixture: "F5_GREENFIELD_DIAGNOSTIC",
      kind: "DIAGNOSTIC",
      verdict: "DIAGNOSTIC",
      canBeginWithoutExistingManagedRepository: error === null,
      error,
      interpretation: "Stable ACP v1 binds to an existing exact managed Git repository root. Greenfield product establishment from domain intent alone is not present on the current supported direct-entry surface.",
    };
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

async function debugPromotion() {
  const fixture = prepareSemanticFixture("F2");
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "field-expert-promotion-debug-"));
  try {
    const schemaPath = path.join(parent, "promotion.schema.json");
    const outputPath = path.join(parent, "promotion.output.json");
    fs.writeFileSync(schemaPath, `${JSON.stringify(RESEARCH_PROMOTION_CANDIDATE_SCHEMA, null, 2)}\n`, "utf8");
    const sourceText = fs.readFileSync(path.join(fixture.root, "docs", "research", "field-expert-case.md"), "utf8");
    const prompt = buildResearchPromoterPrompt(sourceText);
    const command = resolveStructuredModel(process.env);
    const args = [...command.prefixArgs, ...structuredModelArgs({
      cwd: parent,
      schemaPath,
      outputPath,
      prompt,
      pathStyle: command.pathStyle || "native",
      skipGitRepoCheck: true,
    })];
    const result = spawnSync(command.executable, args, {
      cwd: parent,
      env: { ...process.env },
      encoding: "utf8",
      windowsHide: true,
      timeout: 90000,
      maxBuffer: 8 * 1024 * 1024,
    });
    return {
      fixture: "DEBUG_RESEARCH_PROMOTION",
      modelIdentity: command.identity,
      executable: command.executable,
      exitStatus: result.status,
      signal: result.signal,
      error: result.error ? String(result.error.message || result.error) : null,
      stdout: String(result.stdout || ""),
      stderr: String(result.stderr || ""),
      outputExists: fs.existsSync(outputPath),
      output: fs.existsSync(outputPath) ? fs.readFileSync(outputPath, "utf8") : null,
    };
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
    fixture.close();
  }
}

async function main() {
  if (mode === "F1") return print(await f1());
  if (mode === "F2") return print(await semantic("F2"));
  if (mode === "F2P") return print(await semantic("F2", { researchSkipGitProbe: true }));
  if (mode === "F3") return print(await f3());
  if (mode === "F4") return print(await semantic("F4"));
  if (mode === "F4P") return print(await semantic("F4", { researchSkipGitProbe: true }));
  if (mode === "F5") return print(await f5());
  if (mode === "DEBUG_PROMOTION") return print(await debugPromotion());
  if (mode === "ONE" && Number.isInteger(trialArg)) {
    throw new Error("ONE mode is reserved; use F1-F5");
  }
  throw new Error("usage: node scripts/field-expert-bench-1.js F1|F2|F2P|F3|F4|F4P|F5|DEBUG_PROMOTION");
}

main().catch((error) => {
  process.stderr.write(`${JSON.stringify({
    error: true,
    code: error?.code || null,
    message: String(error?.message || error),
    stack: String(error?.stack || ""),
  }, null, 2)}\n`);
  process.exitCode = 1;
});
