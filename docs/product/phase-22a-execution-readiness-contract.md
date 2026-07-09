# Phase 22A — Execution Readiness Contract

Status: **implemented + hardened under D065 (22A-H)**; follows D064 (21F closure)
Date: 2026-07-09
Audit notes: 22A-H closed quality blockers (dirty/poll budgets, always-emit readiness, validation-gated builder, focused tests). No 22B.
Reference: audit directive after 21F + 22A-H hardening plan (`docs/product/phase-22a-h-execution-readiness-hardening-plan.md`)

## Purpose (Strategic)

Phase 21F produced a canonical, verifiable `operator_execution_plan_artifact` that is still non-executable guidance. It is a snapshot at materialization time.

Phase 22A adds the **Execution Readiness Contract** — a read-only layer that answers:

> "Is this verified operator plan artifact still valid and safe to act on against the *current* child repo state?"

It binds the plan to live repo reality via explicit resolution + read-only git inspection (exists, git, branch/detached/HEAD, clean/dirty metadata). It captures current state + digests for future comparison. 22A does not claim historical mismatch/tamper detection (21F artifacts carry no expected state); those are conditional on prior bindings.

Key goals:
- Fail closed on any mismatch or drift.
- Structured reasons (not prose) for blocking.
- Expose digests for future use (plan artifact digest, repo state hash).
- Still **zero** execution, writes, patches, child commands, tasks, queues, decisions, or readiness refresh.
- Prepares the ground for any future 22B+ execution authority without overclaiming.

This is the critical safety gate before any mutation surface.

## Operating Rules / Invariants

- Read-only surface only. Integrated with `--verify-operator-execution-plan` (or dedicated `--verify-execution-readiness`).
- Requires a verified operator plan artifact (`verdict === "ready_for_operator"` and its validation `pass`).
- **Slice 0 prerequisite (explicit repo resolution)**: Extract `operator_execution_plan.selected_repo` (a name). Perform exact match against parent `.meta-harness/repos.json` entries by `name`. Fail closed with structured reasons for:
  - missing or invalid repos.json
  - no matching name
  - multiple matching names (ambiguous_repo)
  - matched entry has missing or non-existent path
  Resolve the matched `path` (relative to parent cwd or absolute) to an absolute child repo path for inspection.
- For the resolved child repo:
  - Path must exist and be a directory.
  - Must be inside a git repository (allowlisted read-only git inspection only).
  - Capture: branch (or "detached"), detached (bool), has_head (bool), head_commit (or null), is_clean (bool), dirty summary (redacted), repo_state_hash.
- Git inspection limited to allowlisted read-only commands only: `git rev-parse`, `git symbolic-ref --quiet --short HEAD`, `git rev-parse HEAD`, `git status --porcelain=v1 -z --untracked-files=all`. These are **not** "executes_child_commands". Use:
  - `"runs_read_only_git_inspection": true`
  - `"executes_child_commands": false`
  (executes_child_commands refers to non-git, non-inspection operator work, package scripts, builds, tests, or arbitrary child commands.)
- Compute current state and plan_artifact_digest (for provenance/future comparison).
- Comparison rules (strict):
  - No "wrong HEAD" / `mismatch_head` or `stale_repo` unless the verified artifact (or external input in later phases) already contains an expected `head_commit` / `repo_state_hash` binding. 21F artifacts do not embed this.
  - `artifact_invalid` on validation failure or digest mismatch when an *expected* digest is supplied.
  - `artifact_tampered` is future/conditional only (requires prior stored digest).
- Structured `reasons[]` (array of {code, detail}).
- `ok: true` only when verdict === "ready".
- No changes to child readiness.json, parent state, events, or any truth.
- Generic `--write` and non-rollup surfaces remain rejected.
- Full 21F chain required.
- Re-check immediately before any future execution.

The contract is a live readiness gate + provenance capture. Historical staleness comparison is conditional on prior bindings (22B+ or explicit expected state).

## GitHub Reference Repos (for patterns)

Best references (pulled via search + prior context):

- **langchain-ai/langgraph**: Durable checkpoints + state snapshots with version/turn binding. Plans are re-validated against current graph state before resume. Strong model for "readiness" between checkpoint (our artifact) and live world (git HEAD + dirty).
- **MAS-Infra-Layer/Agent-Git**: Agent version control, open-branching, git-like primitives (branches, commits, HEAD) for agentic AI on top of LangGraph. Directly relevant for binding agent "plans" or "memory" to git commit state.
- **raia-live/amfs** ("Git for agent memory"): Branches, diffs, PRs, rollback for what agents know. Treats agent state as versioned git objects — excellent analogy for binding operator plan artifacts to repo commit + clean state.
- Internal gold: existing `lib/dirty.js` (git status --porcelain, parse, stateHash), `lib/state-hash.js` (stable SHA), `readRepoIndex`, ready.json state_hash patterns, and the 21F operator plan artifact wrapper.

Extracted patterns:
- Always capture `branch` + `HEAD` + cleanliness at decision/plan time.
- Use stable hashing for state digests (exclude volatile fields).
- Separate "plan/artifact at T0" from "current world at T1".
- Structured failure reasons + fail-closed.
- Git as the source of truth for "what the child actually is right now".

## Functional Slices (High-Velocity Order — FIRST)

**Slice 0 — Resolve selected repo (mandatory first slice)**
- From verified operator plan artifact (after its validation passes):
  - Extract `operator_execution_plan.selected_repo` (string name).
- Use `readRepoIndex` on parent `.meta-harness/repos.json`.
- Exact name match:
  - 0 matches → `missing_repo`
  - >1 matches → `ambiguous_repo`
  - 1 match but path invalid/missing → fail closed
- Normalize matched `repo.path` to absolute child path (relative to parent cwd or absolute).
- This slice produces structured failure or the resolved absolute child path + name. No git calls yet.

1. **Git state capture helpers (read-only inspection only)**
   - Extend/reuse `lib/dirty.js` patterns or add `lib/repo-state.js`:
     - `getRepoGitState(absoluteChildPath)` → {
         exists, isGitRepo,
         branch (or null), detached (bool), has_head (bool),
         head_commit (or null),
         is_clean (bool),
         dirty: { is_clean, count, has_staged, has_untracked },
         state_hash
       }
     - Use only allowlisted: `git rev-parse --git-dir`, `git symbolic-ref --quiet --short HEAD` (fallback for detached), `git rev-parse HEAD`, `git status --porcelain=v1 -z --untracked-files=all`.
     - Compute repo_state_hash using existing `stateHash` on normalized metadata (no full dirty paths).
   - Handle:
     - !exists or !dir → GIT_REPO_PATH_INVALID
     - not git → not_git_repo
     - empty repo (no HEAD) → GIT_EMPTY_REPO or has_head:false
     - detached → detached:true, branch may be null or "HEAD"
   - Pure read-only, no mutation, no non-git commands.

2. **Execution readiness builder + contract**
   - File: `lib/execution-readiness.js` (+ `lib/repo-git-state.js` for inspection)
   - `buildExecutionReadiness({ operatorPlanArtifact, operatorPlanArtifactValidation, selectedRepoResolution, cwd })`
   - Prerequisites **encoded in builder**: `operatorPlanArtifactValidation.ok === true`; then resolution; then git inspection.
   - Capture current git state (via Slice 1 helper).
   - Compute plan_artifact_digest = stateHash(artifact) for provenance.
   - Apply rules (no overclaim):
     - If plan validation or resolution failed → artifact_invalid / missing_repo / ambiguous_repo / not_git_repo etc.
     - dirty (is_clean:false) → "dirty"
     - git inspection failures → git_unavailable / GIT_EMPTY_REPO etc.
     - `mismatch_head`, `stale_repo`, `artifact_tampered` only when an *expected* binding/digest is present in artifact or supplied (future in 22A; 21F artifacts have none).
   - Output shape (example):
     ```json
     {
       "kind": "execution_readiness",
       "source": "operator_plan_artifact",
       "verdict": "ready" | "dirty" | "artifact_invalid" | "missing_repo" | "not_git_repo" | "git_unavailable" | "blocked" | ...,
       "ok": false,
       "selected_repo": "child-app",
       "captured": {
         "branch": "main",
         "detached": false,
         "has_head": true,
         "head_commit": "abc123...",
         "is_clean": true,
         "dirty": { "is_clean": true, "count": 0, "has_staged": false, "has_untracked": false },
         "state_hash": "..."
       },
       "plan_artifact_digest": "...",
       "reasons": [],
       "runs_read_only_git_inspection": true,
       "executes_child_commands": false,
       "mutates": false,
       ... all other safety flags false ...
     }
     ```

3. **Wire into poll --rollup**
   - On `--verify-operator-execution-plan <path>`, **always** produce top-level `execution_readiness` (even when validation or resolution fails — explicit fail-closed verdict; never omit).
   - When validation passes, also emit `selected_repo_resolution`.
   - Advisory for top-level rollup `ok` (does not force top-level ok:false in 22A); the worker gate is `execution_readiness` itself.
   - Update usage strings.

4. **Validation + safety for readiness**
   - Enforce safety: all mutative flags false, runs_read_only_git_inspection true, executes_child_commands false.
   - No forbidden fields.

5. **Markdown + JSON rendering**
   - Render `## Execution Readiness` with verdict, captured (redacted), reasons.
   - Position after operator plan section.

6. **Tests**
   - Slice 0 resolution tests (missing, ambiguous, path fail).
   - Git helpers with temp git repos (clean, dirty, detached, empty).
   - Full integration with 21F artifacts.
   - Redaction: no paths in output.
   - Negative cases per tightened exit criteria.
   - New or extended test file.

7. **Docs + D entry**
   - This revised plan.
   - `roadmap.md`, `decision-log.md` (D065).
   - Self-adoption.

## Deliverables

**New / primary:**
- `lib/execution-readiness.js` (`buildExecutionReadiness`, `attachExecutionReadinessToRollup`, markdown)
- `lib/repo-git-state.js` (`getRepoGitState` — redacted dirty only)
- `lib/selected-repo-resolver.js`
- `docs/product/phase-22a-execution-readiness-contract.md`
- `docs/product/phase-22a-h-execution-readiness-hardening-plan.md`
- `tests/execution-readiness.test.js`

**Modified:**
- `lib/commands/poll.js`
- `lib/repo-rollup.js` (add to output + markdown)
- `lib/command-registry.js`
- `docs/product/roadmap.md`
- `docs/product/decision-log.md`
- (any render for operator plan if needed)

Non-goals for 22A:
- No execution authority or child commands.
- No writes to plan artifact (the artifact remains as written in 21F; readiness is a live check).
- No automatic "update plan with state" (future phase if needed).
- No changes to manual packet or earlier surfaces.
- No new public top-level commands.

## Exit Criteria

- Clean selected child (resolved via exact repos.json match) + valid 21F artifact → `verdict: "ready"`, `ok: true`, captured state (with redacted dirty), no reasons.
- Blocking cases (fail closed with structured reasons):
  - resolution failures (missing_repo, ambiguous_repo)
  - path not exist / not git repo
  - git inspection failures (git_unavailable, GIT_EMPTY_REPO, etc.)
  - dirty (is_clean: false)
  - artifact validation failure → artifact_invalid
- `mismatch_head`, `stale_repo`, `artifact_tampered` are **not exercised** unless an expected binding/digest is present (future).
- All safety fields present: runs_read_only_git_inspection: true, executes_child_commands: false, all mutates/writes false.
- Dirty output is redacted (no paths).
- Markdown + JSON surface the readiness section.
- Tests + gates pass.
- Roadmap/decision-log updated.
- Zero execution / mutation surface.

## Safety / Blast Radius

- Only allowlisted read-only git inspection (rev-parse, symbolic-ref, status --porcelain). Never runs scripts, tests, builds, or arbitrary commands.
- Explicit metadata: runs_read_only_git_inspection true / executes_child_commands false.
- No writes, no child mutation.
- Fails closed with structured reasons.
- Dirty details redacted in output (paths never emitted).
- Reuses dirty.js + state-hash.
- Advisory in 22A; does not alter top-level ok or child readiness.
- Full 21F artifact validation required first.

## Implementation Notes for Velocity

- Slice 0 (repo resolution) first — before any git calls.
- Reuse `dirty.js` + `state-hash.js` for git inspection and hashing (temp git repo tests).
- Redact dirty output; only metadata counts.
- Readiness object always includes the new inspection flags.
- After each slice: run focused tests + manual poll --rollup --verify-operator... exercise.
- Clean 21F state in git before 22A implementation commits.

Phase 22A is implemented and hardened under **D065**. Worker gate is machine-consumable via always-emitted `execution_readiness`.

Next (preview only — not authorized): conditional staleness features + any 22B bounded execution only after a future audit explicitly opens 22B.
