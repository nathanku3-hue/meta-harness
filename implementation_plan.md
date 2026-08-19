# LINEAR_PRODUCT_HEAD_1

Status: **IMPLEMENTED AND VALIDATED — WORKING TREE; NOT COMMITTED**

## Product result

Phase 2 made repo-owned execution and World learning parallel/linear, but successful worker BANK commits still lived on separate managed branches. This slice makes semantic World truth and cumulative product-code truth advance through one authoritative Head.

After this slice:

```text
parallel worker BANK commits
        ↓
current-World interpretation
        ↓
controller-owned cumulative Git integration
        ↓
all retained executable product obligations re-proved
        ↓
product-integration/v1
        ↓
world-transition/v2
        ↓
world-head/v2(World, productCommit)
        ↓
refs/meta-harness/product-head  # reachability mirror only
```

Every new repo-owned session derives its exact base from current `world-head/v2.productCommit`. Proposal intelligence no longer chooses code ancestry.

`PRODUCT.md` remains owner-authored and untouched.

## Audit corrections implemented

### Transition determines the complete Head

Active authority hard-cuts:

```text
world-transition/v1 → world-transition/v2
world-head/v1       → world-head/v2
```

Active transition v2 includes:

```text
predecessorHeadDigest
cause
successorWorldDigest
successorAttestationDigest
successorProductCommit
transitionDigest
```

Active Head v2 includes:

```text
generation
worldDigest
attestationDigest
productCommit
lastTransitionDigest
headDigest
```

Therefore the same transition identity cannot yield different product commits.

For code-producing accepted learning:

```text
ATTEMPT_LEARNING.integrationDigest
→ product-integration/v1

receipt.predecessorProductCommit
    == predecessorHead.productCommit

receipt.integratedCommit
    == transition.successorProductCommit
```

For `REALITY_REFRESH`, `ATTEMPT_ABORTED`, non-DONE learning, and `INVALIDATED_REPLAN` learning:

```text
successorProductCommit == predecessorHead.productCommit
```

Legacy v1 transitions/Heads remain readable for historical evidence and bounded migration only. A legacy transition cannot advance a v2 Head.

### Migration reconstructs accepted code history

The v1→v2 boundary never seeds current code merely from mutable proposal bytes when legacy World history already contains code-producing accepted Outcome learning.

Migration:

```text
current legacy World lineage
→ traverse transitions in authoritative order
→ find REPO_OUTCOME ATTEMPT_LEARNING with durable DONE work result
→ resolve exact Claim + session + Closure + worker BANK commit
→ integrate each accepted effect cumulatively
→ re-prove retained obligations after each integration
→ produce Pseed...Pn
→ PRODUCT_HEAD_MIGRATION transition/v2
→ first world-head/v2(productCommit=Pn)
```

If an accepted semantic learning cannot be reconstructed from durable code evidence, migration fails closed.

Only when the legacy lineage contains no accepted code-producing learning may migration seed from exact agreeing durable active-Claim/proposal base evidence; if there is no such repo-owned evidence, exact local `HEAD` is the no-code-history fallback.

### Retained proof continuity crosses wave boundaries

Same-wave composition is insufficient. Every accepted `product-integration/v1` retains the cumulative set of accepted obligations:

```text
sessionDigest
claimDigest
closureDigest
workResultDigest
```

For a candidate cumulative tree, the controller re-runs each retained session's exact:

```text
controller validation commands
+ sealed product-proof contract/program
```

against that same integrated tree.

Thus:

```text
A accepted in wave 1
C executes in wave 2 from A's productCommit
C's own proof passes
C breaks A's retained proof
→ C integration rejected
→ repository interpretation receives integrationFailure
→ C lands as INVALIDATED_REPLAN
→ authoritative productCommit stays at A
```

Obligation compaction/retirement is deliberately deferred. Obligations are never silently dropped just because a wave ended.

### Git reachability is explicit but non-authoritative

Authority:

```text
current-world.json
→ world-head/v2.productCommit
```

Reachability plumbing:

```text
refs/meta-harness/product-head
```

The ref is not authority. Missing/stale ref state is mechanically repaired from the current Head. The temporary integration branch/worktree remains reachable until World CAS has accepted the integrated commit and the mirror ref has been repaired; only then is the integration workspace removed.

## Proposal hard cut

Active mutable proposal input hard-cuts:

```text
repo-proposal-set/v1 → repo-proposal-set/v2
```

Proposal v2 deletes `base` entirely.

```text
proposal says WHAT
WorldHead says FROM WHAT PRODUCT
Claim says WHO TEMPORARILY OWNS EXECUTION
work-session seals exact execution
```

For every new repo-owned session:

```text
session.base = {
  type: "EXACT_COMMIT",
  commit: currentWorldHead.productCommit
}
```

Historical proposal v1 remains readable only inside bounded legacy migration logic.

## Worker BANK versus canonical product integration

`runWork()` remains the one-worker execution transaction and is not turned into a merge engine.

Worker path remains:

```text
Claim
→ work-session/v7
→ isolated managed worktree
→ worker proposal
→ validation / product proof
→ exact local BANK commit
→ ExecutionClosure
```

That BANK commit is immutable execution evidence. It is not yet canonical product code.

Canonical code admission is controller-owned:

```text
current productCommit P
+ exact BANK commit W
→ fresh temporary integration worktree at P
→ cherry-pick W without committing
→ require exact changed-path set
→ write cumulative tree
→ replay retained validation/product obligations
→ create linear integration commit P'
→ persist product-integration/v1
```

Integration never uses the owner checkout and never implies push, PR, merge-to-remote, publication, or release.

Git conflicts are noninteractive and fail closed. Meta-Harness does not summon another worker merely to resolve integration.

## `product-integration/v1`

Immutable receipt binds:

```text
predecessorProductCommit
bankCommit
sessionDigest
outcomeDigest
claimDigest
closureDigest
workResultDigest
candidateSealDigest
integratedTreeOid
integratedCommit
retainedObligations[]
retainedProofDigests[]
validationDigest
productProofDigests[]
integratedAt
integrationDigest
```

Only worker results with:

```text
outcome == DONE
product proof == PROVEN
exact BANK evidence available
semantic interpretation == APPLIED
```

may advance canonical product code.

`BANKED_UNPROVEN`, blocked/partial learning, aborted attempts, and semantic invalidation never advance `productCommit`.

## CAS-loss rule

Semantic and code candidates share one predecessor Head.

If another transition wins while integration/interpretation is being prepared:

```text
candidate successor World   → discard
candidate integration       → discard
candidate integration branch→ remove

read new H(World, productCommit)
→ rerun repository interpretation
→ rebuild integration on new productCommit
→ replay retained proofs
→ retry bounded CAS
```

Never preserve a stale integrated commit by rewriting only its transition predecessor.

## Implementation boundaries

New modules are decomposed below the repository's source-line budget:

```text
lib/world-contract.js
    transition/head schema + digest contracts

lib/world-transition.js
    authoritative World/product transition commit

lib/repo-product-integration-record.js
    immutable integration receipt + retained lineage

lib/repo-product-proof-retention.js
    cumulative retained validation/product-proof replay

lib/repo-product-integration.js
    normal cumulative integration transaction

lib/repo-product-migration.js
    bounded legacy v1→v2 reconstruction

lib/repo-outcome-landing.js
    Closure interpretation/integration/transition landing

lib/repo-work-wave.js
    Claim recovery, proposal admission, parallel execution orchestration
```

`runWork()` remains unchanged as the one-worker transaction.

## Acceptance regressions

The dedicated Phase-3 suite proves:

1. Transition/product commit participates in transition and Head identity.
2. Proposal v2 has no `base`; work-session base comes from current Head productCommit.
3. Legacy Phase-2 semantic A+B history migrates only after cumulative A+B code reconstruction/proof.
4. A later wave cannot break an earlier retained accepted product obligation.
5. Authoritative product commit remains Git-reachable and a missing mirror ref is repairable from Head.

Retained Phase-1/2 suites continue proving Claim races, sibling concurrency, current-World semantic invalidation, CAS retry, failure isolation, crash-safe Claim→session identity, and historical Decision evidence.

## Deliberately deferred

```text
forward-motion / alternative-means EscalationProof
logical planner / fresh proposal generation
continuous event-driven capacity refill
obligation compaction / explicit supersession
research promotion / ContextCompiler
adaptive SAW semantic review
DRAIN / WAKE
runtime/provider ports
plugin framework
remote merge / PR / push / release
interactive conflict resolution
queue / daemon / fairness / preemption / CP-SAT
```

The next product phase is forward-motion/escalation proof. Planner-driven fresh proposals still precede continuous refill; rereading a stale proposal file is not reconciliation.

## Validation

Focused suites currently passed after implementation/refactor:

```text
node --test tests/linear-product-head.test.js tests/parallel-outcome-progress.test.js
# 16/16 passed

node --test tests/outcome-claim-authority.test.js tests/repo-decision-plane-v2.cases.js tests/work-git.test.js tests/work-loop.test.js tests/cli-work.test.js
# 80/80 passed
```

Repository-wide validation is clean at the test-file level:

```text
scripts/run-tests.js topology reproduced exactly
111 parallel test files + 6 serial-designated test files
117 test files / 870 tests / 0 failures
```

The monolithic `npm test` / `node scripts/run-tests.js` invocation itself twice failed to return a result because DevSpace terminated the long-running tool call with an upstream 502. The same discovered files were therefore replayed in bounded batches with the wrapper's exact `META_HARNESS_INTERNAL_CLI=1` environment and the same six serial exceptions; every test passed. No full-wrapper pass is claimed.

Additional final checks:

```text
module-load checks for all new/changed authority/integration modules: PASS
git diff --check: PASS
```

The repository's historical quality baseline is stale relative to previously banked post-baseline modules, so `meta-harness quality check` remains globally red on pre-existing/new-to-that-baseline files such as unchanged `lib/work-verifier.js` (599 lines). This slice does not grow `work-verifier.js`; retained-proof code was extracted into `lib/repo-product-proof-retention.js`, and every new source module introduced here is below the active 400-line source budget.
