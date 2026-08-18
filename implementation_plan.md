# OUTCOME_CLAIM_AUTHORITY_1

Status: **IMPLEMENTED AND VALIDATED — READY TO BANK**

## Product result

Destroy repository-global autonomous work identity without building the planner/allocator ahead of evidence.

After this slice, two disjoint repo-owned Outcomes derived from the same authoritative World can acquire independent durable Claims, bind separate sessions/workspaces, and enter execution without owner routing or a repository-global “finish the active result first” gate.

World remains linear. Workspace execution custody remains exact. Full scoped commit freshness and full forward-motion/EscalationProof remain later slices.

## Audit corrections incorporated

The architecture audit changed the candidate plan in three material ways:

1. **Unsupported authority escalation dies now.** A model cannot turn an asserted/nonexistent authority dependency into durable owner input. The active Decision schema has no evidence-bearing authority-resource proof, so `OWNER_DECISION_REQUIRED` is rejected as `MH_UNEVIDENCED_AUTHORITY_BLOCKER`. Full alternative-means search remains Phase 4.
2. **Outcome is minimal.** Slice 1 does not constitutionalize planner/context ontology. `outcome/v1` contains only `id`, `desiredState`, `preconditions`, and `evidenceRequirement` plus digest.
3. **Compatibility derives from concrete execution authority.** There are no generic planner-authored `conflictKeys`. The first compatibility function compares Claim write boundaries derived from existing allowed paths.

The audit also confirmed that Claim is a real authority object distinct from AttemptEntry and workspace lease:

```text
Claim
  "this Outcome is currently taken"

AttemptEntry
  "this execution generation entered"

workspace execution lease
  "this controller currently has runtime custody of this workspace"
```

Claim therefore survives process/session identity while runtime custody remains replaceable.

## Slice laws

```text
Outcome = durable repo-owned work identity
Scope = derived execution authority

Outcome stable
Means disposable

Execution independently claimable
World linear

Decision may select/described work
Decision is not autonomous work identity

Planner proposes later
Kernel admits now
Controller executes

Models cannot create authority by assertion
```

## Permanent schemas added

### `outcome/v1`

```text
schemaVersion
id
desiredState
preconditions[]
evidenceRequirement
outcomeDigest
```

No capability requirements, context selectors, invariants DSL, escalation triggers, priority, queue metadata, conflict keys, actor role, or planner ontology is added in this slice.

### `outcome-claim/v1`

```text
schemaVersion
claimId
outcomeDigest
originWorldHeadDigest
preconditionDigest
executionBoundary.writePaths[]
acquiredAt
claimDigest
```

The Claim is immutable. Release is a separate immutable tombstone. Session/workspace binding is a separate immutable Claim binding. This avoids turning Claim into another mutable lease state machine.

### `work-session/v7`

Owner-goal origin remains:

```text
OWNER_GOAL
```

Repo-owned origin hard-cuts to:

```text
REPO_OUTCOME
  outcomeDigest
  claimDigest
```

`REPO_DECISION` is not a valid v7 work-session origin. Legacy Decision-origin AttemptEntry/ExecutionClosure evidence remains readable only for retained recovery compatibility.

## Active-path deletions

The slice removes these semantics from new repo-owned execution:

```text
one admission per WorldHead

WorldHead frozen merely because
another independent execution exists

one repository-global ACTIVE repo work item

latest.json as repo-owned execution authority

different active repo result
→ owner routing

whole WorldHead equality
→ generation-1 execution freshness

Repo Decision as autonomous work identity
```

It preserves:

```text
linear World CAS
workspace custody
workspace execution lease
ExecutionPermit
read-only worker proposal
controller materialization
candidate seal
isolated validation
product proof
BANK
ExecutionClosure
```

## Compatibility rule for Slice 1

```text
same Outcome
→ reject duplicate Claim

write-boundary overlap
→ reject conflicting Claim

disjoint write boundaries
→ coexist
```

Path overlap is structural: `.` conflicts with all, equal paths conflict, and ancestor/descendant write scopes conflict.

Non-filesystem resources such as schema migrations, deployment targets, databases, external mutable resources, or API contracts are deliberately not generalized until an observed defect requires a wider compatibility model.

## World semantics

Claim `originWorldHeadDigest` is provenance, not a requirement that the whole World remain unchanged before execution begins.

Therefore:

```text
Claim A from H
Claim B from H
World reality refresh H → H1
B may still enter execution
```

But Slice 1 does not claim scoped commit freshness. Outcome learning still uses linear World compare-and-swap. If the current World has advanced since the Claim origin, learning from the stale predecessor fails closed:

```text
B closure originated from H
current World = H1
attempt B learning from H
→ MH_WORLD_CONFLICT
```

Phase 3 will replace that whole-predecessor commit limitation with scoped revalidation/rebase when B's actual preconditions remain true.

## Unsupported authority gate now; full forward motion later

The immediate constitutional split is:

```text
NOW
fictional/unsupported owner authority impossible

LATER
failure of one means cannot establish Outcome blockage
until viable alternatives are exhausted
```

Slice 1 does not add attemptedMeans, alternativeMeans, research resolver, or full EscalationProof. It only prevents the known false-authority assertion from entering durable control state.

## Acceptance suite

The slice is not bankable until these behaviors are mechanically covered:

1. **Same World, disjoint:** A Claim succeeds; B Claim succeeds.
2. **Same Outcome race:** two fresh processes race; exactly one Claim wins.
3. **Conflicting execution boundary:** overlapping write boundaries cannot both become active.
4. **Unrelated World advance:** A/B start from H; H advances; B remains executable.
5. **Relevant/stale commit protection:** a closure from stale H cannot blindly mutate current World H1.
6. **Process amnesia:** a fresh process discovers active Claim/session/workspace state without conversation memory.
7. **No global latest authority:** concurrent repo-owned sessions coexist without one `latest.json` deciding which is “the” work.
8. **False authority:** unsupported `OWNER_DECISION_REQUIRED` is rejected rather than propagated.

Additional retained regressions prove aggregate bounded-repair closure, immutable World lineage, exact World CAS, missing/corrupt closure evidence rejection, owner-goal continuity, workspace isolation/custody, BANK, product proof, and bounded repair.

## Deliberately deferred

```text
automatic planner generation of Outcomes
automatic capacity filling
queue/scheduler daemon
priority/fairness/preemption
scoped closure commit/rebase
full means-substitution search
EscalationProof
research promotion
ContextCompiler
adaptive SAW review
DRAIN / WAKE
provider/plugin framework
multi-provider execution
```

## Validation

Minimum banking validation:

```text
node --test tests/outcome-claim-authority.test.js
node --test tests/execution-permit.test.js
node --test tests/work-session.test.js
node --test tests/work-git.test.js
node --test tests/repo-decision-plane-v2.cases.js
node --test tests/work-loop.test.js tests/product-direction-continuity.test.js tests/coding-system-live.test.js
npm test
git diff --check
```

`PRODUCT.md` is owner-authored and is not modified by this slice.
