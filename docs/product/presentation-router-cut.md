# Presentation Router — First Cut

Status: implementation contract for the first user-experience cut
Date: 2026-10-04

## Product problem

Meta-Harness already has durable product truth, validation evidence, and a human handoff boundary. The remaining UX problem is that one textual PM closure must carry every kind of result. Simple completions, causal explanations, multi-branch comparisons, and evidence-heavy outcomes therefore compete for the same prose surface.

The first cut makes presentation a late-bound projection. It does not add a dashboard, a second state machine, a second truth surface, or a new owner decision gate.

## Desired result

    canonical product facts
            |
            v
    HumanHandoffEnvelope
            |
            v
    Presentation Router
       |       |       |
       v       v       v
     text   diagram   interactive
                      app payload

The canonical envelope remains the semantic boundary. Renderers consume it. Renderers never mutate, reinterpret, authorize, block, or supersede product truth.

## Non-negotiable invariants

1. One semantic envelope. Presentation routes are derived only from a validated HumanHandoffEnvelope.
2. Projection is non-authoritative. A route or renderer cannot change status, next action, owner-stop state, validation, Git state, or any durable product fact.
3. Text remains universal fallback. Every valid envelope has a deterministic text rendering. Rich presentation may supplement it; it may never be required to recover meaning.
4. No persistent dashboard. Interactive output is disposable result UI, not a new repository or lifecycle surface.
5. No hidden owner gate. Presentation complexity cannot create a decision request. `humanStopRequired=true` must already be established before routing; Cut 2 renders genuine owner input as `Need input`, not `Decision needed`.
6. No evidence laundering. Machine evidence can be referenced by a rich view only when supplied as bounded presentation evidence; a renderer cannot invent support.
7. Deterministic route from declared cues. The first cut does not ask another model which medium to use.

## First-cut envelope extension

The existing business fields stay canonical. Presentation adds one optional, non-authoritative hint object:

    presentation.kind         = AUTO | TEXT | DIAGRAM | APP
    presentation.shape        = LINEAR | CAUSAL | COMPARISON | STATE | EVIDENCE
    presentation.itemCount    = integer >= 0
    presentation.hasBranches  = boolean
    presentation.hasEvidence  = boolean
    presentation.textMode     = AUTO in Cut 1; specialized by Cut 2

Absence means AUTO with conservative text routing.

These hints describe information shape only. They must not contain lifecycle state, approval, authorization, outcome truth, or executable actions.

## Routing law

The first cut chooses exactly one primary route.

TEXT is the default for compact linear results and remains the universal CLI-safe surface.

DIAGRAM is selected when the envelope explicitly declares a causal or state-shaped result with branching. The first cut emits a bounded renderer-neutral diagram model; it does not require Mermaid, tldraw, or image generation at runtime.

APP is selected when the envelope explicitly declares an interactive comparison/evidence surface with enough items to benefit from filtering or progressive disclosure. The first cut emits a renderer-neutral app payload suitable for a future MCP App resource; it does not install a browser framework or make MCP Apps a runtime dependency.

Conservative AUTO thresholds:

    CAUSAL or STATE + hasBranches           -> DIAGRAM
    COMPARISON + itemCount >= 4             -> APP
    EVIDENCE + hasEvidence + itemCount >= 6 -> APP
    otherwise                               -> TEXT

Explicit TEXT always wins. Explicit DIAGRAM or APP must still satisfy the corresponding structural cue; an invalid rich request falls back to TEXT rather than manufacturing structure.

## Projection contract

Every route returns:

    schemaVersion
    kind
    text
    model

text is always the validated PM-closure text. Cut 2 replaces the expanded form-style text with the compact Text Presentation Compiler while preserving the same envelope. model is null for TEXT. DIAGRAM model contains only presentation nodes and edges derived from envelope fields. APP model contains only display sections and items derived from envelope fields.

No route output is persisted as canonical product state.

## CLI and host behavior

Normal CLI output remains text-first so existing automation, terminals, and logs do not break.

A structured host may receive the presentation projection alongside the canonical envelope. This is the seam for a later MCP App renderer without requiring the core product to know HTML, React, iframe, browser, or host-specific UI APIs.

## First-cut implementation scope

Add a presentation-hint normalizer at the handoff boundary, a pure deterministic presentation router, renderer-neutral DIAGRAM and APP projections, and regression tests proving rich projections cannot alter semantic handoff fields. Ordinary completion must remain text-only by default.

Do not add MCP server registration, HTML or React assets, tldraw, Mermaid, Remotion, browser dependencies, presentation persistence, a new command, a user-visible modality selector, or model-based routing in this cut.

## Done when

The repository can take one validated HumanHandoffEnvelope, deterministically select TEXT/DIAGRAM/APP from bounded presentation cues, always preserve the validated text closure, expose a renderer-neutral rich payload to structured hosts, and pass architecture/regression tests showing that presentation cannot become product authority.
