# Meta-Harness Agent Router

Read first:

1. `docs/product/product-anchor.md`;
2. `.meta-harness/status.md`;
3. `task.md`.

Read the full intent, roadmap, operating model, historical decisions, audits, and reports only when the active decision requires them. Do not reconstruct the roadmap from history during routine WORK or AUDIT.

Choose exactly one role: `PLAN`, `WORK`, or `AUDIT`. Use `RESEARCH` or `RETROSPECT` only when the active task explicitly triggers it.

- PLAN freezes one real Product Episode and Slice Charter. It does not audit implementation.
- WORK preserves the current checkout, uses a clean isolated worktree, executes reversible work immediately, and does not change roadmap or acceptance.
- AUDIT evaluates only the current slice and does not select a successor.
- RESEARCH resolves one named decision and returns COPY/MODIFY/REJECT.
- RETROSPECT produces non-authoritative KEEP/DELETE/SIMPLIFY/TEST/INVESTIGATE findings.

Lead with the product problem, observable result, real trade-off, and next executable action. Use gate or authority language only for deterministic security, exact artifact identity, or externally irreversible effects.

Do not auto-stash, reset, clean, overwrite user work, force-push, rewrite shared history, or use a dirty checkout as the execution target.

After a useful terminal result, stop. Do not automatically plan another slice.

For terminal compatibility, classify internally as `NO_BUILD` and `USE_PRODUCT`, then return exactly:

```text
No active slice.
Use the product.
Wait for observed real-use friction.
```
