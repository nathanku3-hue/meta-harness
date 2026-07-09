# Phase 21F — Canonical Operator Plan Artifact + Contract

Status: closed under D064 (post-audit hardening accepted). See decision log.
Date: 2026-07-08
Reference: user directive + internal patterns from 21C/21D/21E (manual packet materialization + verification)

## Purpose (Strategic)

Phase 21E produces a correct read-only `operator_execution_plan` (verdict: not_requested | blocked | ready_for_operator) derived strictly from a *verified* manual-work-packet artifact. It is guidance only — no execution authority.

Phase 21F makes the plan a **canonical, verifiable, parent-local artifact** (still non-executable). This:

- Introduces the exact invariants future execution phases (22+) must obey.
- Creates a durable, hashable, auditable snapshot binding packet + plan + safety contract.
- Enables later staleness detection (repo HEAD, packet digest, plan digest, child state).
- Keeps the trust chain: approval receipt → manual packet → artifact validation → operator plan artifact.
- **No execution, no child writes, no commands, no patches, no tasks/queues/decisions yet.**

Per aggressive guidance: do **not** make 21F a dumb serializer. Make the canonical wrapper + contract the deliverable. Defer real execution + repo-state binding to Phase 22A+ (Execution Readiness Contract, still read-only).

No backward compatibility. Only the declared shape is valid.

## Operating Rules / Invariants (from 21E + user spec)

- Write surface: ONLY `--write-operator-execution-plan <relative-path>` under `poll --rollup`.
- Requires: `--verify-manual-work-packet <path>` (to derive a live `ready_for_operator` plan in the same rollup invocation).
- The emitted `operator_execution_plan.verdict` in rollup must be exactly `"ready_for_operator"` (and `ok: true`).
- Generic `--write` on rollup remains rejected (already enforced).
- Artifact lives only under parent `.meta-harness/`, never child roots, never absolute, never `.meta-harness/` root itself.
- Wrapper safety: `writes_files: true, writes_parent_files: true, writes_child_files: false, executes_child_commands: false, ...` (all other mutative flags exactly false).
- Embedded `operator_execution_plan` safety: **all** flags exactly `false` (as proven in 21E).
- Embedded `manual_work_packet_artifact_validation` must be a `pass`.
- Packet ID consistency across wrapper / validation / embedded plan.
- Verifier (added here or 21G): strict rejection on any deviation (schema/kind/source, missing plan, verdict != ready_for_operator, safety mismatch, forbidden fields anywhere, path violations, ID mismatch).

The artifact is a **record of a ready plan at a point in time**, not live authority. Future phases must re-validate + bind to current repo state (HEAD, dirty, branch, packet digest, plan digest).

## GitHub Reference Repos (pulled for patterns)

Best references pulled via GitHub search (stars + relevance to durable plans, artifacts, harnesses, human gates, state machines):

- **langchain-ai/langgraph** (and langchain): Resilient agents via explicit graphs + durable checkpoints. Plans/states are first-class persisted objects that can be rehydrated, inspected, and gated before "resume/execute". Strong analog for canonical plan artifact + verifier before any action. Human-in-the-loop nodes map to our "ready_for_operator" gate.
- **obra/superpowers**: Agentic skills framework + SDLC methodology. Subagent-driven, skills as composable units, explicit methodology gates. Emphasizes visibility + controlled delegation over raw autonomy.
- **affaan-m/ECC**: "agent harness performance optimization system". Skills, instincts, memory, security, research-first. Reinforces bounded harness (not full agent replacement) and security/scoping invariants.
- **bytedance/deer-flow**: Long-horizon "SuperAgent harness" using sandboxes, memories, tools, skills, subagents, message gateway. Handles research→code workflows with explicit structure. Useful for artifact durability across long-running slices.
- **anomalyco/opencode**, **google-gemini/gemini-cli**, others (hermes-agent, claw-code): CLI/agent surfaces and harnesses. Patterns around terminal-visible state, scoped execution, no silent mutation.

Key extracted patterns (used for design):
- Separate "plan / intent / checkpoint" artifact from execution authority.
- Explicit safety/scope flags on every persisted envelope.
- Verifiers that fail closed on schema, kind, embedded invariants, boundary violations.
- Human/operator review of the plan artifact before any further step.
- Checkpoints must be re-validated against current world state (prevents stale execution).

Internal best reference: exact 21C writer + 21D verifier code (manual-work-packet-artifact-io + validation). We copy the boundary model, wrapper shape, check discipline, and error messages exactly where possible.

## Functional Slices (High-Velocity Order — FIRST)

Implement + test one slice at a time. Each slice must leave tree green for its scope. Smallest possible diff that adds observable correct behavior.

1. **CLI surface + option plumbing (read paths only)**
   - Update `lib/command-registry.js` poll usage to document new flags.
   - In `lib/commands/poll.js`: add `readOperatorPlanOutputOption` + `readOperatorPlanVerifyOption` (mirror manual packet readers). Reject misuse outside --rollup. No behavior change yet.
   - Ensure parse handles `--write-operator-execution-plan foo.json` and `--verify-operator-execution-plan bar.json`.
   - Add basic guard tests (misuse cases).

2. **Canonical artifact IO (writer + path rules + builder)**
   - New file: `lib/operator-execution-plan-artifact-io.js`
   - Exact boundary resolver (relative, under .meta-harness/, !child root, !dir).
   - `assertReadyOperatorPlan(rollup)` — fail unless `operator_execution_plan.verdict === "ready_for_operator"`.
   - `buildOperatorExecutionPlanArtifact(rollup)` — returns the exact wrapper shape from spec (schema 1.0.0, kind, source="poll_rollup_operator_execution_plan", embeds `manual_work_packet_artifact_validation` + `operator_execution_plan`, safety flags).
   - `writeOperatorExecutionPlanArtifact(...)` + `resolve...OutputPath`.
   - Read helpers for later verify (reuse pattern).
   - Export cleanly. No mutation of anything except the target file on write.

3. **Plan artifact verifier (contract enforcement)**
   - New file: `lib/repo-rollup-operator-execution-plan-artifact-validation.js`
   - Mirror structure of manual packet validator: `buildOperatorExecutionPlanArtifactValidation(input)`.
   - Defaults to not_requested when !requested.
   - Checks (all must pass for verdict="pass"):
     - Exists + valid JSON + schema_version=1.0.0
     - kind === "operator_execution_plan_artifact"
     - source === "poll_rollup_operator_execution_plan"
     - packet_id present + matches wrapper + validation + embedded plan
     - embedded `manual_work_packet_artifact_validation.verdict === "pass"`
     - embedded `operator_execution_plan.verdict === "ready_for_operator"` + `ok === true`
     - wrapper safety fields exactly match approved (writes_parent true, child/executes etc false)
     - embedded plan safety fields exactly all false (use existing SAFETY_FLAGS)
     - no FORBIDDEN_FIELDS anywhere (same list or extended if needed)
     - path boundary passed (parent .meta-harness only)
     - child boundary ok
     - read-only verification (no side effects)
   - Produce `checks[]`, verdict, `ok`, `packet_id`, etc. + safety flags on the validation object itself (all false).
   - Unit-test the validator in isolation.

4. **Wire writer into poll --rollup**
   - In poll.js rollup branch:
     - Read new option.
     - If present: also require manual verify option was present (per spec).
     - After building rollup: call assertReadyOperatorPlan(rollup).
     - Resolve path using new io + repos boundary list.
     - Write `buildOperatorExecutionPlanArtifact(rollup)`.
     - Preserve full rollup stdout/JSON.
   - Keep manual write path untouched.
   - Reject `--write-operator-execution-plan` without --rollup (already pattern).
   - Add --force support (reuse existing).

5. **Wire verifier surface (and integration)**
   - Support `--verify-operator-execution-plan <path>` on poll --rollup.
   - Read/validate the artifact (using new validation module).
   - For 21F functional: at minimum surface the validation result in rollup output (new top-level key `operator_execution_plan_artifact_validation` after the derived plan? or decide position). Conservative: compute validation and include it; do not yet change derived `operator_execution_plan` (still comes from manual verify).
   - Later phases can consume the verified plan artifact for readiness binding.
   - Ensure that using verify-op alone still produces a rollup (with derived plan from nothing = not_requested, plus validation of the op plan artifact).
   - Update key ordering expectations in tests if we add the validation key.

6. **Tests (functional + contract)**
   - Extend or new focused tests under `tests/poll-rollup-operator-execution-plan.test.js` (or sibling).
   - Pure builder tests for artifact build + validation (mirrors existing).
   - Integration:
     - write succeeds only with verify-manual + ready plan.
     - written artifact has exact shape, correct embedded content, correct safety.
     - generic write rejected.
     - bad paths rejected (absolute, child, outside harness, dir).
     - verify-op on good artifact → validation pass.
     - verify-op on tampered (wrong verdict, bad safety, ID mismatch, forbidden field, wrong kind) → validation fail + checks list.
     - roundtrip: write then verify in same or separate rollup.
     - stdout/JSON behavior and key ordering preserved.
     - no side effects on parent/child state.
   - All existing 15/15 + new pass.

7. **Docs + closure**
   - Update `docs/product/roadmap.md`: add 21F row (prototype), note under 21E future boundary.
   - `docs/product/decision-log.md`: new D entry (D064 or next) recording acceptance of 21F writer+verifier+contract, with evidence (tests, no-mutation, etc.).
   - Update poll usage strings / any inline help if rendered.
   - Brief note in `docs/product/decision-log.md` or this plan about "no execution authority; 22A next for staleness + repo binding".
   - Self-adoption: run sync/quality/ready after changes.

## Deliverables (Files Changed / Added)

**New:**
- `lib/operator-execution-plan-artifact-io.js`
- `lib/repo-rollup-operator-execution-plan-artifact-validation.js`
- `docs/product/phase-21f-operator-plan-artifact.md` (this)
- Possibly `tests/fixtures/...` for bad/good plan artifacts (if needed beyond inline writes)

**Modified:**
- `lib/commands/poll.js` (options + wiring)
- `lib/command-registry.js` (usage)
- `tests/poll-rollup-operator-execution-plan.test.js` (or new test file)
- `docs/product/roadmap.md`
- `docs/product/decision-log.md`
- (any command help / README only if surface changes visibly)

Non-goals for 21F (explicit):
- No actual child execution or writes from the plan.
- No --apply, --execute, task/queue creation.
- No binding to current git HEAD/branch/dirty state (Phase 22A).
- No changes to derived `operator_execution_plan` shape (keep 21E contract).
- No support for legacy/transitional keys (repo/candidate/plan/execution/commands).
- No MCP expansion, no new top-level commands.
- No readiness refresh, decision recording, approval persistence from this surface.

## Exit Criteria (Measurable)

- `poll --rollup --json --verify-manual-work-packet X --write-operator-execution-plan .meta-harness/op-plan.json --force` succeeds and writes canonical artifact when conditions met.
- Written artifact passes all verifier checks; `verdict=pass`, `ok=true`.
- Any deviation (wrong verdict in plan, safety not false, ID mismatch, path escape, wrong kind/source, forbidden fields) produces validation fail + descriptive checks.
- All operator plan tests (old + new) pass 100%.
- `npm test` relevant slice green; `./bin/meta-harness.js poll --rollup ...` exercises work; no parent/child mutation.
- `git diff --check` clean.
- `sync check`, `quality check`, `ready --quick --read-only` pass (with known warnings only).
- Roadmap + decision log updated with honest scope.
- Plan remains read-only guidance; zero execution surface added.

## Safety / Blast Radius Notes

- Writer only fires on explicit flag + verified ready plan.
- All writes guarded by same path resolver as 21C.
- Verification is pure (no fs writes).
- Existing 21E plan emission unchanged unless new verify-op flag.
- Rollup `ok` and child readiness unaffected.
- Matches the "fail closed" discipline of prior phases.

## Next After 21F (preview, not in scope)

Phase 22A — Execution Readiness Contract (still read-only):
- Given a verified operator plan artifact + current child repo (exists? clean? branch? HEAD?).
- Produce structured `execution_readiness` verdict + reasons.
- Digest checks (plan artifact vs current packet/plan, repo state vs any bound snapshot).
- Still no exec/write. Fail closed on mismatch.
- This binds the plan to repo state before any 22B+ execution authority.

## Implementation Notes for Velocity

- Copy/paste/adapt 21C/21D code ruthlessly for consistency (naming, check ids, error style, safety consts).
- Keep changes minimal per slice; commit mentally as "add X".
- After each slice: run the dedicated test file + full `node --test tests/poll-rollup-operator-execution-plan.test.js`.
- Use `--force` in tests where overwrite.
- After all slices: full verification run.

This plan is the audit artifact. Modify if review finds gaps (e.g., exact key ordering for new validation, whether verify-op injects a "verified plan" for future use).
