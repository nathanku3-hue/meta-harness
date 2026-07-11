# Phase 23A — Active Execution Plan (short)

**Status:** D068 under review in PR #23 (D068-final amendment)

**Supersedes:** long historical vertical-slice plan (deleted from active tree)

## Now

| Step | Work |
| --- | --- |
| PR #23 / D068-final | Bounded amendment: request-digest invariant, prior identity, absolute paths, strict envelopes, dup commands |
| Ship gate | Adversarial file + full tests; amend on `b824352`; force-with-lease |

## After merge (functional-first — not R1A + AO research first)

```text
merge D068
        ↓
D069 local controller walking slice → IMPLEMENTATION_VERIFIED
        ↓
R1A delete unused from real imports/traces
        ↓
D070 AO substitution in the same slice (observed GO/CONDITIONAL/NO-GO)
        ↓
real child-repo dogfood
        ↓
delivery/recovery only from observed need
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
