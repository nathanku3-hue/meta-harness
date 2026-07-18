# Active Task: CANDIDATE-S001R4 Link-Confined Clean Candidate

- [x] Create an isolated worktree from `origin/main` at `0791efa`; do not merge upstream into the dirty checkout.
- [x] Transplant only accepted S-001 implementation, tests, authority contract, legacy-readable event/status, and current direction artifacts.
- [x] Require absent `.meta-harness` for new bootstrap.
- [x] Delete recursive partial-harness copying, backup replacement, and mutating re-init without compatibility.
- [x] Reject symlinks, Windows junctions, reparse points, and externally resolved ancestors for authority, ledger, status-parent, and lock paths.
- [x] Prove bootstrap, canonical append, and status refresh cannot write through linked paths on Linux or Windows.
- [x] Add bounded stale-lock recovery that preserves live lock ownership.
- [x] Use exact schema terms: public authority contract v1 and repository-bound receipt v2.
- [x] Preserve D078 legacy receipt v1 as read-only evidence.
- [x] Pass the literal Windows Node 25 suite, `MH_TRUTH_001`, `MH_QUALITY_001`, package and signer scans, and `git diff --check`.
- [x] Produce one named reviewable commit and stop for independent exact-commit audit.
- [ ] Only after acceptance: execute `G-001` → `INTEGRATE-S001` → `S-006M`.

Stop rule: no external authority use, new canonical event, integration, push, merge, package claim, or S-006M work before exact-commit independent acceptance.

---

> **Historical task record:** retained as completed phase-era evidence. D081 rejected S-001R3 path confinement and authorized repair directly in the clean candidate.

- [x] Prepare Git branches for Phase 11 and Phase 12
    - [x] Extract zip files and verify contents
    - [x] Save Phase 12 into a temporary branch `temp/phase12-import`
    - [x] Setup `codex/phase-11-governance-pilot` on the correct Phase 11 commit
- [x] Merge Phase 11 into main
    - [x] Rebase/merge `codex/phase-11-governance-pilot` on top of `main`
    - [x] Resolve conflicts in `.meta-harness/status.md` and `docs/product/roadmap.md`
    - [x] Run Phase 11 tests to verify success
- [x] Open PR for Phase 11
    - [x] Push `codex/phase-11-governance-pilot` to GitHub
    - [x] Open Phase 11 PR targeting `main` and merge it
- [x] Merge Phase 12 into main / Phase 11
    - [x] Rebase/merge Phase 12 on top of the Phase 11 branch
    - [x] Resolve any conflicts
    - [x] Run Phase 12 tests to verify success
- [x] Open PR for Phase 12
    - [x] Push Phase 12 branch to GitHub
    - [x] Open Phase 12 PR targeting `main` and merge it
- [x] Run final validations and cleanup
- [x] Resolve document consistency fixes (stale status/roadmap language & references)
- [x] Expose walkthrough.md and task.md in repository root
- [x] Resolve commit/tag/evidence identity mismatch (Option B, corrected)
    - [x] Retarget local tag v0.1.0 to the aligned-docs commit
    - [x] Align `.meta-harness/local/release-evidence.json` commit to the aligned-docs commit
    - [x] Regenerate all validation logs against the tag commit in UTF-8 format
    - [x] Document tag target in walkthrough.md
