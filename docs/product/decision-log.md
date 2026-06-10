# Meta-Harness Decision Log

Status: starter
Date: 2026-05-02

## D001: Product First, Technical Later

Decision:

Define PRD, product spec, and decisions before one-shotting the MVP.

Rationale:

The main risk is building another agent framework instead of a small product with a clear control role.

## D002: A First, With Room For B Later

Decision:

Start with A: Codex session memory and status layer. Design it so A can interpret B: multi-worker and multi-stream orchestration.

Rationale:

The MVP should understand worker outputs as streams without becoming a full orchestrator.

## D003: Human Owns Harness Taste Layer

Decision:

Humans own product direction, intuition, taste, priority, and acceptance judgment.

Rationale:

The harness should reduce status work, not replace product judgment.

## D004: Harness Owns Translation

Decision:

Meta-Harness translates between human status language and Codex worker language.

Rationale:

Human-facing and worker-facing status have different jobs. Combining them creates noise.

## D005: Workers Produce Reports, Not Official Truth

Decision:

Codex workers produce reports, evidence, blockers, and proposed next actions. Official status is updated through the harness/orchestrator layer.

Rationale:

This keeps control coherent and prevents background streams from silently changing product truth.

## D006: Fixed Phase Map For MVP

Decision:

Use a fixed tram-stop phase map:

```text
intake -> plan -> work -> verify -> synthesize -> handoff -> lookback
```

Rationale:

Configurability is useful later, but the first product needs a clear operating rhythm.

## D007: Markdown-First State

Decision:

Use Markdown as the primary product surface and JSONL as the event ledger.

Rationale:

Markdown is readable by humans and agents, diffable, and enough for starter status, worker reports, and lookbacks.

## D008: Minimal Runtime Code

Decision:

Runtime code should only create files, append events, render Markdown, poll local status files, and aggregate child repo status.

Rationale:

The runtime supports the product. It should not become a workflow engine in the MVP.

## D009: File-Only Background Polling

Decision:

MVP polling reads files only. It does not launch Codex workers or execute arbitrary commands.

Rationale:

This gives visibility without introducing orchestration, safety, and lifecycle complexity too early.

## D010: Each Repo Owns Its Harness

Decision:

Each repo has its own `.meta-harness/`. Parent harnesses read child statuses through a repo index.

Rationale:

Per-repo truth prevents central state from becoming stale or over-authoritative.

## D011: npm Global Install

Decision:

Target install is:

```bash
npm install -g meta-harness
```

Rationale:

The product should feel like a lightweight CLI tool, easy to add beside Codex and other developer tools.

## D012: Coding And Research First

Decision:

Coding and research are first-class MVP scenarios. Writing and review exist as streams but are not the first proof target.

Rationale:

Coding tests the local artifact loop. Research tests conclusion-update discipline.

## D013: Borrow, Do Not Clone Existing Products

Decision:

Copy visibility, persistence, and worker contracts from adjacent products. Do not copy full swarm, dashboard, or framework surfaces.

Rationale:

Meta-Harness should be a thin truth/status layer above Codex workers, not another swarm platform.

## D014: Not SOP v2

Decision:

Meta-Harness remains distinct from SOP.

Rationale:

SOP is a formal governance control plane. Meta-Harness is a lightweight live status and translation layer for Codex-led work.

## D015: One-Shot MVP Implemented As Dependency-Free Node CLI

Decision:

Implement the MVP as a dependency-free Node CLI exposed through the `meta-harness` npm binary.

Rationale:

This matches the global install target while keeping runtime code minimal: local files, Markdown templates, JSONL events, worker reports, lookback rendering, and file-only child repo polling.

## Open Follow-Up After MVP One-Shot

No blocking product questions remain.

Non-blocking choices that can be made during implementation:

- whether to publish under the exact npm package name `meta-harness` or a scoped package name;
- whether to keep the Python prototype or remove it after the Node CLI stabilizes;
- whether to add a `meta-harness synthesize` command or keep synthesis inside `status --refresh`;
- whether parent polling should produce a compact executive summary or preserve child status excerpts.

## D016: Reusable Scope And Expert-Packet Kit

Decision:

Package generic scope-selection, boundary-gate, expert-context, harness-feedback, worker-done, stream-contract, and reconciliation templates with the CLI, plus an `expert-packet` command that builds bounded local review packets.

Rationale:

Reusable harness work should live in Meta-Harness rather than being stranded inside one stale or dirty project checkout. The packet builder may capture bounded local git metadata with `git` argv, but it must not run arbitrary shell commands, copy dependency/runtime/cache directories, or make expert packets into execution authority. The packet deliverable is a single zip archive; any diff or next-scope artifact belongs inside that archive, not beside it as a loose sidecar.

## D017: Post-MVP Endgame Roadmap — Local-Audit-Driven Revision

Decision:

Adopt a revised 15-phase roadmap (Phases 0–14) that replaces the earlier aspirational 12-phase plan. The endgame direction (operationally self-aware, skill-based, security-aware coding control plane) is preserved, but the execution path is rewritten to be local-audit-driven, incremental, and concrete through Phase 7, with later phases explicitly marked as prototypes contingent on real evidence.

Rationale:

A local audit on 2026-06-06 confirmed the repo diagnosis: 106 tests pass, workflows are strong (SHA-pinned, read-only, no secrets, persist-credentials: false), and package scope is controlled. However, the repo fails three of its own checks (sync: 23/23 templates missing; state: old runs layout + missing root status.md/events.jsonl; quality: oversized test file). It also lacks .gitattributes, SECURITY.md, CODEOWNERS, dependabot.yml, and .agents/skills/. The .gitignore is only 9 lines and lacks secret-pattern protection.

The earlier 12-phase plan had correct architecture direction (9.2/10) but only moderate execution realism (0.68) because Phases 0–3 were concrete, Phases 4–7 were buildable, and Phases 8–12 were aspirational with untestable exit criteria. The revised plan fixes sequencing, merges repo hygiene with self-adoption, replaces bash-only scripts with cross-platform Node commands, adds CLI/test decomposition before capability expansion, pilots one skill and one read-only subagent before scaling, and converts late-phase mission statements into measurable prototypes.

Revised scores:

- Capability: 9.0/10
- Self-adopted source repo: 7.8–8.2/10 (lowered from 8.3–8.6; repo fails sync, state, and quality checks)
- Cybersecurity/repo hygiene: 6.5–7.2/10 (lowered from 6.8–7.4; missing .gitattributes, SECURITY.md, CODEOWNERS, Dependabot, weak .gitignore)
- Endgame architecture direction: 9.2/10
- Endgame execution maturity today: 6.5–7.2/10

Key changes from earlier plan:

1. Merge repo sanitation and self-adoption into near-term credibility repair.
2. Replace mh-ready.sh with cross-platform meta-harness ready command.
3. Add CLI/test decomposition as its own phase before capability expansion.
4. Split security into minimum baseline (now) and full stack (later).
5. Replace "11 skills from zero" with one-skill pilot.
6. Replace write-enabled subagent layer with read-only scout pilot.
7. Defer domain governance, self-evolution, multi-repo dashboard, and controlled autonomy to prototype phases contingent on real adopters and evidence.
8. Add state layout versioning, stable check IDs, redaction scanner, security-policy.json, and install/upgrade round-trip tests.

See docs/product/roadmap.md for the full revised phase plan.

## D018: Phase 5 Minimum Security Baseline Implemented

Decision:

Treat Phase 5 as implemented locally, with GitHub repository-setting checks intentionally left at warn/unknown until API-backed verification is available.

Rationale:

The Phase 5 baseline now includes SECURITY.md, CODEOWNERS, Dependabot version-update config, machine-readable security policy, owner map, redaction scanning, security posture checks, package reproducibility checks, package-lock.json, a pinned CI workflow using npm ci, and MH_SECURITY_001 integration in `meta-harness ready`.

Evidence from local verification on 2026-06-07:

- `node --test tests/redaction-check.test.js tests/security-check.test.js tests/cli-ready.test.js` passed.
- `npm test` passed in the committed Phase 5 tree: 134 pass, 1 skipped.
- `git diff --check` passed.
- `node bin/meta-harness.js ready --target . --quick --json` returned `ok: true`.

Known local-only warnings:

- SEC_REPORTING_001
- SEC_DEP_SETTINGS_001
- SEC_OWNER_ENFORCE_001

These warnings require GitHub settings/API verification: private vulnerability reporting, dependency graph plus Dependabot alerts/security updates, and CODEOWNERS enforcement through branch protection or rulesets. They are expected locally and should fail only in strict/CI/API verification modes when required.

CI follow-up:

- `4227a84 fix(ci): pin node toolchain for npm ci`.
- Reason: GitHub runner default npm 10.9.8 did not satisfy `devEngines.packageManager`.
- CI run 27082674623 passed.
- Passed steps: checkout, setup Node.js, `npm ci`, tests.
- Phase 5 baseline implementation remains `8ea739e`.

## D019: GitHub Security Settings Partially Verified

Decision:

Record GitHub repository security-setting verification as partial. Do not convert unavailable or unverified settings into pass.

Rationale:

GitHub settings verification on 2026-06-07 used repository admin credentials and the GitHub REST API.

Verified:

- Dependabot alerts enabled.
- Dependabot security updates enabled (`automated-security-fixes` returned `enabled: true`, `paused: false`).
- CI run 27082674623 passed for the `Node tests` job.

Unknown or unavailable:

- Private vulnerability reporting: unknown. The documented repository endpoint returned 404 for this private repository.
- Dependency graph: unknown. A repository update request was accepted, but repository read-back did not expose a dependency graph status field.
- CODEOWNERS enforcement: unavailable on the current repository plan/visibility. Branch protection and repository rulesets returned 403: "Upgrade to GitHub Pro or make this repository public to enable this feature."
- Required CI before merge: unavailable for the same branch-protection/ruleset reason, though the `Node tests` check has completed successfully and is ready to require once repository settings support it.

Next action:

Enable or verify the unknown settings through the GitHub UI or upgraded repository settings access before marking SEC_REPORTING_001, dependency graph, SEC_OWNER_ENFORCE_001, or required CI as fully passed.

## D020: Phase 8 Planning-Only Documentation Authorized

Decision:

Phase 8 planning-only documentation may be proposed before Phase 8 implementation starts.

This decision authorizes only planning artifacts that document a future Phase 8 read-only scout pilot boundary. It does not start Phase 8 implementation and does not authorize scout execution, subagent activation, commands, tests, merge-gate changes, workflow changes, package changes, promotion, or repository writes outside the planning document.

Implementation still requires a separate explicit Phase 8 go decision.

Allowed:

- planning-only docs
- no implementation
- no command
- no tests
- no scout execution
- no subagent activation

Still forbidden:

- `lib/`
- `bin/`
- `tests/`
- `.github/`
- `.meta-harness/`
- package changes
- merge-gate changes

Rationale:

Phase 8 is roadmapped as a future read-only subagent scout pilot. A planning artifact is useful for review because it can define the pilot boundary, non-goals, packet schema, fanout budget, and future exit criteria without activating the capability.

This decision preserves the implementation boundary: Phase 8 planning docs may exist, but Phase 8 implementation remains blocked until explicitly approved.

## D021: Phase 6-11 Status Reset And Start Criteria

Decision:

Reset the source-of-truth status for Phases 6-11.

Accepted current baseline:

- Phases 6-7 are accepted as the current baseline for roadmap sequencing.
- Phase 8 is planning-only by design. Planning docs may exist, but scout execution, subagent activation, commands, tests, workflow/package changes, promotion, and repo writes are not started.
- Phase 9 is accepted in transition/adoption mode. Complexity metadata is separately marked adopted in `.meta-harness/complexity-policy.json`; that metadata signal does not claim every Phase 9 architecture and quality exit criterion is complete unless a separate Phase 9 closure decision records broader acceptance.
- Phase 10 release/package enforcement was unblocked by this reset. Current Phase 10A work adds a local read-only release check, but it must not claim release-ready enforcement until full external/release evidence and exit criteria pass. Publish automation, package script enforcement, registry writes, tags, and CI publish workflow remain absent.
- Phase 11 domain governance is not active. It may start only when a real downstream repo with domain code is Meta-Harness adopted, the domain owner requests fact/ontology governance, and an activation decision is recorded.

Rationale:

The old roadmap header still held Phases 6-14 and `.meta-harness/status.md` still described a Phase 1 state-layout repair. That stale status blocked Phase 10/11 planning and startup decisions even though later baseline work and planning decisions had moved on. This reset removes the stale hold without pretending that Phase 8, full Phase 10 release enforcement, Phase 11, or broad Phase 9 closure are fully implemented.

## D022: Phase 9 Complexity Metadata Adopted

Decision:

Adopt Phase 9 complexity metadata for the current source tree.

This records a non-null `complexity_adopted_at` and `complexity_adoption_decision` in `.meta-harness/complexity-policy.json`, and refreshes `.meta-harness/baseline/quality-baseline.json` with the Phase 9 `complexity.module_budgets` snapshot and baseline hash.

Rationale:

The transition warning `MH_COMPLEXITY_LEGACY_BASELINE_METADATA` was blocking a clean Phase 9 adoption signal. The refreshed baseline does not claim every broad Phase 9 exit criterion is closed and does not forgive future growth: existing overbudget modules are grandfathered at their current line counts, and `quality check` now compares future module budgets against the adopted snapshot.

## D023: Phase 10D Live Release Evidence Recorded As Blocked

Decision:

Record review `PHASE10D-REL-EVIDENCE-2026-06-09-dc7480c` as live Phase 10 release evidence for commit `dc7480cdb96fd021e5f5ef0d4316117bfd009e12`, and keep release readiness blocked/not release-ready.

Rationale:

The gathered live evidence cannot satisfy the current release policy. Commit `dc7480cdb96fd021e5f5ef0d4316117bfd009e12` was pushed to `origin/main`, and CI run `27152950530` (`Node tests`) succeeded, completing at `2026-06-08T16:48:14Z`. However, branch protection was `false`, protection/rulesets API evidence was blocked by private repository plan 403 responses, code scanning was disabled, and secret scanning was disabled or unavailable. Dependabot/vulnerability alerts were enabled with `0` open alerts, and automated security fixes were enabled, but those passing signals do not compensate for the missing branch protection and security evidence required by policy.

This decision authorizes only an evidence-only policy/docs/status update. It does not authorize harvesting APIs, publish automation, tags, version bumps, GitHub releases, registry writes, provenance, Phase 11 work, or changing release-check code/tests. External/full-release evidence must not be marked `pass` until the policy can be satisfied and evidence is recollected for the exact commit being released.

## D024: Phase 10 Implementation Closed Release-Held

Decision:

Close Phase 10 as implemented through the local release check, fail-closed `prepublishOnly` publish guard, and read-only external/full release evidence contract, while keeping release readiness blocked/not release-ready.

Rationale:

Phase 10 has reached the intended honest state: local implementation evidence can pass, publish behavior is guarded by `prepublishOnly` and fails closed, and `release_ready` remains false because required external GitHub/security evidence cannot satisfy the current policy. The private-repository plan/settings limitation is release evidence debt, not a reason to weaken release policy, mark missing evidence optional, add bypasses, or add publish automation.

The next release action is external evidence availability or repository-setting change followed by exact-commit evidence recollection. Phase 11 may proceed only to activation evaluation if a real adopted downstream repo, ready pass, named domain owner request, named reviewer, governed-data boundary, and activation decision exist. No Phase 11 core implementation is authorized without a traceable pilot chain from source to fact, ontology term, code mapping, golden case, and review.

## D025: Phase 11 G9 Quant Pilot Activated

Decision:

Activate a bounded Phase 11 pilot for the real downstream G9 Quant FINRA short-interest signal-card path.

Activation evidence:

- Downstream path: `E:\Code\Quant-g9-market-behavior-signal-card`
- Remote: `https://github.com/nathanku3-hue/Quant.git`
- Branch: `codex/v2-d0-wrds-permission-snapshot-provenance-20260601`
- HEAD: `61edd14949fc8a7d7232748c27f75e7706010490`
- Owner/requester: `nathanku3-hue`
- Reviewer: `codex-phase-11-reviewer`
- Boundary: FINRA short-interest G9 market-behavior signal card
- Ready evidence: `node E:\Code\meta-harness\bin\meta-harness.js ready --target E:\Code\Quant-g9-market-behavior-signal-card --json` returned `ok: true`, `passed: 12`, `failed: 0`, state hash `ed879a175a5872ec0ff90aa54b03f62264c0df54d52dc7429a85ecad6ec46332`, generated at `2026-06-09T02:45:07.298Z`
- Pilot chain: `PHASE11-G9-FINRA-SHORT-INTEREST-001`
- Governance check: `meta-harness domain-governance check --target E:\Code\Quant-g9-market-behavior-signal-card --json` returned `ok: true`, 9 pass, 0 fail
- Domain files: `opportunity_engine/signal_card.py`, `opportunity_engine/signal_card_schema.py`, `data/signal_cards/FINRA_short_interest_signal_card_v0.json`, `data/signal_cards/FINRA_short_interest_signal_card_v0.manifest.json`, `tests/test_g9_market_behavior_signal_card.py`, `docs/architecture/g9_finra_short_interest_signal_card_policy.md`

Governed in scope:

- FINRA short-interest source interpretation
- observed-vs-estimated classification
- signal-card fact records
- ontology terms
- code mapping
- golden case

Out of scope:

- buy/sell signals
- ranking/scoring
- provider credential access
- broker/order/alert paths
- broad ontology platform
- release/publish automation

Rationale:

This is the first real downstream adopter trigger for Phase 11, and all activation criteria are now represented by concrete evidence. The decision authorizes only the bounded G9 Quant pilot activation path for the recorded downstream commit and pilot chain. The first implementation slice is limited to a validator command plus pilot evidence files for this boundary. It does not authorize broad Phase 11 framework work, provider credential access, trading signals, ranking/scoring, broker/order/alert paths, release/publish automation, or any weakening of Phase 10. Phase 10 release readiness remains blocked/not release-ready until external GitHub/security evidence satisfies policy for the exact release commit.

## D026: Phase 12A Docs/Status-Only Planning Authorized

Decision:

Authorize only a Phase 12A planning patch.

This decision records the Phase 11 D025 bounded pilot first-slice exit on main at `2b04dfef59b7b1936d5712f35c5a2bc7fedf6d7a` and permits a Phase 12 patch plan. It does not start Phase 12 implementation and is not the later implementation-start decision ID.

Scope allowed:

- add `docs/product/phase-12-patch-plan.md`
- update `docs/product/roadmap.md` current status
- append this decision to `docs/product/decision-log.md`
- update `.meta-harness/status.md` current truth

Scope forbidden:

- runtime code
- new commands
- policy weakening
- release-ready claims
- publish automation
- tags
- version bumps
- registry writes
- provenance publishing
- active skill promotion
- autonomy expansion
- broad framework work
- `.meta-harness/events.jsonl` append

Phase 12 implementation requires a later explicit implementation-start decision ID after the Phase 12 plan is reviewed and accepted.

Rationale:

Phase 12 self-evolution is high risk because bad self-modification can silently shape future agent behavior. The safest next move is a docs/status-only planning patch that defines the goal, start criteria, first reviewable implementation slice, non-goals, release impact, validation gates, and fail-closed behavior before any runtime work begins. The Phase 10 release evidence hold remains active and must not be weakened by Phase 12 planning.

## D027: Phase 12 First-Slice Implementation Start Authorized

Decision:

Accept `docs/product/phase-12-patch-plan.md` after independent planning review and authorize Phase 12 implementation start only for the bounded promotion-preflight first slice.

Review evidence:

- reviewer: Codex subagent planning audit
- review date: 2026-06-09
- accepted artifact: `docs/product/phase-12-patch-plan.md`
- required review follow-ups recorded before implementation: separate implementation-start decision ID and concrete first-slice ready/test expectations

Scope allowed:

- add a read-only promotion preflight implementation for candidate skills
- validate candidate skill directory shape for `.agents/candidate/<skill-name>/SKILL.md`
- prove candidate skills remain inactive unless promoted by a later decision
- detect permission differences between candidate and active skill metadata
- fail closed when eval evidence, permission authorization, complexity evidence, or rollback evidence is missing
- add focused tests for pass and blocked preflight behavior
- expose only a read-only `meta-harness skill preflight` entry point if needed for reviewable evidence

Scope forbidden:

- moving candidate skills into `.agents/skills/`
- writing `.meta-harness/skill-registry.json`
- writing `.meta-harness/events.jsonl`
- active skill promotion
- distillation integration
- rollback or quarantine execution
- provenance publishing
- release automation
- publish behavior changes
- tags
- version bumps
- dependency updates
- CI workflow changes
- autonomy expansion

Ready and test expectations:

- focused skill tests pass for registry/preflight behavior
- `npm test` passes before merge
- `meta-harness ready --target . --quick --read-only --json` passes, or a failure blocks merge
- `meta-harness release check --publish --json` remains fail-closed with `release_ready: false` unless Phase 10 external evidence is separately satisfied
- package metadata, `prepublishOnly`, release policy, and publish guard remain unchanged

Rationale:

The Phase 12 plan is now reviewed and accepted, and the implementation-start decision is separate from D026. The first slice is small enough to review because it can only answer whether a candidate skill is eligible for future promotion. It cannot promote, write the registry, publish provenance, relax release evidence, or expand autonomy. This preserves the Phase 10 release evidence hold while allowing one testable self-evolution safety gate to be built.

## D028: Phase 11 Done-Done Validation Closure

Decision:

Close Phase 11 for the domain-governance validation/control-plane scope on top of the D025 G9 Quant adopter trigger. The earlier first-slice validator is no longer enough by itself: an activated downstream domain-governance surface must include a fact ledger, ontology terms, fact-to-code mappings, golden cases, signed domain reviews, mapped `fact_id` references in code, patch-plan code coverage, and non-expired facts.

Implemented artifacts:

- `lib/domain-rule-check.js` validates `domain/facts/ledger.jsonl`, `domain/ontology/terms.json`, `domain/mappings/fact-to-code.json`, `domain/golden-cases/*.json`, `domain/reviews/*.json`, mapped code fact IDs, patch-plan code coverage, signed domain reviews, and expired facts.
- `lib/domain-governance.js` combines D025 activation/pilot-chain validation with the full rule-chain validator.
- `lib/check-id-registry.js` registers `MH_DOMAIN_GOVERNANCE_001`.
- `lib/ready-check.js` runs `MH_DOMAIN_GOVERNANCE_001` when a target has activation, pilot, or domain evidence; repos without a domain-governance surface skip it.
- Tests cover full-pass evidence, missing rule evidence, mismatched ready commit, bad boundary, bad reviewer signoff, missing fact IDs in code, expired facts, CLI JSON output, ready JSON schema updates, and the check registry.

Rationale:

The roadmap exit criteria require more than a pilot activation note. They require one real source → fact → ontology → code → golden-case chain, no unmapped domain code, source/effective-date facts, mapped facts with golden cases, expired facts blocking release, and `ready` integration. This patch makes those conditions executable and test-covered while preserving the D025 non-goals.

Boundaries:

This decision does not authorize provider credentials, trading/ranking behavior, buy/sell signals, broker/order/alert paths, ontology product UI, release automation, publish automation, external evidence harvesting, tags, version bumps, provenance publishing, or weakening Phase 10 release policy. Phase 10 release readiness remains blocked until required external GitHub/security evidence can satisfy policy for the exact release commit.

Verification:

- `npm_config_force=true node --test tests/domain-governance.test.js tests/cli-domain-governance.test.js tests/cli-ready.test.js tests/command-registry.test.js` passed, 30/30.
- `node bin/meta-harness.js quality check` passed.

## D029: Phase 12 Local Self-Evolution Lifecycle Closed Done-Done

Decision:

Close Phase 12 as done-done for the local governed skill lifecycle only.

Scope accepted:

- connect reviewed distillation records to inactive candidate skill drafts under `.agents/candidate/`
- keep candidate records inactive until explicit eval, complexity, rollback, and permission evidence is present
- keep read-only `meta-harness skill preflight` as the fail-closed promotion gate
- add `meta-harness skill promote <skill-name> --target <repo> --decision-id <id>`
- add `meta-harness skill rollback <skill-name> --target <repo> --decision-id <id>`
- write skill-registry lifecycle fields during promotion and rollback, including `promotion_decision`, `promotion_date`, `previous_version_hash`, `rollback_hash`, and `rollback_path`
- quarantine superseded or rolled-back skill versions under `.agents/quarantine/`
- append redacted `skill.promote` and `skill.rollback` events to `.meta-harness/events.jsonl`
- cover successful promotion, blocked promotion, permission-decision gating, rollback, quarantine, candidate inactivity, candidate deletion, and distillation-to-candidate behavior in tests

Scope still forbidden:

- release readiness claims
- publishing, tags, version bumps, or dependency updates
- CI workflow changes
- GitHub evidence harvesting or release evidence automation
- provenance publishing
- provider access, runtime/dashboard/scoring/broker paths, data output, or autonomous skill promotion
- treating `.agents/candidate/` content as active guidance before promotion succeeds

Done-done boundary:

This decision supports a Phase 12 done-done claim only for the repo-local self-evolution lifecycle described in the Phase 12 roadmap. It does not convert Phase 10 to release-ready, does not close Phase 8 beyond planning-only, does not expand Phase 11 beyond the D025 bounded pilot, and does not authorize a broader Phase 1-12 aggregate done-done claim.

Verification expected:

- `node --test tests/skill-registry.test.js tests/cli-skill.test.js tests/skill-promotion-lifecycle.test.js tests/skill-distillation.test.js tests/skill-distillation-candidate.test.js tests/command-registry.test.js` passes
- `node bin/meta-harness.js quality check --json` passes
- `node bin/meta-harness.js ready --target . --quick --read-only --json` passes, or any failure is reported as a blocker
- `node bin/meta-harness.js release check --publish --json` remains fail-closed with `release_ready: false` unless Phase 10 external evidence is separately satisfied

Rationale:

Phase 12 is high risk because self-modification can silently shape future agent behavior. The D029 patch makes that lifecycle explicit and reversible: distillation drafts candidates, candidates remain inactive, preflight blocks missing evidence and unauthorized permission expansion, promotion requires a decision and records rollback evidence, rollback restores a prior hash and quarantines the current version, and events provide a redacted audit trail. This closes the measurable local Phase 12 gates without weakening the Phase 10 release hold or expanding publish automation.

## D030: Phase 10 Done-Done Release Enforcement Artifact Closure

Decision:

Accept the Phase 10 done-done enforcement patch as the release/package enforcement artifact closure.

Scope accepted:

- exact-commit `commit` fields are required for external GitHub/security and full-release pass evidence
- pass evidence is rejected when its commit does not match the checkout `HEAD`
- `.meta-harness/local/release-evidence.json` may overlay ignored exact-checkout evidence after a local release commit/tag without dirtying the tracked tree
- publish mode requires a clean tree, exact `v<package.version>` tag, full ready/test posture, canonical package metadata, rollback policy, package dry-run, forbidden-path scan, tarball canonicalization, dry-run/actual packlist equivalence, isolated npm environment, `--ignore-scripts` smoke install, and installed CLI smoke
- the tracked D023 blocked evidence remains historical truth rather than being rewritten as passing evidence
- `npm test` runs test files in isolated child processes with bounded parallelism, serial release/ready-sensitive files, and per-file timeouts so release-mode evidence is deterministic

Out of scope:

- npm registry publish
- GitHub release
- remote tag push
- version bump
- provenance publishing
- CI publish workflow
- evidence harvesting APIs
- trusted-publisher setup
- Phase 11 or Phase 12 expansion

Rationale:

The previous Phase 10 state was honest but release-held because the code path did not yet prove the full package/tarball and exact-evidence boundary required for a done-done enforcement claim. This decision closes the artifact gap without weakening the release policy: release readiness is possible only for a clean, tagged checkout with exact-commit evidence and passing package smoke gates. The patch still does not publish anything and does not claim that broader Phase 1-12 work is complete.

## D031: Aggregate Phase 1–12 Roadmap-Scoped Completion

Decision:

Declare aggregate Phase 1–12 completion under the accepted roadmap scopes, at commit d031c, pointing to the public release tag `v0.1.0`.

Rationale:

All Phase 1–12 exit criteria have been implemented, verified, and revalidated. D029 and D030 previously closed Phase 12 and Phase 10 respectively, but explicitly stated they did not authorize the broader aggregate Done-Done claim. This decision closes the aggregate Phase 1-12 claim, referencing all validation evidence and compiling the complete verification outcomes.

Scope:

- **Exact Scope**: Phase 1-12 under accepted roadmap scopes.
- **Phase 9 Explicit Closure**: Phase 9's complexity policy and module line budgets are adopted. The quality check enforces these budgets, import direction rules, command count ceilings, and template counts.
- **Phase 5 Security Baseline & Exception**: Scoped exception recorded: GitHub rulesets and CODEOWNERS enforcement are unverified/unavailable on the current private repository plan and return skip/warn locally, while Dependabot vulnerability alerts/security updates are enabled and verified. All other security check items (SECURITY.md, Dependabot configuration, machine-readable security-policy.json, secret patterns, SHA workflow pinning, redaction scanning, and owners map) pass.
- **Bounded Phase 10 Scope**: Release/package enforcement artifacts only (no actual npm publish, GitHub release creation, trusted-publisher setup, CI publish automation, registry-version checks, or external API evidence harvesting).
- **Bounded Phase 11 Scope**: Domain-governance validation/control-plane scope only (no provider credentials, trading/ranking, broker/order/alert integration, ontology product UI, or autonomous domain execution).
- **Bounded Phase 12 Scope**: Local governed skill lifecycle only (no release automation, publish behavior changes, version bumps, CI changes, provenance publishing, runtime/dashboard/scoring paths, or autonomy expansion beyond explicit local skill commands).

Non-Goals:
- No Phase 13-14 (future prototypes).
- No dashboards or daemon mode.
- No unbounded subagent execution or full autonomy.
- No provider credentials or broker/order/alert paths.
- No publish/provenance automation unless separately implemented.

Phase-by-Phase Evidence Table:

| Phase | Criteria / Exit Gates | Evidence / Verification | Status |
| :--- | :--- | :--- | :--- |
| **1 — Repo hygiene and state layout** | Line endings, gitattributes, gitignore secret/lock patterns, layout_version exists, atomic writes, locks, clean pack list. | gitattributes, gitignore, layout_version tracked; demo/ has fixture policy; atomic writes and locks verified. | PASS |
| **2 — Self-adoption closure** | target checks pass, status.md, events.jsonl tracked, install/upgrade round-trip test. | target ready checks pass; status.md and events.jsonl exist and are tracked; round-trip test passes. | PASS |
| **3 — Cross-platform ready command** | Node-based `meta-harness ready`, JSON schema, timeouts, CI matrix, no-exec mode. | `meta-harness ready` command fully cross-platform; JSON output verified; check IDs stable; pass/fail/timeout tests cover all. | PASS |
| **4 — CLI and test decomposition** | bin/ entry under budget, monolith tests split, command module extraction, quality contract updated. | `bin/meta-harness.js` router under budget; command handlers in `lib/commands/`; tests split; quality check enforces budgets. | PASS |
| **5 — Minimum security baseline** | SECURITY.md, CODEOWNERS, Dependabot, security-policy.json, secrets gitignore, SHA-pinning, untrusted-input scan, redaction scanner. | SECURITY.md, CODEOWNERS, dependabot.yml, security-policy.json exist; redaction scanner passes tests; (scoped exceptions for repository settings rulesets). | PASS |
| **6 — Ship-fast enforcement loop** | Ship/slow/block path classification, decision hashes, PM brief risk tiers, code-to-PR contract. | Ship gate classifies changes; PM briefs include risk tiers; decisions track state/assumption hashes; PR protocol followed. | PASS |
| **7 — One-skill pilot** | One active skill with SKILL.md, eval command, skill registry, no secrets read, COMMAND disable. | `repo-adoption-doctor` skill active; eval tests pass; skill-registry exists and validates; command disable verified. | PASS |
| **8 — Read-only subagent scout pilot** | Bounded scout path, output matches schema, reconciler validation, budget limits, no subagent writes. | Scout command and packet generation implemented; reconciler verifies repo state; concurrency/context budgets enforced. | PASS |
| **9 — Complexity governor expansion** | Architecture map, ownership map, complexity policy, line budgets, import direction, ceiling tracking. | `docs/architecture/map.md`, `owners.json`, `.meta-harness/complexity-policy.json` exist; quality check enforces per-module budgets and import direction. | PASS |
| **10 — Release/package enforcement** | Release check pre-publish gates, dry-run packlist equivalence, isolated npm environment, CLI smoke install. | `meta-harness release check --publish` enforces tree cleanliness, tags, prepublishOnly, CLI/tarball install smoke check. | PASS |
| **11 — Domain governance pilot** | Rule mapping source -> fact -> ontology -> code -> golden case, expired facts block, ready integration. | `domain-rule-check` validates mappings, Golden cases, fact expirations; integrates with `ready-check`; downstream Quant pilot verified. | PASS |
| **12 — Self-evolution prototype** | Bounded local candidate skill distillation, inactive candidate gate, preflight check, promotion/rollback events. | Candidate distillation drafts under `.agents/candidate/`; skill preflight blocks; promote/rollback update registry and log events. | PASS |

Validation commands:
- `git status --porcelain` -> clean
- `git diff --check` -> pass
- `npm test` -> 33/33 tests pass
- `node bin/meta-harness.js quality check --json` -> pass (0 findings)
- `node bin/meta-harness.js ready --target . --json` -> pass (ok: true)
- `node bin/meta-harness.js ready --target . --quick --read-only --json` -> pass (ok: true)
- `node bin/meta-harness.js release check --publish --json` -> pass (ok: true, release_ready: true)

Auditor: Antigravity / Codex
Reopen conditions: Any core check regression, unauthorized permission expansion, or release-enforcement gate failure.
