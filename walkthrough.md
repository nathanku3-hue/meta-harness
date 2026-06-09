# Walkthrough: Phase 11 and Phase 12 Integration

We have imported the done-done artifacts for Phase 11 (domain governance validation gate) and Phase 12 (local governed skill lifecycle) from the local ZIP files, rebased/merged them on top of `main` (which already included Phase 8), resolved the merge conflicts, ran all verification tests, and merged the PRs to main on GitHub.

In addition, we have resolved the document consistency fixes to achieve final "done-done" status.

## Changes Made

### Phase 11: Domain Governance Validation Gate
- Added `lib/domain-rule-check.js` to enforce rule-chain evidence: facts, ontology, mappings, golden cases, signed reviews, code fact_id traces, patch-plan coverage, and expiry failures.
- Integrated the gate into ready-check as `MH_DOMAIN_GOVERNANCE_001`.
- Added related unit and CLI tests.
- Rebased onto `main` and resolved merge conflicts in `.meta-harness/status.md` and `docs/product/roadmap.md`.
- Opened [PR #16](https://github.com/nathanku3-hue/meta-harness/pull/16) and merged it.

### Phase 12: Local Governed Skill Lifecycle
- Added new commands for candidate, preflight, promote, and rollback.
- Added candidate inactivity enforcement, promotion registry updates, rollback history restoration, quarantine mechanisms under `.agents/quarantine/`, and redacted event logging.
- Added comprehensive unit and integration tests.
- Updated decision log (adding D029 for Phase 12) to avoid identifier collisions with Phase 11's D028.
- Rebased onto `main` (containing Phase 8 and Phase 11) and resolved conflicts in `.meta-harness/status.md`, `docs/product/decision-log.md`, and `docs/product/roadmap.md`.
- Opened [PR #17](https://github.com/nathanku3-hue/meta-harness/pull/17) and merged it.

### Document Consistency Fixes
- Patched `.meta-harness/status.md` to replace stale D025/D027 first-slice language with D028/D029 bounded closure language.
- Patched `docs/product/roadmap.md` to align the Phase 12 summary row and update Phase 12 section references from D028 to D029.
- Added and exposed `walkthrough.md` and `task.md` in the repository root.

## Verification & Testing

All verification steps completed successfully:
1. **Unit & Integration Tests**: All 59 tests in the combined suite passed successfully.
   ```bash
   node --test tests/domain-governance.test.js tests/cli-domain-governance.test.js tests/cli-ready.test.js tests/skill-registry.test.js tests/cli-skill.test.js tests/skill-promotion-lifecycle.test.js tests/skill-distillation.test.js tests/skill-distillation-candidate.test.js tests/command-registry.test.js
   ```
2. **Quality Check**:
   ```bash
   node bin/meta-harness.js quality check --json
   ```
   Output: `ok: true`.
3. **Readiness Check**:
   ```bash
   node bin/meta-harness.js ready --target . --quick --read-only --json
   ```
   Output: `ok: true` (with local checks passing and expected external warning).
4. **Release Check**:
   ```bash
   node bin/meta-harness.js release check --publish --json
   ```
   Output: fails closed as expected (`local_ok: true`, `release_ready: false` due to Phase 10 external evidence constraints).
