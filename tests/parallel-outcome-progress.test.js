"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const {
  findExecutionClosureForOrigin,
} = require("../lib/execution-closure");
const {
  listActiveOutcomeClaims,
  readOutcomeClaimRelease,
  readOutcomeClaimSession,
} = require("../lib/outcome-claim");
const { pinProductDirection } = require("../lib/product-direction");
const {
  admitPreparedRepoProposal,
  loadRepoCharter,
  loadRepoProposalSet,
  outcomeForProposal,
  prepareRepoProposal,
} = require("../lib/repo-proposal-set");
const { runRepositoryClosureInterpreter } = require("../lib/repo-closure-interpreter");
const { landOutcomeClosure, runRepoWorkWave } = require("../lib/repo-work-wave");
const { runWork } = require("../lib/work-loop");
const { stateDirectory } = require("../lib/work-git");
const {
  computeRepoWorldDigest,
  computeWorldAttestationDigest,
  rawDigest,
} = require("../lib/world-attestation");
const { persistImmutableJson, protocolRoot, readImmutableJson } = require("../lib/world-authority");
const {
  commitTransition,
  computeWorldProjectionDigest,
  computeWorldTransitionDigest,
  readCurrentWorldState,
  validateWorldTransition,
} = require("../lib/world-transition");
const { tempDir } = require("./helpers/cli");
const { writeProductMd } = require("./helpers/product-direction");

function git(cwd, args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", windowsHide: true });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return String(result.stdout || "").trim();
}

function writeJson(root, relativePath, value) {
  const filePath = path.join(root, ...relativePath.split("/"));
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  return filePath;
}

function proofProgram() {
  return [
    '"use strict";',
    'const fs = require("node:fs");',
    'const path = require("node:path");',
    'if (process.env.META_HARNESS_PROOF_CLAIM_ID !== "delivered-result") process.exit(41);',
    'const contract = JSON.parse(fs.readFileSync(process.env.META_HARNESS_CONTRACT_PATH, "utf8"));',
    'const match = /^Deliver ([a-z0-9-]+)\\.?$/iu.exec(contract.productResult);',
    'if (!match) process.exit(42);',
    'const target = path.join(process.env.META_HARNESS_CANDIDATE_ROOT, "src", match[1], "result.txt");',
    'if (!fs.existsSync(target) || fs.readFileSync(target, "utf8") !== "delivered\\n") process.exit(43);',
    "",
  ].join("\n");
}

function interpreterProgram() {
  return [
    '"use strict";',
    'const crypto = require("node:crypto");',
    'const fs = require("node:fs");',
    'function canonical(value) {',
    '  if (value === null || typeof value === "boolean" || typeof value === "number" || typeof value === "string") return JSON.stringify(value);',
    '  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;',
    '  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;',
    '}',
    'function domainDigest(domain, value) { return `sha256:${crypto.createHash("sha256").update(`${domain}\\u001e${canonical(value)}`, "utf8").digest("hex")}`; }',
    'const input = JSON.parse(fs.readFileSync(0, "utf8"));',
    'const learned = Array.isArray(input.currentWorld.payload.learned) ? [...input.currentWorld.payload.learned] : [];',
    'learned.push(input.outcome.id);',
    'const successorWorld = { schemaVersion: "repo-world/v2", productDirectionDigest: input.currentWorld.productDirectionDigest, payload: { ...input.currentWorld.payload, learned } };',
    'const worldDigest = domainDigest("meta-harness-repo-world/v2", successorWorld);',
    'const attestationBody = { schemaVersion: "world-attestation/v1", worldDigest, projectorDigest: input.currentAttestation.projectorDigest, sources: input.currentAttestation.sources, generatedAt: new Date().toISOString() };',
    'const successorAttestation = { ...attestationBody, attestationDigest: domainDigest("meta-harness-world-attestation/v1", attestationBody) };',
    'process.stdout.write(JSON.stringify({ schemaVersion: "repo-closure-interpretation/v1", disposition: "APPLIED", interpretation: { learnedOutcome: input.outcome.id }, successorWorld, successorAttestation }));',
    "",
  ].join("\n");
}

function repository(t, { payload = { learned: [] } } = {}) {
  const parent = tempDir("parallel-outcome-progress-");
  const root = path.join(parent, "repository");
  fs.mkdirSync(root);
  git(root, ["init"]);
  git(root, ["config", "user.name", "Parallel Outcome Test"]);
  git(root, ["config", "user.email", "parallel-outcome@example.invalid"]);
  fs.writeFileSync(path.join(root, ".gitignore"), ".worktrees/\n", "utf8");
  for (const id of ["a", "b", "c"]) {
    fs.mkdirSync(path.join(root, "src", id), { recursive: true });
    fs.writeFileSync(path.join(root, "src", id, "baseline.txt"), `${id}\n`, "utf8");
  }
  fs.writeFileSync(path.join(root, "src", "source.txt"), "authoritative\n", "utf8");
  writeProductMd(root);
  writeJson(root, ".meta-harness/repo-charter.json", { ownerPolicy: "repo-owned-test" });
  writeJson(root, ".meta-harness/validation.json", {
    schemaVersion: "meta-harness-validation/v1",
    commands: [{
      argv: [process.execPath, "-e", "const fs=require('fs'),p=require('path');let ok=false;function walk(d){for(const n of fs.readdirSync(d)){const f=p.join(d,n),s=fs.statSync(f);if(s.isDirectory())walk(f);else if(n==='result.txt'&&fs.readFileSync(f,'utf8')==='delivered\\n')ok=true}}walk('src');if(!ok)process.exit(7)"],
      cwd: ".",
      timeoutSeconds: 60,
    }],
  });
  fs.writeFileSync(path.join(root, ".meta-harness", "product-proof.js"), proofProgram(), "utf8");
  writeJson(root, ".meta-harness/product-proof.json", {
    schemaVersion: "product-proof-policy/v2",
    programPath: ".meta-harness/product-proof.js",
    runtime: process.execPath,
    timeoutSeconds: 30,
    claims: [{
      id: "delivered-result",
      statement: "The proposal-specific delivered result exists with expected contents.",
      baselineExpectation: "FAIL",
      covers: ["productResult", "newlyTrueBehavior", "doneWhen"],
    }],
  });
  fs.writeFileSync(path.join(root, ".meta-harness", "closure-interpreter.js"), interpreterProgram(), "utf8");
  git(root, ["add", "."]);
  git(root, ["commit", "-m", "baseline"]);
  const initial = persistWorld(root, payload, null);
  t.after(() => fs.rmSync(parent, { recursive: true, force: true }));
  return { root, initial };
}

function sourceObservation(root) {
  return {
    type: "LOCAL_FILE",
    sourceId: "parallel-source",
    path: "src/source.txt",
    digest: rawDigest(fs.readFileSync(path.join(root, "src", "source.txt"))),
    observedAt: "2026-08-18T00:00:00.000Z",
    validUntil: "2099-01-01T00:00:00.000Z",
  };
}

function projectionObjects(root, payload, generatedAt = "2026-08-18T01:00:00.000Z") {
  const direction = pinProductDirection(root);
  const world = {
    schemaVersion: "repo-world/v2",
    productDirectionDigest: direction.digest,
    payload,
  };
  const worldDigest = computeRepoWorldDigest(world);
  const attestationBody = {
    schemaVersion: "world-attestation/v1",
    worldDigest,
    projectorDigest: `sha256:${"7".repeat(64)}`,
    sources: [sourceObservation(root)],
    generatedAt,
  };
  const attestation = {
    ...attestationBody,
    attestationDigest: computeWorldAttestationDigest(attestationBody),
  };
  persistImmutableJson(root, "worlds", worldDigest, world, "TEST_WORLD");
  persistImmutableJson(root, "attestations", attestation.attestationDigest, attestation, "TEST_ATTESTATION");
  return { world, worldDigest, attestation };
}

function realityTransition(root, predecessorHeadDigest, successor) {
  const predecessor = predecessorHeadDigest
    ? readImmutableJson(root, "heads", predecessorHeadDigest)
    : null;
  const productCommit = predecessor?.productCommit || git(root, ["rev-parse", "HEAD"]);
  const body = {
    schemaVersion: "world-transition/v2",
    predecessorHeadDigest,
    cause: {
      type: "REALITY_REFRESH",
      projectionDigest: computeWorldProjectionDigest(successor.worldDigest, successor.attestation.attestationDigest),
    },
    successorWorldDigest: successor.worldDigest,
    successorAttestationDigest: successor.attestation.attestationDigest,
    successorProductCommit: productCommit,
  };
  return validateWorldTransition({ ...body, transitionDigest: computeWorldTransitionDigest(body) });
}

function persistWorld(root, payload, predecessorHeadDigest) {
  const successor = projectionObjects(root, payload);
  const applied = commitTransition(root, realityTransition(root, predecessorHeadDigest, successor));
  return { ...successor, head: applied.head };
}

function proposal(root, id, allowedPath = `src/${id}`) {
  const target = `${allowedPath}/result.txt`;
  return {
    id,
    productResult: `Deliver ${id}.`,
    journeyState: `Outcome ${id} is not delivered yet.`,
    doNow: `Create ${target} with delivered content.`,
    newlyTrueBehavior: `${target} contains delivered.`,
    doneWhen: `${target} exists and controller validation passes.`,
    stopOnlyIf: ["The claimed write boundary is genuinely insufficient."],
    allowedPaths: [allowedPath],
    validation: [{
      argv: [
        process.execPath,
        "-e",
        `const fs=require('fs'); if(fs.readFileSync(${JSON.stringify(target)},'utf8')!=='delivered\\n') process.exit(7)`,
      ],
      cwd: ".",
      timeoutSeconds: 60,
    }],
    maxAttempts: 1,
    delivery: { commit: false, push: false },
  };
}

function writeProposalSet(root, headDigest, proposals) {
  const direction = pinProductDirection(root);
  const charter = loadRepoCharter(root);
  return writeJson(root, ".meta-harness/repo-proposals.json", {
    schemaVersion: "repo-proposal-set/v2",
    productDirectionDigest: direction.digest,
    charterDigest: charter.digest,
    worldHeadDigest: headDigest,
    ownerDirectiveDigest: null,
    proposals,
  });
}

function plannerCandidate(id, expectedWritePath = `src/${id}`) {
  const value = proposal(null, id, expectedWritePath);
  return {
    id: value.id,
    productResult: value.productResult,
    journeyState: value.journeyState,
    doNow: value.doNow,
    newlyTrueBehavior: value.newlyTrueBehavior,
    doneWhen: value.doneWhen,
    stopOnlyIf: value.stopOnlyIf,
    expectedWritePaths: [expectedWritePath],
    continuesFromTransitionDigests: [],
  };
}

function plannerRunner(proposals) {
  return async ({ plannerInput }) => {
    const learned = new Set(plannerInput?.currentWorld?.payload?.learned || []);
    const active = new Set((plannerInput?.activeCommitments || []).map((entry) => entry.outcome.id));
    const unresolved = new Set((plannerInput?.unresolvedHandoffs || []).map((entry) => entry.outcome.id));
    return {
      batch: {
        schemaVersion: "planner-candidate-batch/v3",
        proposals: proposals.filter((entry) => !learned.has(entry.id) && !active.has(entry.id) && !unresolved.has(entry.id)).map((entry) => ({ ...entry, objectRefs: [], hypothesisRef: null, criterionRefs: [], metricRefs: [] })),
      },
    };
  };
}

function monotonicNow() {
  let tick = Date.parse("2026-08-18T02:00:00.000Z");
  return () => {
    const value = new Date(tick);
    tick += 1000;
    return value;
  };
}

function monotonicTelemetryClock() {
  let tick = Date.parse("2026-08-18T02:00:00.000Z");
  return () => {
    const value = tick;
    tick += 100;
    return value;
  };
}

function fakeInterpretation({ input, now }) {
  const learned = Array.isArray(input.currentWorld.payload.learned) ? [...input.currentWorld.payload.learned] : [];
  const invalidated = input.currentWorld.payload.invalidateTarget === input.outcome.id
    && learned.includes(input.currentWorld.payload.invalidateAfter);
  const payload = invalidated
    ? input.currentWorld.payload
    : { ...input.currentWorld.payload, learned: [...learned, input.outcome.id] };
  const successorWorld = {
    schemaVersion: "repo-world/v2",
    productDirectionDigest: input.currentWorld.productDirectionDigest,
    payload,
  };
  const worldDigest = computeRepoWorldDigest(successorWorld);
  const body = {
    schemaVersion: "world-attestation/v1",
    worldDigest,
    projectorDigest: input.currentAttestation.projectorDigest,
    sources: input.currentAttestation.sources,
    generatedAt: now.toISOString(),
  };
  return {
    schemaVersion: "repo-closure-interpretation/v1",
    disposition: invalidated ? "INVALIDATED_REPLAN" : "APPLIED",
    interpretation: invalidated
      ? { invalidatedOutcome: input.outcome.id, reason: "current World invalidated its declared precondition" }
      : { learnedOutcome: input.outcome.id },
    successorWorld,
    successorAttestation: { ...body, attestationDigest: computeWorldAttestationDigest(body) },
  };
}

function resultRunner({ failId = null, paths = null, delayMs = 0, delayById = null, concurrency = null } = {}) {
  return async ({ session, schemaPath, outputPath }) => {
    const id = /^Deliver ([a-z0-9-]+)\.$/iu.exec(session.productResult)?.[1];
    if (paths) paths.push({ id, schemaPath, outputPath });
    if (concurrency) {
      concurrency.active += 1;
      concurrency.max = Math.max(concurrency.max, concurrency.active);
    }
    try {
      const effectiveDelayMs = delayById?.[id] ?? delayMs;
      if (effectiveDelayMs > 0) await new Promise((resolve) => setTimeout(resolve, effectiveDelayMs));
      if (id === failId) {
        const error = new Error(`synthetic ${id} worker failure`);
        error.code = "TEST_WORKER_FAILURE";
        throw error;
      }
      return {
        worker: "parallel-test-runner",
        stdout: "",
        stderr: "",
        result: {
          schemaVersion: "worker-result/v2",
          status: "DONE",
          observableResult: `Prepared ${id}.`,
          operations: [{ type: "WRITE", path: `src/${id}/result.txt`, content: "delivered\n" }],
          validation: ["synthetic runner completed"],
          stop: null,
        },
      };
    } finally {
      if (concurrency) concurrency.active -= 1;
    }
  };
}

function prepareOne(root, headDigest, value, now = new Date("2026-08-18T02:00:00.000Z")) {
  writeProposalSet(root, headDigest, [value]);
  const current = readCurrentWorldState(root, { now });
  const loaded = loadRepoProposalSet(root, current);
  const outcome = outcomeForProposal(root, value);
  const prepared = prepareRepoProposal(root, loaded, value, { outcome });
  return { current, loaded, outcome, prepared };
}

test("new Claim visibility implies durable session recovery and proposal deletion cannot cancel commitment", async (t) => {
  const { root, initial } = repository(t);
  const value = proposal(root, "a");
  const prepared = prepareOne(root, initial.head.headDigest, value);
  const admitted = admitPreparedRepoProposal(root, prepared.loaded, prepared.prepared, {
    now: new Date("2026-08-18T02:00:01.000Z"),
  });
  assert.equal(listActiveOutcomeClaims(root).length, 1);
  assert.equal(readOutcomeClaimSession(root, admitted.claim.claimDigest).sessionDigest, admitted.session.sessionDigest);
  fs.unlinkSync(path.join(root, ".meta-harness", "repo-proposals.json"));

  const result = await runRepoWorkWave({
    repositoryPath: root,
    env: { ...process.env, META_HARNESS_REPO_WORK_CONCURRENCY: "2" },
    runner: resultRunner(),
    plannerRunner: plannerRunner([]),
    interpret: fakeInterpretation,
    now: monotonicNow(),
  });
  assert.equal(result.outcomes.filter((entry) => entry.state === "LANDED").length, 1);
  assert.equal(listActiveOutcomeClaims(root).length, 0);
  assert.ok(readOutcomeClaimRelease(root, admitted.claim.claimDigest));
  assert.equal(result.plannerInvoked, true);
  assert.equal(result.plannerCandidateCount, 0);
});

test("new Claim admission rejects a proposal snapshot whose origin Head stopped being current", (t) => {
  const { root, initial } = repository(t);
  const value = proposal(root, "a");
  const prepared = prepareOne(root, initial.head.headDigest, value);
  const advanced = projectionObjects(root, { learned: [], revision: 2 });
  commitTransition(root, realityTransition(root, initial.head.headDigest, advanced));

  assert.throws(
    () => admitPreparedRepoProposal(root, prepared.loaded, prepared.prepared),
    (error) => error.code === "MH_OUTCOME_CLAIM_STALE_HEAD",
  );
  assert.equal(listActiveOutcomeClaims(root).length, 0);
});

test("one proposal set executes compatible Claims concurrently and lands siblings against successive current Worlds", async (t) => {
  const { root, initial } = repository(t);
  writeProposalSet(root, initial.head.headDigest, [proposal(root, "a"), proposal(root, "b"), proposal(root, "c")]);
  const paths = [];
  const concurrency = { active: 0, max: 0 };
  const heads = [];
  const result = await runRepoWorkWave({
    repositoryPath: root,
    env: { ...process.env, META_HARNESS_REPO_WORK_CONCURRENCY: "3" },
    runner: resultRunner({ paths, delayMs: 80, concurrency }),
    plannerRunner: plannerRunner([plannerCandidate("a"), plannerCandidate("b"), plannerCandidate("c")]),
    interpret: (args) => {
      heads.push({ id: args.input.outcome.id, head: args.input.currentHead.headDigest });
      return fakeInterpretation(args);
    },
    now: monotonicNow(),
  });

  assert.equal(result.outcome, "USE_PRODUCT");
  assert.equal(result.admitted, 3);
  assert.equal(result.outcomes.filter((entry) => entry.state === "LANDED").length, 3);
  assert.ok(concurrency.max >= 2, `expected overlapping workers, saw max=${concurrency.max}`);
  assert.equal(new Set(paths.map((entry) => entry.schemaPath)).size, 3);
  assert.equal(new Set(paths.map((entry) => entry.outputPath)).size, 3);
  assert.equal(heads.length, 3);
  assert.equal(heads[0].head, initial.head.headDigest);
  assert.notEqual(heads[1].head, initial.head.headDigest);
  assert.notEqual(heads[2].head, heads[1].head);
  assert.equal(readCurrentWorldState(root).head.generation, initial.head.generation + 3);
  assert.equal(listActiveOutcomeClaims(root).length, 0);
  assert.equal(result.orchestrationTelemetry.executions.length, 3);
  assert.equal(result.orchestrationTelemetry.landings.length, 3);
  assert.ok(result.orchestrationTelemetry.landings.every((entry) => Number.isFinite(entry.completionToLandingMs)));
  const workerSchemaNames = paths.map((entry) => path.basename(entry.schemaPath));
  assert.ok(workerSchemaNames.every((name) => name.includes(".worker-result.schema.json")));
});

test("freed capacity refills from the post-landing Head before a slow sibling can finish", async (t) => {
  const { root, initial } = repository(t);
  writeProposalSet(root, initial.head.headDigest, [proposal(root, "a"), proposal(root, "b"), proposal(root, "c")]);
  let releaseB;
  const bGate = new Promise((resolve) => { releaseB = resolve; });
  const baseRunner = resultRunner();
  let cStarted = false;
  let cBaseCommit = null;
  let worldAtCStart = null;
  const result = await runRepoWorkWave({
    repositoryPath: root,
    env: { ...process.env, META_HARNESS_REPO_WORK_CONCURRENCY: "2" },
    runner: async (args) => {
      const id = /^Deliver ([a-z0-9-]+)\.$/iu.exec(args.session.productResult)?.[1];
      if (id === "b") await bGate;
      if (id === "c") {
        cStarted = true;
        cBaseCommit = args.session.base.commit;
        worldAtCStart = readCurrentWorldState(root);
        releaseB();
      }
      return baseRunner(args);
    },
    plannerRunner: plannerRunner([plannerCandidate("a"), plannerCandidate("b"), plannerCandidate("c")]),
    interpret: fakeInterpretation,
    now: monotonicNow(),
    telemetryClock: monotonicTelemetryClock(),
  });

  assert.equal(cStarted, true, "C must start while B is still held inside its worker runner");
  assert.deepEqual(worldAtCStart.world.payload.learned, ["a"]);
  assert.equal(cBaseCommit, worldAtCStart.head.productCommit);
  assert.notEqual(cBaseCommit, initial.head.productCommit);
  assert.equal(result.outcome, "USE_PRODUCT");
  assert.equal(result.admitted, 3);
  assert.deepEqual([...readCurrentWorldState(root).world.payload.learned].sort(), ["a", "b", "c"]);

  const telemetry = result.orchestrationTelemetry;
  assert.equal(telemetry.schemaVersion, "repo-work-wave-telemetry/v1");
  assert.equal(telemetry.authority, "NON_AUTHORITATIVE_OBSERVATION");
  assert.equal(telemetry.schedulerPolicy, "EVENT_DRIVEN_RECONCILIATION");
  assert.equal(telemetry.executionBound, 2);
  assert.equal(telemetry.maxLocalConcurrency, 2);
  assert.equal(telemetry.plannerInvoked, true);
  assert.ok(telemetry.plannerBootCount >= 3);
  assert.equal(new Set(telemetry.plannerBoots.map((entry) => entry.headDigest)).size, telemetry.plannerBootCount);
  assert.equal(telemetry.executions.length, 3);
  assert.deepEqual(telemetry.executions.map((entry) => entry.proposalId).sort(), ["a", "b", "c"]);
  assert.ok(telemetry.executions.every((entry) => entry.effort?.schemaVersion === "work-metrics/v1"));
  assert.ok(telemetry.executions.every((entry) => entry.effort.workerMs >= 0));
  assert.ok(telemetry.executions.every((entry) => entry.effort.attemptCount === 1));
  assert.ok(telemetry.executions.every((entry) => entry.effort.operationCount === 1));
  assert.equal(Object.hasOwn(telemetry, "synchronousBarrier"), false);
  assert.equal(Object.hasOwn(telemetry, "frozenCandidateStructuralRefill"), false);
  assert.equal(telemetry.landings.length, 3);
  assert.ok(telemetry.landings.every((entry) => entry.completionToLandingMs >= 0));
  const cExecution = telemetry.executions.find((entry) => entry.proposalId === "c");
  assert.ok(cExecution);
  assert.ok(telemetry.refills.some((entry) => (
    entry.redispatchedClaimDigest === cExecution.claimDigest
      && entry.releasedSlotToRedispatchMs >= 0
  )));
  assert.equal(telemetry.quiescentHeadDigest, readCurrentWorldState(root).head.headDigest);

  assert.deepEqual(result.orchestrationTelemetryPersistence, { status: "PERSISTED", errorCode: null });
  assert.match(telemetry.telemetryDigest, /^sha256:[a-f0-9]{64}$/u);
  const telemetryPath = path.join(
    protocolRoot(root),
    "telemetry",
    "repo-work-waves",
    `${telemetry.telemetryDigest.slice("sha256:".length)}.json`,
  );
  assert.equal(fs.existsSync(telemetryPath), true);
  assert.deepEqual(JSON.parse(fs.readFileSync(telemetryPath, "utf8")), telemetry);
});

test("proposal overlap rejects the conflicting current-Head candidate without poisoning later refill", async (t) => {
  const { root, initial } = repository(t);
  writeProposalSet(root, initial.head.headDigest, [
    proposal(root, "a", "src/a"),
    proposal(root, "b", "src/a/nested"),
    proposal(root, "c", "src/c"),
  ]);
  let plannerCalls = 0;
  const firstHeadCandidates = [
    plannerCandidate("a", "src/a"),
    plannerCandidate("b", "src/a/nested"),
    plannerCandidate("c", "src/c"),
  ];
  const result = await runRepoWorkWave({
    repositoryPath: root,
    env: { ...process.env, META_HARNESS_REPO_WORK_CONCURRENCY: "3" },
    runner: resultRunner(),
    plannerRunner: async ({ plannerInput }) => {
      plannerCalls += 1;
      return {
        batch: {
          schemaVersion: "planner-candidate-batch/v3",
          proposals: plannerCalls === 1 ? firstHeadCandidates.map((entry) => ({ ...entry, objectRefs: [], hypothesisRef: null, criterionRefs: [], metricRefs: [] })) : [],
        },
      };
    },
    interpret: fakeInterpretation,
    now: monotonicNow(),
  });
  assert.ok(result.orchestrationTelemetry.candidateRejections.some((entry) => (
    entry.candidateId === "b" && entry.code === "MH_OUTCOME_CLAIM_CONFLICT"
  )));
  assert.equal(result.admitted, 2);
  assert.equal(result.outcomes.filter((entry) => entry.state === "LANDED").length, 2);
  assert.deepEqual([...readCurrentWorldState(root).world.payload.learned].sort(), ["a", "c"]);
});

test("fresh current-World interpretation can invalidate a sibling without stranding its Claim", async (t) => {
  const { root, initial } = repository(t, {
    payload: { learned: [], invalidateAfter: "a", invalidateTarget: "b" },
  });
  writeProposalSet(root, initial.head.headDigest, [proposal(root, "a"), proposal(root, "b")]);
  const seen = [];
  const result = await runRepoWorkWave({
    repositoryPath: root,
    env: { ...process.env, META_HARNESS_REPO_WORK_CONCURRENCY: "2" },
    runner: resultRunner({ delayMs: 30 }),
    plannerRunner: plannerRunner([plannerCandidate("a"), plannerCandidate("b")]),
    interpret: (args) => {
      seen.push({ id: args.input.outcome.id, head: args.input.currentHead.headDigest, learned: args.input.currentWorld.payload.learned });
      return fakeInterpretation(args);
    },
    now: monotonicNow(),
  });
  assert.equal(result.outcome, "PARTIAL");
  assert.equal(result.outcomes.filter((entry) => entry.state === "LANDED").length, 1);
  assert.equal(result.outcomes.filter((entry) => entry.state === "INVALIDATED_REPLAN").length, 1);
  assert.deepEqual(seen.map((entry) => entry.id), ["a", "b"]);
  assert.equal(seen[0].head, initial.head.headDigest);
  assert.notEqual(seen[1].head, initial.head.headDigest);
  assert.deepEqual(seen[1].learned, ["a"]);
  assert.equal(listActiveOutcomeClaims(root).length, 0);
});

test("landing CAS loss discards stale semantics and reinterprets against the new current Head", async (t) => {
  const { root, initial } = repository(t);
  const value = proposal(root, "a");
  const prepared = prepareOne(root, initial.head.headDigest, value);
  const admitted = admitPreparedRepoProposal(root, prepared.loaded, prepared.prepared, {
    now: new Date("2026-08-18T02:00:01.000Z"),
  });
  await runWork({ repositoryPath: root, session: admitted.session, runner: resultRunner() });
  const closure = findExecutionClosureForOrigin(root, admitted.session.origin);
  const seenHeads = [];
  let raceHead = null;
  const landing = landOutcomeClosure({
    repositoryPath: root,
    claim: admitted.claim,
    closure,
    now: monotonicNow(),
    interpret: (args) => {
      seenHeads.push(args.input.currentHead.headDigest);
      if (seenHeads.length === 1) {
        const race = projectionObjects(root, { learned: [], realityRace: true }, args.now.toISOString());
        raceHead = commitTransition(root, realityTransition(root, args.input.currentHead.headDigest, race)).head.headDigest;
      }
      return fakeInterpretation(args);
    },
  });
  assert.equal(landing.state, "LANDED");
  assert.equal(landing.attempts, 2);
  assert.deepEqual(seenHeads, [initial.head.headDigest, raceHead]);
  assert.equal(listActiveOutcomeClaims(root).length, 0);
});

test("terminal Closure without a work result resolves through ATTEMPT_ABORTED and releases Claim", async (t) => {
  const { root, initial } = repository(t);
  const value = proposal(root, "a");
  const prepared = prepareOne(root, initial.head.headDigest, value);
  const admitted = admitPreparedRepoProposal(root, prepared.loaded, prepared.prepared, {
    now: new Date("2026-08-18T02:00:01.000Z"),
  });
  await assert.rejects(
    runWork({
      repositoryPath: root,
      session: admitted.session,
      runner: resultRunner({ failId: "a" }),
    }),
    (error) => error.code === "TEST_WORKER_FAILURE",
  );
  const closure = findExecutionClosureForOrigin(root, admitted.session.origin);
  assert.equal(closure.disposition, "CONTROLLER_REJECTED");
  assert.equal(closure.workResultDigest, null);
  let interpreterCalled = false;
  const landing = landOutcomeClosure({
    repositoryPath: root,
    claim: admitted.claim,
    closure,
    interpret: () => {
      interpreterCalled = true;
      throw new Error("no-work-result closure must not invoke semantic interpreter");
    },
    now: monotonicNow(),
  });
  assert.equal(interpreterCalled, false);
  assert.equal(landing.state, "EXECUTION_ABORTED");
  const transition = readImmutableJson(root, "transitions", landing.transitionDigest);
  assert.equal(transition.cause.type, "ATTEMPT_ABORTED");
  assert.ok(readOutcomeClaimRelease(root, admitted.claim.claimDigest));
});

test("one worker failure does not cancel siblings and every terminal Claim reaches durable resolution", async (t) => {
  const { root, initial } = repository(t);
  writeProposalSet(root, initial.head.headDigest, [proposal(root, "a"), proposal(root, "b"), proposal(root, "c")]);
  const result = await runRepoWorkWave({
    repositoryPath: root,
    env: { ...process.env, META_HARNESS_REPO_WORK_CONCURRENCY: "3" },
    runner: resultRunner({ failId: "b", delayMs: 40 }),
    plannerRunner: plannerRunner([plannerCandidate("a"), plannerCandidate("b"), plannerCandidate("c")]),
    interpret: fakeInterpretation,
    now: monotonicNow(),
  });
  assert.equal(result.outcome, "PARTIAL");
  assert.equal(result.outcomes.filter((entry) => entry.state === "LANDED").length, 2);
  assert.equal(result.outcomes.filter((entry) => entry.state === "EXECUTION_ABORTED").length, 1);
  assert.equal(result.outcomes.filter((entry) => entry.state === "BLOCKED").length, 0);
  assert.equal(listActiveOutcomeClaims(root).length, 0);
  assert.deepEqual([...readCurrentWorldState(root).world.payload.learned].sort(), ["a", "c"]);
});

test("empty positive-value frontier reaches USE_PRODUCT from quiescent planner truth", async (t) => {
  const { root, initial } = repository(t);
  writeProposalSet(root, initial.head.headDigest, []);
  writeJson(root, ".meta-harness/repo-decision.json", {
    schemaVersion: "repo-decision/v3",
    historicalOnly: true,
    decision: { type: "NO_DISPATCH", reason: "USE_PRODUCT" },
  });
  const result = await runRepoWorkWave({
    repositoryPath: root,
    plannerRunner: plannerRunner([]),
    interpret: fakeInterpretation,
    now: monotonicNow(),
  });
  assert.equal(result.outcome, "USE_PRODUCT");
  assert.equal(result.endgameCoverage.complete, true);
  assert.equal(result.admitted, 0);
  assert.equal(result.outcomes.length, 0);
  assert.equal(fs.existsSync(path.join(root, ".worktrees")), false);
});

test("production repository interpreter seam executes the fixed repo-owned script and validates semantic output", (t) => {
  const { root } = repository(t);
  const current = readCurrentWorldState(root);
  const produced = runRepositoryClosureInterpreter({
    repositoryPath: root,
    input: {
      schemaVersion: "repo-closure-landing-input/v1",
      currentHead: current.head,
      currentWorld: current.world,
      currentAttestation: current.attestation,
      outcome: { id: "a" },
      claim: { test: true },
      closure: { test: true },
      workResult: { test: true },
    },
  });
  assert.equal(produced.disposition, "APPLIED");
  assert.deepEqual(produced.successorWorld.payload.learned, ["a"]);
  assert.match(produced.successorWorldDigest, /^sha256:[a-f0-9]{64}$/u);
});

test("worker schema identity is session/workspace-addressed rather than one shared filename", async (t) => {
  const { root, initial } = repository(t);
  writeProposalSet(root, initial.head.headDigest, [proposal(root, "a"), proposal(root, "b")]);
  const paths = [];
  await runRepoWorkWave({
    repositoryPath: root,
    env: { ...process.env, META_HARNESS_REPO_WORK_CONCURRENCY: "2" },
    runner: resultRunner({ paths, delayMs: 20 }),
    plannerRunner: plannerRunner([plannerCandidate("a"), plannerCandidate("b")]),
    interpret: fakeInterpretation,
    now: monotonicNow(),
  });
  const directory = stateDirectory(root);
  assert.ok(paths.every((entry) => path.dirname(entry.schemaPath) === directory));
  assert.equal(new Set(paths.map((entry) => entry.schemaPath)).size, 2);
  assert.ok(paths.every((entry) => path.basename(entry.schemaPath) !== "worker-result.schema.json"));
});
