# Effective Guidance Rollout Audit

Date: 2026-06-21
Decision: COMPLETE

The earlier rollout synchronized passive templates but did not validate active repository instructions. Quant's `AGENTS.md` still required the full worker artifact in final chat, so the original behavioral success claim was false.

Source commit `3378f3916360d9f2a50d7aaa926fe065ea7367f0` closes that gap:

- `contract scan` checks active guidance files and rejects artifact-first final-chat requirements.
- Quant's active guidance now limits normal chat closure to `Status`, `Why`, `Next`, and `Decision needed`.
- Scope-selector output is explicitly an internal planning artifact.
- The changed skill was reinstalled across all 10 local repository-root installs.
- All 10 installs pass sync and effective-guidance scans with no changes outside the approved rollout surface.

Fresh Quant agent contexts are required for behavioral verification because an existing conversation may retain instructions loaded before the file changed.
