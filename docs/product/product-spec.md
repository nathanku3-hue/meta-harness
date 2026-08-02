# Meta-Harness Product Specification

Intent authority: [Product Intent Anchor](product-intent.md)
Operating model: [Minimal Outcome Operating Model](minimal-outcome-operating-model.md)

## Product result

A fresh session can resume one product outcome without reconstructing the roadmap, execute in a clean isolated worktree, run the real Product Episode early, reuse unchanged evidence, and stop after a useful result without automatic successor work.

## Active control loop

```text
PLAN -> WORK -> AUDIT -> CLOSE
```

Conditional lanes:

```text
PLAN -> RESEARCH -> PLAN
CLOSE or budget breach -> RETROSPECT
```

`HANDOVER` is generated from the Slice Charter and Result Record.

## Context surfaces

### Product anchor

`docs/product/product-anchor.md` is the concise active product authority loaded by routine fresh sessions. It contains only:

- endgame outcome;
- current frontier;
- explicit non-goals;
- current shipping state;
- explicit roadmap deviations;
- configured irreversible-action notifications.

Status, events, reports, and summaries are projections or historical evidence. They cannot create roadmap work.

### Slice Charter

One compact charter contains:

- slice identifier and starting revision;
- user and product claim;
- real Product Episode;
- current journey state;
- smallest executable action;
- observable success conditions;
- authorized change boundary;
- reusable evidence;
- changed dependency surfaces;
- demonstrated problems;
- repair budget remaining;
- notification points;
- stop conditions.

### Result Record

One compact result contains:

- exact charter identity;
- starting and ending revision;
- whether the Episode executed;
- observable result;
- user decision or action enabled;
- demonstrated problem;
- changed paths;
- validations actually run;
- evidence reused;
- assumptions and deviations;
- external action notification, if any.

## Product acceptance

### Product proof

A real user in a supported environment completes the declared task and receives an interpretable result that changes understanding, decision, or action.

### System proof

The result is produced by the intended shared system and preserves affected invariants, correction, replay, reopen, representative scale, and supported-environment behavior.

### Release proof

The exact artifact is installable and its publication, deployment, reconciliation, and rollback behavior is demonstrated where required.

No later proof level can compensate for an absent earlier proof level.

## Role behavior

### PLAN

- Load product anchor, relevant local files, current closure or observed defect, and Git facts.
- Separate observed facts, inferences, and unknowns.
- Use adaptive first-principles engineering reasoning.
- Freeze one charter or return STOP.
- Do not audit current implementation.

### WORK

- Run Git autopilot before edits.
- Use a clean isolated worktree.
- Execute all reversible charter work without routine approval waits.
- Run the Product Episode before optional hardening.
- Never modify roadmap or acceptance.

### AUDIT

- Compare Product anchor, exact charter, Result Record, diff, and affected evidence.
- Reuse all unaffected passed evidence.
- Return one current-slice disposition only.
- Never plan a successor.

### RESEARCH

A Research Decision Record contains:

- named decision;
- credible options;
- selected COPY/MODIFY/REJECT disposition;
- rejection-first citations;
- exact patterns or files to reuse;
- deliberate modifications;
- components not to import;
- resulting constraints and tests.

### RETROSPECT

A retrospective produces only non-authoritative harness candidates with observed failure, cost caused, smallest correction, expected measurable improvement, and implementation trigger.

## Git autopilot

The system shall:

1. inspect root, default branch, upstream, HEAD, dirty state, and worktrees;
2. preserve the current checkout byte-for-byte;
3. create a clean isolated worktree from the intended base;
4. create a deterministic slice branch;
5. execute, validate, commit, and configured-push from that worktree;
6. never auto-stash, reset, clean, force-push, rewrite shared history, or mix unrelated user work;
7. detect actual default branch rather than assuming `main`;
8. integrate repositories separately;
9. reuse the exact proven package for rollout.

## Notify-first action policy

Reversible local work proceeds automatically and is reported.

External or irreversible actions are announced before execution. Deterministic hard prevention remains only for secret exposure, destructive mutation, history rewrite, publication or deployment blast radius, financial or legal commitment, or equivalent irreversible effect.

Notification must not become an implicit approval wait unless the user configured a hold.

## Engineering language

Normal outputs use:

- problem;
- user;
- observation;
- inference;
- unknown;
- cause;
- option;
- trade-off;
- experiment;
- decision;
- result;
- smallest correction;
- next Episode.

Use gate, authority, custody, candidate, and closure terminology only where exact security, artifact identity, or irreversible action requires it.

## H3R2 worker-report compatibility

The existing 0.4 runtime retains these first five non-empty worker-report fields:

```text
User journey executed:
Observable result produced:
User accomplished or learned:
Product blocker:
Next executable product action:
```

Reports must not begin with `# Worker PM Brief`, a title, hash, command log, reviewer note, or status field. The 0.5 target uses the Result Card below for normal user-facing output while keeping exhaustive evidence separate.

## Result Card

Normal user-facing output is:

```text
Product question:
Real Episode executed:
Observable result:
User learned or can now do:
Result validity:
Demonstrated problem:
Next product action:
```

Omit empty lines and internal metadata. Detailed hashes, commands, paths, checks, review packets, and accountability fields remain available on request.

## Constraint lifecycle

Every retained non-security instruction, hook, phase, report, or gate must record:

- originating failure;
- protected behavior;
- regression fixture;
- last demonstrated value;
- deletion condition.

Challenge the full constraint set after major model upgrades and at least quarterly. Remove constraints whose absence does not cause a material product, correctness, or safety regression.

## Compatibility policy

No backward compatibility is required for superseded orchestration concepts, phase choreography, score-first reports, automatic successor planning, or approval-first reversible work. Historical evidence remains readable where useful, but old process semantics do not remain active.
