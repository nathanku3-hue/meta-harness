# PARALLEL_OUTCOME_PROGRESS_1

Status: **IMPLEMENTED AND VALIDATED — WORKING TREE; NOT COMMITTED**

## Product result

Turn the banked Outcome/Claim authority into complete parallel product progress rather than merely concurrent worker activity.

After this slice:

- durable active Claims are recovered before mutable proposal state is consulted;
- one World-bound proposal snapshot may create additional compatible Claims;
- every **new** Claim proves under the World authority lock that its origin Head is still current;
- each visible new Claim already has enough durable session identity to survive process death even if the mutable proposal later disappears;
- several Claim-bound `work-session/v7` executions may run concurrently in isolated managed worktrees;
- each worker produces one independent ExecutionClosure;
- successful sibling Closures are re-interpreted against the **current** authoritative World and serialize through ordinary World CAS;
- mutable repository proposals cannot author terminal product inactivity.

The completed user journey for this slice is therefore:

```text
durable active Claims
    → recover commitments first

current World
+ current repo proposal snapshot
    → claim additional compatible Outcomes

recovered + new sessions
    → bounded concurrent runWork()
    → independent Closures
    → current-World re-interpretation
    → serialized ATTEMPT_LEARNING
    → linear authoritative World
```

This is still not a queue, daemon, continuous scheduler, planner runtime, generic MVCC engine, or resource allocator.

## Audit corrections incorporated

The returned architecture audit changed the prior `PARALLEL_OUTCOME_WAVE_1` plan in five material ways.

### 1. Proposals are possibilities; Claims are commitments

Active Claims are enumerated and recovered **before** the current proposal artifact is read.

Deleting, reordering, or replacing a mutable proposal may prevent new Claims. It may not cancel an already-active Claim.

### 2. New Claim creation requires current truth

The current `outcome-claim.js` proves only that `originWorldHeadDigest` names an immutable historical Head. That is insufficient for new admission once controllers race.

New Claim creation must, under the same World authority lock used for conflict admission, require:

```text
currentWorldHeadDigest == originWorldHeadDigest
```

An existing Claim does **not** gain that continuing equality requirement.

```text
NEW Claim
    → must originate from current H

EXISTING Claim
    → may survive unrelated H → H1
```

### 3. Active `repo-decision` is deleted as a concept

The mutable active artifact is no longer a Decision. It is an ordered proposal snapshot.

Hard cut:

```text
active .meta-harness/repo-decision.json / repo-decision/v3
→ .meta-harness/repo-proposals.json / repo-proposal-set/v1
```

Immutable historical `repo-decision/v3` evidence remains readable only for legacy `REPO_DECISION` AttemptEntry / ExecutionClosure recovery.

No proposal digest becomes Outcome, Claim, session, permit, or World authority.

### 4. Parallel work is not complete until successful Closures land

The previous plan stopped after concurrent workers and durable Closures. That creates a lifecycle fragment where successful work can remain stranded outside current World.

This slice now includes the minimum landing rule:

```text
parallel execution
    ↓
independent Closure
    ↓
re-evaluate the Claim's declared basis against CURRENT World
    ↓
produce fresh current-Head-bound repo interpretation / successor candidate
    ↓
World CAS
```

The current `preconditionDigest` is **not** treated as a digest of observed facts. Live code shows it hashes only the Outcome's declared precondition strings. Therefore equality of `preconditionDigest` is not sufficient revalidation.

Domain applicability remains repository intelligence. The kernel's job is to bind that re-interpretation to the exact Claim, Closure, and current WorldHead, then serialize the accepted transition.

### 5. Model-authored terminal inactivity dies now

Active repo intelligence no longer emits `NO_DISPATCH` / `WAIT_EXTERNAL` / `NO_VALUABLE_ACTION` / `USE_PRODUCT` as terminal authority.

An empty proposal set means:

```text
no new proposal supplied
→ REPLAN_REQUIRED / reconciliation needed
```

not:

```text
model prose
→ No active slice
→ Use the product
```

The true terminal `No active slice` route remains a kernel/product conclusion only when durable evidence establishes the repository is actually in terminal no-active-work state. The active proposal artifact cannot author that conclusion.

## Constitutional slice laws

```text
Outcome = durable work identity
Claim = temporary organizational commitment
work-session = sealed execution brief
workspace lease = runtime custody
Closure = durable execution result
World = linear authoritative truth

proposals may create commitments
proposals may not cancel commitments

new commitment requires current truth
existing commitment survives unrelated truth advancement

one worker
one Claim
one work-session
one workspace
one Closure

execution may overlap
World commits serialize

successful Closure is not product-complete
until its learning is reconciled against current World

failed means ≠ failed outcome
empty proposals ≠ terminal product inactivity

no queue
no daemon
no mutable wave state
no worker-to-worker messaging
no planner hot path
```

## Target control flow

```text
meta-harness work
    ↓
1. enumerate active Claims
    ↓
2. recover/continue their durable sessions or landing work
    ↓
3. read current World
    ↓
4. read repo-proposal-set/v1 for that World
    ↓
5. fill unused controller capacity with NEW compatible Claims
       NEW Claim creation must CAS-check current H under authority lock
    ↓
6. bounded concurrent runWork() for executable Claim sessions
    ↓
7. collect independent durable Closures
    ↓
8. serialize Closure landing:
       current World
       + exact Outcome
       + exact Claim
       + exact Closure
       + durable work evidence
       → fresh repo interpretation / successor candidate
       → commit current-Head-bound transition
    ↓
9. aggregate truthful result
```

## Hard cut 1 — `repo-proposal-set/v1`

New active mutable path:

```text
.meta-harness/repo-proposals.json
```

New schema:

```text
repo-proposal-set/v1
```

Shape:

```json
{
  "schemaVersion": "repo-proposal-set/v1",
  "productDirectionDigest": "sha256:...",
  "charterDigest": "sha256:...",
  "worldHeadDigest": "sha256:...",
  "ownerDirectiveDigest": null,
  "proposals": [
    {
      "id": "dashboard-intelligence",
      "productResult": "...",
      "journeyState": "...",
      "doNow": "...",
      "newlyTrueBehavior": "...",
      "doneWhen": "...",
      "stopOnlyIf": ["..."],
      "allowedPaths": ["..."],
      "base": { "type": "EXACT_COMMIT", "commit": "..." },
      "validation": [
        { "argv": ["node", "--test"], "cwd": ".", "timeoutSeconds": 300 }
      ],
      "maxAttempts": 2,
      "delivery": { "commit": false, "push": false }
    }
  ]
}
```

Rules:

- the common product-direction / charter / World / owner-directive bindings remain;
- `proposals[]` is ordered repository preference;
- proposal IDs are unique inside one snapshot;
- `proposals[]` may be empty;
- overlapping proposals are legal possibilities; Claim admission determines which may coexist now;
- no `decision.type` sum type exists;
- no `NO_DISPATCH` exists;
- no priority number, queue position, reservation state, fairness, preemption, or resource score exists;
- proposal bytes may be hashed for diagnostics/aggregate reporting, but the digest is not execution authority.

Rename active APIs around proposal semantics:

```text
loadRepoProposalSet()
compileRepoProposals()
repoProposalPlaneEnabled() / repoControlPlaneEnabled()
```

Do not keep `compileRepoDecisionWork()` as the conceptual API for new execution.

`lib/repo-decision.js` / legacy Decision constants may remain only where historical immutable `REPO_DECISION` evidence requires them.

## Hard cut 2 — recover active Claims before proposals

At command entry:

```text
activeClaims = listActiveOutcomeClaims(repository)
```

Classify every active Claim independently of the current proposal file.

### A. Claim has active bound workspace/session and no live competing controller lease

Resume the exact claim-addressed session.

### B. Claim has active bound workspace/session and another live controller currently owns the workspace lease

Treat it as an already-running organizational commitment. Do not duplicate it and do not consume owner attention.

### C. Claim has durable session identity but no workspace yet

Provision the workspace and execute that exact session.

### D. Claim has terminal workspace / durable Closure but has not yet been learned into World

Do not redispatch the worker. Put the Closure directly into the landing/reconciliation set.

### E. Claim is released

It is not active and is ignored by recovery.

The current proposal snapshot is consulted only **after** this recovery set is known.

## Hard cut 3 — close the Claim-before-session crash hole

Live code currently has a real recovery gap:

```text
create Outcome
→ create Claim
→ later seal/persist session
→ later create workspace/binding
```

If the process dies after Claim creation but before durable session identity exists, `outcome/v1` does not contain enough fields to reconstruct the worker brief without consulting mutable proposals.

That violates:

> proposals may not cancel commitments.

Add one immutable pre-workspace binding:

```text
outcome-claim-session/v1

claimDigest
sessionDigest
boundAt
bindingDigest
```

The exact sealed `work-session/v7` bytes must also be durably persisted before the Claim becomes externally visible as active.

For **new** Claims, use recovery-safe write ordering under the same World authority lock:

```text
1. verify current WorldHead == proposal.worldHeadDigest
2. verify duplicate / write-boundary compatibility
3. construct prospective Claim body + claimDigest
4. seal work-session/v7 using that claimDigest
5. persist exact immutable session bytes
6. persist immutable outcome-claim-session binding
7. persist Claim file LAST
8. release authority lock
```

Crash semantics:

```text
crash before Claim write
→ orphan session/binding is inert; no active commitment exists

Claim visible
→ exact session identity is already durable
→ mutable proposals are no longer required for continuation
```

The existing `outcome-claim-binding/v1` remains the later Claim→Session→Workspace binding. Do not collapse workspace custody into Claim.

Legacy pre-slice active Claims:

- if an exact claim-addressed session/workspace already exists, recover it normally;
- if an old active Claim has no recoverable session identity, fail closed as legacy incomplete commitment evidence rather than silently release it or pretend a current proposal is authoritative continuity.

Do not invent a general migration framework for that one historical gap.

## Hard cut 4 — atomic current-Head proof for NEW Claims

`withClaimAuthorityLock()` already uses the World authority lock. Use that fact directly.

Inside new Claim acquisition:

```text
current = readCurrentWorldPointer()

if current.headDigest != requested originWorldHeadDigest:
    reject NEW Claim as stale
```

Perform this check **inside** the same critical section that checks duplicate/conflicting active Claims and makes the Claim visible.

Required distinction:

```text
acquire new Claim from stale H
→ reject

execute / resume existing Claim created from H after H→H1
→ permitted unless another explicit authority rule invalidates it
```

Do not add whole-World equality to `assertOutcomeClaimExecution()` for already-active Claims.

## Hard cut 5 — fill only remaining capacity from proposals

After active commitments are recovered/classified, read current World and the current proposal snapshot.

The proposal set must bind that exact current Head when loaded for **new** admissions.

Greedy fill:

```text
availableSlots = localExecutionBound - locallyExecutableRecoveredClaims

for proposal in proposal order:
    if availableSlots == 0:
        stop

    compile minimal Outcome + session inputs

    if Outcome already has active Claim:
        do not recreate / replace it
        continue

    try atomic current-Head Claim+session acquisition
        success:
            add new session
            availableSlots -= 1

        duplicate/conflict race:
            another commitment won
            continue scanning

        stale World race:
            stop creating from this stale proposal snapshot
            reread current World / proposals before any further NEW Claim
```

Greedy means maximal in stable proposal order, not maximum-cardinality scheduling.

The controller-local fan-out bound remains operational protection only. It is not persisted and is not World/Claim state.

## Hard cut 6 — concurrent execution stays above `runWork()`

Keep:

```text
runWork(session)
```

as exactly one worker execution transaction.

Add a narrow orchestration layer above it, preferably a small module such as:

```text
lib/repo-work-wave.js
```

or a similarly named repo-control module.

Conceptually:

```text
sessions
→ bounded Promise.allSettled / equivalent
   ├─ runWork(A)
   ├─ runWork(B)
   └─ runWork(C)
```

One worker failure, timeout, blocked result, or validation failure must not cancel unrelated workers.

Do not put multi-worker orchestration into `work-loop.js`.

## Required concurrency hygiene

Parallel `runWork()` makes previously invisible shared execution files correctness bugs.

Known concrete collision:

```text
work-sessions/worker-result.schema.json
```

is currently shared by all sessions.

Make the worker schema path session/workspace-addressed or immutable so two workers cannot race on it.

Audit/test the same class for:

- worker output/result paths;
- execution permits;
- AttemptEntries;
- workspace registry/custody records;
- workspace execution leases;
- candidate seals;
- verifier artifacts;
- product-proof artifacts;
- Claim→Session and Claim→Workspace bindings;
- Git delivery inside distinct managed worktrees.

Fix concrete collisions only. Do not create a generic storage framework.

## Hard cut 7 — current-World Closure landing

This slice pulls in the minimum safe sibling-learning rule.

### What the kernel can prove

The kernel can mechanically prove:

- exact Outcome identity;
- exact Claim identity;
- exact Claim precondition declaration digest;
- exact execution boundary;
- exact aggregate Closure and durable work result;
- exact current WorldHead;
- exact fresh transition predecessor;
- exact immutable successor World/attestation bytes supplied by repo intelligence;
- ordinary CAS uniqueness.

### What the kernel cannot prove

The current Outcome preconditions are strings. `preconditionDigest` proves the declaration did not change; it does **not** prove those statements remain true in current World.

Do not implement:

```text
old preconditionDigest == new preconditionDigest
→ therefore still valid
```

That would be fake scoped freshness.

### Minimum honest landing rule

For each durable Outcome Closure that still has an active Claim:

```text
current = readCurrentWorldState()

repo intelligence receives:
    current World + attestation
    exact Outcome
    exact Claim
    claim.preconditionDigest
    exact Closure
    exact durable work result/evidence

repo intelligence re-evaluates applicability against CURRENT World
and produces a fresh learning candidate bound to current.headDigest
```

The fresh candidate consists of the existing semantic materials:

```text
repo interpretation
successor repo-world
successor world-attestation
ATTEMPT_LEARNING transition
```

The controller then validates and CAS-commits that transition.

Change the Outcome transition law from:

```text
Claim.originWorldHeadDigest
must equal transition.predecessorHeadDigest
```

into:

```text
Claim.originWorldHeadDigest = provenance only
transition.predecessorHeadDigest = World actually re-evaluated for this landing
```

The transition must still reference the unique Closure for that exact Claim/Outcome.

### CAS race during landing

If another World transition wins after re-interpretation but before commit:

```text
MH_WORLD_CONFLICT
→ discard the stale semantic landing candidate
→ reread current World
→ rerun repository interpretation against that newer Head
```

Do not reuse the stale successor with a rewritten predecessor.

Bound this retry. No infinite reconcile loop is introduced in this slice.

### Applicable vs invalidated Closure

If repo intelligence determines the successful worker result is still applicable:

```text
ATTEMPT_LEARNING
→ successor World incorporates the accepted learning
→ Claim released by committed transition
```

If current World means the result can no longer be accepted as the intended product outcome:

```text
ATTEMPT_LEARNING
→ interpretation records invalidation/replan learning
→ successor may retain the current World payload unchanged
→ transition still closes/releases the Claim durably
→ outcome is not reported Done
```

A no-op World payload with a new learning transition is acceptable: the transition itself records the authoritative disposition and releases responsibility without pretending the stale work became current truth.

This does not require a generalized fact DSL, MVCC store, or conflict-key ontology.

## Landing order

Parallel worker completion order must not silently become organizational priority.

Use a deterministic derived landing order for Closures ready at the same reconciliation boundary, for example:

```text
Claim.acquiredAt
then claimDigest
```

The exact tie-break may be audited, but it must be deterministic and require no mutable landing queue.

Each landing re-reads current World before interpretation.

## Hard cut 8 — remove active `NO_DISPATCH`

`repo-proposal-set/v1` has no terminal decision sum type.

```text
proposals.length > 0
→ attempt to recover/fill/execute legal work

proposals.length == 0
→ REPLAN_REQUIRED / no new proposal supplied
```

An empty set must not automatically render:

```text
No active slice.
Use the product.
Wait for observed real-use friction.
```

That terminal message remains valid only when the product/kernel has an actual terminal no-active-slice conclusion from durable state, not because a model wrote `WAIT_EXTERNAL` or `NO_VALUABLE_ACTION`.

Legacy immutable `repo-decision/v3 NO_DISPATCH` remains historical evidence only. It is not accepted as the active mutable repository-work input after this hard cut.

This deliberately removes the current false-stop route before full Phase-4 means substitution / EscalationProof exists.

## Product-path behavior

Repo-owned normal path becomes:

```text
meta-harness work
→ recover active Claim commitments
→ load current World
→ load ordered repo proposals
→ add compatible current-Head Claims
→ run bounded concurrent workers
→ land durable Closures serially into World
→ report truthful aggregate result
```

Direct owner-goal work outside the repo control plane remains one accepted result and keeps the existing single-result owner continuity behavior.

The owner never selects workers, Claim IDs, paths, or lanes.

## Aggregate result truth law

A worker-level `DONE` is not enough for the aggregate repo-owned command to claim product completion.

Report an Outcome as repo-complete only after:

```text
worker/result proof passed
+ Closure durable
+ current-World landing committed
```

Possible per-Outcome aggregate states may be derived as:

```text
LANDED
BLOCKED
INVALIDATED_REPLAN
RUNNING_ELSEWHERE
```

Keep the aggregate result non-authoritative. Recovery comes from Claims, sessions, workspace custody, Closures, and World transitions.

Human output remains concise.

Good:

```text
Done — 2 independent outcomes landed in current repository truth; 1 needs replanning.
```

Bad:

```text
Done — 3 outcomes executed.
```

when one successful Closure has not reconciled into current World.

## Failure and recovery rules

- Active Claims are recovered before proposals.
- Mutable proposals may never cancel or replace an active Claim.
- Same Outcome race yields one active Claim.
- New Claim from stale WorldHead is rejected.
- Existing Claim from an older WorldHead may continue.
- Existing Claim with live foreign controller lease is not duplicated.
- Existing Claim with durable session but no workspace is provisioned from durable session identity.
- Existing Claim with terminal workspace/Closure is landed, not rerun.
- Write conflict skips that new proposal and keeps scanning.
- Proposal-set World staleness stops further new admissions from that snapshot.
- One worker failure does not cancel siblings.
- Shared execution artifacts are Claim/session/workspace isolated.
- Closure landing always interprets against current World.
- CAS-lost landing is regenerated from newer current World.
- Stale Closure is never blindly rebased by changing only predecessor digest.
- Claim is released only through explicit durable release/landing semantics.
- Repo-owned continuation never falls back to global `latest.json`.

## Acceptance suite

The slice is not bankable until the following are mechanically covered.

### 1. Commitments survive proposal deletion

Given active Claim A with durable claim→session identity, remove A from current proposal set. Fresh process still recovers/resumes A before proposal processing.

### 2. New Claim stale-Head race

Controller reads proposal set bound to H. Another process commits H→H1 before Claim creation. New Claim from H is rejected under the authority lock and no execution begins from stale admission.

### 3. Existing Claim survives World advance

Claim B was validly created from H. World advances H→H1 for an unrelated reason. B remains executable/resumable.

### 4. Claim visibility implies durable session recovery

Inject process death at every write boundary around new Claim/session acquisition. There must be no reachable state where an active new-format Claim exists but its exact sealed session identity cannot be recovered without mutable proposals.

### 5. One proposal set creates several compatible Claims

Given ordered proposals A, B, C on disjoint write boundaries, one normal repo-owned invocation creates several Claim-bound v7 sessions and distinct workspaces within the controller-local fan-out limit.

### 6. Proposal conflict does not reject the set

```text
A writes src/a
B writes src/a/nested
C writes src/c
```

A is admitted, B is skipped as conflicting, C is admitted.

### 7. Fresh-controller race partitions work

Two fresh processes race the same current proposal set. No Outcome receives two Claims. Claim/conflict collisions cause continued scanning rather than whole-command failure.

### 8. Shared execution artifacts are isolated

Two fake workers execute concurrently and cannot overwrite or consume each other's schema/output/result/permit/candidate/verifier/product-proof artifacts.

### 9. Failure isolation

A, B, C run concurrently. B fails or times out. A and C still produce durable Closures and proceed to landing.

### 10. Sibling Closure landing

A and B both begin from H.

```text
A Closure
→ current-World interpretation at H
→ commit H→H1

B Closure
→ fresh interpretation at CURRENT H1
→ commit H1→H2
```

B must not be rejected merely because Claim B originated from H.

### 11. Relevant invalidation

A's committed learning changes current World such that B's declared precondition no longer applies. B's fresh current-World interpretation returns invalidated/replan learning; B is not reported LANDED/DONE and its Claim is durably resolved without pretending B's stale result is current truth.

### 12. Landing CAS race

Interpret B against H1. Another transition wins H1→H2 before B commit. B's H1 semantic candidate fails CAS and is discarded. B is freshly re-interpreted against H2 before any retry.

### 13. Empty proposal set is nonterminal

No active Claim + `proposals: []` produces `REPLAN_REQUIRED` / reconciliation-needed behavior, not model-authored terminal `USE_PRODUCT`.

### 14. No repo-owned latest singleton

All repo-owned work continuation remains Claim-addressed.

### 15. Legacy evidence still reads

Immutable historical `repo-decision/v3` + legacy `REPO_DECISION` AttemptEntry/Closure evidence remains readable for recovery while active mutable repo input hard-cuts to `repo-proposal-set/v1`.

### 16. Owner-goal path unchanged

Direct accepted owner-goal work outside repo control remains one result with current v7 owner continuity semantics.

## Likely implementation surface

Primary active modules likely become:

```text
lib/repo-proposal-set.js          # new active proposal parser/compiler
lib/repo-work-wave.js             # Claim recovery, fill, parallel run, landing coordination
lib/outcome-claim.js              # current-Head new Claim rule + durable claim-session relation
lib/work-git.js                   # pre-workspace session persistence + concurrent artifact paths
lib/world-transition.js           # Outcome origin Head becomes provenance, current landing predecessor allowed
lib/commands/work.js              # repo-owned aggregate path / no active NO_DISPATCH
```

Keep or shrink legacy modules only for retained evidence:

```text
lib/repo-decision.js              # legacy v3 evidence parser/constants only where required
lib/repo-decision-plane-v2.js     # replace active semantics; do not preserve misleading active Decision API
lib/world-authority.js            # legacy Decision admission reader + common authority lock
```

Expected tests:

```text
tests/parallel-outcome-progress.test.js
existing outcome-claim / repo-decision legacy / work / World regressions
```

Contract/docs that must be updated during implementation:

```text
templates/contracts/repo-decision-plane-v1.md
# filename may remain packaged for compatibility, but content must describe proposal/claim authority accurately

docs/product/product-spec.md
```

Do not grow `work-loop.js` into the control plane.

## Deliberately deferred

```text
continuous refill while a wave is still running
global execution-capacity state
planner generation of proposals
full means-substitution search
EscalationProof / durable misconception records
research promotion / ResearchFinding
ContextCompiler
adaptive structural/semantic SAW
DRAIN / WAKE
provider/runtime ports
plugin host
queue / daemon / scheduler service
priority / fairness / preemption / CP-SAT
non-filesystem conflict-resource ontology
generic fact-level MVCC / precondition DSL
worker-to-worker communication
corporate-agent roles
```

A future richer scoped-freshness model is justified only if current-World re-interpretation becomes a demonstrated bottleneck or cannot preserve needed concurrency.

## Roadmap consequence

This revised slice absorbs the minimum useful part of the old Phase 3.

After it banks:

- Phase 2 owns **parallel execution + serialized current-World landing**;
- Phase 3 becomes **continuous reconciliation / capacity refill**, not another correctness gate needed to make the previous slice truthful;
- Phase 4 remains forward-motion / EscalationProof;
- later planner/research/SAW/DRAIN/ports phases remain unchanged in principle.

## Validation target after implementation

Minimum focused validation:

```text
node --test tests/parallel-outcome-progress.test.js
node --test tests/outcome-claim-authority.test.js
node --test tests/repo-decision-plane-v2.cases.js
node --test tests/execution-permit.test.js
node --test tests/work-session.test.js
node --test tests/work-git.test.js
node --test tests/work-loop.test.js tests/product-direction-continuity.test.js tests/coding-system-live.test.js
git diff --check
```

Then run the bounded primary suites that cover the changed proposal/Claim/World/work path. Attempt the full repository wrapper, but report upstream/tool failure separately instead of claiming a pass without a returned result.

Validation result on 2026-08-18:

```text
focused Phase-2 / Claim / legacy-Decision authority suites: PASS
execution-permit / work-session / work-git suites: PASS
work-loop / product-direction continuity suites: PASS (live external Codex case intentionally skipped)
npm test: 116 files, 865 tests, 0 failures
git diff --check: PASS
```

No commit or push was requested or performed.

## Implementation boundary

The architecture audit was accepted and the Phase-2 slice is implemented in the working tree. The implementation includes the three final audit clarifications:

- repository interpretation is an explicit Phase-2 execution primitive via the fixed `.meta-harness/closure-interpreter.js` seam, contained read-only in verifier-grade Linux namespaces/chroot;
- every terminal Claim has a deterministic durable resolution path: `ATTEMPT_LEARNING` when durable work evidence exists, `ATTEMPT_ABORTED` when it does not;
- the World-authority lock contains only short mechanical authority work; product-proof compilation, worker execution, and semantic interpretation remain outside it.

Validation passed. The slice remains unbanked only in the Git-custody sense because no commit was requested. `PRODUCT.md` remains owner-authored and untouched.
