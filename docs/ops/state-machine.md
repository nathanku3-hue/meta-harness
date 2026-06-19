# Agent Ship-Fast State Machine

Canonical rules: [Meta Harness SOP](../sop/meta-harness-sop.md#pm-output-contract). This is an agent contract, not runtime enforcement.

Classify first: `IDEA`, `PLAN`, `AUDIT`, `IMPLEMENT`, `DIRTY_WORKTREE`, `STALE_MAIN`, `WORKER_PATCH`, `PR_REVIEW`, `MERGE`, or `INSTALL_SMOKE`.

Forward path:

```text
IDEA -> PLAN -> AUDIT -> PREFLIGHT -> IMPLEMENT -> VERIFY -> PR_REVIEW -> MERGE -> INSTALL_SMOKE
```

- `AUDIT -> PREFLIGHT` requires the applicable approval.
- `PREFLIGHT -> IMPLEMENT` requires clean git state and a fresh approved base.
- `PR_REVIEW -> MERGE` requires passing checks, review, and explicit merge authority.
- `MERGE -> INSTALL_SMOKE` uses the exact merged-main commit.
- Any failed hard gate emits `BLOCK` and one actionable next gate; no state is skipped.
- Agent ship-fast routes are only `FAST`, `REVIEW`, and `BLOCK`; a would-be `SLOW` case is compressed.
- `REVIEW` PM closure is at most 3 lines; `BLOCK` PM closure is at most 5 lines.
