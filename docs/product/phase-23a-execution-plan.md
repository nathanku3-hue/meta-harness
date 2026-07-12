# Phase 23A — Active Execution Plan (short)

**Status:** D069 closed under `e8e7713`. D070-A1 transport/custody is closed and audit-hardened locally. Next: D071 one meaningful single-file child-repository execution; the fixed marker is deleted, not preserved.

**Supersedes:** long historical vertical-slice plan (deleted from active tree)

## Now

| Step | Work |
| --- | --- |
| D068 | **Closed** under `be82763` (PR #23 squash; reviewed head `4b259c9`; base `f926868`) |
| D069 | **Closed** under `e8e7713` (PR #24 squash; reviewed head `245fa3d`; base `5afe075`) |
| D070-A1 | **Transport/custody closed** — AO `:read-only` schema artifact → post-AO custody → controller commit → validation → durable ref → replay; actual version and AO evidence are bound |
| D071 | **Next** — isolated ToolLauncher `7fab419f20ba`; only `scripts/utils/CheckShortcut.ps1`; sealed objective → compact JSON probe → exact PowerShell validation → live VERIFIED + replay; remove marker compatibility |
| After D071 | Immediate R1A, then observed concurrency only if required |

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
D070-A1 AO transport/custody path → CLOSED + audit-hardened
        ↓
D071 ToolLauncher single-file execution
(`scripts/utils/CheckShortcut.ps1`; sealed objective; JSON validator; no marker compatibility)
        ↓
full R1A delete marker/unused AO surfaces + rename internal/d069 lineage debt
        ↓
only observed concurrency / cancellation control
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
