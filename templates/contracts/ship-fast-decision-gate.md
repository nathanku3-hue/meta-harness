# Ship-Fast Decision Gate

Status: Distributable agent contract
Scope: Prompt and artifact behavior only; no Python, Node, CLI, or machine ship-gate behavior.

## Input

```text
Mode: one-liner | full
Scenario: IDEA | PLAN | AUDIT | IMPLEMENT | DIRTY_WORKTREE | STALE_MAIN | WORKER_PATCH | PR_REVIEW | MERGE | INSTALL_SMOKE
Pre-route: NO_BUILD | USE_EXISTING_REPO_PATTERN | USE_PLATFORM_NATIVE | MINIMAL_PATCH | HUMAN_TASTE | EXPERT_PACKET | AUTHORITY_BLOCK
Route: FAST | REVIEW | BLOCK
Artifact: PM_CLOSURE | REVIEW_SPECIMEN | MATERIALIZED_IMPLEMENTATION
```

Classify before planning or editing. Ship-fast never emits `SLOW`: compress a would-be slow case to `REVIEW` if one bounded question or specimen advances the work; otherwise use `BLOCK`.

Pre-route meanings:

- `NO_BUILD`: implementation is not warranted.
- `USE_EXISTING_REPO_PATTERN`: an owned local pattern already solves it.
- `USE_PLATFORM_NATIVE`: the platform or standard capability solves it.
- `MINIMAL_PATCH`: a real, bounded, owned gap remains.
- `HUMAN_TASTE`: only naming, UX, priority, or acceptance taste remains.
- `EXPERT_PACKET`: specialist judgment is required.
- `AUTHORITY_BLOCK`: permission or protected-boundary authority is missing.

Route meanings:

- `FAST`: work is complete, owned, reversible, evidenced, and crosses no approval boundary.
- `REVIEW`: one bounded specimen or reusable decision can safely advance the work.
- `BLOCK`: authority, access, audit, clean-worktree, fresh-base, dependency, or required evidence is missing.

Terminal outcomes are `SHIP` (complete and evidenced), `REVIEW` (ready but not self-approved), `DECISION_NEEDED` (one owner decision), `BLOCKED` (external gate), and `FOLLOW_UP_QUEUED` (bounded residue outside this loop).

## Artifact Rules

- `PM_CLOSURE` contains only route/outcome, reason or nearest evidence, and next action.
- `REVIEW_SPECIMEN` is bounded decision material, not an implementation claim.
- `MATERIALIZED_IMPLEMENTATION` is code, files, configuration, or a full audit artifact and is allowed only after every gate passes.
- Declare one type. Never embed a specimen or implementation in a PM closure.
- Status-only artifacts are not shipped progress unless the user explicitly requested status or reporting as the product. Expert packets, approval packets, PM status, and dashboards that only restate current truth may advance a `REVIEW` or `BLOCK` gate, but they do not move implementation progress or terminal outcome to `SHIP`.
- After approval, the next ship-fast round must either materialize the smallest owned, reversible, locally verifiable slice or emit the bounded gate closure; it must not create another status-only packet as progress.
- The PM closure is the chat answer, not the worker-report artifact. Translate internal state into plain language and hide `Outcome`, `Round`, `Progress`, `Confidence`, `Ship gate tier`, SAW/ClosurePacket internals, hashes, absolute paths, file allowlists, command logs, and accountability booleans unless the user asks for evidence.
- Approval text requests return only the pasteable approval block.

## Approval Rule

An affirmative signal (`ok`, `ship`, `approved`, `好`) closes only a pure `HUMAN_TASTE` gate: the active pre-route is exactly `HUMAN_TASTE` and no authority, security, evidence, scope, safety, git, or implementation gate remains. It resolves taste only; otherwise re-evaluate the open gate.

## Output

For `Mode: one-liner`, valid only for `FAST` or a pure `HUMAN_TASTE` `REVIEW` gate, emit one physical line and stop:

```text
Verdict: <result and reason> | Next: <action or stop>
```

For `Mode: full`, emit only one `PM_CLOSURE`. `REVIEW` is at most 3 non-empty lines:

```text
Artifact: PM_CLOSURE | Route: REVIEW | Outcome: <REVIEW|DECISION_NEEDED>
Review: <one bounded question or nearest evidence>
Next: <one action and owner>
```

`BLOCK` is at most 5 non-empty lines:

```text
Artifact: PM_CLOSURE | Pre-route: <decision>
Route: BLOCK | Outcome: BLOCKED
Blocker: <one current hard gate>
Evidence: <nearest proof or none>
Next: Gate <N> — <pass condition> → unlocks <action>
```

Authority-changing materialized work never self-approves. A blocked closure names an actionable forward gate and never expands into an audit packet, design, or implementation plan.
