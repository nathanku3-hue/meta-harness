# Phase 13A Context Quality Gate Plan

Status: planned design artifact under D032; implementation requires D033
Date: 2026-06-12

## Purpose

Phase 13A adds a deterministic context-quality gate before larger multi-repo rollup work. The gate answers one question:

```text
Can a fresh worker proceed from the current phase to the next phase without inventing product intent, stack, scope, proof, or stop rules?
```

This is intentionally earlier than Phase 13 multi-repo rollup. More repo visibility will not help if each local round can proceed with stale, vague, or unaudited context.

## Operating Rule

Workers do not decide whether context is sufficient. Meta-Harness does.

A phase transition may proceed only when the harness can produce a compact, evidence-backed context packet. The packet must identify the goal, scope boundary, repo and stack, owned surface, evidence plan, risk and stop rules, freshness posture, and handoff expectations.

## Phase Transitions

The gate runs before each fixed phase-map transition:

- `intake->plan`
- `plan->work`
- `work->verify`
- `verify->synthesize`
- `synthesize->handoff`
- `handoff->lookback`

## Scoring Dimensions

Each dimension is scored 1-10:

1. Product outcome: why now, for whom, and what feels done.
2. Scope boundary: smallest useful delivery, out-of-scope, and forbidden scope.
3. Repo and stack: target repo, stack/framework/runtime, branch, package, and app surface.
4. Owned surface: allowed files/directories, forbidden files/directories, and integration points.
5. Evidence plan: test command, demo path, acceptance check, and proof/citation needs.
6. Risk and stop rules: secrets, data, provider boundaries, rollback condition, and pause rules.
7. Freshness: docs/API currency and stale or missing external context.
8. Handoff completeness: worker type, expected output, and required report fields.

Unknown dimensions score as 1 and appear in `unknown_dimensions`. If any unknown remains after valid hints, `overall_score` is forced to 1 and the verdict is `blocked`.

## Blocker Model

Structural hard blockers cannot be cleared by hints:

- missing repo target
- missing stack/framework identity
- secrets or provider access without permission
- untrusted issue/PR text copied into worker prompts
- missing out-of-scope boundary for execution transitions

Evidence gaps may be satisfied by valid, provenance-backed hints:

- freshness uncertain
- acceptance taste unclear
- proof command unverified
- handoff format unspecified

Hints require `dimension`, `value`, `reason`, `author`, and `expires_at`. Hints expire after at most seven days, cannot clear structural blockers, and cannot raise a dimension above 9. A score of 10 requires gate evidence.

## Verdict Logic

- Any structural hard blocker: `blocked`
- Any unresolved unknown dimension: `blocked`
- Any unresolved evidence gap: `blocked`
- Any dimension below 4: `blocked`
- Overall below 6: `blocked`
- Overall 6-7: `narrowed`
- Overall 8-9: `proceed`
- Overall 10: `excellent`

Averages must not hide dangerous low scores.

## Artifacts

Source templates:

- `templates/contracts/context-gate-schema.json`
- `templates/skills/context-quality-gate.md`
- `templates/skills/context-packet.md`

Default local outputs:

- `.meta-harness/local/context/ROUND-NNN.json`
- `.meta-harness/local/context/ROUND-NNN.md`

Tracked archival outputs:

- `.meta-harness/context/ROUND-NNN.json`
- `.meta-harness/context/ROUND-NNN.md`

Tracked archival requires `--commit-artifact` and must pass committed-artifact redaction before writing. Local outputs stay under `.meta-harness/local/context/`, which is gitignored.

## CLI Candidate

D033 candidate command shape:

```text
meta-harness context check --from <phase> --to <phase> [--round <id>] [--json] [--out <path>] [--commit-artifact]
meta-harness context packet <round-id> --for <worker|review|planning> [--json] [--out <path>]
meta-harness context ask <round-id> [--json]
```

`context check` evaluates the current harness files and writes the gate output. `context packet` assembles a compact worker/review/planning packet from the gate output and harness truth. `context ask` returns at most three blocker-clearing questions.

## Ready Integration Candidate

D033 should add `MH_CONTEXT_GATE_001` as an optional ready check:

- If no context artifact exists, return `skip` with `applicable: false`; strict and release modes must not fail merely because the surface is absent.
- If context artifacts exist, select the highest numeric `ROUND-NNN` across local and tracked context directories.
- Validate JSON parse, required fields, schema shape, and `generated_at` freshness no older than seven days.
- Do not fail because the gate verdict is `blocked`; a blocked verdict is a valid gate state.

## Redaction Surface Candidate

Committed context artifacts under `.meta-harness/context/` must be scanned by the redaction pipeline. D033 should wire `security-policy.json` `redaction_surfaces` into the `scanRedactionSurfaces` call so policy-declared context artifacts are checked. Repos without policy surfaces fall back to the existing hardcoded defaults.

## Non-Goals

- No MCP integration.
- No Context7 adapter.
- No AGENTS.md or CLAUDE.md export.
- No multi-repo rollup.
- No controlled autonomy.
- No model API, network requirement, or LLM scoring.
- No arbitrary shell execution.
- No template manifest hand editing.

## Verification Candidate

Focused D033 verification:

```bash
node --test tests/context-gate.test.js tests/cli-context.test.js
node --test tests/redaction-check.test.js tests/security-check.test.js
node --test tests/command-registry.test.js tests/cli-ready.test.js
```

Full D033 verification:

```bash
npm test
node bin/meta-harness.js quality check
node bin/meta-harness.js templates install --overwrite --allow-dirty
node bin/meta-harness.js sync check --target .
node bin/meta-harness.js ready --target . --quick --read-only --json
```
