---
name: ship-fast-decision-router
description: Classify an agent-level ship-fast scenario, route it without SLOW, and emit a budgeted PM closure or bounded artifact.
---

# Ship-Fast Decision Router

Use this self-contained agent contract when the run mode is `ship-fast`. It governs prompts and artifacts only; it does not add or alter Python, Node, CLI, or machine ship-gate behavior.

## 1. Classify First

Choose exactly one scenario before planning or editing: `IDEA`, `PLAN`, `AUDIT`, `IMPLEMENT`, `DIRTY_WORKTREE`, `STALE_MAIN`, `WORKER_PATCH`, `PR_REVIEW`, `MERGE`, or `INSTALL_SMOKE`.

Then choose a pre-route, a ship-fast route, a terminal outcome, and one artifact type. Commands and evidence paths support the decision; they are not the PM-facing decision.

## 2. Pre-Route

- `NO_BUILD`: speculative, unnecessary, already covered, or better answered with explanation.
- `USE_EXISTING_REPO_PATTERN`: local skill, template, helper, command, docs pattern, or convention already solves it.
- `USE_PLATFORM_NATIVE`: runtime, stdlib, platform config, or local docs can solve it.
- `MINIMAL_PATCH`: real owned gap with bounded implementation and local evidence.
- `HUMAN_TASTE`: product taste, UX tradeoff, naming, priority, or acceptance judgment is needed.
- `EXPERT_PACKET`: architecture, domain, security, provider, release, or specialist judgment is needed.
- `AUTHORITY_BLOCK`: credentials, permissions, publishing, protected boundary, or missing authority blocks progress.

## 3. Ship-Fast Routes

- `FAST`: complete, owned, reversible, locally evidenced, and crosses no approval boundary.
- `REVIEW`: one bounded specimen or one reusable decision can safely advance the work.
- `BLOCK`: authority, access, audit, clean-worktree, fresh-base, dependency, or required evidence is missing.

Never emit `SLOW` in ship-fast. Compress a would-be slow case to `REVIEW` when one question or bounded specimen advances it; otherwise use `BLOCK` and name the forward gate.

## 4. Terminal Outcomes

- `SHIP`: work is complete, nearest evidence supports it, and no approval boundary is crossed.
- `REVIEW`: work is ready for review and is not self-approved as shipped.
- `DECISION_NEEDED`: a PM, owner, or authority holder must decide before progress or approval.
- `BLOCKED`: work cannot proceed without external action, access, dependency, or scope change.
- `FOLLOW_UP_QUEUED`: residue is counted, scoped, and queued outside the current PM loop.

## 5. Artifact Taxonomy

- `PM_CLOSURE`: route, outcome, reason/evidence, and next action only.
- `REVIEW_SPECIMEN`: bounded decision material; never an implementation claim.
- `MATERIALIZED_IMPLEMENTATION`: files, configuration, code, or a full audit artifact produced only after all gates pass.

Declare exactly one artifact type. Never embed a specimen or materialized implementation in a PM closure. A blocker is a status artifact, not an audit packet or implementation plan.

Status-only artifacts are not shipped progress unless the user explicitly requested status or reporting as the product. Expert packets, approval packets, PM status, and dashboards that only restate current truth may advance a `REVIEW` or `BLOCK` gate, but they do not move implementation progress or terminal outcome to `SHIP`. After approval, the next ship-fast round must either materialize the smallest owned, reversible, locally verifiable slice or emit the bounded gate closure; it must not create another status-only packet as progress.

The PM closure is the chat answer, not the worker-report artifact. Translate internal state into plain language and hide `Outcome`, `Round`, `Progress`, `Confidence`, `Ship gate tier`, SAW/ClosurePacket internals, hashes, absolute paths, file allowlists, command logs, and accountability booleans unless the user asks for evidence. If the user asks for approval text, emit only the pasteable approval block.

## 6. Routing Rules

1. Never self-approve authority-changing work; use `REVIEW`, `DECISION_NEEDED`, or `BLOCKED` as the terminal outcome.
2. Ask the user only for reusable decisions. Keep `QUEUE`, `PASS`, suppressed residue, and raw dirty classifications out of the decision loop.
3. Show blockers and escalations only when they are current-scope, boundary-touching, or decision-relevant.
4. Treat evidence paths as proof, not decision identity. Do not reopen a decision just because an evidence path changed.
5. Use existing commands only as optional evidence tools; do not present command output as the closure.
6. Product, architecture, security, release, provider, and domain-authority materialized changes cannot close with terminal outcome `SHIP` without their required review.
7. Create expert packets only after the pre-route decision says outside judgment is needed.
8. When outcome is `BLOCKED`, the Next field must name the next forward gate, not a wait state. Write "Gate N — <pass condition>" not "Status remains <WAIT_LABEL>". Audit and security packets use a named gate sequence (G0, G1, …); the current gate is always open and actionable.
9. An affirmative signal such as `ok`, `ship`, `approved`, or `好` closes only a pure `HUMAN_TASTE` gate: the active pre-route is exactly `HUMAN_TASTE`, with no authority, security, evidence, scope, safety, git, or implementation gate left. It resolves taste only and never claims pending materialization occurred.

## 7. Output Contract

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
