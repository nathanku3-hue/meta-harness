---
name: ship-fast-decision-router
description: Classify agent-level ship-fast work, route it without SLOW, and emit one bounded artifact or PM closure.
---

# Ship-Fast Decision Router

Use this self-contained agent contract in `ship-fast` mode. It governs prompts and artifacts only; it does not add or alter Python, Node, CLI, or machine ship-gate behavior.

## Classify and Route

Before planning or editing, choose one scenario: `IDEA`, `PLAN`, `AUDIT`, `IMPLEMENT`, `DIRTY_WORKTREE`, `STALE_MAIN`, `WORKER_PATCH`, `PR_REVIEW`, `MERGE`, or `INSTALL_SMOKE`.

Choose one pre-route:

- `NO_BUILD`: implementation is unnecessary.
- `USE_EXISTING_REPO_PATTERN`: an owned local pattern already solves it.
- `USE_PLATFORM_NATIVE`: a standard platform capability solves it.
- `MINIMAL_PATCH`: a real, bounded, owned gap remains.
- `HUMAN_TASTE`: only naming, UX, priority, or acceptance taste remains.
- `EXPERT_PACKET`: specialist judgment is required.
- `AUTHORITY_BLOCK`: permission or protected-boundary authority is missing.

Then choose exactly one ship-fast route:

- `FAST`: complete, owned, reversible, evidenced work with no open approval boundary.
- `REVIEW`: one bounded specimen or reusable decision can safely advance the work.
- `BLOCK`: authority, access, audit, clean-worktree, fresh-base, dependency, or required evidence is missing.

Never emit `SLOW` in ship-fast. Compress a would-be slow case to `REVIEW` when one bounded question or specimen advances it; otherwise use `BLOCK` and name the forward gate.

Terminal outcomes are `SHIP`, `REVIEW`, `DECISION_NEEDED`, `BLOCKED`, and `FOLLOW_UP_QUEUED`. A route is handling posture; an outcome is the result.

## Artifact and Approval Rules

Declare exactly one artifact type:

- `PM_CLOSURE`: route/outcome, reason or nearest evidence, and next action only.
- `REVIEW_SPECIMEN`: bounded decision material, never an implementation claim.
- `MATERIALIZED_IMPLEMENTATION`: files, configuration, code, or a full audit artifact produced only after every gate passes.

Never embed a specimen or implementation in a PM closure. Keep queued residue, generated artifacts, stale warnings, and raw dirty-file lists out of the PM loop.

An affirmative signal (`ok`, `ship`, `approved`, `好`) closes only a pure `HUMAN_TASTE` gate: the active pre-route is exactly `HUMAN_TASTE` and no authority, security, evidence, scope, safety, git, or implementation gate remains. It resolves taste only; otherwise re-evaluate the open gate.

Authority-changing materialized work never self-approves. Ask users only for reusable decisions, and treat evidence paths as proof rather than decision identity.

## Output Contract

For `FAST` or a pure `HUMAN_TASTE` `REVIEW` gate, emit one physical `PM_CLOSURE` line and stop:

```text
Artifact: PM_CLOSURE | Route: <FAST|REVIEW> | Outcome: <SHIP|REVIEW|DECISION_NEEDED|FOLLOW_UP_QUEUED> | Verdict: <result and reason> | Next: <action or stop>
```

A `REVIEW` `PM_CLOSURE` is at most 3 non-empty lines:

```text
Artifact: PM_CLOSURE | Route: REVIEW | Outcome: <REVIEW|DECISION_NEEDED>
Review: <one bounded question or nearest evidence>
Next: <one action and owner>
```

A `BLOCK` `PM_CLOSURE` is at most 5 non-empty lines:

```text
Artifact: PM_CLOSURE | Pre-route: <decision>
Route: BLOCK | Outcome: BLOCKED
Blocker: <one current hard gate>
Evidence: <nearest proof or none>
Next: Gate <N> — <pass condition> → unlocks <action>
```

A blocked closure is status, not an audit packet or implementation plan. Its final line names the next actionable gate rather than a wait state.
