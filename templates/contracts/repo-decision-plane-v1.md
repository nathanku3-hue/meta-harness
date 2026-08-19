# Repository Progress Authority — hard-cut contract

This packaged filename is retained for distribution compatibility, but the active repository-work protocol is no longer a mutable Repo Decision or proposal-file ingress. Active repo-owned progress uses fresh logical planning over `world-head/v2`, `outcome/v1`, `outcome-claim/v1`, `outcome-claim-session/v1`, `work-session/v7`, `execution-closure/v1`, `product-integration/v1`, and `world-transition/v2`. Historical proposal and immutable `repo-decision/v3` evidence remain readable only for bounded migration/regression/recovery.

## Boundary

Meta-Harness is not a domain planner or epistemic oracle. Repository intelligence owns proposal content and current-World semantic interpretation. The kernel owns only identities, exact bytes, authority bindings, bounded execution containment, compatibility checks, durable closure, and linear World compare-and-swap.

```text
repo-native sources / external observations
        ↓
repo projector / interpreter
        ↓
immutable repo-world/v2 + world-attestation/v1
        ↓
world-transition/v2
        ↓
immutable world-head/v2 (semantic World + productCommit)
        ↓
current-world-pointer/v1
        ↓
active Claims + unresolved authoritative handoffs
        ↓
fresh read-only logical planner
        ↓ disposable semantic candidates
prospective outcome/v1 bytes + exact execution boundary
        ↓ current-Head/compatibility authority check
immutable outcome/v1 + outcome-claim/v1
        ↓
immutable outcome-claim-session/v1
        ↓
work-session/v7 (REPO_OUTCOME)
        ↓
execution-permit/v1
        ↓
attempt-entry/v1
        ↓
bounded worker / validation / BANK
        ↓
execution-closure/v1
        ↓
CURRENT World + fixed repository closure interpreter
        ↓
DONE+APPLIED: cumulative product integration + retained proof
        ↓
product-integration/v1
        ↓
ATTEMPT_LEARNING or ATTEMPT_ABORTED
        ↓
serialized world-transition/v2
        ↓
successor world-head/v2 + Claim release
```

The kernel understands:

```text
identity
sha256 digests
authority bindings
attestation facts it can actually recompute
proposal-set bindings
Outcome / Claim compatibility
AttemptEntry
operational closure
WorldHead lineage
exclusive lock + compare-and-swap
```

The kernel does not understand domain-specific evidence meaning or applicability.

## Opt-in and protected control paths

A regular non-symlink `.meta-harness/repo-charter.json` opts the repository into repo-owned progress authority. The charter is opaque policy bytes; Meta-Harness binds its digest but does not validate a generic policy ontology.

While opted in, direct material bypass through internal `--goal`, `--session`, `--allow`, or `--base` controls is rejected. Coding workers may not mutate these repository authority inputs:

```text
.meta-harness/repo-charter.json
.meta-harness/repo-world.json
.meta-harness/world-attestation.json
.meta-harness/world-transition.json
.meta-harness/repo-interpretation.json
.meta-harness/repo-proposals.json
.meta-harness/closure-interpreter.js
.meta-harness/repo-decision.json        # legacy evidence source only
.meta-harness/owner-directive.md
```

`repo-world.json`, `world-attestation.json`, and `world-transition.json` are repo-side candidate/projection files only. Replacing their bytes does not itself replace authoritative World state. Authority is the immutable object store plus `current-world-pointer/v1`.

## Immutable protocol objects and mutable pointer

Protocol objects are stored by digest under the repository Git common directory. The authority chain retains immutable objects for at least:

```text
worlds/<worldDigest>.json
attestations/<attestationDigest>.json
transitions/<transitionDigest>.json
heads/<headDigest>.json
interpretations/<interpretationDigest>.json
outcomes/<outcomeDigest>.json
work-results/<workResultDigest>.json
execution-closures/<closureDigest>.json
product-integrations/<integrationDigest>.json
```

Legacy `decisions/<decisionDigest>.json` objects remain readable for historical execution provenance.

The sole mutable World authority is:

```json
{
  "schemaVersion": "current-world-pointer/v1",
  "headDigest": "sha256:..."
}
```

An active `world-head/v2` is immutable and binds semantic truth to the cumulative local product base:

```json
{
  "schemaVersion": "world-head/v2",
  "generation": 12,
  "worldDigest": "sha256:...",
  "attestationDigest": "sha256:...",
  "productCommit": "<git commit oid>",
  "lastTransitionDigest": "sha256:...",
  "headDigest": "sha256:..."
}
```

Legacy `world-head/v1` remains dereferenceable only for retained evidence and the one-time v1→v2 migration.

Old Head identities therefore remain dereferenceable after the current pointer advances.

## `repo-world/v2` and `world-attestation/v1`

World payload is intentionally opaque to the kernel:

```json
{
  "schemaVersion": "repo-world/v2",
  "productDirectionDigest": "sha256:...",
  "payload": {
    "repoOwnsThisShape": true
  }
}
```

Attestation binds a World to projector identity and source observations:

```json
{
  "schemaVersion": "world-attestation/v1",
  "worldDigest": "sha256:...",
  "projectorDigest": "sha256:...",
  "sources": [],
  "generatedAt": "2026-08-18T00:00:00.000Z",
  "attestationDigest": "sha256:..."
}
```

The kernel verifies only properties it can actually verify: local-file digests, Git-ref identities, opaque observation bindings, declared validity windows, and exact World binding.

## Historical `repo-proposal-set/v2`

`.meta-harness/repo-proposals.json` is retained only for migration/regression readability. Fresh repository work does not read it as active ingress; the logical planner reconstructs disposable candidates from current durable truth.

Historical shape:

```json
{
  "schemaVersion": "repo-proposal-set/v2",
  "productDirectionDigest": "sha256:...",
  "charterDigest": "sha256:...",
  "worldHeadDigest": "sha256:...",
  "ownerDirectiveDigest": null,
  "proposals": [
    {
      "id": "bounded-result",
      "productResult": "Observable product result",
      "journeyState": "Current user journey state",
      "doNow": "Nearest coding action",
      "newlyTrueBehavior": "Behavior that becomes true",
      "doneWhen": "Observable completion condition",
      "stopOnlyIf": ["Material stop condition"],
      "allowedPaths": ["src", "tests"],
      "validation": [
        { "argv": ["node", "--test"], "cwd": ".", "timeoutSeconds": 300 }
      ],
      "maxAttempts": 2,
      "delivery": { "commit": false, "push": false }
    }
  ]
}
```

Historical proposal bytes and their digest are not Outcome, Claim, session, permit, World, product-base, or continuity authority. Active logical-planner candidates likewise remain disposable possibilities: `expectedWritePaths[]` predicts an exact execution footprint, while Claim admission alone decides compatibility. New repo-owned sessions derive `base.commit` from the current `world-head/v2.productCommit`. An empty fresh planner result means controller quiescence/replanning, not terminal `USE_PRODUCT`; there is no active `NO_DISPATCH`, priority number, queue position, reservation state, fairness, preemption, or generic conflict resource.

Planner candidates are possibilities. Claims are commitments.

## Outcome / Claim admission

A planner candidate constructs a deliberately small prospective immutable Outcome in memory:

```text
id
desiredState
preconditions[]
evidenceRequirement
```

Compatibility is derived from concrete write paths. Same-Outcome claims and overlapping write boundaries fail closed; disjoint Claims may coexist.

For every **new** Claim, the short World-authority critical section requires the planner candidate's captured origin Head to still equal the authoritative current Head. A stale candidate batch is discarded rather than rebound to newer truth.

An existing Claim does not gain that continuing equality requirement. `Claim.originWorldHeadDigest` remains provenance after admission; unrelated World advancement does not cancel durable responsibility.

## `outcome-claim-session/v1` and crash-safe visibility

A new-format Claim must never become externally visible before its exact sealed execution brief is durable.

Admission ordering under the same World-authority lock is:

```text
1. re-read current WorldHead
2. require requested origin Head is still current
3. verify duplicate / write-boundary compatibility
4. persist the already-validated prospective immutable Outcome prerequisite
5. choose Claim identity and construct prospective Claim digest
6. seal exact work-session/v7 using that claimDigest
7. persist exact immutable session bytes
8. persist immutable outcome-claim-session/v1
9. persist Claim LAST
10. release lock
```

Ordinary stale/conflicting rejection happens before step 4 and therefore leaves no Outcome object. A crash after prerequisites but before Claim visibility may leave inert create-only residue; no garbage collector or second admission protocol is introduced.

`outcome-claim-session/v1` contains:

```text
claimDigest
sessionDigest
boundAt
bindingDigest
```

Crash semantics:

```text
crash before Claim write
→ orphan Outcome/session/relation prerequisites are inert

Claim visible
→ exact session identity is already recoverable
→ planner output is no longer required for continuation
```

The later `outcome-claim-binding/v1` remains Claim→Session→Workspace custody. Workspace custody is not collapsed into Claim authority.

## Claim-first recovery and event-driven reconciliation

Normal repo-owned work begins by enumerating active Claims and draining any landing-ready terminal Closures before a fresh planner boot.

An active Claim may be:

```text
session durable, no workspace yet        → provision and execute exact session
ACTIVE workspace, no competing lease     → resume exact session
ACTIVE workspace, live foreign lease     → RUNNING_ELSEWHERE; never duplicate
terminal workspace / durable Closure      → land Closure; never rerun worker
released Claim                            → not active
```

Legacy active Claims without recoverable session identity fail closed rather than silently consulting mutable possibilities for continuity.

Recovered executable commitments fill local slots before fresh planning. If capacity remains, the controller boots the fresh logical planner at most once for the unchanged current Head, greedily admits compatible candidates until capacity is full, and discards unused candidates if the Head changes. Each executable session still uses exactly one `runWork(session)` transaction in its own managed worktree.

The orchestration layer keeps only an ephemeral controller-local running set and waits for the next worker settlement with `Promise.race` semantics. A settlement is only a wake signal: the controller rereads durable Claims/Closures/Head, lands ready Closures immediately, and refills authoritative released capacity while slower siblings keep running. One worker failure cannot cancel siblings. Controller-local fan-out and per-Head quiescence marks are operational memory only; they are never durable queue, scheduler, or event authority.

## Concurrent artifact isolation

Shared execution artifacts must be session/workspace addressed. In particular, worker result schema/output identities are no longer one repository-global filename. Existing permit, AttemptEntry, custody, lease, candidate-seal, product-proof, and Claim bindings remain identity-addressed.

No generic storage framework is introduced.

## Aggregate `execution-closure/v1`

Closure describes observable execution facts for the whole bounded run, not domain meaning:

```json
{
  "schemaVersion": "execution-closure/v1",
  "sessionDigest": "sha256:...",
  "origin": {
    "type": "REPO_OUTCOME",
    "outcomeDigest": "sha256:...",
    "claimDigest": "sha256:..."
  },
  "attemptEntries": ["sha256:E1", "sha256:E2"],
  "disposition": "COMPLETED",
  "workResultDigest": "sha256:R",
  "closedAt": "...",
  "closureDigest": "sha256:..."
}
```

Operational dispositions include completed, partial, blocked, controller-rejected, and interrupted-after-entry. A durable work result is persisted before/with closure identity. Recovery reconstructs the strongest controller-supported operational disposition and never replays consumed material authority.

## Fixed repository closure interpreter

Repository interpretation is part of the execution transaction, not an external handoff.

A repo-controlled repository supplies one fixed self-contained Node program at:

```text
.meta-harness/closure-interpreter.js
```

For every Closure with durable work evidence, Meta-Harness provides exactly:

```text
current World + attestation
exact Outcome
exact Claim + preconditionDigest
exact ExecutionClosure
exact durable work result
```

The interpreter executes read-only in the verifier-grade Linux user/mount/network/PID namespace + chroot envelope. It sees its own script plus the exact JSON landing packet on stdin, has no writable repository checkout and no network, and returns one bounded JSON object:

```json
{
  "schemaVersion": "repo-closure-interpretation/v1",
  "disposition": "APPLIED",
  "interpretation": {},
  "successorWorld": {},
  "successorAttestation": {}
}
```

`disposition` is `APPLIED` or `INVALIDATED_REPLAN`.

Meta-Harness validates the exact output shape and bindings, computes/persists immutable interpretation, World, and attestation objects, and constructs a fresh current-Head-bound `ATTEMPT_LEARNING` transition.

`preconditionDigest` proves only the declared precondition text. It is not a snapshot of observed facts and is never used as fake scoped-freshness evidence.

## Current-World landing and CAS regeneration

World commits remain linear even when execution overlaps.

For every ready Closure, deterministic landing order is derived from:

```text
Claim.acquiredAt
then claimDigest
```

Every landing re-reads current World before semantic interpretation.

```text
Claim.originWorldHeadDigest = provenance only
transition.predecessorHeadDigest = World actually interpreted
```

If another transition wins after interpretation but before commit:

```text
MH_WORLD_CONFLICT
→ discard stale interpretation + successor candidate
→ re-read current World
→ rerun repository interpretation
→ retry with bounded attempts
```

A stale successor is never rebased by merely rewriting its predecessor digest.

A successful worker result that repository intelligence judges no longer applicable returns `INVALIDATED_REPLAN`. It still commits durable learning/replan disposition and releases the Claim, but it is not reported as product-complete.

A durable `PARTIAL` or `BLOCKED` result may likewise produce learning/replan semantics and release responsibility through `ATTEMPT_LEARNING`.

## No-result closure: `ATTEMPT_ABORTED`

A terminal ExecutionClosure with `workResultDigest = null` does not invoke the interpreter.

```text
current World
+ exact no-result Closure
→ ATTEMPT_ABORTED
→ successor World/attestation may remain semantically unchanged
→ World CAS
→ Claim release
```

`ATTEMPT_LEARNING` is forbidden without durable work evidence. `ATTEMPT_ABORTED` is forbidden when durable work evidence exists.

Thus every terminal Claim has a deterministic durable resolution path:

```text
durable work evidence → ATTEMPT_LEARNING
no durable work evidence → ATTEMPT_ABORTED
```

## Short World-authority lock

The global World-authority lock protects short mechanical authority operations only:

```text
new Claim current-Head proof
Claim duplicate/write-boundary compatibility
session/relation/Claim visibility ordering
transition predecessor CAS
Claim release
```

Semantic work, product-proof compilation, repository interpretation, cumulative Git integration/retained proof, and worker execution happen outside the lock. The lock is not a throughput mutex for intelligence work.

## `world-transition/v2` + `product-integration/v1`

Active authoritative movement is fully determined by the transition, including the successor product code identity:

```json
{
  "schemaVersion": "world-transition/v2",
  "predecessorHeadDigest": "sha256:...",
  "cause": {},
  "successorWorldDigest": "sha256:...",
  "successorAttestationDigest": "sha256:...",
  "successorProductCommit": "<git commit oid>",
  "transitionDigest": "sha256:..."
}
```

Active causes are `REALITY_REFRESH`, `ATTEMPT_LEARNING`, `ATTEMPT_ABORTED`, plus the one-time `PRODUCT_HEAD_MIGRATION`. `ATTEMPT_LEARNING` carries `integrationDigest` as a digest or `null`.

For `DONE` + semantic `APPLIED`, `integrationDigest` is mandatory and resolves to immutable `product-integration/v1`. The receipt binds the exact worker BANK/Closure plus:

```text
predecessorProductCommit
integratedCommit
integratedTreeOid
retainedObligations[]
retainedProofDigests[]
```

The kernel requires `receipt.predecessorProductCommit == predecessorHead.productCommit` and `receipt.integratedCommit == transition.successorProductCommit`. For abort, invalidated/non-DONE learning, or reality refresh, `successorProductCommit` equals predecessor `productCommit`.

Each accepted integration re-runs every retained executable validation/product-proof obligation against the same cumulative integrated tree. Obligations survive wave boundaries through immutable integration lineage; a later disjoint change that breaks an earlier accepted product behavior is rejected and does not advance productCommit.

`WorldHead.productCommit` is authority. `refs/meta-harness/product-head` is only a Git GC root/inspectable mirror; missing or stale mirror state is repaired from the Head. Integration worktree/branch reachability remains until World CAS and the mirror ref retain the accepted commit.

The v1→v2 migration follows authoritative legacy transition order, reconstructs every code-producing accepted Phase-2 learning from exact Closure/work-result/BANK evidence, cumulatively integrates and re-proves those effects, then creates the first v2 Head. If that cannot be proven, migration fails closed.

An exact transition retry after a crash is idempotent. The shared authority lock plus pointer comparison supplies CAS semantics; atomic rename alone is not treated as concurrent CAS. Retained `world-transition/v1` is historical/migration evidence only.

## Legacy `repo-decision/v3`

`repo-decision/v3` is not an active mutable repository-work input after this hard cut. Historical immutable Decision objects, Decision-origin AttemptEntries, work results, and ExecutionClosures remain readable for recovery and audit.

Historical `NO_DISPATCH` evidence remains inert. It cannot cause the active CLI to emit terminal `USE_PRODUCT` or create/cancel new Claims.

No migration framework or compatibility alias is added for retired active Decision semantics.

## Aggregate truth law

Worker-level `DONE` is not enough for repo-level completion.

An Outcome is `LANDED` only after:

```text
worker/controller proof passed
+ durable ExecutionClosure exists
+ fresh current-World interpretation passed
+ cumulative code integration/retained proof passed when code-producing
+ world-transition/v2 committed
```

Other derived aggregate states include:

```text
BLOCKED
INVALIDATED_REPLAN
RUNNING_ELSEWHERE
```

The aggregate result is not authority. Recovery comes from Claims, durable sessions/bindings, workspace custody, Closures, and World transitions.

## Non-goals

This substrate does not implement:

- a generic allocator or resource ontology;
- a queue, daemon, scheduler, fairness, reservation, or preemption subsystem;
- continuous refill while the current wave is still running;
- a planner runtime or automatic proposal generator;
- scientific validity or generic evidence-applicability semantics;
- a generic fact/MVCC precondition language;
- a provider/plugin framework;
- worker-to-worker messaging or persistent agent organization.

Those remain future work only when demonstrated product friction justifies them.
