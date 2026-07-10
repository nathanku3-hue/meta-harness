# Phase 22B — Worker Gate Consumption Contract

**Status:** closed under D066 (implementation complete; audit-approved with 23A amendments)  
**Date:** 2026-07-10; sequencing amendments 2026-07-11  
**Prerequisite:** 22A-H closed under D065 at `02d9c59`  
**Explicit non-goal:** no execution authority, child writes, apply, tasks, queues, readiness refresh, decisions/approvals  
**Canonical runtime key:** `worker_entry_gate` **only** — no `operator_work_gate` alias, dual key, or compatibility surface

---

## Context (local)

| Fact | Value |
|---|---|
| Tip | `02d9c59` feat: harden Phase 22A execution readiness gate |
| Tree | clean; no further local changes required before optional push |
| 22A | Live fail-closed `execution_readiness` always emitted on verify-op |
| Roadmap | 22B already named **Worker Gate Consumption Contract** (planned, read-only) |
| Push | **Operator-only** — not part of 22B code slices; `git push origin main` only when explicitly approved |

### Trust layers (do not collapse)

```
21F  operator plan artifact validation
22A  selected_repo_resolution + execution_readiness
22B  worker_entry_gate  ← this phase (consumes 21F+22A; does not re-inspect git)
future  22C+ expected state / TOCTOU / scope / post-work  → only then discuss execution
```

22B turns the worker checklist into a **canonical machine object**. It does **not** grant automated execution. `open` means permission to **begin manual/operator-driven work**, not to run child commands.

### Current wiring to reuse

- `attachExecutionReadinessToRollup` already sets validation, resolution (when validation.ok), readiness, top-level inspection flag (`lib/execution-readiness.js`, `lib/commands/poll.js`)
- Markdown: `renderRepoRollupMarkdown` after readiness (`lib/repo-rollup.js` ~384–386)
- Patterns: pure builders + `reasons[]` + full safety flag block (same family as 21E/21F/22A)

---

## Purpose

On `--verify-operator-execution-plan`, after 22A readiness is attached, always emit:

```json
{
  "kind": "worker_entry_gate",
  "source": "execution_readiness",
  "verdict": "open" | "blocked" | "not_requested",
  "ok": false,
  "required_inputs": {
    "operator_plan_validation_ok": false,
    "selected_repo_resolution_ok": false,
    "execution_readiness_ok": false,
    "read_only_git_inspection_ran": false,
    "executes_child_commands": false
  },
  "reasons": [],
  "mutates": false,
  "writes_files": false,
  "writes_parent_files": false,
  "writes_child_files": false,
  "executes_child_commands": false,
  "applies_patches": false,
  "creates_tasks": false,
  "creates_queues": false,
  "refreshes_readiness": false,
  "records_decision": false,
  "records_approval": false
}
```

**Canonical name:** `worker_entry_gate` only.  
**No aliases** (`operator_work_gate` is rejected as a name — roadmap text may mention it historically; runtime key is only `worker_entry_gate`).

**Verdict vocabulary:** use `open` / `blocked` / `not_requested` — **not** `ready` (avoids collision with repo readiness / execution_readiness).

`ok === true` **only** when `verdict === "open"`.

---

## Open rule (strict conjunction)

`verdict: "open"` and `ok: true` only if **all** are true:

| # | Condition |
|---|---|
| 1 | `operator_execution_plan_artifact_validation.ok === true` |
| 2 | `selected_repo_resolution.ok === true` |
| 3 | `execution_readiness.verdict === "ready"` |
| 4 | `execution_readiness.ok === true` |
| 5 | `execution_readiness.runs_read_only_git_inspection === true` |
| 6 | `execution_readiness.executes_child_commands === false` |

Also enforce on the gate object itself: all mutative/safety flags false; gate’s own `executes_child_commands === false`.

### Fail closed (blocked)

Any of:

- verify-op requested but missing `execution_readiness` (should not happen after 22A-H; still treat as blocked)
- missing / not-ok validation
- missing / not-ok `selected_repo_resolution`
- readiness not present, or `ok !== true`, or `verdict !== "ready"`
- readiness verdicts: `not_git_repo`, `dirty`, `missing_repo`, `ambiguous_repo`, `artifact_invalid`, `git_unavailable`, unknown
- `runs_read_only_git_inspection !== true` when open would otherwise be claimed
- `executes_child_commands === true` on readiness (or any non-false)
- any missing required safety flag on gate construction
- any unknown / unexpected readiness verdict string

`reasons[]`: structured `{ code, detail }` listing each failed required input (not prose-only).

### not_requested

Only when verify-op was **not** requested (gate absent or explicit not_requested if ever emitted off-path). Prefer: **emit gate only on verify-op path**, always with `open` or `blocked` (mirror 22A always-emit on that path). Off verify-op: omit object (like other optional rollup sections).

**Recommendation (velocity + consistency with 22A):** on verify-op, **always** emit `worker_entry_gate` with `open` or `blocked` (never omit; never `not_requested` on that path). `not_requested` reserved for pure unit defaults / non-verify builders only.

---

## Operating rules / invariants

- Read-only surface only; no new public CLI command
- Trigger: same as 22A — `poll --rollup --verify-operator-execution-plan <path>`
- Pure consumption of rollup fields already produced; **no additional git inspection**
- Does not mutate parent/child truth, files, events, decisions, readiness.json
- Does not change top-level rollup `ok` (advisory gate object)
- No backward-compatible aliases or dual keys
- No re-derivation of plan steps or artifact rewrite

---

## Functional slices (high velocity — FIRST)

Ship in order. After each slice: focused unit tests before the next.

### Slice 0 — Pure builder (mandatory first)

**New file:** `lib/worker-entry-gate.js`

```js
buildWorkerEntryGate({
  operatorPlanArtifactValidation,
  selectedRepoResolution,
  executionReadiness,
  requested = true, // verify-op path
})
```

- Map the six required inputs into `required_inputs` booleans (honest snapshots of each check)
- Apply open rule; set verdict/ok/reasons
- Always set full safety flag block to false (except reflect `executes_child_commands` from readiness into **required_inputs**; gate-level `executes_child_commands` stays **false**)
- Unit-testable with plain objects; no fs/git

**Verify S0:** unit tests only — open all-true; blocked each single-false; missing readiness; unknown verdict; dirty/not_git/missing/ambiguous/artifact_invalid.

---

### Slice 1 — Attach on verify-op (thin poll)

Extend attach path so after readiness is set, always set `rollup.worker_entry_gate`.

**Preferred (budget-safe):** either:

- A) `attachWorkerEntryGateToRollup(rollup)` in `lib/worker-entry-gate.js` called from poll after readiness attach, or  
- B) fold into `attachExecutionReadinessToRollup` end — **avoid** if it grows `execution-readiness.js` past comfort; prefer A for single-responsibility.

Target: `poll.js` stays ≤ 200 lines (currently ~193). One call site only.

Order on rollup (conceptual):

```
operator_execution_plan_artifact_validation
→ selected_repo_resolution (when validation.ok)
→ execution_readiness
→ worker_entry_gate
```

---

### Slice 2 — Markdown + registry

- `renderWorkerEntryGateMarkdown(gate)` → `## Worker Entry Gate` (verdict, ok, required_inputs, reasons)
- Wire in `lib/repo-rollup.js` **after** execution readiness section
- Update `lib/command-registry.js` usage one-liner: verify-op also emits `worker_entry_gate`

---

### Slice 3 — Focused tests

**New:** `tests/worker-entry-gate.test.js` (keep under test budget 300)

Minimum cases:

| # | Case | Assert |
|---|---|---|
| 1 | all six conditions true | `verdict === "open"`, `ok === true` |
| 2 | validation.ok false | `blocked`, `operator_plan_validation_ok: false` |
| 3 | resolution missing/not ok | `blocked` |
| 4 | readiness not ready / dirty / not_git | `blocked` |
| 5 | `runs_read_only_git_inspection: false` | `blocked` |
| 6 | `executes_child_commands: true` on readiness | `blocked` |
| 7 | missing readiness object | `blocked` |
| 8 | unknown readiness verdict | `blocked` |
| 9 | safety flags on gate all false when open | assert block |
| 10 | poll CLI: verify bad artifact → gate present, blocked | always-emit |
| 11 | poll CLI: good artifact non-git child → blocked (not open) | |

Reuse fixture patterns from `tests/execution-readiness.test.js` (no new git work if possible for pure builder cases).

---

### Slice 4 — Docs + D066 + gates (after green)

- This plan → status implemented under D066 (when closed)
- `docs/product/roadmap.md` 22B row → closed under D066 (still read-only language)
- `docs/product/decision-log.md` D066: Worker Entry Gate; no execution
- Optional: one-line worker rule update in D065 future boundary / 22A docs pointing to `worker_entry_gate.ok === true`

**Gates (required before close):**

```
npm test
node bin/meta-harness.js quality check
node bin/meta-harness.js ready --target . --quick --read-only --json
node bin/meta-harness.js sync check --target .
git diff --check
```

Known WARN only: public CLI command count 27 > 25.

---

## Critical files

| Path | Action |
|---|---|
| `lib/worker-entry-gate.js` | **NEW** — build + attach + markdown |
| `lib/commands/poll.js` | One-line attach after readiness |
| `lib/repo-rollup.js` | Markdown after readiness |
| `lib/command-registry.js` | Usage string |
| `tests/worker-entry-gate.test.js` | **NEW** |
| `docs/product/phase-22b-worker-gate-consumption-contract.md` | This plan → close notes |
| `docs/product/roadmap.md` | 22B status |
| `docs/product/decision-log.md` | D066 |

**Do not modify:** dirty.js, repo-git-state.js, 21F validators (unless a pure re-export is needed — prefer not).

---

## Existing utilities to reuse

| Utility | Path |
|---|---|
| `attachExecutionReadinessToRollup` / readiness shape | `lib/execution-readiness.js` |
| Poll verify-op branch | `lib/commands/poll.js` |
| Markdown rollup chain | `lib/repo-rollup.js` |
| Fixture/CLI patterns | `tests/execution-readiness.test.js` |

---

## Exit criteria

- [x] On every verify-op: `worker_entry_gate` always present with `open` or `blocked`
- [x] `ok === true` only when all six inputs pass and verdict is `open`
- [x] Fail closed on missing/unknown/dirty/not_git/etc.
- [x] No aliases; kind exactly `worker_entry_gate`
- [x] Zero mutative flags; no child commands; no extra git beyond 22A
- [x] Focused tests + full npm test green (verify before close)
- [x] Quality / ready / sync / diff-check green (known WARN only; verify before close)
- [x] Roadmap + D066: 22B closed as consumption; **no execution**
- [x] Preview only in docs: 22C–22F safety phases — not implemented as separate ladder

## Implementation result (D066)

Shipped: `lib/worker-entry-gate.js`, poll attach after readiness, markdown after readiness, `tests/worker-entry-gate.test.js`, registry usage line, D066, roadmap 22B closed + 23A planned.

`open` means permission guidance for **manual/operator-driven** work only — **not** automated execution.

---

## What this plan deliberately does not do

- No push (operator-driven: `git push origin main` only when explicitly approved)
- No 22B design doc beyond this contract plan (this **is** the design)
- No `operator_work_gate` dual key
- No execution, apply, child writes, tasks, queues
- No expected HEAD binding (22C), TOCTOU recheck (22D), work scope (22E), post-work verify (22F)
- No treating `open` as automated execution authority

---

## Optional operator step (out of band)

When approved separately:

```
git push origin main
```

Pushes 3 commits ending at `02d9c59`. **Not a prerequisite for writing 22B code**, but recommended before large follow-on work so remote matches closed D065.

---

## Roadmap after 22B (preview — superseded for product sequencing)

| Phase | Name | Intent |
|---|---|---|
| 22C | Expected Repo State Binding | artifact/expected HEAD/branch/hash |
| 22D | TOCTOU Recheck Contract | recheck immediately before work |
| 22E | Work Scope Contract | path/operation bounds |
| 22F | Post-Work Verification + Dirty Classification | after manual work |

**Sequencing update (2026-07-11, APPROVED with amendments):**  
After narrow 22B (this document, one PR), next product work is **Phase 23A** (`phase-23a-controlled-execution-vertical-slice-plan.md`). 22C–22F are **not** separate pre-execution phases **if** 23A authorize/verify absorb minimum HEAD-bind / TOCTOU / scope / post-work fact controls.  

**Time-box failure:** if this PR cannot close cleanly in one PR, **do not freeze without replacement** — fold the minimal `worker_entry_gate` into 23A PR2. 23A must never authorize from a missing gate.

---

## Worker rule (post-22B)

Immediately before touching the child repo, re-run verify-op and require:

```
worker_entry_gate.verdict === "open"
worker_entry_gate.ok === true
```

(which itself implies the six 21F+22A conditions). Anything else blocks. Still **manual/operator-driven work only**.

---

## Implementation notes (velocity)

1. Pure builder first — zero poll until unit matrix is green.  
2. Keep poll change ≤ a few lines.  
3. Prefer unit over heavy CLI tests; 1–2 CLI smokes for always-emit.  
4. Do not grow grandfathered suites; new file only.  
5. Watch `repo-rollup.js` budget (~390 / 400 source); markdown helper stays in worker-entry-gate module.

---

## Audit checkpoint

**Approved for PR1 implementation** (with 23A plan amendments). No execution authority.

Success bar: pure `worker_entry_gate` consumes 21F+22A fail-closed; always on verify-op; open ≠ ready ≠ execute; **no alias keys**; docs honest; no push without operator.

Bottom line: **implement 22B as consumption only; no AO/Codex/execution; push only when told.**
