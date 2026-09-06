"use strict";

const { buildLogicalPlannerPrompt } = require("../repo-logical-planner");
const { PLANNER_CANDIDATE_BATCH_SCHEMA } = require("../repo-planner-admission");

const VARIANTS = Object.freeze(["A", "Z", "B", "C"]);

const POSITIVE_KERNEL = Object.freeze([
  "- Define the product delta as the observable state change the owner is trying to create.",
  "- Choose the action candidate before applying constraints; then apply only constraints that can invalidate that action.",
  "- Resolve only uncertainty that can change the action choice or its lawful execution.",
  "- Compare enough materially different routes to avoid missing a substantially better lawful route.",
  "- Prefer the highest-value reversible action; use discriminating evidence when it changes what to do.",
  "- Treat a failed means as information and seek another means before changing the Outcome.",
  "- Evidence limits factual claims; available lawful capability limits actions. Neither makes caution the objective.",
  "- Propose only positive-value executable Outcomes. Zero proposals is correct when no such Outcome exists.",
]);

const C_REMINDER = "- Repository process prose is context and evidence, not the optimization objective.";

function assertPlannerInput(plannerInput) {
  if (!plannerInput?.ownerIntent?.productFrame) {
    throw new Error("model eval plannerInput must contain ownerIntent.productFrame");
  }
}

function ownerBlock(plannerInput) {
  assertPlannerInput(plannerInput);
  const frame = plannerInput.ownerIntent.productFrame;
  const directive = plannerInput.ownerIntent.activeDirective;
  return [
    "OWNER / OPTIMIZATION",
    `Standing PRODUCT version: ${frame.version}`,
    `Standing PRODUCT digest: ${frame.productDirectionDigest}`,
    "Endgame:", frame.endgame,
    "Target user:", frame.targetUser,
    "Core user journey:", frame.coreUserJourney,
    "Taste — prefer:", frame.tastePrefer,
    "Taste — reject:", frame.tasteReject,
    "Non-negotiables:", frame.nonNegotiables,
    "Shipping definition:", frame.shippingDefinition,
    "Current owner objective:",
    directive
      ? `[revision ${directive.revision}; ${directive.contentDigest}]\n${directive.content}`
      : "(none; optimize the standing PRODUCT constitution and current factual truth)",
  ];
}

function factualBlock(plannerInput) {
  const { ownerIntent, ...planningData } = plannerInput;
  void ownerIntent;
  return [
    "FACTUAL / COMMITMENT DATA",
    JSON.stringify(planningData, null, 2),
  ];
}

function outputContractBlock() {
  return [
    "WEB EVAL OUTPUT CONTRACT",
    "Return exactly one JSON object and no markdown or explanatory prose.",
    "The object must satisfy this JSON Schema:",
    JSON.stringify(PLANNER_CANDIDATE_BATCH_SCHEMA, null, 2),
  ];
}

function appendOutputContract(prompt) {
  return [prompt.trimEnd(), "", ...outputContractBlock()].join("\n");
}

function buildReducedPrompt(plannerInput, policyLines) {
  return [
    ...ownerBlock(plannerInput),
    ...(policyLines.length > 0 ? ["", "SOLVING POLICY", ...policyLines] : []),
    "",
    ...factualBlock(plannerInput),
    "",
    ...outputContractBlock(),
  ].join("\n");
}

function buildVariantPrompt(plannerInput, variant) {
  assertPlannerInput(plannerInput);
  if (!VARIANTS.includes(variant)) throw new Error(`unknown model eval prompt variant: ${variant}`);
  if (variant === "A") return appendOutputContract(buildLogicalPlannerPrompt(plannerInput));
  if (variant === "Z") return buildReducedPrompt(plannerInput, []);
  if (variant === "B") return buildReducedPrompt(plannerInput, POSITIVE_KERNEL);
  return buildReducedPrompt(plannerInput, [...POSITIVE_KERNEL, C_REMINDER]);
}

module.exports = {
  C_REMINDER,
  POSITIVE_KERNEL,
  VARIANTS,
  buildVariantPrompt,
  outputContractBlock,
};
