# Agent Ship-Fast State Machine

Canonical rules: [Meta Harness SOP](../sop/meta-harness-sop.md#pm-output-contract). This is an agent contract, not runtime enforcement.

Classify first: `IDEA`, `PLAN`, `AUDIT`, `IMPLEMENT`, `DIRTY_WORKTREE`, `STALE_MAIN`, `WORKER_PATCH`, `PR_REVIEW`, `MERGE`, or `INSTALL_SMOKE`.

Routes are only `FAST`, `REVIEW`, and `BLOCK`; a would-be `SLOW` case is compressed.

Forward scenarios:

```text
IDEA -> PLAN -> AUDIT -> IMPLEMENT -> PR_REVIEW -> MERGE -> INSTALL_SMOKE
```
Guard scenarios:

```text
DIRTY_WORKTREE -> BLOCK
STALE_MAIN -> BLOCK
WORKER_PATCH -> REVIEW
```

- `AUDIT -> IMPLEMENT` requires approval, clean git state, and a fresh approved base.
- `IMPLEMENT -> PR_REVIEW` requires the minimal patch plus evidence.
- `PR_REVIEW -> MERGE` requires passing checks, review, and explicit merge authority.
- `MERGE -> INSTALL_SMOKE` uses the exact merged-main commit.
- `DIRTY_WORKTREE` or `STALE_MAIN` emits `BLOCK` with one actionable next gate.
- `WORKER_PATCH` emits `REVIEW` unless the owner authorizes branch or PR action.
- Any failed hard gate emits `BLOCK` and one actionable next gate; no state is skipped.
- `REVIEW` PM closure is at most 3 lines; `BLOCK` PM closure is at most 5 lines.
