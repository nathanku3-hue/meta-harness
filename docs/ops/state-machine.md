# Agent Ship-Fast State Machine

Canonical rules: [Meta Harness SOP](../sop/meta-harness-sop.md#pm-output-contract). This is an agent contract, not runtime enforcement.

Classify first: `IDEA`, `PLAN`, `TARGET_LOCK`, `AUDIT`, `IMPLEMENT`, `DIRTY_WORKTREE`, `STALE_MAIN`, `WORKER_PATCH`, `PR_REVIEW`, `MERGE`, `PACKAGE`, `PUBLISH`, or `INSTALL_SMOKE`.
Routes are only `FAST`, `REVIEW`, and `BLOCK`; a would-be `SLOW` case is compressed.

Forward: `IDEA -> PLAN -> TARGET_LOCK -> AUDIT -> IMPLEMENT -> PR_REVIEW -> MERGE -> PACKAGE -> INSTALL_SMOKE`.
Guards: `DIRTY_WORKTREE -> BLOCK`; `STALE_MAIN -> BLOCK`; `WORKER_PATCH -> REVIEW`.

- `PLAN -> TARGET_LOCK` requires an intent-traced user, job, irreplaceable specialist judgment, observable result, and three alternatives.
- `TARGET_LOCK -> AUDIT` requires the smallest representative coding-plus-knowledge slice, not a trivial coding-only target.
- D086 opens `TARGET_LOCK` as the current R2 action. The transition still requires the four-line human target decision; no repository selection or R3 implementation may precede it.
- `AUDIT -> IMPLEMENT` requires approval, clean git state, and a fresh approved base.
- If authorized R3 execution exposes a concrete harness blocker, remain in `IMPLEMENT`: name the failed evidence, apply only the smallest proven repair, prove it against that blocker, and resume the same slice before `PR_REVIEW`.
- `IMPLEMENT -> PR_REVIEW` requires the minimal patch, evidence, and durable claim ceiling.
- `PR_REVIEW -> MERGE` requires passing checks, review, and explicit merge authority.
- `MERGE -> PACKAGE -> INSTALL_SMOKE` uses the exact merged commit, creates a reproducible artifact, verifies it, and preserves its claim boundary.
- `PACKAGE -> PUBLISH` is never implicit; publication requires a named `G-AUTHORITY` or `G-RISK` gate.
- Dirty or stale state emits `BLOCK`; worker patches emit `REVIEW`. Any failed hard gate emits `BLOCK` with one actionable next gate; no state is skipped.
- S-006M may close at `MERGED + PACKAGED` while domain correctness remains explicitly unproven; R6 owns that falsifiable test.
- User-visible closure follows the adaptive SOP policy; internal route labels are not chat output.
