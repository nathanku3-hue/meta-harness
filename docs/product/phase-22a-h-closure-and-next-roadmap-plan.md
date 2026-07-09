# Plan: 22A-H Closure Commit + Roadmap Shift (no execution)

**Status:** approved and executing (Slice 0–2); do not push without operator  
**Date:** 2026-07-09  
**Input:** Audit verdict — accept 22A-H closure; do not open execution authority  
**Local context:** implementation uncommitted on `main` (ahead of origin by 2); gates already verified green by audit + prior run

---

## Context

Audit **accepts 22A-H** as the live read-only worker gate. Trust chain is solid:

```
21F verified operator plan artifact
  → selected_repo_resolution
    → execution_readiness (always present on verify-op)
```

**Code work for 22A-H is done.** Remaining work is governance hygiene + commit + roadmap honesty.

| Done | Not yet |
|---|---|
| `lib/repo-git-state.js` (redacted inspection) | Checklist boxes still `[ ]` in 22A-H plan (stale docs) |
| Validation-gated `buildExecutionReadiness` | Single closure commit not created |
| Always-emit `execution_readiness` on verify-op | Next roadmap row still silent / must not say “execution” |
| Tests + quality green | **No** worker-gate consumption code (next phase only) |
| D065 closed in decision-log | Push of 2 prior + new commit (when ready) |

**Explicit non-goals for this plan:**
- No execution authority
- No child writes, command execution, tasks, queues
- No HEAD-binding / TOCTOU / post-work verification implementation
- No implementation of worker-entry gate object yet (roadmap only)

---

## Recommended approach

**One closure commit** for 22A-H after a **tiny doc fix**. Optionally include a **roadmap-only** row for the next read-only phase in the same commit (preferred for velocity: one ship, honest future).

Do **not** start coding “22B Worker Gate Consumption” until a separate plan is audited.

---

## Functional slices (high velocity — FIRST)

### Slice 0 — Docs evidence fix (mandatory, minutes)

**File:** `docs/product/phase-22a-h-execution-readiness-hardening-plan.md`

Stale exit criteria still show `- [ ]`. Audit requires honest governance evidence.

**Do one of (prefer both for clarity):**

1. Mark all exit-criteria checkboxes `[x]`
2. Add short section after checklist:

```markdown
## Implementation result (D065)

All exit criteria above were met under D065 (2026-07-09).
Gates: npm test PASS; quality PASS (CLI count WARN only);
ready --quick --read-only ok:true; sync check PASS; git diff --check clean.
22A-H is the live read-only worker gate. Execution authority remains closed.
```

3. Update audit checkpoint footer: 22A-H closed; next is **worker-gate consumption contract** (read-only), not execution.

**Verify:** no remaining unchecked 22A-H exit boxes; status line already says implemented under D065.

---

### Slice 1 — Roadmap shift (docs only, same commit preferred)

**File:** `docs/product/roadmap.md`

Insert / rename next phase so the roadmap does **not** imply execution:

| Phase | Name | Status | Notes |
|---|---|---|---|
| 22A | Execution Readiness Contract | closed (D065) | Live read-only worker gate (existing row; keep) |
| **22B** | **Worker Gate Consumption Contract** | **planned / not started** | Read-only. Machine-consumable preflight checklist. Fresh verify-op. All gate fields required. Optional canonical `worker_entry_gate` / `operator_work_gate` object — strict, no aliases. **No execution, no child writes, no new command running beyond existing inspection.** |

**Do not** use 22B for “execution authority.” If a later phase needs execution, renumber later (e.g. 22C+) after more safety work.

**Optional one-liner in D065 “Future boundary”** (decision-log): point next safety work at Worker Gate Consumption Contract, not execution.

**Optional stub:** `docs/product/phase-22b-worker-gate-consumption-contract.md` **only if** audit wants a design doc in-repo before any code — default **skip** for velocity (roadmap row sufficient until next plan).

---

### Slice 2 — Single 22A-H closure commit

**When:** after Slice 0 (+ Slice 1 if included).

**Message (audit-suggested):**

```
feat: harden Phase 22A execution readiness gate
```

**Body should mention:** always-emit readiness; validation-gated builder; `repo-git-state`; D065; no execution / 22B closed as execution; next roadmap = worker-gate consumption (read-only).

**Include in commit:**

| Path | Role |
|---|---|
| `lib/execution-readiness.js` | builder + attach + markdown |
| `lib/repo-git-state.js` | redacted git inspection |
| `lib/selected-repo-resolver.js` | exact repos.json resolution |
| `lib/commands/poll.js` | always-emit wiring |
| `lib/repo-rollup.js` | markdown surface |
| `lib/command-registry.js` | usage truth |
| `tests/execution-readiness.test.js` | gate matrix + poll always-emit |
| `tests/poll-rollup-operator-execution-plan.test.js` | thin smoke; size restored |
| `docs/product/decision-log.md` | D065 |
| `docs/product/roadmap.md` | 22A closed + 22B consumption row |
| `docs/product/phase-22a-execution-readiness-contract.md` | implemented under D065 |
| `docs/product/phase-22a-h-execution-readiness-hardening-plan.md` | checklist fixed + result |
| `docs/product/phase-22a-h-closure-and-next-roadmap-plan.md` | this plan (optional include) |

**Do not amend** the two prior commits. New commit only.

**Pre-commit recheck (quick):**

```
node --test tests/execution-readiness.test.js
# optional if time: npm test
node bin/meta-harness.js quality check
git diff --check
```

---

### Slice 3 — Push (operator-driven, after commit)

When ready (not automatic):

```
git push origin main
```

Pushes **2 prior commits + this new 22A-H commit** (`main` was ahead by 2 before the new commit → ahead by 3 after).

Confirm with operator before push if shared remote policy requires it.

---

## Out of scope (do not implement in this plan)

### Not “execution 22B” — future safety before any authority

Audit list (still open research / later phases):

- expected HEAD / branch / repo-state binding
- TOCTOU between gate check and work
- explicit human authorization for work start
- child path/scope constraints at operation level
- post-work verification + dirty classification
- rollback / failure accounting
- proof no worker can bypass `execution_readiness.ok === true`

### Not yet: Worker Gate Consumption Contract **code**

That is the **next** planned phase after this commit. When planned later, functional slices would likely be:

0. Spec only: exact field checklist + fail-closed rules  
1. Optional rollup object `worker_entry_gate` / `operator_work_gate` (canonical, strict, no aliases)  
2. Tests: all-false / all-true / missing readiness / stale not claimed  
3. Docs + decision ID  

Still zero execution.

---

## Worker rule (accepted; guidance only)

Immediately before touching the child repo, re-run:

`poll --rollup --json --verify-operator-execution-plan <path>`

Proceed to **manual/operator-driven** work only if **all** hold:

```
operator_execution_plan_artifact_validation.ok === true
selected_repo_resolution.ok === true
execution_readiness.verdict === "ready"
execution_readiness.ok === true
execution_readiness.runs_read_only_git_inspection === true
execution_readiness.executes_child_commands === false
```

Anything else blocks. This authorizes considering manual work — **not** automated execution.

---

## Exit criteria (this plan)

- [ ] 22A-H plan exit checklist honest (`[x]` + implementation result)
- [ ] Roadmap: 22A closed; next row is Worker Gate Consumption (read-only), not execution
- [ ] One commit: `feat: harden Phase 22A execution readiness gate`
- [ ] Working tree clean for 22A-H files after commit
- [ ] No execution surface introduced
- [ ] Push deferred until operator says go (or explicit push instruction)

---

## Velocity notes

1. **Doc fix first** — 2 minutes, unblocks honest commit.  
2. **Roadmap row in same commit** — avoids second docs PR.  
3. **No new code** unless checklist/roadmap only.  
4. **Do not open design-doc-writer loop** for consumption contract until after commit, unless audit demands a stub file now.

---

## Audit checkpoint

**Awaiting approval of this plan before commit/push.**

Success bar after approval: checklist fixed → single 22A-H commit → roadmap names next phase as read-only worker-gate consumption → still no execution.

Bottom line (from audit): **commit 22A-H, keep execution closed, next roadmap item = worker-gate consumption contract.**
