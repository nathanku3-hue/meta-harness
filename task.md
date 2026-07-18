# Active Task: S001R5F-CLOSE Direction Alignment

- [x] Preserve clean exact candidate `a0e4835` and independently verify direct hard-link and true rename-boundary replacement safety on Linux and Windows Node 25.
- [x] Verify focused truth/custody suites, `MH_TRUTH_001`, `MH_QUALITY_001`, package boundary, signer scan, readiness, and diff cleanliness.
- [x] Reproduce move-aside fallback failure removing `events.jsonl` while the prior ledger survives only under an unrecognized backup name.
- [x] Confirm native Windows Node 25 directly renames over an existing regular file.
- [x] Confirm the exact candidate lacks D082/S001R4 audit authority and still advertises R4/D081.
- [x] Add one bounded finalization commit on the clean candidate lineage; do not implement in the dirty main checkout.
- [x] Delete the move-aside backup fallback from `lib/events.js`.
- [x] Prove forced direct rename failure leaves the prior ledger byte-identical at `events.jsonl` and creates no backup residue.
- [x] Replace the weak pre-operation alias test with an actual rename-boundary swap regression on Linux and Windows.
- [x] Synchronize the minimal D082 authority chain and active R5 product surfaces into the clean candidate.
- [x] Preserve exactly-one replay/concurrency behavior, multiply linked file rejection, and all S001R4 bootstrap/static-link protections.
- [x] Preserve D078 legacy receipt v1 as read-only evidence and receipt v2 as the only new mutation format.
- [x] Pass the complete Windows Node 25 suite, Linux focused suite, `MH_TRUTH_001`, `MH_QUALITY_001`, package and signer scans, readiness, JSON validation, and `git diff --check`.
- [x] Produce one named clean finalization commit (`88e17bf`) and stop for independent exact-commit audit.
- [x] Align active product surfaces so a fresh worker audits `88e17bf` instead of re-implementing R5F.
- [x] Align declared Node support with CI evidence plan: Node 20 (floor) and Node 25 (current) on Linux and Windows.
- [x] Permit non-force push of the exact candidate branch for remote custody and hosted CI only.
- [ ] Independent exact-commit audit of the close commit plus hosted CI evidence.
- [ ] Only after acceptance: execute `G-001` → `INTEGRATE-S001` as package identity `0.3.0` → `S-006M`.

Stop rule: non-force push of this exact candidate branch is allowed for remote custody and hosted CI. External authority use, new G-001 canonical event, merge, tag, publication, package-identity reuse of `0.2.1`, and S-006M remain blocked until exact-commit independent acceptance.

---

> **Historical task record:** retained as completed phase-era evidence. D082 rejects S001R4 ledger custody but preserves its clean candidate and authorizes one atomic shared-ledger repair.

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
- [x] Resolve commit/tag identity mismatch (Option B, corrected)
    - [x] Retarget local tag v0.1.0 to the aligned-docs commit
    - [x] Align `.meta-harness/local/release-evidence.json` commit to the aligned-docs commit
    - [x] Regenerate all validation logs against the tag commit in UTF-8 format
    - [x] Document tag target in walkthrough.md
