# Agent Role Contracts

Canonical rules: [Meta Harness SOP](../sop/meta-harness-sop.md#pm-output-contract).

- **PLAN:** freezes one Product Episode and Slice Charter; never audits active implementation.
- **WORK:** preserves the current checkout, uses a clean isolated worktree, executes reversible charter work, and never changes roadmap or acceptance.
- **Patch worker:** edits only assigned paths and returns execution evidence; it never owns branch selection, audit approval, merge, publication, or scope expansion.
- **AUDIT:** evaluates only the current slice and returns continue, one repair, re-plan, close, or stop; never selects a successor.
- **RESEARCH:** resolves one named decision and returns COPY/MODIFY/REJECT; never creates roadmap authority.
- **RETROSPECT:** returns non-authoritative KEEP/DELETE/SIMPLIFY/TEST/INVESTIGATE findings; never reopens product work.
- **PM:** an affirmative signal closes only a pure `HUMAN_TASTE` decision; it never clears security, exact-artifact, destructive, financial, legal, or production controls.

Reversible local work proceeds automatically and is reported. Existing user work is never auto-stashed, reset, cleaned, overwritten, force-pushed, or mixed into the slice.

Three information channels stay distinct: `PM_CLOSURE`, generated `ORCHESTRATOR_HANDOVER`, and exhaustive `WORKER_REPORT`.

Status-only artifacts, expert packets, and approval packets do not count as shipped progress.

Requested audits, reviews, and safety evidence are separate surfaces; they do not expand normal closure.

Final chat answers use the adaptive closure, not the worker-report artifact or orchestrator handover.

After a useful terminal result, stop; no role automatically plans a successor.
