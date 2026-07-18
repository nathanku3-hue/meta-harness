# Problem-Solving Questions

Status: canonical product questions
Date: 2026-07-17
Intent authority: [Product Intent Anchor](product-intent.md)
Roadmap authority: [Roadmap](roadmap.md)

These are the high-value questions the product must answer. They are not rhetorical. A capability is not solved until its stated proof condition passes on real work.

## Q-001 — Can an AI lose the original intent in a complex system?

**Answer:** Yes.

It can happen through:

- repeated summary and handoff compression;
- local defect or audit findings displacing the product outcome;
- long planning chains optimizing the latest artifact rather than the human goal;
- independent modules being locally correct while the global product direction drifts;
- internal governance becoming easier to measure than product shipping.

**Current mitigation:** frozen intent anchor, audit-before-plan separation, explicit intent alignment in every RunSpec and outcome, and drift blocking.

**Solved only when:** fresh planners across long and interrupted runs continue to recommend actions aligned with the locked intent, including adversarial cases where local governance work is tempting but does not block the active product slice.

## Q-002 — After code is audited, can the orchestrator overreact and turn defects into the roadmap?

**Answer:** Yes. This is audit gravity.

The auditor-planner must operate in two passes:

1. freeze diagnosis and evidence;
2. re-read original intent, compare three alternatives, then choose the next slice.

Planning priority is:

1. ship the current objective;
2. unlock its critical path;
3. reduce uncertainty blocking that path;
4. fix defects threatening that path;
5. improve the harness only when required by items 1–4.

**Solved only when:** evaluation cases show that non-blocking code quality, governance, and tooling findings do not displace a higher-value product slice.

## Q-003 — When the system is too complex for one context window, can AI retain a full grasp of the project?

**Answer:** Not by reading the whole repository or relying on conversation memory.

The tractable target is not complete simultaneous recall. It is correct progressive reconstruction from:

- frozen intent;
- objective and system maps;
- behavior-to-code localization;
- relevant contracts and invariants;
- canonical state and evidence;
- a role-specific context packet;
- validated handoff and continuation cursor.

**Solved only when:** a fresh worker can identify the correct behavior, affected modules, invariants, next operation, and stop rule without broad repository reconstruction or human clarification.

## Q-004 — Does a code graphification or code-graph plugin solve the problem?

**Answer:** Partially.

It can help solve **complexity collapse** by locating behavior across modules, entry points, state, contracts, tests, and downstream consumers.

It does not by itself solve:

- original-intent drift;
- context amnesia;
- authority;
- stale facts;
- wrong priorities;
- shipping definition;
- audit anchoring;
- invalid handoffs.

A code graph is a comprehension projection, not product authority. It must be source-verified, freshness-bound, and subordinate to the intent and canonical fact layers.

**Solved only when:** behavior-map use improves planning quality and reduces reconstruction cost on cross-module tasks without introducing stale-map errors.

## Q-005 — Is a handoff a summary?

**Answer:** No.

A handoff is a validated state transition containing identity, versions, authority, repository state, progress cursor, decisions, assumptions, evidence, exact continuation, recovery, and expiry.

A receiver must independently restate:

- objective;
- current state;
- completed work;
- unfinished work;
- exact next operation;
- forbidden actions;
- completion condition.

The controller compares this response with the handoff. Mismatch blocks continuation.

**Solved only when:** a fresh process resumes after compaction, crash, user interruption, or provider failure with no duplicate work, silent constraint loss, or conversation reconstruction.

## Q-006 — What does maximum velocity mean?

**Answer:** Verified movement toward a shipped product outcome per unit of calendar time and human attention.

It does not mean:

- maximum patches;
- maximum tokens;
- maximum agents;
- maximum tests;
- maximum governance artifacts;
- minimum context at the cost of incorrect action.

Measure:

- problem-to-shipping elapsed time;
- time to first correct action after handoff;
- verified slice throughput;
- human gate latency;
- rework;
- escaped defects;
- shipping effect;
- cost and review burden.

## Q-007 — When is governance work justified?

**Answer:** When a current product slice cannot ship safely or truthfully without it.

Every harness-internal recommendation must name:

- the blocked product slice;
- the exact failure mode;
- the smallest repair;
- the proof that the repair unlocks shipping.

No answer means defer.

## Q-008 — When should the worker wait?

**Answer:** Only at a named gate.

Wait for:

- missing authority;
- product taste;
- material risk acceptance;
- meaningful scope expansion;
- an irreversible commitment;
- evidence that invalidates the approved RunSpec.

Do not wait for routine reversible implementation already covered by the authorization envelope.

## Q-009 — When should multiple agents be used?

**Answer:** Only when decomposition, isolation, and integration economics are favorable.

Required conditions:

- single-worker handoff and resume already work;
- work units have disjoint writes or read-only roles;
- ownership leases prevent duplication;
- outputs have independent acceptance checks;
- integration order is deterministic;
- expected latency gain exceeds coordination and merge cost.

More adapters are not orchestration.

## Q-010 — How do we know an auditor is independent?

**Answer:** Role labels are insufficient.

The verifier should initially receive the locked intent, RunSpec, clean base, candidate diff, observable output, and acceptance contract—not the builder's private reasoning or preferred conclusion.

Record:

- model and tool identity;
- context received;
- whether expected answers were disclosed;
- whether tests were builder-authored;
- whether the verifier could mutate the result.

## Q-011 — Can a run fail but still contain valuable work?

**Answer:** Yes.

Classify the result as:

- `DISCARD`;
- `EVIDENCE_ONLY`;
- `REUSABLE_ANALYSIS`;
- `VALID_SUBRESULT`;
- `REPAIRABLE_CANDIDATE`;
- `EXTERNALLY_BLOCKED_COMPLETE_RESULT`.

**Solved only when:** later work reuses valid partial results without promoting incomplete work or repeating expensive analysis.

## Q-012 — How do we prevent split-brain work?

**Answer:** One controller owns active work-unit leases.

A resume must prove:

- no newer handoff exists;
- no competing active lease exists;
- repository identity and state match;
- authorization remains valid;
- no human override supersedes the work;
- the result was not already completed elsewhere.

## Q-013 — Can tests pass while the work is still bad?

**Answer:** Yes.

The audit separately evaluates:

- product behavior;
- evidence strength;
- process quality;
- exploration waste;
- blind retries;
- plan-to-diff drift;
- cross-module invariants;
- maintenance and rework burden;
- actual shipping state.

## Q-014 — How should research affect the product?

**Answer:** Research is incomplete until accepted knowledge becomes a requirement, constraint, test, benchmark, risk, decision, product claim, or implementation rule.

Every material claim records provenance, freshness, confidence, contradiction status, and affected product surface.

A report alone is not product progress unless the requested product is the report.

## Q-015 — What may deviate aggressively?

**Answer:** Roadmap, architecture, implementation method, agent substrate, and module boundaries may change aggressively when evidence shows a faster path to the locked endgame.

The following may not drift silently:

- product intent;
- priority order;
- authority;
- shipping definition;
- material risk;
- evidence standards;
- current factual state.

Every deviation records reason, expected product benefit, affected slices, and rollback or supersession rule.

## Q-016 — When is the system allowed to claim SOTA?

**Answer:** Only after measured production proof.

Required evidence includes:

- at least three real multi-module product outcomes;
- coding and research both affecting shipped behavior;
- zero undetected authoritative contradictions;
- reliable fresh-worker continuation;
- lower problem-to-shipping time than the baseline;
- fewer routine human interventions;
- no increase in escaped defects or rework;
- measurable benefit from any multi-agent fan-out;
- holdout-tested recommendation improvement.

Until then, the correct claim is: **credible SOTA research direction, not yet a proven SOTA system**.
