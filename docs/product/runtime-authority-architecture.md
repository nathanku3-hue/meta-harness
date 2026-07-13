# Runtime Authority Architecture (concise)

**Status:** D068 / 23A-PR1R — **closed under `be82763`** (PR #23 squash; request-digest invariant, absolute paths, strict outer envelopes)

**Rule:** Behavioral authority lives in schemas + tests. This doc stays short.

## Objects

```text
RunSpec (immutable requested work; attempt-agnostic; no approval binding)
  → RunSpecApproval (exact RunSpec envelope; approvalDigest over body)
  → ExecutionReadinessFacts (sealed; freshness + workspacePolicyDigest)
  → AttemptAuthorization (prepare-workspace only; policy-bound provider)
  → WorkspaceAttestation (repo identity + workspacePolicyDigest)
  → WorkspaceStartCheck (START_ALLOWED | BLOCKED | FAILED | STALE)
  → trusted ImplementationFacts (required factsDigest; runtime custody)
  → ImplementationAssessment (delivery-independent; binds factsDigest)
```

Phase 20–22 operator-plan / readiness / worker-entry gate objects are **not** authority inputs.
They may remain as diagnostic guidance. Delivery assessment is **not** part of PR1R.

## Invariants

1. Requested work ≠ permission to run. Approval is a separate exact envelope.
2. Authorization accepts the complete `RunSpecApproval` object only — never digest-beside-different-spec.
3. Content digests prove integrity/consistency only — **not** provenance or issuer identity.
4. Trusted runtime/store establishes origin and custody of facts and approvals.
5. `attemptId` lives on authorization and downstream binds — never on `RunSpec`.
6. Provider, TTL, readiness age, command timeout ceiling, and workspace root policy come from trusted `policy` only.
7. Policy identity (`authorizationPolicyDigest`, `workspacePolicyDigest`) binds into the receipt and idempotency key.
8. `authorizationRequestDigest` is recomputed from the receipt’s full explicit identity on every sealed validation (receipt invariant).
9. Pre-start capability is fixed: prepare-workspace. Start is allowed only after `WorkspaceStartCheck`.
10. Authorization validity is enforced at start (`checkedAt` in window). Later expiry does not erase completed work.
11. Implementation assessment requires complete fact bindings, semantic start revalidation, and `factsDigest`.
12. Worker never receives push/PR credentials.
13. Deny overrides allow; ambiguous paths fail closed.
14. `workspacePolicy.approvedRoot` and `attestation.repositoryRoot` are host-native absolute normalized paths (same-host semantics only; no cross-host portability in v1).
15. Public transitions strict-validate outer input envelopes before property access and return structured failures.

## Provenance honesty

A pure JavaScript validator can only check structural consistency. A fully fabricated but well-formed chain can still be internally consistent. PR1R does **not** cryptographically authenticate issuers.

## Chronology

```text
approval.approvedAt
  ≤ readiness.inspectedAt
  ≤ authorization.issuedAt
  ≤ attestation.collectedAt
  ≤ startCheck.checkedAt
  < authorization.expiresAt

command.startedAt ≥ startCheck.checkedAt
command.endedAt ≥ command.startedAt
command duration ≤ command.timeoutSeconds
git.collectedAt ≥ every command.endedAt
facts.collectedAt ≥ git.collectedAt
```

Readiness also requires `now - inspectedAt ≤ policy.maxReadinessAgeSeconds`.

## Current functional-first sequence

1. **D069** local controller walking slice — **closed under `e8e7713`** (PR #24; reviewed head `245fa3d`; base `5afe075`): historical fixed-fixture path. Its former `internal/d069` production lineage was deleted by D073.
2. **D070-A0 decision:** direct Codex workspace-write is NO-GO on the current Windows host; authenticated `:read-only` schema output followed by controller validation/materialization is GO.
3. **D070-A1 transport/custody closed:** sealed authorization → START_ALLOWED → claim → one async authenticated Codex `:read-only` process → strict artifact → clean custody → controller commit → validation → durable create-only ref → replay. Node/launcher/native hashes and an observed Codex version are revalidated before spawn. The terminal journal binds SHA-256 for AO metadata, validated artifact, and schema; replay fails if any are missing or changed. No raw AO stream persistence. No fixture-worker path.
4. **D071 functional execution PASS under `74f8ac1`; terminal custody closure superseded:** sealed `RunSpec.objective` → isolated ToolLauncher `7fab419f20ba` / `scripts/utils/CheckShortcut.ps1` → Codex `:read-only` → controller commit → Windows PowerShell 5.1 missing/valid/corrupt validation → live `IMPLEMENTATION_VERIFIED` + in-process replay. Marker path deleted. Post-close audit found that test cleanup deleted the isolated repository and state root, so the verified child commit/ref and AO evidence did not survive. Correction: `docs/ops/audits/d071-post-close-custody-audit.json`.
5. **D072 custody substrate implemented; ToolLauncher-specific live closure failed and is superseded:** canonical receipt lookup precedes execution-tool binding, readiness collection, and authorization; tools bind lazily; terminal evidence publishes with the manifest last; fresh-process tool-canary replay, conflict handling, and portable prerequisite-bundle verification pass offline. Exact candidate `5d677a8` passed the 116-file native suite, then one successful live AO spawn produced a PowerShell artifact that failed the omitted-parameter branch before terminal publication. The failed create-only root is retained. This failure does not close or disprove custody; it proves the closure gate still couples custody to legacy child semantics.
6. **D073 REPLACE+CLOSE closed under `87de018`:** the active bounded-repository-change skill and sole `internal/execution-custody` runtime completed live Fluxara VERIFIED with one spawn, normal fresh-process tool-canary REPLAY with zero spawns, independent portable verification, and leakage PASS. ToolLauncher, PowerShell, CheckShortcut.ps1, the temporary Windows classifier, phase-numbered runtime identity, `internal/d069` production imports, and the former execution path are deleted. No backward-compatible adapter, dual runtime, or provider registry exists.
7. **D074 PROVE next:** add a third real child through one new example under the existing skill and one end-to-end test, plus a deterministic child fixture only when necessary. It may not change `SKILL.md`, runtime, kernel, CLI, roadmap, or architecture truth.
8. **DELETE after D074:** reduce the public control plane by current supported user job and unique safety invariant only; preserve no alias, deprecated dispatch, compatibility schema, or unsupported command surface.
9. **DECIDE only after repeated real use:** consider a public execution surface only after stable operator evidence. Broader concurrency, cancellation, delivery, recovery, plugin, provider, or workflow frameworks remain blocked until observed need.
10. Product re-charter is decided now: post-MVP Meta-Harness is a local authority-bound agent execution-custody harness. The lightweight Markdown MVP remains the historical shipped surface, not the governing end-state.

No public `meta-harness run` until a concrete product decision. No generic `ExecutionProvider` before two real backends.
