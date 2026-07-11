# Phase 23A — Active Execution Plan (short)

**Status:** D068 under review in PR #23

**Supersedes:** long historical vertical-slice plan (deleted from active tree)

## Now

| Step | Work |
| --- | --- |
| PR #23 / D068 | Pure authority kernel: RunSpec, AttemptAuthorization, WorkspaceStartCheck, ImplementationAssessment |
| Ship gate | Adversarial + full tests; one D068 commit on `f926868` |

## After merge (parallel tracks)

```text
merge D068
├─ R1 core reduction (compress governance / CLI surface)
└─ AO capability/provenance probe → D069
        ↓
concrete runtime against the reduced core
        ↓
real child-repo IMPLEMENTATION_VERIFIED dogfood
        ↓
delivery actor / recovery only from observed need
```

## Explicit non-goals for D068

- Delivery assessor / MERGE_READY
- User-facing state mapper
- Generic ExecutionProvider
- Transcript reducer as a standalone product phase
- Durable single-use journal (documented as runtime responsibility)
- Fabricated backdated decision events

## Authority chain

```text
approved operator-plan artifact
→ RunSpec (immutable work)
→ readiness + worker-entry gate + trusted now/policy
→ AttemptAuthorization (attempt-scoped, prepare-workspace)
→ WorkspaceStartCheck
→ trusted facts → ImplementationAssessment
```
