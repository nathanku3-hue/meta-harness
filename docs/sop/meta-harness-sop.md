# Meta Harness SOP

Status: canonical
Candidate direction proposed: 2026-07-22
Active direction banked: 2026-07-21
D088 activation banked: 2026-07-22
Intent authority: [Product Intent Anchor](../product/product-intent.md)
Roadmap authority: [Roadmap](../product/roadmap.md)

## Current Core Principle

Work must remain aligned with human intent and recoverable from validated artifacts rather than conversation memory.

D089 activates D088 while preserving the D085/D086 external-product proof boundary. The active thin reusable product-progress loop inside each managed repository is:

```text
SESSION ALIGNMENT
→ PRODUCT BOTTLENECK
→ THINNEST COMPLETE REPRESENTATIVE LOOP
→ AUTHORIZED EXECUTION
→ PRODUCT VERIFICATION
→ RETAINED EVIDENCE AND EXACT CONTINUATION
```

Across repositories, compare where the next complete product loop has the highest marginal value only when no authorized slice exists, the active slice closes or is decisively blocked, or the human explicitly reprioritizes. Do not run the outer comparison before every action or create a permanent scheduler, dashboard, database, queue, or portfolio-control layer.

Internal separations are mandatory:

- authoritative repository/ref before planning;
- intent and endgame before local defect;
- complete product loop before isolated-layer depth;
- product movement before harness improvement;
- evidence before narrative;
- triggered audit before material direction, repository, risk, authority, contradiction, or infrastructure decisions;
- receiver validation before resume;
- one writer before multi-agent fan-out;
- shipping outcome before internal completion.

The selection objective is endgame-relevant, user-observable product proof per elapsed time and human attention. Completion scores record earned evidence and never choose work.

## Canonical Read Order

Before reading product files, resolve repository identity, authoritative branch/ref, exact commit, and whether the current checkout is stale, dirty, superseded, or non-authoritative. Ambiguity blocks planning. This preflight prevents a coherent stale checkout from becoming session truth.

After entry resolution, every round reads local files in this order:

1. active human intent version;
2. explicit human decisions and overrides;
3. repository commit, tree, tag, dirty state, and active lease;
4. current objective, product endgame, current bottleneck, slice, RunSpec, and authorization;
5. immutable execution, audit, and outcome evidence;
6. canonical event/fact ledger;
7. active roadmap and product contracts;
8. generated status, handoff, behavior map, and summaries.

A generated projection never overrides its canonical sources. A material contradiction blocks planning and execution.

## Auditor–Planner Contract

The auditor-planner uses two immutable passes after a completed slice, decisive failure, or material plan-review trigger. A separate plan audit is not universal for aligned reversible work.

### Pass A — Audit

Audit observes the completed round, extracts all **decision-relevant** insight, scores the result, and freezes the audit artifact.

Decision-relevant insight must alter at least one of:

- product interpretation;
- slice ordering;
- system or behavior map;
- implementation strategy;
- risk;
- verification;
- required expertise;
- routing policy;
- human decision.

The audit records:

- newly true product behavior;
- required invariants that remain true;
- failed or missing behavior;
- evidence quality and independence;
- process quality, retries, waste, and plan-to-diff drift;
- salvageable partial results;
- intent alignment;
- scope and roadmap deviation;
- shipping effect;
- prediction versus observation;
- new insight and unresolved unknowns.

The audit does not select the next roadmap item and cannot be edited during planning to support a later recommendation.

### Pass B — Plan

When an audit is triggered, planning reads the frozen audit and then re-reads the human intent verbatim. Otherwise session alignment and automated preflight may proceed directly to bounded execution.

It considers at least:

1. the best forward functional slice;
2. the best information-gathering or risk-reduction action;
3. ship, stop, defer, repair, or no-build.

Planning priority is:

1. ship the active objective;
2. unlock its critical path;
3. reduce uncertainty blocking that path;
4. fix defects threatening that path;
5. improve the harness only when a product slice cannot ship without it.

The plan emits one numbered slice and a bounded RunSpec containing product delta, shipping target, affected behaviors/modules, required expertise, authority envelope, verification contract, budget, expiry, stop rules, and predicted outcome.

The planner chooses the thinnest complete endgame-representative loop, not the highest roadmap score, easiest patch, best-isolated module, or largest architecture program.

Under active D088, Gate 0A plus the contracted owned-versus-model-supplied boundary closes R2A without another implementation phase. The same read-only method was applied before activation across Meta-Harness, Quant, and Leningrad. R2C compared `NO_BUILD`, guidance-only correction, and one invariant, then selected the smallest common missing capability: a read-only `ENTRY_AUTHORITY_INVARIANT` in the existing readiness/entry surface. The checkout under evaluation cannot declare itself authoritative. Trusted expected repository identity must come from the controller-authorized RunSpec, explicit trusted operator input through an authenticated boundary, a signed canonical event or receipt, or independently anchored immutable evidence. Repository files may supply observed facts only. The result is exactly `PASS_CURRENT`, `REDIRECT` with an exact path/ref/commit, `CUSTODY_REQUIRED`, or `BLOCK`. D089 accepts that contract and opens only its R3 implementation.

Meta-Harness owns durable intent, decisions, repository state, authority/scope/risk boundaries, completed-work evidence, and continuation. The model supplies planning, product reasoning, alternatives, implementation, research synthesis, and most audit reasoning. Every SOP, skill, template, check, or runtime layer must have a deletion or shrink path as model capability improves.

## Worker Contract

The worker:

1. resolves the authoritative repository/ref, then verifies intent version, RunSpec, lease, and authorization;
2. silently reconstructs endgame, current product capability, current bottleneck, smallest complete next result, fastest-route rationale, and deferred work;
3. reads relevant local source before generated summaries;
4. states the newly true product behavior it will create;
5. emits a compact execution plan;
6. passes automated plan preflight;
7. executes all reversible work already authorized without routine waiting;
8. uses scouts or parallel work only when expected completion time decreases;
9. checkpoints each independently valid increment;
10. records deviations, invalidated assumptions, and partial results immediately;
11. returns structured evidence and a typed handoff;
12. never declares the roadmap or final shipping result;
13. stops at the RunSpec boundary.

The compact plan contains only:

- intended product behavior;
- expected files and modules;
- invariants that must remain true;
- implementation sequence;
- verification sequence;
- stop and escalation conditions.

More detail is required only when uncertainty or integration risk is high.

## Human Gate Contract

The worker waits only for:

- `G-AUTHORITY` — permission, credential, publication, or protected boundary;
- `G-TASTE` — product or UX judgment;
- `G-RISK` — material irreversible or high-impact risk acceptance;
- `G-SCOPE` — meaningful expansion beyond the authorized outcome.

Every gate states one decision, recommended choice, alternatives, consequence, required input, and skip condition. A valid pre-authorization envelope eliminates repeated gates for reversible actions inside its scope.

## Verification Contract

The verifier initially receives the intent, RunSpec, clean base, candidate diff, acceptance contract, observable output, and independent test surface. It does not initially receive the worker's private reasoning or preferred next action.

Verification separately scores:

- terminal correctness;
- evidence strength;
- global invariants;
- process quality;
- plan-to-diff drift;
- rework and maintenance burden;
- shipping state.

Passing tests alone cannot close a slice.

For a specialist-knowledge product slice, verification separates two claims:

- code, scope, custody, tests, and observable product behavior require independent acceptance;
- specialist knowledge must be explicit, provenance-linked, materially shape the output, and remain challengeable, while independent domain correctness, generalization, and real-world value remain a separate later proof.

The claim ceiling must travel with the merged and packaged artifact itself. A planning-only disclaimer does not satisfy continuity or no-silent-drift.

## Handoff and Resume Contract

A handoff is a hash-bound state transition, not a summary. It records identity, versions, intent, authority, repository state, completed/current/incomplete operations, continuation cursor, decisions, assumptions, rejected approaches, evidence, next operation, recovery, and expiry.

Before resume, the receiver independently returns:

- objective understood;
- current state understood;
- completed work;
- unfinished work;
- exact next operation;
- forbidden action;
- done condition.

The controller compares this with the handoff. Any mismatch, stale repository state, expired authority, newer handoff, active competing lease, superseding override, or completed equivalent run blocks continuation.

Planned compaction or shutdown follows:

1. publish an atomic checkpoint;
2. generate the typed handoff;
3. validate it from a fresh process;
4. compact or stop;
5. resume from the artifact rather than the conversation;
6. confirm intent, cursor, authority, and repository identity.

## Loop Disposition

The auditor-planner returns exactly one:

- `ACCEPT_AND_CONTINUE`;
- `ACCEPT_AND_SHIP`;
- `REPAIR_CURRENT_SLICE`;
- `SALVAGE_AND_REPLAN`;
- `REJECT_AND_REPLAN`;
- `HUMAN_GATE`;
- `STOP`.

The controller then updates canonical state atomically.

## Multi-Agent Rule

Do not automate more agents until one fresh worker can reliably continue another worker's work from artifacts alone while preserving original intent.

Later fan-out requires disjoint writes or read-only roles, leases, duplicate suppression, independent acceptance checks, deterministic integration order, cancellation propagation, salvage classification, and measured latency benefit greater than coordination cost.

## Active Build Boundary

D089 activates D088, preserves the D085/D086 product-proof boundary, accepts R2A/R2B/R2C, and records R3 as the only current implementation slice.

```text
ROADMAP_PROOF_SCORE = 40 / 100
S-006M_EXTERNAL_LOOPS_SHIPPED = 0 / 1
```

D087 is historical candidate reasoning. D088 is active. The accepted proof completed R2A, R2B, and R2C:

```text
Gate 0A authority and no-destructive-operation boundary
→ contracted durable owned layer
→ read-only proof across Meta-Harness, Quant, and Leningrad
→ materially different product recommendations
→ common ENTRY_AUTHORITY_AMBIGUITY defect
→ selected read-only ENTRY_AUTHORITY_INVARIANT
```

The comparative evidence is retained once in `docs/ops/audits/d088-cross-repository-proof.json`, not copied across product surfaces. Exact elapsed time was not instrumented in the first run; R3 rerun must measure elapsed time and context volume.

R3 implements only the accepted entry-authority invariant by reusing existing identity and readiness primitives. No external product implementation begins before independent R3 acceptance. R4 then uses the accepted method to select and ship one real product slice across the proving repositories. That selected slice must still materially combine software engineering with explicit specialist judgment under D085/D086.

The runtime remains verifier-only; epoch-1 evidence is frozen and not an active mutation path. Central registries, schedulers, dashboards, queues, databases, grill engines, internal vaults, signer services, dual-epoch compatibility, broad filesystem frameworks, generic knowledge platforms, permanent multi-agent layers, automated trading, and finance-specific runtime paths remain deferred.

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

Classify internally before planning or editing: `SESSION_ALIGN`, `ENTRY_CONVERGENCE`, `IDEA`, `PLAN`, `PRODUCT_LOCK`, `SLICE_LOCK`, `AUDIT`, `IMPLEMENT`, `DIRTY_WORKTREE`, `STALE_ENTRY`, `WORKER_PATCH`, `PR_REVIEW`, `MERGE`, `PACKAGE`, `PUBLISH`, or `INSTALL_SMOKE`. Read the applicable operations contract, enforce its hard gates, and move exactly one state forward. These classifier names are not normal chat content.

Ship-fast has only three routes:

- `FAST`: complete, owned, reversible work with sufficient nearest evidence and no open approval boundary;
- `REVIEW`: a bounded specimen or one reusable decision can safely advance the work;
- `BLOCK`: authority, access, audit, clean-worktree, fresh-base, dependency, or required evidence is missing.

`SLOW` is never emitted in `ship-fast`. Compress a would-be slow case to `REVIEW` when one bounded question or specimen can advance it; otherwise use `BLOCK` and name the next forward gate.

Every ship-fast artifact has exactly one type:

- `PM_CLOSURE`: product capability, supporting evidence only when needed, direction-changing learning, next product bottleneck, and genuine human decision only;
- `REVIEW_SPECIMEN`: bounded material presented for a decision, not an implementation claim;
- `MATERIALIZED_IMPLEMENTATION`: files, configuration, code, or a full audit artifact produced only after its gates pass.

A `PM_CLOSURE` never embeds a `REVIEW_SPECIMEN` or `MATERIALIZED_IMPLEMENTATION`. A blocked closure is a status artifact, not an audit packet or implementation plan. Dirty, inherited, or generated residue is counted or queued, not dumped into the PM loop.

Three distinct information channels exist:

- `PM_CLOSURE`: adaptive human-facing status and decision surface;
- `ORCHESTRATOR_HANDOVER`: dense continuation state for the next orchestrator;
- `WORKER_REPORT`: exhaustive execution, validation, accountability, and evidence record.

Status-only artifacts are not shipped progress unless the user explicitly requested status or reporting as the product. Expert packets, approval packets, PM status, and dashboards that only restate current truth may advance a `REVIEW` or `BLOCK` gate, but they do not move implementation progress or terminal outcome to `SHIP`. After approval, the next ship-fast round must either materialize the smallest owned, reversible, locally verifiable slice or emit the bounded gate closure; it must not create another status-only packet as progress.

The PM closure is the chat answer, not the worker-report artifact. Do not translate internal process machinery into friendlier vocabulary and then copy it into chat. Omit authority, custody, score, receipt, branch, projection, path, allowlist, command-log, classifier, and accountability detail unless it blocks progress, is disputed, or the user asks for evidence. If the user asks for approval text, emit only the pasteable approval block.

Use one canonical user-visible closure policy. Normal post-slice chat includes only applicable items in this order: product capability created; evidence when needed to support the claim; direction-changing learning; next product bottleneck; the highest-priority genuine human decision. Omit empty items. Requested audits, reviews, safety evidence, and orchestrator handover state are separate surfaces and may expand without contaminating normal product conversation.

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
meta-harness init --authority-public-key-file <path> --authority-receipt-file <path>
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
