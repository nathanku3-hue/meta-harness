# Phase 12 Patch Plan

Status: reviewed and accepted for bounded first implementation slice
Roadmap phase: Phase 12 - Self-evolution prototype
Implementation status: D027 authorizes only the first promotion-preflight slice
Start implementation: D027 records post-review implementation start for the bounded first slice only
Release status: still governed by the Phase 10 release evidence hold
Publish: no
Runtime code before D027: no
Runtime code after D027: read-only promotion preflight only
New commands before D027: no
New commands after D027: read-only `meta-harness skill preflight` only
Skill registry writes: no
Active skill promotion: no
Autonomy expansion: no
Decision-log entries: D026 planning authorization; D027 implementation-start authorization

## Goal

Phase 12 makes self-improvement governed, reversible, and reviewable. The system may eventually propose changes to its own skills, but it must not silently promote them, expand permissions, or rewrite active guidance.

Phase 12A recorded the plan, boundaries, first slice, validation gates, and implementation-start criteria before any code changes began. D027 accepts this plan for the bounded first implementation slice only.

## Why Phase 11 Unblocks Planning

Phase 11 proved that a high-risk governance capability can be activated as a bounded, evidence-backed pilot instead of as a broad framework. The D025 G9 Quant pilot has a recorded adopter, reviewer, governed-data boundary, ready evidence, pilot chain, and passing governance check.

That exit evidence unblocks Phase 12 planning because Phase 12 can now reuse the same operating pattern:

- one bounded first slice
- explicit non-goals
- separate implementation-start decision
- validation before promotion
- release-policy isolation
- no broad framework claims

This did not mean Phase 12 implementation had started. Implementation starts only with D027 and only for the bounded promotion-preflight slice.

## Review Acceptance

The Phase 12 plan was reviewed by an independent Codex subagent planning audit on 2026-06-09. The review accepted the planning boundary and identified two required pre-implementation edits:

- record a separate post-review implementation-start decision ID
- replace generic future validation language with concrete first-slice ready and test expectations

D027 records the implementation-start decision after that review. D027 does not authorize active promotion, registry writes, distillation integration, rollback execution, release automation, publish behavior, tags, version bumps, provenance publishing, or autonomy expansion.

## Implementation Start Criteria

Phase 12 first-slice implementation is unblocked only when all of these are true:

- Phase 11 D025 bounded pilot exit is recorded in roadmap, status, and decision log.
- This Phase 12 patch plan exists.
- This Phase 12 patch plan has been reviewed and accepted.
- Phase 12 scope is bounded to a first reviewable slice.
- Phase 12 non-goals are explicit.
- Release impact is classified.
- Ready and test expectations are listed.
- No Phase 10 publish guard is weakened.
- A decision ID exists for Phase 12 implementation start.

D026 is not that implementation-start decision. D026 authorizes only the docs/status planning patch. D027 is the implementation-start decision for the bounded promotion-preflight slice only.

## First Implementation Slice

The first implementation slice authorized by D027 is a promotion preflight slice only:

- candidate skill directory shape validation for `.agents/candidate/<skill-name>/SKILL.md`
- inactive-candidate enforcement, proving candidate skills are not treated as active guidance
- permission-diff detection for candidate vs active skill metadata
- fail-closed promotion preflight result when eval, permission, complexity, or rollback evidence is missing
- focused tests for successful preflight and blocked preflight

Reviewable output for this slice is limited to a read-only preflight result and tests. The first slice must not move files into `.agents/skills/`, write `.meta-harness/skill-registry.json`, integrate distillation, quarantine active skills, execute rollback behavior, publish provenance, or add publish/release behavior.

## Non-Goals

Phase 12 first-slice implementation does not include:

- runtime code outside read-only promotion preflight
- new commands outside `meta-harness skill preflight`
- policy weakening
- release-ready claims
- publish automation
- tags or version bumps
- registry writes
- provenance publishing
- active skill promotion
- rollback execution
- distillation integration
- broad skill framework work
- autonomy expansion
- `.meta-harness/events.jsonl` append

## Release Impact

Release impact: local development only for the D027 first slice.

The Phase 10 release evidence hold remains active. Publish remains guarded by `prepublishOnly` and must continue to fail closed unless required external evidence changes and is recollected for the exact release commit. A dirty-tree release-check failure before commit is acceptable fail-closed evidence, but it does not prove the external evidence hold is the active blocker.

## Ready And Test Expectations

Phase 12A docs/status-only validation expects:

- `node bin/meta-harness.js decisions scan --target .` passes
- `node bin/meta-harness.js state check --target .` passes
- `node bin/meta-harness.js release check --publish --json` fails closed
- no `npm test` run is required because no runtime code, command, package, workflow, or policy code changes are included

Phase 12 D027 first-slice implementation validation expects:

- `node --test tests/skill-registry.test.js tests/cli-skill.test.js` passes
- `npm test` passes before merge
- `node bin/meta-harness.js ready --target . --quick --read-only --json` passes, or any failure is reported as a blocker before merge
- `node bin/meta-harness.js release check --publish --json` fails closed with `release_ready: false` unless Phase 10 external evidence is separately satisfied
- `node bin/meta-harness.js skill preflight <candidate-skill> --target <fixture> --json` reports read-only pass/fail results in focused tests
- `git diff -- package.json package-lock.json .github` is empty unless a separate decision authorizes release, workflow, dependency, or package metadata changes

## Validation Gates

Before branch creation:

```powershell
$expected = "2b04dfef59b7b1936d5712f35c5a2bc7fedf6d7a"
$branch = "codex/phase12-planning-doc-only"

git switch main
git pull --ff-only

$actual = git rev-parse HEAD
if ($actual -ne $expected) {
  throw "main moved from $expected to $actual; stop and re-run audit"
}

$status = git status --porcelain
if ($status) {
  throw "working tree is not clean before branch creation: $status"
}

git show-ref --verify --quiet "refs/heads/$branch"
if ($LASTEXITCODE -eq 0) {
  throw "branch already exists: $branch"
}

git show-ref --verify --quiet "refs/remotes/origin/$branch"
if ($LASTEXITCODE -eq 0) {
  throw "remote branch already exists: origin/$branch"
}

$hasD026 = Select-String -Path docs/product/decision-log.md -Pattern "D026" -Quiet
if ($hasD026) {
  throw "D026 already exists; stop to avoid duplicate decision entry"
}
```

After patch:

```powershell
$expectedFiles = @(
  ".meta-harness/status.md",
  "docs/product/decision-log.md",
  "docs/product/phase-12-patch-plan.md",
  "docs/product/roadmap.md"
)

$actualFiles = @(
  git diff --name-only
  git ls-files --others --exclude-standard
) | Sort-Object
$delta = Compare-Object ($expectedFiles | Sort-Object) $actualFiles -SyncWindow 0
if ($delta) {
  $delta | Format-Table | Out-String | Write-Host
  throw "changed/untracked file set does not match expected four-file scope"
}

$expectedStatus = @(
  "M`t.meta-harness/status.md",
  "M`tdocs/product/decision-log.md",
  "A`tdocs/product/phase-12-patch-plan.md",
  "M`tdocs/product/roadmap.md"
) | Sort-Object

$actualStatus = @(
  git diff --name-status
  git ls-files --others --exclude-standard | ForEach-Object { "A`t$_" }
) | Sort-Object
$statusDelta = Compare-Object $expectedStatus $actualStatus -SyncWindow 0
if ($statusDelta) {
  $statusDelta | Format-Table | Out-String | Write-Host
  throw "changed file statuses do not match expected docs/status-only patch"
}

git diff --check
if (Select-String -Path docs/product/phase-12-patch-plan.md -Pattern "[ \t]+$") {
  throw "trailing whitespace in docs/product/phase-12-patch-plan.md"
}
git status --porcelain
git diff --stat
$numstat = @(
  git diff --numstat
  git diff --no-index --numstat -- /dev/null docs/product/phase-12-patch-plan.md 2>$null
)
if ($numstat | Where-Object { $_ -match "^-|`t-" }) {
  $numstat | Write-Host
  throw "diff contains non-text/binary-style numstat output"
}
$numstat

node bin/meta-harness.js decisions scan --target .
node bin/meta-harness.js state check --target .
node bin/meta-harness.js release check --publish --json
```

Expected pre-commit validation:

- only the four allowed docs/status files changed
- exact file statuses are three modified files and one added plan file
- `git diff --check` passes
- `git diff --numstat` has no non-text/binary-style `-` entries
- decisions scan passes
- state check passes
- release check runs and fails closed, or unsupported/missing-command status is reported distinctly
- if release check fails because the tree is dirty, that is acceptable before commit but does not prove the external evidence hold

Pre-commit staged validation, if a commit is created:

- `git diff --cached --name-only` must match the same four-file scope before committing
- `git diff --cached --name-status` must match the same three-modified, one-added scope before committing

Post-commit validation, if a commit is created later:

- `git diff --name-status HEAD~1..HEAD` must match the same three-modified, one-added scope
- `node bin/meta-harness.js release check --publish --json` must still fail due to the Phase 10 external evidence hold unless external evidence has explicitly changed

## Rollback / Fail-Closed Behavior

Phase 12A rollback is a docs/status revert only. It must not require registry cleanup, event-log cleanup, tag deletion, package changes, or runtime migration.

Future Phase 12 implementation must fail closed:

- candidate skills remain inactive by default
- promotion blocks when eval evidence is missing or failing
- permission expansion blocks without a decision
- rollback blocks when previous active hash evidence is missing
- distillation may draft candidates but must not overwrite active skills
- release readiness remains governed by Phase 10 evidence policy
