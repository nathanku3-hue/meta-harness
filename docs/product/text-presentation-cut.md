# Text Presentation Compiler — Cut 2

Status: implementation contract for the text-first user-experience cut
Date: 2026-10-04

## Product problem

HumanHandoffEnvelope now separates product meaning from presentation, but the default text projection still renders the entire envelope as a structured status form. That preserves information at the cost of supervision bandwidth: ordinary completion, quiescence, continuation, blockers, and safe stop all expose fields that are useful to machines but unnecessary for the owner's next action.

This cut changes only the text projection. It does not add or expand visualization, HTML, MCP Apps, diagrams, or persistent UI.

## Desired result

    product facts
        |
        v
    HumanHandoffEnvelope        full semantic payload
        |
        v
    Text Presentation Compiler  deterministic projection only
        |
        v
    2-4 owner-facing lines

Compression happens after the semantic envelope. No semantic field is deleted to make the visible text shorter.

## Text modes

The presentation hint gains one non-authoritative field:

    presentation.textMode =
      AUTO
      COMPLETION
      QUIESCENT
      CONTINUATION
      BLOCKER
      OWNER_REQUIRED
      AGGREGATE
      SAFE_STOP

The work-result adapter assigns a mode from already-known machine outcome. The text compiler may not infer or change humanStopRequired, owner-effect kind, next action, result status, or validation state.

## Rendering law

### COMPLETION

    Done — <observable result>
    Next — <next action>

### QUIESCENT

    No current product gap.
    Next — <next action>

### CONTINUATION

    Not done — <current result>
    Next — <next action>

### BLOCKER

    Blocked — <current blocker>
    Next — <next action>

### OWNER_REQUIRED

    Need input — <one concrete question>
    Why — <deterministic reason derived from humanStopReason>
    Then — the same work continues.

### AGGREGATE

    Update — <aggregate product status>
    Next — <next action>

### SAFE_STOP

    Stopped safely — current product state is preserved.
    Next — <next action>

AUTO is a conservative compatibility fallback and renders as a compact update plus next action. It never creates owner attention.

## Clarity law

Default PM text must:

- put the observable result, blocker, or required owner action on line one;
- use at most 4 non-empty lines;
- contain at most one owner question;
- omit Where, Why now, Lock, Done when, Why not other candidates, and other machine-useful envelope fields from ordinary text;
- omit lifecycle, workspace, reviewer, retry, custody, admission, authorization, and internal routing narration;
- never render Decision needed; genuine owner input uses Need input;
- preserve the exact next action rather than inventing a new one;
- remain deterministic and model-free.

The full envelope remains available to structured hosts and audit/debug surfaces.

## Owner-reason mapping

humanStopReason is translated to short product-facing language:

    MATERIAL_PRODUCT_CHOICE       -> This choice changes product behavior.
    SCOPE_EXPANSION               -> This changes the requested scope.
    CREDENTIAL_INPUT              -> The next external step requires credentials.
    PROTECTED_ACCESS              -> The next step requires protected access.
    EXTERNAL_PUBLICATION          -> Publication changes external state.
    DESTRUCTIVE_EXTERNAL_EFFECT   -> The next step can irreversibly change external state.
    ACCEPT_MATERIAL_RISK          -> Continuing requires accepting material risk.
    AMBIGUOUS_NON_REPLAYABLE_EFFECT
                                  -> The external effect cannot be safely inferred or replayed.

Unknown reasons fail closed at the text compiler boundary.

## Separation from rich presentation

Cut 1's renderer-neutral DIAGRAM/APP seam remains available as a future library surface, but the real work-result path explicitly sets `presentation.kind=TEXT` in this cut. No normal product path automatically selects DIAGRAM or APP. The user-visible CLI remains text-only.

## Implementation scope

Add lib/text-presentation.js with a pure compiler and validator. Extend presentation hints with textMode. Route CLI and host text through the compiler while retaining the complete normalized HumanHandoffEnvelope in structured host output. Add golden tests for every text mode and regression tests proving text compression cannot alter semantic envelope fields or owner-stop state.

Do not add Vale, ASD-STE100 tooling, visualization libraries, HTML, browser code, MCP App assets, new commands, or model-based summarization.

## Done when

Ordinary completion is no more than two non-empty lines, owner-required output is no more than three non-empty lines with exactly one question, all default modes are no more than four non-empty lines, normal text contains no known harness-control leakage, the structured host still carries the complete envelope unchanged, and the focused handoff/CLI regression suite passes.
