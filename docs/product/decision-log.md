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

## D032: Phase 13A Context-Quality-Gate Planning Authorization

Decision:

Authorize Phase 13A planning docs and design artifacts for the context-quality-gate capability. This does NOT authorize implementation, CLI changes, test changes, or source code modifications.

Rationale:

Phase 1-12 closed under D031. The next system bottleneck is not more agents or context volume but deciding whether each round has enough compact, evidence-backed context to proceed without guessing. Context quality gating should precede multi-repo rollup (Phase 13) because silent orchestration needs "correct next step" and "planning sufficient?" gates before larger coordination features.

Scope:

- Phase 13A planning docs, design artifacts, and schema drafts only.
- Governance/status updates required to record planning state: append one redacted `.meta-harness/events.jsonl` planning event and update `.meta-harness/status.md`.
- Phase 13 (multi-repo rollup) and Phase 14 (controlled autonomy) numbering unchanged until a separate renumber decision.
- Implementation requires a separate D033 authorization after planning review.

Non-Goals:

- No CLI changes, lib/ changes, test changes, or template additions.
- No renumbering of existing Phase 13/14 roadmap entries.
- No implementation authorization.

## D033: Phase 13A Context-Quality-Gate Implementation Authorization

Decision:

Record and authorize the bounded Phase 13A local context-quality-gate implementation after the 2026-06-12 user authorization to patch the plan and implement via subagents.

Rationale:

D032 deliberately separated planning from implementation. The implementation has now landed, so governance docs/status must no longer describe the context CLI, ready integration, template manifest, or security wiring as pending. The gate remains an interim local safety layer before Phase 13 multi-repo rollup and Phase 14 controlled autonomy.

Scope:

- Local `meta-harness context check`, `meta-harness context packet`, and `meta-harness context ask` surfaces.
- Core local context gate helpers, artifact validation, hints, questions, packet generation, and default ignored outputs under `.meta-harness/local/context/`.
- Source and installed context gate schema/skill templates plus template manifest updates.
- `MH_CONTEXT_GATE_001` ready integration that validates present artifacts and skips absent surfaces as not applicable.
- Security-policy `redaction_surfaces` wiring into the redaction scanner, with focused tests.
- Phase 13 and Phase 14 numbering remains unchanged.

Non-Goals:

- No multi-repo rollup.
- No autonomy daemon or dashboard.
- No model/network scoring.
- No release/publish automation or weakening of existing gates.

## D034: Phase 13B Context Gate Dogfood Authorization

Decision:

Authorize a bounded Phase 13B hardening pass for the Phase 13A local context quality gate.

Rationale:

The first local dogfood pass proved the context gate surfaces run, but it also exposed readiness gaps that must be fixed before dogfood results can be treated as semantic evidence. Phase 13B is authorized to harden the local gate, expand deterministic coverage, and prove ready integration remains read-only without broadening into orchestration, dashboards, network scoring, or release behavior.

Scope:

- Fix placeholder status values so boilerplate such as `Not set.`, `not set`, `none`, `n/a`, `todo`, empty boilerplate, and whitespace-only values are not treated as semantic context evidence.
- Add or remove `context --target` support consistently across implementation, tests, docs, and examples. The preferred path is real `--target <repo>` support for `context check`, `context packet`, and `context ask`.
- Exercise `context check`, `context packet`, and `context ask` against this repo after the placeholder and `--target` fixes land.
- Add fixture coverage for blocked, narrowed, proceed, and excellent verdicts.
- Prove `excellent` requires file-derived evidence for every scoring dimension and cannot be reached solely through capped hint math.
- Add README and walkthrough examples showing correct local context gate use, including `--target` examples when target support is implemented.
- Prove `ready --quick --read-only --json` validates context artifacts without creating or mutating `.meta-harness/local/context/` or tracked `.meta-harness/context/` artifacts.
- Re-run the required dogfood commands after fixes land and record score behavior, blocker questions, artifact freshness, and read-only non-mutation evidence.

Non-Goals:

- No multi-repo rollup.
- No Context7/MCP.
- No context dashboard.
- No auto-worker routing.
- No model/network scoring.
- No daemon.
- No tracked `.meta-harness/context/` artifacts by default.
- No release/publish automation or weakening of existing ready, security, release, or redaction gates.

## D035: Phase 13C Context Gate Adoption Contract

Decision:

Authorize Phase 13C to convert the local context gate from an optional diagnostic into a governed workflow prerequisite for repositories that deliberately adopt `.meta-harness/contracts/context-adoption.md`.

Rationale:

Phase 13A and 13B made context scoring deterministic and read-only ready-safe, but readiness still accepted the latest artifact globally and did not prove that the artifact matched the current workflow transition. Adoption needs explicit transition policy, auditable bypass, and packet behavior that separates worker execution from human review/planning inspection.

Scope:

- Keep the existing seven-phase map and all six adjacent transitions.
- Require gates for `intake->plan`, `plan->work`, `work->verify`, and `verify->synthesize`.
- Treat `synthesize->handoff` and `handoff->lookback` as advisory.
- Activate enforcement only when `.meta-harness/contracts/context-adoption.md` exists.
- Determine the expected ready transition from `.meta-harness/status.md` `Phase:`.
- Reject unrelated latest artifacts as proof for the expected transition.
- Allow blocked required gates only with an artifact override and matching `context-gate-override` event bound to artifact path, round id, transition, code, and event freshness.
- Keep review/planning packets available for inspection while blocking worker packets on required blocked gates.

Non-Goals:

- No new phase transition such as `verify->handoff`.
- No Context7/MCP, dashboard, daemon, model/network scoring, or auto-worker routing.
- No release/publish automation or weakening of existing ready, security, release, package, or redaction gates.

## D036: Phase 13E Governance Snapshot/Replay Implementation Recorded

Decision:

Record the already-landed Phase 13E implementation as current repository truth on main. This is a progress alignment record for the implemented code path, not a new expansion beyond the landed scope.

Rationale:

The repository now contains governance snapshotting, drift detection, artifact fingerprinting, and snapshot-backed replay for context gate decisions. The status and roadmap must no longer imply that Phase 13C adoption is the latest implementation state.

Scope:

- Governance snapshot and hash generation through `meta-harness governance snapshot`.
- Governance diffing through `meta-harness governance diff`.
- Context gate artifact fingerprints that bind governance, evidence, and evaluation identity.
- Snapshot-backed replay through `meta-harness governance replay --snapshot <path> --artifact <path> --target <repo>`.
- Replay-relevant governance engine hashing and legacy artifact compatibility boundaries.

Non-Goals:

- No remote governance store.
- No timestamped snapshot history requirement.
- No cross-version replay promise beyond current snapshot/hash checks.
- No release/publish automation or autonomy expansion.

## D037: Phase 13F Governance Compatibility Classification Recorded

Decision:

Record the already-landed Phase 13F compatibility classifier as current repository truth on main. This is a progress alignment record for the implemented diff-classification slice.

Rationale:

Governance diffs now need conservative semantic labels so reviewers can distinguish clean, patch, additive, and breaking governance drift without changing snapshot hashes or replay behavior.

Scope:

- `lib/governance-compatibility.js` classifies existing governance diff categories.
- `diffGovernanceSnapshots()` includes a snake_case `classification` object.
- Per-change severity and breaking reason annotations are added where useful.
- Unknown categories fail closed as major/breaking migration-required drift.

Non-Goals:

- No governance version field in snapshots.
- No changes to governance hash, context fingerprints, or replay drift checks.
- No migration packs or cross-version replay.
- No dependency additions.

## D038: Phase 14C Governance Migration/Release Framework Recorded

Decision:

Record the already-landed Phase 14C governance migration and release framework as current repository truth on main. This is a progress alignment record for local governed migration/release verification surfaces, not authorization to publish or self-release.

Rationale:

The codebase now includes governance migration planning, application, verification, impact checks, release checks, and release reports. The roadmap and status should describe these as implemented local verification tools while preserving the existing release and autonomy boundaries.

Scope:

- `meta-harness governance migration plan|apply|verify|impact`.
- `meta-harness governance release check|report`.
- Migration specification, impact, release core, validation, check, and report modules.
- Focused CLI and module tests for governance migration and release behavior.

Non-Goals:

- No npm publish, GitHub release creation, remote tag push, or registry write.
- No CI weakening or bypass of existing release/security/package gates.
- No dashboards, daemons, auto-worker routing, or self-approving autonomy.
- No provider credentials or network/model scoring.

## D039: Phase 15A Judge Library Slice Recorded

Decision:

Record Phase 15A as the internal Meta-Harness judge library slice.

Rationale:

The repository needs evidence about recurring agent failure traits before it can safely shape future prompting or delegation. Phase 15A adds a read-only library surface that evaluates a declared local scope against git evidence and emits stable machine-readable judge results. This keeps the first slice small enough to review and avoids promoting judge output into public commands or readiness policy before real judged rounds exist.

Scope:

- `lib/judge.js` emits stable judge envelopes from declared input, git merge-base evidence, scope files, exceptions, and smoke IDs.
- `lib/judge-checks.js` implements the first deterministic internal checks for defensive abstractions, code-surface refactor residue, broad edits, line budget, and package/CLI smoke.
- Focused tests cover untracked files, unsafe input rejection, base-ref errors, merge-base diffing, helper-budget exclusions, residue scan scope, exceptions, and smoke checks.

Non-Goals:

- No public CLI command.
- No templates.
- No global ready check IDs.
- No `ready` hook.
- No delegation routing or policy enforcement.

## D040: Phase 15B Candidate Profile Guidance Slice Recorded

Decision:

Record Phase 15B as the JSON candidate-profile schema and read-only guidance slice generated from judge evidence.

Rationale:

Judge evidence should be usable as compact future-round guidance without becoming policy or routing authority. The 15B slice aggregates `candidate_profile_events` from judge envelopes into a stable profile shape and generates advisory guidance that remains explicitly non-authoritative.

Scope:

- `lib/judge-profile.js` defines the candidate profile JSON envelope/schema, validates profile shape, aggregates judge trait events, and renders compact guidance.
- Guidance is derived only from judge evidence and is marked `read_only_guidance` / `advisory_only`.
- Focused tests cover schema stability, trait aggregation, invalid evidence, unknown traits, and compact rendering.

Non-Goals:

- No public CLI command.
- No templates or context-packet injection.
- No `ready` integration or check-ID expansion.
- No delegation policy, routing decision, worker ranking, or merge authority.

## D041: Phase 16 Minimal MCP Strategic Loop Authorization

Decision:

Authorize Phase 16 as a minimal read-only MCP and Strategic Semantic Loop runtime slice inside `meta-harness`, implemented under one public `meta-harness mcp` command surface.

Rationale:

The repository needs a local bridge from execution evidence to strategic review prompts without turning Meta-Harness into a daemon-heavy agent platform. The selected design keeps the runtime CommonJS, dependency-free, deterministic, and read-only for day one while enabling copy-paste Deep Research workflows and local insight summaries from diffs/logs.

Scope:

- Add one public top-level command, `meta-harness mcp`, with `init`, `serve`, `insight extract`, and `research prompt` subcommands.
- Add a stdio MCP-compatible JSON-RPC server exposing read-only tools: `harness-status`, `harness-research-prompt`, and `harness-insight-summary`.
- Add pure deterministic libraries for insight extraction and research prompt generation.
- Add focused server, CLI, and library tests.
- Accept the existing public CLI command-count warning increasing from 26 to 27 for this authorized command surface.

Non-Goals:

- No write-enabled MCP file tools.
- No shell-execution MCP tools.
- No HTTP/SSE server, OAuth, Cloudflare tunnel, or setup script in this slice.
- No proprietary LLM API calls, network calls, credentials, or committed local MCP config.
- No package dependency additions.

## D042: Phase 16 Closure-Only Product/Governance Alignment

Decision:

Close Phase 16 as sufficient and done-done. Do not start Phase 17 or another runtime feature from this decision.

Rationale:

Phase 16 now proves the full Strategic Semantic Loop on `meta-harness` itself without broadening the runtime surface. The implemented loop covers insight extraction, research prompt generation, read-only research evidence ingest, deterministic research handoff, and worker-readable next-slice decision candidates. The intermediate publisher path has been removed and covered by a rollback guard. The correct remaining work is durable product/governance truth alignment, not another runtime slice.

Scope:

- Record Phase 16/16B/16C/16D/16E as complete.
- Preserve MCP as read-only and bounded.
- Record that the publisher path was removed and guarded.
- Update status, roadmap, decision log, and tracked governance event truth only.
- Add no runtime code, tests, commands, dependencies, package changes, README changes, or Phase 17 planning.

Evidence:

- Local checkout: `HEAD`, `origin/main`, and `origin/HEAD` at `5a796ce` (`test: guard MCP publisher rollback`).
- Remote freshness caveat: `git fetch origin` failed locally with `Could not resolve host: github.com`.
- Runtime environment: `node -v` -> v18.19.1; `npm --version` -> 9.2.0.
- `node bin/meta-harness.js sync check --target .` -> PASS checked=30.
- `node bin/meta-harness.js quality check` -> PASS with accepted D041 warning: public CLI command count 27 > 25.
- `git diff --check` -> PASS.
- `node bin/meta-harness.js ready --target . --quick --json` -> ok=true, passed=16, failed=0, warned=1, skipped=3.
- Focused Phase 16/MCP/research tests passed 23/23 across MCP CLI, research handoff, report ingest, and ingest CLI suites.
- `npm test` -> 73/73 test files passed, 0 failed.

Non-Goals:

- No mutable MCP tool surface.
- No command execution through MCP.
- No HTTP/SSE server, tunnel, credentials, provider config, network call, or external model API call.
- No package dependency additions.
- No new public command surface.
- No publisher path.
- No Phase 17 planning or implementation.

Auditor:

GPT-5.5 Thinking / DevSpace local.

Reopen conditions:

Reopen Phase 16 only for a concrete regression in the read-only MCP/research-loop surface, publisher guard, deterministic handoff behavior, ready/sync/quality gates, or full-suite tests. Otherwise, future runtime work requires a separate post-Phase-16 decision.

## D043: Phase 17 Read-Only Multi-Repo Rollup Pilot Closure

Decision:

Close Phase 17 locally as the smallest useful read-only multi-repo rollup pilot. The approved command surface is `meta-harness poll --rollup [--json]`; no new top-level `rollup` command is added.

Rationale:

Phase 17 should prove safe cross-repo visibility without broadening command count, running child commands, or mutating child truth. The existing `poll` and `repos` surfaces already provide the correct parent/child shape. Extending `poll` keeps the implementation small, avoids the public CLI command-count expansion, and preserves the dashboard-after-truth boundary.

Scope:

- Add pure local-files-only aggregation in `lib/repo-rollup.js`.
- Wire `poll --rollup` and `poll --rollup --json` through `lib/commands/poll.js`.
- Keep `poll --write` unchanged for non-rollup polling.
- Reject `poll --rollup --write` to prevent accidental parent truth mutation in the first pilot slice.
- Update help usage only; do not add a new public command.
- Add focused library, CLI, no-write, and usage-registry tests.
- Add no dependencies, package changes, README changes, child command execution, child mutation, daemon, dashboard, network call, or autonomy trigger.

Evidence:

- Phase 16 closure truth was committed first as `1cfbf75` (`docs: close Phase 16 governance truth`).
- Phase 17 runtime was committed from a clean tree as `ced6c36` (`feat: add read-only repo rollup to poll`).
- `git diff --check` -> PASS.
- `node --test tests/repo-rollup.test.js` -> PASS 3/3.
- `node --test tests/poll-rollup-cli.test.js` -> PASS 3/3.
- `node --test tests/command-registry.test.js` -> PASS 4/4.
- `node bin/meta-harness.js poll --rollup --json` -> emitted schema_version `1.0.0`, generated_from `local_files`, summary total=0 for this parent, and read-only `not_changed` markers.
- `node bin/meta-harness.js sync check --target .` -> PASS checked=30.
- `node bin/meta-harness.js quality check` -> PASS with existing accepted public CLI command count warning 27 > 25; Phase 17 did not add command count.
- `node bin/meta-harness.js ready --target . --quick --json` -> ok=true, passed=15, failed=0, warned=1, skipped=4.
- `node scripts/run-tests.js` -> 75/75 test files passed, 0 failed.

Non-Goals:

- No `meta-harness rollup` top-level command.
- No child repo command execution.
- No parent or child truth mutation by default.
- No use of `--write` with rollup output.
- No dependencies or package changes.
- No dashboard, daemon, scheduled scan, external CI publishing, or autonomy trigger.
- No cross-repo drift dashboard in this slice.
- No child ready.json freshness enforcement in this slice.

Remote status:

Local `main` is ahead of `origin/main`. Remote freshness/push remains blocked in this environment while DNS/proxy resolution for `github.com` fails. The remaining external closure step is to push and confirm `origin/main` contains the Phase 16 closure, Phase 17 runtime, and Phase 17 closure commits once network access is restored.

Reopen conditions:

Reopen Phase 17 only for a concrete regression where `poll --rollup` executes child commands, mutates parent/child truth by default, omits the read-only JSON markers, adds a new top-level command, increases public command count, or fails the focused rollup/CLI/full-suite verification. Broader dashboard/drift/freshness work requires a separate future decision.

## D044: Close Phase 17B/17C Ready Freshness and Drilldown

Decision:

Accept the combined Phase 17B/17C runtime slice as sufficient and closed locally.

Rationale:

The rollup now treats child `.meta-harness/ready.json` as an authoritative read-only readiness contract, making the parent observation layer trustworthy before any future drift warnings or autonomy pilot. This preserves the observe -> classify -> drill down sequence and avoids orchestration creep.

Scope accepted:

- Ready contract freshness is enforced through `expires_after`.
- `expires_after <= now` is classified as `stale`.
- Malformed or missing required ready contract fields are classified as `invalid`.
- Required ready fields are `schema_version`, `generated_at`, `target`, `ok`, `redacted`, `expires_after`, and `checks`.
- `redacted` must be true.
- `checks` must be an array.
- Child `ready.json` remains authoritative when present, so stale or invalid `ready.json` does not fall back to child `status.md` or `poll.md`.
- JSON output includes `failing_checks` drilldown.
- JSON output includes `warning_checks` drilldown.
- Markdown output includes failed/warn check drilldown.
- Output remains deterministic.
- Parent behavior remains read-only and non-mutating.

Evidence:

- Runtime commit: `8195011` (`feat: enforce ready rollup freshness`).
- `git fetch origin` -> PASS.
- `git status --short --branch` before closure -> `## main...origin/main [ahead 4]`.
- `git log --oneline --decorate -10` before closure -> HEAD `8195011`; local history includes `983fe1d` and `8195011`.
- `node -v` -> v18.19.1.
- `npm -v` -> 9.2.0.
- `node --test tests/repo-rollup.test.js` -> PASS 6/6.
- `node --test tests/poll-rollup-cli.test.js` -> PASS 4/4.
- `node --test tests/command-registry.test.js` -> PASS 4/4.
- `node bin/meta-harness.js sync check --target .` -> `SYNC CHECK: PASS checked=30`.
- `node bin/meta-harness.js quality check` -> `Quality gate: PASS` with accepted/unchanged warning `public CLI command count 27 exceeds 25`.
- `node bin/meta-harness.js ready --target . --quick --json` -> ok=true, passed=15, failed=0, warned=1, skipped=4.

Non-goals:

- No dashboard.
- No daemon.
- No child command execution.
- No child repo mutation.
- No parent status mutation from rollup.
- No CI dashboard publishing.
- No auto-repair.
- No MCP expansion.
- No provider/network integration.
- No Phase 17D drift detection in this closure.

Remote status:

Local `main` is ahead of `origin/main` by 4 commits before this closure commit. Push is skipped unless explicitly instructed; remote done-done remains pending until pushed and confirmed.

Reopen conditions:

Reopen Phase 17B/17C only for a concrete regression where child `ready.json` is no longer authoritative when present, stale/invalid ready contracts fall back to weaker artifacts, required contract validation is bypassed, failed/warn drilldown disappears from JSON or Markdown output, parent rollup mutates parent/child files, or focused verification no longer passes.

## D045: Close Phase 17D Read-Only Drift Warnings

Decision:

Accept the Phase 17D runtime slice as sufficient and closed locally.

Rationale:

The rollup now observes cross-repo drift from existing local child files without changing readiness classification, executing child commands, mutating child repos, or creating dashboard/orchestration scope. This completes the observe -> classify -> drill down -> warn on drift sequence while preserving the action boundary for later phases.

Scope accepted:

- Per-repo `drift_warnings` JSON array.
- `summary.drift_warnings` JSON count.
- Deterministic Markdown `DRIFT` lines.
- Template manifest drift warnings.
- Security policy surface drift warnings.
- Skill registry drift warnings.
- Minimal governance compatibility drift warnings.
- Malformed optional drift JSON warns without invalidating readiness.
- Drift warnings are warning-only.
- Drift warnings do not alter repo readiness state.
- Drift warnings alone do not make `ok=false`.
- Parent remains read-only.
- `poll --rollup --write` remains rejected.
- Deterministic output.

Non-goals:

- No dashboard.
- No daemon.
- No child command execution.
- No child repo mutation.
- No parent status mutation from rollup.
- No CI dashboard publishing.
- No auto-repair.
- No readiness refresh.
- No MCP expansion.
- No provider/network integration.
- No next runtime slice in this closure.

Evidence:

- Runtime commit: `b02c9f3` (`feat: add read-only rollup drift warnings`).
- `git fetch origin` -> PASS.
- `git status --short --branch` before closure -> `## main...origin/main [ahead 6]`.
- `git log --oneline --decorate -10` before closure -> HEAD `b02c9f3`; local history includes `ced6c36`, `8195011`, `34e4702`, and `b02c9f3`.
- `node -v` -> v18.19.1.
- `npm -v` -> 9.2.0.
- `node --test ./tests/repo-rollup.test.js` -> PASS 6/6.
- `node --test ./tests/repo-rollup-drift.test.js` -> PASS 12/12.
- `node --test ./tests/poll-rollup-cli.test.js` -> PASS 6/6.
- `node --test ./tests/command-registry.test.js` -> PASS 4/4.
- `npm test` before closure -> PASS 76 test files, failed 0.
- `node bin/meta-harness.js sync check --target .` -> `SYNC CHECK: PASS checked=30`.
- `node bin/meta-harness.js quality check` -> `Quality gate: PASS` with accepted/unchanged warning `public CLI command count 27 exceeds 25`.
- `node bin/meta-harness.js ready --target . --quick --json` -> ok=true, failed=0, passed=15, warned=1, skipped=4.
- `git diff --check` before runtime commit -> PASS.

Remote status:

Local `main` is ahead of `origin/main` by 6 commits before this closure commit. The previous push attempt failed with DevSpace connector 502. Remote done-done remains pending until pushed and confirmed on `origin/main`.

Reopen conditions:

Reopen Phase 17D only for a concrete regression where drift warnings alter readiness state, make `ok=false` by themselves, become non-deterministic, disappear from JSON or Markdown output, execute child commands, mutate parent/child files, allow `poll --rollup --write`, or broaden into dashboard, daemon, network/provider, MCP, auto-repair, readiness refresh, or autonomy scope.

## D046: Close Phase 18 Read-Only Rollup Response Handoff

Decision:

Accept the Phase 18 runtime slice as sufficient and closed locally.

Rationale:

The rollup now provides a compact review handoff from child repo health and drift evidence without becoming a dashboard, daemon, worker router, or mutation surface. This completes the read-only response handoff brief while keeping parent observation separate from child repo authority.

Scope accepted:

- Top-level JSON `response_handoff` output.
- Compact Markdown Response Handoff section.
- Review-only handoff items with `mutates=false`.
- Handoff items do not alter child readiness state.
- Handoff/drift alone does not make top-level `ok=false`.
- `poll --rollup --write` remains rejected and non-mutating.
- No new commands.
- No dependencies.

Evidence:

- Runtime commit: `d491e99` (`feat: add read-only rollup response handoff`).
- Follow-on dirty runtime residue was completed and committed separately before this closure.
- `node --test tests/repo-rollup-handoff.test.js` -> PASS 4/4 before closure.
- `node --test tests/repo-rollup.test.js` -> PASS 6/6 before closure.
- `node --test tests/poll-rollup-cli.test.js` -> PASS 6/6 before closure.
- `node --test tests/command-registry.test.js` -> PASS 4/4 before closure.
- `node scripts/run-tests.js` -> PASS 79/79 test files, 0 failed before closure.
- `git diff --check` -> PASS before closure.

Non-goals:

- No dashboard.
- No daemon.
- No child command execution.
- No child repo mutation.
- No parent status mutation from rollup.
- No CI dashboard publishing.
- No auto-repair.
- No readiness refresh.
- No MCP expansion.
- No provider/network integration.
- No write-enabled handoff.
- No handoff files written.

Remote status:

Local `main` remains ahead of `origin/main` until pushed and confirmed.

Reopen conditions:

Reopen Phase 18 only for a concrete regression where response handoff disappears from JSON/Markdown, mutates files, changes readiness classification, makes `ok=false` by itself, allows `poll --rollup --write`, executes child commands, or broadens into dashboard, daemon, network/provider, MCP, auto-repair, readiness refresh, or autonomy scope.

## D047: Close Follow-On Read-Only Rollup Action/Proposal Surface

Supersession:

D048 supersedes this current-truth claim. D047 was too broad because it combined next-action routing with premature proposal-only automation. The historical commit remains recorded, but current shipped rollup truth is Phase 19A next-action routing only; proposal-only automation is deferred to Phase 20.

Decision:

Accept the follow-on read-only rollup action/proposal runtime slice as sufficient and closed locally.

Rationale:

The current uncommitted residue after Phase 18 represented a coherent next runtime slice. Completing and committing it is safer than leaving dirty files in place while closing Phase 18. The slice remains review-only: it derives action candidates and proposal objects from existing local evidence but writes nothing and applies nothing.

Scope accepted:

- Per-repo JSON `action_candidates` output.
- Per-repo JSON `patch_proposals` output.
- Summary counts for `action_candidates` and `patch_proposals`.
- Deterministic Markdown action and proposal lines under child repos.
- Read-only proposal objects with `mutates=false`.
- Proposal diffs are `null` in this slice.
- Readiness state and top-level `ok` behavior are preserved.
- No new commands.
- No dependencies.

Evidence:

- Runtime commit: `9e3514d` (`feat: add read-only rollup patch proposals`).
- `node --test tests/repo-rollup-actions.test.js` -> PASS 5/5.
- `node --test tests/repo-rollup-patches.test.js` -> PASS 4/4.
- `node --test tests/repo-rollup.test.js` -> PASS 6/6.
- `node --test tests/poll-rollup-cli.test.js` -> PASS 6/6.
- `node --test tests/repo-rollup-drift.test.js` -> PASS 12/12.
- `node --test tests/repo-rollup-handoff.test.js` -> PASS 4/4.
- `node --test tests/command-registry.test.js` -> PASS 4/4.
- `node scripts/run-tests.js` -> PASS 79/79 test files, 0 failed.
- `git diff --check` -> PASS.

Non-goals:

- No dashboard.
- No daemon.
- No child command execution.
- No child repo mutation.
- No parent status mutation from rollup.
- No CI dashboard publishing.
- No auto-repair.
- No readiness refresh.
- No MCP expansion.
- No provider/network integration.
- No written proposal files.
- No proposal application.
- No controlled autonomy.

Remote status:

Local `main` remains ahead of `origin/main` until pushed and confirmed.

Reopen conditions:

Reopen D047 only for a concrete regression where action/proposal output mutates files, applies diffs, changes readiness classification, makes `ok=false` by itself, executes child commands, allows rollup write behavior, loses deterministic JSON/Markdown output, or broadens into dashboard, daemon, network/provider, MCP, auto-repair, readiness refresh, or autonomy scope.

## D048: Supersede D047 Proposal Surface and Close Phase 19A Next-Action Routing

Decision:

Supersede D047 as current roadmap truth and close Phase 19A as a corrective split: remove premature proposal-only automation from the committed rollup surface and keep/harden read-only next-action routing only.

Rationale:

D047 incorrectly closed an action/proposal surface after Phase 18, combining two roadmap boundaries. Phase 19A should convert existing rollup/handoff attention into deterministic next-action candidates. It must not ship patch proposals, queue files, action files, proposal files, patch application, child command execution, or parent/child repo mutation. The corrective runtime commit removes proposal output and standardizes the new `next_action_candidates` schema.

Scope accepted:

- Per-repo JSON `next_action_candidates` output.
- Summary count `summary.next_action_candidates`.
- Candidate schema includes `id`, `priority`, `kind`, `reason`, `repo`, `source_state`, `source_warning_ids`, `source_warning_kinds`, `source_check_ids`, `target_paths`, and `mutates`.
- Candidate priorities are deterministic: readiness states emit first, drift candidates emit after readiness candidates, and drift candidates are always low priority.
- Markdown renders compact priority action lines under child repos.
- Clean ready repos emit zero next-action candidates.
- Readiness state and top-level `ok` behavior are preserved.
- Drift-only candidates do not make top-level `ok=false`.
- `poll --rollup --write` remains rejected and non-mutating.
- Proposal output is removed from the Phase 19A runtime surface.
- Phase 20 proposal-only automation remains deferred/future.
- No new commands.
- No dependencies.

Evidence:

- Runtime commit: `f3b1b59` (`feat: split rollup next-action routing from patch proposals`).
- `node --test ./tests/repo-rollup-actions.test.js ./tests/repo-rollup.test.js ./tests/poll-rollup-cli.test.js` -> PASS 19/19.
- `node --test ./tests/repo-rollup-drift.test.js ./tests/repo-rollup-handoff.test.js ./tests/command-registry.test.js` -> PASS 20/20.
- `node bin/meta-harness.js sync check --target .` -> PASS checked=30.
- `node bin/meta-harness.js quality check` -> PASS with known public CLI command count warning 27 > 25.
- `node bin/meta-harness.js ready --target . --quick --json` -> ok=true, failed=0.
- `npm test` -> PASS 78/78 test files, failed=0.
- `git diff --check` on modified runtime/test files before runtime commit -> PASS.

Non-goals:

- No dashboard.
- No daemon.
- No child command execution.
- No child repo mutation.
- No parent status mutation from rollup.
- No readiness state mutation from candidates.
- No queue files written.
- No action files written.
- No patch proposals shipped.
- No proposal files written.
- No proposal application.
- No CI dashboard publishing.
- No auto-repair.
- No readiness refresh.
- No MCP expansion.
- No provider/network integration.
- No controlled autonomy.

Remote status:

Local `main` remains ahead of `origin/main` until pushed and confirmed.

Reopen conditions:

Reopen D048 only for a concrete regression where `next_action_candidates` disappear from JSON/Markdown, proposal output returns to Phase 19A, candidates mutate files, candidates change readiness classification, candidates make `ok=false` by themselves, `poll --rollup --write` succeeds, child commands execute, parent/child repos mutate, or scope broadens into dashboard, daemon, provider/network, MCP, auto-repair, readiness refresh, proposal automation, or autonomy.

## D049: Close Phase 19B Read-Only Candidate Brief Packet

Decision:

Accept Phase 19B as a small read-only rollup extension: convert existing `next_action_candidates` into one deterministic top-level `next_action_brief` for a worker/operator.

Rationale:

Phase 19A identifies candidate follow-up work. Phase 19B makes the highest-priority candidate immediately usable without creating a queue, writing files, generating proposals, applying patches, executing child commands, refreshing readiness, or mutating parent/child repo truth. The brief remains a read-only packet embedded in rollup output.

Scope accepted:

- Top-level JSON `next_action_brief` with `kind`, selected candidate metadata, `selection_reason`, `target_paths`, `body`, and `mutates=false`.
- No-op brief when there are no next-action candidates.
- Candidate selection is deterministic: high before medium before low, configured repo order as tie-breaker, per-repo candidate order as final tie-breaker.
- Only one brief is generated.
- Brief body includes repo name, candidate ID, priority, reason, source state, source warning IDs, source check IDs, target paths, read-only boundary, and explicit instruction not to mutate parent/child repos.
- Markdown renders a compact `## Next Action Brief` section.
- Brief generation preserves readiness state and top-level `ok` behavior.
- Drift-only low-priority brief does not make top-level `ok=false`.
- `poll --rollup --write` remains rejected and non-mutating.
- No new commands.
- No dependencies.

Evidence:

- Runtime commit: `5c7a57a` (`feat: add read-only rollup next-action brief`).
- `node --test ./tests/repo-rollup.test.js` -> PASS 6/6.
- `node --test ./tests/repo-rollup-drift.test.js` -> PASS 12/12.
- `node --test ./tests/repo-rollup-handoff.test.js` -> PASS 4/4.
- `node --test ./tests/repo-rollup-actions.test.js` -> PASS 7/7.
- `node --test ./tests/repo-rollup-action-brief.test.js` -> PASS 11/11.
- `node --test ./tests/poll-rollup-cli.test.js` -> PASS 6/6.
- `node --test ./tests/command-registry.test.js` -> PASS 4/4.
- `node bin/meta-harness.js sync check --target .` -> PASS checked=30.
- `node bin/meta-harness.js quality check` -> PASS with known public CLI command count warning 27 > 25.
- `node bin/meta-harness.js ready --target . --quick --json` -> ok=true, failed=0.
- `npm test` -> PASS 79/79 test files, failed=0.
- `git diff --check` -> PASS.

Non-goals:

- No dashboard.
- No daemon.
- No child command execution.
- No child repo mutation.
- No parent status mutation from rollup.
- No readiness state mutation from candidates or briefs.
- No queue files written.
- No action files written.
- No proposal files written.
- No `patch_proposals` output.
- No proposal application.
- No auto-repair.
- No readiness refresh.
- No MCP expansion.
- No provider/network integration.
- No controlled autonomy.

Remote status:

Local `main` remains ahead of `origin/main` until pushed and confirmed.

Reopen conditions:

Reopen D049 only for a concrete regression where `next_action_brief` disappears from JSON/Markdown, brief selection becomes non-deterministic, brief generation mutates files, proposal output returns, `poll --rollup --write` succeeds, child commands execute, parent/child repos mutate, readiness or `ok` behavior changes because of the brief, or scope broadens into dashboard, daemon, provider/network, MCP, auto-repair, readiness refresh, proposal automation, or autonomy.

## D050: Close Phase 20A Read-Only Proposal Draft Packet

Decision:

Accept Phase 20A as a small read-only rollup extension: derive one deterministic top-level `proposal_draft` from the selected `next_action_brief`.

Rationale:

Phase 19B selects one worker-readable next action. Phase 20A turns that selected brief into a proposal-shaped review draft embedded only in rollup output. The runtime remains read-only and does not create proposal files, queues, patches, child commands, readiness refreshes, or parent/child repo mutation.

Scope accepted:

- Top-level JSON `proposal_draft` with `kind`, `source`, selected candidate metadata, `proposal_type`, `title`, `body`, `target_paths`, `diff`, and `mutates`.
- `proposal_draft.kind` is `read_only_proposal_draft`.
- `proposal_draft.source` is `next_action_brief`.
- `proposal_draft.proposal_type` is `review_brief`.
- `proposal_draft.diff` is always `null`.
- `proposal_draft.mutates` is always `false`.
- No-op draft when `next_action_brief.selected_candidate_id` is null.
- Draft body uses structured brief fields, not parsed human-readable brief body text.
- `next_action_brief` now exposes structured `reason`, `source_state`, `source_warning_ids`, and `source_check_ids` copied from the selected candidate.
- Draft title is generic and deterministic: `Review rollup next action for <repo>`.
- Markdown renders a compact `## Proposal Draft` section after `## Next Action Brief`.
- Draft generation preserves readiness state and top-level `ok` behavior.
- `poll --rollup --write` remains rejected and non-mutating.
- No new commands.
- No dependencies.

Evidence:

- Runtime commit: `998ecef` (`feat: add read-only rollup proposal draft`).
- `node --test ./tests/repo-rollup.test.js` -> PASS 6/6.
- `node --test ./tests/repo-rollup-drift.test.js` -> PASS 12/12.
- `node --test ./tests/repo-rollup-handoff.test.js` -> PASS 4/4.
- `node --test ./tests/repo-rollup-actions.test.js` -> PASS 7/7.
- `node --test ./tests/repo-rollup-action-brief.test.js` -> PASS 11/11.
- `node --test ./tests/repo-rollup-proposal-draft.test.js` -> PASS 10/10.
- `node --test ./tests/poll-rollup-cli.test.js` -> PASS 6/6.
- `node --test ./tests/command-registry.test.js` -> PASS 4/4.
- `node bin/meta-harness.js sync check --target .` -> PASS checked=30.
- `node bin/meta-harness.js quality check` -> PASS with known public CLI command count warning 27 > 25.
- `node bin/meta-harness.js ready --target . --quick --json` -> ok=true, failed=0.
- `npm test` -> PASS 80/80 test files, failed=0.
- `git diff --check` -> PASS.

Non-goals:

- No dashboard.
- No daemon.
- No child command execution.
- No child repo mutation.
- No parent status mutation from rollup.
- No readiness state mutation from candidates, briefs, or drafts.
- No readiness refresh.
- No queue files written.
- No action files written.
- No proposal files written.
- No `patch_proposals` output.
- No patch application.
- No auto-repair.
- No MCP expansion.
- No provider/network integration.
- No controlled autonomy.

Future boundary:

Phase 20B proposal draft validation remains future/deferred if more proposal rigor is needed. Export, write, apply, queue, autonomy, dashboard, daemon, provider/network, and child command behavior remain out of scope.

Remote status:

Local `main` remains ahead of `origin/main` until pushed and confirmed.

Reopen conditions:

Reopen D050 only for a concrete regression where `proposal_draft` disappears from JSON/Markdown, draft generation parses human-readable brief body instead of structured fields, `diff` becomes non-null, `mutates` becomes true, patch proposals return, proposal/action/queue files are written, `poll --rollup --write` succeeds, child commands execute, parent/child repos mutate, readiness or `ok` behavior changes because of the draft, or scope broadens into dashboard, daemon, provider/network, MCP, auto-repair, readiness refresh, export/write/apply behavior, validation beyond read-only draft generation, or autonomy.

## D056: Close Phase 20G Read-Only Proposal Review Receipt Validation

Decision:

Accept Phase 20G as read-only `proposal_review_receipt_validation` over `proposal_review_receipt_template`.

Runtime commit: `a712c3b`.

Scope accepted:

- JSON includes `proposal_review_receipt_validation` after `proposal_review_receipt_template` and before `repos`.
- Receipt validation kind is `read_only_proposal_review_receipt_validation`.
- Receipt validation checks the receipt-template safety surface.
- Checks cover receipt template kind, source, packet ID, verdict, allowed decisions, required fields, decision-field nulls, `records_decision=false`, and `mutates=false`.
- Checks also cover absence of proposal, export, queue, and action file-output fields in the bounded scan surface.
- The bounded scan surface covers rollup, summary, repos, proposal review options, and proposal review receipt template containers.
- Receipt validation verdict is `pass` only when every check passes; otherwise it is `fail`.
- Receipt validation records no decision and no approval.
- Receipt validation preserves top-level rollup `ok` and child readiness state.
- Markdown renders `## Proposal Review Receipt Validation` after `## Proposal Review Receipt Template`.

Evidence:

- Runtime commit: `a712c3b` (`feat: add read-only proposal review receipt validation`).
- `node --test ./tests/repo-rollup-proposal-review-receipt-validation.test.js` -> PASS 19/19.
- `npm test` -> PASS 86/86 test files, failed=0.
- `./bin/meta-harness.js sync check --target .` -> PASS checked=30.
- `./bin/meta-harness.js quality check` -> PASS with known public CLI command count warning 27 > 25.
- `./bin/meta-harness.js ready --target . --quick` -> READY yes, failed=0.
- `git diff --check` -> PASS.

Non-goals:

- No copy block rendering.
- No export-file workflow.
- No export files.
- No proposal/action/queue files.
- No approval recording.
- No review decision recording.
- No diffs or patch application.
- No task creation.
- No child command execution.
- No readiness refresh.
- No parent or child repo mutation.
- No rollup ok/readiness behavior change.
- No dashboard, daemon, provider/network integration, MCP expansion, auto-repair, or autonomy.

Future boundary:

Phase 20H read-only copy block rendering is closed under D057. Phase 20I explicit export-file workflow remains future if ever needed. Phase 21 autonomy remains deferred.

## D057: Close Phase 20H Read-Only Proposal Review Copy Block

Decision:

Accept Phase 20H as read-only `proposal_review_copy_block` rendering inside existing rollup JSON/Markdown.

Runtime commit: `59c23d3`.

Scope accepted:

- JSON includes `proposal_review_copy_block` after `proposal_review_receipt_validation` and before `repos`.
- Copy block kind is `read_only_proposal_review_copy_block`.
- Copy block source is `proposal_review_receipt_validation`.
- Copy text renders only after receipt validation passes.
- Missing or failing receipt validation emits `copy_text=null` and a blocked reason.
- Copy block includes proposal review packet, options, receipt template, and receipt validation context.
- Copy block uses `export_target=null`, not `export_path`.
- Copy block has `writes_files=false`, `records_decision=false`, `records_approval=false`, and `mutates=false`.
- Copy text is deterministic and contains no generated diff.
- Copy block preserves top-level rollup `ok` and child readiness state.
- Markdown renders `## Proposal Review Copy Block` after receipt validation.

Evidence:

- Runtime commit: `59c23d3` (`feat-copy-block`).
- Required direct rollup node --test batches -> PASS 156/156.
- `node bin/meta-harness.js sync check --target .` -> PASS checked=30.
- `node bin/meta-harness.js ready --target . --quick` -> READY yes, quality PASS, known security warning only.
- Full npm wrapper attempted but DevSpace returned connector 502; direct node --test batches were used as executable verification signal.
- Local shell remains below declared engine: node v18.19.1 and npm 9.2.0.

Non-goals:

- No clipboard integration.
- No export-file workflow.
- No export files.
- No proposal/action/queue files.
- No approval recording.
- No review decision recording.
- No diffs or patch application.
- No task creation.
- No child command execution.
- No readiness refresh.
- No parent or child repo mutation.
- No rollup ok/readiness behavior change.
- No dashboard, daemon, provider/network integration, MCP expansion, auto-repair, or autonomy.

Phase 20I read-only copy block validation is closed under D058. Phase 20J read-only export intent/safety gate remains future. Phase 21 autonomy remains deferred.

## D058: Close Phase 20I Read-Only Proposal Review Copy Block Validation

Decision:

Accept Phase 20I as read-only `proposal_review_copy_block_validation` checking the safety and consistency of the copy block.

Runtime commit: `local`.

Scope accepted:

- JSON includes `proposal_review_copy_block_validation` after `proposal_review_copy_block` and before `repos`.
- Copy block validation kind is `read_only_proposal_review_copy_block_validation`.
- Enforces copy block kind, source, packet ID consistency, verdict match, includes list, read-only safety, correct blocked/passed text states, safety from forbidden words/diffs, no forbidden output fields, and no `patch_proposals`.
- Validation verdict is `pass` only when every check passes, otherwise it is `fail`.
- Validation preserves top-level rollup `ok` and child readiness state.
- Markdown renders `## Proposal Review Copy Block Validation` after copy block markdown.

Evidence:

- Runtime commit: `local`.
- Test suite: `tests/repo-rollup-proposal-review-copy-block-validation.test.js` passes (12/12).
- Full npm test suite passes (88 test files passing cleanly).
- Local verification complete.

Non-goals:

- No write operations or file exporting.
- No clipboard integration.
- No auto-repair or autonomy.
- No changes to child repo readiness or rollup ok.

Phase 20J read-only export intent and safety gate is closed under D059. Phase 20K explicit export-file workflow remains future. Phase 21 autonomy remains deferred.

## D059: Close Phase 20J Read-Only Proposal Review Export Intent and Safety Gate

Decision:

Accept Phase 20J as read-only `proposal_review_export_intent` and `proposal_review_export_safety_gate` verifying no file writes or mutations occur during review.

Runtime commit: `local`.

Scope accepted:

- JSON includes `proposal_review_export_intent` and `proposal_review_export_safety_gate` after `proposal_review_copy_block_validation` and before `repos`.
- Export intent kind is `read_only_proposal_review_export_intent`.
- Export safety gate kind is `read_only_proposal_review_export_safety_gate`.
- Intent enforces read-only safety fields (`export_target=null`, `declared_intent=none/null`, `writes_files=false`, etc.).
- Safety gate verifies export intent kind, packet ID consistency, copy block validation matching, intent constraints, absence of forbidden output fields, and absence of `patch_proposals`.
- Safety gate verdict is `pass` only when every check passes, otherwise it is `fail`.
- Export intent and safety gate preserve top-level rollup `ok` and child readiness state.
- Markdown renders `## Proposal Review Export Intent` and `## Proposal Review Export Safety Gate` after copy block validation rendering.

Evidence:

- Runtime commit: `local`.
- Test suite: `tests/repo-rollup-proposal-review-export-safety-gate.test.js` passes (10/10).
- Full npm test suite passes (89 test files passing cleanly under Node v22.22.2 / npm v11.6.2).
- Local verification complete.

Non-goals:

- No write operations or file exporting.
- No clipboard integration.
- No auto-repair or autonomy.
- No changes to child repo readiness or rollup ok.

Future boundary:

Phase 20K explicit export-file workflow is bypassed and remains future only if a real user need appears. Phase 21A/21B are closed under D060; write-enabled Phase 21C remains future.

## D060: Close Phase 21A/21B Approved Manual-Work Packet and Bypass Phase 20K

Decision:

Accept Phase 21A as the controlled autonomy dry-run plan plus explicit approval receipt validation/input chain, and accept Phase 21B as the stdout-only approved manual-work packet.

Runtime commits:

- `0588063` controlled autonomy dry-run rollup plan.
- `d604e07` autonomy approval receipt validation.
- `128bd8e` CLI approval receipt input.
- `9507955` approved manual-work packet.

Scope accepted:

- JSON includes `autonomy_plan` after `proposal_review_export_safety_gate`.
- JSON includes `autonomy_approval_receipt_validation` after `autonomy_plan`.
- `poll --rollup --json` accepts explicit approval receipt evidence inline or from file.
- JSON always includes `manual_work_packet` after `autonomy_approval_receipt_validation` and before `repos`.
- `manual_work_packet` shell states are explicit: `not_needed`, `missing_approval`, `blocked`, `invalid`, and `ready_for_manual_work`.
- A valid approval receipt unlocks `ready_for_manual_work`.
- Packet output is deterministic and built from structured fields only; it does not parse Markdown/body text.
- Packet output includes selected repo, selected candidate, packet ID, target paths, source check IDs, source warning IDs, normalized receipt reviewer/reviewed_at/reason, and deterministic manual instructions.
- Packet and receipt validation remain stdout-only and non-mutating: no file writes, queues, tasks, patches, child commands, readiness refresh, parent/child truth mutation, approval persistence, or decision recording.
- Markdown renders `## Approved Manual Work Packet`.

Roadmap correction:

Phase 20K explicit export-file workflow is bypassed. Approval evidence now enters the public CLI directly, and Phase 21B emits stdout-only manual-work packets. Export files remain future only if a real user need appears.

Evidence:

- Runtime commit: `9507955` (`feat: add approved manual work packet`).
- Targeted Phase 21B tests: PASS 15/15.
- Full npm test suite: PASS 93 test files, failed=0.
- Sync check: PASS checked=30.
- Quality check: PASS with known public CLI command-count warning 27 > 25.
- Ready quick JSON: ok=true, passed=15, failed=0, warned=1.
- `git diff --check`: PASS.

Non-goals:

- No README/package/dependency/public-command changes.
- No export files, queue files, task files, action files, proposal files, or patch proposals.
- No patch application, child command execution, readiness refresh, approval persistence, decision recording, parent/child truth mutation, dashboard, daemon, provider/network integration, MCP write expansion, or write-enabled handoff.

Future boundary:

Phase 21C operator-driven write surface materialization is closed under D061; Phase 21D artifact verification is closed under D062; Phase 21E operator execution planning is closed under D063.

## D061: Close Phase 21C Approved Packet Materialization

Decision:

Accept Phase 21C as the narrow parent-local JSON artifact materializer for approved manual-work packets.

Runtime commit:

- `16c7502` (`feat: materialize approved manual work packet`).

Scope accepted:

- Generic `poll --rollup --write` remains rejected.
- `poll --rollup --json --write-manual-work-packet <path>` is the only materialization surface.
- Materialization requires `manual_work_packet.verdict=ready_for_manual_work`.
- The artifact uses dedicated `schema_version="1.0.0"` plus `rollup_schema_version` for the source rollup.
- Paths must be relative, inside `.meta-harness/`, file-targeted, outside child repo roots, and overwrite only with `--force`.
- The wrapper records the intentional parent-local file creation while the embedded packet remains non-writing.
- JSON stdout still emits the full rollup.

Evidence:

- Focused Phase 21C/rollup tests: PASS 25/25.
- Full npm test suite: PASS 94 test files, failed=0.
- Sync check: PASS checked=30.
- Quality check: PASS with known public CLI command-count warning 27 > 25.
- Ready quick JSON: ok=true, passed=15, failed=0, warned=1.

Non-goals:

- No new public command, dependency, README change, dashboard, daemon, approval persistence, decision recording, readiness refresh, child repo mutation, child command execution, patch application, queue file, task file, proposal file, or export workflow.

Future boundary:

Phase 21D artifact verification is closed under D062; Phase 21E operator execution planning is closed under D063.

## D062: Close Phase 21D Approved Packet Artifact Verification

Decision:

Accept Phase 21D as the read-only verifier for materialized approved manual-work packet artifacts.

Runtime commit:

- `ab67931` (`feat: verify approved manual work packet artifact`).

Scope accepted:

- `poll --rollup --json --verify-manual-work-packet <path>` reads an existing parent-local artifact and validates it independently.
- Verification does not require approval receipt input, packet writing, `--force`, or any execution/apply surface.
- JSON output always includes top-level `manual_work_packet_artifact_validation` after `manual_work_packet` and before `repos`.
- Verdicts are `not_requested`, `missing`, `invalid`, `blocked`, and `pass`; only `pass` sets validation `ok=true`.
- Missing files at syntactically valid `.meta-harness/` paths return validation verdict `missing`.
- Invalid absolute/outside/child/empty/repeated paths are rejected at the command layer.
- Content checks validate artifact schema/kind/source, packet ID consistency, embedded ready verdict, wrapper safety fields, embedded packet safety fields, forbidden fields, path boundaries, and no-mutation behavior.
- Validation preserves top-level rollup `ok` and child readiness state.

Evidence:

- Focused verifier tests: PASS 15/15.
- Full Node test sweep: PASS 647/647.
- Sync check: PASS checked=30.
- Quality check: PASS with known public CLI command-count warning.
- Ready quick: PASS with 15 pass, 1 warn, 4 skip.

Non-goals:

- No new public command, generic write, README/package/dependency change, dashboard, daemon, approval persistence, decision recording, readiness refresh, child repo mutation, child command execution, patch application, queue file, task file, proposal file, export workflow, execution planning, or apply semantics.

Future boundary:

Phase 21E operator execution planning is closed under D063; bounded child writes remain Phase 21F or later only after 21E proves useful.

## D063: Close Phase 21E Read-Only Operator Execution Plan

Decision:

Accept Phase 21E as the read-only operator execution plan builder derived from the verified manual work packet artifact rather than live rollup states.

Runtime commit:

- `c89ba6b` (`feat: derive operator execution plan`).

Scope accepted:

- `poll --rollup --json --verify-manual-work-packet <path>` reads the artifact once, verifies it, and outputs the `operator_execution_plan`.
- The `operator_execution_plan` key is positioned between `manual_work_packet_artifact_validation` and `repos`.
- Safety boundary is maintained: `mutates=false` and all execution-related fields are absent.
- The plan copies the packet ID, target paths, source checks, and warning IDs from the verified artifact.
- Verdict is `ready_for_operator` only when validation passes and the packet is present.

Evidence:

- Dedicated test suite: `tests/poll-rollup-operator-execution-plan.test.js` PASS 15/15.
- All test suites (96 files): PASS.
- Sync check: PASS.
- Quality check: PASS.
- Readiness check: READY yes.


## D064: Phase 21F Canonical Operator Plan Artifact + Contract (fixes post-audit)

Status: closed under D064.

Decision:

Phase 21F is closed under D064. Phase 22A plan revised per audit (explicit resolution, no overclaimed staleness, redacted dirty, allowlisted git inspection, tightened verdicts, Slice 0 first). Implementation deferred until plan edits complete. Next safety work is Phase 22A.

The architecture, happy path, and verifier strictness are accepted. All blockers from prior audit addressed (packet ID consistency, mutates flag, forbidden execution surface, embedded validation shape, quality gate, file modes, markdown surface). Full quality baseline regeneration was performed and recorded.

Audit blockers addressed:
- ARTIFACT_PACKET_ID_MATCH_001 hardened (strict non-null string match required for both plan and manual validation).
- Added strict embedded manual_work_packet_artifact_validation checks (kind, source, safety all false, non-empty passing checks array).
- Added `mutates: false` to WRAPPER_SAFETY and buildOperatorExecutionPlanArtifact.
- Extended FORBIDDEN_FIELDS with execution, actions, command, write_plan_*, execute_plan, operator_commands.
- Added 5 negative tests (null/mismatch packet_id on validation, wrapper mutates true, execution object, forged minimal validation).
- Refactored poll.js (factored path readers) to bring under command_module budget (194 lines).
- Performed full quality baseline regeneration via `quality baseline --force` (explicit, required for contract-expanding test coverage while restoring passing gates); documented here.
- Fixed executable bits on new JS files (100644).
- Added minimal markdown rendering for `operator_execution_plan_artifact_validation` when present on rollup.

Quality/ready now pass (known CLI count WARN only).
Dedicated operator plan suite: PASS 24/24.
Related poll/rollup/registry suites: PASS 53/53.
Full npm test: PASS (96 test files, failed: 0, 71.4s) — final rerun completed successfully post-hardening.

Phase 21F closed under D064.

Runtime changes (slices):

- `lib/operator-execution-plan-artifact-io.js` (resolver, builder, writer)
- `lib/repo-rollup-operator-execution-plan-artifact-validation.js` (strict checks)
- `lib/commands/poll.js` + `lib/command-registry.js` (flags + wiring)
- Extended tests (24/24 in dedicated suite)

Scope accepted:

- `poll --rollup --json --verify-manual-work-packet <p> --write-operator-execution-plan <path>` (requires ready_for_operator verdict; relative under .meta-harness/ only; rejects child paths and generic --write).
- `poll --rollup --json --verify-operator-execution-plan <path>` surfaces `operator_execution_plan_artifact_validation` (pass only on exact canonical shape + ready plan + safety).
- Wrapper: kind="operator_execution_plan_artifact", source="poll_rollup_operator_execution_plan", embeds validation + plan, writes_parent true / all exec false.
- Embedded plan: all safety flags exactly false; no forbidden fields.
- No backward compat for alternate keys. No mutation of repos, no child commands, no readiness/decision changes.

Evidence:

- Dedicated operator plan suite: `tests/poll-rollup-operator-execution-plan.test.js` PASS 24/24 (includes write + verify + negative contract cases).
- Related poll/rollup/registry suites: PASS 53/53.
- Full npm test: PASS (96 test files, failed: 0, duration 71.4s) — final local rerun completed successfully.
- Manual E2E write/verify roundtrips produce and validate correct canonical artifact.
- Existing base behaviors + key ordering preserved.
- No side effects on parent/child state or rollup `ok`.
- Sync/quality/ready gates pass (known CLI count warning only).
- Full quality baseline regeneration (`quality baseline --force`) performed and recorded (required because this phase is contract-expanding; quality now passes cleanly except known warning).

Non-goals:

- No execution, apply, child writes, tasks, queues, decisions, or readiness refresh.
- No git HEAD / branch / dirty / digest binding (deferred to 22A).
- No changes to the live derived `operator_execution_plan` shape.

Future boundary:

Phase 21F is closed under D064. Next safety work is Phase 22A (Execution Readiness Contract + staleness) before any mutating operator execution.

## D065: Phase 22A-H Execution Readiness Gate Hardening (no 22B)

Status: closed under D065.

Decision:

Phase 22A is closed as a hard, fail-closed, read-only execution readiness gate under D065 (22A-H hardening). Do **not** proceed to 22B execution authority until a future audit explicitly opens it.

What was hardened:
- `lib/repo-git-state.js` owns allowlisted read-only git inspection; redacted dirty metadata only (count/staged/untracked — never paths).
- `buildExecutionReadiness` requires `operatorPlanArtifactValidation.ok === true` (callers cannot bypass 21F verification).
- On every `--verify-operator-execution-plan`, rollup **always** emits `execution_readiness` with an explicit verdict (no fail-by-omission).
- `selected_repo_resolution` when validation passes; readiness maps resolution failures to structured verdicts.
- Focused suite `tests/execution-readiness.test.js`; operator-plan suite restored under grandfathered size.
- Quality restored by extraction (dirty.js / poll.js budgets), not by baselining debt.

Worker rule (guidance; not execution authority):

```
Before touching child repo, re-run poll with --verify-operator-execution-plan.
Proceed only if ALL of:
  operator_execution_plan_artifact_validation.ok === true
  selected_repo_resolution.ok === true
  execution_readiness.verdict === "ready"
  execution_readiness.ok === true
  runs_read_only_git_inspection === true
  executes_child_commands === false
Anything else is blocked.
```

Evidence:
- `npm test` PASS (97 test files, failed: 0)
- `quality check` PASS (known public CLI command count WARN only)
- `ready --target . --quick --read-only --json` ok:true
- `sync check --target .` PASS
- `git diff --check` clean

Non-goals (still deferred):
- No 22B execution authority, child writes, patches, tasks, queues, decisions, or readiness mutation.
- No `mismatch_head` / `stale_repo` / `artifact_tampered` without expected bindings.

Future boundary:

22A-H closed under D065. Any child-repo work remains operator-driven. Next safety work is **22B Worker Gate Consumption Contract** (read-only preflight / machine checklist) — not execution authority. Execution remains unauthorized.

## D066: Phase 22B Worker Gate Consumption Contract (read-only; no execution)

Status: closed under D066.

Decision:

Phase 22B is closed as a pure **consumption** gate. On every `poll --rollup --verify-operator-execution-plan`, rollup **always** emits `worker_entry_gate` with verdict `open` or `blocked`. The gate consumes 21F plan-artifact validation, `selected_repo_resolution`, and 22A `execution_readiness` only — **no additional git inspection**, no child mutation, no execution authority.

Canonical runtime key:

- **`worker_entry_gate` only**
- **No** `operator_work_gate` alias, dual key, or compatibility surface

Open rule (strict conjunction):

1. `operator_execution_plan_artifact_validation.ok === true`
2. `selected_repo_resolution.ok === true`
3. `execution_readiness.verdict === "ready"`
4. `execution_readiness.ok === true`
5. `execution_readiness.runs_read_only_git_inspection === true`
6. `execution_readiness.executes_child_commands === false`

`ok === true` only when `verdict === "open"`. Gate-level safety flags are always false (`executes_child_commands: false`, no writes/tasks/queues).

Worker rule (guidance; still manual/operator-driven work only):

```
Before touching child repo, re-run poll with --verify-operator-execution-plan.
Proceed only if:
  worker_entry_gate.verdict === "open"
  worker_entry_gate.ok === true
Anything else is blocked.
open ≠ automated execution authority.
```

Evidence:

- `lib/worker-entry-gate.js` (build + attach + markdown)
- `tests/worker-entry-gate.test.js`
- poll attach after readiness; markdown after readiness
- roadmap 22B closed; 23A planned post-22B

Non-goals (still deferred):

- No execution authority, AO process, Codex run, child writes, patches, tasks, queues
- No router, DevSpace, Grok, subagents
- No 22C–22F as separate pre-execution phases (minimum controls absorbed later in 23A authorize/verify per approved sequencing plan)

Future boundary:

22B closed under D066. Phase 23A authority contracts closed under D068 (`be82763`). See `docs/product/phase-23a-execution-plan.md` and `docs/product/runtime-authority-architecture.md`.

Time-box failure (binding): if a future re-open of 22B cannot ship, fold **minimal** `worker_entry_gate` into 23A authorize; never authorize from a missing gate.

## D067: Phase 23A-PR1 Execution Contract Authority (SUPERSEDED by D068)

Status: **superseded by D068**. Local-only design at `fb40d18` on `archive/23a-pr1-d067-fb40d18`. Never merge as load-bearing.

Historical decision: draft/authorized `RunManifest` + provider-shaped `EvidenceBundle` + single READY including PR. Superseded because request was fused with permission, digests confused integrity with truth, impl verification was coupled to delivery, and a generic fake provider was sequenced before probing AO.

## D068: Phase 23A-PR1R Execution Authority Contracts (breaking)

Status: **closed under D068** (`be82763264503427a12af400e8413b10cdbf7363`).

Decision:

**Supersede D067.** Small pure authority kernel (not a governance platform):

| Object | Role |
|---|---|
| `RunSpec` | Immutable requested work (`run-spec/v1`); attempt-agnostic; no approval binding |
| `RunSpecApproval` | Exact approval envelope around a RunSpec (`run-spec-approval/v1`) |
| `ExecutionReadinessFacts` | Sealed readiness facts + freshness + workspace policy digest |
| `AttemptAuthorization` | One attempt’s prepare-workspace permission; policy-bound provider |
| `WorkspaceStartCheck` | Pre-start assessment (`START_ALLOWED` …); full semantic validity |
| `ImplementationAssessment` | Delivery-independent evaluation of **trusted** facts + `factsDigest` |

Bindings:

- Authorization accepts the complete `RunSpecApproval` object only (not plan hash, not digest-beside-spec).
- `authorizeAttempt(runSpecApproval, readinessFacts, request, { now, policy, priorReceipt })`.
- Request is exactly `{ authorizationId, attemptId }`; provider lives on trusted `policy`.
- Policy digests (`authorizationPolicyDigest`, `workspacePolicyDigest`) bind into receipt and idempotency.
- `authorizationRequestDigest` is a **receipt invariant**: recomputed from full explicit identity (`authorizationId`, `attemptId`, digests, `provider`, `capability`) on every sealed receipt validation — not only idempotency.
- Supplied `priorReceipt` with a mismatched `authorizationId` is `PRIOR_AUTHORIZATION_ID_MISMATCH` (never silent fresh issue).
- Workspace policy/attestation roots are host-native absolute normalized paths; cross-host path portability is not provided by v1.
- Public transitions strict-validate outer envelopes before property access and fail closed (no exception leak).
- Duplicate RunSpec command IDs are rejected at `validateRunSpec` (assessment keeps defense-in-depth).
- D064–D066 operator-plan / readiness / worker-entry gate are **not** authority inputs.
- Content digests are integrity only — not provenance.
- Valid-at-start expiry; later expiry does not erase completed work.
- No delivery assessor / MERGE_READY / user-facing state mapper in PR1R.

Roadmap after D068 (functional-first): D069 local controller walking slice → D070 AO substitution in the same slice → child-repo dogfood → full R1A from fixture + AO + dogfood imports/traces → delivery/recovery only from observed failures. **Not** R1A planning + standalone AO research first; **not** broad R1A before AO/dogfood.

Evidence: squash `be82763264503427a12af400e8413b10cdbf7363` (PR #23; reviewed head `4b259c9`; pre-merge base `f926868`; tree-object equality PASS; ancestry PASS); `lib/contracts/*`; `tests/contracts-authority-*.test.js`; `tests/contracts-d068-truth.test.js`; `docs/product/runtime-authority-architecture.md`. Pre-merge independent verification at `ed9aecd` / `4b259c9`; required PR checks PASS on reviewed head.

## D069: Phase 23A-PR2 Local Controller Walking Slice

Status: **closed under D069** (`e8e7713cc99b58faad1a2aaa0ecaf836e4e25958`).

Decision:

Accept D069 as a **private fixed-fixture sequential walking slice** proving sealed authorization, controller-owned implementation, meaningful validation, durable exact-ref custody, verified cleanup, and integrity-checked terminal duplicate replay.

Scope accepted:

- Private runtime under `internal/d069/*` (not packaged; no public `meta-harness run`).
- Locked provider `meta-harness-local-fixture` / `d069-fixed-fixture-v1`.
- Real Git readiness → authorize → worktree → attestation → `START_ALLOWED` → atomic journal claim → fixture worker → controller commit → exact validation → `IMPLEMENTATION_VERIFIED`.
- Create-only durable ref `refs/meta-harness/attempts/<authHex>`.
- Stored receipt/claim/journal/assessment integrity revalidated on replay; assessment and durable ref bound to current request.
- Disposition results include `terminal` and `restart`.
- Windows host-path identity (realpath.native, 8.3 short-name / long-name equivalence) for worktree top-level and cleanup registration.
- Quality exception limited to `internal/d069`.
- Pre-existing durable ref path publishes terminal `controller_failed` journal.

Honest limits (do **not** claim):

- Real asynchronous overlap or multi-process claim races.
- Distinct-request serialization under concurrency.
- AO-owned execution.
- Broad repository compatibility beyond the fixed fixture.
- Failure-journal storage failure survival (ordinary post-claim failures terminalize when journal publication remains available; journal storage failure itself is not claimed as survived).

`CLAIMED_INCOMPLETE` and `ALREADY_CLAIMED` may remain implemented dispositions but are not empirical D069 concurrency evidence.

Roadmap after D069 (functional-first): D070-A0 AO capability probe → D070-A1 one verified AO path → same-request / distinct-request overlap → cancel/timeout → observed cleanup ownership → child-repo dogfood → full R1A → delivery/recovery only from observed need.

Evidence: squash `e8e7713cc99b58faad1a2aaa0ecaf836e4e25958` (PR #24; reviewed head `245fa3ddf2f860af5b512ba457221820375a03af`; pre-merge base `5afe075f065e74122149af1913de128f9c2ad17d`; feature tree `5c16edf0223d563a9e84b4099d0fe57ad73d55ce` == landed tree; ancestry PASS); required checks on exact reviewed head PASS (Node tests, D069 Windows integration, Semgrep); `internal/d069/*`; `tests/runtime-d069-*.test.js`.

## D070: AO Seam Decision — Reject Worker Write, Adopt Controller Materialization

Status: **A0 decided; A1 transport/custody closed under audit-hardening commit `8ebe690`**.

Decision:

Reject the direct Codex filesystem-write seam on the current Windows host and adopt a controller-materialized artifact seam. **D070-A1 closes transport and custody on that seam; it does not yet prove meaningful child-repository work.**

Observed A0 results:

- A0.1 sanitized authentication and invocation succeeded: ChatGPT login status was valid, Codex CLI `0.144.1` returned parseable JSONL, exited cleanly when stdin was closed, and did not move HEAD, refs, staging, or local Git config.
- `--sandbox workspace-write` remained effectively read-only. The safe managed `:workspace` profile never produced a bounded write. No sandbox bypass is authorized.
- A0.2 succeeded under `:read-only`: schema-bound artifact `{ path, content }` with controller materialization producing unstaged `M src/fixture.txt` only.

A1 closed seam:

```text
sealed authorization
→ detached worktree + START_ALLOWED + claim
→ async authenticated Codex :read-only process
  (bound node + launcher sha + native sha + observed version; allowlisted env;
   stdio ignore/pipe/pipe; 120s process-tree timeout + reap)
→ parse terminal JSONL (turn.completed; exact agent_message JSON object)
→ post-AO clean custody gate (HEAD/base, clean incl. ignored, refs, config, worktrees)
→ validate artifact keys; path == single-literal scope.allow; bounded content
→ controller materializes exact bytes (no mkdir, no git by AO)
→ controller stages/commits
→ validation program exact-byte check (not RunSpec-sealed content)
→ IMPLEMENTATION_VERIFIED
→ create-only durable ref
→ terminal journal binding AO metadata/artifact/schema SHA-256
→ integrity-checked replay
```

Authority honesty:

- RunSpec does **not** seal expected file bytes. Path comes from exactly one literal `scope.allow` entry with empty `deny` and no globs.
- Content is a bounded non-empty non-NUL string; semantic exact bytes are enforced by the validation program (`text === "d070-ao-verified-marker\n"` for A1).
- Final Git facts, patch digest, and validation bind the accepted implementation back to RunSpec.

Constraints accepted in A1:

- One request, one Codex process, one AO timeout (120s), one terminal result; validation timeout remains 60s.
- Process-tree termination on timeout/output-cap; not a cancellation framework.
- Persist AO metadata (hashes, counts, event types, validated `change-artifact.json`) — **not** raw stdout/stderr by default. Terminal replay requires intact SHA-256 bindings for AO metadata, validated artifact, and schema.
- Operator-owned `CODEX_HOME` boundary only; no credential copy; no full home content inspection.
- Provider `meta-harness-ao-codex` / `d070-ao-artifact-v1`. Fixture worker deleted; no dual production path.
- `internal/d069` directory name retained only as temporary lineage debt until post-dogfood R1A.
- No provider abstraction, public run CLI, delivery, or recovery in A1.

Audit correction after A1 implementation:

- The first implementation self-labelled the configured version instead of observing it. The controller now executes the bound launcher with `--version` at construction and immediately before AO spawn; false labels fail closed.
- The first terminal replay validated assessment/ref state but did not durably bind AO provenance artifacts. The terminal journal now binds SHA-256 for `ao-process-meta.json`, `change-artifact.json`, and `change-artifact.schema.json`; missing or changed evidence blocks replay.
- Full repository suite and authenticated live sequential+replay remain green after both corrections. Live evidence now distinguishes a clean implementation commit from a dirty-tree probe: dirty runs record `headCommit` plus `trackedDiffSha256` and leave `implementationCommit=null`.

Roadmap after A1 originally placed R1A immediately after D071. The D071 post-close audit inserts D072 persistent child-result custody before R1A because the functional run deleted its child object/ref and terminal evidence during cleanup. Concurrency/cancellation remains only from observed need. Product re-charter is no longer deferred.

Evidence: audit-hardening commit `8ebe690a6b434bd2ef4b711909c6514d15f9a44c`; offline artifact + full-chain sequential/replay + process-tree + AO-evidence tamper tests; clean-tree live authenticated sequential+replay pass on that exact implementation commit (observed Codex `0.144.1`); local live evidence under `.meta-harness/local/d070-a1-live-pass.json`; 112/112 repository test files PASS on Node `v25.2.1`; sync, quality-ratchet, and quick-readiness gates PASS. The two over-budget touched test modules were split without a baseline refresh.

## D071: Re-charter and Meaningful Single-File Child Dogfood

Status: **functional execution PASS under `74f8ac17e66aafb86546227ec8ec93f1f48f6f17`; terminal custody closure superseded by D072 audit**.

Decision:

Re-charter Meta-Harness now as a local authority-bound agent execution-custody harness. The original Markdown-first, no-agent-launch, no-network MVP remains historical shipped scope, but it is no longer the governing product direction. This is an intentional major deviation, recorded before further execution work.

D071 combined functionalization with dogfood. Target selection was binding and executed:

- Quant rejected (active truth freezes unrelated runtime/governance work).
- Isolated detached local clone of ToolLauncher `7fab419f20ba5c7a4008d6a6071d5aad10ba534c` (tree `6bd348cd…`); not a worktree of the dirty live checkout.
- Scope exactly `scripts/utils/CheckShortcut.ps1`.
- Sealed `RunSpec.objective` → objective-derived AO prompt (JSON-encoded objective; no marker path).
- Authenticated Codex `:read-only` artifact → controller materialize/commit.
- Exact Windows PowerShell 5.1 host (`C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe`) + hashed parent-local `internal/d069/programs/validate-toollauncher-shortcut.ps1` proving **missing + valid + corrupt** branches.
- Validation env allowlist matches supplied vars exactly: `APPDATA`, `ComSpec`, `SystemRoot`, `TEMP`, `TMP`, `WINDIR`. `networkPolicy: denied` is trust-based (no network ops in the hashed validator), not OS firewall isolation.
- Live `IMPLEMENTATION_VERIFIED` + replay (`aoSpawnCount=1`); marker prompt/validator deleted; no compatibility mode.

```text
clean ToolLauncher child snapshot
→ sealed RunSpec objective as AO task intent
→ one literal scope.allow path
→ authenticated Codex :read-only artifact
→ controller materialization/commit
→ exact PowerShell JSON validation (missing+valid+corrupt)
→ IMPLEMENTATION_VERIFIED
→ durable ref + replay
```

Historical execution evidence: `docs/ops/audits/d071-toollauncher-dogfood-evidence.json` (claimed verified child head `9f41bbbb…`, attempt ref, Codex `0.144.1`). Offline command was recorded in that envelope. `lib/contracts/*` remained frozen.

Post-close audit correction:

- The live test created the ToolLauncher clone and controller state below temporary roots and deleted both in `finally`.
- After cleanup, child commit `9f41bbbb28d89301223292bc5aea11039fba47bb` and the claimed `refs/meta-harness/attempts/...` ref are absent from the ToolLauncher and Meta-Harness object stores.
- `ao-process-meta.json`, `change-artifact.json`, schema, terminal journal, assessment, and receipt were also deleted. The tracked envelope retains their hash strings but not the hashed evidence, so those values cannot be independently recomputed.
- The local live envelope recorded `authorizationReceiptDigest=null`; the tracked envelope substituted `authorizationRequestDigest`, which is a different authority object.
- The PowerShell validator proves explicit missing, valid, and corrupt paths, but always supplies `-StartupPath`; it does not prove the parameter is optional or that the default startup path branch works.
- Therefore D071 proves meaningful objective-driven functional execution, but not terminal durable result custody. Audit record: `docs/ops/audits/d071-post-close-custody-audit.json`.

Next: D072 persistent child-result custody. R1A is blocked until D072 retains and replays the child result after all transient roots are deleted. Concurrency remains deferred because no concurrency need was observed.

## D072: Persistent Child Result Custody

Status: **approved for implementation with binding amendments**.

Decision:

Repair the observed D071 custody failure before deleting private runtime lineage. D072 stays private and single-repository, with no compatibility path, provider registry, concurrency framework, public execution surface, delivery actor, or kernel expansion. Functional correction comes first; export and closure evidence follow only after graceful fresh-process custody replay is proven.

Required control flow:

```text
validate request shape
→ validate RunSpecApproval
→ validate trusted repository identity and policy shape
→ look up the canonical receipt at state/authorizations/auth-<sha256 authorizationId>.json
```

When a stored receipt exists:

```text
validate receipt seal and authorizationId
→ verify attemptId, approvalDigest, runSpecDigest, authorization/workspace-policy digests, logical provider, and capability
→ locate the attempt by the receipt's original authorizationRequestDigest
→ classify stored state before any execution-tool binding, readiness collection, or authorization issuance
```

A fully verified terminal state replays. A receipt without attempt state, claim without journal, invalid terminal manifest, conflicting receipt/request, or expired incomplete receipt fails closed. A nonterminal journal returns its stored incomplete/claimed state without reauthorization. A stored terminal failure returns that same failure. No replacement authorization identity may be issued while any canonical stored receipt exists.

Only when no stored receipt exists may the controller lazily bind Codex and the validator, compare the exact trusted validation command, collect readiness, authorize, and execute.

Minimum module ownership:

- `custody-replay.js`: canonical receipt lookup, stored binding validation, and terminal-state classification.
- `execution-bindings.js`: lazy binding of the fixed Codex and validator executables for genuinely new attempts only.
- `terminal-evidence.js`: immutable terminal evidence preparation, verification, publication, and replay validation.
- `custody-export.js`: thin Git bundle, portable manifest, privacy review, and independent verification inputs.
- `run-attempt.js`: orchestration only; it must not absorb another complete custody state machine.

Terminal publication protocol:

```text
mutable journal.current.json during execution
→ prepare exact terminal evidence in a unique staging directory
→ verify every file, digest, and cross-binding
→ create the durable Git result ref
→ publish the evidence directory with no-replace semantics
→ write custody-manifest.json last with no-replace semantics
```

The terminal manifest is the completion commit point. Replay recognizes only a valid no-replace terminal manifest plus the matching durable Git ref. The canonical receipt index remains authoritative. A byte-identical receipt copy may be retained in attempt evidence for portability, but replay must prove byte or digest equality with the indexed canonical receipt and must reject divergence.

Retained local layout:

```text
.meta-harness/local/custody/
  d072-toollauncher-<implementation-short>-<authorization-id-hash>/
    repository/
    state/
      authorizations/
        auth-<authorization-id-hash>.json
      attempts/
        <authorization-request-digest>/
          claim.json
          journal.current.json
          evidence/
            run-spec-approval.json
            authorization-request.json
            readiness.json
            authorization-receipt.json
            workspace-attestation.json
            start-check.json
            ao-process-meta.json
            change-artifact.json
            change-artifact.schema.json
            implementation-facts.json
            implementation-assessment.json
            terminal-journal.json
            custody-manifest.json
    workspaces/
    exports/
```

The custody root is unique and create-only for one immutable implementation commit and authorization identity. Live cleanup may prune only managed attempt worktrees beneath `workspaces/`; it must not remove or overwrite `repository/`, `state/`, or `exports/`.

Binding acceptance:

- Controller construction may eagerly bind repository path/ID, state/workspace roots, authorization policy, Git executable and isolated Git home, controller ownership, and logical provider/profile. It must not resolve, hash, read, or version-probe Codex or PowerShell until a genuinely new attempt has been selected.
- Terminal replay must succeed with syntactically valid configuration objects containing absolute nonexistent execution-tool paths. Any attempted access to those paths fails the canary test.
- Both `VERIFIED` and `REPLAY` results expose `authorizationRequestDigest`, `authorizationReceiptDigest`, `runSpecDigest`, `verifiedHeadRevision`, `durableRef`, and `terminalManifestDigest`.
- Replay creates no readiness facts, no new receipt, no replacement attempt directory, no attempt worktree, and no AO or validation process.
- A verified terminal attempt replays after receipt expiry and after Codex or validator drift/removal. With no stored attempt, changed or missing execution-tool identity fails before AO spawn.
- At least one closure test is process-level: process 1 executes and exits; process 2 starts from retained repository/state and replays with tool canaries and AO count zero. Two controller instances in one process are useful but insufficient for closure.
- The exact local custody retains sealed source bytes sufficient for fresh-controller replay and local hash recomputation. Host-specific absolute paths may remain only in this ignored local custody.
- The portable tracked audit pack contains a thin bundle, canonical manifest, privacy-reviewed or redacted projections, source-object hashes, exported-object hashes, and no credentials, environment values, raw AO streams, or unnecessary absolute paths. A pre-push leakage scan is a closure gate.
- The thin bundle contains the verified result ref and declares pinned ToolLauncher base `7fab419f20ba5c7a4008d6a6071d5aad10ba534c` as a prerequisite. It does not contain the base object. Independent verification begins in a repository that already has that exact base, runs `git bundle verify`, confirms the prerequisite, fetches the result ref, resolves the result commit, and verifies its parent equals the pinned base.
- No third party recomputability claim may be made for an exact local source-object hash unless the corresponding exact bytes are included in the tracked audit pack.
- The fourth PowerShell branch creates a temporary `APPDATA`, sets it only in the child `ProcessStartInfo.EnvironmentVariables["APPDATA"]`, omits `-StartupPath`, derives the expected default beneath that temporary root, asserts `startup_path` equals the derived path, proves the operator's real `APPDATA` and Startup directory are untouched, and removes the temporary tree in `finally`.
- `lib/contracts/*` remains frozen through D072 closure.
- D072 closes mechanically when one immutable implementation commit produces live `VERIFIED`, graceful fresh-process `REPLAY`, and an independently verified portable export. Human review is required only if authority, public API, or ambiguous security evidence changes.
- After D072, REPLACE delivers one real second child through the active bounded-repository-change skill, one sealed host-neutral validation-command capsule, one thin private adapter, and the sole production runtime root. Host environment values remain local execution bindings and are excluded from sealed request data.
- REPLACE also migrates retained custody tests to a platform-neutral validator fixture and deletes ToolLauncher, PowerShell, CheckShortcut.ps1, the temporary Windows test classifier, phase-numbered runtime identity, `internal/d069` production imports, and the former execution path. No transition pair or compatibility bridge may remain.
- PROVE adds a third child through one new example under the existing bounded-repository-change skill and one end-to-end test, plus a deterministic child fixture only when necessary. The generic `SKILL.md`, runtime, kernel, CLI, roadmap, and architecture truth remain unchanged.
- DELETE then preserves supported user jobs rather than repository import callers. The intended minimum surface is `init`, `record`, `status`, `check`, `sync`, and `release check` only while release remains an active supported job. No aliases, deprecated dispatch, or old output schemas survive.

PROVE precedes broad public-surface deletion so the reusable skills-first seam is demonstrated before another control-plane cleanup round.

Historical implementation order:

1. Close D072 against one immutable implementation commit with truthful cross-platform test classification, live `VERIFIED`, graceful fresh-process `REPLAY`, and independent export verification.
2. REPLACE: deliver the heterogeneous child and delete the former production path in the same change.
3. PROVE: add the third child through existing-skill example and test only; zero workflow, runtime, kernel, CLI, or product-truth edits.
4. DELETE: remove every surface without a current supported user job or unique safety invariant; net active surface must decrease.

This ordering is superseded by D073 after the exact-commit live audit. D072's custody invariants remain binding substrate; only the ToolLauncher-specific closure procedure and the separate pre-REPLACE gate are superseded.

## D073: Functional Custody Replacement Slice

Status: **closed under `87de018`**.

Decision:

Pull REPLACE forward and absorb D072 closure into the replacement functional slice. Do not run another ToolLauncher prompt-only repair round. Candidate `5d677a894ec25e5c48cd5f0bf15e59f3bf0b5db3` passed native Windows Node `v25.2.1` `npm test` across 116 files with zero failures, then its retained create-only live root spawned AO once, received an exit-0 schema artifact, and failed trusted validation before terminal publication because the generated PowerShell script treated omitted `-StartupPath` as an empty string rather than deriving the child-only `APPDATA` default. Audit: `docs/ops/audits/d072-exact-commit-live-gate-audit.json`.

The failure is functional-contract failure, not a terminal-custody failure. It neither closes nor disproves receipt-first replay, lazy tool binding, manifest-last publication, fail-closed conflict handling, fresh-process tool-canary replay, or portable prerequisite-bundle verification. It does prove that the D072 live gate combines three independent variables: model artifact quality, ToolLauncher/Windows PowerShell semantics, and custody. A deterministic green suite proves the controller against known-good bytes; it cannot certify a particular live model artifact.

Forward rule:

- Preserve `5d677a8` and its failed create-only custody root as immutable evidence. Do not amend or reuse either identity.
- Select one real non-ToolLauncher child with an existing host-neutral test command and one useful single-file objective.
- Create the active bounded-repository-change skill, one sealed host-neutral validation-command capsule, one thin private child adapter, and the sole production custody runtime.
- Migrate the D072 custody substrate without weakening receipt-first lookup, lazy execution-tool binding, terminal-manifest commit point, no-replace evidence publication, fail-closed incomplete/conflicting state handling, fresh-process replay, portable export, and leakage controls.
- Require one exact implementation commit to produce live AO count one and `VERIFIED`; after normal controller close and process exit, require a second process with unusable execution-tool paths to produce `REPLAY` and AO count zero; require independent portable verification and leakage scan.
- In the same change, delete ToolLauncher, Windows PowerShell, CheckShortcut.ps1, the temporary Windows test classifier, phase-numbered production runtime identity, all production imports from `internal/d069`, and the former execution path. Historical audits may remain. No compatibility adapter, dual runtime, alias, or transition pair may remain.
- Keep `lib/contracts/*` frozen unless the host-neutral slice proves a concrete authority-contract defect. A preference or naming cleanup is not sufficient.

D073 decision-time order, now superseded by the post-close forward audit:

1. **D073 REPLACE+CLOSE:** host-neutral real child, sole runtime, live VERIFIED → normal exit → fresh-process zero-spawn REPLAY → independent portable verification; delete the former path in the same change.
2. **D074 PROVE:** originally constrained to one example and one test with no helper changes.
3. **DELETE:** originally placed before the public-surface decision.
4. **DECIDE:** originally deferred until repeated real operator use.

The D073 post-close forward audit below replaces steps 2–4 with D074 cross-ecosystem proof → D075 private operator use → DECIDE → DELETE.

Current score after the exact-commit audit:

- overall product flow: **7.4/10**
- meaningful functional execution: **8.0/10**
- Phase 23A execution custody: **7.6/10**
- trusted runtime custody implementation: **7.8/10**
- live closure evidence: **4.8/10**
- AO verified integration: **8.7/10**
- durable child-result custody: **6.8/10**
- graceful terminal replay: **7.2/10**
- independently portable evidence: **7.0/10**
- reusable multi-child core: **2.5/10**
- CI/test truth integrity: **5.9/10**
- engineering health: **8.0/10**
- roadmap honesty after this decision: **9.8/10**
- continuity with original MVP: **3.8/10**
- alignment with re-chartered direction: **8.4/10**

Deviation statement:

The product remains a major, deliberate deviation from the original Markdown-first MVP: it now launches an authenticated agent, uses network/model access, authorizes controller-owned mutation, validates the result, and retains Git/evidence custody. D073 is also an aggressive deviation from the immediately prior roadmap: REPLACE no longer waits for a ToolLauncher-specific D072 closure. The deviation is explicit and forward-moving because the old gate optimizes a path scheduled for deletion and obscures the reusable custody property that actually needs closure.

### D073 closure record

D073 closed under exact implementation candidate `87de018b06cb788eedbc8d3cf9e0737989702471` / tree `1ecfc71dc28f67e62832aa594d4efe7a5c4548f1`. Native Windows Node `v25.2.1` `npm test` passed 111 files with zero failures. Against pinned Fluxara base `8548fe5460511c86ed312284b3712e17622134d2`, live process 1 spawned the authenticated agent exactly once and reached `VERIFIED` at child commit `2f2e6156b5b89726e4047a1118e2aebac5c55f27`. After normal process exit, process 2 used unusable execution-tool paths and returned `REPLAY` with zero spawns. The portable prerequisite bundle independently reconstructed the child result, proved exact parent and single-path scope, reran both validation commands successfully, and passed leakage scanning across 16 files. Audit: `docs/ops/audits/d073-functional-custody-replacement-audit.json`.

The active production runtime is now solely `internal/execution-custody`. ToolLauncher, Windows PowerShell, CheckShortcut, the Windows runtime classifier, phase-numbered production identity, production imports from `internal/d069`, and the former execution path are deleted. No compatibility adapter, dual runtime, public execution CLI, provider registry, or speculative concurrency framework was added. Failed candidate roots for `1fa3e0e`, `b61109a`, and `f31b443` remain retained and were not reused.

D074 is next, with binding amendments from the post-close forward audit below.

### D073 post-close forward audit

Audit: `docs/ops/audits/d073-post-close-forward-audit.json`.

Verdict: **D073 remains closed; D074 is amended.** The exact D073 closure evidence is valid, but two forward proof gaps are now explicit:

- The production runtime is example-driven and phase-neutral, while the shared live integration harness still hardcodes Fluxara, Python package probing, D073 environment names, and Fluxara custody-root identity.
- Both the generic replacement test and the live Fluxara test pass the same clock to process 1 and process 2. The old D072 later-than-expiry replay test was deleted and not replaced. `internal/execution-custody/attempt.js` still classifies a valid terminal verified journal before authorization-window handling for nonterminal attempts, so this is an evidence regression rather than an observed runtime failure.

D074 decision: **Cross-Ecosystem Reuse Proof**.

Binding target:

- Recommended child: DevSpace.
- Source checkout: `E:\Code\devspace\devspace-src`.
- Pinned commit: `00952c05f01248773a90cd293aed528672eb6f1b`.
- Pinned tree: `65e249664f7146e7bff6c36d530f3de1cd0068e4`.
- Allowed path: `scripts/dev-server.mjs`.
- Validation executable family: symbolic `node`, locally bound to the trusted Node executable.
- Objective: make the development server launcher import-safe and network-safe; export a pure command builder whose `npx` arguments contain `--no-install` before `tsx`, use that builder for the child spawn, and start watchers/processes only when the module is invoked as the entry point, while preserving restart, crash-delay, and shutdown behavior.

Implementation boundary:

- Add one new skill example and one real-child end-to-end test.
- Permit the minimum test-only helper parameterization required to remove Fluxara/Python/D073 hardcoding.
- Replace phase-specific live-test environment names with phase-neutral names; do not preserve aliases.
- Do not copy-paste a second child-specific live harness.
- Keep `.agents/skills/bounded-repository-change/SKILL.md`, `internal/execution-custody/*`, `lib/contracts/*`, and the public CLI byte-identical unless the proof demonstrates a concrete defect. A preference, naming cleanup, or convenience abstraction is insufficient.
- Do not choose another Python child merely to avoid proving a second validation executable family.
- The dirty DevSpace operator checkout is not authority input. Clone only pinned commit objects into an independent no-hardlink detached repository and verify exact revision, tree, and clean status before authorization.

D074 acceptance:

1. One immutable clean Meta-Harness candidate passes the exact native complete suite.
2. Process 1 performs one authenticated-agent spawn and reaches `VERIFIED`.
3. Process 1 closes normally and exits.
4. Process 2 uses a clock later than authorization expiry plus unusable agent and validation paths, returns `REPLAY`, and reports zero spawns.
5. Portable export independently reconstructs the result, proves exact parent/single-path/content equality, reruns both Node validation commands, and passes leakage scanning.
6. The primary DevSpace child checkout remains clean at the pinned base.
7. No production runtime, skill, kernel, CLI, compatibility, provider, delivery, concurrency, or dual-path expansion occurs unless a concrete defect forces a new immutable candidate.

Roadmap shift after D074:

Insert **D075 OPERATE** before DELETE. D073 and D074 are real child executions, but the execution-custody product remains reachable only through test-oriented plumbing. Broad deletion before replacement operator usability would remove the historical Markdown product before its successor can be used. D075 must use the proven example contract through one minimal private operator seam for repeated real changes and record actual friction. It is not a public CLI and does not authorize compatibility, provider abstraction, delivery, concurrency, recovery, or workflow frameworks. After repeated D075 use, DECIDE one stable public surface; only then perform consumer-led DELETE.

Post-D073 scores:

- overall product flow: **8.2/10**
- meaningful functional execution: **8.8/10**
- Phase 23A execution custody: **8.8/10**
- trusted runtime custody implementation: **8.7/10**
- live closure evidence: **8.4/10**
- AO verified integration: **9.0/10**
- durable child-result custody: **8.9/10**
- graceful terminal replay: **8.2/10**
- independently portable evidence: **8.6/10**
- reusable multi-child core: **5.8/10**
- CI/test truth integrity: **7.4/10**
- engineering health: **8.5/10**
- roadmap honesty: **9.6/10**
- continuity with original MVP: **3.5/10**
- alignment with re-chartered direction: **9.2/10**

Deviation statement:

The deviation from the original Markdown-first, no-agent, no-network MVP remains major and deliberate. The product now launches an authenticated networked agent, authorizes controller-owned mutation, commits and validates child changes, retains terminal Git/evidence custody, and replays results. The additional roadmap deviation is also explicit: D074 is no longer a literal one-example/one-test ceremony, because test-only parameterization and later-than-expiry proof are necessary to demonstrate reuse honestly; D075 OPERATE now precedes DELETE because replacement usability must come before removal of the shipped historical product. No compatibility is authorized.

### D074 pre-candidate functional-slice audit

Audit: `docs/ops/audits/d074-pre-candidate-functional-slice-audit.json`.

Verdict: **implementation audit accepted; D074 remains open pending one immutable candidate and retained authenticated DevSpace closure evidence.**

Accepted implementation:

- `.agents/skills/bounded-repository-change/examples/devspace-dev-server.json` binds DevSpace commit `00952c05f01248773a90cd293aed528672eb6f1b`, tree `65e249664f7146e7bff6c36d530f3de1cd0068e4`, and only `scripts/dev-server.mjs`.
- The Node objective makes the launcher import-safe and prevents implicit `npx` package installation through exact `npx --no-install tsx src/cli.ts serve` output.
- `tests/helpers/execution-custody-live.js` is one phase-neutral live workflow used by both Fluxara and DevSpace. It contains no Fluxara, Python, or D073 identity. Python dependency discovery remains only in the Fluxara test edge.
- Process 2 derives its clock from retained `authorization-receipt.json`, advances 60 seconds beyond `expiresAt`, binds unusable agent and validator paths, and requires terminal `REPLAY` with zero spawns.
- Child authority starts from an empty Git repository and performs one exact `--depth=1` fetch of the pinned commit. Focused proof requires exact commit/tree, one visible revision, matching shallow boundary, and no remote; dirty operator working-tree bytes are never copied.
- The DevSpace live test reuses the shared workflow and is classified serially; no second custody workflow, public CLI, provider registry, production adapter, package dependency, or lockfile change was added.

Audit correction:

The initial Node capsule proved syntax, import safety, signal-listener stability, and the exact command, but it could have accepted a minimal module that exported the command while deleting the actual development-server lifecycle. That would have produced a false `IMPLEMENTATION_VERIFIED`. The audit strengthened the sealed semantic validator to bind preservation landmarks for restart delay, crash restart, restart timer, SIGTERM/SIGKILL fallback, recursive watcher behavior, shutdown, signal registration, watch registration, and startup logging. A representative known-good import-safe implementation passes the strengthened capsule. Do not weaken these checks to improve model pass rate.

Verification:

- DevSpace pinned commit and tree: PASS.
- Exact shallow authority clone: PASS; one revision, exact shallow boundary, no remote.
- Generic expired terminal replay with unusable tools and zero spawns: PASS.
- Focused native execution-custody set: 9 passed, 2 authenticated live gates deliberately skipped, 0 failed.
- D074 truth contract: 7/7 PASS before this audit-truth update.
- Final audit-aligned native Windows Node `v25.2.1` `npm test`: 112 files, 0 failures, exit 0, 256.8 seconds. The earlier implementation-only run also passed 112/112 in 210.0 seconds.
- Audit/example JSON and events JSONL parse; `git diff --check` passes.
- `.agents/skills/bounded-repository-change/SKILL.md`, `internal/execution-custody/*`, `lib/contracts/*`, CLI, `package.json`, and lockfile are byte-identical to HEAD.
- Authenticated Fluxara and DevSpace live gates remain deliberately unrun because the Meta-Harness worktree is not a clean immutable candidate.

Exact next gate:

1. Create one implementation candidate commit containing the accepted D073 truth alignment plus D074 example/test slice and no unrelated paths. Do not amend it.
2. Confirm a clean tracked tree and run literal native `npm test`; require all 112 files, zero failures, exit 0, and no mutation.
3. Run only `tests/runtime-execution-custody-devspace-live.test.js` with `CUSTODY_LIVE_DEVSPACE=1`; leave `CUSTODY_LIVE` and `CUSTODY_LIVE_FLUXARA` unset.
4. Require exact shallow authority, process-1 exit 0 and one authenticated spawn to `VERIFIED`, normal close and exit, process 2 after receipt expiry with unusable tools to `REPLAY` and zero spawns, independent Node validation, leakage PASS, and clean pinned-base primary clone.
5. Retain the custody root and publish closure truth in a separate commit. If the gate fails, preserve the root and create a new immutable candidate. No rerun of the same candidate, amend, compatibility, validator weakening, production-runtime edit, or Fluxara substitution.

Post-implementation scores:

- overall product flow: **8.4/10**
- meaningful functional execution: **8.8/10**
- Phase 23A execution custody: **8.9/10**
- trusted runtime custody implementation: **8.7/10**
- live closure evidence: **8.4/10**
- AO verified integration: **9.0/10**
- durable child-result custody: **8.9/10**
- graceful terminal replay: **8.8/10**
- independently portable evidence: **8.6/10**
- reusable multi-child core: **7.4/10**
- CI/test truth integrity: **8.2/10**
- engineering health: **8.7/10**
- roadmap honesty: **9.7/10**
- continuity with original MVP: **3.4/10**
- alignment with re-chartered direction: **9.4/10**

Intent statement:

No new product-direction deviation is required beyond the already explicit re-charter and D075-before-DELETE shift. D074 implements the approved cross-ecosystem proof without expanding production or public surface. The only audit-driven deviation inside the slice is stricter semantic validation than originally supplied; it is explicit and necessary to prevent false functional closure. D074 is not closed from skipped live tests.

### D074 first immutable candidate live-failure audit

Audit: `docs/ops/audits/d074-candidate-87472e1-live-failure-audit.json`.

Verdict: **candidate `87472e1` remains immutable and failed; a bounded test-verifier repair is authorized; D074 remains open.**

Observed candidate evidence:

- Candidate commit `87472e187a8d228bbf0a5b51167bb5969aa4dfb5`, tree `7a447d810905f1ff28b6bf676c602f8b4d3c1cc8`, contains exactly the accepted 17 paths and was not amended.
- Native Windows Node `v25.2.1` literal `npm test` passed 112 files, zero failures, exit 0; runner duration 191.0 seconds.
- The one authorized live attempt set only `CUSTODY_LIVE_DEVSPACE=1`; both generic and Fluxara live flags were unset.
- Exact shallow authority remained at DevSpace commit `00952c05f01248773a90cd293aed528672eb6f1b`, tree `65e249664f7146e7bff6c36d530f3de1cd0068e4`, one visible revision, matching shallow boundary, no remote, clean primary clone.
- Process 1 spawned the authenticated agent once and exited cleanly. Terminal custody is `verified` / `IMPLEMENTATION_VERIFIED` at child commit `b821c48548a0ce7faeb1ccbdb97c85af0b44a270`; the durable create-only ref targets that commit, whose parent is the exact pinned base and whose only changed path is `scripts/dev-server.mjs`.
- Process 2 used clock `2026-07-14T12:29:22.121Z`, exactly 60 seconds after retained receipt expiry, and unusable agent/validator paths. The shared workflow reached export only after asserting `REPLAY`, zero process-2 spawns, and unchanged terminal identity.
- Portable export manifest digest is `sha256:e19392949e88367145b300393988fdfe37d4ffef13d3b25113fbca620f865d95`; leakage scanning passed across 16 files.

Failure and correction:

The end-to-end test exited 1 only inside `tests/helpers/execution-custody-export-verifier.js`. The verifier fetched the exact prerequisite commit from the shallow authority source and proved the object existed, but left the commit reachable only through `FETCH_HEAD`. `git bundle verify` therefore reported that the prerequisite object existed but was disconnected from repository history.

A direct diagnostic against the retained bundle reproduced exit 1 before a local base ref and exit 0 after:

`git update-ref refs/verify/base 00952c05f01248773a90cd293aed528672eb6f1b`

The bounded repair:

- anchors the fetched prerequisite at `refs/verify/base` and verifies exact ref equality;
- adds one deterministic regression using a real shallow source and prerequisite thin bundle;
- changes no production runtime, example, validator, agent prompt, package, lockfile, contract kernel, CLI, or public surface.

Repair proof before a new candidate:

- Focused DevSpace test file: pinned shallow clone PASS; new shallow thin-bundle regression PASS; authenticated gate skipped; zero failures.
- The repaired independent verifier consumed the exact retained failed-candidate export without rerunning the agent or controller and returned exact child/parent equality, one changed path, both Node validation commands exit 0, and leakage PASS.
- Final audit-aligned native Windows Node `v25.2.1` literal `npm test`: 112 files, zero failures, exit 0, 188.8 seconds; the nine-path worktree status was unchanged.

Binding next gate:

1. Preserve candidate `87472e1` and root `.meta-harness/local/custody/custody-devspace-87472e187a8d-5c3362472026`; do not rerun or amend either identity.
2. The repair audit and exact native suite are complete and passing.
3. Create one new immutable candidate containing only the two-file verifier repair plus load-bearing failure truth.
4. Run literal native `npm test`; require 112 files, zero failures, exit 0, and no tracked mutation.
5. Run exactly one DevSpace-only authenticated gate for the new candidate. Require retained VERIFIED, later-than-expiry zero-spawn REPLAY, independent Node verification, leakage PASS, and clean pinned-base authority.
6. Record closure in a separate commit, then proceed to D075 OPERATE.

No retry of `87472e1`, amend, validator weakening, production-runtime change, compatibility, Fluxara substitution, remote push, or public-surface expansion is authorized.

### D074 cross-ecosystem custody closure

Audit: `docs/ops/audits/d074-cross-ecosystem-custody-closure-audit.json`.

Verdict: **D074 is closed under exact repair candidate `4ad92f0bf0643a48bb90ab86ee3fe7f9fd31184b`, tree `064689e945889c1ee2d5b4a132d6c7a12cf2d706`. D075 OPERATE is next.**

Closure evidence:

- Exact native Windows Node `v25.2.1` literal `npm test`: 112 files, zero failures, exit 0, 190.5 seconds; tracked candidate worktree remained clean.
- Only `CUSTODY_LIVE_DEVSPACE=1` was set for the live gate; generic and Fluxara flags were unset. The focused test exited 0 in 64.7 seconds and wrote retained closure evidence.
- Authority came from an empty repository plus exact depth-one fetch of DevSpace commit `00952c05f01248773a90cd293aed528672eb6f1b`, tree `65e249664f7146e7bff6c36d530f3de1cd0068e4`. The primary clone finished clean at that base with one visible revision, matching shallow boundary, and no remote. The dirty operator checkout was not authority.
- Process 1 exited normally after one authenticated Codex spawn (`0.144.1`, exit 0) and terminal `VERIFIED` / `IMPLEMENTATION_VERIFIED` at child commit `30ad240b0b709cd330132b978e096ccbc7620c1a`, tree `f7d7ff71c97a69046d3779a7bc8c32153bde506b`. Its exact parent is the pinned base and its sole changed path is `scripts/dev-server.mjs`.
- Create-only durable ref `refs/meta-harness/attempts/babefc9946271112317c7119e5ae2d824a3b91fd5cb46bf5515c17eebbdb4680` targets the verified child. Terminal manifest digest is `sha256:ff8c695ecf57f94218f5c2c936ed2f4004c46b9117a6bc86a4de07804614ac7a`.
- Process 2 used clock `2026-07-14T12:55:53.524Z`, exactly 60 seconds after authorization expiry, and unusable execution/validation tool paths. It exited normally with `REPLAY`, unchanged verified identity, and zero agent spawns.
- Portable export digest is `sha256:ec4f1b5f3d11a02a7df14d1023a733a4289f8afca928149b6c2ddda81622a348`. Independent verification proved exact child/parent/path, reran `node --check` and the strengthened import/command/lifecycle validator with exit 0, and returned leakage PASS across 16 files.
- Failed candidate `87472e1` and root `.meta-harness/local/custody/custody-devspace-87472e187a8d-5c3362472026` remain preserved. Successful root `.meta-harness/local/custody/custody-devspace-4ad92f0bf064-b2e76672f6b4` is retained. Neither candidate was amended or rerun after failure/success.

Scope truth:

- D074 proves reuse across Fluxara/Python and DevSpace/Node through one shared phase-neutral custody workflow.
- No production abstraction, provider registry, second runtime, public command, compatibility layer, package, lockfile, contract-kernel, or production skill change was needed.
- The evidence is structural semantic preservation plus import-time behavior and independent Node validation; it is not exhaustive certification of every DevSpace watcher/process transition or a hermetic third-party dependency environment.

Binding next gate:

D075 OPERATE must expose one minimal private example-driven seam over the proven custody core, use it repeatedly for real changes, and record actual operator friction. It does not authorize a public CLI, provider abstraction, compatibility, delivery semantics, concurrency framework, or broad deletion. DECIDE and DELETE remain blocked until repeated operator-use evidence exists.

## D055: Close Phase 20F Read-Only Proposal Review Decision Receipt Template

Decision:

Accept Phase 20F as read-only `proposal_review_receipt_template` over `proposal_review_options`.

Runtime commit: `fba8d3d`.

Scope accepted:

- JSON includes `proposal_review_receipt_template` after `proposal_review_options` and before `repos`.
- Receipt template kind is `read_only_proposal_review_receipt_template`.
- Receipt template source is `proposal_review_options`.
- `packet_id` matches `proposal_review_options.packet_id`.
- `allowed_decision_ids` is derived from `proposal_review_options.allowed_decisions`.
- Required fields are `packet_id`, `decision_id`, `reviewer`, `reviewed_at`, and `reason`.
- `template.decision_id`, `template.reviewer`, `template.reviewed_at`, and `template.reason` are null.
- The template does not use `default_decision` as a recorded or selected decision.
- Missing options emit `packet_id=null`, `verdict=unknown`, and `allowed_decision_ids=[]`.
- `records_decision=false` and `mutates=false`.
- Markdown renders `## Proposal Review Receipt Template` after `## Proposal Review Options`.
- Receipt template generation preserves top-level rollup `ok` and child readiness state.

Evidence:

- Runtime commit: `fba8d3d` (`feat: add read-only proposal review receipt template`).
- `node --test ./tests/repo-rollup.test.js` -> PASS 6/6.
- `node --test ./tests/repo-rollup-drift.test.js` -> PASS 12/12.
- `node --test ./tests/repo-rollup-handoff.test.js` -> PASS 4/4.
- `node --test ./tests/repo-rollup-actions.test.js` -> PASS 7/7.
- `node --test ./tests/repo-rollup-action-brief.test.js` -> PASS 11/11.
- `node --test ./tests/repo-rollup-proposal-draft.test.js` -> PASS 10/10.
- `node --test ./tests/repo-rollup-proposal-validation.test.js` -> PASS 16/16 after field-order update.
- `node --test ./tests/repo-rollup-proposal-review-gate.test.js` -> PASS 11/11.
- `node --test ./tests/repo-rollup-proposal-review-packet.test.js` -> PASS 12/12.
- `node --test ./tests/repo-rollup-proposal-review-options.test.js` -> PASS 13/13.
- `node --test ./tests/repo-rollup-proposal-review-receipt-template.test.js` -> PASS 12/12.
- `node --test ./tests/poll-rollup-cli.test.js` -> PASS 6/6.
- `node --test ./tests/command-registry.test.js` -> PASS 4/4.
- `./bin/meta-harness.js sync check --target .` -> PASS checked=30.
- `./bin/meta-harness.js quality check` -> PASS with known public CLI command count warning 27 > 25.
- `./bin/meta-harness.js ready --target . --quick` -> READY yes, failed=0.
- `npm test` -> PASS 85/85 test files, failed=0.
- `git diff --check` -> PASS.

Non-goals:

- No new commands or dependencies.
- No export, write, queue, apply, or task creation behavior.
- No proposal/action/queue files.
- No approval recording.
- No review decision recording.
- No diffs or patch application.
- No child command execution.
- No readiness refresh.
- No parent or child repo mutation.
- No rollup ok/readiness behavior change.
- No dashboard, daemon, provider/network integration, MCP expansion, auto-repair, or autonomy.

Future boundary:

Phase 20G explicit copy/export rendering remains future if needed. Phase 21 autonomy remains deferred.

## D054: Close Phase 20E Read-Only Proposal Review Options

Decision:

Accept Phase 20E as read-only `proposal_review_options` over `proposal_review_packet`.

Runtime commit: `453ca28`.

Scope accepted:

- JSON includes `proposal_review_options` after `proposal_review_packet` and before `repos`.
- Options kind is `read_only_proposal_review_options`.
- Options are advisory only and do not record review decisions.
- `ready_for_review` allows `approve_for_manual_work`, `reject_packet`, and `defer_packet`; default is `defer_packet`.
- `blocked` allows `fix_proposal_validation` and `defer_packet`; default is `defer_packet`.
- `not_needed` allows `no_action`; default is `no_action`.
- Missing packet state emits `packet_id=null`, `verdict=unknown`, and `defer_packet` only.
- Unknown packet verdict preserves packet ID when present, normalizes verdict to `unknown`, and emits `defer_packet` only.
- All decisions have `mutates=false`.
- All decisions require explicit human action except `no_action`.
- Markdown renders `## Proposal Review Options` after `## Proposal Review Packet`.
- Options preserve top-level rollup `ok` and child readiness state.

Evidence:

- Runtime commit: `453ca28` (`feat: add read-only proposal review options`).
- `node --test ./tests/repo-rollup.test.js` -> PASS 6/6.
- `node --test ./tests/repo-rollup-drift.test.js` -> PASS 12/12.
- `node --test ./tests/repo-rollup-handoff.test.js` -> PASS 4/4.
- `node --test ./tests/repo-rollup-actions.test.js` -> PASS 7/7.
- `node --test ./tests/repo-rollup-action-brief.test.js` -> PASS 11/11.
- `node --test ./tests/repo-rollup-proposal-draft.test.js` -> PASS 10/10.
- `node --test ./tests/repo-rollup-proposal-validation.test.js` first exposed expected field-order assertion and was then covered by full `npm test` after updating the expected order.
- `node --test ./tests/repo-rollup-proposal-review-gate.test.js` -> PASS 11/11.
- `node --test ./tests/repo-rollup-proposal-review-packet.test.js` -> PASS 12/12.
- `node --test ./tests/repo-rollup-proposal-review-options.test.js` -> PASS 13/13.
- `node --test ./tests/poll-rollup-cli.test.js` -> PASS 6/6.
- `node --test ./tests/command-registry.test.js` -> PASS 4/4.
- `node bin/meta-harness.js sync check --target .` -> PASS checked=30.
- `node bin/meta-harness.js quality check` -> PASS with known public CLI command count warning 27 > 25.
- `node bin/meta-harness.js ready --target . --quick --json` -> ok=true, failed=0.
- `npm test` -> PASS 84/84 test files, failed=0.
- `git diff --check` -> PASS.

Non-goals:

- No new commands or dependencies.
- No write/export behavior.
- No proposal/action/queue files.
- No approval recording.
- No task creation.
- No diffs or patch application.
- No child command execution.
- No readiness refresh.
- No parent or child repo mutation.
- No rollup ok/readiness behavior change.
- No dashboard, daemon, provider/network integration, MCP expansion, auto-repair, or autonomy.

Future boundary:

Phase 20F read-only review decision receipt template remains future. Phase 20G explicit copy/export rendering remains future if needed. Phase 21 autonomy remains deferred.

## D053: Close Phase 20D Read-Only Proposal Review Packet Envelope

Decision:

Accept Phase 20D as read-only `proposal_review_packet` envelope.

Runtime commit: `3293a09`.

Scope accepted: packet envelope in rollup output, deterministic ID, `mutates=false`, readiness-neutral. It creates no files, queues, exports, or diffs.

Future boundary:

Phase 20F read-only review decision receipt template remains future. Phase 20G explicit copy/export rendering remains future if needed. Phase 21 autonomy remains deferred.

## D052: Close Phase 20C Read-Only Proposal Review Gate

Decision:

Accept Phase 20C as a read-only `proposal_review_gate` over `proposal_draft` and `proposal_validation`.

Runtime commit: `acf2c38`.

Scope accepted:

- JSON includes `proposal_review_gate` after `proposal_validation` and before `repos`.
- Gate verdict is review-only: `blocked`, `not_needed`, or `ready_for_review`.
- Gate output has `mutates=false`.
- Gate does not change top-level rollup `ok` or child readiness.
- Markdown renders `## Proposal Review Gate`.

Evidence:

- Rollup focused tests passed 77/77.
- Proposal review gate tests passed 11/11.
- Poll CLI tests passed 6/6.
- Command registry glob passed 6/6.
- Sync check passed checked=30.
- Quality check passed with the known public command count warning 27 > 25.
- Ready quick returned ok=true and failed=0.
- Full `npm test` passed 82/82 files with failed=0.
- `git diff --check` passed.

Non-goals:

- No new commands or dependencies.
- No proposal, export, queue, or action files.
- No diff generation, patch application, child command execution, readiness refresh, parent/child mutation, rollup readiness mutation, dashboard, daemon, provider/network, MCP expansion, auto-repair, export workflow, or autonomy.

Future boundary:

Phase 20D review packet envelope is closed under D053. Phase 20F read-only review decision receipt template remains future. Phase 20G explicit copy/export rendering remains future if needed. Phase 21 autonomy remains deferred.

## D051: Close Phase 20B Read-Only Proposal Validation

Decision:

Accept Phase 20B as a read-only rollup validation layer for the embedded `proposal_draft` surface.

Rationale:

Phase 20A drafts a proposal-shaped review packet. Phase 20B validates that draft for structural safety before any future export packet or workflow. Validation is advisory to the proposal surface only and does not change child readiness, rollup readiness, or top-level `ok`.

Scope accepted:

- Top-level JSON `proposal_validation` with kind `read_only_proposal_validation`.
- `proposal_validation` appears after `proposal_draft` and before `repos`.
- Validation checks proposal kind, source, type, `diff=null`, `mutates=false`, relative target paths, selected candidate match, read-only body boundary, absence of legacy patch proposal fields, and absence of proposal/action/queue file-output fields.
- `proposal_validation.ok` and `verdict` may fail independently from top-level rollup `ok`.
- Markdown renders `## Proposal Validation` after `## Proposal Draft`.
- Validation does not write files, create proposal files, create queue files, create action files, generate diffs, apply patches, execute child commands, refresh readiness, or mutate parent/child repos.
- No new commands.
- No dependencies.

Evidence:

- Runtime commit: `62ec976` (`feat: add read-only rollup proposal validation`).
- `node --test ./tests/repo-rollup.test.js` -> PASS 6/6.
- `node --test ./tests/repo-rollup-drift.test.js` -> PASS 12/12.
- `node --test ./tests/repo-rollup-handoff.test.js` -> PASS 4/4.
- `node --test ./tests/repo-rollup-actions.test.js` -> PASS 7/7.
- `node --test ./tests/repo-rollup-action-brief.test.js` -> PASS 11/11.
- `node --test ./tests/repo-rollup-proposal-draft.test.js` -> PASS 10/10.
- `node --test ./tests/repo-rollup-proposal-validation.test.js` -> PASS 16/16.
- `node --test ./tests/poll-rollup-cli.test.js` -> PASS 6/6.
- `node --test ./tests/command-registry.test.js` -> PASS 4/4.
- `node bin/meta-harness.js sync check --target .` -> PASS checked=30.
- `node bin/meta-harness.js quality check` -> PASS with known public CLI command count warning 27 > 25.
- `node bin/meta-harness.js ready --target . --quick --json` -> ok=true, failed=0.
- `npm test` -> PASS.
- `git diff --check` -> PASS.

Non-goals:

- No dashboard.
- No daemon.
- No child command execution.
- No child repo mutation.
- No parent status mutation from rollup.
- No readiness state mutation from candidates, briefs, drafts, or validation.
- No readiness refresh.
- No queue files written.
- No action files written.
- No proposal files written.
- No `patch_proposals` output.
- No patch application.
- No auto-repair.
- No MCP expansion.
- No provider/network integration.
- No export workflow.
- No controlled autonomy.

Future boundary:

Phase 20C is closed as the read-only proposal review gate under D052. Phase 20D review packet envelope is closed under D053. Phase 21 autonomy remains deferred.

Remote status:

Local `main` remains ahead of `origin/main` until pushed and confirmed.

Reopen conditions:

Reopen D051 only for a concrete regression where `proposal_validation` disappears from JSON/Markdown, validation mutates readiness or top-level `ok`, validation writes proposal/action/queue files, generates diffs, applies patches, executes child commands, refreshes readiness, mutates parent/child repos, or scope broadens into dashboard, daemon, provider/network, MCP, auto-repair, export/write/apply behavior, or autonomy.
