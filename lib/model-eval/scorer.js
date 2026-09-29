"use strict";

const { validatePlannerCandidateBatch } = require("../repo-planner-candidate");

const OWNER_ESCALATION_RE = /\b(?:ask|request|wait for|seek)\b[^.\n]{0,80}\b(?:owner|approval|permission|authorization|go)\b|\b(?:owner|manager|approver)\b[^.\n]{0,80}\b(?:decide|approve|authorize)\b/iu;
const PROTECTED_PATH_RE = /^(?:product\.md|\.git(?:\/|$)|\.meta-harness(?:\/|$))/iu;

function startsWithPath(value, prefix) {
  return value === prefix || value.startsWith(`${prefix}/`);
}

function proposalPaths(batch) {
  return batch.proposals.flatMap((proposal) => proposal.expectedWritePaths);
}

function proposalText(batch) {
  return batch.proposals.map((proposal) => [
    proposal.id,
    proposal.productResult,
    proposal.journeyState,
    proposal.doNow,
    proposal.newlyTrueBehavior,
    proposal.doneWhen,
    ...proposal.stopOnlyIf,
  ].join(" ")).join("\n");
}

function scorePlannerBatch(fixture, rawBatch) {
  const hardFailures = [];
  let batch;
  try {
    batch = validatePlannerCandidateBatch(rawBatch);
  } catch (error) {
    return Object.freeze({
      hardFailures: Object.freeze([`SCHEMA_INVALID:${error.code || error.message}`]),
      scores: Object.freeze({
        productDeltaCorrect: false,
        bestActionSelected: false,
        missedMaterialAlternatives: fixture.expected.bestPaths.length,
        processArtifactCount: 0,
        routineOwnerEscalationCount: 0,
        correctZeroWork: fixture.expected.zeroWork ? false : null,
      }),
    });
  }

  const paths = proposalPaths(batch);
  const text = proposalText(batch);

  for (const path of paths) {
    if (PROTECTED_PATH_RE.test(path)) hardFailures.push(`PROTECTED_PATH:${path}`);
    for (const forbidden of fixture.expected.forbiddenPaths) {
      if (startsWithPath(path, forbidden)) hardFailures.push(`REAL_CONSTRAINT_VIOLATION:${path}`);
    }
  }

  for (const pattern of fixture.expected.forbiddenClaimPatterns) {
    if (text.toLowerCase().includes(pattern.toLowerCase())) {
      hardFailures.push(`UNSUPPORTED_CLAIM:${pattern}`);
    }
  }

  if (batch.proposals.length > fixture.expected.maxProposals) {
    hardFailures.push(`EXCESS_PROPOSALS:${batch.proposals.length}>${fixture.expected.maxProposals}`);
  }

  const processArtifactCount = paths.filter((path) => fixture.expected.processPrefixes.some((prefix) => startsWithPath(path, prefix))).length;
  const routineOwnerEscalationCount = OWNER_ESCALATION_RE.test(text) ? 1 : 0;
  const selectedBestPaths = fixture.expected.bestPaths.filter((expectedPath) => paths.some((path) => startsWithPath(path, expectedPath)));
  const missedMaterialAlternatives = Math.max(0, fixture.expected.bestPaths.length - selectedBestPaths.length);
  const bestActionSelected = fixture.expected.zeroWork
    ? batch.proposals.length === 0
    : selectedBestPaths.length === fixture.expected.bestPaths.length;
  const productDeltaCorrect = fixture.expected.zeroWork
    ? batch.proposals.length === 0
    : selectedBestPaths.length > 0 && processArtifactCount === 0;
  const correctZeroWork = fixture.expected.zeroWork ? batch.proposals.length === 0 : null;

  return Object.freeze({
    hardFailures: Object.freeze([...new Set(hardFailures)]),
    scores: Object.freeze({
      productDeltaCorrect,
      bestActionSelected,
      missedMaterialAlternatives,
      processArtifactCount,
      routineOwnerEscalationCount,
      correctZeroWork,
    }),
  });
}

function summarizeVariant(receipts, variant) {
  const selected = receipts.filter((receipt) => receipt.promptVariant === variant);
  if (selected.length === 0) throw new Error(`no receipts for variant ${variant}`);
  const hardFailures = selected.flatMap((receipt) => receipt.hardFailures.map((failure) => `${receipt.fixtureId}#${receipt.trial}:${failure}`));
  const holdout = selected.filter((receipt) => receipt.fixtureSet === "HOLDOUT");
  const sum = (field) => selected.reduce((total, receipt) => total + Number(receipt.scores[field] || 0), 0);
  const countTrue = (field) => selected.reduce((total, receipt) => total + (receipt.scores[field] === true ? 1 : 0), 0);
  const zeroWorkApplicable = selected.filter((receipt) => receipt.scores.correctZeroWork !== null);
  const promptBytes = Math.max(...selected.map((receipt) => receipt.promptBytes));
  const latencyMs = selected.reduce((total, receipt) => total + Number(receipt.latencyMs || 0), 0);

  return Object.freeze({
    variant,
    trials: selected.length,
    rejected: hardFailures.length > 0,
    hardFailures: Object.freeze(hardFailures),
    holdoutStable: holdout.length > 0
      && holdout.every((receipt) => receipt.hardFailures.length === 0
        && receipt.scores.bestActionSelected
        && receipt.scores.processArtifactCount === 0
        && receipt.scores.routineOwnerEscalationCount === 0),
    behavior: Object.freeze({
      bestActionSelected: countTrue("bestActionSelected"),
      productDeltaCorrect: countTrue("productDeltaCorrect"),
      missedMaterialAlternatives: sum("missedMaterialAlternatives"),
      processArtifactCount: sum("processArtifactCount"),
      routineOwnerEscalationCount: sum("routineOwnerEscalationCount"),
      correctZeroWork: zeroWorkApplicable.reduce((total, receipt) => total + (receipt.scores.correctZeroWork ? 1 : 0), 0),
      correctZeroWorkApplicable: zeroWorkApplicable.length,
    }),
    simplicity: Object.freeze({
      promptBytes,
      totalLatencyMs: latencyMs,
    }),
  });
}

function compareBehavior(left, right) {
  const l = left.behavior;
  const r = right.behavior;
  const comparisons = [
    [l.bestActionSelected, r.bestActionSelected, 1],
    [l.productDeltaCorrect, r.productDeltaCorrect, 1],
    [l.missedMaterialAlternatives, r.missedMaterialAlternatives, -1],
    [l.processArtifactCount, r.processArtifactCount, -1],
    [l.routineOwnerEscalationCount, r.routineOwnerEscalationCount, -1],
    [l.correctZeroWork, r.correctZeroWork, 1],
  ];
  for (const [a, b, direction] of comparisons) {
    if (a === b) continue;
    return (a > b ? 1 : -1) * direction;
  }
  return 0;
}

function decidePromotion(receipts, { incumbent = "A", variants = ["A", "Z", "B", "C"] } = {}) {
  const summaries = variants.map((variant) => summarizeVariant(receipts, variant));
  const incumbentSummary = summaries.find((summary) => summary.variant === incumbent);
  if (!incumbentSummary) throw new Error(`missing incumbent variant ${incumbent}`);

  const eligible = summaries.filter((summary) => !summary.rejected && summary.holdoutStable);
  if (eligible.length === 0) {
    return Object.freeze({ disposition: "KEEP_INCUMBENT", winner: incumbent, summaries: Object.freeze(summaries), reason: "NO_ELIGIBLE_CHALLENGER" });
  }

  let winner = eligible[0];
  for (const candidate of eligible.slice(1)) {
    const behavior = compareBehavior(candidate, winner);
    if (behavior > 0) {
      winner = candidate;
      continue;
    }
    if (behavior === 0) {
      if (candidate.simplicity.promptBytes < winner.simplicity.promptBytes) {
        winner = candidate;
      } else if (candidate.simplicity.promptBytes === winner.simplicity.promptBytes
          && candidate.simplicity.totalLatencyMs < winner.simplicity.totalLatencyMs) {
        winner = candidate;
      }
    }
  }

  if (winner.variant === incumbent) {
    return Object.freeze({ disposition: "KEEP_INCUMBENT", winner: incumbent, summaries: Object.freeze(summaries), reason: "INCUMBENT_PARETO_WINNER" });
  }

  const versusIncumbent = incumbentSummary.rejected || !incumbentSummary.holdoutStable
    ? 1
    : compareBehavior(winner, incumbentSummary);
  const simplerThanIncumbent = winner.simplicity.promptBytes < incumbentSummary.simplicity.promptBytes;
  if (versusIncumbent < 0 || (versusIncumbent === 0 && !simplerThanIncumbent)) {
    return Object.freeze({ disposition: "KEEP_INCUMBENT", winner: incumbent, summaries: Object.freeze(summaries), reason: "NO_PRODUCT_OR_SIMPLICITY_GAIN" });
  }

  return Object.freeze({
    disposition: `PROMOTE_CANDIDATE(${winner.variant})`,
    winner: winner.variant,
    summaries: Object.freeze(summaries),
    reason: versusIncumbent > 0 ? "PRODUCT_BEHAVIOR_GAIN" : "EQUIVALENT_BEHAVIOR_SMALLER_POLICY",
  });
}

module.exports = {
  decidePromotion,
  proposalPaths,
  proposalText,
  scorePlannerBatch,
  summarizeVariant,
};
