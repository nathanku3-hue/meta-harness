# EVENT_DRIVEN_RECONCILIATION_1

Status: **IMPLEMENTED / VALIDATED IN WORKING TREE — NOT YET BANKED**

Execution result: terminal Closures now drain before planner boots; local work wakes reconciliation one settlement at a time; authoritative Claim release immediately permits current-Head refill; stale planner batches die on Head change; rejected planner candidates leave no ordinary orphan Outcome; and orchestration telemetry records actual completion→landing and release→redispatch behavior without becoming authority.

## Self-audit of banked Phase 5

`LOGICAL_PLANNER_AUTODISPATCH_1` is banked at `234b5b1` (`Implement logical planner autodispatch`). Git, not the earlier working-tree summary, is the authority for that status.

Architecture self-audit:

```text
Direction       99/100
Aggressiveness  94/100
Elegance        95/100
```

What Phase 5 got right:

- planner is fresh, read-only, disposable, and non-authoritative;
- planner output is semantic-only and exact-or-reject at the capability membrane;
- current `WorldHead.productCommit` mechanically supplies Git ancestry;
- Claim/session visibility remains the durable commitment boundary;
- recovered commitments precede fresh planning;
- durable Closure/forward-motion handoff is reconstructed without chat;
- planner cannot create owner authority;
- compatible planner candidates become Claims/workers without owner routing;
- `.meta-harness/repo-proposals.json` is no longer active ingress;
- worker/planner prompts remain internal;
- the normal owner/source checkout remains outside execution.

Three cuts remain:

### A. Known terminal Closures are not reconciled before planner boot

Current `runRepoWorkWave()` recovers active Claims, reads current World, and may invoke the planner while some recovered Claims are already `CLOSURE` / `closure_awaiting_landing`.

That means the planner can reason from a World that is known to be behind already-durable terminal execution evidence.

The active Claim still protects its write boundary, but semantic planning is unnecessarily stale.

Required law:

> **Before any fresh planner boot, reconcile every terminal durable Closure that can already be authoritatively landed.**

### B. `Promise.all()` creates a whole-wave authority barrier

Current local workers execute concurrently, but the controller waits for every selected `runWork()` promise to settle before landing any Closure.

The repository already records non-authoritative evidence for this defect:

```text
synchronousBarrier.completionSpreadMs
synchronousBarrier.cumulativePostCompletionBarrierMs
frozenCandidateStructuralRefill[]
```

A fast worker may be completely done while:

```text
its Claim remains unreleased
its World learning is not committed
its product integration is not attempted
its local slot cannot be refilled
```

until the slowest sibling returns.

Parallel execution therefore still contains a synchronous post-worker barrier.

### C. Rejected planner candidates can leave inert Outcomes

`preparePlannerCandidate()` currently persists the immutable Outcome before atomic Claim admission.

A candidate later rejected because of an active-Claim conflict/stale admission can therefore leave a durable Outcome object even though Phase 5's intended law is:

```text
planner candidate = disposable possibility
Claim = durable commitment boundary
```

This is not authority corruption—the orphan Outcome is inert—but it is avoidable durable slop and weakens the Phase-5 boundary.

Fold the cleanup into Phase 6. Do not create a separate hygiene slice.

## Product result

Turn the Phase-5 one-shot initial frontier into continuous **within-command** autonomous reconciliation:

```text
current durable truth
→ reconcile terminal Closures first
→ recover active commitments
→ fill unused local capacity
→ workers run concurrently
→ first worker settles
→ land that Closure immediately
→ current World/product Head advances
→ freed capacity is recomputed from durable truth
→ fresh planner wakes only if new possibilities are needed
→ admit/boot newly compatible work
→ repeat until current execution becomes quiescent
```

The owner no longer has to rerun Meta-Harness merely because one worker landed and freed capacity while useful autonomous work remains.

This is **not** a background daemon. The reconciliation loop lives only inside one active `meta-harness work` process. If no controller process is alive, durable Claims/Closures/World remain sufficient for the next invocation to reconstruct the exact continuation.

Core law:

> **Events wake reconciliation; events do not carry authority. Reconciliation always re-derives action from current durable truth.**

## Constitutional slice laws

```text
no queue
no job database
no event log as authority
no scheduler service
no planner session persistence

Closure before planner
current World before proposal
Claim before execution

worker completion is a wake signal
not a command
not durable scheduling state

one authoritative World remains linear
productCommit remains linear
execution remains parallel

planner may wake many times across different authoritative Heads
but at most once for the same unchanged Head in one quiescence epoch

recovered commitments always beat new possibilities

unused planner output dies on Head change

local capacity is controller-local
active Claims remain repository-global conflict authority

quiescence is derived
not persisted
```

## Hard cut 1 — delete the active synchronous `wave` control model

The active orchestrator is still named and structured as one wave:

```text
plan initial frontier
→ Promise.all(all workers)
→ land all closures
→ stop
```

Hard-cut the active path to a reconciliation controller, conceptually:

```text
lib/repo-reconciler.js
```

The primary repo-owned command path should call:

```text
runRepoReconciliation()
```

rather than treating one static wave as the organizational primitive.

`runWork()` remains unchanged as the one-Claim execution transaction.

Do not make `repo-reconciler.js` a monolith. Extract/reuse narrow existing helpers for:

```text
Claim recovery
planner input/admission
execution settlement
Closure landing
telemetry
```

Historical tests may still inspect retained `repo-work-wave-telemetry/v1`; do not preserve a fake active “wave” abstraction solely for naming compatibility.

## Hard cut 2 — terminal Closure drain precedes planning

At command entry and before every planner boot:

```text
read active Claims
→ recover exact Claim/session/workspace state
→ identify durable Closures
→ land every landing-ready Closure one at a time against CURRENT World
→ reread current Head after each committed transition
→ only then compile planner input
```

This applies equally to:

- a Closure created by this controller milliseconds ago;
- a Closure left by a previous crashed controller;
- a Closure created by another controller for another Claim.

If another controller already released/resolved the Claim before this controller lands it:

```text
observe Claim release/current Head
→ treat it as externally reconciled
→ do not fail the whole command
```

The controller must never invoke a fresh planner while knowingly carrying an unlanded terminal Closure that could change planner-relevant World truth.

Landing order is the order closures become reconciliable/observed by the controller. World CAS records the actual linearization. Do not impose an artificial acquiredAt barrier that forces a completed sibling to wait behind a still-running sibling.

Every Closure is still reinterpreted against the current World at its actual landing point, so completion-order concurrency cannot bypass semantic invalidation.

## Hard cut 3 — replace `Promise.all` with an ephemeral running-set

Use an in-memory controller-local set:

```text
running: Map<claimDigest, Promise<execution settlement>>
```

This is not durable state.

Dispatch up to local bound, then wait only for the **next** local execution settlement:

```text
Promise.race(running settlements)
```

When one settles:

```text
remove from local running set
→ recover its exact durable Closure/work result
→ reconcile/land it immediately
→ reread authoritative Head / active Claims
→ refill capacity
```

Other workers continue in their own isolated workspaces throughout landing/planning/refill.

Worker failure must still not cancel siblings.

A locally rejected `runWork()` promise is not automatically equivalent to a hard block. Recover whatever durable Closure the work loop produced and route it through the existing Phase-4/landing semantics. Controller exceptions without recoverable execution evidence remain fail-closed errors.

## Hard cut 4 — reconciliation is a pure recomputation boundary, not persisted trigger state

Do **not** add:

```text
reconciliation-trigger/v1
event queue
work queue
pending-refill records
scheduler cursor
planner wake records
reservation state
```

The wake causes are ordinary in-process observations:

```text
command entry
local worker settlement
successful/aborted Closure landing
World CAS conflict resolved to a newer Head
foreign Claim/Closure state observed during recomputation
```

On every wake:

```text
read current Head
read/recover current active Claims
land ready Closures
compute local running occupancy
compute recoverable executable commitments
compute unused local slots
planner only if slots remain and fresh possibilities are needed
```

If the process dies, all wake history may disappear. Correct continuation must still derive from durable authority objects alone.

## Hard cut 5 — recovered executable commitments fill slots before planner

For each reconciliation pass:

```text
1. drain terminal Closures
2. recover active Claims
3. identify local workers already running in this controller
4. identify RUNNING_ELSEWHERE commitments
5. start recoverable EXECUTABLE commitments until local bound
6. only then consider fresh planner invocation
```

Do not invoke planner merely because a slot appears free while a previously admitted recoverable Claim is waiting.

`RUNNING_ELSEWHERE` remains a repository commitment and a conflict boundary, but does not consume this controller's local execution bound.

## Hard cut 6 — planner wake is keyed to current authoritative Head, not elapsed time

Planner wake condition:

```text
unused local capacity > 0
AND
no recoverable executable commitment can fill it
AND
current Head has not already been planned to quiescence in this controller epoch
```

Planner input is freshly compiled from the current reconciled World/product Head and current active commitments.

No timer/polling cadence is needed.

After a landing advances:

```text
H → H1
```

H1 is a new planning epoch. If capacity exists, planner may run once against H1.

If planner returns zero proposals or all candidates are invalid/conflicting and Head remains H1:

```text
mark H1 planned-to-quiescence in memory
→ do not repeatedly call planner on unchanged truth
```

If another transition later advances H1→H2, the in-memory H1 quiescence mark is irrelevant; H2 may be planned.

The mark is disposable. Restart may call the planner again against H1, which is safe because no Claim existed and planner output is non-authoritative.

## Hard cut 7 — stale planner batches are always discarded on Head change

Phase 5 had a special one-retry pre-Claim rule because planning was one-shot.

Phase 6 replaces that special case with ordinary reconciliation:

```text
planner boot against H
→ H changes before candidate admission
→ discard every remaining candidate from H
→ reread durable truth
→ drain Closures
→ H1 may receive one fresh planner boot if capacity still exists
```

If candidate A from H already became a Claim before H changed:

```text
A remains commitment
remaining unclaimed H candidates die
reconcile H1 around A
```

Never rewrite stale planner candidates onto a newer Head.

## Hard cut 8 — Outcome persistence moves behind admission availability

Fix the Phase-5 durable-slop defect.

Change planner preparation from:

```text
validate candidate
→ persist Outcome
→ compile mechanics
→ attempt Claim
```

to:

```text
validate candidate
→ construct prospective immutable Outcome bytes/digest in memory
→ compile mechanics outside authority lock
→ enter Claim authority boundary
→ prove current Head + duplicate/conflict availability
→ persist immutable Outcome prerequisite
→ persist exact session
→ persist Claim→Session relation
→ persist Claim LAST
```

Ordinary rejected/conflicting/stale candidates should leave **no Outcome object**.

A crash after immutable prerequisites are written but before Claim visibility may still leave inert create-only debris; that is acceptable crash residue and cannot become active work.

Do not add garbage collection in this slice.

Prefer extending the existing `acquireOutcomeClaimSession()` path to accept a prospective validated Outcome rather than creating a second planner-only Claim protocol.

## Hard cut 9 — refill immediately after authoritative release

The key acceptance behavior:

```text
local bound = 2
A + B running
A finishes first
B still running

A Closure lands:
H(P0) → H1(P1)
Claim A released

current local occupancy = 1
→ fresh planner against H1
→ candidate C admitted
→ worker C starts

B never had to finish first
```

C must start from:

```text
session.base.commit = H1.productCommit
```

not P0 and not A's worker BANK branch.

When B later finishes, it is reinterpreted/integrated against whatever current World/product Head exists at that moment.

If A/C changed reality such that B is invalid, B becomes `INVALIDATED_REPLAN` rather than corrupting canonical code.

## Hard cut 10 — quiescence is derived and ends the command

The active reconciliation command stops when all are true:

```text
no local execution is running
no recoverable executable Claim remains
no landing-ready Closure remains
current Head has already received its allowed planner boot
no candidate from that boot was admissible
```

That is **controller quiescence**, not model-authored product terminality.

Do not infer:

```text
USE_PRODUCT
NO_DISPATCH
product complete
```

merely because one planner boot returned no candidate.

Internal result may use a narrow state such as:

```text
QUIESCENT
```

or retain `REPLAN_REQUIRED` if product compatibility requires it, but normal human output must not instruct the owner to rerun the same command merely to perform the reconciliation that just completed.

A validated Phase-4 `OWNER_REQUIRED` remains the only human authority request.

If useful autonomous work continues producing authoritative Head changes, the same command may continue reconciling. No arbitrary fixed “number of waves” should force owner reinvocation.

## Hard cut 11 — event-driven means active-command events, not a daemon

Clarify the roadmap language.

This slice guarantees automatic refill while `meta-harness work` is active and guarantees correct recovery on the next command entry after a crash/process exit.

It does **not** watch external reality forever after the command reaches quiescence.

Do not add:

```text
background daemon
filesystem watcher
cron loop
OS service
message broker
remote scheduler
```

If a future real-use defect proves that external facts changing after quiescence must wake Meta-Harness without invocation, that is a separate observed need.

## Hard cut 12 — telemetry measures the removed barrier, never controls behavior

Keep orchestration telemetry explicitly non-authoritative.

Evolve it to record actual reconciliation behavior, conceptually:

```text
schedulerPolicy: EVENT_DRIVEN_RECONCILIATION
plannerBoots[]
executionSettlements[]
closureLandings[]
refills[]
completionToLandingMs
releasedSlotToRedispatchMs
maxLocalConcurrency
quiescentHeadDigest
```

The existing Phase-5 telemetry remains historical evidence for the synchronous baseline.

Acceptance should prove that the old counterfactual opportunity becomes actual behavior:

```text
Phase 5:
first A completion
→ c structurally fillable only in telemetry
→ no redispatch

Phase 6:
first A completion
→ A lands
→ fresh planner on new Head
→ C actually dispatches before slow B completes
```

Telemetry persistence failure must never block execution authority, just as today.

## Control-flow target

Conceptually:

```text
async function runRepoReconciliation() {
  ensureLinearProductHead()

  const running = new Map()
  const plannedQuiescentHeads = new Set()

  while (true) {
    await drainLandingReadyClosures()

    const current = readCurrentWorldState()
    const commitments = recoverActiveClaims()

    startRecoverableCommitments(running, commitments, localBound)

    if (running.size < localBound) {
      const head = readCurrentWorldState().head
      if (!plannedQuiescentHeads.has(head.headDigest)) {
        const admitted = await planAndAdmitFreshCurrentHeadWork()
        if (admitted === 0) plannedQuiescentHeads.add(head.headDigest)
        startNewlyAdmittedWork(running)
        continue
      }
    }

    if (running.size === 0) {
      if (noReadyClosure() && noRecoverableExecutableClaim()) return QUIESCENT
      continue
    }

    await Promise.race(running.values())
    // settlement is only a wake; loop re-reads durable truth
  }
}
```

Do not trust in-memory result objects as continuity. The loop wakes and then re-reads durable state.

## Concurrency / linearization law

Execution order may be nondeterministic. Authority order is whatever current-World CAS commits.

This is intentional:

```text
A and B run concurrently
B completes first
B may land first
A later reinterprets against World-after-B
```

Do not retain acquiredAt ordering if it means a completed safe Closure must wait for a still-running sibling solely for deterministic aesthetics.

Linear truth plus current-World reinterpretation is the correctness mechanism.

If product semantics require an ordering dependency, it belongs in Outcome preconditions/World interpretation, not in a generic global landing queue.

## Failure handling

### Planner failure

If no Claim became visible and planner process fails:

- no work authority exists from that boot;
- current command may surface a controller/model availability failure rather than fabricate quiescence;
- existing running/recoverable Claims remain unaffected.

Do not cancel siblings.

### Worker process failure

Use the existing work-loop/Closure recovery semantics.

If a durable terminal Closure exists, reconcile it.
If no valid durable Closure can be reconstructed, preserve the fail-closed controller error for that Claim; do not convert it into a planner opinion.

### Landing CAS loss

Existing `landOutcomeClosure()` already rebuilds semantic/integration candidates against current Head.

After it returns/observes the winning current Head, normal reconciliation recomputes capacity and planner need.

### Foreign controller activity

If another controller lands/releases a Claim while this controller is active:

- next reconciliation read observes current authority;
- stale local planner candidates die;
- released Claim is not landed twice;
- no queue ownership transfer is needed.

## Acceptance suite

### 1. Terminal Closure drains before planner

Start command with an active Claim whose durable Closure exists but whose World transition was never committed.

Expected:

```text
Closure lands first
planner sees successor World/product Head
planner never sees pre-Closure currentWorld as its boot truth
```

### 2. Fast sibling lands before slow sibling finishes

Run A+B concurrently with B deliberately slow.

A completes.

Expected before B completion:

```text
A Closure landed
World generation advanced
productCommit includes A
Claim A released
```

No `Promise.all` barrier.

### 3. Freed slot refills before slow sibling finishes

Local bound 2.

First planner boot admits A+B.
A completes while B remains running.
Fresh planner against post-A Head returns C.

Expected:

```text
C Claim/session becomes visible
C worker starts
B still running
```

### 4. Refill uses current cumulative product commit

C from scenario 3 must seal:

```text
session.base.commit == post-A Head.productCommit
```

not initial P0.

### 5. Slow sibling revalidates against later truth

A lands, C lands, then B finishes.

B Closure is interpreted/integrated against current World/product Head after A/C.
If B is no longer applicable, it becomes invalidated/replan and cannot enter canonical product code.

### 6. Recovered Claims beat planner on every pass

A recoverable admitted Claim is waiting while a slot is free.
Reconciliation starts A before invoking planner for that slot.

### 7. No planner spin on unchanged Head

Planner returns zero candidates or only invalid/conflicting candidates for H while no transition occurs.

Expected:

```text
planner invocation count for H == 1
command reaches quiescence
```

### 8. Head advance permits fresh planner boot

Planner already returned zero for H.
A foreign or local authoritative transition advances H→H1.
If capacity exists, planner may run once against H1.

### 9. Stale planner candidates die naturally

Planner boots on H; another landing advances H before admission.
No candidate is rebound.
Reconciliation recomputes from H1 and may plan again.

### 10. Partial stale admission preserves admitted Claims

Candidate A from H becomes Claim.
Head advances before B from same batch.

Expected:

```text
A remains commitment
B dies as stale possibility
reconciliation continues from current Head around A
```

### 11. Rejected candidate leaves no ordinary orphan Outcome

Planner candidate B conflicts with active Claim A.

Expected:

```text
no Claim B
no persisted Outcome B from ordinary rejection
```

Crash-before-Claim inert prerequisites remain acceptable fail-safe debris.

### 12. Restart with terminal Closures requires no event history

Crash after worker Closure, before landing/refill.
Delete all in-memory/controller event state by starting a fresh process.

Expected:

```text
fresh command discovers Closure
lands it
recomputes capacity
fresh planner may refill
```

No reconciliation-trigger record is required.

### 13. Restart with active workers uses Claim/workspace custody only

Fresh command sees live foreign workspace lease:

```text
RUNNING_ELSEWHERE
```

It does not duplicate execution and still plans around the active Claim when local capacity allows.

### 14. One worker failure does not cancel running/refilled siblings

A fails terminally while B and C are running.
A resolves through existing Phase-4/current-World semantics.
B/C continue.

### 15. Owner-required work does not freeze unrelated capacity

A resolves `OWNER_REQUIRED`.
Unrelated capacity remains available.
Planner may propose/dispatch independent B while the validated owner question is retained for human output.

### 16. Hard-blocked work does not freeze unrelated capacity

Same as above for `BLOCKED`, with no owner question.

### 17. No queue/event authority artifacts

After multiple refill rounds, assert no active persistent scheduling structure exists beyond existing Claims/sessions/Closures/World and non-authoritative telemetry.

### 18. Human does not rerun merely for refill

Black-box CLI test:

```text
one invocation
→ initial A+B
→ A lands
→ C automatically starts
→ subsequent progress lands
```

Normal output contains no:

```text
run again
continue
replan manually
start stream C
worker prompt
planner prompt
```

### 19. Source checkout remains owner state

Streaming landing/planning/refill does not change owner checkout HEAD/index/tracked dirt/untracked bytes.

### 20. Existing Phase-1–5 regressions remain green

Claim races, forward motion, linear product integration, planner exact-or-reject boundaries, fresh handoff reconstruction, and owner-authority membrane must remain unchanged.

## Likely implementation surface

Preferred new orchestration module:

```text
lib/repo-reconciler.js
```

Likely extracted/reused helpers:

```text
lib/repo-work-wave.js              # shrink/retire active wave orchestration
lib/repo-work-wave-telemetry.js    # evolve non-authoritative observations
lib/repo-planner-admission.js      # prospective Outcome; persist only on admission
lib/outcome-claim.js               # prospective Outcome support in same Claim/session protocol
lib/commands/work.js               # call reconciler on normal repo-owned path
```

Existing modules expected to remain conceptually unchanged:

```text
lib/work-loop.js                   # one worker / one Claim transaction
lib/repo-outcome-landing.js        # current-World/product CAS landing
lib/repo-logical-planner.js        # one disposable planner boot
lib/repo-planner-input.js          # durable current-frontier projection
lib/repo-product-integration.js    # cumulative canonical product integration
```

Do not grow `repo-work-wave.js` past its current budget. Prefer deleting/moving orchestration into the new reconciler and retaining only reusable primitives/telemetry where justified.

## Deliberately deferred

```text
background daemon / always-on watcher
persistent queue / scheduler database
priority / fairness / preemption
multi-host capacity management
planner conversation persistence
planner-to-worker messaging
research promotion / general ContextCompiler
adaptive SAW review
DRAIN / WAKE
runtime/provider ports
plugin framework
remote publication
Outcome garbage collection for crash-only inert prerequisites
```

Phase 7 remains research/context promotion after this execution loop is closed.

## Roadmap consequence

Phase 6 should be described as **active-command event-driven reconciliation**, not as a background service.

End-state after this slice:

```text
OWNER INTENT
   ↓
CURRENT WORLD / PRODUCT HEAD
   ↓
PLANNER (only when capacity needs possibilities)
   ↓
CLAIMS
   ↓
PARALLEL WORKERS
   ↓ completion wakes
CLOSURE LANDING
   ↓ authoritative Head changes
RECONCILE / REFILL
   └───────────────┐
                   └→ PLANNER only when fresh possibilities are needed
```

Planner remains out of the worker hot path; it is a frontier producer invoked on authoritative state changes when capacity actually needs new work.

## Validation target after implementation

Focused new behavior:

```text
node --test tests/event-driven-reconciliation.test.js
node --test tests/logical-planner-autodispatch.test.js
node --test tests/parallel-outcome-progress.test.js
node --test tests/linear-product-head.test.js
```

Authority/forward-motion regressions:

```text
node --test tests/repo-planner-input.test.js tests/repo-planner-admission.test.js
node --test tests/outcome-claim-authority.test.js tests/execution-permit.test.js
node --test tests/forward-motion-proof.test.js tests/forward-motion-repo-landing.test.js
node --test tests/work-git.test.js tests/work-loop.test.js tests/cli-work.test.js
```

Then reproduce the repository wrapper topology, run `npm pack --dry-run --json`, module-load checks for changed modules, and `git diff --check`. Report any upstream DevSpace 502 separately from repository test verdicts exactly as in Phases 3–5.

## Stop boundary

**Planning only. Stop for architecture audit.**

Do not implement event-driven reconciliation, Promise.race settlement, refill, or prospective Outcome admission in this round.

`PRODUCT.md` is already owner-authored `product-direction-v2` and is not changed by this planning slice.
