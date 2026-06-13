# Phase 13F Governance Compatibility Classification Plan

Status: sign-off-ready for implementation
Date: 2026-06-13
Depends on: Phase 13E governance snapshotting, drift detection, and replay
Implementation scope: minimal classifier slice only

## Purpose

Phase 13F adds semantic compatibility classification to governance diffs without
changing snapshot hashes, replay behavior, migration packaging, or dependencies.
The immediate goal is to make `meta-harness governance diff --json` report
whether a drift is compatible, additive, or breaking using the CommonJS runtime
that exists today.

This plan intentionally does not implement the broader versioning and migration
framework yet. It first gives governance drift a conservative, auditable
classification layer over the current `diffGovernanceSnapshots()` output.

## Current Runtime Surface

The active implementation is CommonJS under `lib/`, not TypeScript under `src/`.
The relevant files are:

- `lib/context-gate-governance.js`
- `lib/governance-diff.js`
- `lib/commands/governance.js`
- `lib/governance-replay.js`

The current diff engine emits category-based changes from normalized governance
snapshots. It does not emit object paths such as `gates[*].enforcement` or
`transitions[*].requiredGates`.

Current categories emitted by `lib/governance-diff.js` are:

- `allowed_transitions`
- `gate_partition`
- `phase_order`
- `phase_to_expected_transition`
- `dimensions`
- `valid_verdicts`
- `execution_transitions`
- `bypass_reason_codes`
- `artifact_age_policy`
- `package_version`
- `contract_template_hash`
- `governance_engine_hash`

## Non-Goals

This slice must not:

- Add `governanceVersion` to snapshots.
- Change `governanceHash()` or canonical snapshot hashing.
- Change context artifact fingerprints.
- Add migration packs or a `governance/migrations/` directory.
- Add an `upgrade-check` CLI command.
- Add cross-version replay.
- Add `semver` or any other dependency.
- Change `package.json` publish allowlists.
- Create a TypeScript `src/` architecture.

These are deferred until the contract model, hash-compatibility policy, and
cross-version replay semantics are designed separately.

## Output Contract

`diffGovernanceSnapshots()` should preserve the existing response shape and add
one top-level field:

```json
{
  "classification": {
    "change_level": "NONE",
    "breaking": false,
    "migration_required": false,
    "reasons": []
  }
}
```

Field names must follow the repo's existing snake_case JSON style:

- `change_level`
- `breaking`
- `migration_required`
- `reasons`

Allowed `change_level` values:

- `NONE`
- `PATCH`
- `MINOR`
- `MAJOR`

Each reason should use a diagnostic shape like:

```json
{
  "code": "unknown_category",
  "category": "some_new_category",
  "change_level": "MAJOR",
  "breaking": true,
  "message": "unknown governance diff category some_new_category classified as MAJOR"
}
```

Per-change annotations may be added in `changes[]`:

```json
{
  "category": "package_version",
  "label": "package version changed",
  "baseline": "0.1.0",
  "current": "0.1.1",
  "severity": "PATCH",
  "breaking_reason": null
}
```

Existing fields must remain compatible:

- `schema_version`
- `ok`
- `baseline_hash`
- `current_hash`
- `counts`
- `changes`

## Classification Rules

### Clean Diff

If `changes.length === 0`, return:

- `change_level`: `NONE`
- `breaking`: `false`
- `migration_required`: `false`
- `reasons`: `[]`

Do not default clean diffs to `PATCH`.

### Explicit Category Rules

| Category | Rule | Level | Breaking |
| --- | --- | --- | --- |
| `package_version` | Runtime package version drift only | `PATCH` | `false` |
| `contract_template_hash` | Template hash changed, content intent unknown | `MAJOR` | `true` |
| `governance_engine_hash` | Replay/governance engine changed | `MAJOR` | `true` |
| `phase_order` | Phase order changed | `MAJOR` | `true` |
| `phase_to_expected_transition` | Phase-to-transition semantics changed | `MAJOR` | `true` |
| `artifact_age_policy` | Artifact validity policy changed | `MAJOR` | `true` |
| `dimensions` | Artifact score/schema shape changed | `MAJOR` | `true` |

### Allowlisted Set Categories

The following set categories may be additive `MINOR`, but any removal is
`MAJOR`:

- `allowed_transitions`
- `execution_transitions`
- `valid_verdicts`
- `bypass_reason_codes`

Rules:

- Added entries only: `MINOR`, `breaking: false`
- Any removed entry: `MAJOR`, `breaking: true`
- Mixed added and removed entries: `MAJOR`, `breaking: true`

No other category should use a generic set default.

### Gate Partition

`gate_partition` requires nested-set logic:

- `required.added` non-empty: `MAJOR`
- `required.removed` non-empty: `MAJOR`
- `advisory.added` only: `MINOR`
- `advisory.removed` non-empty: `MAJOR`
- Mixed changes: max severity

Required gate partition changes are breaking because they alter enforcement.
Advisory gate additions are additive and non-breaking. Advisory removals are
treated as breaking because older explainability and advisory behavior may no
longer replay semantically.

### Unknown Categories

Unknown categories must fail closed:

- `change_level`: `MAJOR`
- `breaking`: `true`
- `migration_required`: `true`

Unknown-category reasons must include:

- `code: "unknown_category"`
- the original `category` name
- a clear diagnostic message

## Implementation Steps

### 1. Add Classifier Module

Create:

- `lib/governance-compatibility.js`

Export at least:

- `classifyGovernanceChanges(changes)`

The classifier should:

- Accept the current `changes[]` shape from `diffGovernanceSnapshots()`.
- Return the top-level `classification` object.
- Return per-change annotations, or expose enough data for
  `governance-diff.js` to annotate changes.
- Compute the maximum severity across all changes.
- Fail closed to `MAJOR` for unknown categories.

### 2. Wire Diff Integration

Modify:

- `lib/governance-diff.js`

After computing structural changes:

1. Pass `changes` to `classifyGovernanceChanges(changes)`.
2. Preserve all existing diff fields.
3. Add top-level `classification`.
4. Annotate changes with `severity` and `breaking_reason` when useful.

### 3. Preserve CLI Behavior

Modify only as needed:

- `lib/commands/governance.js`

`governance diff --json` should naturally include `classification` because it
prints the full diff result.

Human output can remain unchanged for this minimal slice. If changed, it should
only append compact classification information and must not break existing JSON
tests.

### 4. Do Not Touch Hashing or Replay

Do not modify:

- `governanceHash()`
- `normalizeGovernance()` for version fields
- replay drift checks
- artifact fingerprint logic

Cross-version replay cannot be layered onto the current replay path because
`replayFromSnapshot()` intentionally rejects governance hash drift and engine
drift before replaying.

## Test Plan

Add:

- `tests/governance-compatibility.test.js`

Extend:

- `tests/governance-diff.test.js`
- `tests/cli-governance.test.js`

Optional guard:

- `tests/governance-snapshot.test.js`

Required test cases:

1. Clean diff returns `classification.change_level === "NONE"`.
2. `package_version` returns `PATCH`.
3. `contract_template_hash` returns `MAJOR`.
4. `governance_engine_hash` returns `MAJOR`.
5. `phase_order` returns `MAJOR`.
6. `phase_to_expected_transition` returns `MAJOR`.
7. `artifact_age_policy` returns `MAJOR`.
8. Any `dimensions` change returns `MAJOR`.
9. Additive `allowed_transitions` returns `MINOR`.
10. Removed `allowed_transitions` returns `MAJOR`.
11. Additive `execution_transitions` returns `MINOR`.
12. Removed `execution_transitions` returns `MAJOR`.
13. Additive `valid_verdicts` returns `MINOR`.
14. Removed `valid_verdicts` returns `MAJOR`.
15. Additive `bypass_reason_codes` returns `MINOR`.
16. Removed `bypass_reason_codes` returns `MAJOR`.
17. Advisory gate addition in `gate_partition` returns `MINOR`.
18. Advisory gate removal in `gate_partition` returns `MAJOR`.
19. Required gate addition in `gate_partition` returns `MAJOR`.
20. Required gate removal in `gate_partition` returns `MAJOR`.
21. Mixed `gate_partition` changes return the max severity.
22. Unknown category returns fail-closed `MAJOR`.
23. Unknown category reason includes `code: "unknown_category"` and the category
    name.
24. `governance diff --json` includes snake_case classification fields.

Optional hash-compatibility guard:

- Assert that adding classification to diff output does not change
  `governanceHash(buildLiveGovernance(...))`.

## Verification

Run:

```bash
npm test
```

Manual JSON smoke test:

```bash
node bin/meta-harness.js governance snapshot --target . --json
node bin/meta-harness.js governance diff --target . --json
```

Expected behavior:

- Clean local diff exits `0`.
- Clean local diff reports `classification.change_level: "NONE"`.
- Drifted snapshots still exit `1`.
- Drifted JSON includes conservative compatibility classification.

## Audit Notes Incorporated

This plan incorporates the audit requirements:

- Use CommonJS under `lib/`.
- Match the current category-based diff shape.
- Preserve existing snapshot hashes and replay fingerprints.
- Treat `contract_template_hash` as `MAJOR` because hash-only diff cannot prove
  the change is descriptive-only.
- Add explicit clean-diff `NONE`.
- Use nested-set logic for `gate_partition`.
- Treat `dimensions` changes as `MAJOR`.
- Use allowlisted additive set behavior only.
- Fail closed with `unknown_category` diagnostics.
- Avoid migrations, package churn, semver, and cross-version replay in this
  slice.

## Rollback

Rollback is limited to removing:

- `lib/governance-compatibility.js`
- the classification integration in `lib/governance-diff.js`
- related tests

No persisted data, snapshot hashes, package metadata, or replay behavior should
need rollback because this slice only enriches diff output.
