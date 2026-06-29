# Ship-Fast Decision Gate

Status: Distributable agent contract
Scope: Prompt and artifact behavior only; no Python, Node, CLI, or machine ship-gate behavior.

## Input

```text
Scenario: IDEA | PLAN | AUDIT | IMPLEMENT | DIRTY_WORKTREE | STALE_MAIN | WORKER_PATCH | PR_REVIEW | MERGE | INSTALL_SMOKE
Pre-route: NO_BUILD | USE_EXISTING_REPO_PATTERN | USE_PLATFORM_NATIVE | MINIMAL_PATCH | HUMAN_TASTE | EXPERT_PACKET | AUTHORITY_BLOCK
Route: FAST | REVIEW | BLOCK
Artifact type: PM_CLOSURE | REVIEW_SPECIMEN | MATERIALIZED_IMPLEMENTATION
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

Render one `PM_CLOSURE` using the canonical user-visible closure policy, separate from machine classifier tiers, worker evidence fields, and internal handover schemas. Internal classifier fields (`Pre-route`, `Route`, `Outcome`, `Artifact`, `machine_tier`, and raw ship-gate metadata) do not appear in normal chat or `PM_CLOSURE` output.

Include only applicable semantic items, in this order:

1. result and practical effect;
2. reason or nearest evidence when needed to interpret the result;
3. next action when work remains;
4. the highest-priority user decision when one is required.

Omit empty or `none` items. Use one short paragraph for simple completion; otherwise use no more than four applicable semantic items. Labels are optional. This budget applies only to normal human-facing closure. Requested audits, reviews, safety evidence, and `ORCHESTRATOR_HANDOVER` state are separate surfaces and may expand as needed without converting `PM_CLOSURE` into an audit packet.

Decision-needed questions use exactly one owner tag:

- `Decision needed (human: taste/acceptance): <question>`
- `Decision needed (expert: domain knowledge): <question>`
- `Decision needed (expert: system methodology): <question>`

Use `Approval needed: <bounded authority, scope, and consequence, or none>` for authority, credentials, publishing, provider access, execution permission, protected-boundary access, and commit or rollout permission. Those are approval boundaries or blockers, not expert-decision tags.

`machine_tier` remains internal code/test state and maps into `closure_route` and `user_visible_result` before normal chat or `PM_CLOSURE` rendering. Tier fields may remain in `WORKER_REPORT` accountability and evidence surfaces where its contract requires them.

Examples:

- Complete: `Updated the guidance scanner and verified 37 focused tests. No user action remains.`
- Blocked: `Blocked: release verification needs repository settings unavailable locally. Repository owner: provide the settings export; that unlocks verification only.`
- Decision: `Decision needed (human: taste/acceptance): accept the compact labels or request one revision?`
- Approval: `Approval needed: run the bounded dashboard marker repair. Scope is the label restoration only.`
- Evidence: `Verdict: rollout complete. Sync and active-guidance scans pass on all 10 installs; fresh agent contexts are still required for behavioral proof.`

Authority-changing materialized work never self-approves. A blocked closure names an actionable forward gate and never expands into an audit packet, design, or implementation plan.
