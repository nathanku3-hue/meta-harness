# Plan: 22A-H — Harden Execution Readiness Gate (no 22B)

**Status:** approved and implemented under D065  
**Scope:** complete and harden Phase 22A as a hard, tested, fail-closed worker gate  
**Explicit non-goal:** no 22B execution authority, no child-repo mutation surface, no generalized execution

---

## Context

Audit verdict: **do not move to 22B**. Current uncommitted 22A work is directionally correct (resolver + readiness builder + poll wiring + markdown + tests) and full `npm test` passed (96 files / 0 fail). It is **not** closable as a live worker gate yet.

| Blocker | Evidence (local) |
|---|---|
| Quality BLOCK | `lib/commands/poll.js` crossed command_module budget (216 > 200) |
| Quality BLOCK | `lib/dirty.js` crossed source budget (478 > 400) after adding `getRepoGitState` |
| Quality BLOCK | grandfathered test debt grew: `tests/poll-rollup-operator-execution-plan.test.js` 392 → 443 |
| Weak module contract | `buildExecutionReadiness()` only checks embedded plan ready; does **not** require `operatorPlanArtifactValidation.ok` |
| Fail-by-omission | poll only attaches `execution_readiness` when `resolution.ok`; missing object is ambiguous for workers |
| Wrong home | git inspection lives in `lib/dirty.js` (command/dirty-work oriented) |
| Incomplete tests | no clean/dirty/empty/detached/redaction/`runs_read_only_git_inspection` matrix |

**Trust chain (must stay intact):**

```
21F verified operator plan artifact
  → selected_repo_resolution (exact repos.json name match)
    → execution_readiness (live read-only git gate)
      → (future 22B+ only if verdict===ready && ok===true)
```

Worker rule (post-closure, guidance only — not code in this phase):

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

---

## Recommended approach

**One hardening PR (22A-H)** on top of the current uncommitted 22A work. Functional slices first; land quality green; close 22A as the hard gate. No execution surface.

Reuse existing uncommitted pieces:
- `lib/selected-repo-resolver.js` — keep (Slice 0 pure resolution)
- `lib/execution-readiness.js` — strengthen API + always-fail-closed verdicts
- poll wiring under `--verify-operator-execution-plan` — restructure always-emit
- markdown via `renderExecutionReadinessMarkdown` in `lib/repo-rollup.js`

Move/extract:
- `getRepoGitState` out of `lib/dirty.js` → **`lib/repo-git-state.js`**

---

## Functional slices (high velocity — FIRST)

Ship in this order. After each slice: focused tests (or unit smoke) before the next.

### Slice H0 — Extract `lib/repo-git-state.js` (quality unblock for dirty.js)

**Goal:** restore `lib/dirty.js` under source budget; give readiness a dedicated inspection module.

**Do:**
1. Create `lib/repo-git-state.js` exporting `getRepoGitState(absoluteChildPath)`.
2. Move the body currently at `lib/dirty.js` ~388–476 into the new module.
3. Self-contain allowlisted git inspection (do **not** call dirty command `fail()` paths for soft readiness):
   - `git rev-parse --show-toplevel` (or `--git-dir`) for is-git
   - `git symbolic-ref --quiet --short HEAD` (detached → `detached:true`, `branch:null`)
   - `git rev-parse HEAD` (`has_head` / `head_commit`)
   - `git status --porcelain=v1 -z --untracked-files=all` (counts only; **never emit paths**)
4. Reuse `stateHash` from `lib/state-hash.js` for `state_hash` of redacted metadata.
5. Soft-fail shape (no throw on non-git / empty / missing path):
   - `exists`, `isGitRepo`, `branch`, `detached`, `has_head`, `head_commit`, `is_clean`, `dirty: { is_clean, count, has_staged, has_untracked }`, `state_hash`
6. Remove `getRepoGitState` from `lib/dirty.js` exports and body (returns dirty.js toward pre-22A size ~388 lines, under 400).
7. Point `lib/execution-readiness.js` import at `./repo-git-state`.

**Optional internal:** if porcelain parsing is duplicated, prefer a **private** minimal redacted counter in `repo-git-state.js` (count/staged/untracked only) rather than importing dirty’s path-bearing `parseStatusZ` into the public readiness path. Paths must never leave the module.

**Verify H0:** require module; unit call against non-existent path → `exists:false`; no dirty.js export of `getRepoGitState`.

---

### Slice H1 — Strengthen readiness builder (fail-closed API)

**Goal:** module contract matches poll integration contract; callers cannot “forget” validation.

**Change signature to:**

```js
buildExecutionReadiness({
  operatorPlanArtifact,              // may be null on read fail
  operatorPlanArtifactValidation,    // required for ok path
  selectedRepoResolution,            // may be null if resolution not run
  cwd = process.cwd()
})
```

**Rules (encode in builder, not only in poll):**

| Condition | verdict | ok | runs_read_only_git_inspection |
|---|---|---|---|
| validation missing or `ok !== true` | `artifact_invalid` | false | false |
| resolution missing / `ok !== true` with code `missing_repo` / `NO_SELECTED_REPO` / `invalid_repo_path` | `missing_repo` | false | false |
| resolution `ambiguous_repo` | `ambiguous_repo` | false | false |
| resolution ARTIFACT_INVALID (if reached) | `artifact_invalid` | false | false |
| path missing / not dir | `missing_repo` | false | true (inspection attempted) |
| not a git repo | `not_git_repo` | false | true |
| empty / no HEAD | `git_unavailable` (reason `GIT_EMPTY_REPO`) | false | true |
| dirty | `dirty` | false | true |
| clean + has_head | `ready` | true | true |

**Always:**
- `executes_child_commands: false`, all mutates/writes/tasks/queues/decisions flags false
- `plan_artifact_digest` when artifact is a plain object (else null)
- `selected_repo` from plan when available
- `reasons[]` structured `{ code, detail }`
- `captured` only when git inspection ran; redacted dirty only
- **Never** emit dirty file paths

**Do not** rely on callers for the validation precondition — first check is `operatorPlanArtifactValidation?.ok === true`.

---

### Slice H2 — Always emit `execution_readiness` on verify-op (poll wiring)

**Goal:** worker consuming only `execution_readiness` always sees an explicit fail-closed verdict when `--verify-operator-execution-plan` is set.

**Poll flow (`lib/commands/poll.js`) after validation object exists:**

1. Always set `rollup.operator_execution_plan_artifact_validation`.
2. If validation.ok → run `resolveSelectedRepo` → always set `rollup.selected_repo_resolution`.
3. **Always** call `buildExecutionReadiness({ artifact, validation, resolution|null, cwd })` and set `rollup.execution_readiness`.
4. Top-level `rollup.runs_read_only_git_inspection` mirrors readiness flag (true only when git inspection actually ran).

**When validation fails:** still emit `execution_readiness` with `artifact_invalid`; do not omit the object. Resolution may be skipped (`selected_repo_resolution` absent or explicit null — prefer omit resolution only if validation failed; readiness still present).

**Budget for poll.js (BLOCK today at 216 lines):** extract attach helper into readiness module to keep command thin, e.g.:

```js
// lib/execution-readiness.js
function attachExecutionReadinessToRollup(rollup, {
  operatorPlanArtifact,
  operatorPlanArtifactValidation,
  packetBoundaryRepos,
  cwd,
}) { ... }
```

Poll then becomes a short call after validation — target `lib/commands/poll.js` ≤ 200 lines.

---

### Slice H3 — Focused tests (new file; shrink grandfathered suite)

**Create:** `tests/execution-readiness.test.js` (keep under test budget 300 lines; prefer unit-first over heavy CLI integration).

**Move / add minimum cases (audit checklist):**

| # | Case | Assert |
|---|---|---|
| 1 | valid validation + clean real git child | `verdict === "ready"`, `ok === true`, `runs_read_only_git_inspection === true` |
| 2 | dirty child | `verdict === "dirty"`, ok false |
| 3 | non-git child | `not_git_repo` |
| 4 | missing child path | `missing_repo` |
| 5 | ambiguous selected repo | `ambiguous_repo`, inspection false |
| 6 | invalid artifact validation | `artifact_invalid`, inspection false |
| 7 | resolution failure | `runs_read_only_git_inspection === false` |
| 8 | clean git success | `runs_read_only_git_inspection === true` |
| 9 | dirty output redaction | JSON/stringified readiness has **no** dirty file paths |
| 10 | builder without validation.ok | cannot reach ready (even with clean path + ready plan embed) |

**Git fixtures:** follow existing patterns in `tests/meta-harness-dirty.test.js` / `tests/cli-ready.test.js` (`git init`, config user, commit; dirty = untracked/staged file). Use `os.tmpdir()` + cleanup.

**Trim** `tests/poll-rollup-operator-execution-plan.test.js`:
- Keep one thin smoke on test 17: validation pass + `execution_readiness` present (optional single assert)
- **Remove** Slice 0 unit block (~398–443) and deep readiness asserts → move to new file
- Restore file to ≤ prior grandfathered size (≤ 392 lines) so ratchet does not BLOCK

Unit-test resolver in the new file (or tiny `tests/selected-repo-resolver.test.js` if needed for line budget). Prefer one focused file first for velocity.

---

### Slice H4 — Docs + gates + close readiness (no 22B)

**Docs (minimal, honest):**
- Update `docs/product/phase-22a-execution-readiness-contract.md`: status → implemented + hardened (22A-H); always-emit; builder requires validation; `repo-git-state.js`; no 22B.
- `docs/product/roadmap.md` row 22A: closed/hardened under 22A-H; **still no execution**.
- `docs/product/decision-log.md`: short D065 (or next ID) — 22A readiness gate hardened; worker rule documented; 22B deferred.

**Required gates before closure (all must pass; only known warnings):**

```
npm test
# quality (via project’s quality command / ready chain)
ready --target . --quick --read-only --json
# sync if standard for this repo
sync check --target .
git diff --check
```

Known acceptable: public CLI command count WARN (27 > 25) if pre-existing and still WARN-only.

**Do not:**
- open 22B
- add execution, apply, write-to-child, or task/queue surfaces
- treat advisory top-level `ok` as execution authority (readiness remains the gate object)

---

## Critical files

| Path | Action |
|---|---|
| `lib/repo-git-state.js` | **NEW** — `getRepoGitState` |
| `lib/execution-readiness.js` | Strengthen API; always-fail-closed; optional `attachExecutionReadinessToRollup` |
| `lib/selected-repo-resolver.js` | Keep (minor code-map only if needed) |
| `lib/dirty.js` | Remove `getRepoGitState`; restore under budget |
| `lib/commands/poll.js` | Always-emit wiring; shrink via helper ≤ 200 lines |
| `lib/repo-rollup.js` | Keep markdown hook (verify still renders) |
| `lib/command-registry.js` | Keep accurate usage for readiness emission |
| `tests/execution-readiness.test.js` | **NEW** — gate matrix |
| `tests/poll-rollup-operator-execution-plan.test.js` | Trim 22A bulk; restore ≤ 392 lines |
| `docs/product/phase-22a-execution-readiness-contract.md` | Align to hardened reality |
| `docs/product/roadmap.md` | 22A status |
| `docs/product/decision-log.md` | D065 close note |

---

## Existing utilities to reuse

| Utility | Path |
|---|---|
| `resolveSelectedRepo` | `lib/selected-repo-resolver.js` |
| `buildOperatorExecutionPlanArtifactValidation` | `lib/repo-rollup-operator-execution-plan-artifact-validation.js` |
| `stateHash` | `lib/state-hash.js` |
| `readOperatorExecutionPlanArtifact` | `lib/operator-execution-plan-artifact-io.js` |
| `readRepoIndex` / packet boundary repos | `lib/commands/repos.js` (poll already loads) |
| Git fixture patterns | `tests/meta-harness-dirty.test.js` (`initGitRepo`) |
| Markdown renderer | `renderExecutionReadinessMarkdown` in `lib/execution-readiness.js` |

---

## Implementation notes (velocity + quality)

1. **Do not re-grow dirty.js** — extraction is mandatory, not optional cleanup.
2. **poll.js budget is hard** — prefer one attach helper over inline multi-branch logic.
3. **Prefer unit tests of `buildExecutionReadiness` + `getRepoGitState`** over full rollup CLI for the matrix (faster, under line budget). Add at most 1–2 CLI smokes.
4. **Detached HEAD:** capture `detached:true`; if clean + has_head, verdict remains `ready` (live clean gate; branch name optional). Empty repo without HEAD → `git_unavailable` / `GIT_EMPTY_REPO`.
5. **No overclaim:** do not implement `mismatch_head` / `stale_repo` / `artifact_tampered` without expected bindings (still future).
6. **CLI public command count WARN** — leave alone unless it becomes BLOCK.

---

## Exit criteria (22A-H closed)

- [x] `getRepoGitState` only in `lib/repo-git-state.js`; dirty.js under source budget
- [x] Builder requires `operatorPlanArtifactValidation.ok === true` for any path toward ready
- [x] On every `--verify-operator-execution-plan`, rollup always includes `execution_readiness` with explicit verdict
- [x] Verdict matrix covered by `tests/execution-readiness.test.js` (including redaction + inspection flags)
- [x] Grandfathered operator-plan test file not grown (≤ 392 lines)
- [x] `poll.js` ≤ command_module budget (200)
- [x] `npm test` green
- [x] Quality / ready --quick --read-only green (known WARN only)
- [x] `git diff --check` clean
- [x] Docs + decision-log state 22A hardened; **execution authority remains closed**

## Implementation result (D065)

All exit criteria above were met under D065 (2026-07-09).

Gates: `npm test` PASS; `quality check` PASS (CLI count WARN only); `ready --target . --quick --read-only --json` ok:true; `sync check --target .` PASS; `git diff --check` clean.

22A-H is the live read-only worker gate. **Execution authority remains closed.** Next roadmap phase is **22B Worker Gate Consumption Contract** (still read-only; no child writes; no execution) — not automated execution authority.

---

## Verification plan (end-to-end)

1. **Unit:** node test runner on `tests/execution-readiness.test.js` alone while iterating.
2. **Integration smoke:**  
   `poll --rollup --json --verify-operator-execution-plan <artifact>`  
   - non-git fixture child → readiness present, `not_git_repo`  
   - (optional) temp git clean child in fixture → `ready`
3. **Regression:** full `npm test`
4. **Gates:** quality + ready --quick --read-only --json + sync check + `git diff --check`
5. **Manual worker-checklist assert** on a ready case (all six conditions true)

---

## What this plan deliberately does not do

- No 22B execution authority
- No child command execution, patch apply, writes to child, tasks, queues, decision recording
- No automatic “refresh readiness” mutation of child/parent truth
- No historical HEAD mismatch claims without bound expected state

---

## Audit checkpoint

22A-H closed under D065. Live read-only worker gate accepted.

Next audited plan (when opened): **22B Worker Gate Consumption Contract** — machine-consumable preflight only; still read-only; no child writes; no execution. Do not open execution authority without separate safety work and audit.
