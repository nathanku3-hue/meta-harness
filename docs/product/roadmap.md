# Meta-Harness Roadmap — Local-Audit-Driven Revision

Status: active baseline
Approval scope: Phase 1–12 aggregate completion under accepted roadmap scopes, closed by D031 at commit d031c
Hold: Phase 1–12 aggregate completion is done-done under D031; all Phase 1–12 exit criteria are revalidated. Phase 10 release/package enforcement remains closed for artifacts only, Phase 11 for domain-governance validation/control-plane scope only, Phase 12 for local governed skill lifecycle only, and Phase 9 is explicitly closed. Phase 13 local context-governance capabilities now extend through governance snapshotting/replay and compatibility classification. Phase 6B / 13D adds docs/templates-only build-vs-borrow expert routing before any connector or automation work. Phase 14C governance migration/release framework is implemented locally. Phase 16 is closed under D042. Phase 17 read-only multi-repo rollup pilot, ready freshness/drilldown, and drift warnings are closed locally under D043-D045. Phase 18 read-only response handoff is closed locally under D046. D048 supersedes D047's too-broad action/proposal claim and closes Phase 19A as read-only next-action routing only. Phase 19B read-only next-action brief is closed locally under D049. Phase 20A read-only proposal draft packet is closed locally under D050. Phase 20B read-only proposal draft validation is closed locally under D051. Phase 20C read-only proposal review gate is closed locally under D052. Phase 20D read-only proposal review packet envelope is closed locally under D053. Phase 20E read-only proposal review options is closed locally under D054. Phase 20F read-only review decision receipt template is closed locally under D055. Phase 20G read-only proposal review receipt validation is closed locally under D056. Phase 20H read-only copy block rendering is closed locally under D057. Phase 20I read-only copy block validation is closed locally under D058. Phase 20J read-only export intent/safety gate is closed and pushed under D059. Phase 20K explicit export files are bypassed/future-only unless a real user need appears. Phase 21A controlled autonomy dry-run plan, approval receipt validation, and CLI receipt input are closed. Phase 21B approved manual-work packet is closed under D060. Phase 21C approved packet materialization is implemented locally under D061. Phase 21D approved packet artifact verification is implemented locally under D062. Phase 21E read-only operator execution plan is implemented locally under D063. Dashboards, daemons, auto-worker routing, registry publishing, child-repo mutation, readiness refresh, auto-repair, provider/network integration, CI dashboard publishing, self-approving controlled autonomy, and operator execution remain future/non-goals.
Date: 2026-07-03
Decision: D031 aggregate closure; D032-D038 context/governance records; D041-D063 MCP/strategic-loop, read-only rollup, approved manual-work packet, packet materialization, artifact verification, and operator execution plan records; D021–D030 remain source decisions; D017–D020 remain source decisions

## Endgame

Meta-Harness is a repo-local control plane for self-governing software work. It uses skills and bounded subagents to maximize leverage. It blocks unsafe autonomy through state, security, facts, tests, and review.

The current package is a markdown-first, read-only CLI. Dashboards, daemon mode, subagent execution, and full autonomy are future phases, not current claims.

## Scoring Baseline (2026-06-06 audit)

| Dimension | Score |
|---|---|
| Capability | 9.0/10 |
| Self-adopted source repo | 7.8–8.2/10 |
| Cybersecurity/repo hygiene | 6.5–7.2/10 |
| Endgame architecture direction | 9.2/10 |
| Endgame execution maturity today | 6.5–7.2/10 |

Evidence: 106 tests pass, workflows are strong, package scope is controlled. Repo fails its own sync (23/23 templates missing), state (old runs layout, missing root status.md/events.jsonl), and quality (oversized test file) checks. Missing .gitattributes, SECURITY.md, CODEOWNERS, dependabot.yml, .agents/skills/. .gitignore is 9 lines with no secret-pattern protection.

## Phase Summary

| Phase | Name | Class | Current status |
|---|---|---|---|
| 0 | Evidence and framing alignment | concrete | accepted baseline |
| 1 | Repo hygiene and state-layout repair | concrete | accepted baseline |
| 2 | Self-adoption closure | concrete | accepted baseline |
| 3 | Cross-platform ready command | concrete | accepted baseline |
| 4 | CLI and test decomposition | concrete | accepted baseline |
| 5 | Minimum security baseline | concrete | implemented locally (with scoped settings warning exception); closed under D031 |
| 6 | Ship-fast enforcement loop | concrete | accepted baseline |
| 6B / 13D | Build-vs-Borrow Expert Routing Contract | concrete | docs/templates/status slice: Question Zero, local-first/existing-solution-first routing, expert-only boundary escalation, and no command/MCP/daemon surface |
| 7 | One-skill pilot | buildable | accepted baseline |
| 8 | Read-only subagent scout pilot | buildable | implemented and merged; PR #15 |
| 9 | Complexity governor expansion | buildable | explicitly closed under D031 |
| 10 | Release/package enforcement | buildable | done-done for release/package enforcement artifacts under D030; publish guarded; publish-mode readiness is clean-tree/tag/full-check/evidence gated; no registry publish automation |
| 11 | Domain governance pilot (adopter required) | prototype | D028 done-done validation closure: activation, source→fact→ontology→code→golden-case/review evidence, fact-ID code trace, expired-fact release block, signed review coverage, and `ready` integration implemented; non-goal boundaries unchanged |
| 12 | Self-evolution prototype | prototype | D029 done-done closure for the local governed skill lifecycle: distillation candidate drafts, inactive candidate enforcement, preflight checks, promotion requiring decision ID, rollback/quarantine, and registry updates implemented; non-goal boundaries unchanged |
| 13 | Multi-repo rollup / context governance precursor | prototype | Local context-governance precursor work is implemented through D037. The first safe multi-repo visibility pilot is closed under Phase 17/D043 through `poll --rollup`; Phase 17B/17C ready freshness and drilldown is closed under D044; broader drift/dashboard/autonomy expansion remains future. |
| 14 | Controlled autonomy pilot / governance release framework | prototype | Controlled autonomy remains future. Phase 14C governance migration/release framework is implemented locally under D038 for governed release checks and reports; it does not publish, create releases, or self-approve autonomy. |
| 15 | Judge Evidence & Candidate Profile Guidance | prototype | Implemented under D039/D040 as internal read-only judge evidence and advisory candidate-profile guidance; no public command, ready hook, or delegation authority. |
| 16 | MCP Server Integration & Strategic Semantic Loop | prototype | Done-done under D042: Phase 16/16B/16C/16D/16E are complete. The loop is bounded and read-only end to end: MCP stdio tools, insight extraction, research prompt generation, report ingest, research handoff, worker-readable decision candidates, and dogfood evidence. Publisher/write surface was removed and guarded; no write-enabled MCP tools, shell tools, HTTP/SSE, credentials, network calls, package dependencies, or new command surfaces remain in scope. |
| 17 | Read-Only Multi-Repo Rollup Pilot | prototype | Phase 17 base pilot is done-done locally under D043: `meta-harness poll --rollup [--json]` reads parent `repos.json` and child local health artifacts without executing child commands or mutating parent/child files by default. Phase 17B/17C is closed locally under D044: child `ready.json` freshness/contract validation is enforced and failed/warn check drilldown is available in JSON and Markdown. Phase 17D is closed locally under D045: read-only cross-repo drift warnings report template manifest, security policy surface, skill registry, and minimal governance compatibility drift in JSON and Markdown while preserving warning-only behavior and readiness classification. Remote alignment remains pending until pushed. |
| 18 | Read-Only Rollup Response Handoff | prototype | Done-done locally under D046: rollup output includes top-level JSON `response_handoff` and compact Markdown Response Handoff review items. Handoff items are read-only, `mutates=false`, do not write files, do not change readiness classification, and do not make `ok=false` by themselves. |
| 19A | Read-Only Rollup Next-Action Routing | prototype | Done-done locally under D048: corrective split removes the premature proposal surface from rollup output and keeps only deterministic per-repo `next_action_candidates` plus `summary.next_action_candidates`. Candidates are review-only, prioritized, `mutates=false`, readiness-neutral, and sourced from readiness/drift evidence without files, queues, child command execution, or parent/child repo mutation. |
| 19B | Read-Only Candidate Brief Packet | prototype | Done-done locally under D049: rollup output includes one deterministic top-level `next_action_brief` selecting the highest-priority candidate by priority, configured repo order, and per-repo candidate order. The brief is worker-readable, read-only, `mutates=false`, does not write queues/action/proposal files, does not execute child commands, does not mutate parent/child repos, and does not change readiness or `ok` behavior. |
| 20A | Read-Only Proposal Draft Packet | prototype | Done-done locally under D050: rollup output includes one deterministic top-level `proposal_draft` derived from structured `next_action_brief` fields. The draft is review-only with `diff=null`, `mutates=false`, no patch proposals, no proposal files, no queues, no patch application, no child command execution, no readiness refresh, no parent/child repo mutation, and no readiness or `ok` behavior change. |
| 20B | Proposal Draft Validation | prototype | Done-done locally under D051: rollup output includes top-level read-only `proposal_validation` after `proposal_draft`. Validation is proposal safety only, `mutates=false`, preserves child readiness and top-level `ok`, renders `## Proposal Validation`, and ships no proposal files, queues, diffs, patch application, child command execution, readiness refresh, parent/child mutation, dashboard, daemon, MCP, provider/network, export, or autonomy behavior. |
| 20C | Proposal Review Gate | prototype | Done-done locally under D052: rollup output includes top-level read-only `proposal_review_gate` after `proposal_validation`. Gate verdict is review-only (`blocked`, `not_needed`, or `ready_for_review`), `mutates=false`, preserves child readiness and top-level `ok`, renders `## Proposal Review Gate`, and remains bounded to review gating. |
| 20D | Proposal Review Packet Envelope | prototype | Done-done locally under D053: rollup output includes top-level read-only `proposal_review_packet` after `proposal_review_gate`. The packet is an envelope only, bundles draft, validation, and gate sections, has deterministic `packet_id`, has `mutates=false`, and does not change `ok` or child readiness. |
| 20E | Proposal Review Options | prototype | Done-done locally under D054: rollup output includes top-level read-only `proposal_review_options` after `proposal_review_packet`. Options are advisory only, expose deterministic allowed human reviewer decisions for packet verdicts, default to defer unless no action is needed, have `mutates=false`, record no decision, and do not export, write, queue, apply, create tasks, execute child commands, refresh readiness, or mutate parent/child repos. |
| 20F | Review Decision Receipt Template | prototype | Done-done locally under D055: rollup output includes top-level read-only `proposal_review_receipt_template` after `proposal_review_options`. The template represents the receipt shape only: decision_id, reviewer, reviewed_at, and reason remain null; `records_decision=false`; `mutates=false`; no export, write, queue, apply, task creation, child command, readiness refresh, or parent/child repo mutation is shipped. |
| 20G | Proposal Review Receipt Validation | prototype | Done-done locally under D056: rollup output includes top-level read-only `proposal_review_receipt_validation` after `proposal_review_receipt_template`. Validation proves the receipt template records no decision and no approval, preserves top-level `ok` and child readiness, writes no files, creates no tasks, executes no child commands, refreshes no readiness, and mutates no parent or child repo truth. |
| 20H | Read-Only Review Copy Block Rendering | prototype | Done-done locally under D057: rollup output includes top-level read-only `proposal_review_copy_block` after `proposal_review_receipt_validation`, rendering deterministic copy text only after receipt validation passes. The block uses `export_target=null`, writes no files, exports nothing, records no decision or approval, creates no tasks, preserves top-level `ok` and child readiness, and mutates no parent or child repo truth. |
| 20I | Read-Only Copy Block Validation | prototype | Done-done locally under D058: rollup output includes top-level read-only `proposal_review_copy_block_validation` after `proposal_review_copy_block`. Validation enforces copy block kind, source, packet ID consistency, verdict match, includes list, read-only safety, correct blocked/passed text states, safety from forbidden words/diffs, no forbidden output fields, and no `patch_proposals`. |
| 20J | Read-Only Export Intent / Export Safety Gate | prototype | Done-done locally under D059: rollup output includes top-level read-only `proposal_review_export_intent` and `proposal_review_export_safety_gate` after `proposal_review_copy_block_validation`. Intent and safety gate enforce read-only constraints (`export_target=null`, `writes_files=false`, `records_decision=false`, etc.), packet ID consistency, copy block validation matching, absence of forbidden output fields, and absence of `patch_proposals`. |
| 20K | Explicit Export-File Workflow | prototype | Bypassed / future only if ever needed: approval evidence now enters the public CLI directly and Phase 21B emits stdout-only manual-work packets, so explicit export files are not on the active path. |
| 21A | Controlled Autonomy Dry-Run Plan + Approval Receipt Input | prototype | Implemented locally: rollup emits a dry-run `autonomy_plan`, validates explicit approval receipts, and `poll --rollup --json` accepts inline or file approval receipt input without recording decisions, writing files, creating queues/tasks, executing child commands, refreshing readiness, or mutating parent/child truth. |
| 21B | Approved Manual-Work Packet | prototype | Done-done under D060: rollup always emits top-level `manual_work_packet` after `autonomy_approval_receipt_validation` and before `repos`. Valid approval receipts unlock `ready_for_manual_work`; shell states are explicit; output is deterministic, stdout-only, non-mutating, and built from structured fields only. |
| 21C | Approved Packet Materialization | prototype | Done-done locally under D061: `poll --rollup --json` accepts `--write-manual-work-packet <path>` as the only materialization surface, requires `manual_work_packet.verdict=ready_for_manual_work`, writes one parent-local JSON artifact under `.meta-harness/`, preserves full rollup stdout, keeps generic `--write` rejected, and does not persist approval, record a decision, refresh readiness, mutate child repos, or execute child commands. |
| 21D | Approved Packet Artifact Verification | prototype | Done-done locally under D062: read-only parent-local artifact validation is shipped; execution/apply/write semantics remain future. |
| 21E | Read-Only Operator Execution Plan | prototype | Done-done locally under D063: rollup emits a read-only `operator_execution_plan` derived from the verified manual work packet artifact; verdict is `ready_for_operator` only under valid pass status; safety boundary is maintained with zero mutative action. |

---

## Phase 0 — Evidence and framing alignment

Purpose: make the roadmap honest. Reconcile the product story with the endgame direction without overclaiming current automation.

### Problem

README says "Markdown-first workflow harness." Product spec says "no dashboard, daemon, agent spawning, or heavy policy layer." Both are true today, but they conflict with the endgame direction of an operationally self-aware coding control plane.

### Deliverables

| File | Change |
|---|---|
| README.md | Add endgame direction paragraph. Keep MVP description honest. |
| docs/product/roadmap.md | This document. |
| docs/product/decision-log.md | D017: post-MVP endgame roadmap expansion. |

### Copy / modify / reject table

Frozen as design input for all subsequent phases.

| Decision | Pattern | Stance |
|---|---|---|
| Copy | SKILL.md directory format with scripts/, references/, assets/ | Native skill packaging format. |
| Copy | SHA-pinned GitHub Actions | Immutable workflow references. |
| Copy | Least-privilege workflow permissions | Read-only default. |
| Copy | persist-credentials: false | Reduce credential availability. |
| Copy | CODEOWNERS | Protect control-plane paths. |
| Copy | SECURITY.md | Vulnerability reporting policy. |
| Copy | Dependabot security updates | Dependency vulnerability PRs. |
| Copy | Secret scanning / push protection | Block leaked credentials. |
| Copy | NIST SSDF framing | Security backbone. |
| Modify | Public skills | Vendor locally, record provenance, eval before promotion. |
| Modify | .meta-harness state | Split tracked truth from ignored local runtime. |
| Modify | GitHub workflows | SHA-pin, no secrets, no broad write token. |
| Modify | Subagent leverage | Read-only scouts first; write workers later with owned paths. |
| Reject | Remote mutable skill imports | No unpinned external URL execution. |
| Reject | Broad subagent write access | Default read-only; patch workers need owned paths. |
| Reject | Secrets in prompts/packets/briefs/logs | Hard boundary. |
| Reject | Dashboard before truth | Dashboard reads reliable state, not compensates for missing state. |
| Reject | "Agent can fix everything" autonomy | Proposal → validation → promotion → rollback. |
| Reject | Skills that expand permissions silently | Decision-gate approval required. |

### Exit criteria

- [ ] README does not overclaim current autonomy
- [ ] README names the endgame direction
- [ ] Product spec distinguishes MVP boundaries from future roadmap
- [ ] Decision log records D017

---

## Phase 1 — Repo hygiene and state-layout repair

Purpose: clean the repo before adding capability. Fix every filesystem-level gap the audit found.

### Problem

| Issue | Evidence |
|---|---|
| No .gitattributes | CRLF warnings on git diff --check |
| .gitignore too thin | 9 lines, no .env / *.pem / *.key / secrets patterns |
| demo/ ambiguous | Contains full .meta-harness/ state trees — unclear if fixture or leaked run artifact |
| .meta-harness layout mixed | tracked truth, old runs/, planning docs, and local state all in one ignored directory |
| Old runs/ still present | .meta-harness/runs/20260501-... is the deprecated Python-era layout |
| No root status.md | .meta-harness/status.md missing |
| No root events.jsonl | .meta-harness/events.jsonl missing |
| CRLF noise | docs/product/decision-log.md and docs/sop/meta-harness-sop.md have LF/CRLF mismatch |
| Event log growth | Tracked events.jsonl can become noisy and unbounded over time |

### Deliverables

#### [NEW] .gitattributes

```gitattributes
* text=auto eol=lf
*.md text eol=lf
*.js text eol=lf
*.json text eol=lf
*.yml text eol=lf
*.yaml text eol=lf
*.sh text eol=lf
*.py text eol=lf
*.png binary
*.jpg binary
*.jpeg binary
*.gif binary
*.zip binary
*.tgz binary
```

#### [MODIFY] .gitignore

Expand from 9 lines to full baseline:

```gitignore
# dependencies
node_modules/

# package/build output
dist/
build/
coverage/
*.tgz

# logs/temp
*.log
tmp/
.temp/
.cache/

# Python local artifacts
__pycache__/
*.py[cod]
.pytest_cache/

# OS/editor
.DS_Store
.vscode/
.idea/

# secrets and local config
.env
.env.*
!.env.example
*.pem
*.key
*.p12
*.pfx
id_rsa
id_ed25519
credentials.json
secrets.json
secret.txt
secrets.txt
secrets.*
*.secret
*.token
.npmrc
!.npmrc.example
.meta-harness/local/locks/
.meta-harness/*.lock
.meta-harness/**/*.lock

# provider/runtime/governed data
provider-config/
runtime/
data/
data-output/

# Meta-Harness local state (tracked truth files are NOT ignored)
.meta-harness/local/
.meta-harness/snapshots/
.meta-harness/expert-packets/
.meta-harness/workers/
.meta-harness/runs/
```

#### [MODIFY] .meta-harness/ layout

Target split:

```text
.meta-harness/
  status.md                  # tracked target truth
  events.jsonl               # tracked: redacted governance events only
  layout_version             # tracked: "2" (enables idempotent migration detection)
  clean-code-contract.json   # tracked: quality contract
  baseline/                  # tracked: quality baseline
  templates/                 # tracked: installed template copies
  decisions.json             # tracked: decision inbox (when used)
  skill-registry.json        # tracked: skill provenance (Phase 7)
  security-policy.json       # tracked: security posture (Phase 5)
  archive/                   # tracked: redacted governance-event archives only; follow the same redaction policy as events.jsonl
  local/                     # ignored: runtime state (includes local/events.jsonl for raw traces, local/locks/ for concurrency locks)
  snapshots/                 # ignored
  expert-packets/            # ignored unless intentionally archived
  workers/                   # ignored unless PM report is committed
  runs/                      # deprecated → archive and ignore
```

State migration must:

- Write layout_version file with value "2"
- Record migrated_from and migrated_at in events.jsonl
- Be idempotent: re-running on already-migrated state is a no-op
- Support rollback/backup behavior: restore original state if migration fails
- Adhere to atomic write rules: write status.md, decisions.json, layout_version to temp file first, then rename; events.jsonl is append-only with concurrency lock checks
- Follow lock-file policy: all state lock files live under .meta-harness/local/locks/ (ignored recursively) or end in *.lock (ignored in .gitignore)
- Follow tracked-vs-local event policy: tracked .meta-harness/events.jsonl contains governance events (decisions, migrations, promotions, releases, rollbacks) only; no raw prompts, transcripts, provider outputs, secrets, stack traces with tokens, or full worker logs
- Enforce event log retention: tracked .meta-harness/events.jsonl is subject to a 500KB size limit, above which older entries are archived to .meta-harness/archive/ or summarized to prevent unbounded file growth
- Canonical Hashing Rules: All template manifests, state_hash, assumption_hash, rollback_hash, and skill version_hash must follow a single canonical rule:
  - Computed using SHA-256.
  - Read input content as UTF-8 bytes.
  - Normalize line endings to LF (\n).
  - Sort keys recursively for JSON structures.
  - Use POSIX-style relative paths (forward slashes /).
  - Exclude volatile/computed fields (e.g. timestamps, transient run metadata) from the hashed object.

#### [MODIFY] demo/

Decide: fixture or leaked state.

If fixture: add demo/README.md explaining purpose, mark as intentional test data.
If leaked: remove .meta-harness/ trees from demo/ subdirectories.

### Exit criteria

- [ ] `git diff --check` passes (no CRLF/whitespace warnings)
- [ ] .gitattributes exists and normalizes line endings
- [ ] .gitignore covers secrets, local state, provider/runtime paths, and scoped lock paths (.meta-harness/local/locks/ and .meta-harness/*.lock)
- [ ] .meta-harness/ has layout_version file
- [ ] Old .meta-harness/runs/ is archived or migrated
- [ ] demo/ has explicit fixture policy or no full run-state trees
- [ ] `npm pack --dry-run` excludes .meta-harness local state
- [ ] Package contents unchanged (bin/, lib/, docs/product/, docs/sop/, templates/, README.md)
- [ ] Atomic write rules and lock-file boundaries are enforced for all state modifications
- [ ] Tracked .meta-harness/events.jsonl does not contain secrets, raw prompts, or runtime traces, and respects size retention limits
- [ ] Migration rollback/backup is fully tested and verified
- [ ] Canonical hashing logic is used for all templates and hashes

---

## Phase 2 — Self-adoption closure

Purpose: make the source repo pass as a Meta-Harness target. The whole product becomes more credible when it passes its own target checks.

### Problem

| Check | Current result |
|---|---|
| `meta-harness sync check --target .` | FAIL — 23/23 installed templates missing |
| `meta-harness state check --target .` | MIGRATION_NEEDED — old runs layout, missing root status.md and events.jsonl |
| `meta-harness trust check --target .` | Untested against source repo |
| `meta-harness contract scan --target .` | Untested against source repo |
| `meta-harness brief scan --target .` | Untested against source repo |
| `meta-harness decisions scan --target .` | Untested against source repo |

The repo has never run `templates install` against itself.

### Deliverables

#### [MODIFY] .meta-harness/templates/

Run `meta-harness templates install` against the source repo. This copies all 23 templates (13 contracts + 10 skills) into .meta-harness/templates/ and generates `.meta-harness/templates/manifest.json` containing template names, version, and content hashes (using canonical hashing rules) to verify installed template copies cleanly and detect drift.

Enforce rollback/backup behavior during `templates install` so that if installation fails or drifts, the previous template state can be restored. Enforce atomic write rules on any updates to status.md / events.jsonl.

#### [NEW] .meta-harness/status.md

Create root status truth:

```md
# Status

Goal: Build a self-governing coding control plane
Phase: post-MVP — roadmap execution
Current truth: repo hygiene repaired, self-adopting
Active streams: coding
Pending human decisions: none
Blockers: none
Last verified: 2026-06-06
Next action: cross-platform ready command
Stop criteria: all target checks pass against source repo
```

#### [NEW] .meta-harness/events.jsonl

Seed with migration event:

```json
{"time":"2026-06-06T...","actor":"human","stream":"coding","phase":"work","action":"self-adoption: state layout migrated to v2","result":"root status.md and events.jsonl created, old runs archived","evidence":"meta-harness state check --target . passes","decision":"D017","next_action":"close remaining target checks"}
```

#### [MODIFY] .meta-harness/layout_version

Written in Phase 1. Value: `2`.

#### Install/upgrade round-trip test

Add a test that:

1. Creates a temp target directory
2. Runs `templates install` into it
3. Runs `sync check --target <temp>`
4. Verifies PASS
5. Modifies one installed template
6. Runs `sync check --target <temp>`
7. Verifies DRIFT detected
8. Re-installs
9. Verifies PASS restored
10. Confirms no local state leaks into temp target

### Exit criteria

- [ ] `meta-harness sync check --target .` passes
- [ ] `meta-harness state check --target .` passes
- [ ] `meta-harness trust check --target .` passes
- [ ] `meta-harness contract scan --target .` passes
- [ ] `meta-harness brief scan --target .` passes
- [ ] `meta-harness decisions scan --target .` passes
- [ ] .meta-harness/status.md exists and is tracked
- [ ] .meta-harness/events.jsonl exists and is tracked
- [ ] Install/upgrade round-trip test passes

---

## Phase 3 — Cross-platform ready command

Purpose: replace the bash-only `mh-ready.sh` script plan with a single cross-platform operator-grade command. This is a Node.js CLI that must work on Windows.

### Problem

The earlier plan proposed `scripts/mh-ready.sh` with many individual checks. That assumes bash, which does not work on Windows without WSL. The readiness check should be one command that aggregates all existing checks.

### Deliverables

#### [NEW] lib/ready-check.js

Runs all checks in sequence:

| Check ID | Check | Source |
|---|---|---|
| MH_SYNC_001 | Template sync | `sync check --target <dir>` |
| MH_TRUST_001 | Skill trust | `trust check --target <dir>` |
| MH_CONTRACT_001 | Contract headings | `contract scan --target <dir>` |
| MH_STATE_001 | State layout | `state check --target <dir>` |
| MH_BRIEF_001 | PM brief shape | `brief scan --target <dir>` |
| MH_DECISION_001 | Decision inbox | `decisions scan --target <dir>` |
| MH_QUALITY_001 | Quality gate | `quality check` |
| MH_GITCHECK_001 | Git whitespace | `git diff --check` (if git repo) |
| MH_PACKAGE_001 | Package dry-run | `npm pack --dry-run` forbidden-path scan (if package.json) |
| MH_SECURITY_001 | Security hygiene | Files exist + gitignore patterns (Phase 5 expands) |
| MH_GITHUB_SETTINGS_001 | GitHub repository settings | Secret scanning, branch protection rulesets, push protection checks (verified in CI mode, skipped/warned/unknown locally) |
| MH_NPM_SCRIPTS_001 | npm lifecycle-script risk | Scans package.json for pre/postinstall, prepare, prepack, and publish hooks |

Each check returns:

```json
{
  "id": "MH_SYNC_001",
  "name": "sync",
  "status": "pass|fail|skip|warn",
  "reason": "human-readable explanation",
  "next_action": "what to do if failed"
}
```

#### [MODIFY] bin/meta-harness.js

Add `ready` command routing to lib/ready-check.js.

```text
meta-harness ready --target .
meta-harness ready --target . --json
meta-harness ready --target . --quick
meta-harness ready --target . --read-only --no-exec
```

Options:
- `--quick`: Skips executing npm tests (`MH_TEST_001`).
- `--read-only --no-exec`: Skips executing any tests, npm install, or child-local commands, checking only file posture.

Execution modes:
- **local mode** (default): Runs local file posture checks and safe local executable checks, including git whitespace, npm test, package dry-run, security hygiene, and reproducibility checks when their required files exist. API-dependent checks such as branch rules, CODEOWNERS enforcement, secret scanning, push protection, and GitHub settings return `skip`, `warn`, or `unknown`.
- **ci mode** (in CI environments): Authenticates via `GITHUB_TOKEN` (requiring read-only metadata scope or falling back to manual attestation) to verify branch protection, CODEOWNERS rulesets, secret scanning, and push protection settings. If GITHUB_TOKEN has insufficient permissions, these settings fail.
- **release mode** (run as pre-publish gate): Requires full posture and package checks; OIDC/trusted publishing validation is deferred to the publish step itself.

#### Output contract

Human output:

```text
READY: no (8/10 pass, 2 fail)

FAIL  MH_SYNC_001   sync          23 installed templates missing
FAIL  MH_STATE_001  state         missing status.md/events.jsonl
PASS  MH_TRUST_001  trust
PASS  MH_CONTRACT_001 contract
PASS  MH_BRIEF_001  brief
PASS  MH_DECISION_001 decisions
PASS  MH_QUALITY_001 quality
PASS  MH_GITCHECK_001 git
PASS  MH_PACKAGE_001 package
SKIP  MH_SECURITY_001 security     SECURITY.md not yet required

Next action: Run `meta-harness templates install`, then create .meta-harness/status.md
```

JSON output (`--json`):

```json
{
  "ok": false,
  "passed": 8,
  "failed": 2,
  "skipped": 0,
  "checks": [
    { "id": "MH_SYNC_001", "name": "sync", "status": "fail", "reason": "23 installed templates missing", "next_action": "Run templates install" }
  ],
  "next_action": "Run templates install, then create .meta-harness/status.md"
}
```

#### Exit codes

| Code | Meaning |
|---|---|
| 0 | All checks pass |
| 1 | One or more checks fail |

Stable check IDs enable automation, tests, and future dashboard reads.

### Exit criteria

- [ ] `meta-harness ready --target .` runs on Node (no bash dependency)
- [ ] `meta-harness ready --target . --json` outputs structured JSON with schema_version
- [ ] Check IDs are stable (MH_*_NNN format)
- [ ] Exit code 0 when all pass, 1 when any fail
- [ ] Ready command reports exact failing checks and next action
- [ ] Tests cover pass, fail, and mixed scenarios
- [ ] Per-check timeout (default 30s) yields status "timeout" if exceeded
- [ ] CLI ready and tests are verified on both Linux and Windows CI matrix
- [ ] Local vs CI vs release modes govern skip/warn/unknown/fail logic for API-dependent checks
- [ ] Lockfile policy rules: package-lock.json is committed/not-ignored for this CLI, and CI uses npm ci for installs
- [ ] --read-only --no-exec skips git diff, npm pack, tests, npm ci, and returns skip/unknown for those checks unless a pre-generated ready.json exists

---

## Phase 4 — CLI and test decomposition

Purpose: stop monolith growth before adding more capability. Every new command added after this phase will go into a module, not into the CLI entry point.

### Problem

| File | Lines | Issue |
|---|---|---|
| bin/meta-harness.js | 812 | Growing CLI entry point; all command logic lives here |
| tests/meta-harness-cli.test.js | 650+ | Quality check reports 731 lines (BLOCK); single monolith test file |

The quality gate already catches the test file. But the CLI entry point — which is larger — is not budgeted. Every new phase will add more commands (ready, security check, etc.), making this worse.

### Deliverables

#### [MODIFY] bin/meta-harness.js

Reduce to a thin router. Keep only:

- Argument parsing / command dispatch
- Error boundary
- Help text

Target: under 150 lines.

#### [NEW] lib/commands/*.js

Extract command handlers:

```text
lib/commands/
  init.js
  status.js
  event.js
  worker-report.js
  templates.js
  expert-packet.js
  quality.js
  lookback.js
  poll.js
  repos.js
  sync.js
  trust.js
  contract.js
  state.js
  brief.js
  decisions.js
  ready.js              # from Phase 3
  dirty.js
  skill-distillation.js
```

Each command module exports a single function:

```js
module.exports = async function runSync(args, meta) { ... }
```

#### [MODIFY] tests/meta-harness-cli.test.js

Split by command family:

```text
tests/
  cli-init.test.js
  cli-status.test.js
  cli-event.test.js
  cli-worker-report.test.js
  cli-templates.test.js
  cli-expert-packet.test.js
  cli-quality.test.js
  cli-lookback.test.js
  cli-ready.test.js
  cli-sync-trust-state.test.js
  cli-decisions-brief.test.js
```

#### [MODIFY] .meta-harness/clean-code-contract.json

Add budget rule for bin/ entry points (not just test files).

#### [MODIFY] quality check logic

Teach quality check to also budget:

- `bin/*.js` entry points
- `lib/commands/*.js` individual command files
- CLI test files per-family

### Exit criteria

- [ ] `bin/meta-harness.js` under defined line budget (target: 150 lines)
- [ ] `tests/meta-harness-cli.test.js` split; no single test file over budget
- [ ] `meta-harness quality check` passes
- [ ] All 106+ existing tests still pass after split
- [ ] New commands must live in `lib/commands/`, not in `bin/meta-harness.js`
- [ ] Quality contract budgets bin/ entry points

---

## Phase 5 — Minimum security baseline

Purpose: close obvious security hygiene gaps before adding skills or subagents. Security must exist as a harness layer before autonomy expands.

### Problem

| Missing | Risk |
|---|---|
| SECURITY.md | No vulnerability reporting policy |
| .github/CODEOWNERS | No ownership enforcement on control-plane paths |
| .github/dependabot.yml | No automated dependency vulnerability scanning |
| .meta-harness/security-policy.json | No machine-readable security posture |
| .gitignore lacks secret patterns | .env, *.pem, *.key, credentials.json could be accidentally committed |
| No redaction scanner | PM briefs, worker reports, expert packets, events could contain secret-like content |

What is already good: workflow is SHA-pinned, read-only, no secrets, persist-credentials: false.

### Deliverables

#### [NEW] SECURITY.md

```md
# Security Policy

## Reporting Vulnerabilities

Report security vulnerabilities by opening a private security advisory in this repository, or by emailing [MAINTAINER_EMAIL].

Do not open public issues for security vulnerabilities.

## Supported Versions

Only the latest published version receives security fixes.

## Credential Rotation

If a secret is committed to this repository at any time:
1. Rotate the credential immediately.
2. Treat the old credential as compromised.
3. Do not rely on git history removal as a security control.

## Agent Security Boundaries

Meta-Harness agents, skills, and subagents must not:
- Read .env, secrets, credentials, or provider output files.
- Write secrets into PM briefs, worker reports, expert packets, or events.
- Expand workflow permissions, dependency lists, or provider access without decision-inbox approval.
```

#### [NEW] .github/CODEOWNERS

```text
# Control-plane paths require review
/.github/           @MAINTAINER
/SECURITY.md        @MAINTAINER
/bin/               @MAINTAINER
/lib/               @MAINTAINER
/templates/         @MAINTAINER
/.meta-harness/security-policy.json @MAINTAINER
```

#### [NEW] .github/dependabot.yml

```yaml
version: 2
updates:
  - package-ecosystem: "npm"
    directory: "/"
    schedule:
      interval: "weekly"
  - package-ecosystem: "github-actions"
    directory: "/"
    schedule:
      interval: "weekly"
```

#### [NEW] .meta-harness/security-policy.json

Machine-readable security posture for the harness itself:

```json
{
  "version": 1,
  "secrets_in_prompts": "forbidden",
  "secrets_in_packets": "forbidden",
  "secrets_in_briefs": "forbidden",
  "secrets_in_events": "forbidden",
  "workflow_secrets": "forbidden",
  "workflow_permissions_default": "contents:read",
  "action_pinning": "full-sha-required",
  "subagent_default_access": "read-only",
  "skill_permission_expansion": "decision-required",
  "dependency_addition": "decision-required",
  "credential_rotation_on_leak": "immediate"
}
```

#### [NEW] docs/architecture/owners.json

Initial minimal machine-readable ownership map:

```json
{
  "version": 1,
  "modules": [
    { "path": "README.md", "owner": "nathanku3-hue", "risk": "docs" },
    { "path": "docs/", "owner": "nathanku3-hue", "risk": "docs" },
    { "path": "templates/", "owner": "nathanku3-hue", "risk": "harness-contract" },
    { "path": ".github/", "owner": "nathanku3-hue", "risk": "security" },
    { "path": ".meta-harness/", "owner": "nathanku3-hue", "risk": "control-plane" }
  ]
}
```

#### [NEW] lib/security-check.js

Checks:

1. SECURITY.md exists (with no placeholders)
2. .github/CODEOWNERS exists (with no placeholders) and covers all control-plane paths
3. .github/dependabot.yml exists
4. .gitignore contains secret-pattern entries (.env, *.pem, *.key, secrets.*, *.secret, *.token, .npmrc) and scoped lock paths (.meta-harness/local/locks/, .meta-harness/*.lock, and .meta-harness/**/*.lock)
5. Workflow files: all `uses:` are SHA-pinned, permissions are read-only (`contents: read` default), no `secrets.*` or `secrets: inherit` unless authorized, and no `pull_request_target` or `workflow_run` unless checked for safety
6. Workflow untrusted-input / prompt-injection scan: check that workflow files and run scripts do not allow untrusted GitHub contexts (e.g., `${{ github.event.*.body }}`, PR/issue/comment titles, bodies, branch names) to flow directly into shell executions or agent prompts without sanitization
7. Self-hosted runner policy: verify no `runs-on: self-hosted` is configured unless explicitly approved
8. CODEOWNERS enforcement check: check that branch protection or rulesets require review from CODEOWNERS, and the CODEOWNERS file itself is owned/protected
9. Package metadata validation: check that package.json defines license, repository, bin, files, engines, and packageManager fields
10. Package dry-run excludes forbidden paths (.meta-harness/local, .env, secrets, runtime, provider-config)

#### [NEW] lib/redaction-check.js

Scans text content for secret-like patterns:

- API keys (long hex/base64 strings with key prefixes)
- Connection strings
- Bearer tokens
- AWS/GCP/Azure credential patterns
- File path patterns matching .env, *.pem, *.key, credentials.*

Applies to: PM briefs, worker reports, expert packets, events.jsonl, skill outputs.

Does NOT read actual secret files — only checks output content for leaked patterns.

#### [MODIFY] meta-harness ready

Expand MH_SECURITY_001 to use lib/security-check.js and lib/redaction-check.js.

### Deferred to later security hardening

- OpenSSF Scorecard adoption
- SBOM / package manifest
- Artifact attestation / provenance
- Branch rulesets / required checks
- Code scanning / CodeQL
- OIDC / cloud credential policy
- Advanced runner hardening

### Exit criteria

- [ ] SECURITY.md exists and defines reporting + rotation + agent boundaries
- [ ] .github/CODEOWNERS protects all control-plane paths
- [ ] .github/dependabot.yml covers npm and github-actions
- [ ] .meta-harness/security-policy.json exists and is machine-readable
- [ ] .gitignore includes .env, *.pem, *.key, credentials.json, secrets.*, *.secret, *.token, .npmrc, and scoped lock paths (.meta-harness/local/locks/, .meta-harness/*.lock, .meta-harness/**/*.lock)
- [ ] Security check passes locally
- [ ] Workflow check confirms SHA-pinning, read-only (`contents: read`), blocks `pull_request_target` and `workflow_run` (except where auth and gated), and blocks self-hosted runners
- [ ] Workflow untrusted-input scan checks for injection vulnerabilities in PR bodies, titles, and comments
- [ ] Package metadata (license, repository, engines, packageManager) exists and is validated
- [ ] Package dry-run excludes forbidden paths
- [ ] Redaction scanner exists and is validated against positive/negative fixtures (AWS key, bearer token, benign UUID, benign hash)
- [ ] docs/architecture/owners.json exists with initial ownership map
- [ ] `meta-harness ready` includes security check

---

## Phase 6 — Ship-fast enforcement loop

Purpose: preserve velocity. Small safe changes ship fast. Risky changes go through gates. The agent does not ask the PM about low-value dirt, but does ask about authority changes.

### Problem

The dirty-work classifier, decision inbox, and PM brief scanner already exist as separate lib/ modules and CLI commands. But there is no unified enforcement loop that routes a change through the correct path based on its risk class.

### Operating model

```text
intake change
-> dirty classify (scope, paths, risk)
-> if docs-only + owned path + no security/domain/runtime/provider touch + tests pass
     => fast path: ship
-> if security / domain / runtime / provider / architecture / API / package / release
     => slow path: require decision inbox entry or expert packet
-> every task ends with one of: ship, blocked, decision-needed, follow-up-queued
```

### Deliverables

#### [NEW] lib/ship-gate.js

Classifies a change into risk tiers:

| Tier | Trigger | Path |
|---|---|---|
| FAST | docs-only, owned paths, tests pass, no boundary touch | Ship immediately |
| REVIEW | code/test change in owned paths, tests pass, no boundary touch | Normal review |
| SLOW | security, domain, runtime, provider, architecture, API surface, package, release | Decision inbox required |
| BLOCK | security boundary expansion, credential touch, workflow permission increase | Cannot self-approve |

#### [MODIFY] Decision inbox integration

Decision inbox entries (from `lib/decisions.js`) must carry:

- `state_hash` — hash of repo state at decision time
- `assumption_hash` — hash of assumptions the decision depends on
- `reask_when` — conditions that invalidate the decision

This prevents the agent from repeatedly asking the same question, and forces re-evaluation when assumptions change.

#### [MODIFY] PM brief integration

PM briefs generated from `meta-harness worker-report` should include the ship-gate tier classification, so the PM sees risk class alongside what changed.

#### [MODIFY] meta-harness ready

Add MH_SHIPGATE_001 check: verify that the ship-gate module can classify the current change set.

### Code-to-PR workflow contract

Every code task in a PR-capable repository must move through:

```text
intake
-> isolate
-> patch
-> verify locally
-> commit
-> open PR
-> CI/review
-> merge
-> cleanup
```

If PR, CI, review, or merge infrastructure is unavailable, the task must explicitly record the unavailable/unknown step, the reason, and the substitute local checkpoint.

### PR-to-merge protocol

A PR is merge-ready only when:

- The PR targets the narrowest correct base branch.
- Stacked PR order is respected; dependent PRs are merged or rebased in order.
- CI/status checks pass on the latest PR head SHA; if merge queue or test-merge validation is used, required checks also pass on the generated merge-group/test-merge SHA. If a check is unavailable/unknown, record the reason.
- Required review, CODEOWNERS review, and security/domain/package/workflow approvals are satisfied when applicable.
- There are no unresolved blocking review comments.
- The merge method follows repo policy: merge commit, squash merge, rebase merge, or merge queue.
- If merge queue is enabled, the PR enters the queue and passes queue-required checks before merge.
- The merged commit SHA or merge result is recorded when available.

After merge:

- Pull/update the target branch.
- Confirm the merged result is present on the target branch.
- Delete or archive the source branch according to repo policy.
- Remove temporary worktrees, local artifacts, and safety snapshots only after confirming the merge contains the intended changes.
- Record cleanup status or explicitly mark cleanup unavailable/unknown.

A task is not done when code is committed. A task is done when:

- A scoped branch or worktree exists
- The PR is based on the narrowest correct base branch
- Unrelated dirty work is excluded or explicitly classified
- Local verification is recorded
- CI passes on the exact PR head SHA, or CI is explicitly unavailable/unknown with recorded reason
- Security, workflow, package, release, runtime, provider, and domain-authority changes have human review, or unavailable enforcement is recorded as unavailable/unknown
- Merge readiness, merge method, merge result, and cleanup are handled according to the PR-to-merge protocol or explicitly marked unavailable/unknown

Fast-path PRs:

- Docs-only
- Owned paths
- Ready passes
- No security, workflow, domain, runtime, provider, package, or release boundary touched

Slow-path PRs:

- Workflow changes
- Dependency changes
- Package or release changes
- Security policy changes
- Domain authority changes
- Permission expansion

#### Deferred follow-up — code-backed merge protocol gate

Phase 6 defines the Code-to-PR and PR-to-merge contract. A later implementation phase may add a code-backed merge protocol gate. This is not required to close Phase 6.

Potential command surface:

```text
meta-harness merge check --base origin/main --head HEAD --scope <scope>
meta-harness merge check --pr <number> --scope <scope> --json
```

Potential checks:

- `MH_MERGE_BASE_001` — PR/head branch merge-base is the expected base.
- `MH_MERGE_DIFF_SIZE_001` — changed files and line count are under the declared review threshold.
- `MH_MERGE_SCOPE_001` — changed paths match the declared scope contract.
- `MH_MERGE_STATUS_001` — in PR/API mode, required checks passed for the latest PR head SHA; when merge queue or test-merge validation is used, required checks also pass on the generated merge-group/test-merge SHA. In local-only mode, unavailable evidence is reported as unknown, not silently passed.
- `MH_MERGE_WORKTREE_001` — in local mode, local worktree has no unrelated uncommitted edits. In PR/API mode, this check is skipped or reported unknown unless the PR head is checked out locally.
- `MH_MERGE_PACKAGE_001` — npm pack dry-run has no forbidden leaks.
- `MH_MERGE_NOISE_001` — no CRLF renormalization, generated-state churn, or broad roadmap flood unless declared.
- `MH_MERGE_AUTHORITY_001` — no promotion, Phase 8, workflow, dependency, release, or security-boundary change unless decision-approved.

The merge protocol gate should run after local verification and PR CI/review evidence, but before approving or merging a PR.

### Exit criteria

- [ ] Fast path exists and ships docs-only owned-path changes without decision inbox
- [ ] Slow path exists and requires decision for boundary-touching changes
- [ ] Block path exists for security/credential/permission expansion
- [ ] Decision inbox entries carry state_hash, assumption_hash, reask_when
- [ ] PM brief includes risk tier classification
- [ ] Every task resolves to one of: ship, blocked, decision-needed, follow-up-queued
- [ ] Agent does not ask PM about low-value dirt
- [ ] Agent does ask PM about authority/boundary changes
- [ ] Code-to-PR workflow contract is explicit in Phase 6
- [ ] Local commit is not treated as done until PR, CI/review, merge, and cleanup expectations are satisfied or explicitly marked unavailable

---

## Phase 6B / 13D — Build-vs-Borrow Expert Routing Contract

Purpose: teach routing to avoid building the wrong thing before choosing a worker, command, expert, or patch.

### Problem

The Silent Shipper layer can separate risk routes from terminal outcomes, but it still needs a top-level preflight: decide whether the work should exist, whether the repo already has the answer, whether the platform can solve it natively, and only then whether a patch or expert packet is warranted.

### Operating model

```text
intent
-> Question Zero: does this need to be built?
-> repo/platform/dependency/template scan
-> pre-route decision
-> FAST/REVIEW/SLOW/BLOCK
-> SHIP/REVIEW/DECISION_NEEDED/BLOCKED/FOLLOW_UP_QUEUED
```

Pre-route decisions:

| Pre-route | Meaning | Then maps to |
|---|---|---|
| `NO_BUILD` | speculative, unnecessary, or already covered | `FOLLOW_UP_QUEUED` or compact explanation |
| `USE_EXISTING_REPO_PATTERN` | repo skill/template/helper/docs pattern exists | `SHIP` or `REVIEW` |
| `USE_PLATFORM_NATIVE` | runtime, stdlib, platform config, or local docs can solve it | `SHIP` or `REVIEW` |
| `MINIMAL_PATCH` | real gap, owned path, bounded implementation | `REVIEW` |
| `HUMAN_TASTE` | product judgment, UX tradeoff, naming, or priority | `DECISION_NEEDED` |
| `EXPERT_PACKET` | architecture, domain, security, provider, or release judgment | `DECISION_NEEDED` or `BLOCKED` |
| `AUTHORITY_BLOCK` | credentials, permissions, publishing, or protected boundary | `BLOCKED` |

### Deliverables

| File | Change |
|---|---|
| `docs/product/product-spec.md` | Define top-level-aware routing as both what-to-build and how-to-build. |
| `docs/product/roadmap.md` | Add this Phase 6B / 13D slice and non-goals. |
| `docs/sop/meta-harness-sop.md` | Add Question Zero and build-vs-borrow pre-route before FAST/REVIEW/SLOW/BLOCK. |
| `templates/skills/build-vs-borrow-router.md` | Add reusable pre-route skill template. |
| `templates/skills/scope-selector.md` | Require pre-route before bounded scope selection when build necessity is unclear. |
| `templates/skills/expert-front-card.md` | Carry pre-route, route/outcome, boundary, and exactly one question. |
| `templates/skills/expert-context-packer.md` | Build expert context only after the router says outside judgment is needed. |
| `templates/contracts/expert-reconciliation-matrix.md` | Reconcile expert output against pre-route, route, outcome, and authority rules. |

### Non-goals

- No new public CLI command.
- No MCP, connector, web, daemon, model/network scoring, or auto-search worker.
- No imported remote/public skill artifact unless vendored, provenance-recorded, evaluated, and explicitly authorized.
- No release, publish, protected-branch, credential, provider, or production-impacting action.

### Exit criteria

- [x] SOP adds Question Zero: "does this need to be built?"
- [x] SOP requires local/repo/platform/existing-solution scan before new implementation.
- [x] Product spec defines top-level-aware routing as both what-to-build and how-to-build.
- [x] Non-FAST work distinguishes human taste, architecture boundary, expert-needed, review-only, and blocked authority.
- [x] Expert packets are only created after the router says outside judgment is needed.
- [x] Expert front card still asks exactly one question.
- [x] Product/architecture/security/release/provider/domain changes cannot close with terminal outcome `SHIP`.
- [x] Remote/public skills may inspire patterns but are not imported unless vendored, provenance-recorded, and evaluated.

---

## Phase 7 — One-skill pilot

Purpose: prove the skill lifecycle before scaling. The repo currently has zero `.agents/skills/`. Going from zero to eleven active skills is too large. Start with one.

### Problem

The earlier plan proposed installing 11 skills simultaneously with full provenance, evals, lifecycle, and rollback. That is under-scoped: creating one well-tested skill with provenance, evals, and rollback is probably a full phase by itself.

The skill packaging format (SKILL.md directory with optional scripts/, references/, assets/) is copied from the Codex model and is the right portable unit. But the lifecycle infrastructure does not exist yet.

### Deliverables

#### [NEW] .agents/skills/repo-adoption-doctor/SKILL.md

```md
---
name: repo-adoption-doctor
description: Given a target repo, diagnose why it is not Meta-Harness adopted and recommend the smallest fix sequence.
owner: MAINTAINER
source: local
allowed_tools: [read_file, list_dir, grep_search]
forbidden_paths: [.env, secrets, credentials, provider-config, runtime, data]
---

# Repo Adoption Doctor

## Goal

Identify why a target repo is not fully Meta-Harness adopted and produce a prioritized fix list.

## Checks

1. Missing installed templates (sync check)
2. Missing root status.md / events.jsonl (state check)
3. Old runs/ layout present (state check migration)
4. Missing .gitattributes
5. Missing SECURITY.md, CODEOWNERS, dependabot.yml
6. Quality gate failures (oversized files)
7. Package boundary issues (forbidden paths in dry-run)
8. Weak .gitignore (missing secret patterns)

## Output

Return a prioritized list:

- Issue
- Severity (block / warn / info)
- Fix command or manual action
- Phase reference (which roadmap phase addresses this)

## Boundaries

- Read-only: does not modify target repo
- Does not read .env, secrets, credentials, provider output
- Does not expand permissions
```

#### [NEW] .agents/skills/repo-adoption-doctor/evals/

At least one deterministic eval:

```text
evals/
  pass-adopted-repo.json      # expects PASS on a fully adopted temp repo
  fail-unadopted-repo.json    # expects specific findings on a bare temp repo
```

Each eval specifies input (temp repo state) and expected output shape (findings list with severity).

#### [NEW] .meta-harness/skill-registry.json

```json
{
  "version": 1,
  "skills": [
    {
      "name": "repo-adoption-doctor",
      "path": ".agents/skills/repo-adoption-doctor",
      "status": "active",
      "owner": "MAINTAINER",
      "source": "local",
      "source_commit": null,
      "license": "MIT",
      "allowed_tools": ["read_file", "list_dir", "grep_search"],
      "forbidden_paths": [".env", "secrets", "credentials", "provider-config", "runtime", "data"],
      "eval_command": "node tests/skill-evals/repo-adoption-doctor.test.js",
      "promotion_date": "2026-06-XX",
      "rollback_hash": null,
      "reopen_conditions": "skill fails eval or expands permissions"
    }
  ]
}
```

#### Skill lifecycle directories

```text
.agents/skills/
  repo-adoption-doctor/       # active
.agents/quarantine/            # disabled/rolled-back skills land here
```

#### Rollback / quarantine command

```text
meta-harness skill disable repo-adoption-doctor
```

This must:

1. Move skill from `.agents/skills/` to `.agents/quarantine/`
2. Update skill-registry.json status to "quarantined"
3. Append quarantine event to events.jsonl
4. Restore previous active version if rollback_hash exists

### Exit criteria

- [ ] One active skill exists at `.agents/skills/repo-adoption-doctor/SKILL.md`
- [ ] `.meta-harness/skill-registry.json` exists and validates
- [ ] Skill has at least one deterministic eval that passes
- [ ] Skill does not read secrets, credentials, or provider output
- [ ] Skill can be disabled/quarantined with one command
- [ ] No public-derived skill can be active without source, source_commit, license, and reviewer fields
- [ ] Skill registry rejects entries with missing owner or provenance

---

## Phase 8 — Read-only subagent scout pilot

Purpose: prove subagent leverage safely. Start with read-only scouts that produce structured evidence. No write-enabled subagents yet.

Current status: implemented and merged under PR #15 (commit `53e2c3409424957f6b334e93abdc8fe66e8f28b9`). Read-only scout infrastructure is fully implemented, bounded by enforced fanout limits, and reconciled as evidence-only.

Remaining exclusions:
- No write-enabled subagents
- No auto-merge or multi-agent repair loops
- No package, workflow, release, provider, runtime, or domain-authority changes

### Problem

`lib/subagent-packet.js` exists but is the thinnest module at 2.6KB. The fanout budget and workcell model are designed in templates but not implemented. The earlier plan jumped straight to write-enabled patch workers, which creates uncontrolled autonomy risk before the safety infrastructure is proven.

### Scout roles

| Role | Access | Purpose |
|---|---|---|
| Repo Scout | read-only | Map files, ownership, directory structure, template state |
| Security Scout | read-only | Check secrets, CI, deps, workflows, gitignore, CODEOWNERS |
| Test Scout | read-only | Find coverage gaps, regression paths, oversized test files |

Write-enabled patch workers, auto-merge, and multi-agent repair loops are explicitly rejected for this phase.

### Deliverables

#### [MODIFY] lib/subagent-packet.js

Expand to generate scout-specific packets. Each packet must include:

```json
{
  "role": "repo-scout",
  "task": "map template adoption state for target repo",
  "owned_paths": [],
  "forbidden_paths": [".env", "secrets", "credentials", "provider-config", "runtime", "data"],
  "allowed_commands": ["read_file", "list_dir", "grep_search"],
  "write_access": false,
  "required_evidence": ["findings list with severity", "file count", "check results"],
  "stop_rule": "return findings after scanning; do not attempt fixes",
  "context_budget": "max 50 files or 100KB context",
  "return_schema": {
    "findings": [{"path": "", "issue": "", "severity": "block|warn|info"}],
    "summary": "",
    "check_ids_referenced": []
  }
}
```

#### [NEW] lib/scout-reconciler.js

Reconciler that:

1. Collects structured outputs from one or more scouts
2. Validates each finding against actual repo state (does not trust scout claims blindly)
3. Deduplicates findings across scouts
4. Produces a merged evidence report
5. Remains the only authority — scout output is evidence, not decisions

#### [NEW] lib/fanout-budget.js

Limits subagent resource consumption:

```json
{
  "max_concurrent_scouts": 3,
  "max_context_per_scout_kb": 100,
  "max_total_fanout_kb": 300,
  "timeout_seconds": 120
}
```

#### Subagent must NOT receive

- Raw chat transcripts
- Secrets or credentials
- Provider output or runtime data
- Broad repo dumps (must use owned_paths / bounded file lists)
- Unbounded write access
- Unreviewed domain authority

### Exit criteria

- [x] Scout packets have bounded paths, forbidden paths, and allowed commands
- [x] Scout output is structured JSON matching return_schema
- [x] Reconciler validates scout claims against repo state
- [x] Main agent / reconciler remains the only authority
- [x] No subagent writes to repo in this phase
- [x] Fanout budget exists and limits concurrent scouts and context size
- [x] Tests cover scout packet generation, reconciler dedup, and budget enforcement

---

## Phase 9 — Complexity governor expansion

Purpose: prevent the project from becoming unmaintainable as capability grows. The quality ratchet already works for file line budgets; this phase extends it to architecture-level controls.

Current status: explicitly closed by D031. Complexity policy metadata is adopted, module ownership map is established, and quality check enforces per-module budgets, reverse import direction, and ceilings.

### Problem

The quality gate currently checks file line counts. Phase 4 adds budgets for bin/ and test files. But as skills, subagents, commands, and templates grow, the project needs:

- Module ownership boundaries (who owns which lib/ paths)
- Import/dependency direction rules (commands depend on lib, not vice versa)
- Public API surface tracking (CLI command count, check ID count)
- Template/contract duplication detection
- Source-vs-generated boundary enforcement

### Deliverables

#### [NEW] docs/architecture/map.md

```md
# Architecture Map

## Module Ownership

| Path | Owner | Purpose |
|---|---|---|
| bin/ | MAINTAINER | CLI entry point (thin router only) |
| lib/commands/ | MAINTAINER | Command handlers |
| lib/ (root) | MAINTAINER | Shared implementation modules |
| templates/contracts/ | MAINTAINER | Installable contract templates |
| templates/skills/ | MAINTAINER | Installable skill templates |
| .agents/skills/ | MAINTAINER | Active repo skills |
| .meta-harness/ | MAINTAINER | Tracked truth + local state |
| tests/ | MAINTAINER | Test suites |
| docs/ | MAINTAINER | Product and architecture docs |

## Dependency Direction

bin/meta-harness.js -> lib/commands/*.js -> lib/*.js
tests/*.test.js -> lib/*.js (direct) or bin/meta-harness.js (CLI integration)
lib/commands/*.js must not import from bin/
lib/*.js must not import from lib/commands/
templates/ are data, not imported code
```

#### [NEW] docs/architecture/owners.json

Machine-readable ownership for automated checks:

```json
{
  "version": 1,
  "modules": [
    { "path": "bin/", "owner": "MAINTAINER", "budget_lines": 150 },
    { "path": "lib/commands/", "owner": "MAINTAINER", "budget_lines": 200 },
    { "path": "lib/", "owner": "MAINTAINER", "budget_lines": 400 },
    { "path": "tests/", "owner": "MAINTAINER", "budget_lines": 300 }
  ]
}
```

#### [NEW] .meta-harness/complexity-policy.json

```json
{
  "version": 1,
  "file_line_budget": 400,
  "bin_entry_budget": 150,
  "command_file_budget": 200,
  "test_file_budget": 300,
  "max_cli_commands": 25,
  "max_check_ids": 20,
  "max_template_count": 30,
  "import_direction": {
    "bin -> lib/commands": "allowed",
    "lib/commands -> lib": "allowed",
    "lib -> lib/commands": "forbidden",
    "bin -> lib": "allowed"
  }
}
```

#### [MODIFY] lib/quality.js

Extend quality check to enforce:

1. Per-module line budgets from owners.json
2. Import direction rules (no reverse dependencies)
3. CLI command count ceiling
4. Template count ceiling
5. Duplicate template content detection

Classifications:

| Result | Meaning |
|---|---|
| PASS | No complexity budget worsened |
| WARN | Touched existing debt but did not worsen it |
| BLOCK | Added or worsened maintainability debt |
| DECISION | Intentional architecture exception (requires decision inbox) |

### Exit criteria

- [ ] Architecture map exists at docs/architecture/map.md
- [ ] Module ownership is machine-readable at docs/architecture/owners.json
- [ ] Complexity policy exists at .meta-harness/complexity-policy.json
- [ ] Quality check enforces per-module line budgets
- [ ] Quality check detects reverse import direction violations
- [ ] No new oversized files can be introduced without DECISION
- [ ] CLI command count and template count are tracked against ceilings
- [ ] Architecture map is updated when module boundaries change

---

## Phase 10 — Release/package enforcement

Purpose: make shipping safe. No release from a dirty tree, no package includes local state or secrets, no publish without checks green.

Current status: Phase 10 release/package enforcement artifacts are done-done under D030. The release check reports local implementation posture in default mode and requires full publish-mode gates before `release_ready` can be true: clean tree, exact version tag, full ready/test posture, package dry-run, forbidden-path scan, canonical tarball paths, dry-run/actual packlist equivalence, isolated npm environment, `--ignore-scripts` tarball install smoke, installed CLI smoke, rollback policy, dependency-review posture, and exact-commit external/full evidence. The `prepublishOnly` package guard runs publish mode and fails closed unless `release_ready` is true. Publish automation, registry writes, GitHub releases, remote tag pushes, CI publish workflow, version bumping, and provenance publishing remain absent.

### Problem

The `package.json "files"` field limits published contents to bin/, lib/, docs/product/, docs/sop/, templates/, and README.md. D030 closes the artifact gap by turning the release gate into an executable, fail-closed package enforcement check. The remaining non-goals are not artifacts inside Phase 10: actual npm publish, GitHub release creation, remote tag push, trusted-publisher setup, CI publish automation, registry-version checks, and external API evidence harvesting all require a separate decision.

### Deliverables

#### [NEW] lib/release-check.js

Full Phase 10 target: a pre-publish gate that runs:

Implemented D030 scope: local checks for release policy, package identity/metadata, npm lifecycle posture, reproducibility posture, quality baseline, read-only ready status, test-script eligibility, clean-tree status, and external/full evidence status; publish mode additionally executes full ready/test posture, `npm pack --dry-run`, actual tarball creation, forbidden-path scanning, canonical tarball path checks, dry-run/actual packlist equivalence, isolated temp npm setup, `--ignore-scripts` smoke install, installed CLI smoke, exact `v<package.version>` tag verification, rollback policy verification, and exact-commit evidence validation.

| Check | Failure condition |
|---|---|
| Clean tree | `git status --porcelain` is non-empty |
| Tests pass | `npm test` exits non-zero |
| Ready passes | `meta-harness ready --target .` (runs full posture checks and tests, no quick mode) exits non-zero |
| Package contents | `npm pack --dry-run --json` output matches forbidden-path regex, or inspection of generated tarball list fails |
| Version tag | publish mode requires an exact `v<package.version>` tag pointing at HEAD; local mode skips when no release tag points at the current commit |

Pre-publish checks also run:
- Tarball Install Smoke Test: after dry-run, create the tarball, install it in an isolated temp project with `--ignore-scripts`, and run the installed CLI help path.
- Dependency Review posture: accept a dependency-review workflow or exact evidence such as `not_applicable_no_dependency_delta`.
- npm trusted publishing / OIDC: no publish automation is configured in D030, so trusted-publishing checks pass only as “not configured”; adding trusted publishing requires a later decision and evidence.
- Publish permissions/environment: no publish workflow is configured in D030; any later workflow must be checked separately.
- Release Incident / Rollback Policy: tag deletion is allowed only when a package was not published; partial publishes require incident handling and human review before same-version retry.

Forbidden package paths:

```text
.meta-harness/local/
.meta-harness/snapshots/
.meta-harness/expert-packets/
.meta-harness/workers/
.meta-harness/runs/
.env
secrets
credentials
provider-config/
runtime/
data/
demo/
__pycache__/
*.pyc
node_modules/
```

#### [NEW] meta-harness release check

```text
meta-harness release check

RELEASE CHECK: BLOCK (3/5 pass, 2 fail)

FAIL  clean-tree     2 uncommitted files
FAIL  ready          MH_SYNC_001 failing
PASS  tests          106 pass, 0 fail
PASS  package        no forbidden paths in dry-run
PASS  version        0.1.0 matches
```

#### [MODIFY] package.json

Phase 10B target: add a prepublishOnly script:

```json
{
  "scripts": {
    "test": "node scripts/run-tests.js",
    "prepublishOnly": "node bin/meta-harness.js release check --publish --json"
  }
}
```

This blocks package publishing if the release check fails. The package boundary guard does not automate publishing.

#### Release readiness summary

Machine-readable output for CI:

```json
{
  "ok": false,
  "version": "0.1.0",
  "checks": [
    { "name": "clean-tree", "status": "fail", "reason": "2 uncommitted files" },
    { "name": "ready", "status": "fail", "reason": "MH_SYNC_001 failing" },
    { "name": "tests", "status": "pass" },
    { "name": "package", "status": "pass" },
    { "name": "version", "status": "pass" }
  ]
}
```

### Deferred

- Branch rulesets / required status checks (needs GitHub repo settings, not just code)
- Signed release tags
- npm provenance / attestation
- Changelog generation

### Exit criteria

- [ ] `meta-harness release check` exists and runs all pre-publish gates including tarball smoke test in temp project
- [ ] Release checks parse npm pack output via --json or inspect file list
- [ ] Pre-publish gate defines ready/test/package overlap (release check runs full ready)
- [ ] Version check is SKIP if no tag is specified or current commit is not tagged
- [ ] Release JSON outputs contain schema_version
- [ ] OIDC/trusted publishing is verified in CI configuration (publish mode)
- [ ] Dependency Review CI action blocks vulnerable dependency PRs and is configured as a required check in repository settings
- [ ] Rollback/incident policy for failed publish is defined, conditional, and testable
- [ ] No release from dirty git tree
- [ ] No package includes .meta-harness local state, secrets, runtime data, or demo run artifacts
- [x] `npm publish` blocked by prepublishOnly if release check fails
- [x] Release readiness summary available as JSON
- [ ] Tests cover clean pass and each individual failure mode

---

## Phase 11 — Domain governance pilot (adopter required)

Purpose: avoid speculative platform work. Domain semantic governance is intellectually correct for quant, law, and sport science apps, but Meta-Harness has zero domain code today. This phase activates only when a real downstream repo with domain logic exists.

Current status: D025 activated a real downstream G9 Quant pilot for `E:\Code\Quant-g9-market-behavior-signal-card`, remote `https://github.com/nathanku3-hue/Quant.git`, branch `codex/v2-d0-wrds-permission-snapshot-provenance-20260601`, HEAD `61edd14949fc8a7d7232748c27f75e7706010490`. The pilot is bounded to the FINRA short-interest G9 market-behavior signal card. Downstream `meta-harness ready` passed with `ok: true`, `passed: 12`, `failed: 0`, state hash `ed879a175a5872ec0ff90aa54b03f62264c0df54d52dc7429a85ecad6ec46332`, generated at `2026-06-09T02:45:07.298Z`. D028 closes Phase 11 for the validation/control-plane scope by promoting the first-slice validator into a full domain-governance gate: `meta-harness domain-governance check` now validates activation, pilot chain, `domain/facts/ledger.jsonl`, `domain/ontology/terms.json`, `domain/mappings/fact-to-code.json`, `domain/golden-cases/*.json`, `domain/reviews/*.json`, fact-ID references in mapped domain code, patch-plan code coverage, signed domain reviews, and expired facts. `meta-harness ready` includes `MH_DOMAIN_GOVERNANCE_001`; when a repo has a domain-governance surface, failures become readiness failures and therefore block local release readiness through the existing `REL_READY_001` path. This is the Phase 11 done-done claim for evidence validation only, not provider access, trading/ranking behavior, broker/order/alert integration, ontology product UI, release automation, or Phase 10 release-policy weakening.

### D025 pilot boundary

Owner/requester: `nathanku3-hue`

Reviewer: `codex-phase-11-reviewer`

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

Pilot evidence files:

- `.meta-harness/domain-governance/activation.json`
- `.meta-harness/domain-governance/pilot-chain.json`
- `opportunity_engine/signal_card.py`
- `opportunity_engine/signal_card_schema.py`
- `data/signal_cards/FINRA_short_interest_signal_card_v0.json`
- `data/signal_cards/FINRA_short_interest_signal_card_v0.manifest.json`
- `tests/test_g9_market_behavior_signal_card.py`
- `docs/architecture/g9_finra_short_interest_signal_card_policy.md`

First slice:

- validator command
- pilot evidence files only
- no provider credentials, trading/ranking behavior, broker/order/alert integration, broad ontology platform, publish automation, or Phase 10 release-policy weakening

### Activation trigger

This phase does NOT start until:

- At least one downstream repo has domain-specific code (quant pricing, legal rules, sport science metrics, or equivalent)
- That repo is Meta-Harness adopted (passes `meta-harness ready`)
- The domain owner requests fact/ontology governance
- A named reviewer is recorded
- A governed-data boundary is defined
- An activation decision is recorded

Until then, domain governance exists only as a template/spec, not as core infrastructure.

### Domain truth chain

When activated, every domain rule must trace:

```text
source (paper, regulation, protocol, authority)
-> fact (recorded in ledger with effective date and expiry)
-> ontology term (defined in terms.json with owner)
-> code reference (mapped in fact-to-code.json)
-> golden case (expected input/output in golden-cases/)
-> domain review (approval in reviews/)
```

### Deliverables (when triggered)

#### [NEW] domain/facts/ledger.jsonl

```json
{"fact_id":"F001","source":"...","source_date":"...","effective_date":"...","expiry_date":null,"domain":"quant","claim":"...","owner":"DOMAIN_EXPERT","status":"active"}
```

#### [NEW] domain/ontology/terms.json

```json
{
  "version": 1,
  "terms": [
    {
      "id": "T001",
      "name": "day_count_convention",
      "domain": "quant",
      "definition": "Method for counting days between dates for interest calculations",
      "owner": "DOMAIN_EXPERT",
      "fact_ids": ["F001"]
    }
  ]
}
```

#### [NEW] domain/mappings/fact-to-code.json

```json
{
  "version": 1,
  "mappings": [
    {
      "fact_id": "F001",
      "term_id": "T001",
      "code_path": "lib/pricing/day-count.js",
      "function": "calculateActual360",
      "golden_case_ids": ["GC001"]
    }
  ]
}
```

#### [NEW] domain/golden-cases/*.json

```json
{
  "id": "GC001",
  "fact_ids": ["F001"],
  "term_ids": ["T001"],
  "input": { "start": "2026-01-15", "end": "2026-07-15", "convention": "ACT/360" },
  "expected_output": { "day_count_fraction": 0.50278 },
  "tolerance": 1e-5,
  "source": "ISDA 2006 definitions example 3.2"
}
```

#### [NEW] domain/reviews/*.json

```json
{"id":"R001","reviewer":"DOMAIN_EXPERT","reviewed_at":"2026-06-09","signed_off":true,"fact_ids":["F001"],"term_ids":["T001"],"golden_case_ids":["GC001"]}
```

#### [DONE] lib/domain-rule-check.js and `meta-harness domain-governance check`

Checks:

1. No domain code without fact_id reference
2. No fact without source and effective_date
3. No ontology term without owner
4. No mapped fact without golden case
5. Domain review coverage is signed for mapped facts, terms, and golden cases
6. Expired facts block release
7. Domain reviewer can trace every rule from source to code

### Domain examples by vertical

| Domain | Source | Fact | Ontology | Code | Golden case |
|---|---|---|---|---|---|
| Quant | ISDA definitions | day count convention ACT/360 | day_count_convention | calculateActual360() | known date pair → fraction |
| Sport science | sensor protocol spec | VO2max measurement schema | vo2max_ml_kg_min | computeVO2Max() | known gas exchange → value |
| Law | statute/regulation | tax threshold for FY2026 | income_tax_bracket | computeTax() | known income → tax owed |

### Exit criteria

- [x] Activation trigger met (real adopter with domain code)
- [x] One real domain rule maps source → fact → ontology → code → golden case
- [x] No domain code exists without fact_id reference
- [x] No fact exists without source and effective_date
- [x] No mapped fact exists without golden case
- [x] Expired facts block release
- [x] Domain check integrates with `meta-harness ready`

---

## Phase 12 — Self-evolution prototype

Purpose: make self-improvement governed, not free-running. The system may propose changes to itself, but it cannot silently promote them. This replaces the earlier aspirational criteria ("Meta-Harness can explain every change") with measurable testable gates.

Current status: done-done for the local governed skill lifecycle by D029. D026 recorded the plan, D027 authorized the first implementation slice, and D029 closes the measurable Phase 12 self-evolution gates: distillation-to-candidate draft creation, inactive candidate enforcement, read-only preflight, permission-decision gating, promotion, rollback/quarantine, registry updates, event logging, and focused tests. Release status remains governed by the Phase 10 D030 exact-commit release/package enforcement gate.

### Problem

The earlier plan's self-evolution phase had exit criteria like "Meta-Harness can block itself" and "Meta-Harness can roll back itself." Those are mission statements, not engineering tests. This phase rewrites them as concrete pass/fail checkpoints.

Self-evolution is the highest-risk phase because a bad skill or bad self-modification silently shapes all future agent behavior. The safety model is: every change the system proposes to itself goes through the same gates as any other change — eval, security check, complexity check, decision approval for permission expansion, and rollback path.

### Self-evolution flow

```text
repeated correction or pattern observed
-> candidate lesson extracted
-> skill draft created in .agents/candidate/
-> eval added and must pass
-> security check: no permission expansion without decision
-> complexity check: no budget violation
-> reviewer approves
-> skill promoted to .agents/skills/
-> old skill hash retained in registry for rollback
-> promotion event appended to events.jsonl
```

### Deliverables

#### [NEW] .agents/candidate/

Staging directory for skills that have not yet been promoted:

```text
.agents/
  candidate/                   # draft skills under evaluation
    <skill-name>/
      SKILL.md
      evals/
  skills/                      # active promoted skills
  quarantine/                  # disabled/rolled-back skills
```

A candidate skill must NOT be read by agents as active guidance. Only promoted skills in `.agents/skills/` are active. `meta-harness distill candidate <distillation-id> --target <repo>` creates candidate drafts from reviewed distillation records and writes them only under `.agents/candidate/`.

#### [NEW] lib/skill-promotion.js

Promotion lifecycle implementation that checks before moving a candidate to active and also performs promotion and rollback:

| Gate | Failure condition |
|---|---|
| Eval pass | Missing or failing eval evidence |
| Security check | Skill expands allowed_tools, removes forbidden_paths, or adds write access without decision evidence |
| Complexity check | Skill adds files that violate line budgets |
| Permission diff | New version expands permissions vs previous active version |
| Rollback path | No rollback_hash recorded for current active version |

#### [MODIFY] meta-harness skill promote

```text
meta-harness skill promote <skill-name> --target <repo> --decision-id <id>

PROMOTION: BLOCK

FAIL  permission-diff   new version adds "run_command" to allowed_tools
PASS  eval              2/2 evals pass
PASS  security          no forbidden_path removals
PASS  complexity        SKILL.md under budget
PASS  rollback          previous hash recorded

Decision required: `--decision-id <id>` for every promotion; permission expansion also requires an explicit permission decision or promotion decision.
```

#### [MODIFY] meta-harness skill rollback

```text
meta-harness skill rollback <skill-name> --target <repo> --decision-id <id>
```

This must:

1. Move current active skill to `.agents/quarantine/`
2. Restore previous version from rollback_hash
3. Update skill-registry.json
4. Append rollback event to events.jsonl

#### [MODIFY] .meta-harness/skill-registry.json

Add version tracking fields:

```json
{
  "name": "repo-adoption-doctor",
  "status": "active",
  "version_hash": "abc123",
  "previous_version_hash": "def456",
  "promotion_date": "2026-07-XX",
  "promotion_decision": "D018",
  "permission_diff": "none"
}
```

#### Distillation integration

Connect to existing `lib/skill-distillation.js`:

- When the distillation loop identifies a repeated correction pattern, it creates a candidate skill draft
- Draft lands in `.agents/candidate/`, not directly in `.agents/skills/`
- Draft must pass promotion gates before becoming active
- Distillation must not overwrite active skills or instructions directly

### Measurable exit criteria

These replace the earlier aspirational statements:

| Old criterion | New testable criterion |
|---|---|
| "Meta-Harness can explain every change" | Every promoted skill has a promotion_decision ID linking to decision log |
| "Meta-Harness can block itself" | Promotion gate blocks when eval fails or permissions expand without decision |
| "Meta-Harness can roll back itself" | `skill rollback` restores previous version from hash and quarantines current |
| "Meta-Harness can delegate without leaking authority" | Permission diff gate catches allowed_tools / forbidden_paths changes |

### Exit criteria

- [x] One repeated correction becomes one candidate skill in `.agents/candidate/`
- [x] Candidate skill stays inactive until eval passes
- [x] Promotion writes skill-registry entry with content_hash, rollback_hash, previous_version_hash, and promotion_decision
- [x] Permission expansion requires decision evidence — preflight and promotion block without it
- [x] Rollback restores previous active skill version from hash
- [x] Bad candidate can be deleted from `.agents/candidate/` without affecting active skills
- [x] Distillation creates drafts in candidate/, never directly in skills/
- [x] All promotion and rollback events append to events.jsonl
- [x] Tests cover: successful promotion, blocked promotion (missing/failing evidence), blocked promotion/preflight permission expansion, rollback, and quarantine

---

## Phase 13A — Context Quality Gate (interim implementation subphase)

Purpose: add a context sufficiency gate before multi-repo rollup, without renumbering Phase 13 or Phase 14.

Current status: locally implemented under D033 after D032 planning. Source design lives in `docs/product/phase-13a-context-gate-plan.md`. The phase exists because the next bottleneck is not more worker fanout or larger context volume; it is deciding whether each phase transition has enough compact, fresh, evidence-backed context for a fresh worker to proceed without guessing.

### Operating rule

```text
A round may proceed only when Meta-Harness can produce a compact,
evidence-backed context packet for the next phase.
```

### Implemented surfaces

- `templates/contracts/context-gate-schema.json`
- `templates/skills/context-quality-gate.md`
- `templates/skills/context-packet.md`
- `meta-harness context check`
- `meta-harness context packet`
- `meta-harness context ask`
- optional `MH_CONTEXT_GATE_001` ready validation when context artifacts exist

### Non-renumbering boundary

Phase 13 remains multi-repo rollup and Phase 14 remains controlled autonomy until a separate roadmap-renumber decision says otherwise. Phase 13A is an interim gate that protects those later phases from scaling vague or stale local context.

### Exit criteria

- [x] Context gate schema is packaged as a source template.
- [x] Context quality gate and context packet skill templates are packaged.
- [x] Gate output distinguishes structural hard blockers, evidence gaps, and unknown dimensions.
- [x] Valid hints can satisfy evidence gaps but cannot clear structural blockers.
- [x] Local context outputs stay under `.meta-harness/local/context/` by default.
- [x] Tracked `.meta-harness/context/` artifacts require explicit archival and redaction.
- [x] Ready validates present context artifacts by shape/freshness only and skips absent surfaces as not applicable.

---

## Phase 13 / Phase 17 — Multi-repo rollup

Purpose: dashboard after truth. Only build cross-repo visibility after local truth, security, and release enforcement are stable. Parent reads child repos — parent never mutates child state.

### Current status

Phase 13's context-governance precursor work is implemented through D037. The first safe multi-repo visibility runtime slice is closed locally as the Phase 17 base pilot under D043. Phase 17B/17C ready freshness and drilldown is closed locally under D044. Phase 17D read-only drift warnings are implemented locally and closed under D045.

The approved Phase 17 surface is an extension of the existing poll command:

```text
meta-harness poll --rollup
meta-harness poll --rollup --json
```

No new top-level `meta-harness rollup` command is approved or implemented. This avoids increasing the public CLI command count beyond the already accepted warning boundary.

### Operating rule

```text
parent reads child truth
parent does not overwrite child truth
parent does not run child commands
parent does not promote, rollback, or quarantine child skills
parent does not mutate parent or child truth by default
```

### Implemented Phase 17 pilot

#### [DONE] `lib/repo-rollup.js`

Pure read-only aggregation from local files:

- reads parent `.meta-harness/repos.json`
- reads child `.meta-harness/ready.json` when present
- treats child `.meta-harness/ready.json` as authoritative when present
- enforces child `ready.json` freshness against `expires_after`
- classifies `expires_after <= now` as `stale`
- reports malformed or missing required `ready.json` fields as `invalid`
- requires `schema_version`, `generated_at`, `target`, `ok`, `redacted`, `expires_after`, and `checks`
- requires `redacted` to be true
- requires `checks` to be an array
- does not fall back to child `.meta-harness/status.md` or `.meta-harness/poll.md` when child `ready.json` exists but is stale or invalid
- falls back to child `.meta-harness/status.md` when child `ready.json` is absent
- reads child `.meta-harness/poll.md` only as secondary evidence when child `ready.json` is absent
- classifies child state as `ready`, `warned`, `failed`, `stale`, `unknown`, `missing`, or `invalid`
- emits schema_version `1.0.0`
- emits generated_from `local_files`
- emits explicit `not_changed` markers for child repos, child status, child events, parent status, and parent events

#### [DONE] `meta-harness poll --rollup [--json]`

Rollup output is deterministic Markdown by default and deterministic JSON with `--json`. JSON output includes `failing_checks` and `warning_checks`; Markdown output includes failed/warn check drilldown. It does not execute child commands and does not write by default.

`poll --rollup --write` is intentionally rejected because the first pilot slice is read-only output only. The existing `poll --write` behavior remains unchanged for non-rollup polling.

### Implemented Phase 17D read-only drift warnings

Phase 17D is warning-only and read-only. Readiness state remains based on ready/status/poll classification, not drift warnings alone. Drift warnings do not alter repo readiness state and do not make top-level `ok=false` by themselves.

Implemented locally:

- read-only cross-repo drift warnings
- template manifest drift warnings
- security policy surface drift warnings
- skill registry drift warnings
- minimal governance compatibility drift warnings
- JSON per-repo `drift_warnings`
- JSON `summary.drift_warnings`
- deterministic Markdown `DRIFT` lines
- warning-only behavior
- readiness state remains based on ready/status/poll classification
- read-only parent boundary preserved
- `poll --rollup --write` remains rejected

### Deferred from the broader dashboard/autonomy phase

The following remain future work, not Phase 17 base, Phase 17B/17C, Phase 17D, Phase 21A, or Phase 21B closure claims:

- dashboards
- daemon/scheduled scans
- child command execution
- child repo mutation
- auto-repair
- readiness refresh
- docs-only patch proposals
- write-enabled controlled autonomy pilot
- provider/network integration
- CI dashboard publishing
- parent status mutation from rollup output
- future action/autonomy phases

### Exit criteria

- [x] `meta-harness poll --rollup` reads configured child repo local health artifacts
- [x] Rollup produces Markdown summary with per-child state
- [x] Rollup produces JSON output with schema_version
- [x] Parent rollup reads ready.json/status.md/poll.md without executing tests/npm commands in child repos
- [x] Parent does not mutate child repo state
- [x] Parent does not mutate parent status/events/poll by default
- [x] `poll --rollup --write` is rejected to prevent accidental truth mutation
- [x] Tests snapshot parent and child files before/after rollup execution
- [x] No new top-level public command is added
- [x] No dependency or package change is added
- [x] Child ready.json freshness against expires_after is enforced
- [x] Stale readiness is reported
- [x] Malformed/missing required ready.json fields are reported as invalid
- [x] redacted true is required
- [x] checks array is required
- [x] ready.json remains authoritative when stale/invalid
- [x] JSON failure/warning drilldown is available
- [x] Markdown failure/warning drilldown is available
- [x] Cross-repo template/security/skill/governance drift warnings are reported under Phase 17D
- [x] JSON per-repo `drift_warnings` is available
- [x] JSON `summary.drift_warnings` is available
- [x] Markdown deterministic `DRIFT` lines are available
- [x] Drift warnings are warning-only and do not alter readiness state
- [x] Drift warnings alone do not make top-level `ok=false`
- [x] Phase 21A controlled autonomy dry-run plan and approval receipt validation are implemented locally
- [x] Phase 21B approved manual-work packet is implemented locally
- [x] Phase 21C approved packet materialization is implemented locally
- [x] Phase 21D approved packet artifact verification is implemented locally
- [x] Phase 21E read-only operator execution plan is implemented locally
- [ ] Write-enabled controlled autonomy pilot is implemented (future slice)
- [ ] Scheduled scans/readiness refresh/docs-only patch proposals are implemented (future slice)

---

## Phase 14 — Controlled autonomy pilot

Purpose: allow only low-risk, reversible, observable autonomy. All autonomous agent actions run strictly in proposal-only mode.

Allowed:
- read-only scheduled scans
- readiness refresh
- docs-only owned-path patch proposals (restricted to proposal_only branch/worktree, never main)
- local ignored reports
- PM brief generation from checked state

Human-required:
- release/publish
- workflow changes
- dependency additions
- security policy changes
- domain rule authority
- provider/runtime access
- public skill promotion
- permission expansion
- write-enabled subagent fanout

Exit criteria:
- [ ] One read-only scheduled scan runs and appends a redacted event
- [ ] One docs-only owned-path patch is proposed but not self-published
- [ ] Security, release, domain, dependency, workflow, and permission changes cannot self-approve
- [ ] All autonomy events are redacted and traceable
- [ ] Autonomy actions write only to branch/worktree or proposal artifact (never main)
- [ ] Rollback/disable path exists for the autonomy trigger
