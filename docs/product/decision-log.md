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
