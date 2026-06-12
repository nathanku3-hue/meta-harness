# Phase 13B Context Gate Dogfood and Readiness Integration Plan

Status: patched plan pending audit
Date: 2026-06-12
Depends on: D033 Phase 13A Context-Quality-Gate Implementation Authorization

## Purpose

Phase 13B hardens the Phase 13A local context gate by dogfooding it against
this repository, expanding deterministic verdict coverage, and proving the
ready integration remains read-only.

This phase must not claim the dogfood result is semantically useful until the
audit-discovered scoring and target-routing gaps below are fixed and tested.

## Audit Findings To Patch Before Implementation

The first dogfood pass found real gaps. Phase 13B must address these before
adding broader docs or readiness claims.

### 1. Placeholder status values must not score as evidence

Current repo evidence:

- `.meta-harness/status.md` contains `Goal: Not set.`
- `lib/context-gate-scoring.js` currently treats any non-empty goal text as
  product outcome evidence.
- The dogfood run scored `product_outcome: 8`, which is too high for a
  placeholder goal.

Required Phase 13B fix:

- Add placeholder detection for status fields used as semantic evidence,
  including at minimum `Not set.`, `not set`, `none`, `n/a`, `todo`, empty
  boilerplate, and whitespace-only values.
- Treat placeholder goal/current-truth/next-action values as absent evidence,
  not as weak evidence.
- Add focused tests proving a placeholder goal cannot raise
  `product_outcome` and produces an unknown/evidence-gap question when no real
  product outcome is present.
- Re-run dogfood after the fix and record the new score behavior.

Acceptance:

- A fixture with `Goal: Not set.` does not receive product-outcome credit for
  that field.
- The product outcome summary does not echo placeholder text as useful context.
- The dogfood result is re-recorded after this change.

### 2. `context --target` must either work or disappear from Phase 13B docs

Current repo evidence:

- Examples use `--target .`.
- `lib/commands/context.js` passes both `cwd` and `targetRoot` as
  `context.cwd`, so `meta-harness context check --target other-repo ...`
  still checks the current directory.

Required Phase 13B fix:

- Implement real `--target <repo>` support for `context check`,
  `context packet`, and `context ask`, using the target repository as
  `targetRoot` while preserving the caller `cwd`.
- If full target support cannot be safely implemented in this phase, remove
  `--target` from every Phase 13B command, README example, walkthrough example,
  and test expectation.

Preferred acceptance:

- Running `context check --target <fixture-or-temp-repo>` from outside that
  target reads the target repo's `.meta-harness` state and package metadata.
- Running `context packet --target <repo> ROUND-NNN --for worker --json` reads
  the artifact from the target repo.
- Running `context ask --target <repo> ROUND-NNN --json` reads questions from
  the target repo.
- CLI tests fail if `--target` is ignored.

### 3. Excellent verdict coverage must prove file evidence, not hint math

Current repo evidence:

- `lib/context-hints.js` caps hints at 9.
- `lib/context-gate-artifact.js` rounds the average score.
- A single hinted 9 plus otherwise-10 scores can still round to an
  `excellent` verdict.

Required Phase 13B fix:

- The excellent fixture must not rely on hints.
- Add narrow 10-point file-evidence markers for dimensions currently capped
  below 10 by construction: product outcome, scope boundary, repo/stack, and
  owned surface. These markers must be specific, auditable evidence additions,
  not broad scoring-model expansion.
- Add direct test coverage that `excellent` requires file-derived 10s for every
  scoring dimension after those narrow markers are implemented.
- Add a regression test proving a hinted 9 on any dimension cannot be the only
  reason an artifact reaches `excellent`.

Acceptance:

- The excellent fixture has no hints file and produces score 10 from harness
  and repo evidence alone.
- Product outcome, scope boundary, repo/stack, and owned surface each have a
  documented, narrow file-evidence path to 10.
- A fixture with one valid hint capped at 9 and otherwise strong evidence does
  not pass the "excellent requires file evidence" test unless every dimension
  still has file evidence for 10.

### 4. Read-only ready coverage must snapshot the filesystem

Current repo evidence:

- `tests/cli-ready-context-gate.test.js` validates status shape, but does not
  prove `ready --quick --read-only` avoids writes.

Required Phase 13B fix:

- Add a strict before/after filesystem snapshot around
  `ready --quick --read-only --json`.
- Assert no new files, directories, or context artifacts are created.
- Specifically assert no new `.meta-harness/local/context/` or
  `.meta-harness/context/` artifacts appear when the surface was absent before
  the read-only ready run.

Acceptance:

- The new test fails if read-only ready creates any context gate artifact.
- The test validates both absent-context and present-context paths.

## Dogfood Baseline From Audit

The audit dogfood run on this repo produced:

- `intake->plan`: blocked
- `plan->work`: blocked
- `work->verify`: blocked
- `overall_score: 1` for all three transitions
- Only unresolved dimension: `owned_surface`
- One question: "Which files or directories are owned, and which are
  forbidden?"
- `context ask`, `context packet`, and
  `ready --quick --read-only --json` worked.
- `MH_CONTEXT_GATE_001` passed shape/freshness validation on the blocked
  artifact.
- Temporary local artifacts were cleaned up after the run.

The same audit also exposed the placeholder scoring problem, so the baseline is
useful as a bug report but not sufficient as semantic proof. Phase 13B must
re-run dogfood after fixes 1 and 2.

Audit verification baseline:

```bash
node --test tests/context-gate.test.js tests/cli-context.test.js tests/cli-ready-context-gate.test.js
```

Expected baseline result before Phase 13B changes: `19/19` passing.

## Proposed Implementation Components

### Component 1: Scoring bugfix and tests

Modify:

- `lib/context-gate-scoring.js`
- `tests/context-gate.test.js`
- relevant context-gate fixtures

Add deterministic tests for placeholder field handling:

- `Goal: Not set.` is not product outcome evidence.
- Placeholder text in `Current truth`, `Next action`, `Stop criteria`, and
  `Pending human decisions` does not count as meaningful semantic evidence
  where those fields influence scores.
- Real non-placeholder values continue to score as before.

### Component 2: Real `--target` support or doc removal

Preferred implementation:

- Update `lib/commands/context.js` to resolve `--target`.
- Pass caller `cwd` and resolved `targetRoot` separately into context gate,
  packet, and question helpers.
- Add CLI integration tests that run from one directory while targeting another.

Fallback implementation:

- Remove `--target` from Phase 13B examples and tests.
- Update docs to state context commands operate on the current working repo.

The preferred path should be used unless implementation risk is discovered.

### Component 3: Verdict fixture expansion

Create or update fixtures under `tests/fixtures/context-gate/`:

| Fixture | Target verdict | Required property |
| --- | --- | --- |
| `narrowed` | `narrowed` score 6-7 | Moderate evidence with narrowed scope |
| `proceed` | `proceed` score 8-9 | Strong evidence, but not all dimensions are 10 |
| `excellent` | `excellent` score 10 | All dimensions reach 10 from file evidence only, using the narrow 10-point markers where current scoring caps below 10 |
| `placeholder-goal` | `blocked` or product-outcome unknown | Placeholder status fields do not score |
| `applicable-false` | ready skip | No context surface exists |

Test additions:

- `narrowed fixture produces narrowed verdict with score 6-7`
- `proceed fixture produces proceed verdict with score 8-9`
- `excellent fixture produces excellent verdict with score 10 and no hints`
- `hint-capped fixture cannot prove excellent by hint math alone`
- `context ask emits max 3 questions for blocked verdict`
- `context ask emits 0 questions for excellent verdict`
- `applicable false when no context surface exists`

### Component 4: CLI coverage

Add to `tests/cli-context.test.js`:

- `context check on narrowed fixture emits narrowed verdict via CLI`
- `context packet on proceed fixture generates compact worker packet`
- `context check --target reads the target repo from outside its directory`
- `context ask --target reads target repo context questions`

If `--target` is removed instead of implemented, replace the two target tests
with tests proving unsupported target usage is rejected and docs do not contain
target examples.

### Component 5: Ready read-only non-mutation coverage

Add to `tests/cli-ready-context-gate.test.js`:

- `ready --quick --read-only does not create context artifacts`
- `ready --quick --read-only does not mutate existing context artifacts`

Snapshot requirements:

- Capture all files under the target repo before and after.
- Compare path set plus content hash or base64 snapshot for each file.
- Do not rely on mtime assertions; Windows and filesystem timestamp granularity
  can make otherwise correct read-only tests flaky.
- Explicitly assert no new `.meta-harness/local/context/` or
  `.meta-harness/context/` entries are created.

### Component 6: README context gate section

After the implementation fixes and tests pass, add a README section after
`Clean-Code Governor`:

````markdown
## Context Quality Gate

`context` checks whether a round has enough compact, evidence-backed context
for a fresh worker to execute without guessing product intent, scope, or stop
rules:

```bash
meta-harness context check --target . --from plan --to work --round ROUND-013 --json
meta-harness context ask --target . ROUND-013 --json
meta-harness context packet --target . ROUND-013 --for worker --json
```

The gate scores eight dimensions: product outcome, scope boundary, repo/stack,
owned surface, evidence plan, risk/stop rules, freshness, and handoff
completeness. It returns `blocked`, `narrowed`, `proceed`, or `excellent`.

- `blocked`: answer the blocker-clearing questions before proceeding.
- `narrowed`: proceed only within the narrowed scope recorded in the packet.
- `proceed` or `excellent`: context is sufficient for a fresh worker.

Artifacts are written to `.meta-harness/local/context/` by default. Use
`--commit-artifact` to write tracked `.meta-harness/context/` artifacts after
redaction checks pass. `ready --quick --read-only` validates present artifacts
without creating new ones.
````

If `--target` is not implemented, remove `--target .` from the examples before
adding this section.

### Component 7: Walkthrough update

Update `walkthrough.md` with a Phase 13A/13B section that records:

- Phase 13A shipped local context gate surfaces.
- Phase 13B dogfood initially blocked all three transitions on missing owned
  surface.
- Placeholder status values were discovered and fixed before treating dogfood
  as semantic evidence.
- `ready --quick --read-only` validates context artifacts without creating
  them.

### Component 8: Decision log and status alignment

After audit accepts this plan, append D034 to `docs/product/decision-log.md`.

Draft:

```markdown
## D034: Phase 13B Context Gate Dogfood Authorization

Decision:

Authorize a bounded Phase 13B hardening pass for the Phase 13A local context
quality gate.

Scope:

- Fix placeholder status values so boilerplate such as `Not set.` is not
  treated as semantic context evidence.
- Add or remove `context --target` support consistently across implementation,
  tests, and docs.
- Exercise `context check`, `context packet`, and `context ask` against this
  repo after the fixes land.
- Add fixture coverage for blocked, narrowed, proceed, and excellent verdicts.
- Prove `excellent` requires file evidence and cannot be reached solely through
  capped hint math.
- Add README/walkthrough examples showing correct use.
- Prove `ready --quick --read-only --json` validates context artifacts without
  creating or mutating them.

Non-Goals:

- No multi-repo rollup.
- No Context7/MCP.
- No context dashboard.
- No auto-worker routing.
- No model/network scoring.
- No daemon.
- No tracked `.meta-harness/context/` artifacts by default.
```

Then update:

- `.meta-harness/status.md`
- `.meta-harness/events.jsonl`
- `implementation_plan.md`

These governance updates should happen only after this patched plan passes
audit.

## Required Dogfood Re-Run

After components 1 and 2 land, re-run:

```bash
node bin/meta-harness.js context check --target . --from intake --to plan --round ROUND-011 --json
node bin/meta-harness.js context check --target . --from plan --to work --round ROUND-012 --json
node bin/meta-harness.js context check --target . --from work --to verify --round ROUND-013 --json
node bin/meta-harness.js context ask --target . ROUND-013 --json
node bin/meta-harness.js context packet --target . ROUND-013 --for worker --json
node bin/meta-harness.js ready --target . --quick --read-only --json
```

If `--target` is removed instead of implemented, re-run the same commands
without `--target .`.

Dogfood question:

```text
Does the gate produce the correct next step with three or fewer questions when
context is incomplete, without granting semantic credit to placeholders?
```

Expected current-repo dogfood behavior after fixes:

- The gate may still block on `owned_surface` until owned and forbidden paths
  are recorded.
- It must not score placeholder goal text as product outcome evidence.
- It must produce at most three blocker-clearing questions.
- It must leave only ignored local artifacts unless explicit output flags are
  used.
- `ready --quick --read-only --json` must not create new context artifacts.

## Verification Plan

Focused verification:

```bash
node --test tests/context-gate.test.js tests/cli-context.test.js tests/cli-ready-context-gate.test.js
```

Full verification:

```bash
git diff --check
node bin/meta-harness.js quality check
node bin/meta-harness.js sync check --target .
node bin/meta-harness.js ready --target . --quick --read-only --json
npm test
```

## What This Phase Must Not Do

- No MCP, Context7, network, or model calls.
- No multi-repo rollup.
- No dashboard or daemon.
- No auto-worker routing.
- No tracked context artifacts by default.
- No release/publish automation.
- No weakening of ready, security, release, or redaction gates.
- No broad scoring-model expansion beyond the specific audited bugfixes and the
  narrow 10-point file-evidence markers required to make `excellent`
  testable.

## Audit Exit Criteria

This plan is ready for implementation only when audit agrees that:

- Placeholder evidence handling is mandatory.
- `--target` behavior is resolved consistently.
- Excellent fixture coverage proves file evidence, not hints.
- Read-only ready tests prove non-mutation through filesystem snapshots.
- Dogfood is re-run after the bugfixes, not treated as already complete.
