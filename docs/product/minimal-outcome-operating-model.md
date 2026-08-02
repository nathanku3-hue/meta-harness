# Minimal Outcome Operating Model

Status: owner-directed target after Meta-Harness 0.4 closure

## Product purpose

Meta-Harness helps one solo developer/researcher turn an endgame product objective into real, observable user results with minimum friction and permanent process.

The normal loop is:

```text
PLAN -> WORK -> AUDIT -> CLOSE
```

Optional side lanes exist only when the active product decision requires them:

```text
PLAN -> RESEARCH -> PLAN
CLOSE or loop-budget breach -> RETROSPECT
```

`HANDOVER` is a generated state artifact, not a reasoning round.

## Core mental model

Use an Outcome-first Evidence Loop:

```text
product problem
-> real user episode
-> observable result
-> smallest missing capability
-> smallest implementation
-> run the real episode
-> repair one demonstrated defect
-> prove system behavior
-> prove release behavior
-> stop and use the product
```

This is neither gate-first nor code-first.

- Gate-first proves procedure before knowing whether the product is useful.
- Code-first accumulates implementation without a falsifiable product claim.
- Outcome-first starts with a real episode and adds only the code and proof needed to make its result useful, valid, reusable, and releasable.

## Product claim

Every slice begins with:

```text
We believe <smallest capability>
will let <real user or operator>
complete <real task>
and produce <observable result>
that enables <decision, understanding, or action>.
```

Code belongs in the slice only when it:

- enables the real episode;
- repairs an observed episode defect;
- prevents material misinterpretation of the result;
- preserves, reopens, replays, or verifies the result;
- makes a supported environment usable.

Speculative frameworks, hypothetical consumers, parallel paths, internal elegance, and optional reviewer preferences remain outside the active slice.

## Three proof levels

### Product proof

Prove that a real user completed a real task and received a useful, interpretable result.

Examples:

- Leningrad: run the complete declared simulation, verify the retained bundle, inspect the report, and learn what persisted, coexisted, or disappeared.
- Quant: complete a prospective paper strategy episode from evidence and thesis through decision, portfolio transition, fills, accounting, reopen, and explanation.
- DevSpace: complete the real conversation-to-conversation action and return a useful structured result.

Internal tests, fixtures, schemas, hashes, packages, and reports cannot substitute for Product proof.

### System proof

After Product proof, demonstrate that the result came from the intended reusable system:

- shared architecture rather than a demo-only path;
- correction, replay, idempotence, and fresh-process reopen where relevant;
- representative scale and supported environments;
- critical invariants and changed dependency surfaces;
- no parallel engine or storage stack created for one fixture.

### Release proof

After Product and System proof, demonstrate exact distribution and operation:

- exact commit and artifact identity;
- clean supported-runtime installation;
- necessary cross-platform behavior;
- publication and deployment identity;
- rollback and blast-radius controls where material.

Release proof protects a proven product. It does not create product value.

## Product Episode

The primary unit of progress is a Product Episode:

> A real user, in a supported environment, completes the declared task, receives an observable result, and can make the next product or domain decision from it.

Measure:

- time to first real Episode;
- Episode completion rate;
- user decision utility;
- audit or repair rounds before the first Episode;
- evidence reuse rate;
- required human interruptions;
- escaped product defects;
- permanent complexity added or deleted.

Do not lead with commits, tests, candidates, gates, reviews, or aggregate scores.

## Roles

### PLAN

Frames the product problem, compares credible approaches, and freezes one active slice.

PLAN may use first-principles reasoning, MECE decomposition, 5W1H, build/borrow research, and trade-off analysis only when they change the decision.

PLAN does not audit an active implementation in the same invocation.

### WORK

Executes the frozen slice immediately in a clean isolated worktree. It reads local files, states a brief plan, performs all reversible work, and runs the real Episode as early as possible.

WORK does not redesign the roadmap, change acceptance, add process, or update product score.

### AUDIT

Evaluates only the current slice and returns one disposition:

- `CONTINUE_CURRENT_SLICE`;
- `ONE_MINIMUM_REPAIR`;
- `REPLAN_CURRENT_METHOD`;
- `CLOSE_SLICE`;
- `STOP_NO_BUILD`.

AUDIT does not select a successor slice.

### RESEARCH

Runs only for one named decision whose answer changes architecture, acceptance, security, dependency choice, benchmark, or implementation.

Research output is rejection-first and decision-shaped:

- `COPY`;
- `MODIFY`;
- `REJECT`;
- exact constraints and tests entering the slice.

The worker receives only the selected Research Decision Record, not the full survey.

### RETROSPECT

Runs only after slice closure, route abandonment, repair-budget exhaustion, repeated human intervention, repeated cross-repository failure, or explicit request.

It classifies Meta-Harness findings as:

- `KEEP`;
- `DELETE`;
- `SIMPLIFY`;
- `TEST`;
- `INVESTIGATE`.

It cannot reopen the product slice or automatically create harness work.

## Handover

Handover is generated from the active slice and result:

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

It preserves state without reinterpreting intent or planning another slice.

## Engineering language

Default vocabulary:

- problem;
- observation;
- inference;
- unknown;
- cause;
- constraint;
- option;
- trade-off;
- experiment;
- decision;
- result;
- smallest correction;
- next Episode.

Use gate, authority, custody, and closure language only for deterministic security, exact artifact identity, irreversible external actions, secret access, financial or legal commitments, or material production blast radius.

## Engineering reasoning

When the method is uncertain:

1. identify the user and missing observable result;
2. separate observations, inferences, and unknowns;
3. decompose by causal system behavior rather than files or teams;
4. compare use-as-is, smallest repair, and replace or simplify;
5. compare time to value, correctness risk, reversibility, blast radius, permanent complexity, operational burden, evidence reuse, learning value, and cost of delay;
6. run the cheapest discriminating experiment;
7. decide, execute, and state what evidence would change the decision.

Frameworks are optional tools, not required ceremony.

## Notification and protected action policy

The normal system is notify-first, not approval-first.

- Reversible repository work, branch creation, isolated worktree creation, testing, commit creation, and branch push proceed automatically and are reported.
- Existing user changes are never stashed, reset, cleaned, overwritten, or mixed into the slice.
- Merge, tag, publication, deployment, destructive migration, secret use, financial commitment, and other externally irreversible actions are announced before execution and follow the configured safety boundary.
- The product loop does not stop merely because an owner decision record, hierarchy stamp, reviewer slot, or status update is absent when the action is reversible and the product result is already defined.

## Clean-worktree and Git autopilot

Before WORK:

1. identify repository root and intended base;
2. inspect current branch, upstream, HEAD, worktrees, and dirty state;
3. preserve the current checkout exactly;
4. create a clean isolated worktree from the intended base;
5. create a deterministic slice branch;
6. verify clean state and starting revision;
7. execute the slice;
8. run affected validation and the real Episode;
9. create one focused commit when the result is coherent;
10. push the exact branch when remote access exists;
11. report integration readiness and any external action before performing it.

Never auto-stash, auto-reset, auto-clean, force-push, rewrite shared history, or use a dirty checkout as the execution target.

## Loop economics

Defaults:

- one pre-execution audit or repair round maximum;
- one product repair candidate maximum before mandatory method re-evaluation;
- no evidence-only successor slice;
- no automatic PLAN after closure;
- no score change unless observable product capability, demonstrated blocker, or terminal shipping state changes.

After success:

```text
No active slice.
Use the product.
Wait for observed real-use friction.
```

## Future-proof constraint policy

Models own reversible judgment. Tests own correctness. Skills own reusable procedures. Hooks own deterministic invariants. Sandboxes and external controls own blast radius.

Every non-security constraint must have:

- originating failure;
- smallest protected behavior;
- regression fixture;
- last demonstrated value;
- deletion condition.

Challenge constraints after major model upgrades, at least quarterly, or when a rule has not affected several real slices. Delete rules whose removal causes no material regression.
