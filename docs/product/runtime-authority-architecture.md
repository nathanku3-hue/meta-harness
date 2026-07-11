# Runtime Authority Architecture (concise)

**Status:** D068 / 23A-PR1R — **under review in PR #23** (D068-final amendment: request-digest invariant, absolute paths, strict outer envelopes)

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

## Next (after PR #23 merges) — functional-first

1. **D069** local controller walking slice: real git readiness → authorize → worktree → realpath attestation → START_ALLOWED → atomic journal consume → fixture worker → controller commit → validation → `IMPLEMENTATION_VERIFIED`.
2. **R1A** delete unused Phase 20–22 shells / CLI from real imports and traces (not planning-first).
3. **D070** substitute AO into the same walking slice (GO / CONDITIONAL / NO-GO from observation).
4. Real child-repo dogfood.
5. Delivery/recovery only from observed failures.

No public `meta-harness run` until a concrete runtime path exists. No generic `ExecutionProvider` before two real backends.
