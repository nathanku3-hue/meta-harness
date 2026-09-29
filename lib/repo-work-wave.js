"use strict";

const {
  findExecutionClosureForOrigin,
  readExecutionWorkResult,
  recoverExecutionClosure,
} = require("./execution-closure");
const {
  createExternalProposalRunner,
  extractInternalDevSpaceProposalHost,
  reconcileProposalDispatch,
} = require("./devspace-proposal-host");
const { ConfigError } = require("./errors");
const { clearOwnerObjectiveState, currentOwnerObjectiveRevision } = require("./owner-objective-state");
const { initializeIntegrationHead, readIntegrationHead } = require("./optimistic-integration");
const {
  appendRunEvent,
  listRunSessions,
  readRunEventsForSession,
  readRunJournal,
  runIdForSession,
} = require("./run-journal");
const {
  discardProductIntegration,
  finalizeProductIntegration,
  prepareProductIntegration,
  publishProductIntegration,
} = require("./repo-product-integration");
const { runLogicalPlanner } = require("./repo-logical-planner");
const {
  materializePreparedPlannerRun,
  preparePlannerCandidate,
  validatePlannerCandidateBatch,
} = require("./repo-planner-candidate");
const { compileRepoPlannerInput } = require("./repo-planner-input");
const {
  ensureCurrentResearchPromotions,
  projectCurrentPromotedResearch,
} = require("./repo-research-promotion");
const {
  assertProposalDispatchReceiptBinding,
  assertProposalDispatchResultBinding,
  assertRecoveredProposalDispatchBinding,
  readProposalDispatchIntent,
  readProposalDispatchReceipt,
  readProposalDispatchResult,
} = require("./proposal-dispatch");
const {
  captureWorkspaceBoundary,
  commonGitDirectory,
  recoverBankedExecutionResult,
  resolveActiveWorkspaceContinuation,
  runGit,
  runWorkSessionState,
  workspaceRegistryDirectory,
} = require("./work-git");
const { DRAIN_COMPLETE, runWork } = require("./work-loop");
const { readWorkspaceCustody } = require("./workspace-custody");
const {
  REPO_WORK_WAVE_TELEMETRY_SCHEMA,
  buildRepoWorkWaveTelemetry,
  executionTelemetry,
  isoTime,
} = require("./repo-work-wave-telemetry");

const DEFAULT_LOCAL_EXECUTION_BOUND = 2;
const MAX_LOCAL_EXECUTION_BOUND = 8;
const MAX_LANDING_ATTEMPTS = 3;

function fail(code, message, details) {
  throw new ConfigError(message, { code, details });
}

function localExecutionBound(env = process.env) {
  const raw = env.META_HARNESS_REPO_WORK_CONCURRENCY;
  if (raw === undefined || raw === "") return DEFAULT_LOCAL_EXECUTION_BOUND;
  const parsed = Number.parseInt(String(raw), 10);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_LOCAL_EXECUTION_BOUND) {
    fail("MH_REPO_WORK_CONCURRENCY", `META_HARNESS_REPO_WORK_CONCURRENCY must be an integer from 1 to ${MAX_LOCAL_EXECUTION_BOUND}`);
  }
  return parsed;
}

function ensureProductHead(repositoryPath) {
  const current = readIntegrationHead(repositoryPath, { optional: true });
  if (current) return current;
  const baseCommit = String(runGit(repositoryPath, ["rev-parse", "--verify", "HEAD^{commit}"]).stdout || "").trim();
  const initialized = initializeIntegrationHead({ repositoryPath, baseCommit });
  if (!["INITIALIZED", "READY"].includes(initialized.state)) {
    fail("MH_PRODUCT_HEAD_INIT", "Git product head could not be initialized from the current immutable checkout", initialized);
  }
  return initialized.observedHead;
}

function runKey(entry) {
  return entry.runKey || entry.session?.sessionDigest || entry.closure?.sessionDigest || null;
}

function settledEvent(events) {
  return [...events].reverse().find((event) => event.type === "run/settled") || null;
}

function integratedEvent(events) {
  return [...events].reverse().find((event) => event.type === "integration/result"
    && ["LANDED", "ALREADY_LANDED", "APPLIED", "ALREADY_APPLIED"].includes(event.data?.status)) || null;
}

function recoverRunCommitment(repositoryPath, session, { now = new Date() } = {}) {
  if (session?.origin?.type !== "REPO_RUN") {
    fail("MH_RUN_RECOVERY", "run recovery requires a current REPO_RUN session");
  }
  const key = session.sessionDigest;
  const outcomeDigest = session.origin.outcomeDigest;
  const existingClosure = findExecutionClosureForOrigin(repositoryPath, session.origin);
  if (existingClosure
      && !(existingClosure.disposition === "INTERRUPTED_AFTER_ENTRY"
        && existingClosure.workResultDigest === null)) {
    return Object.freeze({ type: "CLOSURE", runKey: key, session, outcomeDigest, closure: existingClosure });
  }

  const state = runWorkSessionState(repositoryPath, session);
  if (state.state === "PENDING") {
    return Object.freeze({
      type: "EXECUTABLE",
      runKey: key,
      session: state.session,
      outcomeDigest,
      continuation: "PENDING_WORKSPACE",
    });
  }

  if (state.state === "ACTIVE") {
    const registryDir = workspaceRegistryDirectory(repositoryPath);
    const custody = readWorkspaceCustody(registryDir, state.workspaceId);
    const continuation = resolveActiveWorkspaceContinuation(repositoryPath, state.session, custody);
    if (continuation.kind === "ENTERED_NO_SEAL") {
      const intent = readProposalDispatchIntent({
        workspaceRegistryDir: registryDir,
        workspaceId: state.workspaceId,
        generation: custody.generation,
        optional: true,
      });
      if (intent) {
        const boundary = captureWorkspaceBoundary(custody.workspacePath, state.session.allowedPaths);
        const validatedIntent = assertRecoveredProposalDispatchBinding({
          intent,
          session: state.session,
          custody,
          attemptEntry: continuation.attemptEntry,
          boundary,
        });
        const receipt = readProposalDispatchReceipt({
          workspaceRegistryDir: registryDir,
          workspaceId: state.workspaceId,
          generation: custody.generation,
          optional: true,
        });
        const validatedReceipt = assertProposalDispatchReceiptBinding(validatedIntent, receipt);
        const result = readProposalDispatchResult({
          workspaceRegistryDir: registryDir,
          workspaceId: state.workspaceId,
          generation: custody.generation,
          optional: true,
        });
        if (result) {
          assertProposalDispatchResultBinding(validatedIntent, validatedReceipt, result);
          return Object.freeze({
            type: "EXECUTABLE",
            runKey: key,
            session: state.session,
            outcomeDigest,
            continuation: "EXTERNAL_RESULT_READY",
          });
        }
        return Object.freeze({
          type: "EXTERNAL_OPEN",
          runKey: key,
          session: state.session,
          outcomeDigest,
          workspaceId: state.workspaceId,
          intent: validatedIntent,
          receipt: validatedReceipt,
        });
      }
      const closure = recoverExecutionClosure(repositoryPath, state.session, now, {
        workResult: null,
        workspaceId: state.workspaceId,
      });
      if (!closure) fail("MH_EXECUTION_CLOSURE_MISSING", "entered run has no recoverable execution closure");
      return Object.freeze({ type: "CLOSURE", runKey: key, session: state.session, outcomeDigest, closure });
    }
    return Object.freeze({
      type: "EXECUTABLE",
      runKey: key,
      session: state.session,
      outcomeDigest,
      continuation: continuation.kind,
    });
  }

  if (state.state === "TERMINAL") {
    const workResult = recoverBankedExecutionResult({
      repositoryPath,
      sessionDigest: state.session.sessionDigest,
      workspaceId: state.workspaceId,
    });
    const closure = recoverExecutionClosure(repositoryPath, state.session, now, {
      workResult,
      workspaceId: state.workspaceId,
    });
    if (!closure) fail("MH_EXECUTION_CLOSURE_MISSING", "terminal run has no recoverable execution closure");
    return Object.freeze({ type: "CLOSURE", runKey: key, session: state.session, outcomeDigest, closure });
  }

  fail("MH_RUN_RECOVERY", `unsupported run state: ${state.state}`);
}

function recoverPlannerContext(repositoryPath, now, { runningRunKeys = new Set() } = {}) {
  const gitCommonDirectory = commonGitDirectory(repositoryPath);
  const recovered = [];
  for (const session of listRunSessions({ gitCommonDirectory })) {
    if (session.origin?.type !== "REPO_RUN") continue;
    const events = readRunEventsForSession({ gitCommonDirectory, sessionDigest: session.sessionDigest });
    if (integratedEvent(events) || settledEvent(events)) continue;
    if (runningRunKeys.has(session.sessionDigest)) {
      recovered.push(Object.freeze({
        type: "RUNNING_ELSEWHERE",
        runKey: session.sessionDigest,
        session,
        outcomeDigest: session.origin.outcomeDigest,
      }));
      continue;
    }
    recovered.push(recoverRunCommitment(repositoryPath, session, { now: now() }));
  }
  const unique = new Map();
  for (const entry of recovered) {
    const key = runKey(entry);
    if (key && !unique.has(key)) unique.set(key, entry);
  }
  return Object.freeze([...unique.values()].sort((left, right) => runKey(left).localeCompare(runKey(right))));
}

function recoverRepositoryCommitments(repositoryPath, { now = () => new Date() } = {}) {
  ensureProductHead(repositoryPath);
  return recoverPlannerContext(repositoryPath, now);
}

function settledObservations(repositoryPath) {
  const gitCommonDirectory = commonGitDirectory(repositoryPath);
  const observations = [];
  for (const session of listRunSessions({ gitCommonDirectory })) {
    if (session.origin?.type !== "REPO_RUN") continue;
    const events = readRunEventsForSession({ gitCommonDirectory, sessionDigest: session.sessionDigest });
    const settled = settledEvent(events);
    if (!settled) continue;
    observations.push(Object.freeze({
      sessionDigest: session.sessionDigest,
      outcomeDigest: session.origin.outcomeDigest,
      productResult: session.productResult,
      outcome: settled.data?.outcome || null,
      observableResult: settled.data?.observableResult || null,
      blocker: settled.data?.blocker || null,
      failedMeans: Object.freeze([...(settled.data?.failedMeans || [])]),
      at: settled.at,
    }));
  }
  return Object.freeze(observations
    .sort((left, right) => Date.parse(left.at) - Date.parse(right.at)
      || left.sessionDigest.localeCompare(right.sessionDigest))
    .slice(-24));
}

function plannerBatch(value) {
  return validatePlannerCandidateBatch(value?.batch || value);
}

function planningEpochKey(productCommit, objectiveRevision, observations) {
  if (!/^[a-f0-9]{40,64}$/u.test(String(productCommit || ""))
      || !Number.isInteger(objectiveRevision) || objectiveRevision < 0) {
    fail("MH_REPO_PLANNING_EPOCH", "planning epoch requires a Git product commit and non-negative objective revision");
  }
  const observationKey = observations.map((entry) => `${entry.sessionDigest}:${entry.outcome}`).join(",");
  return `${productCommit}\u001f${objectiveRevision}\u001f${observationKey}`;
}

function candidateCompilationRejected(error) {
  const code = String(error?.code || "");
  return code.startsWith("MH_PLANNER_CANDIDATE_")
    || code.startsWith("MH_PLANNER_BOUNDARY_")
    || code === "MH_PLANNER_VALIDATION_UNAVAILABLE";
}

function appendRunEventOnce({ gitCommonDirectory, runId, type, matches, data, now }) {
  const existing = readRunJournal({ gitCommonDirectory, runId })
    .find((event) => event.type === type && matches(event));
  if (existing) return existing;
  return appendRunEvent({ gitCommonDirectory, runId, type, data, now });
}

function settleRun(repositoryPath, session, data, now) {
  return appendRunEventOnce({
    gitCommonDirectory: commonGitDirectory(repositoryPath),
    runId: runIdForSession(session.sessionDigest),
    type: "run/settled",
    matches: () => true,
    data: {
      sessionDigest: session.sessionDigest,
      outcomeDigest: session.origin.outcomeDigest,
      ...data,
    },
    now,
  });
}

function directRepairCandidate(session) {
  return {
    id: `repair-${session.origin.outcomeDigest.slice("sha256:".length, "sha256:".length + 16)}`,
    productResult: session.productResult,
    journeyState: session.journeyState,
    doNow: session.doNow,
    newlyTrueBehavior: session.newlyTrueBehavior,
    doneWhen: session.doneWhen,
    stopOnlyIf: [...session.stopOnlyIf],
    expectedWritePaths: [...session.allowedPaths],
  };
}

function repairDepth(repositoryPath, session) {
  return listRunSessions({ gitCommonDirectory: commonGitDirectory(repositoryPath) })
    .filter((candidate) => candidate.origin?.type === "REPO_RUN"
      && candidate.origin.outcomeDigest === session.origin.outcomeDigest
      && candidate.origin.objectiveRevision === session.origin.objectiveRevision)
    .length;
}

function scheduleIntegrationRepair(repositoryPath, session, reason, detail, now) {
  if (currentOwnerObjectiveRevision(repositoryPath) !== session.origin.objectiveRevision) return null;
  if (repairDepth(repositoryPath, session) >= MAX_LANDING_ATTEMPTS) return null;
  const productCommit = readIntegrationHead(repositoryPath);
  const prepared = preparePlannerCandidate(
    repositoryPath,
    null,
    directRepairCandidate(session),
    { expectedProductCommit: productCommit },
  );
  const materializedRun = materializePreparedPlannerRun(repositoryPath, null, prepared, {
    now: now(),
    objectiveRevision: session.origin.objectiveRevision,
    outcomeDigest: session.origin.outcomeDigest,
  });
  appendRunEvent({
    gitCommonDirectory: commonGitDirectory(repositoryPath),
    runId: runIdForSession(materializedRun.session.sessionDigest),
    type: "integration/repair-context",
    data: {
      predecessorSessionDigest: session.sessionDigest,
      successorSessionDigest: materializedRun.session.sessionDigest,
      outcomeDigest: session.origin.outcomeDigest,
      reason,
      detail,
      productCommit,
    },
    now: now(),
  });
  return materializedRun;
}

function workResultForClosure(repositoryPath, closure) {
  if (!closure.workResultDigest) return null;
  const record = readExecutionWorkResult(repositoryPath, closure.workResultDigest);
  if (record.workResultDigest !== closure.workResultDigest) {
    fail("MH_RUN_RECOVERY", "closure work result does not resolve exactly");
  }
  return record.result;
}

function failedMeansForResult(result) {
  if (!result) return [];
  const values = [];
  if (result.blocker && result.blocker !== "none") values.push(String(result.blocker));
  if (result.nextAction && result.outcome !== "DONE") values.push(String(result.nextAction));
  return [...new Set(values)];
}

function settleClosure({ repositoryPath, entry, now, env }) {
  const result = workResultForClosure(repositoryPath, entry.closure);
  if (!result || result.outcome !== "DONE") {
    const outcome = result?.outcome || "EXECUTION_ABORTED";
    settleRun(repositoryPath, entry.session, {
      outcome,
      observableResult: result?.observableResult || null,
      blocker: result?.blocker || (result ? null : "Execution ended before a durable validated result was produced."),
      failedMeans: failedMeansForResult(result),
    }, now());
    return Object.freeze({
      runKey: entry.runKey,
      outcomeDigest: entry.outcomeDigest,
      desiredState: entry.session.productResult,
      state: outcome === "EXECUTION_ABORTED" ? "EXECUTION_ABORTED" : "REPLAN_REQUIRED",
      observableResult: result?.observableResult || null,
      blocker: result?.blocker || null,
    });
  }

  for (let attempt = 1; attempt <= MAX_LANDING_ATTEMPTS; attempt += 1) {
    const predecessorProductCommit = readIntegrationHead(repositoryPath);
    const candidate = prepareProductIntegration({
      repositoryPath,
      predecessorProductCommit,
      currentHead: null,
      closure: entry.closure,
      workResult: { result, workResultDigest: entry.closure.workResultDigest },
      now: now(),
      env,
    });
    if (candidate.status !== "ACCEPTED") {
      const detail = candidate.detail || "validated candidate could not be integrated into the current product tree";
      discardProductIntegration(candidate);
      const repair = scheduleIntegrationRepair(repositoryPath, entry.session, candidate.reason, detail, now);
      settleRun(repositoryPath, entry.session, {
        outcome: "REPLAN_REQUIRED",
        observableResult: result.observableResult || null,
        blocker: `${candidate.reason}: ${detail}`,
        failedMeans: [`integration:${candidate.reason}`],
        repairSessionDigest: repair?.session?.sessionDigest || null,
      }, now());
      return Object.freeze({
        runKey: entry.runKey,
        outcomeDigest: entry.outcomeDigest,
        desiredState: entry.session.productResult,
        state: "REPLAN_REQUIRED",
        observableResult: result.observableResult || null,
        blocker: detail,
        repairSessionDigest: repair?.session?.sessionDigest || null,
      });
    }

    const published = publishProductIntegration(candidate);
    if (["LANDED", "ALREADY_LANDED"].includes(published.state)) {
      finalizeProductIntegration(candidate, candidate.receipt.integratedCommit);
      return Object.freeze({
        runKey: entry.runKey,
        outcomeDigest: entry.outcomeDigest,
        desiredState: entry.session.productResult,
        state: "LANDED",
        observableResult: result.observableResult || null,
        productCommit: candidate.receipt.integratedCommit,
        integrationDigest: candidate.receipt.integrationDigest,
      });
    }
    discardProductIntegration(candidate);
    if (published.state !== "CONFLICT" || attempt === MAX_LANDING_ATTEMPTS) {
      const detail = `Git product head changed during integration (expected ${published.expectedHead}, observed ${published.observedHead}).`;
      const repair = scheduleIntegrationRepair(repositoryPath, entry.session, "GIT_CAS_CONFLICT", detail, now);
      settleRun(repositoryPath, entry.session, {
        outcome: "REPLAN_REQUIRED",
        observableResult: result.observableResult || null,
        blocker: detail,
        failedMeans: ["integration:GIT_CAS_CONFLICT"],
        repairSessionDigest: repair?.session?.sessionDigest || null,
      }, now());
      return Object.freeze({
        runKey: entry.runKey,
        outcomeDigest: entry.outcomeDigest,
        desiredState: entry.session.productResult,
        state: "REPLAN_REQUIRED",
        observableResult: result.observableResult || null,
        blocker: detail,
        repairSessionDigest: repair?.session?.sessionDigest || null,
      });
    }
  }
  fail("MH_PRODUCT_HEAD_CONFLICT", "bounded Git CAS integration retries were exhausted");
}

function launchSessionExecution(repositoryPath, item, options = {}) {
  const { telemetryClock = Date.now, onSettlement = () => {}, ...workOptions } = options;
  const dispatchedMs = telemetryClock();
  const promise = (async () => {
    try {
      const result = await runWork({
        repositoryPath,
        session: item.session,
        ...workOptions,
        initialPriorFailure: item.priorFailure || "",
      });
      const settlement = { item, status: "fulfilled", result, dispatchedMs, completedMs: telemetryClock() };
      onSettlement(settlement);
      return settlement;
    } catch (error) {
      const settlement = { item, status: "rejected", error, dispatchedMs, completedMs: telemetryClock() };
      onSettlement(settlement);
      return settlement;
    }
  })();
  return { promise, dispatchedMs };
}

function repairContextForSession(repositoryPath, session) {
  const events = readRunEventsForSession({
    gitCommonDirectory: commonGitDirectory(repositoryPath),
    sessionDigest: session.sessionDigest,
  });
  return [...events].reverse().find((event) => event.type === "integration/repair-context") || null;
}

function startRecoverableCommitments({
  repositoryPath,
  recovered,
  running,
  bound,
  proposalIdByRun,
  telemetryClock,
  onSettlement,
  workOptions,
  signal,
}) {
  let recoveredStarted = 0;
  for (const entry of recovered) {
    if (running.size >= bound || signal?.aborted) break;
    const key = runKey(entry);
    if (entry.type !== "EXECUTABLE" || !key || running.has(key)) continue;
    const proposalId = proposalIdByRun.get(key) || null;
    const context = repairContextForSession(repositoryPath, entry.session);
    const item = {
      runKey: key,
      outcomeDigest: entry.outcomeDigest,
      session: entry.session,
      source: proposalId ? "NEW" : "RECOVERED",
      proposalId,
      priorFailure: context
        ? `Previous integration against the current product state failed (${context.data.reason}): ${context.data.detail}. Repair the same product result while preserving already-landed behavior.`
        : "",
    };
    const launched = launchSessionExecution(repositoryPath, item, {
      ...workOptions,
      telemetryClock,
      onSettlement,
    });
    running.set(key, launched.promise);
    if (!proposalId) recoveredStarted += 1;
  }
  return recoveredStarted;
}

function collectSettledExecutions(running, executionByRun, executions, recorded) {
  for (const key of [...running.keys()]) {
    const settlement = executionByRun.get(key);
    if (!settlement) continue;
    running.delete(key);
    if (!recorded.has(key)) {
      recorded.add(key);
      executions.push(settlement);
    }
  }
}

function planningResultKey(productCommit, objectiveRevision, observations) {
  return planningEpochKey(productCommit, objectiveRevision, observations);
}

async function planCurrentProduct({
  repositoryPath,
  recovered,
  observations,
  env,
  model,
  timeoutSeconds,
  plannerRunner,
  researchModelRunner,
  telemetryClock,
  signal,
  now,
}) {
  const startedMs = telemetryClock();
  const productCommit = readIntegrationHead(repositoryPath);
  await ensureCurrentResearchPromotions({
    repositoryPath,
    timeoutSeconds,
    model,
    env,
    signal,
    ...(researchModelRunner ? { modelRunner: researchModelRunner } : {}),
  });
  const evidence = projectCurrentPromotedResearch({ repositoryPath, productCommit });
  const input = compileRepoPlannerInput({ repositoryPath, recovered, observations, evidence });
  const produced = await plannerRunner({
    repositoryPath,
    current: null,
    plannerInput: input,
    timeoutSeconds,
    model,
    env,
    signal,
  });
  const batch = plannerBatch(produced);
  const objectiveRevision = input.ownerIntent.activeDirective?.revision || 0;
  const activeOutcomeDigests = new Set(recovered.map((entry) => entry.outcomeDigest).filter(Boolean));
  const materializedRuns = [];
  const candidateRejections = [];
  let staleProductHead = false;
  let staleObjective = false;

  for (const candidate of batch.proposals) {
    try {
      const prepared = preparePlannerCandidate(repositoryPath, null, candidate, {
        expectedProductCommit: input.product.commit,
      });
      if (activeOutcomeDigests.has(prepared.outcome.outcomeDigest)) {
        candidateRejections.push({ candidateId: candidate.id, code: "MH_PLANNER_CANDIDATE_ACTIVE" });
        continue;
      }
      const materializedRun = materializePreparedPlannerRun(repositoryPath, null, prepared, {
        now: now(),
        objectiveRevision,
      });
      materializedRuns.push({ candidate, materializedRun });
      activeOutcomeDigests.add(materializedRun.outcomeDigest);
    } catch (error) {
      if (candidateCompilationRejected(error)) {
        candidateRejections.push({ candidateId: candidate.id, code: String(error.code) });
        continue;
      }
      if (error?.code === "MH_OWNER_OBJECTIVE_STALE") {
        staleObjective = true;
        candidateRejections.push({ candidateId: candidate.id, code: String(error.code) });
        break;
      }
      if (error?.code === "MH_PLANNER_PRODUCT_HEAD_STALE") {
        staleProductHead = true;
        candidateRejections.push({ candidateId: candidate.id, code: String(error.code) });
        break;
      }
      throw error;
    }
  }
  const completedMs = telemetryClock();
  return Object.freeze({
    productCommit: input.product.commit,
    objectiveRevision,
    epochKey: planningResultKey(input.product.commit, objectiveRevision, observations),
    startedMs,
    completedMs,
    candidateCount: batch.proposals.length,
    materializedCount: materializedRuns.length,
    materializedRuns: Object.freeze(materializedRuns),
    candidateRejections: Object.freeze(candidateRejections),
    staleProductHead,
    staleObjective,
  });
}

function resultOutcome(states, { noCandidates, activeCount }) {
  if (states.some((entry) => entry.state === "LANDED")) {
    if (activeCount > 0 || !noCandidates) return "PARTIAL";
    return "DONE";
  }
  if (activeCount > 0) return "PARTIAL";
  if (noCandidates) return "USE_PRODUCT";
  return "REPLAN_REQUIRED";
}

async function runRepoWorkWave({
  repositoryPath,
  env = process.env,
  model,
  timeoutSeconds,
  runner,
  plannerRunner = runLogicalPlanner,
  researchModelRunner,
  proposalHost = null,
  onProgress = () => {},
  now = () => new Date(),
  telemetryClock = Date.now,
  signal,
} = {}) {
  if (signal?.aborted) return DRAIN_COMPLETE;
  ensureProductHead(repositoryPath);

  const internalProposalCapability = extractInternalDevSpaceProposalHost(env);
  if (proposalHost && internalProposalCapability.proposalHost) {
    fail("MH_PROPOSAL_HOST_CONFLICT", "repo work received both an injected proposal host and an internal DevSpace bridge capability");
  }
  proposalHost = proposalHost || internalProposalCapability.proposalHost;
  env = internalProposalCapability.modelEnv;

  const bound = localExecutionBound(env);
  const reconciliationStartedMs = telemetryClock();
  const entryProductCommit = readIntegrationHead(repositoryPath);
  const running = new Map();
  const executionByRun = new Map();
  const recordedExecutions = new Set();
  const executions = [];
  const proposalIdByRun = new Map();
  const plannerResults = new Map();
  const plannedEpochs = new Set();
  const states = new Map();
  const candidateRejections = [];
  const plannerBoots = [];
  const reconciledExternalIntentDigests = new Set();
  let materializedCount = 0;
  let recoveredStarted = 0;
  let plannerCandidateCount = 0;
  let maxLocalConcurrency = 0;
  let stalePlanner = false;

  const effectiveRunner = proposalHost ? createExternalProposalRunner(proposalHost) : runner;
  const workOptions = {
    env,
    model,
    timeoutSeconds,
    ...(effectiveRunner ? { runner: effectiveRunner } : {}),
    onProgress,
    signal,
  };

  while (true) {
    collectSettledExecutions(running, executionByRun, executions, recordedExecutions);

    let recovered = recoverPlannerContext(repositoryPath, now, { runningRunKeys: new Set(running.keys()) });

    for (const entry of recovered.filter((candidate) => candidate.type === "CLOSURE")) {
      const state = settleClosure({ repositoryPath, entry, now, env });
      states.set(entry.runKey, state);
    }
    recovered = recoverPlannerContext(repositoryPath, now, { runningRunKeys: new Set(running.keys()) });

    if (proposalHost) {
      for (const entry of recovered) {
        if (entry.type !== "EXTERNAL_OPEN"
            || reconciledExternalIntentDigests.has(entry.intent.intentDigest)) continue;
        reconciledExternalIntentDigests.add(entry.intent.intentDigest);
        await reconcileProposalDispatch({
          proposalHost,
          workspaceRegistryDir: workspaceRegistryDirectory(repositoryPath),
          intent: entry.intent,
          signal,
        });
      }
      recovered = recoverPlannerContext(repositoryPath, now, { runningRunKeys: new Set(running.keys()) });
    }

    recoveredStarted += startRecoverableCommitments({
      repositoryPath,
      recovered,
      running,
      bound,
      proposalIdByRun,
      telemetryClock,
      onSettlement: (settlement) => executionByRun.set(settlement.item.runKey, settlement),
      workOptions,
      signal,
    });
    maxLocalConcurrency = Math.max(maxLocalConcurrency, running.size);

    recovered = recoverPlannerContext(repositoryPath, now, { runningRunKeys: new Set(running.keys()) });
    const observations = settledObservations(repositoryPath);
    const productCommit = readIntegrationHead(repositoryPath);
    const objectiveRevision = currentOwnerObjectiveRevision(repositoryPath);
    const epochKey = planningEpochKey(productCommit, objectiveRevision, observations);

    if (!signal?.aborted && running.size < bound && !plannedEpochs.has(epochKey)) {
      const planning = await planCurrentProduct({
        repositoryPath,
        recovered,
        observations,
        env,
        model,
        timeoutSeconds,
        plannerRunner,
        researchModelRunner,
        telemetryClock,
        signal,
        now,
      });
      plannedEpochs.add(planning.epochKey);
      plannerResults.set(planning.epochKey, planning);
      plannerCandidateCount += planning.candidateCount;
      stalePlanner = stalePlanner || planning.staleProductHead || planning.staleObjective;
      candidateRejections.push(...planning.candidateRejections);
      for (const item of planning.materializedRuns) {
        materializedCount += 1;
        proposalIdByRun.set(item.materializedRun.session.sessionDigest, item.candidate.id);
      }
      plannerBoots.push({
        productCommit: planning.productCommit,
        objectiveRevision: planning.objectiveRevision,
        startedAt: isoTime(planning.startedMs),
        completedAt: isoTime(planning.completedMs),
        elapsedMs: Math.max(0, planning.completedMs - planning.startedMs),
        candidateCount: planning.candidateCount,
        materializedCount: planning.materializedCount,
        staleObjective: planning.staleObjective,
        staleProductHead: planning.staleProductHead,
        candidateRejections: planning.candidateRejections,
      });
      continue;
    }

    if (signal?.aborted) {
      if (running.size > 0) {
        await Promise.race([...running.values()]);
        continue;
      }
      return DRAIN_COMPLETE;
    }

    if (running.size > 0) {
      await Promise.race([...running.values()]);
      continue;
    }

    recovered = recoverPlannerContext(repositoryPath, now);
    if (recovered.some((entry) => entry.type === "CLOSURE" || entry.type === "EXECUTABLE")) continue;

    const finalObservations = settledObservations(repositoryPath);
    const finalProductCommit = readIntegrationHead(repositoryPath);
    const finalObjectiveRevision = currentOwnerObjectiveRevision(repositoryPath);
    const finalEpochKey = planningEpochKey(finalProductCommit, finalObjectiveRevision, finalObservations);
    const finalPlanning = plannerResults.get(finalEpochKey) || null;
    if (!finalPlanning) continue;

    const externalOpen = recovered.filter((entry) => entry.type === "EXTERNAL_OPEN");
    const runningElsewhere = recovered.filter((entry) => entry.type === "RUNNING_ELSEWHERE");
    for (const entry of externalOpen) {
      states.set(entry.runKey, {
        runKey: entry.runKey,
        outcomeDigest: entry.outcomeDigest,
        desiredState: entry.session.productResult,
        state: "EXTERNAL_OPEN",
        observableResult: null,
      });
    }
    for (const entry of runningElsewhere) {
      states.set(entry.runKey, {
        runKey: entry.runKey,
        outcomeDigest: entry.outcomeDigest,
        desiredState: entry.session.productResult,
        state: "RUNNING_ELSEWHERE",
        observableResult: null,
      });
    }

    const stateList = [...states.values()];
    const noCandidates = finalPlanning.candidateCount === 0;
    const finalOutcome = resultOutcome(stateList, {
      noCandidates,
      activeCount: externalOpen.length + runningElsewhere.length,
    });
    if (["DONE", "USE_PRODUCT"].includes(finalOutcome) && finalObjectiveRevision > 0) {
      try {
        clearOwnerObjectiveState(repositoryPath, { expectedRevision: finalObjectiveRevision });
      } catch (error) {
        if (error?.code === "MH_OWNER_OBJECTIVE_STALE") {
          stalePlanner = true;
          continue;
        }
        throw error;
      }
    }
    const reconciliationCompletedMs = telemetryClock();
    const orchestrationTelemetry = buildRepoWorkWaveTelemetry({
      schemaVersion: REPO_WORK_WAVE_TELEMETRY_SCHEMA,
      semanticRole: "OBSERVATION",
      schedulerPolicy: "GIT_CAS_RECONCILIATION",
      reconciliationStartedAt: isoTime(reconciliationStartedMs),
      reconciliationCompletedAt: isoTime(reconciliationCompletedMs),
      elapsedMs: Math.max(0, reconciliationCompletedMs - reconciliationStartedMs),
      entryProductCommit,
      quiescentProductCommit: finalProductCommit,
      plannerInvoked: plannerBoots.length > 0,
      plannerBootCount: plannerBoots.length,
      plannerCandidateCount,
      candidateRejections,
      executionBound: bound,
      materialized: materializedCount,
      recovered: recoveredStarted,
      runningElsewhere: runningElsewhere.length,
      externalOpen: externalOpen.length,
      maxLocalConcurrency,
      plannerBoots,
      executions: executionTelemetry(executions),
    });

    return Object.freeze({
      schemaVersion: "repo-work-wave-result/v2",
      outcome: finalOutcome,
      productCommit: finalProductCommit,
      executionBound: bound,
      materialized: materializedCount,
      recovered: recoveredStarted,
      runningElsewhere: runningElsewhere.length,
      externalOpen: externalOpen.length,
      deferredExecutable: 0,
      plannerInvoked: plannerBoots.length > 0,
      plannerRetryCount: 0,
      plannerCandidateCount,
      stalePlanner,
      orchestrationTelemetry,
      outcomes: stateList.map((entry) => ({
        runKey: entry.runKey || null,
        outcomeDigest: entry.outcomeDigest,
        desiredState: entry.desiredState || null,
        observableResult: entry.observableResult || null,
        state: entry.state,
        ownerRequest: null,
      })),
    });
  }
}

module.exports = {
  DEFAULT_LOCAL_EXECUTION_BOUND,
  MAX_LANDING_ATTEMPTS,
  MAX_LOCAL_EXECUTION_BOUND,
  REPO_WORK_WAVE_TELEMETRY_SCHEMA,
  localExecutionBound,
  recoverRunCommitment,
  recoverRepositoryCommitments,
  runRepoWorkWave,
};
