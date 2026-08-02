# Agent Ship-Fast State Machine

Current loop authority: [Meta Harness SOP](../sop/meta-harness-sop.md). This short file preserves the shipped `ship-fast` compatibility contract; D077 current loop rules live in the SOP.
Canonical rules: [Meta Harness SOP](../sop/meta-harness-sop.md#pm-output-contract). This is an agent contract, not runtime enforcement. The weak epistemic twin branch below is frozen product direction and remains non-runtime until its numbered phases open.

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

Epistemic product branch after a verified outcome:

```text
VERIFIED_OUTCOME
  -> EPISODE_CAPTURE
  -> KNOWLEDGE_CANDIDATE
  -> TRANSFER_BOUNDARY_GATE
  -> ACTIVE_LESSON | CHALLENGED_LESSON | RETIRED_LESSON
  -> ONE_FRONTIER_INTERVENTION | SILENCE
  -> SEPARATELY_AUTHORIZED_ACTION, if any
```

A later discovery branch is recommendation-only:

```text
SCHEDULED_SCOUT
  -> TOP5_CANDIDATES
  -> HUMAN_SELECT | IGNORE
```

It never transitions directly to canonical knowledge, mastery, active policy, or action.

- `AUDIT -> IMPLEMENT` requires approval, clean git state, and a fresh approved base.
- `IMPLEMENT -> PR_REVIEW` requires the minimal patch plus evidence.
- `PR_REVIEW -> MERGE` requires passing checks, review, and explicit merge authority.
- `MERGE -> INSTALL_SMOKE` uses the exact merged-main commit.
- `DIRTY_WORKTREE` or `STALE_MAIN` emits `BLOCK` with one actionable next gate.
- `WORKER_PATCH` emits `REVIEW` unless the owner authorizes branch or PR action.
- Any failed hard gate emits `BLOCK` and one actionable next gate; no state is skipped.
- User-visible closure follows the adaptive SOP policy; internal route labels are not chat output.
- `EPISODE_CAPTURE` may append evidence only.
- `KNOWLEDGE_CANDIDATE` remains provisional until held-out transfer, critical boundary abstention, and contradiction checks pass.
- Personal mastery changes only from evidence and remains human-correctable.
- At most one frontier intervention is selected; if no answer could change the active understanding or decision, emit silence.
- Scheduled discovery returns at most five duplicate-suppressed timeless-classic, frontier/SOTA, or justified prerequisite-bridge items and cannot auto-ingest.
