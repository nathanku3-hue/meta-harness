# Status

Goal:
Keep Meta-Harness source-of-truth docs aligned with Phase 10C read-only external release evidence contract work without claiming unfinished publish automation, evidence harvesting, or full release enforcement.

Phase:
Phase 10C read-only external release evidence contract; Phase 11 start criteria unchanged

Current truth:
Phases 6-9 are the accepted current baseline. Phase 8 is planning-only by design and has no scout implementation or activation. Phase 9 is accepted in transition/adoption mode; complexity metadata is separately marked adopted in `.meta-harness/complexity-policy.json`, but that metadata signal is not a blanket claim that every Phase 9 exit criterion is complete. Phase 10A local read-only `meta-harness release check` exists for policy, package metadata, reproducibility, quality, ready, test eligibility, package dry-run eligibility, clean-tree status, and external-evidence status. Phase 10B wires `npm publish` to the release check with a fail-closed `prepublishOnly` package guard. Phase 10C adds a file-based, read-only contract for external GitHub/security evidence and full-release evidence, with fixture-backed tests for missing, invalid, and valid states. It is still not publish automation: evidence harvesting, GitHub API calls, registry writes, CI publish workflow, tags, version bumping, provenance publishing, and real external/publish evidence collection remain absent. Phase 11 domain governance is not active and may start only with a real Meta-Harness-adopted downstream repo, a domain owner request, and an activation decision.

Active streams:
- coding: Phase 10C read-only release evidence contract
- research: idle
- writing: idle
- review: idle

Pending human decisions:
- future Phase 10 expansion decision before publish automation or full release enforcement
- Phase 11 activation decision, only after a real adopter and domain owner request exist

Blockers:
- live full Phase 10 release readiness still lacks real external/full release evidence and publish automation decisions
- Phase 11 has explicit activation prerequisites, not a general roadmap hold

Last verified:
Roadmap status cross-checked against D017-D022, Phase 8 planning doc, Phase 10A/10B release-check work, Phase 10C evidence-contract scope, and current complexity-policy metadata.

Next action:
Review and land the scoped Phase 10C evidence contract, then require a separate decision before evidence harvesting, publish automation, or Phase 11 activation.

Stop criteria:
Fresh human and Codex worker can tell that Phase 10C adds only read-only evidence validation without mistaking it for evidence harvesting, full release automation, or Phase 11 activation.

Updated:
2026-06-09
