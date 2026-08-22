"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const { createOutcome, persistOutcome } = require("../../lib/outcome");
const { acquireOutcomeClaimSession } = require("../../lib/outcome-claim");
const { pinProductDirection } = require("../../lib/product-direction");
const { compileSemanticAuthority, endgameProjection, semanticProjection } = require("../../lib/semantic-authority");
const { loadRepoCharter } = require("../../lib/repo-proposal-set");
const { compileProductProofSpec } = require("../../lib/work-proof-compiler");
const { WORK_SESSION_SCHEMA, sealWorkSession } = require("../../lib/work-session");
const { computeRepoWorldDigest, computeWorldAttestationDigest, rawDigest } = require("../../lib/world-attestation");
const { persistImmutableBytes, persistImmutableJson, readImmutableJson } = require("../../lib/world-authority");
const {
  commitTransition,
  computeInterpretationDigest,
  computeWorldProjectionDigest,
  computeWorldTransitionDigest,
  validateWorldTransition,
} = require("../../lib/world-transition");
const { tempDir } = require("./cli");
const { writeProductMd } = require("./product-direction");

function git(cwd, args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", windowsHide: true });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || `git ${args.join(" ")} failed`);
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
    '"use strict";', 'const fs=require("node:fs");', 'const path=require("node:path");',
    'const c=JSON.parse(fs.readFileSync(process.env.META_HARNESS_CONTRACT_PATH,"utf8"));',
    'const m=/^Deliver ([a-z0-9-]+)\\.?$/iu.exec(c.productResult); if(!m)process.exit(40); const id=m[1];',
    'const target=path.join(process.env.META_HARNESS_CANDIDATE_ROOT,"src",id,"result.txt");',
    'if(!fs.existsSync(target)||fs.readFileSync(target,"utf8")!=="delivered\\n")process.exit(41);',
    'if(id==="a"){const p=path.join(process.env.META_HARNESS_CANDIDATE_ROOT,"src","shared","invariant.txt");if(!fs.existsSync(p)||fs.readFileSync(p,"utf8")!=="safe\\n")process.exit(42);}',
    "",
  ].join("\n");
}

function interpreterProgram() {
  return [
    '"use strict";', 'const crypto=require("node:crypto");', 'const fs=require("node:fs");',
    'function c(v){if(v===null||["boolean","number","string"].includes(typeof v))return JSON.stringify(v);if(Array.isArray(v))return`[${v.map(c).join(",")}]`;return`{${Object.keys(v).sort().map(k=>`${JSON.stringify(k)}:${c(v[k])}`).join(",")}}`}',
    'function d(domain,v){return`sha256:${crypto.createHash("sha256").update(`${domain}\\u001e${c(v)}`,"utf8").digest("hex")}`}',
    'const i=JSON.parse(fs.readFileSync(0,"utf8")); const learned=Array.isArray(i.currentWorld.payload.learned)?[...i.currentWorld.payload.learned]:[]; const replans=Array.isArray(i.currentWorld.payload.replans)?[...i.currentWorld.payload.replans]:[]; const bad=Boolean(i.integrationFailure);',
    'const payload=bad?{...i.currentWorld.payload,replans:[...replans,i.outcome.id]}:{...i.currentWorld.payload,learned:[...learned,i.outcome.id]};',
    'const successorWorld={schemaVersion:"repo-world/v2",productDirectionDigest:i.currentWorld.productDirectionDigest,payload}; const worldDigest=d("meta-harness-repo-world/v2",successorWorld);',
    'const b={schemaVersion:"world-attestation/v1",worldDigest,projectorDigest:i.currentAttestation.projectorDigest,sources:i.currentAttestation.sources,generatedAt:new Date().toISOString()}; const successorAttestation={...b,attestationDigest:d("meta-harness-world-attestation/v1",b)};',
    'process.stdout.write(JSON.stringify({schemaVersion:"repo-closure-interpretation/v1",disposition:bad?"INVALIDATED_REPLAN":"APPLIED",interpretation:bad?{integrationFailure:i.integrationFailure}:{learnedOutcome:i.outcome.id},successorWorld,successorAttestation}));',
    "",
  ].join("\n");
}

function repository(t) {
  const parent = tempDir("linear-product-head-");
  const root = path.join(parent, "repository");
  fs.mkdirSync(root); git(root, ["init"]); git(root, ["config", "user.name", "Linear Product Head Test"]); git(root, ["config", "user.email", "linear-product@example.invalid"]);
  fs.writeFileSync(path.join(root, ".gitignore"), ".worktrees/\n", "utf8");
  for (const id of ["a", "b", "c"]) { fs.mkdirSync(path.join(root, "src", id), { recursive: true }); fs.writeFileSync(path.join(root, "src", id, "baseline.txt"), `${id}\n`, "utf8"); }
  fs.mkdirSync(path.join(root, "src", "shared"), { recursive: true }); fs.writeFileSync(path.join(root, "src", "shared", "invariant.txt"), "safe\n", "utf8");
  fs.writeFileSync(path.join(root, "src", "source.txt"), "authoritative\n", "utf8"); writeProductMd(root);
  writeJson(root, ".meta-harness/repo-charter.json", { ownerPolicy: "linear-product-head-test" });
  writeJson(root, ".meta-harness/validation.json", { schemaVersion: "meta-harness-validation/v1", commands: [{ argv: [process.execPath, "-e", "const fs=require('fs'),p=require('path');let ok=false;function walk(d){for(const n of fs.readdirSync(d)){const f=p.join(d,n),s=fs.statSync(f);if(s.isDirectory())walk(f);else if(n==='result.txt'&&fs.readFileSync(f,'utf8')==='delivered\\n')ok=true}}walk('src');if(!ok)process.exit(7)"], cwd: ".", timeoutSeconds: 60 }] });
  fs.writeFileSync(path.join(root, ".meta-harness", "product-proof.js"), proofProgram(), "utf8");
  writeJson(root, ".meta-harness/product-proof.json", { schemaVersion: "product-proof-policy/v2", programPath: ".meta-harness/product-proof.js", runtime: process.execPath, timeoutSeconds: 30, claims: [{ id: "delivered-result", statement: "The delivered result and retained product invariants hold.", baselineExpectation: "FAIL", covers: ["productResult", "newlyTrueBehavior", "doneWhen"] }] });
  fs.writeFileSync(path.join(root, ".meta-harness", "closure-interpreter.js"), interpreterProgram(), "utf8"); git(root, ["add", "."]); git(root, ["commit", "-m", "baseline"]);
  t.after(() => fs.rmSync(parent, { recursive: true, force: true }));
  return { root, baseline: git(root, ["rev-parse", "HEAD"]) };
}

function sourceObservation(root) {
  return { type: "LOCAL_FILE", sourceId: "linear-source", path: "src/source.txt", digest: rawDigest(fs.readFileSync(path.join(root, "src", "source.txt"))), observedAt: "2026-08-18T00:00:00.000Z", validUntil: "2099-01-01T00:00:00.000Z" };
}

function projectionObjects(root, payload, generatedAt = "2026-08-18T01:00:00.000Z") {
  const direction = pinProductDirection(root); const world = { schemaVersion: "repo-world/v2", productDirectionDigest: direction.digest, payload }; const worldDigest = computeRepoWorldDigest(world);
  const body = { schemaVersion: "world-attestation/v1", worldDigest, projectorDigest: `sha256:${"7".repeat(64)}`, sources: [sourceObservation(root)], generatedAt }; const attestation = { ...body, attestationDigest: computeWorldAttestationDigest(body) };
  persistImmutableJson(root, "worlds", worldDigest, world, "TEST_WORLD"); persistImmutableJson(root, "attestations", attestation.attestationDigest, attestation, "TEST_ATTESTATION"); return { world, worldDigest, attestation };
}

function transition(root, predecessorHeadDigest, successor, { schemaVersion = "world-transition/v2", cause = null, productCommit = null } = {}) {
  const predecessor = predecessorHeadDigest ? readImmutableJson(root, "heads", predecessorHeadDigest) : null;
  const body = { schemaVersion, predecessorHeadDigest, cause: cause || { type: "REALITY_REFRESH", projectionDigest: computeWorldProjectionDigest(successor.worldDigest, successor.attestation.attestationDigest) }, successorWorldDigest: successor.worldDigest, successorAttestationDigest: successor.attestation.attestationDigest, ...(schemaVersion === "world-transition/v2" ? { successorProductCommit: productCommit || predecessor?.productCommit || git(root, ["rev-parse", "HEAD"]) } : {}) };
  return validateWorldTransition({ ...body, transitionDigest: computeWorldTransitionDigest(body) });
}

function persistInitial(root, schemaVersion) {
  const successor = projectionObjects(root, { learned: [], replans: [] });
  const applied = commitTransition(root, transition(root, null, successor, { schemaVersion }));
  return { ...successor, head: applied.head };
}

function proposal(id, { allowedPaths = [`src/${id}`] } = {}) {
  const target = `src/${id}/result.txt`;
  return { id, productResult: `Deliver ${id}.`, journeyState: `Outcome ${id} is not delivered yet.`, doNow: `Create ${target} with delivered content.`, newlyTrueBehavior: `${target} contains delivered.`, doneWhen: `${target} exists and controller validation passes.`, stopOnlyIf: ["The claimed write boundary is genuinely insufficient."], allowedPaths, validation: [{ argv: [process.execPath, "-e", `const fs=require('fs');if(fs.readFileSync(${JSON.stringify(target)},'utf8')!=='delivered\\n')process.exit(7)`], cwd: ".", timeoutSeconds: 60 }], maxAttempts: 1, delivery: { commit: false, push: false } };
}

function writeProposalSet(root, headDigest, proposals) {
  const direction = pinProductDirection(root); const charter = loadRepoCharter(root);
  return writeJson(root, ".meta-harness/repo-proposals.json", { schemaVersion: "repo-proposal-set/v2", productDirectionDigest: direction.digest, charterDigest: charter.digest, worldHeadDigest: headDigest, ownerDirectiveDigest: null, proposals });
}

function monotonicNow() { let tick = Date.parse("2026-08-18T03:00:00.000Z"); return () => { const value = new Date(tick); tick += 1000; return value; }; }

function fakeInterpretation({ input, now }) {
  const learned = Array.isArray(input.currentWorld.payload.learned) ? [...input.currentWorld.payload.learned] : []; const replans = Array.isArray(input.currentWorld.payload.replans) ? [...input.currentWorld.payload.replans] : []; const bad = Boolean(input.integrationFailure);
  const payload = bad ? { ...input.currentWorld.payload, replans: [...replans, input.outcome.id] } : { ...input.currentWorld.payload, learned: [...learned, input.outcome.id] }; const successorWorld = { schemaVersion: "repo-world/v2", productDirectionDigest: input.currentWorld.productDirectionDigest, payload }; const worldDigest = computeRepoWorldDigest(successorWorld); const body = { schemaVersion: "world-attestation/v1", worldDigest, projectorDigest: input.currentAttestation.projectorDigest, sources: input.currentAttestation.sources, generatedAt: now.toISOString() };
  return { schemaVersion: "repo-closure-interpretation/v1", disposition: bad ? "INVALIDATED_REPLAN" : "APPLIED", interpretation: bad ? { integrationFailure: input.integrationFailure } : { learnedOutcome: input.outcome.id }, successorWorld, successorAttestation: { ...body, attestationDigest: computeWorldAttestationDigest(body) } };
}

function runner({ breakSharedId = null } = {}) {
  return async ({ session }) => { const id = /^Deliver ([a-z0-9-]+)\.$/iu.exec(session.productResult)?.[1]; const operations = [{ type: "WRITE", path: `src/${id}/result.txt`, content: "delivered\n" }]; if (id === breakSharedId) operations.push({ type: "WRITE", path: "src/shared/invariant.txt", content: "broken\n" }); return { worker: "linear-product-test-runner", stdout: "", stderr: "", result: { schemaVersion: "worker-result/v2", status: "DONE", observableResult: `Prepared ${id}.`, operations, validation: ["synthetic runner"], stop: null } }; };
}

function legacySession(root, outcome, headDigest, id) {
  const direction = pinProductDirection(root);
  const semanticAuthority = compileSemanticAuthority({ productDirection: direction });
  const base = { type: "EXACT_COMMIT", commit: git(root, ["rev-parse", "HEAD"]) };
  const value = proposal(id);
  const productProofSpec = compileProductProofSpec({
    repositoryPath: root,
    productDirection: direction,
    base,
    productResult: value.productResult,
    newlyTrueBehavior: value.newlyTrueBehavior,
    doneWhen: value.doneWhen,
    allowModel: false,
  });
  return acquireOutcomeClaimSession({
    repositoryPath: root,
    outcomeDigest: outcome.outcomeDigest,
    originWorldHeadDigest: headDigest,
    executionBoundary: { writePaths: value.allowedPaths },
    buildSession: (claim) => sealWorkSession({
      schemaVersion: WORK_SESSION_SCHEMA,
      productDirection: direction,
      semanticState: semanticAuthority.semanticState,
      semanticProjection: semanticProjection(semanticAuthority),
      endgameProjection: endgameProjection(semanticAuthority),
      origin: { type: "REPO_OUTCOME", outcomeDigest: outcome.outcomeDigest, claimDigest: claim.claimDigest },
      base,
      productResult: value.productResult,
      journeyState: value.journeyState,
      doNow: value.doNow,
      newlyTrueBehavior: value.newlyTrueBehavior,
      doneWhen: value.doneWhen,
      productProofSpec,
      stopOnlyIf: value.stopOnlyIf,
      authorizedReversibleActions: ["Edit only the claimed write boundary.", "Run validation."],
      ownerOnlyActions: ["Expand product scope."],
      allowedPaths: value.allowedPaths,
      validation: value.validation,
      maxAttempts: 1,
      delivery: value.delivery,
    }),
  });
}

function legacyLearning(root, predecessorHeadDigest, closure, payload, now = new Date("2026-08-18T04:00:00.000Z")) {
  const successor = projectionObjects(root, payload, now.toISOString()); const bytes = Buffer.from(`${JSON.stringify({ disposition: "APPLIED", learned: closure.origin.outcomeDigest })}\n`, "utf8"); const interpretationDigest = computeInterpretationDigest(bytes); persistImmutableBytes(root, "interpretations", interpretationDigest, bytes, "TEST_INTERPRETATION");
  return commitTransition(root, transition(root, predecessorHeadDigest, successor, { schemaVersion: "world-transition/v1", cause: { type: "ATTEMPT_LEARNING", executionClosureDigest: closure.closureDigest, interpretationDigest } }));
}

module.exports = {
  createOutcome, fakeInterpretation, git, legacyLearning, legacySession, monotonicNow, persistInitial,
  persistOutcome, projectionObjects, proposal, repository, runner, transition, writeProposalSet,
};
