# Repository Progress Authority — hard-cut contract

This packaged filename is retained for distribution compatibility, but the active repository-work protocol is no longer a mutable Repo Decision. Active repo-owned progress uses `repo-proposal-set/v1`, `outcome/v1`, `outcome-claim/v1`, `outcome-claim-session/v1`, and `work-session/v7`. Historical immutable `repo-decision/v3` evidence remains readable only where old AttemptEntry / ExecutionClosure provenance requires it.

## Boundary

Meta-Harness is not a domain planner or epistemic oracle. Repository intelligence owns proposal content and current-World semantic interpretation. The kernel owns only identities, exact bytes, authority bindings, bounded execution containment, compatibility checks, durable closure, and linear World compare-and-swap.

```text
repo-native sources / external observations
        ↓
repo projector / interpreter
        ↓
immutable repo-world/v2 + world-attestation/v1
        ↓
world-transition/v1
        ↓
immutable world-head/v1
        ↓
current-world-pointer/v1
        ↓
.meta-harness/repo-proposals.json / repo-proposal-set/v1
        ↓ ordered possibilities
immutable outcome/v1
        ↓
current-Head-compatible outcome-claim/v1
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
ATTEMPT_LEARNING or ATTEMPT_ABORTED
        ↓
serialized world-transition/v1
        ↓
successor world-head/v1 + Claim release
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
```

Legacy `decisions/<decisionDigest>.json` objects remain readable for historical execution provenance.

The sole mutable World authority is:

```json
{
  "schemaVersion": "current-world-pointer/v1",
  "headDigest": "sha256:..."
}
```

A `world-head/v1` is immutable:

```json
{
  "schemaVersion": "world-head/v1",
  "generation": 12,
  "worldDigest": "sha256:...",
  "attestationDigest": "sha256:...",
  "lastTransitionDigest": "sha256:...",
  "headDigest": "sha256:..."
}
```

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

## `repo-proposal-set/v1`

The active mutable repository-work input is:

```text
.meta-harness/repo-proposals.json
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
      "id": "bounded-result",
      "productResult": "Observable product result",
      "journeyState": "Current user journey state",
      "doNow": "Nearest coding action",
      "newlyTrueBehavior": "Behavior that becomes true",
      "doneWhen": "Observable completion condition",
      "stopOnlyIf": ["Material stop condition"],
      "allowedPaths": ["src", "tests"],
      "base": { "type": "EXACT_COMMIT", "commit": "<exact Git commit oid>" },
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

- the common product-direction, charter, current WorldHead, and owner-directive bindings are exact;
- `proposals[]` is ordered repository preference;
- proposal IDs are unique inside one snapshot;
- overlapping proposals are legal possibilities; Claim admission decides which may coexist;
- proposal bytes and their digest are not Outcome, Claim, session, permit, or World authority;
- `proposals: []` means `REPLAN_REQUIRED`, not terminal `USE_PRODUCT`;
- there is no active `NO_DISPATCH`, priority number, queue position, reservation state, fairness, preemption, or generic conflict resource.

Proposals are possibilities. Claims are commitments.

## Outcome / Claim admission

A proposal compiles to a deliberately small immutable Outcome:

```text
id
desiredState
preconditions[]
evidenceRequirement
```

Compatibility is derived from concrete write paths. Same-Outcome claims and overlapping write boundaries fail closed; disjoint Claims may coexist.

For every **new** Claim, the short World-authority critical section requires:

```text
currentWorldHeadDigest == proposal.worldHeadDigest
```

An existing Claim does not gain that continuing equality requirement. `Claim.originWorldHeadDigest` remains provenance after admission; unrelated World advancement does not cancel durable responsibility.

## `outcome-claim-session/v1` and crash-safe visibility

A new-format Claim must never become externally visible before its exact sealed execution brief is durable.

Admission ordering under the same World-authority lock is:

```text
1. re-read current WorldHead
2. require requested origin Head is still current
3. verify duplicate / write-boundary compatibility
4. choose Claim identity and construct prospective Claim digest
5. seal exact work-session/v7 using that claimDigest
6. persist exact immutable session bytes
7. persist immutable outcome-claim-session/v1
8. persist Claim LAST
9. release lock
```

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
→ orphan session/relation bytes are inert

Claim visible
→ exact session identity is already recoverable
→ mutable proposals are no longer required for continuation
```

The later `outcome-claim-binding/v1` remains Claim→Session→Workspace custody. Workspace custody is not collapsed into Claim authority.

## Claim-first recovery and bounded parallel execution

Normal repo-owned work begins by enumerating active Claims before reading the proposal snapshot.

An active Claim may be:

```text
session durable, no workspace yet        → provision and execute exact session
ACTIVE workspace, no competing lease     → resume exact session
ACTIVE workspace, live foreign lease     → RUNNING_ELSEWHERE; never duplicate
terminal workspace / durable Closure      → land Closure; never rerun worker
released Claim                            → not active
```

Legacy active Claims without recoverable session identity fail closed rather than silently consulting mutable proposals for continuity.

Only remaining local capacity is filled from the current proposal snapshot. Admission is greedy in stable proposal order. Conflict or duplicate races skip that proposal and continue scanning. A stale-Head race stops admission from that stale snapshot.

Each executable session still uses exactly one `runWork(session)` transaction in its own managed worktree. A small orchestration layer runs those independent transactions concurrently with `Promise.allSettled`-style failure isolation. One worker failure cannot cancel siblings.

Controller-local fan-out is an operational safety limit only. It is not durable scheduler state.

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

Semantic work, product-proof compilation, repository interpretation, and worker execution happen outside the lock. The lock is not a throughput mutex for intelligence work.

## `world-transition/v1`

There is one substrate for authoritative World movement:

```json
{
  "schemaVersion": "world-transition/v1",
  "predecessorHeadDigest": "sha256:...",
  "cause": {},
  "successorWorldDigest": "sha256:...",
  "successorAttestationDigest": "sha256:...",
  "transitionDigest": "sha256:..."
}
```

Allowed causes remain:

```text
REALITY_REFRESH
ATTEMPT_LEARNING
ATTEMPT_ABORTED
```

An exact transition retry after a crash is idempotent. The shared authority lock plus pointer comparison supplies CAS semantics; atomic rename alone is not treated as concurrent CAS.

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
+ fresh current-World landing committed
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
