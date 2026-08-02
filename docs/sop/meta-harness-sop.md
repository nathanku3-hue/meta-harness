# Meta-Harness 0.4 Outcome-First SOP — Minimal Outcome Target

Intent authority: [Product Intent Anchor](../product/product-intent.md)
Operating model: [Minimal Outcome Operating Model](../product/minimal-outcome-operating-model.md)

## 1. Start with the product problem

State:

- who needs the result;
- what observable result is missing;
- why it matters;
- what is observed now;
- what must remain true.

Separate observations, inferences, and unknowns. Do not begin with gates, phases, candidates, or internal completeness.

## 2. Choose one role

A session is exactly one role:

- PLAN;
- WORK;
- AUDIT;
- conditional RESEARCH;
- conditional RETROSPECT.

PLAN and AUDIT never coexist in one session. WORK never changes roadmap or acceptance. AUDIT never selects a successor. RETROSPECT never creates product authority.

## 3. PLAN

### Inputs

- `docs/product/product-anchor.md`;
- relevant original intent and explicit deviations;
- current closure or observed product problem;
- repository facts;
- relevant Research Decision Records;
- status and reports only as supporting evidence.

### Method

1. define the Product Episode;
2. identify the smallest missing capability;
3. compare use-as-is, smallest repair, and replace/simplify when the route is uncertain;
4. compare time to user value, correctness risk, reversibility, blast radius, permanent complexity, operating burden, evidence reuse, learning value, and cost of delay;
5. run or specify the cheapest discriminating experiment for a material unknown;
6. freeze one Slice Charter or return STOP.

### Output

```text
Problem:
Product claim:
Real Episode:
Observed / inferred / unknown:
Decision:
Why it wins:
Trade-off accepted:
Not solving now:
Smallest executable action:
Change-course condition:
```

Then emit the compact Slice Charter.

## 4. Git autopilot before WORK

1. find repository root;
2. detect current branch, actual default branch, upstream, HEAD, dirty state, and worktrees;
3. preserve the current checkout exactly;
4. select the intended base from product authority and Git facts;
5. create a clean isolated worktree;
6. create a deterministic slice branch;
7. verify clean state and exact base revision;
8. report the isolated path and begin work.

Never auto-stash, reset, clean, overwrite, force-push, rewrite shared history, or mix unrelated user work.

A dirty current checkout is not a blocker. It is a reason to isolate.

## 5. WORK

1. read repository instructions and charter-relevant files;
2. state a brief plan of no more than five lines;
3. perform all reversible charter work immediately;
4. run the smallest real Product Episode as early as possible;
5. repair demonstrated defects inside the charter;
6. validate changed dependency surfaces;
7. reuse passed evidence whose inputs did not change;
8. create one focused commit when the result is coherent;
9. push the exact branch automatically when configured and available;
10. emit a Result Record and concise Result Card.

WORK asks only when a missing fact changes the product claim, material risk, change boundary, or an externally irreversible operation. Ordinary implementation ambiguity is resolved by local evidence, existing patterns, and the smallest reversible choice.

## 6. Product, System, and Release proof

### Product proof first

Run a real Episode and determine:

- did the declared task finish;
- did it produce the intended observable result;
- can the user interpret it;
- does it enable a real decision, understanding, or action;
- is there a demonstrated product defect.

### System proof second

Validate only affected reusable-system behavior:

- shared architecture;
- persistence, correction, replay, idempotence, or reopen where relevant;
- representative scale;
- supported environment;
- changed invariants.

### Release proof third

Validate exact commit and artifact identity, installation, publication, deployment, and rollback only for a product already proven useful.

## 7. AUDIT

Inputs:

- product anchor;
- exact Slice Charter;
- Result Record;
- actual diff;
- affected validation and retained evidence.

Return exactly one:

- `CONTINUE_CURRENT_SLICE` — the current Product Episode still needs an executable step;
- `ONE_MINIMUM_REPAIR` — one demonstrated product problem has a smallest repair;
- `REPLAN_CURRENT_METHOD` — the approach is disproven or repair budget is exhausted;
- `CLOSE_SLICE` — Product, required System, and selected Release proof are satisfied;
- `STOP_NO_BUILD` — no valid work remains.

AUDIT does not select or describe a successor slice.

A finding delays the Episode only when it demonstrates:

- prevention of the real task;
- material invalidation of the result;
- credible irreversible loss;
- supported-environment unusability.

All other findings remain deferred observations.

## 8. Notify-first action policy

Reversible local operations proceed automatically and are reported:

- isolated worktree and branch creation;
- edits;
- tests and local Episodes;
- focused commit creation;
- configured branch push.

External or irreversible actions are announced before execution:

- merge into a shared protected branch;
- tag and package publication;
- production deployment;
- destructive migration or deletion;
- shared-history rewrite;
- secret or credential use;
- financial, legal, or equivalent commitment.

Notification is not an approval wait unless a configured hold exists. Deterministic safety controls may still prevent actions that exceed the configured boundary.

## 9. RESEARCH

Open only when one named decision changes depending on external evidence.

Before research, state:

- decision;
- credible options;
- missing evidence;
- what changes with the answer;
- stop condition.

Output:

```text
Decision:
Recommendation: COPY | MODIFY | REJECT | BUILD
Selected source:
Why it wins:
COPY:
MODIFY:
DO NOT IMPORT:
Resulting constraints:
Resulting tests:
Primary-source citations:
```

For every rejected repository, lead with:

```text
REJECT — <specific disqualifier>. <citation>
```

The worker receives only the selected Research Decision Record.

## 10. RETROSPECT

Run only after:

- slice closure;
- route abandonment;
- repair-budget exhaustion;
- repeated human intervention;
- the same failure in multiple repositories;
- a major model or harness change;
- explicit user request.

Review:

- endgame or product drift;
- velocity drift and over-governance;
- prompt quality;
- harness behavior;
- worker/auditor loop;
- tooling and environment;
- obsolete constraints.

Classify each finding:

- KEEP;
- DELETE;
- SIMPLIFY;
- TEST;
- INVESTIGATE.

Retrospective output is a non-authoritative improvement candidate. It cannot reopen the product slice or add a gate to the next slice automatically.

## 11. Handover

Generate from the charter and result:

```text
Product outcome:
Slice:
Disposition:
Observable result:
Remaining demonstrated problem:
Reusable evidence:
Repair budget remaining:
Notification required:
Next role:
```

Do not summarize the conversation or re-plan the roadmap.

## 12. PM output contract

Normal final chat uses the Result Card, not an internal worker report or orchestrator handover:

```text
Product question:
Real Episode executed:
Observable result:
User learned or can now do:
Result validity:
Demonstrated problem:
Next product action:
```

Omit internal hashes, paths, command logs, allowlists, review schemas, round, progress, confidence, and score unless requested or necessary for an exact release/security boundary.

## 13. H3R2 release compatibility

Until exact H3R2 closes, its accepted release contract remains mechanically valid: locked product intent and owner authority are read before status; status is last and cannot create work; at most one pre-execution audit/repair round is allowed; only journey prevention, material conclusion invalidation, credible irreversible loss, or supported-platform unusability blocks; reuse passed evidence when its input surface is unchanged.

At terminal completion, classify internally as `NO_BUILD` and `USE_PRODUCT`. An owner scope change or an observed supported-use defect warrant may justify later work, but this SOP must never claim post-closure successor activation. Existing H3R2 worker reports retain the five product fields. Run the complete suite once, use one clean canary, and reuse the exact artifact. Never install directly into dirty checkouts.

This compatibility paragraph closes 0.4 only; it does not restore approval-first reversible work or make old release ceremony the 0.5 normal loop.

## 14. Loop budgets

- one pre-execution audit or repair round maximum;
- one repair candidate maximum before method re-evaluation;
- no automatic successor after closure;
- no evidence-only or lifecycle-fragment product slice;
- no score change without observable product capability, demonstrated problem, or terminal shipping-state change.

## 15. Constraint lifecycle

Use the lightest effective mechanism:

```text
model judgment
-> repository fact
-> role skill
-> regression test
-> deterministic hook
-> sandbox or external boundary
```

Each retained non-security constraint records origin, regression, last demonstrated value, and deletion condition. Challenge constraints after major model upgrades and at least quarterly.

## 16. Stop

After Product value and selected terminal state are complete:

```text
No active slice.
Use the product.
Wait for observed real-use friction.
```
