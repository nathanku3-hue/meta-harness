"use strict";

const { normalizeEnvelope } = require("./human-handoff");
const { compileTextPresentation } = require("./text-presentation");

const PRESENTATION_SCHEMA = "human-presentation/v1";

function diagramEligible(presentation) {
  return presentation.hasBranches
    && (presentation.shape === "CAUSAL" || presentation.shape === "STATE");
}

function appEligible(presentation) {
  return (presentation.shape === "COMPARISON" && presentation.itemCount >= 4)
    || (presentation.shape === "EVIDENCE" && presentation.hasEvidence && presentation.itemCount >= 6);
}

function selectPresentationKind(presentation) {
  if (presentation.kind === "TEXT") return "TEXT";
  if (presentation.kind === "DIAGRAM") return diagramEligible(presentation) ? "DIAGRAM" : "TEXT";
  if (presentation.kind === "APP") return appEligible(presentation) ? "APP" : "TEXT";
  if (diagramEligible(presentation)) return "DIAGRAM";
  if (appEligible(presentation)) return "APP";
  return "TEXT";
}

function diagramModel(envelope) {
  const nodes = [
    { id: "status", role: "result", label: envelope.status },
    { id: "why", role: "reason", label: envelope.why },
    { id: "next", role: "action", label: envelope.next.action },
    { id: "done", role: "condition", label: envelope.next.doneWhen },
    { id: "unlocks", role: "following-state", label: envelope.next.unlocks },
  ];
  const edges = [
    { from: "status", to: "why", relation: "explained-by" },
    { from: "why", to: "next", relation: "leads-to" },
    { from: "next", to: "done", relation: "complete-when" },
    { from: "done", to: "unlocks", relation: "then" },
  ];
  envelope.next.whyNotOthers.forEach((label, index) => {
    const id = `alternative-${index + 1}`;
    nodes.push({ id, role: "rejected-alternative", label });
    edges.push({ from: "next", to: id, relation: "not-chosen-because" });
  });
  return Object.freeze({
    shape: envelope.presentation.shape,
    nodes: Object.freeze(nodes.map((entry) => Object.freeze(entry))),
    edges: Object.freeze(edges.map((entry) => Object.freeze(entry))),
  });
}

function appModel(envelope) {
  const sections = [
    { id: "result", title: "Result", items: [envelope.status] },
    { id: "reason", title: "Why", items: [envelope.why] },
    {
      id: "next",
      title: "Next",
      items: [
        envelope.next.action,
        envelope.next.where,
        envelope.next.whyNow,
        envelope.next.doneWhen,
        envelope.next.unlocks,
      ],
    },
    { id: "locks", title: "Keep fixed", items: [...envelope.next.locks] },
    { id: "alternatives", title: "Why not other candidates", items: [...envelope.next.whyNotOthers] },
  ];
  if (envelope.humanStopRequired) {
    sections.push({ id: "decision", title: "Decision needed", items: [envelope.decisionQuestion] });
  }
  return Object.freeze({
    shape: envelope.presentation.shape,
    declaredItemCount: envelope.presentation.itemCount,
    hasEvidence: envelope.presentation.hasEvidence,
    sections: Object.freeze(sections.map((section) => Object.freeze({
      ...section,
      items: Object.freeze(section.items),
    }))),
  });
}

function projectHumanHandoff(value) {
  const envelope = normalizeEnvelope(value);
  const kind = selectPresentationKind(envelope.presentation);
  const text = compileTextPresentation(envelope).text;
  let model = null;
  if (kind === "DIAGRAM") model = diagramModel(envelope);
  if (kind === "APP") model = appModel(envelope);
  return Object.freeze({
    schemaVersion: PRESENTATION_SCHEMA,
    kind,
    text,
    model,
  });
}

module.exports = {
  PRESENTATION_SCHEMA,
  appEligible,
  diagramEligible,
  projectHumanHandoff,
  selectPresentationKind,
};
