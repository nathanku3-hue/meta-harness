# Meta-Harness Roadmap — Local-Audit-Driven Revision

Status: active baseline
Approval scope: Phases 0-7 accepted baseline; Phase 8 planning-only; Phase 9 transition/adoption baseline; Phase 10 implementation complete through the release evidence contract and release-held; Phase 11 D025 G9 Quant pilot active as bounded first slice
Hold: Phase 10 release readiness is blocked by missing external GitHub/security evidence, not code. Publish remains guarded by `prepublishOnly` and fails closed. Phase 11 is active only for the bounded D025 G9 Quant pilot; expansion requires a separate decision. Phases 12-14 remain future prototypes.
Date: 2026-06-09
Decision: D021 status reset; D022 complexity metadata adoption; D023 Phase 10D blocked release evidence; D024 Phase 10 implementation closed release-held; D025 Phase 11 G9 Quant pilot activated; D017-D020 remain source decisions

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
| 5 | Minimum security baseline | concrete | implemented locally; GitHub settings partial |
| 6 | Ship-fast enforcement loop | concrete | accepted baseline |
| 7 | One-skill pilot | buildable | accepted baseline |
| 8 | Read-only subagent scout pilot | buildable | planning-only; implementation not started |
| 9 | Complexity governor expansion | buildable | transition/adoption baseline; complexity metadata separately marked adopted |
| 10 | Release/package enforcement | buildable | implementation complete through release evidence contract; release-held because external GitHub/security evidence is missing; publish guarded and fails closed |
| 11 | Domain governance pilot (adopter required) | prototype | D025 G9 Quant pilot active for real downstream adopter; bounded to FINRA short-interest signal-card chain; no broad framework implementation |
| 12 | Self-evolution prototype | prototype | future prototype |
| 13 | Multi-repo rollup | prototype | future prototype |
| 14 | Controlled autonomy pilot | prototype | future prototype |

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

Current status: planning-only by D020. `docs/product/phase-8-readonly-scout-plan.md` is allowed planning evidence; it does not start scout execution, subagent activation, commands, tests, promotion, package changes, workflow changes, or repo writes.

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

- [ ] Scout packets have bounded paths, forbidden paths, and allowed commands
- [ ] Scout output is structured JSON matching return_schema
- [ ] Reconciler validates scout claims against repo state
- [ ] Main agent / reconciler remains the only authority
- [ ] No subagent writes to repo in this phase
- [ ] Fanout budget exists and limits concurrent scouts and context size
- [ ] Tests cover scout packet generation, reconciler dedup, and budget enforcement

---

## Phase 9 — Complexity governor expansion

Purpose: prevent the project from becoming unmaintainable as capability grows. The quality ratchet already works for file line budgets; this phase extends it to architecture-level controls.

Current status: accepted in transition/adoption mode. Complexity policy metadata is separately marked adopted in `.meta-harness/complexity-policy.json`; that metadata signal does not claim every Phase 9 architecture and quality exit criterion is complete unless a separate Phase 9 closure decision records broader acceptance.

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

Current status: Phase 10 implementation is complete through the release evidence contract and is release-held. The local read-only release check reports package/release posture, clean-tree status, and external/full release evidence status. The `prepublishOnly` package guard runs publish mode and fails closed unless `release_ready` is true. For the live Phase 10D evidence, `local_ok` is true, `external_evidence_ok` is false, `release_ready` is false, and publishing remains blocked. The next release action is external GitHub/security evidence availability or repository-setting change followed by exact-commit evidence recollection, not more Phase 10 code. Publish automation, registry behavior, tags, CI publish workflow, version bumping, provenance publishing, and accepted external/publish evidence remain absent.

### Problem

The `package.json "files"` field already limits published contents to bin/, lib/, docs/product/, docs/sop/, templates/, and README.md. Phase 10 now has a local read-only release-check surface, package publish-boundary guard, and read-only external/full release evidence contract, but the release remains held because the live external GitHub/security evidence does not satisfy policy. The full release gate still does not:

1. Execute and verify package dry-run output against a forbidden-path list
2. Enforce a clean git tree before an actual release, beyond the local status signal
3. Require full `meta-harness ready` and test execution before publish
4. Verify trusted publishing, registry, tag, and repository-setting evidence

### Deliverables

#### [NEW] lib/release-check.js

Full Phase 10 target: a pre-publish gate that runs:

Implemented subset: local read-only checks for release policy, package identity/metadata, npm lifecycle posture, reproducibility posture, quality baseline, read-only ready status, test-script eligibility, package dry-run eligibility, clean-tree status, and external/full evidence status. Test execution, package dry-run execution, tarball smoke testing, trusted publishing verification, and publish automation remain future work.

| Check | Failure condition |
|---|---|
| Clean tree | `git status --porcelain` is non-empty |
| Tests pass | `npm test` exits non-zero |
| Ready passes | `meta-harness ready --target .` (runs full posture checks and tests, no quick mode) exits non-zero |
| Package contents | `npm pack --dry-run --json` output matches forbidden-path regex, or inspection of generated tarball list fails |
| Version bump | package.json version matches git tag (SKIP check if no tag is specified or current commit is not tagged) |

Pre-publish checks also run:
- Tarball Install Smoke Test: after dry-run, install the packed tarball in a temp project and run CLI smoke test (e.g. executing `meta-harness --version`) to verify package contents and local install success.
- Dependency Review check: runs dependency-review-action or equivalent in CI to block pull requests that introduce vulnerable or risky dependency versions. Must be configured as a required check in CI for pull requests affecting package files.
- npm trusted publishing / OIDC: future publish mode should verify this; `release check --publish` fails closed on current release readiness and has no publish automation.
- CODEOWNERS enforcement: verify branch protection rules require review from code owners before pull request merge.
- Release Incident / Rollback Policy: if release check passes but the publish step fails midway, automatically delete the git tag locally and remotely ONLY if the package was not actually published, the tag was created by the current attempt, and no remote consumer has retrieved it. If package was partially published, tag deletion is forbidden; follow registry immutable version rules, run npm deprecate or unpublish where applicable, and log a failed publish event.

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

Current status: D025 activates a real downstream G9 Quant pilot for `E:\Code\Quant-g9-market-behavior-signal-card`, remote `https://github.com/nathanku3-hue/Quant.git`, branch `codex/v2-d0-wrds-permission-snapshot-provenance-20260601`, HEAD `61edd14949fc8a7d7232748c27f75e7706010490`. The pilot is bounded to the FINRA short-interest G9 market-behavior signal card. Downstream `meta-harness ready` passed with `ok: true`, `passed: 12`, `failed: 0`, state hash `ed879a175a5872ec0ff90aa54b03f62264c0df54d52dc7429a85ecad6ec46332`, generated at `2026-06-09T02:45:07.298Z`. `meta-harness domain-governance check` passed for `D025` / `PHASE11-G9-FINRA-SHORT-INTEREST-001` with 9 pass and 0 fail. No broad Phase 11 framework or core implementation is active.

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

#### [NEW] lib/domain-check.js

Checks:

1. No domain code without fact_id reference
2. No fact without source and effective_date
3. No ontology term without owner
4. No mapped fact without golden case
5. Expired facts block release
6. Domain reviewer can trace every rule from source to code

### Domain examples by vertical

| Domain | Source | Fact | Ontology | Code | Golden case |
|---|---|---|---|---|---|
| Quant | ISDA definitions | day count convention ACT/360 | day_count_convention | calculateActual360() | known date pair → fraction |
| Sport science | sensor protocol spec | VO2max measurement schema | vo2max_ml_kg_min | computeVO2Max() | known gas exchange → value |
| Law | statute/regulation | tax threshold for FY2026 | income_tax_bracket | computeTax() | known income → tax owed |

### Exit criteria

- [ ] Activation trigger met (real adopter with domain code)
- [ ] One real domain rule maps source → fact → ontology → code → golden case
- [ ] No domain code exists without fact_id reference
- [ ] No fact exists without source and effective_date
- [ ] No mapped fact exists without golden case
- [ ] Expired facts block release
- [ ] Domain check integrates with `meta-harness ready`

---

## Phase 12 — Self-evolution prototype

Purpose: make self-improvement governed, not free-running. The system may propose changes to itself, but it cannot silently promote them. This replaces the earlier aspirational criteria ("Meta-Harness can explain every change") with measurable testable gates.

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

A candidate skill must NOT be read by agents as active guidance. Only promoted skills in `.agents/skills/` are active.

#### [NEW] lib/skill-promotion.js

Promotion gate that checks before moving a candidate to active:

| Gate | Failure condition |
|---|---|
| Eval pass | Skill eval command exits non-zero |
| Security check | Skill expands allowed_tools, removes forbidden_paths, or adds write access without decision inbox entry |
| Complexity check | Skill adds files that violate line budgets |
| Permission diff | New version expands permissions vs previous active version |
| Rollback path | No rollback_hash recorded for current active version |

#### [MODIFY] meta-harness skill promote

```text
meta-harness skill promote <skill-name>

PROMOTION: BLOCK

FAIL  permission-diff   new version adds "run_command" to allowed_tools
PASS  eval              2/2 evals pass
PASS  security          no forbidden_path removals
PASS  complexity        SKILL.md under budget
PASS  rollback          previous hash recorded

Decision required: approve permission expansion via decision inbox
```

#### [MODIFY] meta-harness skill rollback

```text
meta-harness skill rollback <skill-name>
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

- [ ] One repeated correction becomes one candidate skill in `.agents/candidate/`
- [ ] Candidate skill stays inactive until eval passes
- [ ] Promotion writes skill-registry entry with version_hash and promotion_decision
- [ ] Permission expansion requires decision inbox entry — promotion blocks without it
- [ ] Rollback restores previous active skill version from hash
- [ ] Bad candidate can be deleted from `.agents/candidate/` without affecting active skills
- [ ] Distillation creates drafts in candidate/, never directly in skills/
- [ ] All promotion and rollback events append to events.jsonl
- [ ] Tests cover: successful promotion, blocked promotion (eval fail), blocked promotion (permission expansion), rollback, quarantine

---

## Phase 13 — Multi-repo rollup

Purpose: dashboard after truth. Only build cross-repo visibility after local truth, security, and release enforcement are stable. Parent reads child repos — parent never mutates child state.

### Problem

The `poll` and `repos` commands already exist. `repos.json` defines child repos. `meta-harness poll --write` reads child statuses. But there is no:

1. Aggregated rollup view showing all child repo health at a glance
2. Color-coded pass/warn/fail summary per child
3. Cross-repo drift detection (template version drift, security policy drift)
4. Machine-readable rollup for CI or external dashboards

### Operating rule

```text
parent reads child truth
parent does not overwrite child truth
parent does not run child commands
parent does not promote, rollback, or quarantine child skills
broken child state appears as red/yellow/green with exact failed check
```

### Deliverables

#### [MODIFY] meta-harness poll

Extend poll to run `ready --target <child> --json` against each child repo and collect results.

#### [NEW] .meta-harness/ready.json contract
The ready.json artifact is generated by running meta-harness ready --json.
- Location: .meta-harness/ready.json
- Schema & Fields: Must contain schema_version (e.g. "1.0.0"), generated_at (ISO timestamp), target, meta_harness_version, mode, ok (posture result), redacted: true (proving redactions passed), expires_after (freshness window ISO timestamp), and checks array.
- Freshness policy: Rollup commands must verify that child ready.json is not stale by checking expires_after against current time. Stale files trigger warnings/unknown state.

#### [NEW] lib/rollup.js

Aggregates child repo ready results into a single rollup:

```json
{
  "timestamp": "2026-08-XX",
  "repos": [
    {
      "name": "child-a",
      "path": "../child-a",
      "ready": true,
      "passed": 10,
      "failed": 0,
      "checks": []
    },
    {
      "name": "child-b",
      "path": "../child-b",
      "ready": false,
      "passed": 7,
      "failed": 3,
      "failing_checks": [
        { "id": "MH_SYNC_001", "reason": "5 templates missing" },
        { "id": "MH_STATE_001", "reason": "missing status.md" },
        { "id": "MH_SECURITY_001", "reason": "no SECURITY.md" }
      ]
    }
  ],
  "summary": {
    "total": 2,
    "ready": 1,
    "not_ready": 1
  }
}
```

#### [NEW] meta-harness rollup

```text
meta-harness rollup

ROLLUP: 1/2 repos ready

🟢 child-a    10/10 pass
🔴 child-b     7/10 pass
   FAIL  MH_SYNC_001      5 templates missing
   FAIL  MH_STATE_001     missing status.md
   FAIL  MH_SECURITY_001  no SECURITY.md
```

#### [MODIFY] .meta-harness/status.md (parent)

When rollup runs, append child summary to parent status:

```md
## Child Repos

| Repo | Ready | Pass | Fail | Top Issue |
|---|---|---|---|---|
| child-a | ✅ | 10/10 | 0 | — |
| child-b | ❌ | 7/10 | 3 | 5 templates missing |
```

#### Cross-repo drift detection

Compare across children:

- Template version: are all children on the same installed template set?
- Security policy: do all children have SECURITY.md, CODEOWNERS, dependabot.yml?
- Skill registry: are active skills consistent or diverging?

Report drift as warnings, not blocks. Child repos remain authoritative over their own state.

### Exit criteria

- [ ] `meta-harness rollup` reads one or more child repo statuses
- [ ] Rollup produces markdown summary with pass/fail per child
- [ ] Rollup produces JSON output for CI consumption with schema_version
- [ ] Parent rollup uses ready --read-only --no-exec or ready.json to read child health without executing tests/npm commands in the child repo
- [ ] Parent checks child ready.json freshness against expires_after contract
- [ ] Parent does not mutate child repo state
- [ ] Broken child state shows as red/yellow/green with exact failing check IDs
- [ ] Cross-repo template/security drift is reported as warnings
- [ ] Engineer can drill from rollup summary to exact child check failure

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
