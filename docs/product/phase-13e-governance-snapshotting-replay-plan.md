# Phase 13E Governance Snapshotting, Drift Detection, and Replay Plan

Status: patched plan pending audit
Date: 2026-06-13
Depends on: Phase 13A/13B context gate surfaces and ready integration
Implementation hold: wait for audit approval before coding.

## Purpose

Phase 13E gives context gate decisions an auditable governance identity. A
reviewer should be able to answer three questions from the artifact and local
repo state:

1. Which governance rules produced this decision?
2. Did governance drift since the decision was written?
3. Can the decision be rerun only when the current evidence still matches the
   original canonical evidence hash?

This phase must not simulate replay by mutating CommonJS exports. Every
rule-consuming path must accept an explicit governance object and default to
live governance only when no snapshot is supplied.

## Audit Findings Incorporated

### 1. Do not replay by overriding imported constants

Current modules import governance constants at module load:

- `lib/ready-context-gate-evaluation.js`
- `lib/context-gate-validation.js`
- `lib/context-gate-scoring.js`
- `lib/context-gate-artifact.js`
- `lib/context-gate-adoption.js`
- `lib/context-gate-graph.js`
- `lib/context-gate-utils.js`

Required patch:

- Add `lib/context-gate-governance.js`.
- Export `buildLiveGovernance()`, `governanceFromSnapshot(snapshot)`,
  `normalizeGovernance(input)`, `governanceHash(governanceOrSnapshot)`, and
  `validateGovernance(governance)`.
- Refactor rule-consuming functions to accept `{ governance }`, defaulting to
  `buildLiveGovernance()`.
- Refactor `normalizeTransition(input, { governance })` so transition
  validation uses `governance.allowed_transitions`. Replay may also normalize
  directly against snapshot governance before calling the scoring pipeline, but
  no replay path may pass through live `ALLOWED_TRANSITIONS`.
- Keep existing constants exports for compatibility, but stop treating them as
  the only source of truth inside replayable paths.

Governance must be threaded through:

- scoring: `evaluateContext(state, transition, now, { governance })`
- hints: `applyContextHints(..., { dimensions: governance.dimensions, ... })`
- artifact creation/finalization/rendering
- artifact validation and ready artifact validation
- transition normalization in `context-gate-utils.js`
- adoption checks, expected transition lookup, required/advisory checks, and
  bypass validation
- transition graph validation
- ready context gate evaluation and explain output

Acceptance:

- Replay code never mutates `require()` cache contents or exported constants.
- Snapshot replay accepts a transition that is valid under the snapshot even if
  live `ALLOWED_TRANSITIONS` has drifted, and rejects transitions invalid under
  the snapshot before scoring.
- Tests can run the same artifact with live governance and snapshot governance
  in the same process without order-dependent behavior.

### 2. Fingerprints belong to artifacts, not explain output

`checkContextQuality()` reads the evidence state before writes. `runContextGate()`
writes context artifacts and only later builds explain diagnostics. Therefore
fingerprints must be computed before artifact writes and embedded in every JSON
artifact.

Required patch:

- Add `lib/context-gate-fingerprint.js`.
- Add `canonicalEvidenceState({ state, hintsResult, targetRoot })` for normal
  artifact creation.
- Add `canonicalReplayEvidenceState({ targetRoot, artifact, artifactPath, now })`
  for replay evidence. This replay path must read the full event log, filter
  matching self-generated artifact events, and only then apply the same
  recent-event retention/window used by `readHarnessState()`.
- Add `evaluationFingerprintInput(artifact)`.
- Add `attachContextGateFingerprint({ artifact, governance, evidenceState })`.
- Call fingerprint attachment from `checkContextQuality()` before returning.
- If `runContextGate()` adds an override, attach the fingerprint again before
  validation and write so `evaluationHash` includes override identity.
- When replaying an artifact with `artifact.override`, copy the same override
  onto the replayed artifact before building the evaluation fingerprint. Scoring
  still happens before override handling, matching `runContextGate()`, but the
  final canonical evaluation hash must include the override code and actor.
- `context-gate-explain.js` must render the artifact fingerprint. It must not
  create the fingerprint.

Canonical evidence input:

- Include all state fields used by scoring and artifact summaries.
- Include parsed/normalized hint input because hints affect final scores,
  blockers, warnings, and verdicts.
- Read and normalize hints with `now = artifact.generated_at` for both original
  fingerprint creation and replay evidence hashing. Hint expiry and seven-day
  window checks are part of the decision input and must not depend on wall-clock
  replay time.
- Remove absolute `cwd`.
- Normalize path separators to `/`.
- Normalize text line endings to `\n`.
- For normal artifact creation, preserve event order as read by
  `readHarnessState()` because recent events are freshness evidence.
- During replay evidence hashing only, exclude self-generated
  `context-gate-override` and `context-gate-satisfied` events that match the
  replayed artifact identity. The match must be narrow: same `round_id`, same
  `transition`, same artifact-relative `evidence` path, same `verdict` when
  present, event time at or after `artifact.generated_at`, and for override
  events the same override code when `artifact.override` exists. Do not filter
  unrelated events or user-authored evidence changes.
- Replay event filtering must happen before recent-event retention. Current
  `readHarnessState()` keeps only the last five events, so replay evidence must
  not filter an already-sliced `state.events` array. It must read the full event
  log, remove only matching self-generated artifact events, and then apply the
  same last-five ordering rule. Otherwise one or two post-write gate events can
  push pre-write events out of the window and cause false `evidence_drift`.
- Exclude diagnostics, selected artifact paths, generated output paths,
  provenance summaries, and other fields not used as scoring inputs.

Canonical evaluation fingerprint input:

```json
{
  "schema_version": "1",
  "round_id": "ROUND-001",
  "transition": "plan->work",
  "generated_at": "2026-06-13T00:00:00.000Z",
  "scores": {},
  "structural_hard_blockers": [],
  "evidence_gap_dimensions": [],
  "unknown_dimensions": [],
  "verdict": "blocked",
  "override": {
    "code": "human_override",
    "actor": "human"
  }
}
```

Do not hash full evaluation objects. Full evaluations contain target roots,
current time values, age calculations, local paths, diagnostics, and provenance
that are not stable replay identity.

Artifact fingerprint shape:

```json
{
  "fingerprint": {
    "schema_version": "1",
    "governance_hash": "<sha256>",
    "evaluation_hash": "<sha256>",
    "evidence_hash": "<sha256>",
    "canonical_json": "state-hash/stableJson"
  }
}
```

Acceptance:

- Every newly generated context gate JSON artifact contains `fingerprint`.
- Existing artifacts without `fingerprint` remain readable for ready checks,
  packet assembly, and artifact validation compatibility. Governance replay
  requires fingerprints and returns `status: "fingerprint_missing"` when the
  target artifact predates Phase 13E.
- `--explain` output displays the same hashes from the artifact.
- Running with and without `--explain` writes the same artifact fingerprint when
  tests pin `now`, `roundId`, target evidence, and output path. Because
  `evaluation_hash` includes `generated_at`, wall-clock runs are expected to
  differ.
- The fingerprint is computed from pre-write evidence, so appending satisfied or
  override events after the write does not alter the artifact's stored evidence
  hash, and replay filters only those matching self-generated artifact events
  before comparing current evidence.

### 3. Replay targets a specific artifact and verifies evidence first

A governance snapshot plus current target root cannot deterministically replay
an old decision if harness state changed. Phase 13E defines replay as
evidence-verified rerun, not historical evidence reconstruction.

Required command:

```text
meta-harness governance replay --snapshot <path> --artifact <path> --target <repo> [--json]
```

Replay algorithm:

1. Read and validate the governance snapshot.
2. Read and validate the target artifact.
3. Confirm `artifact.fingerprint.governance_hash` matches the snapshot hash.
4. Recompute the current live `governance_engine_hash` from the local source
   files and confirm it matches `snapshot.governance_engine_hash`. If it does
   not match, return `status: "engine_drift"` and do not claim deterministic
   replay.
5. Re-read current canonical evidence from `--target`, including hints. For
   events, read the full event log, exclude only self-generated events matching
   the replayed artifact, then apply the same recent-event retention/window used
   by normal evidence reads.
6. Confirm current evidence hash matches `artifact.fingerprint.evidence_hash`.
7. Rerun the full scoring pipeline with:
   - governance from the snapshot
   - `now` fixed to `artifact.generated_at`
   - hints read with `now` fixed to `artifact.generated_at`
   - `roundId` fixed to `artifact.round_id`
   - transition fixed to `artifact.transition`
   - `artifact.override` reapplied to the replayed artifact before fingerprint
     comparison, when present
   - write disabled
8. Compare replayed canonical evaluation hash and verdict to the artifact.

If evidence hash mismatches, report `status: "evidence_drift"` and do not claim
a replay verdict match. Hash-only evidence can prove drift; it cannot reproduce
old missing evidence.

If the current live engine hash mismatches the snapshot, report
`status: "engine_drift"` before rerunning scoring. Snapshot governance cannot
make changed local source code deterministic.

Replay result shape:

```json
{
  "status": "match",
  "replayable": true,
  "matches_original": true,
  "governance_hash": "...",
  "governance_engine_hash": "...",
  "evidence_hash": "...",
  "original": {
    "round_id": "ROUND-001",
    "transition": "plan->work",
    "verdict": "blocked",
    "evaluation_hash": "..."
  },
  "replayed": {
    "verdict": "blocked",
    "evaluation_hash": "..."
  },
  "diff": []
}
```

Acceptance:

- Replay requires `--artifact`.
- Replay does not read the latest artifact implicitly.
- Replay requires `artifact.fingerprint`; legacy artifacts can still be consumed
  by ready/packet flows but cannot be replayed.
- Replay reports engine drift before scoring when current replay-relevant source
  files differ from the snapshot engine hash.
- Immediate replay after `runContextGate()` succeeds when the only evidence
  changes are matching self-generated override/satisfied events for the same
  artifact.
- Self-generated event filtering runs before the last-five event window is
  applied, so matching post-write gate events cannot evict pre-write evidence
  events during immediate replay.
- Evidence drift is a first-class outcome, distinct from verdict mismatch.
- Full scoring replay is the default.

### 4. Governance hash includes replay engine identity

Governance drift is not only constants drift. Scoring, finalization, validation,
hint parsing, transition normalization, and fingerprint canonicalization also
define decision behavior.

Required patch:

- Add `governance_engine_files` and `governance_engine_hash` to snapshots.
- Compute the engine hash from normalized contents of replay-relevant source
  files, using `/` paths and `\n` line endings before hashing.
- Include at minimum:
  - `lib/context-gate.js`
  - `lib/context-gate-utils.js`
  - `lib/context-gate-scoring.js`
  - `lib/context-gate-artifact.js`
  - `lib/context-gate-validation.js`
  - `lib/context-gate-adoption.js`
  - `lib/context-gate-graph.js`
  - `lib/context-hints.js`
  - `lib/context-gate-state.js`
  - `lib/context-gate-fingerprint.js`
  - `lib/context-gate-governance.js`
  - `lib/ready-context-gate.js`
  - `lib/ready-context-gate-evaluation.js`
  - `lib/state-hash.js`
- Include `governance_engine_hash` in `governanceHash()`.
- Diff `governance_engine_hash` as a high-signal drift item.

Acceptance:

- Replay reports governance drift when replay-relevant source changes even if
  constants are unchanged.
- If an implementation cannot hash engine files in a packaged environment, it
  must explicitly mark replay guarantees as valid only for the same package
  version and source revision. The preferred Phase 13E implementation is the
  source-file engine hash.

### 5. Snapshot validation has an explicit contract decision

`validateTransitionGraph()` currently defaults `checkContract` to true and
expects contract text. Phase 13E snapshots will include a contract template
hash, not the full contract text.

Required patch:

- Include `contract_template_hash` and `contract_template_path` in snapshots.
- Validate snapshot phase graph structure with `checkContract: false`.
- Keep existing live ready graph checks responsible for contract text drift.
- Diff `contract_template_hash` as a governance drift signal.

Acceptance:

- A valid snapshot can be validated without packaged contract text.
- Contract template changes appear in governance diff output.

### 6. Golden canonical hash fixtures replace cross-version claims

A single Node test run cannot prove hash stability across Node versions.

Required patch:

- Add fixtures under `tests/fixtures/governance/`:
  - canonical governance input
  - canonical evidence input
  - canonical evaluation input
  - expected stable JSON strings
  - expected SHA-256 hashes
- Tests assert `stableJson()` and `stateHash()` match those golden fixtures.

Acceptance:

- Tests prove local canonicalization against checked-in expected values.
- No test claims cross-version stability beyond fixture compatibility.

## Deliverables

### Deliverable 1: Governance snapshot and hash

New file: `lib/context-gate-governance.js`

Snapshot fields:

```json
{
  "schema_version": "1",
  "generated_at": "<ISO>",
  "version": "<package.json version>",
  "phases": [],
  "streams": [],
  "allowed_transitions": [],
  "required_gate_transitions": [],
  "optional_gate_transitions": [],
  "phase_to_expected_transition": {},
  "dimensions": [],
  "valid_verdicts": [],
  "bypass_reason_codes": [],
  "execution_transitions": [],
  "default_max_artifact_age_days": 7,
  "contract_template_path": "templates/contracts/context-adoption-contract.md",
  "contract_template_hash": "<sha256>",
  "governance_engine_files": [],
  "governance_engine_hash": "<sha256>"
}
```

Functions:

- `buildLiveGovernance({ sourceRoot, generatedAt })`
- `governanceFromSnapshot(snapshot)`
- `readGovernanceSnapshot(snapshotPath)`
- `writeGovernanceSnapshot({ targetRoot, out })`
- `governanceHash(governanceOrSnapshot)`
- `validateGovernance(governance)`

Hash rules:

- Exclude `generated_at`.
- Normalize sets to sorted arrays.
- Include `governance_engine_hash`.
- Use `stateHash()` over canonical governance.

Default output path:

```text
.meta-harness/governance/snapshots/governance-snapshot.json
```

Use one canonical snapshot file for now. Timestamped history is out of scope.

### Deliverable 2: Governance diff

New file: `lib/governance-diff.js`

Function:

- `diffGovernanceSnapshots(baseline, current)`

Diff categories:

- added/removed allowed transitions
- changed required/advisory partition
- changed phase order
- changed phase-to-transition map
- changed dimensions
- changed valid verdicts
- changed execution transitions
- changed bypass reason codes
- changed artifact age policy
- changed package version
- changed contract template hash
- changed governance engine hash

CLI behavior:

```text
meta-harness governance diff [--snapshot <path>] [--target <repo>] [--json]
```

- With `--snapshot`: compare that snapshot to live governance.
- Without `--snapshot`: compare the canonical saved snapshot to live governance.
- Human output is a compact table by default.
- `--json` returns the structured diff object.

### Deliverable 3: Fingerprinted context artifacts

New file: `lib/context-gate-fingerprint.js`

Modify:

- `lib/context-gate.js`
- `lib/context-gate-artifact.js`
- `lib/context-gate-validation.js`
- `lib/context-gate-explain.js`
- `lib/ready-context-gate-evaluation.js`
- `lib/ready-context-gate.js`

Behavior:

- `checkContextQuality()` computes canonical evidence before any artifact write.
- Context hints are included in canonical evidence and parsed at the artifact
  clock, not replay wall-clock time.
- Replay canonical evidence filters only matching self-generated
  override/satisfied events for the replayed artifact before applying the
  last-five recent-event retention/window; unrelated events remain evidence and
  can cause `evidence_drift`.
- Final artifact JSON always includes `fingerprint`.
- Validators tolerate missing fingerprints for legacy ready/packet
  compatibility, but surface the missing state in diagnostics when useful.
- Markdown may include a short fingerprint section if existing output style
  supports it, but JSON is authoritative.
- Explain renders the artifact fingerprint and may add diagnostic text around
  mismatches.

### Deliverable 4: Snapshot-backed replay

New file: `lib/governance-replay.js`

Function:

- `replayFromSnapshot({ snapshotPath, artifactPath, targetRoot })`

Required behavior:

- Load snapshot governance with `governanceFromSnapshot()`.
- Validate the artifact using snapshot governance.
- Reject or mark drift when governance hash mismatches.
- Recompute the current live `governance_engine_hash` and return
  `status: "engine_drift"` before scoring if it differs from the snapshot.
- Rebuild canonical evidence with artifact-clock hints and matching
  self-generated artifact events filtered out before the recent-event
  retention/window is applied.
- Reject or mark drift when the filtered evidence hash mismatches.
- Rerun `checkContextQuality()` with fixed artifact time, round, transition,
  target, and governance only after hashes match.
- Reapply `artifact.override` before computing the replayed evaluation hash.
- Compare canonical evaluation hash, verdict, score object, blocker arrays, gap
  arrays, unknown arrays, and override identity.

### Deliverable 5: CLI command

New file: `lib/commands/governance.js`

Modify: `lib/command-registry.js`

Usage:

```text
meta-harness governance snapshot [--target <repo>] [--out <path>] [--json]
meta-harness governance diff [--snapshot <path>] [--target <repo>] [--json]
meta-harness governance replay --snapshot <path> --artifact <path> --target <repo> [--json]
```

The command must be read-only except `snapshot`, which writes only the snapshot
file requested by the user or the canonical snapshot path.

## Implementation Order

1. Add governance snapshot and diff modules.
2. Add golden canonical JSON/hash fixtures.
3. Add governance injection seams through transition normalization, scoring,
   artifact, validation, adoption, graph validation, and ready evaluation.
4. Add artifact fingerprints computed before writes.
5. Render fingerprint in explain output.
6. Add replay against a specific artifact.
7. Add CLI wiring and help/registry tests.

Replay intentionally comes after the governance seam exists.

## Test Plan

New tests:

- `tests/governance-snapshot.test.js`
- `tests/governance-diff.test.js`
- `tests/context-gate-fingerprint.test.js`
- `tests/governance-replay.test.js`
- `tests/cli-governance.test.js`

Required coverage:

- Identical governance snapshots produce identical hashes.
- `generated_at` changes do not change governance hash.
- Snapshot write/read preserves canonical governance.
- Snapshot graph validates with `checkContract: false`.
- Contract template hash changes appear in diff.
- Governance engine hash changes appear in diff.
- Added/removed transitions are detected.
- Required/advisory transition changes are detected.
- Dimension changes are detected.
- Golden canonical JSON/hash fixtures match checked-in expected values.
- Context artifacts include fingerprints without `--explain`.
- Legacy artifacts without fingerprints still pass existing ready/packet
  compatibility checks, while governance replay rejects them explicitly.
- `--explain` displays artifact fingerprints, not recomputed explain-only
  hashes.
- The with/without `--explain` fingerprint equivalence test pins `now`,
  `roundId`, target evidence, and output path because `evaluation_hash` includes
  `generated_at`.
- Evidence hash is computed before post-write events are appended.
- Immediate replay after a context gate write matches when the only new events
  are matching self-generated override/satisfied events for that artifact.
- Immediate replay still matches when the pre-write event log already has five
  relevant events and post-write self-generated gate events would otherwise push
  them out of `readHarnessState()`'s last-five window.
- Appending an unrelated event after the artifact produces `evidence_drift`.
- Hint changes alter evidence hash.
- Hint expiry behavior is stable because fingerprinting and replay both parse
  hints at `artifact.generated_at`.
- Replay carries `artifact.override` into the replayed artifact before
  comparing evaluation hashes.
- Replay matches when governance and evidence hashes match.
- Replay returns evidence drift when target evidence changes.
- Replay returns governance drift when snapshot hash differs from artifact
  governance hash.
- Replay returns engine drift before scoring when current live replay engine hash
  differs from the snapshot.
- Replay can run live and snapshot governance in the same process without
  leaking rule state.

Automated verification:

```text
node scripts/run-tests.js
```

Manual verification:

```text
meta-harness governance snapshot --target . --json
meta-harness governance diff --target .
meta-harness context check --from plan --to work --json
meta-harness context check --from plan --to work --explain
meta-harness governance replay --snapshot .meta-harness/governance/snapshots/governance-snapshot.json --artifact .meta-harness/local/context/ROUND-001.json --target . --json
```

## Non-Goals

- No timestamped snapshot history.
- No reconstruction of historical evidence from hash-only artifacts.
- No mutation of live CommonJS module exports for replay.
- No remote governance store.
- No promise of cross-Node hash stability beyond checked-in golden fixture
  compatibility.

## Audit Checklist

- [ ] Governance object exists and is injected into all rule-consuming paths.
- [ ] `normalizeTransition()` validates against injected governance, not live
      constants, in replayable paths.
- [ ] Snapshot/diff can be reviewed before replay implementation.
- [ ] Artifact fingerprints are present even without `--explain`.
- [ ] Fingerprint timing uses pre-write canonical evidence.
- [ ] With/without `--explain` fingerprint equivalence tests pin clock, round,
      target evidence, and output path.
- [ ] Hint parsing uses the artifact clock for both original fingerprinting and
      replay.
- [ ] Replay requires an artifact and verifies evidence hash before rerun.
- [ ] Replay filters only matching self-generated artifact events before
      applying the recent-event retention/window and comparing evidence hashes.
- [ ] Replay reapplies artifact overrides before evaluation-hash comparison.
- [ ] Replay recomputes current live governance engine hash and reports
      `engine_drift` before scoring when it differs from the snapshot.
- [ ] Legacy artifacts without fingerprints remain ready/packet-compatible but
      are not replayable.
- [ ] Evaluation hash uses a small canonical input, not the full evaluation.
- [ ] Governance hash includes replay engine identity or explicitly scopes
      replay to unchanged package/source revision.
- [ ] Snapshot validation has an explicit contract-hash/checkContract decision.
- [ ] Tests use golden canonical JSON/hash fixtures.
