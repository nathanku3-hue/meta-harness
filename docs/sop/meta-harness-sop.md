# Meta Harness SOP

Status: canonical
Date: 2026-06-19

## Purpose

This SOP defines a Markdown-first operating loop for agent-assisted work. It is designed to keep local status truth visible while work proceeds through coding, research, writing, review, and team handoff.

The harness is not the agent. The harness is the workflow wrapper that records what is happening, what changed, what is known, what is uncertain, and what should happen next.

## Core Principle

Work must be recoverable from artifacts, not from memory.

Every run keeps:

- current status;
- event ledger;
- decisions;
- artifacts;
- background updates;
- handoff notes;
- retrospective lookback.

## Run Modes

| Mode | Use when | Visibility requirement |
| --- | --- | --- |
| `solo` | One agent or person is driving the loop. | Current status and next action are always explicit. |
| `team` | Multiple agents or people are working in parallel. | Owners, assignments, dependencies, and merge points are explicit. |
| `background` | Research, monitoring, or validation continues while primary work proceeds. | New conclusions are introduced through conclusion updates, not silent edits. |
| `review` | Work is being checked against acceptance criteria. | Findings, evidence, severity, and required fixes are explicit. |
| `retrospective` | The run is being reconstructed after the fact. | Timeline and decision rationale are generated from the event ledger. |
| `ship-fast` | An agent is optimizing for the nearest PM-visible result. | Classify first; render user-visible closure with the adaptive policy. |

## Universal Flywheel

```text
observe -> decide -> act -> verify -> record -> update -> continue / hand off / stop
```

### Observe

Read the current local truth:

- goal;
- status;
- files/artifacts;
- open tasks;
- recent events;
- blockers;
- user constraints.

### Decide

Choose one next action. Record why it is the next action.

### Act

Perform the action in the smallest useful unit.

### Verify

Check whether the action changed the local truth as expected.

Examples:

- code compiles;
- tests pass;
- source supports a claim;
- draft section satisfies outline;
- reviewer concern is resolved;
- background finding is incorporated or explicitly rejected.

### Record

Append an event with:

- actor;
- phase;
- action;
- artifact touched;
- verification result;
- decision;
- next action.

### Update

Refresh `status.md` so a new reader can resume without reading the full chat.

## Ship Routing Loop

The Silent Shipper operating layer routes work to the nearest PM-visible result without adding a new CLI command. Existing commands and files are backing evidence only; the operating loop remains Markdown-first and minimal-runtime.

```text
intent -> Question Zero -> local/repo/platform scan -> pre-route decision -> owned scope -> classify risk -> nearest evidence check -> choose one route/outcome -> one PM-facing summary -> record status/event
```

Risk route describes the handling posture. Terminal outcome describes the result. Keep them separate; a risky route is not itself a terminal outcome.

Question Zero: does this need to be built? Before classifying a route, scan local truth, existing repo patterns, platform/runtime/stdlib capabilities, installed dependencies, and packaged templates. Build only after the gap is real, product-important, owned, and bounded.

### Build-vs-Borrow Pre-Route

Pre-route decisions are not terminal outcomes. They choose what path should exist before the work maps to `FAST`, `REVIEW`, `SLOW`, or `BLOCK`.

| Pre-route | Meaning | Then maps to |
| --- | --- | --- |
| `NO_BUILD` | Speculative, unnecessary, already covered, or better answered with explanation. | `FOLLOW_UP_QUEUED` or compact explanation |
| `USE_EXISTING_REPO_PATTERN` | Repo already has a skill, template, helper, command, docs pattern, or local convention. | `SHIP` or `REVIEW` |
| `USE_PLATFORM_NATIVE` | Runtime, stdlib, platform config, or local docs can solve it without new owned code. | `SHIP` or `REVIEW` |
| `MINIMAL_PATCH` | Real gap, owned path, bounded implementation, and nearest evidence can verify it. | `REVIEW` |
| `HUMAN_TASTE` | Product taste, UX tradeoff, naming, priority, or acceptance judgment is the real blocker. | `DECISION_NEEDED` |
| `EXPERT_PACKET` | Architecture, domain, security, provider, release, or other specialist judgment is needed. | `DECISION_NEEDED` or `BLOCKED` |
| `AUTHORITY_BLOCK` | Credentials, permissions, publishing, protected boundary, or missing authority prevents progress. | `BLOCKED` |

Remote/public skills, connectors, MCP servers, or external patterns may inspire a local pattern, but they are not imported or executed unless vendored, provenance-recorded, evaluated, and explicitly authorized.

### Baseline Risk Routes

These routes describe the existing general and machine-facing vocabulary. The canonical agent-level `ship-fast` rules below narrow that vocabulary without changing any Python or Node runtime behavior.

| Route | Use when |
| --- | --- |
| `FAST` | Scope is owned, reversible, locally verifiable, and does not change authority. |
| `REVIEW` | The work touches a shared surface, user-facing claim, acceptance boundary, or reviewer-owned judgment. |
| `SLOW` | Scope, evidence, residue, or sequencing needs deliberate sorting before PM-facing closure. |
| `BLOCK` | Missing authority, access, dependency, or evidence prevents safe progress inside the owned scope. |

### Terminal Outcomes

| Outcome | Means |
| --- | --- |
| `SHIP` | Work is complete and nearest evidence supports it. |
| `REVIEW` | Work is ready for review but is not self-approved as shipped. |
| `DECISION_NEEDED` | A PM, owner, or authority holder must decide before progress or approval. |
| `BLOCKED` | Work cannot proceed without external action, access, dependency, or scope change. |
| `FOLLOW_UP_QUEUED` | Residue is counted, scoped, and queued outside the current PM loop. |

### PM Output Contract

This section is the canonical contract for agent-level `ship-fast`. It is a prompt and artifact discipline only: it adds no command, daemon, Python behavior, Node behavior, or machine-enforced route.

Classify the scenario before planning or editing: `IDEA`, `PLAN`, `AUDIT`, `IMPLEMENT`, `DIRTY_WORKTREE`, `STALE_MAIN`, `WORKER_PATCH`, `PR_REVIEW`, `MERGE`, or `INSTALL_SMOKE`. Read the applicable operations contract, enforce its hard gates, and move exactly one state forward.

Ship-fast has only three routes:

- `FAST`: complete, owned, reversible work with sufficient nearest evidence and no open approval boundary;
- `REVIEW`: a bounded specimen or one reusable decision can safely advance the work;
- `BLOCK`: authority, access, audit, clean-worktree, fresh-base, dependency, or required evidence is missing.

`SLOW` is never emitted in `ship-fast`. Compress a would-be slow case to `REVIEW` when one bounded question or specimen can advance it; otherwise use `BLOCK` and name the next forward gate.

Every ship-fast artifact has exactly one type:

- `PM_CLOSURE`: the PM-visible route, outcome, reason/evidence, and next action only;
- `REVIEW_SPECIMEN`: bounded material presented for a decision, not an implementation claim;
- `MATERIALIZED_IMPLEMENTATION`: files, configuration, code, or a full audit artifact produced only after its gates pass.

A `PM_CLOSURE` never embeds a `REVIEW_SPECIMEN` or `MATERIALIZED_IMPLEMENTATION`. A blocked closure is a status artifact, not an audit packet or implementation plan. Dirty, inherited, or generated residue is counted or queued, not dumped into the PM loop.

Three distinct information channels exist:

- `PM_CLOSURE`: adaptive human-facing status and decision surface;
- `ORCHESTRATOR_HANDOVER`: dense continuation state for the next orchestrator;
- `WORKER_REPORT`: exhaustive execution, validation, accountability, and evidence record.

Status-only artifacts are not shipped progress unless the user explicitly requested status or reporting as the product. Expert packets, approval packets, PM status, and dashboards that only restate current truth may advance a `REVIEW` or `BLOCK` gate, but they do not move implementation progress or terminal outcome to `SHIP`. After approval, the next ship-fast round must either materialize the smallest owned, reversible, locally verifiable slice or emit the bounded gate closure; it must not create another status-only packet as progress.

The PM closure is the chat answer, not the worker-report artifact. Translate internal state into plain language and hide `Outcome`, `Round`, `Progress`, `Confidence`, `Ship gate tier`, SAW/ClosurePacket internals, hashes, absolute paths, file allowlists, command logs, and accountability booleans unless the user asks for evidence. If the user asks for approval text, emit only the pasteable approval block.

Use one canonical user-visible closure policy, separate from machine classifier tiers, worker evidence fields, and internal handover schemas. Include only applicable semantic items, in this order: result and practical effect; reason or nearest evidence when needed; next action when work remains; the highest-priority user decision when one is required. Omit empty or `none` items. Use one short paragraph for simple completion; otherwise use no more than four applicable semantic items. This budget applies only to normal human-facing closure. Requested audits, reviews, safety evidence, and orchestrator handover state are separate surfaces and may expand as needed without converting `PM_CLOSURE` into an audit packet.

Decision-needed questions must use exactly one owner tag:

- `Decision needed (human: taste/acceptance): <question>`;
- `Decision needed (expert: domain knowledge): <question>`;
- `Decision needed (expert: system methodology): <question>`.

Use `Approval needed: <bounded authority, scope, and consequence, or none>` for authority, credentials, publishing, provider access, execution permission, protected-boundary access, and commit or rollout permission. These are approval boundaries or blockers, not expert-decision tags.

`ORCHESTRATOR_HANDOVER` has no arbitrary line cap. It preserves dense continuation state using `CurrentTruth`, `MaterialDelta`, `Validation`, `OpenRisks`, `BlockedBy`, `DecisionQueue`, `NextExecutableAction`, `Boundaries`, `HumanAuditState`, `HumanAuditScope`, and `Provenance`. Each queued decision records its owner tag, question, required evidence, unlock, and owner.

`machine_tier` remains internal code/test state. It maps into `closure_route` and `user_visible_result` before normal chat or `PM_CLOSURE` rendering. Tier fields may remain in `WORKER_REPORT` accountability and evidence surfaces where the worker contract explicitly requires them.

An affirmative signal such as `ok`, `ship`, `approved`, or `好` closes only a pure `HUMAN_TASTE` gate: the active pre-route is exactly `HUMAN_TASTE`, and no authority, security, evidence, scope, safety, git, or implementation gate remains. It resolves the taste decision; it does not claim pending materialization occurred. For every other pre-route, treat the signal as context and re-evaluate the outstanding gate.

Authority-changing materialized work never self-approves. Product, architecture, security, release, provider, and domain-authority implementation cannot close with terminal outcome `SHIP` without the required review. Blocked states name the next forward gate: `Gate N — <pass condition> → unlocks <action>`, never a waiting label. Audit and security work use a numbered, actionable gate sequence.

## Status Truth Template

```md
# Status

Run: <run-id>
Mode: solo | team | background | review | retrospective | ship-fast
Phase: <phase>
Owner: <owner>
Updated: <timestamp>

## Goal

<one paragraph>

## Current Truth

- <fact>
- <fact>

## Active Work

- <task> - <owner> - <state>

## Background Work

- <task> - <owner> - <last update>

## Decisions

- <decision> - <why>

## New Or Revised Conclusions

- <conclusion> - <evidence> - <impact>

## Blockers

- <blocker> - <needed decision or action>

## Next Action

<single next action and reason>

## Stop Criteria

- <done condition>
- <done condition>
```

## Coding Workflow

1. Define the MVP behavior and acceptance criteria.
2. Inspect the repo and record current local truth.
3. Choose one small implementation step.
4. Edit only the relevant files.
5. Run the nearest useful verification.
6. Record result and update status.
7. Iterate until MVP criteria pass.
8. Produce a lookback: what changed, what was verified, what remains risky.

## Academic Research And Writing Workflow

1. Define research question, scope, and target artifact.
2. Separate claims, evidence, draft text, and open questions.
3. Let background research continue as a separate workstream.
4. When background research changes the argument, publish a conclusion update.
5. Incorporate only evidence-backed conclusions into the draft.
6. Run integrity checks before finalizing: citation validity, claim strength, missing counterarguments, and unsupported transitions.
7. Produce a lookback: how the thesis changed, which sources caused changes, and what remains uncertain.

## Background Conclusion Update

```md
# Conclusion Update

Source workstream: <name>
Updated: <timestamp>

## New Conclusion

<claim>

## Evidence

- <source or artifact>

## Confidence

low | medium | high

## Impact

strengthens | weakens | replaces | adds nuance to | conflicts with

## Required Action

accept | reject | revise draft | request more research | human decision needed
```

## Team Handoff

A handoff must include:

- goal;
- current status truth;
- assigned owner;
- artifact map;
- decisions already made;
- blocked questions;
- next action;
- stop criteria.

## Expert Packet And Scope Kit

When a run needs specialist review or delegated work, keep the packet smaller than the repo:

1. install reusable templates with `meta-harness templates install`;
2. run the build-vs-borrow router and create expert context only when the pre-route says outside judgment is needed;
3. choose one bounded scope with the scope-selector template;
4. classify ambiguous work with the boundary-gate template;
5. build a packet with `meta-harness expert-packet <round-id> --include <focused-path>`;
6. reconcile reviewer output through the expert reconciliation matrix.

Expert packets are advisory evidence bundles. They do not authorize execution, production-impacting actions, or scope expansion by themselves. The deliverable is a single `.zip` archive; do not publish sidecar `main.diff`, `main_next_scope.md`, or other loose packet files beside it. If those aids are needed, include them as entries inside the archive.

## Retrospective Lookback

The retrospective is generated from events, not from chat memory.

It should answer:

- What was the original goal?
- What changed?
- What evidence or local verification drove the changes?
- Which decisions mattered?
- Where did the loop backtrack?
- What is done?
- What remains open?

## MVP Implementation Target

The first running version should support:

```text
meta-harness init "<goal>"
meta-harness event --phase <phase> --action <action> --result <result>
meta-harness status
meta-harness lookback
```

No agent framework is required for the first version. The harness can start as local files plus a small CLI.

## Minimal Code Contract

The current minimal implementation is [meta_harness.py](../../meta_harness.py). It intentionally uses only the Python standard library.

The CLI owns these responsibilities:

- create a run directory and active run pointer;
- append JSONL events;
- regenerate `status.md` from the event ledger;
- render `lookback.md` from the event ledger.

The CLI does not own these responsibilities yet:

- launch agents;
- run background workers;
- synchronize multiple collaborators;
- render a dashboard;
- validate research citations.

Those should stay outside the first code path until the event schema and Markdown status surface are stable.
