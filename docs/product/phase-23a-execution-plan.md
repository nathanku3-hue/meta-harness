# Phase 23A — Active Execution Plan (short)

**Status:** D069 closed under squash merge `e8e7713`. Next: D070 AO substitution (A0 probe → A1 one path).

**Supersedes:** long historical vertical-slice plan (deleted from active tree)

## Now

| Step | Work |
| --- | --- |
| D068 | **Closed** under `be82763` (PR #23 squash; reviewed head `4b259c9`; base `f926868`) |
| D069 | **Closed** under `e8e7713` (PR #24 squash; reviewed head `245fa3d`; base `5afe075`) |
| Next | D070-A0 AO capability probe → D070-A1 one verified AO path → overlap only after A1 |

## Functional-first roadmap

```text
D068 closed (be82763)
        ↓
D069 local controller walking slice → IMPLEMENTATION_VERIFIED (closed e8e7713)
        ↓
D070-A0 AO capability probe (observed)
        ↓
D070-A1 one verified AO-backed path (same evidence chain)
        ↓
same-request / distinct-request overlap → cancel/timeout → cleanup ownership
        ↓
real child-repo dogfood
        ↓
full R1A delete unused from fixture + AO + dogfood imports/traces
        ↓
delivery/recovery only from observed need
```

## Explicit non-goals for D068 (historical)

- Delivery assessor / MERGE_READY
- User-facing state mapper
- Generic ExecutionProvider
- Transcript reducer as a standalone product phase
- Durable single-use journal (documented as runtime responsibility)
- Fabricated backdated decision events

## Authority chain

```text
RunSpec
→ RunSpecApproval
→ ExecutionReadinessFacts
→ AttemptAuthorization
→ WorkspaceAttestation
→ WorkspaceStartCheck
→ trusted ImplementationFacts
→ ImplementationAssessment (IMPLEMENTATION_VERIFIED)
```
