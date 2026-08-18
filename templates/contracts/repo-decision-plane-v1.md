# Repo Decision Authority — hard-cut contract

This file documents the current repo decision authority substrate. The repository retains this packaged filename, but autonomous execution identity now uses `outcome/v1`, `outcome-claim/v1`, and `work-session/v7`; `repo-decision/v3` remains upstream selection evidence. There is no compatibility parser for retired active-path work-session schemas.

## Boundary

Meta-Harness is not a domain planner or epistemic oracle. Repository intelligence owns interpretation, applicability, ranking, claims, hypotheses, negative knowledge, terminal semantics, resurrection rules, and allocation policy. The kernel owns only identities and properties it can mechanically enforce.

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
repo-decision/v3
        ├── NO_DISPATCH → inert
        └── DISPATCH
              ↓
         immutable outcome/v1
              ↓
         compatible outcome-claim/v1
              ↓
         work-session/v7 (REPO_OUTCOME)
              ↓
         execution-permit/v1
              ↓
         attempt-entry/v1
              ↓
         bounded worker / validation
              ↓
         execution-closure/v1
              ↓
         repo interpretation
              ↓
         world-transition/v1
              ↓
         successor world-head/v1
```

The kernel understands:

```text
identity
sha256 digests
authority bindings
attestation facts it can actually recompute
DISPATCH / NO_DISPATCH
AttemptEntry
operational closure
WorldHead lineage
exclusive lock + compare-and-swap
```

The kernel does not understand domain-specific evidence meaning.

## Opt-in and protected control paths

A regular non-symlink `.meta-harness/repo-charter.json` opts the repository into repo decision authority. The charter is opaque policy bytes; Meta-Harness binds its digest but does not validate a generic policy ontology.

While opted in, direct material bypass through `--goal`, `--session`, `--allow`, or `--base` is rejected. The Repo Decision itself carries the resolved work-base authority. Coding workers may not mutate these repo authority inputs:

```text
.meta-harness/repo-charter.json
.meta-harness/repo-world.json
.meta-harness/world-attestation.json
.meta-harness/world-transition.json
.meta-harness/repo-interpretation.json
.meta-harness/repo-decision.json
.meta-harness/owner-directive.md
```

`repo-world.json`, `world-attestation.json`, and `world-transition.json` are repo-side candidate/projection files only. Replacing their bytes does not itself replace authoritative World state. Authority is the immutable object store plus `current-world-pointer/v1`.

## Immutable protocol objects and mutable pointer

Protocol objects are stored by digest under the repository Git common directory. At minimum the authority chain retains immutable objects for:

```text
worlds/<worldDigest>.json
attestations/<attestationDigest>.json
decisions/<decisionDigest>.json
transitions/<transitionDigest>.json
heads/<headDigest>.json
interpretations/<interpretationDigest>.json
work-results/<workResultDigest>.json
execution-closures/<closureDigest>.json
```

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

## `repo-world/v2`

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

A repository may change payload terminology from claims/hypotheses/routes to missions/observations/constraints without changing Meta-Harness source.

## `world-attestation/v1`

Attestation binds a World to projector identity and source observations:

```json
{
  "schemaVersion": "world-attestation/v1",
  "worldDigest": "sha256:...",
  "projectorDigest": "sha256:...",
  "sources": [],
  "generatedAt": "2026-08-13T00:00:00.000Z",
  "attestationDigest": "sha256:..."
}
```

The kernel verifies only properties it can actually verify.

### Local file source

```json
{
  "type": "LOCAL_FILE",
  "sourceId": "canonical-input",
  "path": "state/current.json",
  "digest": "sha256:...",
  "observedAt": "2026-08-13T00:00:00.000Z",
  "validUntil": null
}
```

Meta-Harness resolves the repository path, rejects traversal/symlinks, reads current bytes, and recomputes the digest.

### Git ref source

```json
{
  "type": "GIT_REF",
  "sourceId": "committed-base",
  "ref": "HEAD",
  "objectId": "0123456789abcdef...",
  "observedAt": "2026-08-13T00:00:00.000Z",
  "validUntil": null
}
```

Meta-Harness resolves the ref through its bounded Git helper and compares current object identity.

### Opaque observation

```json
{
  "type": "OPAQUE",
  "sourceId": "market-feed",
  "identity": "repo-adapter-observation:...",
  "observationDigest": "sha256:...",
  "observedAt": "2026-08-13T00:00:00.000Z",
  "validUntil": "2026-08-13T00:10:00.000Z"
}
```

For opaque external reality, Meta-Harness validates binding and declared time validity. It does not claim to have independently verified Bloomberg, Jira, a market feed, or another remote system. Repo intelligence owns that observation unless a generic live identity mechanism exists and the kernel actually uses it.

## `world-transition/v1`

There is one substrate for making another World authoritative:

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

Allowed causes are deliberately generic.

### Reality refresh

```json
{
  "type": "REALITY_REFRESH",
  "projectionDigest": "sha256:..."
}
```

### Attempt learning

```json
{
  "type": "ATTEMPT_LEARNING",
  "executionClosureDigest": "sha256:...",
  "interpretationDigest": "sha256:..."
}
```

### Attempt aborted

```json
{
  "type": "ATTEMPT_ABORTED",
  "executionClosureDigest": "sha256:..."
}
```

`ATTEMPT_ABORTED` carries no fake interpretation. A semantic no-change result may keep the same World payload while still producing a successor Head generation, so the execution is durably banked exactly once.

## Shared World-authority lock and CAS

Repo Decision admission and WorldTransition commit use the same short-lived exclusive repository authority lock.

Decision generation-1 entry:

```text
acquire world-authority lock
→ read current pointer / Head
→ require Decision.worldHeadDigest == current Head
→ require no existing first admission for that Head
→ create + fsync AttemptEntry
→ release lock
```

WorldTransition:

```text
acquire same lock
→ read current pointer / Head
→ require predecessorHeadDigest == current Head
→ validate admitted-execution constraints
→ persist immutable transition + successor Head
→ atomically replace current-world pointer
→ release lock
```

Atomic rename alone is not treated as concurrent CAS; the exclusive lock supplies the mutual exclusion.

An exact transition retry after a crash is idempotent:

```text
same transition
+ current Head already equals its deterministic successor Head
→ ALREADY_APPLIED
→ no new generation
```

## `repo-decision/v3`

Decision identity is the digest of the exact validated Decision bytes, which are persisted immutably before execution. Decision remains dereferenceable selection evidence even if the mutable repo-side Decision file later changes, but Decision digest is no longer the identity carried by new repo-owned work sessions.

Common authority fields:

```json
{
  "schemaVersion": "repo-decision/v3",
  "productDirectionDigest": "sha256:...",
  "charterDigest": "sha256:...",
  "worldHeadDigest": "sha256:...",
  "ownerDirectiveDigest": null,
  "decision": {}
}
```

The decision is a true sum type.

### DISPATCH

```json
{
  "type": "DISPATCH",
  "action": {
    "id": "bounded-action",
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
}
```

### NO_DISPATCH

```json
{
  "type": "NO_DISPATCH",
  "reason": "NO_VALUABLE_ACTION"
}
```

Generic reasons are:

```text
WAIT_EXTERNAL
WAIT_MATURITY
USE_PRODUCT
NO_VALUABLE_ACTION
```

`NO_DISPATCH` creates no work session, workspace, ExecutionPermit, or AttemptEntry. The active schema deliberately rejects `OWNER_DECISION_REQUIRED`: until an evidence-bearing authority/resource proof exists, a model assertion is not sufficient to manufacture owner authority.

## `outcome/v1`, `outcome-claim/v1`, and `work-session/v7`

Repo-directed DISPATCH first compiles a deliberately small immutable Outcome:

```text
id
desiredState
preconditions[]
evidenceRequirement
```

It then atomically acquires or reuses a Claim whose execution boundary is derived from the concrete allowed write paths. Same-Outcome claims and overlapping write boundaries fail closed; disjoint Claims may coexist from one origin WorldHead. No generic planner-authored `conflictKeys` exist in this slice.

Repo-owned v7 work carries Outcome + Claim provenance:

```json
{
  "origin": {
    "type": "REPO_OUTCOME",
    "outcomeDigest": "sha256:...",
    "claimDigest": "sha256:..."
  }
}
```

Direct owner work carries:

```json
{
  "origin": {
    "type": "OWNER_GOAL"
  }
}
```

The authority chain is:

```text
work-session/v7
→ outcomeDigest + claimDigest
→ Claim.originWorldHeadDigest
→ worldDigest + attestationDigest + lastTransitionDigest
```

The Repo Decision DISPATCH action also carries the exact resolved `base`; compilation copies that authority into `work-session/v7`. Base refs are not re-resolved during compilation or execution. The session proof spec is bound to the exact product result, newly-true behavior, done condition, product-direction digest, and base commit.

## `attempt-entry/v1`

AttemptEntry is the permit-consumption event itself. There is no separate execution-permit-consumption receipt and no separate repo-decision-consumption callback.

A new repo-owned generation-1 entry is stored at a Claim-scoped collision point. Bounded repairs may create ordinals 2 and 3 only as continuations of the same claimed session/workspace authority. Legacy Decision-scoped AttemptEntry objects remain readable as historical evidence.

```json
{
  "schemaVersion": "attempt-entry/v1",
  "permitId": "uuid",
  "permitDigest": "sha256:...",
  "sessionDigest": "sha256:...",
  "attemptId": "uuid",
  "generation": 1,
  "ordinal": 1,
  "workspaceId": "uuid",
  "origin": {
    "type": "REPO_OUTCOME",
    "outcomeDigest": "sha256:...",
    "claimDigest": "sha256:..."
  },
  "enteredAt": "...",
  "entryDigest": "sha256:..."
}
```

After generation-1 entry exists, that material attempt is forever non-replayable.

## Aggregate `execution-closure/v1`

Closure describes observable execution facts for the whole bounded run, not epistemic meaning for one attempt:

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

Operational dispositions include completed, partial, blocked, controller-rejected, and interrupted-after-entry. `INCONCLUSIVE`, `SUPPORTS`, claim validity, or scientific failure are not kernel dispositions.

A durable work result is persisted before/with closure identity. Recovery therefore follows this law:

> Record the strongest operational disposition supported by durable controller evidence. If no later durable evidence exists after AttemptEntry, close as `INTERRUPTED_AFTER_ENTRY`. A mechanically recovered exact BANK is later durable evidence and must not be downgraded to interruption.

Recovery reconstructs controller knowledge; it never reruns consumed material authority. When durable candidate-seal plus managed-workspace Git proof establishes the exact BANK, recovery persists a durable operational result before reconstructing `COMPLETED` closure.

## Parallel execution, linear World

Outcome Claim admission does not freeze its origin WorldHead. Multiple disjoint Claims may originate from Head H, and an unrelated `REALITY_REFRESH` may advance H while those executions continue.

```text
Head H
├─ Claim A → execution A
└─ Claim B → execution B

REALITY_REFRESH H → H1     permitted
B may continue execution   permitted
```

World commit remains linear. An `ATTEMPT_LEARNING` / `ATTEMPT_ABORTED` transition for a claimed Outcome must reference the unique aggregate Outcome ExecutionClosure and use the Claim's `originWorldHeadDigest` as predecessor. If current World has already advanced, normal CAS rejects the stale transition rather than committing blindly. Scoped revalidation/rebase after unrelated World changes is intentionally deferred.

## Recovery outcomes

If controller death leaves:

```text
AttemptEntry
+ no durable work result
+ no mechanically proven exact BANK
+ no closure
```

recovery creates an aggregate `INTERRUPTED_AFTER_ENTRY` closure and banks an `ATTEMPT_ABORTED` transition without replaying the worker.

If controller death occurs after exact BANK but before the operational work result or closure is persisted, recovery must re-prove the durable candidate seal against the managed workspace HEAD/tree/index/status, terminalize the workspace as `TERMINAL_COMMITTED`, persist a durable recovered work result, and reconstruct `COMPLETED` closure. That closure requires `ATTEMPT_LEARNING`; `ATTEMPT_ABORTED` is forbidden.

If durable work-result evidence exists but closure is missing, recovery must reconstruct closure from that stronger evidence rather than downgrade completion to interruption.

If a Claim closure has a work result, repo intelligence may supply the matching `ATTEMPT_LEARNING` interpretation/successor transition. That transition must still win normal World CAS; the execution itself does not freeze unrelated World refresh.

## Non-goals

This substrate does not implement:

- a generic allocator;
- scientific validity or evidence-applicability semantics;
- hypothesis similarity or alias detection;
- Quant D1-D9 semantics;
- automatic knowledge interpretation;
- a generic provenance DAG;
- a provider/plugin framework, daemon, queue, or scheduler.

Those remain repository intelligence or future work justified by an observed product defect.
