"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { pathToFileURL } = require("node:url");

const { captureExpertResourceLinks } = require("../lib/expert-source-ingress");
const { listActiveOutcomeClaims } = require("../lib/outcome-claim");
const { replaceOwnerObjectiveState } = require("../lib/owner-objective-state");
const { compileRepoPlannerInput } = require("../lib/repo-planner-input");
const { buildLogicalPlannerPrompt } = require("../lib/repo-logical-planner");
const {
  MAX_CURRENT_RESEARCH_SOURCES,
  RESEARCH_PROMOTION_CANDIDATE_SCHEMA_VERSION,
  ensureCurrentResearchPromotions,
  enumerateResearchSourceOccurrences,
  projectCurrentPromotedResearch,
  validateResearchPromotionCandidate,
} = require("../lib/repo-research-promotion");
const { readResearchPromotion } = require("../lib/research-evidence-store");
const { runRepoWorkWave } = require("../lib/repo-work-wave");
const { persistSourceBearingOwnerIngress } = require("../lib/source-bearing-owner-ingress");
const { readCurrentWorldState } = require("../lib/world-transition");
const {
  fakeInterpretation,
  git,
  persistInitial,
  repository,
} = require("./helpers/linear-product-head");

function writeFile(root, relativePath, content) {
  const filePath = path.join(root, ...relativePath.split("/"));
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf8");
}

function commitAll(root, message) {
  git(root, ["add", "-A"]);
  git(root, ["commit", "-m", message]);
  return git(root, ["rev-parse", "HEAD"]);
}

function researchRepository(t, files, { outside = null } = {}) {
  const { root } = repository(t);
  for (const [relativePath, content] of Object.entries(files)) writeFile(root, relativePath, content);
  if (outside) writeFile(root, outside.path, outside.content);
  commitAll(root, "add research fixtures");
  persistInitial(root, "world-transition/v2");
  return root;
}

function currentAtProductCommit(baseCurrent, productCommit) {
  return Object.freeze({
    ...baseCurrent,
    head: Object.freeze({ ...baseCurrent.head, productCommit }),
  });
}

function candidate(findings) {
  return { schemaVersion: RESEARCH_PROMOTION_CANDIDATE_SCHEMA_VERSION, findings };
}

function modelRunner(resultFactory, identity = "test-research-promoter") {
  let calls = 0;
  const run = async (args) => {
    calls += 1;
    const result = typeof resultFactory === "function" ? await resultFactory(args, calls) : resultFactory;
    return {
      model: identity,
      result,
      stdout: "",
      stderr: "",
    };
  };
  run.calls = () => calls;
  return run;
}

function current(root) {
  return readCurrentWorldState(root);
}

test("promoter result stays disposable when drain wins before canonical persistence", async (t) => {
  const root = researchRepository(t, {
    "docs/research/drain.md": "Drain keeps this evidence disposable until persistence.\n",
  });
  const authoritative = current(root);
  const source = enumerateResearchSourceOccurrences({ repositoryPath: root, productCommit: authoritative.head.productCommit })[0];
  const controller = new AbortController();
  const runner = modelRunner(async () => {
    controller.abort();
    return candidate([{
      kind: "FINDING",
      statement: "The source says promotion is disposable until persistence.",
      scope: "general",
      quotes: ["Drain keeps this evidence disposable until persistence."],
    }]);
  });

  await assert.rejects(
    ensureCurrentResearchPromotions({
      repositoryPath: root,
      current: authoritative,
      modelRunner: runner,
      signal: controller.signal,
    }),
    (error) => error.code === "MH_DRAIN_REQUESTED",
  );
  assert.equal(readResearchPromotion(root, source.contentDigest, { optional: true }), null);
});

test("research sources come only from exact committed conventional-root blobs", async (t) => {
  const root = researchRepository(t, {
    "docs/research/current.md": "Committed evidence says the route is bounded.\n",
  }, {
    outside: { path: "notes/chat.md", content: "Tracked but not a research source.\n" },
  });
  const authoritative = current(root);
  writeFile(root, "docs/research/current.md", "DIRTY checkout replacement that must remain invisible.\n");
  writeFile(root, "docs/research/untracked.md", "UNTRACKED owner bytes that must remain invisible.\n");

  const sources = enumerateResearchSourceOccurrences({
    repositoryPath: root,
    productCommit: authoritative.head.productCommit,
  });
  assert.equal(sources.length, 1);
  assert.equal(sources[0].path, "docs/research/current.md");
  assert.equal(sources[0].text, "Committed evidence says the route is bounded.\n");

  const beforeStatus = git(root, ["status", "--porcelain"]);
  const beforeHead = authoritative.head.headDigest;
  const runner = modelRunner(candidate([{
    kind: "FINDING",
    statement: "The source reports that the route is bounded.",
    scope: "the route described by the source",
    quotes: ["Committed evidence says the route is bounded."],
  }]));
  await ensureCurrentResearchPromotions({ repositoryPath: root, current: authoritative, modelRunner: runner });
  assert.equal(runner.calls(), 1);
  assert.equal(current(root).head.headDigest, beforeHead);
  assert.deepEqual(listActiveOutcomeClaims(root), []);
  assert.equal(git(root, ["status", "--porcelain"]), beforeStatus);

  const projected = projectCurrentPromotedResearch({ repositoryPath: root, productCommit: authoritative.head.productCommit });
  assert.equal(projected.length, 1);
  assert.deepEqual(projected[0].source, {
    kind: "REPOSITORY",
    path: "docs/research/current.md",
    blobOid: sources[0].blobOid,
    contentDigest: sources[0].contentDigest,
  });
  const serialized = JSON.stringify(projected);
  assert.equal(serialized.includes("DIRTY checkout replacement"), false);
  assert.equal(serialized.includes("UNTRACKED owner bytes"), false);
  assert.equal(serialized.includes("Tracked but not a research source"), false);
});

test("attribution stores exact unique UTF-8 byte evidence and rejects missing or ambiguous quotes", async (t) => {
  const root = researchRepository(t, {
    "docs/research/exact.md": "prefix UNIQUE α suffix; repeat then repeat.\n",
  });
  const source = enumerateResearchSourceOccurrences({ repositoryPath: root, productCommit: current(root).head.productCommit })[0];
  const runner = modelRunner(candidate([
    {
      kind: "FINDING",
      statement: "The unique evidence is present.",
      scope: "general",
      quotes: ["UNIQUE α"],
    },
    {
      kind: "FINDING",
      statement: "This quote is not exact.",
      scope: "general",
      quotes: ["UNIQUE  α"],
    },
    {
      kind: "FINDING",
      statement: "This quote is ambiguous.",
      scope: "general",
      quotes: ["repeat"],
    },
  ]));
  await ensureCurrentResearchPromotions({ repositoryPath: root, current: current(root), modelRunner: runner });
  const promotion = readResearchPromotion(root, source.contentDigest);
  assert.equal(promotion.findings.length, 1);
  const evidence = promotion.findings[0].evidence[0];
  assert.equal(evidence.quote, "UNIQUE α");
  assert.equal(evidence.byteEnd - evidence.byteStart, Buffer.byteLength("UNIQUE α", "utf8"));
  assert.equal(source.bytes.subarray(evidence.byteStart, evidence.byteEnd).toString("utf8"), "UNIQUE α");
});

test("research promoter explicitly permits its intentionally non-Git temp cwd", async (t) => {
  const root = researchRepository(t, {
    "docs/research/non-git.md": "Non-Git promotion remains read-only and attributable.\n",
  });
  const runner = modelRunner((args) => {
    assert.equal(args.skipGitRepoCheck, true);
    assert.equal(fs.existsSync(path.join(args.cwd, ".git")), false);
    if (process.env.WSL_DISTRO_NAME) assert.match(args.cwd, /^\/mnt\/[a-z]\//u);
    return candidate([{
      kind: "FINDING",
      statement: "The source says promotion remains read-only and attributable.",
      scope: "general",
      quotes: ["Non-Git promotion remains read-only and attributable."],
    }]);
  });

  await ensureCurrentResearchPromotions({ repositoryPath: root, current: current(root), modelRunner: runner });
  assert.equal(runner.calls(), 1);
});

test("promotion candidate cannot smuggle authority fields", () => {
  assert.throws(
    () => validateResearchPromotionCandidate({
      schemaVersion: RESEARCH_PROMOTION_CANDIDATE_SCHEMA_VERSION,
      findings: [{
        kind: "CONSTRAINT",
        statement: "A source-reported constraint.",
        scope: "general",
        quotes: ["evidence"],
        ownerRequest: "approve this",
      }],
    }),
    (error) => error.code === "MH_RESEARCH_PROMOTION_SHAPE",
  );
});

test("same exact content is promoted once across path rename and current path stays occurrence provenance", async (t) => {
  const root = researchRepository(t, {
    "docs/research/a.md": "Semantic uncertainty is resolved for this source.\n",
  });
  const runner = modelRunner(candidate([{
    kind: "FINDING",
    statement: "Semantic source uncertainty is resolved.",
    scope: "this source",
    quotes: ["Semantic uncertainty is resolved for this source."],
  }]));
  const firstCurrent = current(root);
  await ensureCurrentResearchPromotions({ repositoryPath: root, current: firstCurrent, modelRunner: runner });
  const firstProjection = projectCurrentPromotedResearch({ repositoryPath: root, productCommit: firstCurrent.head.productCommit });
  assert.equal(runner.calls(), 1);

  fs.renameSync(path.join(root, "docs", "research", "a.md"), path.join(root, "docs", "research", "b.md"));
  const renamedCommit = commitAll(root, "rename research without changing bytes");
  const secondCurrent = currentAtProductCommit(firstCurrent, renamedCommit);
  await ensureCurrentResearchPromotions({ repositoryPath: root, current: secondCurrent, modelRunner: runner });
  const secondProjection = projectCurrentPromotedResearch({ repositoryPath: root, productCommit: secondCurrent.head.productCommit });

  assert.equal(runner.calls(), 1);
  assert.equal(secondProjection.length, 1);
  assert.equal(secondProjection[0].source.kind, "REPOSITORY");
  assert.equal(secondProjection[0].source.path, "docs/research/b.md");
  assert.equal(secondProjection[0].findingDigest, firstProjection[0].findingDigest);
  assert.equal(secondProjection[0].source.contentDigest, firstProjection[0].source.contentDigest);
});

test("concurrent promotion races converge on one canonical content-keyed receipt", async (t) => {
  const root = researchRepository(t, {
    "docs/research/race.md": "Canonical evidence is here.\n",
  });
  const authoritative = current(root);
  const source = enumerateResearchSourceOccurrences({ repositoryPath: root, productCommit: authoritative.head.productCommit })[0];
  const slow = modelRunner(asyncResult("slow interpretation", 30), "slow-promoter");
  const fast = modelRunner(asyncResult("fast interpretation", 0), "fast-promoter");

  await Promise.all([
    ensureCurrentResearchPromotions({ repositoryPath: root, current: authoritative, modelRunner: slow }),
    ensureCurrentResearchPromotions({ repositoryPath: root, current: authoritative, modelRunner: fast }),
  ]);

  assert.equal(slow.calls(), 1);
  assert.equal(fast.calls(), 1);
  const canonical = readResearchPromotion(root, source.contentDigest);
  assert.equal(canonical.promoterIdentity, "fast-promoter");
  assert.equal(canonical.findings[0].statement, "fast interpretation");
  const projected = projectCurrentPromotedResearch({ repositoryPath: root, productCommit: authoritative.head.productCommit });
  assert.equal(projected[0].statement, "fast interpretation");
});

function asyncResult(statement, delayMs) {
  return async (_args) => {
    if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
    return candidate([{
      kind: "FINDING",
      statement,
      scope: "general",
      quotes: ["Canonical evidence is here."],
    }]);
  };
}

test("source edit replaces current projection while deletion removes it and historical promotion remains", async (t) => {
  const root = researchRepository(t, {
    "docs/research/versioned.md": "Version one evidence.\n",
  });
  const runner = modelRunner((args) => {
    if (args.prompt.includes("Version two evidence.")) {
      return candidate([{
        kind: "DISPROVED_ASSUMPTION",
        statement: "Version two rejects the old assumption.",
        scope: "version two",
        quotes: ["Version two evidence."],
      }]);
    }
    return candidate([{
      kind: "FINDING",
      statement: "Version one remains historical evidence.",
      scope: "version one",
      quotes: ["Version one evidence."],
    }]);
  });

  const firstCurrent = current(root);
  const firstSource = enumerateResearchSourceOccurrences({ repositoryPath: root, productCommit: firstCurrent.head.productCommit })[0];
  await ensureCurrentResearchPromotions({ repositoryPath: root, current: firstCurrent, modelRunner: runner });
  assert.equal(projectCurrentPromotedResearch({ repositoryPath: root, productCommit: firstCurrent.head.productCommit })[0].kind, "FINDING");

  writeFile(root, "docs/research/versioned.md", "Version two evidence.\n");
  const secondCommit = commitAll(root, "edit research source");
  const secondCurrent = currentAtProductCommit(firstCurrent, secondCommit);
  await ensureCurrentResearchPromotions({ repositoryPath: root, current: secondCurrent, modelRunner: runner });
  const secondProjection = projectCurrentPromotedResearch({ repositoryPath: root, productCommit: secondCurrent.head.productCommit });
  assert.equal(runner.calls(), 2);
  assert.equal(secondProjection.length, 1);
  assert.equal(secondProjection[0].kind, "DISPROVED_ASSUMPTION");
  assert.ok(readResearchPromotion(root, firstSource.contentDigest));

  fs.unlinkSync(path.join(root, "docs", "research", "versioned.md"));
  const thirdCommit = commitAll(root, "delete research source");
  const thirdCurrent = currentAtProductCommit(secondCurrent, thirdCommit);
  await ensureCurrentResearchPromotions({ repositoryPath: root, current: thirdCurrent, modelRunner: runner });
  assert.equal(projectCurrentPromotedResearch({ repositoryPath: root, productCommit: thirdCurrent.head.productCommit }).length, 0);
  assert.equal(runner.calls(), 2);
  assert.ok(readResearchPromotion(root, firstSource.contentDigest));
});

test("contradictory current findings coexist with separate attribution", async (t) => {
  const root = researchRepository(t, {
    "docs/research/yes.md": "The source reports X.\n",
    "docs/chats/no.md": "The source reports not-X.\n",
  });
  const runner = modelRunner((args) => args.prompt.includes("not-X")
    ? candidate([{
        kind: "DISPROVED_ASSUMPTION",
        statement: "X is not supported by this source.",
        scope: "this source",
        quotes: ["The source reports not-X."],
      }])
    : candidate([{
        kind: "FINDING",
        statement: "X is supported by this source.",
        scope: "this source",
        quotes: ["The source reports X."],
      }]));
  const authoritative = current(root);
  await ensureCurrentResearchPromotions({ repositoryPath: root, current: authoritative, modelRunner: runner });
  const projected = projectCurrentPromotedResearch({ repositoryPath: root, productCommit: authoritative.head.productCommit });
  assert.equal(projected.length, 2);
  assert.deepEqual(projected.map((entry) => entry.source.path).sort(), ["docs/chats/no.md", "docs/research/yes.md"]);
  assert.deepEqual(new Set(projected.map((entry) => entry.kind)), new Set(["FINDING", "DISPROVED_ASSUMPTION"]));
});

test("expert ingress promotes from retained Git blob and projects truthful EXPERT_INGRESS provenance", async (t) => {
  const { root } = repository(t);
  persistInitial(root, "world-transition/v2");
  const externalPath = path.join(path.dirname(root), "expert-procedure.txt");
  const sourceText = "If uncertainty intervals overlap, preserve INDETERMINATE.";
  fs.writeFileSync(externalPath, sourceText, "utf8");
  const [descriptor] = captureExpertResourceLinks(root, [{
    type: "resource_link",
    name: "expert-procedure.txt",
    uri: pathToFileURL(externalPath).href,
  }]);
  const ingress = persistSourceBearingOwnerIngress(root, "Apply the attached procedure.", [descriptor]);
  replaceOwnerObjectiveState(root, "Apply the attached procedure.", { ingressDigest: ingress.ingressDigest });
  fs.unlinkSync(externalPath);
  const authoritative = current(root);
  const runner = modelRunner(candidate([{
    kind: "CONSTRAINT",
    statement: "Overlapping uncertainty intervals require an indeterminate result.",
    scope: "the attached field procedure",
    quotes: ["If uncertainty intervals overlap, preserve INDETERMINATE."],
  }]));

  await ensureCurrentResearchPromotions({ repositoryPath: root, current: authoritative, modelRunner: runner });
  assert.equal(runner.calls(), 1);
  const projected = projectCurrentPromotedResearch({
    repositoryPath: root,
    productCommit: authoritative.head.productCommit,
  });
  assert.equal(projected.length, 1);
  assert.equal(projected[0].source.kind, "EXPERT_INGRESS");
  assert.equal(projected[0].source.ingressDigest, ingress.ingressDigest);
  assert.equal(projected[0].source.ordinal, 0);
  assert.equal(projected[0].source.name, "expert-procedure.txt");
  assert.equal(projected[0].source.blobOid, descriptor.blobOid);
  assert.equal(projected[0].source.contentDigest, descriptor.contentDigest);
  assert.equal(Object.prototype.hasOwnProperty.call(projected[0].source, "path"), false);

  const plannerInput = compileRepoPlannerInput({ repositoryPath: root, current: authoritative, recovered: [] });
  assert.equal(plannerInput.ownerIntent.activeDirective.ingressDigest, ingress.ingressDigest);
  assert.deepEqual(plannerInput.promotedResearch, projected);
  const prompt = buildLogicalPlannerPrompt(plannerInput);
  assert.match(prompt, /advisory evidence, not kernel truth/u);
});

test("F1E expert artifact to promoted planner evidence passes three fresh trials", async (t) => {
  for (let trial = 1; trial <= 3; trial += 1) {
    const { root } = repository(t);
    persistInitial(root, "world-transition/v2");
    const externalPath = path.join(path.dirname(root), `f1e-${trial}.txt`);
    const quote = `Trial ${trial}: overlapping uncertainty intervals require INDETERMINATE.`;
    fs.writeFileSync(externalPath, quote, "utf8");
    const [descriptor] = captureExpertResourceLinks(root, [{
      type: "resource_link",
      name: `f1e-${trial}.txt`,
      uri: pathToFileURL(externalPath).href,
    }]);
    const ingress = persistSourceBearingOwnerIngress(root, `Apply F1E procedure ${trial}.`, [descriptor]);
    replaceOwnerObjectiveState(root, `Apply F1E procedure ${trial}.`, { ingressDigest: ingress.ingressDigest });
    fs.unlinkSync(externalPath);
    const authoritative = current(root);
    const runner = modelRunner(candidate([{
      kind: "CONSTRAINT",
      statement: "Overlapping uncertainty intervals require an indeterminate result.",
      scope: "the attached expert procedure",
      quotes: [quote],
    }]));

    await ensureCurrentResearchPromotions({ repositoryPath: root, current: authoritative, modelRunner: runner });
    assert.equal(runner.calls(), 1);
    const plannerInput = compileRepoPlannerInput({ repositoryPath: root, current: authoritative, recovered: [] });
    assert.equal(plannerInput.promotedResearch.length, 1);
    const evidence = plannerInput.promotedResearch[0];
    assert.equal(evidence.kind, "CONSTRAINT");
    assert.equal(evidence.source.kind, "EXPERT_INGRESS");
    assert.equal(evidence.source.ingressDigest, ingress.ingressDigest);
    assert.deepEqual(evidence.evidenceQuotes, [quote]);
    assert.equal(plannerInput.ownerIntent.activeDirective.ingressDigest, ingress.ingressDigest);
  }
});

test("later owner objective replacement does not carry prior expert sources forward", async (t) => {
  const { root } = repository(t);
  persistInitial(root, "world-transition/v2");
  const externalPath = path.join(path.dirname(root), "historical-expert.txt");
  const sourceText = "Historical expert evidence must not contaminate a later objective.";
  fs.writeFileSync(externalPath, sourceText, "utf8");
  const [descriptor] = captureExpertResourceLinks(root, [{
    type: "resource_link",
    name: "historical-expert.txt",
    uri: pathToFileURL(externalPath).href,
  }]);
  const ingress = persistSourceBearingOwnerIngress(root, "Use historical expert evidence.", [descriptor]);
  replaceOwnerObjectiveState(root, "Use historical expert evidence.", { ingressDigest: ingress.ingressDigest });
  const runner = modelRunner(candidate([{
    kind: "FINDING",
    statement: "The source is historical expert evidence.",
    scope: "general",
    quotes: [sourceText],
  }]));
  await ensureCurrentResearchPromotions({ repositoryPath: root, current: current(root), modelRunner: runner });
  assert.equal(projectCurrentPromotedResearch({ repositoryPath: root, productCommit: current(root).head.productCommit }).length, 1);

  replaceOwnerObjectiveState(root, "A genuinely new objective without expert sources.");
  const projected = projectCurrentPromotedResearch({ repositoryPath: root, productCommit: current(root).head.productCommit });
  assert.deepEqual(projected, []);
});

test("repository and expert occurrences with identical exact bytes share one promotion but retain truthful provenance", async (t) => {
  const sourceText = "Shared exact source bytes without newline.";
  const root = researchRepository(t, {
    "docs/research/shared.txt": sourceText,
  });
  const externalPath = path.join(path.dirname(root), "shared-expert.txt");
  fs.writeFileSync(externalPath, sourceText, "utf8");
  const [descriptor] = captureExpertResourceLinks(root, [{
    type: "resource_link",
    name: "shared-expert.txt",
    uri: pathToFileURL(externalPath).href,
  }]);
  const ingress = persistSourceBearingOwnerIngress(root, "Use both current sources.", [descriptor]);
  replaceOwnerObjectiveState(root, "Use both current sources.", { ingressDigest: ingress.ingressDigest });
  const authoritative = current(root);
  const repositorySource = enumerateResearchSourceOccurrences({
    repositoryPath: root,
    productCommit: authoritative.head.productCommit,
  })[0];
  assert.equal(descriptor.blobOid, repositorySource.blobOid);
  assert.equal(descriptor.contentDigest, repositorySource.contentDigest);

  const runner = modelRunner(candidate([{
    kind: "FINDING",
    statement: "The exact shared source is present.",
    scope: "general",
    quotes: [sourceText],
  }]));
  await ensureCurrentResearchPromotions({ repositoryPath: root, current: authoritative, modelRunner: runner });
  assert.equal(runner.calls(), 1);

  const projected = projectCurrentPromotedResearch({
    repositoryPath: root,
    productCommit: authoritative.head.productCommit,
  });
  assert.equal(projected.length, 2);
  assert.deepEqual(projected.map((entry) => entry.source.kind), ["REPOSITORY", "EXPERT_INGRESS"]);
  assert.equal(projected[0].findingDigest, projected[1].findingDigest);
  assert.equal(projected[0].source.contentDigest, projected[1].source.contentDigest);
  assert.equal(projected[0].source.path, "docs/research/shared.txt");
  assert.equal(projected[1].source.ingressDigest, ingress.ingressDigest);
});

test("repo work auto-promotes before fresh planner boot and transports compact advisory evidence only", async (t) => {
  const rawTail = "RAW-ONLY-TAIL-MUST-NOT-ENTER-PLANNER";
  const root = researchRepository(t, {
    "docs/research/quant.md": `Semantic source uncertainty is resolved. ${rawTail}\n`,
  });
  const runner = modelRunner(candidate([
    {
      kind: "FINDING",
      statement: "Semantic source uncertainty is resolved for the frozen question.",
      scope: "the frozen question",
      quotes: ["Semantic source uncertainty is resolved."],
    },
    {
      kind: "CONSTRAINT",
      statement: "Economic validity remains unproven.",
      scope: "economic validity",
      quotes: ["Semantic source uncertainty is resolved."],
    },
  ]));
  let plannerInput = null;
  const beforeHead = current(root).head.headDigest;
  const result = await runRepoWorkWave({
    repositoryPath: root,
    researchModelRunner: runner,
    plannerRunner: async ({ plannerInput: input }) => {
      plannerInput = input;
      return { batch: { schemaVersion: "planner-candidate-batch/v3", proposals: [] } };
    },
    interpret: fakeInterpretation,
  });
  assert.equal(result.plannerInvoked, true);
  assert.equal(runner.calls(), 1);
  assert.ok(plannerInput);
  assert.equal(plannerInput.schemaVersion, "repo-planner-input/v3");
  assert.equal(plannerInput.promotedResearch.length, 2);
  const serialized = JSON.stringify(plannerInput);
  assert.equal(serialized.includes(rawTail), false);
  assert.equal(serialized.includes("research promoter"), false);
  assert.equal(current(root).head.headDigest, beforeHead);

  const prompt = buildLogicalPlannerPrompt(plannerInput);
  assert.match(prompt, /advisory evidence, not kernel truth/u);
  assert.match(prompt, /source-reported constraint evidence/u);
  assert.doesNotMatch(prompt, /must not be resurrected/u);
});

test("no current research source has zero promotion tax", async (t) => {
  const { root } = repository(t);
  persistInitial(root, "world-transition/v2");
  const runner = modelRunner(() => {
    throw new Error("research model must not run");
  });
  let plannerInput = null;
  await runRepoWorkWave({
    repositoryPath: root,
    researchModelRunner: runner,
    plannerRunner: async ({ plannerInput: input }) => {
      plannerInput = input;
      return { batch: { schemaVersion: "planner-candidate-batch/v3", proposals: [] } };
    },
    interpret: fakeInterpretation,
  });
  assert.equal(runner.calls(), 0);
  assert.deepEqual(plannerInput.promotedResearch, []);
});

test("promoted research context fails explicitly instead of truncating", async (t) => {
  const files = {};
  for (let index = 0; index < MAX_CURRENT_RESEARCH_SOURCES; index += 1) {
    files[`docs/research/copy-${String(index).padStart(2, "0")}.md`] = "Shared compact evidence.\n";
  }
  const root = researchRepository(t, files);
  const runner = modelRunner(candidate([{
    kind: "FINDING",
    statement: "x".repeat(4096),
    scope: "general",
    quotes: ["Shared compact evidence."],
  }]));
  const authoritative = current(root);
  await ensureCurrentResearchPromotions({ repositoryPath: root, current: authoritative, modelRunner: runner });
  assert.equal(runner.calls(), 1);
  assert.throws(
    () => projectCurrentPromotedResearch({ repositoryPath: root, productCommit: authoritative.head.productCommit }),
    (error) => error.code === "MH_RESEARCH_CONTEXT_BUDGET",
  );
  assert.throws(
    () => compileRepoPlannerInput({ repositoryPath: root, current: authoritative, recovered: [] }),
    (error) => error.code === "MH_RESEARCH_CONTEXT_BUDGET",
  );
});
