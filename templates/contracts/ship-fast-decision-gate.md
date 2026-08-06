# Outcome-First Ship-Fast Decision Gate

Status: Meta-Harness 0.4 distributable contract
Scope: planner and artifact behavior.

## Truth precedence

Read and reconcile in this order:

1. locked product intent and explicit owner authority;
2. immutable product, mechanics, package, proof, publication, and closure evidence;
3. Git facts;
4. status, roadmap prose, worker reports, and summaries.

Lower-precedence text cannot create a slice, reopen a passed gate, or weaken owner-authorized acceptance.

## Select the nearest product action

Before planning, state:

```text
Product result: <observable user outcome>
Current journey state: <not run|partially run|complete>
Primary action: <one nearest action>
```

Default pre-execution audit count: zero.

Begin the nearest reversible in-scope action in the same round. A request to audit, review, or plan does not imply a pause. Unless the owner explicitly requests report-only work or says not to execute, perform any warranted diagnostic inline and continue toward execution.

A pre-execution audit is permitted only when a complete audit warrant identifies:

1. one concrete unresolved fact;
2. the exact retained evidence already checked;
3. one potential impact: journey prevention, material conclusion invalidation, credible irreversible loss, or supported-platform unusability;
4. the smallest bounded check whose result changes the selected action;
5. how either result changes that action.

Missing any field means no audit. One audit is the absolute ceiling. It is not a route, phase, approval requirement, gate, or reason to defer reversible execution.

Do not request GO, plan approval, routine permission, or blanket ambiguity confirmation for reversible in-scope work. Do not split implementation, validation, integration, packaging, review, or closure into successor product slices merely because they are separate lifecycle stages.

## Fresh Web execution flow

When fresh-conversation launch capability is available and the owner has requested its use:

- accept at most one user-authored message before the first implementation action;
- launch the worker conversation directly with the exact sealed task brief;
- require zero manual orchestrator-to-worker copy/paste handoffs;
- require zero mandatory pre-execution audit chats and zero blanket ambiguity confirmations;
- require the worker to begin an actual reversible in-scope change in its first round;
- retain `taskId` as the only required continuation input for later fresh worker conversations;
- open an auditor conversation only after changed bytes or an observable result exist and a complete audit warrant is recorded.

A blocked or unavailable launcher must be reported as unverified Web-flow evidence. It does not turn reversible repository implementation into an owner approval gate.

## Blocking test

A finding blocks only when retained evidence demonstrates one of:

- journey prevention;
- material conclusion invalidation;
- credible irreversible loss;
- supported-platform unusability.

Preferences, optional improvements, stale status, extra review, cleanliness that does not threaten the authorized journey, and unchanged passed gates are non-blocking. Keep them as residue without delaying the primary action.

## Evidence reuse

Reuse a passed gate when none of its declared input bytes changed. Rerun only the affected gate unless new concrete evidence demonstrates a product-relevant defect. Reviewer preference alone is insufficient.

## Terminal continuation

When shipping is complete, value is confirmed, maintenance is active, or no active slice exists:

- default: `NO_BUILD` and `USE_PRODUCT`;
- explicit owner scope change: `OWNER_DECISION_REQUIRED` and `REQUEST_OWNER_AUTHORIZATION`;
- complete observed supported-use defect warrant: `BUILD_RECOMMENDED` and `SELECT_SMALLEST_REPAIR`.

A defect warrant must name the observed behavior, supported environment, user impact, retained evidence, and smallest repair. Incomplete warrants return `NO_BUILD`. Never claim post-closure successor activation, queue a follow-up after `NO_BUILD`, or invent a new review/evidence gate.

## Output

Return the primary action first, followed only by demonstrated blockers and one executable next step. Status and audit detail are supporting evidence, not the work.
