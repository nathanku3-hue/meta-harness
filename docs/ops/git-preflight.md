# Agent Git Preflight

Canonical rules: [Meta Harness SOP](../sop/meta-harness-sop.md#pm-output-contract). Apply before any implementation mutation.

1. Confirm the applicable audit or decision gate is approved.
2. Run `git status --porcelain=v1`; any pre-existing dirt fails the fresh implementation preflight.
3. Fetch/prune the intended remote when available and identify the exact latest base commit.
4. Create a fresh, unique implementation branch from that base; do not reuse a stale branch.
5. Confirm the approved scope and ownership before editing.

On failure, render an adaptive blocked closure that names the failed check and one forward gate. Do not edit, merge, or generate implementation artifacts.

Never use reset, clean, stash, checkout, or force operations to hide or discard another person's work without explicit human authorization. If remote or review evidence is unavailable, report it as unavailable; do not infer a pass.
