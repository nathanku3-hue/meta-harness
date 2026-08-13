# Repo Decision Plane v1

Decision Plane is an optional repository-owned protocol for complex systems that need domain-specific truth, learning, and next-action selection before Meta-Harness coding execution.

Meta-Harness does not implement a domain allocator. It validates the repository's current decision and deterministically compiles that decision into the existing `work-session/v2` kernel.

## Boundary

```text
owner intent / PRODUCT.md
repo-charter/v1
repo-world/v1
optional owner-directive.md
        ↓
repo-specific decision logic
        ↓
repo-decision/v1
        ↓
Meta-Harness compiler
        ↓
work-session/v2
        ↓
existing workspace / permit / worker / validation kernel
```

The kernel never decides domain value. Repo policy never weakens workspace custody, path safety, read-only worker authority, controller-owned materialization, or owner-only irreversible authority.

## Opt-in

A repository opts in by providing a regular non-symlink file at:

```text
.meta-harness/repo-charter.json
```

Once present, material `meta-harness work` execution cannot be sourced from `--goal`, `--session`, or `--allow`. The current decision must come from:

```text
.meta-harness/repo-charter.json
.meta-harness/repo-world.json
.meta-harness/repo-decision.json
```

An optional current owner strategy directive may live at:

```text
.meta-harness/owner-directive.md
```

The directive is raw owner input, not a fourth protocol object. Its exact byte digest is bound by `repo-decision/v1`. Absence is bound as `null`, so adding or removing a directive also makes the decision stale.

## `repo-charter/v1`

The charter is slow-changing and owner/version-controlled. It defines repository decision semantics without redefining kernel safety.

Required fields:

```json
{
  "schemaVersion": "repo-charter/v1",
  "version": "repo-policy-v1",
  "productDirectionDigest": "sha256:...",
  "objectiveHierarchy": ["PRIMARY", "PROCESS"],
  "factualTruthPrecedence": [
    "validated_observation",
    "canonical_factual_state",
    "derived_status",
    "prose_history"
  ],
  "strategicAuthorityPrecedence": [
    "current_owner_directive",
    "product_direction",
    "repo_charter",
    "derived_recommendation",
    "stale_history"
  ],
  "falsificationLayers": [],
  "resurrectionLaw": ["..."],
  "externalStateRequirements": ["data-snapshot"],
  "allocationPolicy": ["..."]
}
```

`externalStateRequirements` contains required identity names, not prose descriptions. Each name must be present in `repo-world/v1.truth.externalInputIdentities` before a decision can compile.

Additional domain-specific sources may be inserted into the two precedence lists, but these constitutional relative orders cannot be inverted:

```text
validated_observation
> canonical_factual_state
> derived_status
> prose_history
```

```text
current_owner_directive
> product_direction
> repo_charter
> derived_recommendation
> stale_history
```

This enforces the distinction:

```text
machine factual state may correct what already happened;
derived machine recommendation cannot override what the owner currently values.
```

## `repo-world/v1`

The world is machine-maintained epistemic state. It deliberately separates authoritative truth from derived recommendations and binds the committed code/config substrate against which the decision was made.

```json
{
  "schemaVersion": "repo-world/v1",
  "productDirectionDigest": "sha256:...",
  "charterDigest": "sha256:...",
  "executionBaseDigest": "sha256:...",
  "truth": {
    "facts": [],
    "supportedClaims": [],
    "contradictedClaims": [],
    "notEstablishedClaims": [],
    "positiveKnowledge": [],
    "negativeKnowledge": [],
    "terminalRoutes": [
      {
        "id": "stopped-route",
        "reason": "...",
        "evidenceRef": "receipt:negative-result",
        "validity": {
          "verdict": "PASS",
          "evidenceRef": "receipt:test-validity"
        },
        "resurrectionCondition": "New evidence must invalidate the prior epistemic basis."
      }
    ],
    "externalInputIdentities": [
      { "name": "data-snapshot", "identity": "snapshot:..." }
    ],
    "activeTracks": [],
    "blockedTracks": [],
    "currentBottleneck": "..."
  },
  "recommendation": {
    "candidateActions": [
      {
        "id": "action-id",
        "routeId": "route-id",
        "result": "Useful result",
        "status": "LEGAL",
        "reason": "...",
        "priorBasisInvalidatedByEvidenceRef": null
      }
    ],
    "recommendedNextActionId": null
  }
}
```

Claims are mutually exclusive across `supportedClaims`, `contradictedClaims`, and `notEstablishedClaims` by claim id.

### Committed execution-base binding

`executionBaseDigest` is computed from the exact tracked tree at current `HEAD`, including tracked object identities, modes, types, and paths. The four Decision Plane control files are excluded from this digest to avoid a self-referential world hash:

```text
.meta-harness/repo-charter.json
.meta-harness/repo-world.json
.meta-harness/repo-decision.json
.meta-harness/owner-directive.md
```

If any other committed tracked substrate changes, the world is stale and cannot dispatch work until repository intelligence rebuilds the world and decision. Mutable source-checkout dirt is still excluded by the existing fresh-worktree kernel; it never silently becomes the execution base.

### Terminal validity and resurrection

A route may appear in `terminalRoutes` only when its retained validity verdict is exactly `PASS`. The validity receipt is domain-owned evidence; Meta-Harness enforces the presence and PASS state but does not decide scientific validity itself. `UNKNOWN` or invalid tests cannot be encoded as terminal route death.

A candidate action names its logical `routeId`. A candidate for a route retained as terminal cannot become `LEGAL` unless `priorBasisInvalidatedByEvidenceRef` points to new evidence already banked in world truth. That evidence must differ from the prior terminal-result and validity receipts. A blocked terminal route carries no resurrection claim.

This gives the generic state law:

```text
negative observation
→ domain validity interpretation
→ validity PASS
→ terminal route may be banked

terminal route
→ new truth evidence invalidates prior basis
→ legal probation/reopen candidate may exist
```

Changing recommendation prose, a parameter label, or enthusiasm alone cannot reopen a terminal route.

Candidate actions belong under `recommendation`, never under `truth`. The repository may recommend one action, while a current owner directive may legitimately cause a different current `LEGAL` candidate to be selected.

## `repo-decision/v1`

The decision is intentionally small: it binds current identities and selects one legal action with the execution fields needed to compile `work-session/v2`.

```json
{
  "schemaVersion": "repo-decision/v1",
  "productDirectionDigest": "sha256:...",
  "charterDigest": "sha256:...",
  "worldDigest": "sha256:...",
  "ownerDirectiveDigest": null,
  "objective": "PRIMARY",
  "selectedAction": {
    "id": "action-id",
    "result": "Useful result",
    "doNow": "Nearest coding action",
    "newlyTrueBehavior": "Observable behavior after execution",
    "doneWhen": "Observable completion condition",
    "whyNow": "Why this legal candidate is selected now",
    "claimLayer": null,
    "stopOnlyIf": ["..."],
    "allowedPaths": ["src", "tests"],
    "validation": [
      { "argv": ["node", "--test"], "cwd": ".", "timeoutSeconds": 300 }
    ],
    "maxAttempts": 2,
    "delivery": { "commit": false, "push": false }
  },
  "rejectedAlternatives": []
}
```

The selected action must reference a current `LEGAL` candidate in `repo-world/v1`, its result must match that candidate, and any non-null `claimLayer` must be declared by the charter. Without a current owner directive, the decision objective must equal the charter primary objective. When a current owner directive exists, its exact digest is bound and repo intelligence may select a different current strategy/objective because owner strategy outranks the charter and derived recommendation; Meta-Harness does not attempt to semantically parse owner prose.

## Staleness

Before material execution Meta-Harness requires:

```text
live PRODUCT.md digest       == charter.productDirectionDigest
live PRODUCT.md digest       == world.productDirectionDigest
current charter digest       == world.charterDigest
current committed-base digest == world.executionBaseDigest
all charter-required external identity names exist in world truth
live PRODUCT.md digest       == decision.productDirectionDigest
current charter digest       == decision.charterDigest
current world digest         == decision.worldDigest
current owner directive digest == decision.ownerDirectiveDigest
```

Any mismatch is non-executable. Recompute the affected world/decision rather than reconciling stale prose.

`repo-decision/v1` compiles into the existing `work-session/v2`; the work-session schema is not extended. The complete repo-decision content digest is included in a generated stop condition, so the existing session digest also binds the decision identity. Resume therefore fails if the current decision no longer compiles to the persisted session.

The coding worker cannot mutate `repo-charter.json`, `repo-world.json`, `repo-decision.json`, or `owner-directive.md`, even under a broad allowed path. The read-only worker is also instructed not to reconstruct its sealed execution brief from planner/status prose or historical Decision Plane copies present in the immutable workspace base. Charter changes remain owner/policy work; world/decision updates remain Decision Plane work outside the coding worker path.

## Learning closure: one decision, one entered execution

Decision consumption happens when the controller has consumed the attempt's `ExecutionPermit` and immediately before the coding worker is invoked. Meta-Harness writes a create-only `repo-decision-consumption/v1` marker under the repository Git common directory. The marker binds decision digest, session digest, attempt id, and permit digest.

This timing is deliberate: once a real worker attempt has entered, a later worker exception, boundary violation, or validation failure cannot make the decision look unused. Bounded repair attempts in the same `work` invocation remain legal and reuse the same decision-consumption marker while workspace generation and ExecutionPermit identities advance normally.

When `work` returns a result after one or more attempts, Meta-Harness writes a separate create-only `repo-decision-result/v1` receipt. A result receipt requires the prior matching attempt-consumption marker.

After attempt entry, the same decision cannot start another material execution. Before a later `work`, repository intelligence must interpret what happened and create a new world/decision pair.

Valid closure includes either:

```text
observable result / failed attempt evidence
→ validity / interpretation
→ factual or claim-state delta
→ positive or negative knowledge delta
→ new repo-world
→ new repo-decision
```

or an explicit evidence-backed no-change finding banked into the new world.

This rule prevents a fresh agent from silently rerunning an already-entered recommendation while keeping domain interpretation outside the Meta-Harness kernel.

## Deliberate non-goals

Decision Plane v1 does not provide:

- a universal allocator or scoring formula;
- Quant, trading, scientific, or SaaS-specific semantics;
- adaptive/learned ranking;
- automatic charter mutation;
- automatic PRODUCT.md mutation;
- a provider/plugin framework, daemon, queue, or scheduler;
- a generic provenance platform;
- outcome reading, evaluation, trial-debit, state-transition, or route-reopen execution capabilities.

Repositories own candidate generation, evidence validity semantics, result interpretation, and ranking. Meta-Harness's coding ExecutionPermit continues to deny outcome/evaluation/trial-debit/state-transition/route-reopen capabilities unless a future explicitly authorized controller path grants them. Ranking-policy evolution, if added later, should be evidence-bound and promoted through replay/shadow evaluation rather than silently learning from successful-looking outcomes.
