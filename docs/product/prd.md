# Meta-Harness Product Requirements

Intent authority: [Product Intent Anchor](product-intent.md)
Operating model: [Minimal Outcome Operating Model](minimal-outcome-operating-model.md)
Implementation checklist: [Minimal Outcome System Update Checklist](minimal-outcome-update-checklist.md)

## Product problem

AI coding systems can produce large amounts of correct-looking code, evidence, review, and governance while failing to deliver a real user result quickly. Fresh sessions repeatedly reconstruct intent from prose, worker and auditor sessions both re-plan, dirty checkouts create friction, research expands context, and release proof can precede the first real Product Episode.

## Product result

A solo developer/researcher can state a product outcome, let Meta-Harness create a clean isolated execution environment, complete one real Product Episode, verify the smallest affected system surfaces, and ship or stop with minimal human interruption.

## Normal user flow

```text
PLAN -> WORK -> AUDIT -> CLOSE
```

Optional flows:

```text
PLAN -> RESEARCH -> PLAN
CLOSE or loop-budget breach -> RETROSPECT
```

Handover is generated state, not a separate reasoning round.

## Product Episode

Every slice must name:

- a real user or operator;
- a real task;
- an observable result;
- the decision, understanding, or action enabled by that result;
- the smallest capability missing now;
- the failure that would invalidate the result;
- the stop condition.

Progress is measured by completed Product Episodes, not by plan, code, test, candidate, gate, review, or score counts.

## Proof order

### Product proof

A real user completes the real task and receives a useful, interpretable result.

### System proof

The result comes from the intended shared architecture and preserves relevant invariants, correction, replay, reopen, scale, and supported-environment behavior.

### Release proof

The exact artifact installs and can be published, deployed, reconciled, and rolled back where required.

System and Release proof cannot substitute for missing Product proof.

## Role requirements

### PLAN

- Read current product authority and local repository facts.
- Frame the real product problem.
- Use first-principles, MECE, 5W1H, research, and trade-off analysis only when they change the decision.
- Compare use-as-is, smallest repair, and replace/simplify when the method is uncertain.
- Freeze one Slice Charter.
- Never audit the active implementation in the same invocation.

### WORK

- Preserve the current checkout.
- Create and use a clean isolated worktree.
- State a brief execution plan and perform all reversible work immediately.
- Run the real Product Episode as early as possible.
- Reuse unchanged evidence.
- Never redesign roadmap, acceptance, or score.

### AUDIT

Return exactly one:

- `CONTINUE_CURRENT_SLICE`;
- `ONE_MINIMUM_REPAIR`;
- `REPLAN_CURRENT_METHOD`;
- `CLOSE_SLICE`;
- `STOP_NO_BUILD`.

AUDIT evaluates only the current slice and cannot select a successor.

### RESEARCH

- Open only for one named decision.
- Use primary evidence.
- Put the rejection reason and citation first for rejected repositories.
- Classify candidates as COPY, MODIFY, or REJECT.
- Transfer only the selected Research Decision Record into WORK.

### RETROSPECT

- Run only after closure, route abandonment, repair-budget exhaustion, repeated failure or intervention, major model change, or explicit request.
- Classify harness findings as KEEP, DELETE, SIMPLIFY, TEST, or INVESTIGATE.
- Never reopen the product slice or automatically create harness work.

## Notification and action requirements

The default is notify-first, not approval-first.

- Reversible local work, worktree creation, branch creation, testing, commit creation, and configured branch push proceed automatically and are reported.
- Existing user changes are never stashed, reset, cleaned, overwritten, force-pushed, or mixed into the slice.
- External or irreversible operations are announced before execution and follow configured technical safety boundaries.
- Missing routine owner records, reviewer slots, hierarchy stamps, or status updates do not block a defined reversible Product Episode.

## Git autopilot requirements

Before WORK:

1. detect repository root, actual default branch, upstream, HEAD, dirty state, and existing worktrees;
2. preserve the current checkout exactly;
3. create a clean isolated worktree from the intended base;
4. create a deterministic slice branch;
5. verify exact clean starting state;
6. execute and validate the slice;
7. create one focused commit when coherent;
8. push the exact branch automatically when configured;
9. announce merge, tag, publication, deployment, history rewrite, destructive migration, secret use, or equivalent external effects before action.

## Engineering reasoning requirements

The system must encourage problem-solving language:

- user and missing result;
- observations, inferences, and unknowns;
- causal decomposition;
- credible options;
- real trade-offs;
- cheapest discriminating experiment;
- explicit decision;
- accepted trade-off;
- deliberate deferral;
- smallest executable action;
- change-course condition.

Gate language is reserved for real deterministic or irreversible boundaries.

## Loop economics

- At most one pre-execution audit or repair round.
- At most one repair candidate before mandatory method re-evaluation.
- No automatic successor slice after closure.
- No evidence-only, review-only, packaging-only, documentation-only, status-only, or integration-only product slice.
- No score change unless observable product capability, demonstrated product failure, or terminal shipping state changes.

## Acceptance scenarios

- Leningrad executes the complete real simulation before additional release ceremony.
- Quant completes a real prospective strategy Episode through reopen and explanation.
- DevSpace completes the real conversation-to-conversation product result.
- Eureka closed state returns STOP without successor planning.
- Unchanged evidence is reused.
- A diagnostic closes without universal Product/Domain/Custody ceremony.
- Dirty user work remains untouched while execution occurs in a clean isolated worktree.
- Research transfers a bounded COPY/MODIFY/REJECT decision rather than a broad survey.
- Stronger models can pass historical cases with fewer rules, allowing constraint deletion.

## Non-goals

- universal workflow engines;
- mandatory phase choreography;
- status-driven roadmap generation;
- automatic multi-agent fan-out;
- broad context scoring;
- mandatory expert packets;
- owner-approval waits for reversible work;
- compatibility for obsolete orchestration concepts;
- hooks that make product decisions;
- scores as the primary product surface.
