# Phase 23A — Active Execution Plan (short)

**Status:** D069 closed under `e8e7713`. D070-A0 decided (A0.1 NO-GO / A0.2 GO). **D070-A1 closed** on controller-materialized Codex `:read-only` artifacts. Next: child-repo dogfood.

**Supersedes:** long historical vertical-slice plan (deleted from active tree)

## Now

| Step | Work |
| --- | --- |
| D068 | **Closed** under `be82763` (PR #23 squash; reviewed head `4b259c9`; base `f926868`) |
| D069 | **Closed** under `e8e7713` (PR #24 squash; reviewed head `245fa3d`; base `5afe075`) |
| D070-A1 | **Closed** — AO `:read-only` schema artifact → post-AO custody → controller materialize/commit → exact validation → durable ref → replay |
| Next | Real child-repo dogfood (then observed concurrency only if required) |

## Functional-first roadmap

```text
D068 closed (be82763)
        ↓
D069 local controller walking slice → IMPLEMENTATION_VERIFIED (closed e8e7713)
        ↓
D070-A0.1 direct AO workspace-write → NO-GO on current Windows host
        ↓
D070-A0.2 read-only schema artifact → controller materialization → GO
        ↓
D070-A1 one verified AO-backed path in the full evidence chain → CLOSED
        ↓
real child-repo dogfood
        ↓
only observed concurrency / cancellation control
        ↓
full R1A delete unused from AO + dogfood imports/traces (rename internal/d069 lineage debt)
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
