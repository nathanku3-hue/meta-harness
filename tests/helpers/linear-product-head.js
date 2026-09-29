"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const { createOutcome } = require("../../lib/outcome");
const { initializeIntegrationHead, readIntegrationHead } = require("../../lib/optimistic-integration");
const { pinProductDirection } = require("../../lib/product-direction");
const { persistRunSession } = require("../../lib/run-journal");
const { commonGitDirectory } = require("../../lib/work-git");
const { WORK_SESSION_SCHEMA, sealWorkSession } = require("../../lib/work-session");
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

function safeTestNodeRuntime() {
  return "node";
}

function repository(t) {
  const parent = tempDir("linear-product-head-");
  const root = path.join(parent, "repository");
  fs.mkdirSync(root);
  git(root, ["init"]);
  git(root, ["config", "user.name", "Linear Product Head Test"]);
  git(root, ["config", "user.email", "linear-product@example.invalid"]);
  fs.writeFileSync(path.join(root, ".gitignore"), ".worktrees/\n", "utf8");
  for (const id of ["a", "b", "c", "d", "e"]) {
    fs.mkdirSync(path.join(root, "src", id), { recursive: true });
    fs.writeFileSync(path.join(root, "src", id, "baseline.txt"), `${id}\n`, "utf8");
  }
  fs.mkdirSync(path.join(root, "src", "shared"), { recursive: true });
  fs.writeFileSync(path.join(root, "src", "shared", "invariant.txt"), "safe\n", "utf8");
  fs.writeFileSync(path.join(root, "src", "source.txt"), "authoritative\n", "utf8");
  writeProductMd(root);
  writeJson(root, ".meta-harness/repo-charter.json", { ownerPolicy: "linear-product-head-test" });
  writeJson(root, ".meta-harness/validation.json", {
    schemaVersion: "meta-harness-validation/v1",
    commands: [{
      argv: [
        safeTestNodeRuntime(),
        "-e",
        "const fs=require('fs'),p=require('path');let ok=false;function walk(d){for(const n of fs.readdirSync(d)){const f=p.join(d,n),s=fs.statSync(f);if(s.isDirectory())walk(f);else if(n==='result.txt'&&fs.readFileSync(f,'utf8')==='delivered\\n')ok=true}}walk('src');if(!ok)process.exit(7);if(fs.existsSync('src/a/result.txt')&&fs.readFileSync('src/shared/invariant.txt','utf8')!=='safe\\n')process.exit(8)",
      ],
      cwd: ".",
      timeoutSeconds: 60,
    }],
  });
  git(root, ["add", "."]);
  git(root, ["commit", "-m", "baseline"]);
  const baseline = git(root, ["rev-parse", "HEAD"]);
  t.after(() => fs.rmSync(parent, { recursive: true, force: true }));
  return { root, baseline };
}

function persistInitial(root) {
  const baseline = git(root, ["rev-parse", "HEAD"]);
  initializeIntegrationHead({ repositoryPath: root, baseCommit: baseline });
  const productCommit = readIntegrationHead(root);
  return Object.freeze({
    head: Object.freeze({
      productCommit,
      headDigest: null,
      generation: 0,
    }),
  });
}

function proposal(id, { allowedPaths = [`src/${id}`] } = {}) {
  const target = `src/${id}/result.txt`;
  return {
    id,
    productResult: `Deliver ${id}.`,
    journeyState: `Outcome ${id} is not delivered yet.`,
    doNow: `Create ${target} with delivered content.`,
    newlyTrueBehavior: `${target} contains delivered.`,
    doneWhen: `${target} exists and controller validation passes.`,
    stopOnlyIf: ["The claimed write boundary is genuinely insufficient."],
    allowedPaths,
    validation: [{
      argv: [
        safeTestNodeRuntime(),
        "-e",
        `const fs=require('fs');if(fs.readFileSync(${JSON.stringify(target)},'utf8')!=='delivered\\n')process.exit(7)`,
      ],
      cwd: ".",
      timeoutSeconds: 60,
    }],
    maxAttempts: 1,
    delivery: { push: false },
  };
}

function runner({ breakSharedId = null } = {}) {
  return async ({ session }) => {
    const id = /^Deliver ([a-z0-9-]+)\.$/iu.exec(session.productResult)?.[1];
    const operations = [{ type: "WRITE", path: `src/${id}/result.txt`, content: "delivered\n" }];
    if (id === breakSharedId) {
      operations.push({ type: "WRITE", path: "src/shared/invariant.txt", content: "broken\n" });
    }
    return {
      worker: "linear-product-test-runner",
      stdout: "",
      stderr: "",
      result: {
        schemaVersion: "worker-result/v2",
        status: "DONE",
        observableResult: `Prepared ${id}.`,
        operations,
        validation: ["synthetic runner"],
        stop: null,
      },
    };
  };
}

function currentRepoRunSession(root, outcome, id, { baseCommit = null, objectiveRevision = 0 } = {}) {
  const direction = pinProductDirection(root);
  const base = { type: "EXACT_COMMIT", commit: baseCommit || readIntegrationHead(root) };
  const value = proposal(id);
  const session = sealWorkSession({
    schemaVersion: WORK_SESSION_SCHEMA,
    productDirection: direction,
    origin: {
      type: "REPO_RUN",
      outcomeDigest: outcome.outcomeDigest,
      objectiveRevision,
    },
    base,
    productResult: outcome.desiredState,
    journeyState: outcome.preconditions[0],
    doNow: value.doNow,
    newlyTrueBehavior: value.newlyTrueBehavior,
    doneWhen: outcome.evidenceRequirement,
    stopOnlyIf: value.stopOnlyIf,
    allowedPaths: value.allowedPaths,
    validation: value.validation,
    maxAttempts: 1,
    delivery: { push: false },
  });
  return persistRunSession({ gitCommonDirectory: commonGitDirectory(root), session }).session;
}

function monotonicNow() {
  let tick = Date.parse("2026-08-18T03:00:00.000Z");
  return () => {
    const value = new Date(tick);
    tick += 1000;
    return value;
  };
}

function retired(name) {
  return () => {
    throw new Error(`${name} belongs to the retired Claim/World compatibility architecture`);
  };
}

module.exports = {
  createOutcome,
  fakeInterpretation: retired("fakeInterpretation"),
  git,
  historicalRepoRunSession: currentRepoRunSession,
  legacyLearning: retired("legacyLearning"),
  legacySession: retired("legacySession"),
  monotonicNow,
  persistInitial,
  projectionObjects: retired("projectionObjects"),
  proposal,
  repository,
  runner,
  transition: retired("transition"),
  writeProposalSet: retired("writeProposalSet"),
};
