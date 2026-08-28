# Delegation Round 3 v1

Round 3 turns the sealed Round-2 memory/fan-in seam into a bounded autonomous lane lifecycle. It remains an event-driven reconciliation over retained DevSpace tasks and authoritative Meta-Harness World truth. It is not a queue, daemon, swarm, durable scheduler, provider framework, or runtime router.

## Authoritative learning

A result-bearing Round-2 lane is terminal at the DevSpace substrate and becomes one immutable `meta-harness-delegation-learning/v1` observation. The record binds:

```text
delegation + contract identity
→ origin WorldHead + exact context digest
→ lane / Outcome identity
→ retained task + workspace identity
→ lane-brief + boot-prompt digests
→ compact result digest + acceptance card
```

No transcript is admitted. Advisory `worldDelta` remains inside the compact result and is never copied blindly into World.

Meta-Harness supplies the compact learning, immutable Outcome, and the **current** authoritative World/attestation to the repository-owned fixed closure interpreter. A validated successor is committed through `world-transition/v2` cause `DELEGATION_LEARNING`.

`DELEGATION_LEARNING`:

- preserves `WorldHead.productCommit` exactly;
- may advance semantic World while unrelated Outcome Claims or delegation lanes remain active;
- is reinterpreted after World CAS loss rather than rebased mechanically;
- rejects replay of a compact `resultDigest` already present in authoritative World lineage.

Thus accepted external lane evidence may change World truth, but it cannot manufacture canonical product code or impersonate a Claim Closure.

## Living frontier

After each newly landed compact result, and on an explicit reconciliation event, Meta-Harness reconstructs a bounded frontier from:

```text
PRODUCT Endgame
+ current accepted World / WorldHead
+ current gate
+ still-live sealed lane objectives/criteria
+ compact landed-result evidence summaries
+ retained HOLD checkpoint refs
```

A fresh read-only frontier planner must decide every live lane exactly once:

```text
CONTINUE  lane remains positive-value
HOLD      lane remains relevant but should checkpoint and stop consuming capacity
OBSOLETE  current accepted World makes the lane no longer decision-relevant
```

Round 3 cannot mint fresh work. The frontier schema retains `newOutcomes` only as a frozen compatibility field and validation requires it to be exactly empty. Fresh coding authority remains exclusively on the existing logical planner → immutable Outcome → atomic Claim → controller integration path. A delegation lane with Claim history, or a pre-fix writable `r3-*` refill identity, is classified as CODE and fails closed before Round-3 evidence lifecycle or learning can continue.

A result-bearing evidence lane is reported as `CLOSE`; no extra Round-3 host close primitive is required because `lane_submit` is terminal and DevSpace owns page/resource cleanup for result-bearing lanes.

## HOLD continuity

Before a HOLD lane is cancelled, Meta-Harness persists one deterministic `delegation-hold-checkpoint/v1` containing the exact retained DevSpace task/workspace identity, sealed lane/contract/context identities, current WorldHead, current semantic gate, HOLD reason, and bounded evidence refs.

Only after that checkpoint exists may the host call `cancel_lane` for HOLD. The checkpoint does not contain chat history and is not scheduling authority. It is compact continuity/evidence that lets later frontier reasoning rediscover why a still-relevant Outcome stopped consuming live capacity.

OBSOLETE lanes do not receive a HOLD checkpoint; they are cancelled directly because current accepted World says they are no longer decision-relevant.

A continuing lane whose retained DevSpace launch status is `INTERRUPTED` or `FAILED` is resumed through the existing `resume_delegation` substrate rather than replaced with a new scheduler concept.

## Grill

Every executable Round-3 frontier receives one fresh read-only Grill pass before lifecycle action. The Grill may:

```text
ACCEPT   keep the proposed frontier
REPLACE  return one complete corrected frontier now
```

There is no recursive review loop.

The Grill challenges unnecessary decomposition, stale/duplicate lanes, premature owner gates, and bad failure reasoning. In particular:

```text
failed route ≠ failed Outcome
capacity = ceiling, not quota
round boundary ≠ semantic gate
```

The same challenged frontier is used for retained-lane lifecycle action. If WorldHead changes while the frontier planner or Grill is running, the stale frontier is discarded and the full planner→Grill pass retries against the newer current World. After planner + Grill + World recheck, Meta-Harness also force-refreshes the compact DevSpace lane snapshot and compares task, workspace, launch status, and result digest. Any host drift discards the frontier and recomputes before HOLD, OBSOLETE, or resume action executes.

## Gate behavior

The challenged frontier returns one gate:

```text
CONTINUE       autonomous useful work remains; surface nothing to the owner
FORWARD_GATE   no autonomous lane remains and a new semantic forward gate follows
OWNER_DECISION only a typed owner-exclusive choice/access/risk boundary remains
```

Meta-Harness hashes the **post-lifecycle positive-value frontier**: continuing lanes, blockers, and gate semantics; the frozen `newOutcomes` field is always empty. HOLD/OBSOLETE cleanup actions themselves are not part of that owner-facing digest. Therefore completing cleanup does not resurface the same gate.

A non-CONTINUE gate is surfaced only when that semantic frontier digest differs from the previously surfaced digest. Every owner-visible gate is first retained as immutable `delegation-surfaced-frontier/v1` evidence bound to the exact current WorldHead; restart recovers the latest record on current World lineage, so de-duplication never depends on conversation memory. A caller-supplied digest may only agree with retained evidence. Before the record is written, current Head is rechecked so a stale gate fails closed instead of surfacing.

## Host seam

The Round-3 orchestrator maps only to bounded retained-lane DevSpace lifecycle primitives:

```text
getDelegation    → get_delegation { delegationId }
resumeDelegation → resume_delegation { delegationId }
cancelLane       → cancel_lane { delegationId, laneKey }
```

`spawn_delegation` remains a frozen Round-2 substrate primitive for creation of an already-authorized delegation. Round 3 never calls it, derives no writable task brief, and cannot consume released lane capacity as coding authority.

A retained `delegationId` may be supplied instead of a manual snapshot; the orchestrator fetches the compact snapshot itself and re-runs Round-2 binding checks before using it. MCP wrapper results are consumed from `structuredContent`; no transcript or custom host response format is required.

## Round boundary

Round 3 owns semantic lifecycle only. Do not add here:

- a persistent idle worker pool;
- generic scheduling or queues;
- dashboards or swarm coordination;
- arbitrary provider/model routing;
- browser-process/context routing;
- shared Chromium policy;
- full-fidelity owner/UI runtime selection.

Round 4 may optimize only the execution/host seam around this frozen lifecycle: an active invocation may wait on compact retained lane state, and DevSpace may share real Chromium resources, provided neither mechanism creates fresh Outcome/Claim authority or adds a second dispatcher.
