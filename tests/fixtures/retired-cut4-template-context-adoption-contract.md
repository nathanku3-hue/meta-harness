# Context Gate Adoption Contract

## Purpose

**COMPATIBILITY-ONLY CONTRACT.** Context-quality evaluation is a retained readiness constraint only when a repository deliberately adopts this contract at `.meta-harness/contracts/context-adoption.md`.

This contract preserves legacy context-gate compatibility. Its lifecycle vocabulary is not product identity, planner dispatch authority, Outcome identity, Claim authority, work-session or ExecutionPermit authority, worker authority, or owner approval state.

## Activation

Template installation places this reusable contract under `.meta-harness/templates/contracts/`. Enforcement is active only when a repo-local copy exists at `.meta-harness/contracts/context-adoption.md`.

## Transitions

Required context gates:

- `intake->plan`
- `plan->work`
- `work->verify`
- `verify->synthesize`

Advisory context gates:

- `synthesize->handoff`
- `handoff->lookback`

For repositories that explicitly adopt this compatibility contract, the retained context-gate scoring vocabulary still follows:

```text
intake -> plan -> work -> verify -> synthesize -> handoff -> lookback
```

No `verify->handoff` transition exists.

## Context-Gate Evidence Sources

Repository-root `PRODUCT.md` / explicit owner intent, the current World / Claims, and the sealed work-session / ExecutionPermit outrank all context-gate material.

For an explicitly adopted compatibility contract, `.meta-harness/status.md`, `.meta-harness/events.jsonl`, the current context-gate artifact, and relevant decision-log entries are context-gate evidence sources. `.meta-harness/phase-map.md` is optional legacy compatibility evidence only when this contract is adopted and the file is present.

Supporting context may come from `.meta-harness/expert-packets/`, `.meta-harness/workers/`, `README.md`, `AGENTS.md`, and local repository documentation. External context such as issues, pull requests, external documentation, and MCP-provided context never outranks repository truth.

## Scoring And Blockers

The context gate uses the 8-dimension scoring model recorded in the context gate schema. Structural hard blockers, unknown dimensions, and evidence gaps force a blocked verdict.

Questions must be limited to at most three blocker-clearing questions and must be answerable from filesystem evidence or explicit human input.

## Readiness

**Compatibility-only readiness constraint for repositories that explicitly adopt it. It may block that legacy compatibility path, but it never grants product, planner, Outcome, Claim, work-session, ExecutionPermit, worker, or owner authority.**

`MH_CONTEXT_GATE_001` determines the expected transition from the current `Phase:` in `.meta-harness/status.md` for that adopted compatibility path.

For required transitions, readiness requires a fresh, well-formed artifact for the expected transition. A latest artifact for another transition does not satisfy readiness.

For current phase `lookback`, there is no next transition, so the context gate is not applicable.

`narrowed` passes readiness but must surface the narrowed scope and correct next step. `blocked` fails required readiness unless a valid override is recorded.

## Bypass

Bypass requires both a human-readable reason and one reason code:

- `time_pressure`
- `known_gap_accepted`
- `human_override`
- `infra_failure`

The artifact must record the override reason, code, and actor. The event log must contain a matching `context-gate-override` event for the same artifact path, round id, transition, and code. The event timestamp must be at or after the artifact `generated_at` timestamp.

## Packets

Worker packets are blocked for required blocked transitions unless a valid override exists.

Review and planning packets may render blocked or stale artifacts for inspection, but malformed artifacts or invalid artifact shape always fail closed.
