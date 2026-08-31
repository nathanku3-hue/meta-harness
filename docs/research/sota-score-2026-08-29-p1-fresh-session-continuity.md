# SOTA Product Scorecard — P1 Fresh-Session Continuity

Generated: 2026-08-29T01:29:09-07:00
Generator: `manual-evidence-scorecard/v1`
Projection type: evidence-adjusted product scorecard; not product authority
Repository HEAD: `809e2dec7c5804269f5ee135619540abcd004919`
P1-A: `4a4288e` (`feat: bank P1-A guidance continuity`)
P1-C: `809e2de` (`feat: quarantine legacy phase vocabulary`)
Previous accepted score: `85/100` (score-bearing baseline `ec9ae7a`)
Current end-to-end score: **`86/100`**
Banked architecture ceiling before comparative production proof: **`87/100`**
SOTA comparison set: Pi Agent Harness + DeepSeek Harness
Secondary continuity cross-check: Prime Intellect Prime Agent

## Projection contract

This file is a generated scorecard. It does not change `PRODUCT.md`, World, Outcome, Claim, work-session, ExecutionPermit, workspace, or publication authority.

Canonical local sources for this snapshot:

| Source | Git blob / revision |
| --- | --- |
| repository HEAD | `809e2dec7c5804269f5ee135619540abcd004919` |
| `PRODUCT.md` | `fcee4f0da629436e4c88171a6109aba78cf8bc61` |
| `README.md` | `0118dc507b5a61959622764ebb92046a1fe16b55` |
| `docs/product/delegation-fresh-session-flow.md` | `d0bd1144ec9ea4005995bd7b7eb8b26a2234e8ff` |
| `docs/product/problem-questions.md` | `fb92916f6505ff0a26571d7a742628e034ae0e8c` |
| `docs/research/sota-round-2026-08-product-is-continuity-not-process.md` | `ce50c3a72a65fcf41963c139d49ba784edc58cfc` |
| `lib/commands/work.js` | `be0f38f9a97fdff55bec6b2cb045e89a6bb145f1` |
| `lib/work-loop.js` | `a2a8918616ce2cd9378fe2367e5cd866331c50e6` |
| `lib/coding-worker.js` | `f1f54f1528aae1a48e194a914944a592575d0e25` |
| `lib/repo-work-wave.js` | `0a16d0c11e013e2d57af5153d800ac06eef6630a` |
| `lib/work-session.js` | `d92d1d0e77ba0b171913294ad55920d5bc0df23e` |

External frontier sources checked on 2026-08-29:

- Pi: https://github.com/earendil-works/pi
- Pi session model: https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/sessions.md
- Pi compaction: https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/compaction.md
- Pi harness steering/lifecycle: https://github.com/earendil-works/pi/blob/main/packages/agent/docs/agent-harness.md
- Databricks harness benchmark, 2026-07-08: https://www.databricks.com/blog/benchmarking-coding-agents-databricks-multi-million-line-codebase
- DeepSeek Harness: https://github.com/deepseek-ai/deepseek-harness
- DeepSeek session persistence: https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/persistence.md
- DeepSeek goal continuity: https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/goal/README.md
- DeepSeek compaction: https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/compaction.md
- DeepSeek session references/query: https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/session-reference.md and https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/session-query.md
- DeepSeek Code Mode: https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/core/tools/README.md
- Prime Intellect Prime Agent: https://github.com/PrimeIntellect-ai/prime-agent

Current-host runtime observations, intentionally non-authoritative and non-durable:

- `WEB-CONNECTOR-1` proof `2f1bb7a99bed35c4cfc1b0689a2052d9d12c602ca580479325e688ffc5baa783`, started `2026-08-29T08:24:49.096Z`: terminal `failed`, failure code `launch_failed`.
- `WEB-CONNECTOR-1` proof `ac6c6162160ccb956b18979812a2272b570fe254e3b45c5599df5b1adc644e94`, started `2026-08-29T08:25:44.458Z`: terminal `expired` after remaining pending through `2026-08-29T08:27:44.458Z`.

`PI` is interpreted here as **Pi Agent Harness**, matching the existing Meta-Harness SOTA research. Prime Intellect is retained only as a secondary memory/long-running-continuity reference so the ambiguous acronym does not silently change the benchmark.

Expiry: 2026-09-29, or immediately when any canonical source above changes materially, a new supported fresh-session entry path ships, or frontier evidence changes the comparison.

Contradiction policy: exact owner direction and Git/runtime facts outrank this scorecard. A score may not rise because prose became better. Demonstrated product journeys and controlled comparative evidence are required.

## Executive decision

The old `85/100` was earned when Meta-Harness first demonstrated one accepted coding result flowing through a real worker, controller materialization, exact validation, bounded repair, self-hosted continuation, and a thin public command surface.

The post-P1 system is stronger than that baseline. P1-A and P1-C close two important continuity failure classes:

1. operative host guidance can no longer quietly turn ordinary reversible work back into mandatory review/approval ceremony;
2. legacy phase/context-gate vocabulary is explicitly compatibility/inspection evidence and no longer masquerades as product, planner, Claim, work-session, ExecutionPermit, worker, or owner authority.

The closed delegation programme also establishes a strong zero-history continuation architecture: deterministic boot context, exact retained `taskId`, `open_workspace(taskId)` reattachment, isolated fresh ChatGPT BrowserContexts, compact result fan-in, and current-World interpretation without child transcript authority.

Those improvements justify an **architecture/evidence ceiling of 87/100**.

The **current end-to-end score is 86/100**, not 87, because two live bounded `WEB-CONNECTOR-1` acceptances launched from this exact fresh ChatGPT/DevSpace environment on 2026-08-29 did not produce a successful connector-discovery callback: the first returned `launch_failed`, while the second remained pending until expiry. Those results are current host-journey observations, not proof of a Meta-Harness semantic defect and not enough by themselves to reopen the closed P1 browser slice. They are enough to prevent the scorecard from calling fresh-Web bootstrap frictionless today.

The score remains below `88+` for a more important reason: the repository's own previous score ladder reserves `88+` for demonstrated multi-repository speed/reliability advantage over direct unmanaged coding. No fixed-model comparative production benchmark currently proves that advantage.

Therefore the product claim remains:

> **Credible SOTA continuity architecture, not yet a proven SOTA coding harness.**

## Score path

| Score | Evidence boundary |
| ---: | --- |
| 62 | strong authority/custody; weak coding execution and user continuity |
| 76 | one public coding journey + sealed session + deterministic workspace/worker/validation behavior |
| 82 | live worker + controller materialization + exact validation + dirty isolation + resume + fail-closed boundaries |
| 85 | self-hosted bounded coding with no planning restart/routine owner intervention + complete package closure |
| 86 | current score: P1 guidance/legacy-authority continuity is banked, but fresh-Web launch is not currently demonstrated reliable end-to-end |
| 87 | banked architecture ceiling: fresh zero-history delegation/task reattachment and current-World fan-in work as designed and fresh-Web bootstrap is demonstrably reliable |
| 88+ | fixed-model, multi-repository evidence shows a real speed/reliability advantage over direct unmanaged coding |
| 90+ | the same evidence also shows competitive context efficiency and reliable fresh-session/repair continuity without owner reconstruction |
| 92+ | live steering preserves still-valid work, and working-memory continuity is measured rather than assumed |
| 95+ | repeated production evidence shows lower intervention, lower context/cost, no increased escaped defects, and robust recovery across substrates |

The exact higher numbers are not roadmap promises. They make score inflation falsifiable.

# Full current user journey

There are three different “fresh ChatGPT” stories in the current stack. Treating them as one surface hides the main product gap.

## Flow A — an owner opens a completely fresh ChatGPT conversation

This is the flow demonstrated by the current conversation.

### A1. New conversation starts with zero conversational continuity

The fresh ChatGPT conversation does not inherit the previous transcript as project authority. It receives its current tool inventory and whatever product/repository state can be rediscovered through those tools.

The owner types something like:

```text
open E:\code\meta-harness
```

### A2. The model chooses the DevSpace call

The current DevSpace surface supports:

```text
open_workspace(path=...)
open_workspace(taskId=...)
```

Opening by path returns a new ChatGPT-side `workspaceId`, repository root, applicable `AGENTS.md`, and available local capabilities. It gives the conversation a safe repository handle.

What it does **not** do is mechanically bind the owner's raw first message to Meta-Harness product ingress before model interpretation.

Therefore:

```text
fresh ChatGPT prompt
-> model interpretation
-> open_workspace(path)
-> repository instructions/state become available
```

is **not** the same thing as:

```text
raw owner result
-> Meta-Harness ingress
-> retained objective/session authority
-> execution
```

### A3. Repository truth reduces reconstruction but does not eliminate it

Once the workspace is open, the fresh model can read current product direction, code, durable state, and instructions. P1-C materially improves this cold start because stale phase/context-gate artifacts are now demoted from execution authority.

P1-A likewise reduces the chance that `AGENTS.md`, `CLAUDE.md`, or another host guidance file reintroduces universal audit/review/approval gates.

But this is still **reconstruction after the model has already received and interpreted the owner prompt**.

The current `.meta-harness/status.md` is correct to distinguish this from ACP direct entry: ChatGPT/DevSpace lacks the pre-model raw-owner-input seam required for a mechanically enforced direct Meta-Harness ingress membrane.

### A4. A retained DevSpace native task is stronger than path-open

If a task was previously created with a sealed DevSpace `taskBrief`, DevSpace returns a durable `taskId`. A later fresh conversation can call:

```text
open_workspace(taskId=<exact taskId>)
```

and recover the same retained native task/workspace authority without supplying a replacement path, worktree, or task brief.

That is genuine project continuation.

However, an arbitrary owner fresh chat that only says “open this repository” does not already possess the exact retained task identity. The task ID must either be supplied by a deterministic boot packet or otherwise carried into the fresh session.

### A5. Current host-only fresh-Web primitives are bounded

The DevSpace connector currently exposed in this environment has bounded fresh-Web primitives such as:

- `web_launch`: one explicit fresh authenticated ChatGPT conversation with a supplied prompt;
- `web_connector_start/status`: one fixed proof that a fresh Web conversation can discover and invoke DevSpace;
- `review_start/status`: one fixed fresh-Web PRODUCT review packet/callback.

It does **not** expose a general owner-facing `spawn_delegation/get_delegation/lane_submit` orchestration API in this ChatGPT connector surface.

That means the closed delegation architecture described below is not equivalent to “any fresh owner chat automatically becomes a managed lane.”

## Flow B — the primary Meta-Harness coding journey

This is the product's strongest path today.

### B1. Owner states one software result

Normal CLI entry is:

```text
meta-harness "Add CSV export to the report page"
```

ACP can deliver exact prompt text into the same automatic product path when its pre-model ingress/default-deny capability boundary is available.

### B2. Automatic entry decides NEW / RESUME / STOP

`lib/commands/work.js` asks current durable state what is mechanically next.

If there is an active work session:

```text
same result supplied -> RESUME
no result supplied   -> RESUME
different result     -> OWNER_INPUT / REPLACE_ACTIVE_RESULT
```

If there is no active work session:

```text
new result supplied  -> NEW
no selected work     -> terminal coverage check -> STOP or REPLAN_REQUIRED
```

For planner-enabled repositories, the supplied owner result updates retained owner-objective state and execution enters the repository wave path.

### B3. Product direction is pinned before coding

Before a direct owner-goal worker runs, the controller resolves:

```text
immutable base
+ exact PRODUCT.md bytes/digest
+ validation adapter
+ product proof contract/spec
+ allowed path boundary
+ delivery authority
```

The result becomes the complete digest-bound work session.

Current code uses **`work-session/v8`**.

A concrete continuity debt remains in active prose: `README.md`, `docs/product/product-spec.md`, and one roadmap statement still say `work-session/v7`. The controller is not confused—the parser accepts v8—but a fresh human/model reading active documentation can be. This is exactly the kind of “repository truth is safe while explanatory context drifts” gap that the golden problem must track.

### B4. A controller-owned workspace is prepared

The controller selects or recreates the mechanically correct isolated worktree and obtains execution custody. It persists the work session before the worker becomes authoritative.

The important continuity split is:

```text
conversation state       disposable
work-session authority   durable
workspace/code bytes     durable under custody
Git/product state        durable
```

### B5. The coding worker starts from a complete bounded brief

`lib/coding-worker.js` builds a worker prompt containing:

- exact owner-authored product direction;
- current semantic/endgame projection;
- one attempt-scoped ExecutionPermit;
- product result;
- journey state;
- immediate action;
- newly true behavior;
- done condition;
- stop conditions;
- reversible and owner-only action boundaries;
- allowed paths;
- controller validation;
- attempt number;
- previous validation failure when repairing.

The worker is intentionally read-only. It returns typed `WRITE`, `DELETE`, or `MOVE` operations rather than mutating repository bytes, Git state, branches, worktrees, or publication state itself.

### B6. Worker cognitive state is ephemeral

The actual coding call uses the ephemeral structured-model path. Every repair invocation is a fresh model invocation.

The next attempt retains:

```text
PRODUCT direction
+ sealed task/work-session contract
+ current materialized repository/workspace bytes
+ controller custody facts
+ exact validation failure feedback
```

It does **not** retain the previous worker's full model trajectory, private reasoning path, arbitrary tool transcript, or an explicit compact “pivotal discoveries” capsule.

This is the largest remaining memory/context question in the coding path.

### B7. Controller materializes and checks the proposed bytes

The controller, not the model, owns mutation. It checks boundaries, materializes the typed operations, seals the exact candidate tree, and runs external validation/product proof inside the verifier boundary.

### B8. Repair continues the same accepted result

If validation or product proof fails and repair budget remains:

```text
same work session
+ same retained workspace/code progress
+ new attempt permit
+ exact prior failure
-> fresh worker invocation
```

This is strong **mechanical continuity** with intentionally weak **conversational continuity**.

If a worker emits structured STOP, the controller persists the stop and uses a fresh read-only forward-motion challenger before any human authority is consumed.

### B9. Successful bytes are banked locally

Accepted candidate bytes are committed into a controller-owned local immutable commit. Publication/push remains owner authority.

For planner-owned repositories, accepted worker BANK commits are integrated into the current cumulative product commit and interpreted against current World before authoritative learning advances.

### B10. Multiple Outcomes can progress without a static barrier

`lib/repo-work-wave.js`:

1. recovers existing executable Claims first;
2. lands ready Closures;
3. plans at most once per current WorldHead + owner-objective revision;
4. admits compatible new Claims up to repository capacity;
5. executes independently;
6. refills released capacity after settlement;
7. serializes current-World landing/integration.

No sibling chat transcript is authority and no static all-workers barrier is required.

### B11. Interruption preserves durable progress

Controlled drain cancels local ephemeral model execution but preserves valid durable boundaries, lands what can still be safely landed, and requires local execution leases to quiesce.

A later ordinary entry reconstructs from durable Outcome / Claim / work session / workspace / Closure / World / owner-objective truth.

This is one of Meta-Harness's strongest SOTA-relative properties: the process can die while product/custody truth survives.

### B12. Closure is deliberately small

Normal owner-facing output collapses internal state to results such as:

```text
Working…
Validating…
Repairing validation…
Done — <observable result>. Validation and product proof passed; the result is banked locally.
```

The owner does not choose session IDs, workspace IDs, validation commands, worker identities, Claim lifecycle, or local commit policy.

## Flow C — managed delegated fresh ChatGPT evidence lane

This is a different path from Flow A. It starts only after an orchestrator has retained a delegation/task.

### C1. Retain authority before opening the child conversation

The accepted delegation design first retains each lane's exact identity and common zero-history context:

```text
delegationId
laneKey
taskId
taskDigest
workspaceId
laneBriefDigest
resultChallenge

ORIGINAL PRODUCT ENDGAME
CURRENT ACCEPTED WORLD / WORLDHEAD
CURRENT GATE
BOUNDED EVIDENCE INDEX
```

The browser conversation is disposable.

### C2. Open a genuinely fresh authenticated ChatGPT conversation

Machine lanes use isolated BrowserContexts seeded from copied authenticated profile storage rather than several pages sharing one persistent BrowserContext.

This was the Round-5 correction for observed shared-context/page reliability failures.

### C3. Inject one deterministic first prompt

The boot packet order is fixed:

```text
1. ORIGINAL ENDGAME
2. CURRENT ACCEPTED WORLD
3. CURRENT GATE
4. LANE-SPECIFIC BRIEF
5. EVIDENCE INDEX
6. EXECUTION INSTRUCTIONS
```

No parent or sibling chat history is copied.

### C4. Reattach mechanical execution with `open_workspace(taskId)`

The child calls:

```text
open_workspace(taskId=<exact retained taskId>)
```

The boot packet explains **why** the lane exists. The retained native task explains **which exact execution state** it owns.

That two-layer split is the strongest current answer to the fresh-session memory problem:

```text
semantic continuation
+ mechanical continuation
without conversational continuation
```

### C5. Work independently

Sibling chats do not exchange authoritative memory. Shared grounding comes from the same retained Endgame/World/gate projection.

### C6. Fan in a compact result, not a transcript

The accepted lane result contains criterion verdicts, named evidence, advisory deltas, remaining uncertainty, and a handoff. The server binds identity and stores the compact result.

The raw child conversation can disappear.

### C7. Interpret evidence against current World

Delegated evidence cannot become canonical product code directly. Current World decides whether new learning is accepted. Any fresh coding still enters through the normal planner -> Outcome -> Claim -> work-session -> controller path.

### C8. Continue / hold / obsolete against the new frontier

Still-live lanes are re-evaluated after accepted evidence changes World. A HOLD persists a semantic checkpoint before the browser context is released. Resume can use another completely fresh chat with the same retained task identity.

### C9. Owner sees only semantic movement

The desired owner experience is:

```text
Done — product result complete
Next: <new meaningful gate>
Need you: <real owner-exclusive judgment/access/risk choice>
```

The owner should not manage lane IDs, task IDs, BrowserContexts, checkpoints, or polling.

# The golden problem

## Problem statement

The central problem is not “how do we save chat history?”

It is:

> **Can a completely fresh agent instance become decision-equivalent to the previous useful state using the smallest trustworthy context, without inheriting stale conversational baggage or forcing the owner to reconstruct the project?**

Call this **continuation equivalence**.

A good continuation does not need identical internal thoughts. It needs enough retained truth that the next agent does not make materially worse product or execution decisions because the prior model process disappeared.

## The memory layers that matter

### 1. Product memory — what result are we actually shipping?

Needed state:

```text
owner-authored endgame/taste
current owner objective
accepted result
material semantic constraints
```

Meta-Harness: **very strong**.

`PRODUCT.md`, owner-objective state, semantic authority, and immutable work-session pinning protect this layer better than ordinary chat-history persistence.

### 2. World memory — what is currently true?

Needed state:

```text
accepted product commit
landed Outcomes
active Claims
accepted external evidence
current blockers / handoffs
```

Meta-Harness: **very strong** for planner-enabled repositories.

World/Claim/Closure integration gives the next process current facts rather than a story about prior facts.

### 3. Mechanical memory — exactly where can work continue?

Needed state:

```text
base commit
workspace identity/custody
current materialized bytes
attempt generation
candidate seals
validation/proof authority
```

Meta-Harness: **very strong**.

This is a major differentiation from session-centric harnesses that persist conversation but allow the model broad direct mutation authority.

### 4. Epistemic / working memory — what costly facts did the worker discover?

Examples:

```text
file X is a dead end because Y
the real behavior is implemented in module Z
a generated API looks writable but is regenerated
the previous approach failed for reason R
this repository convention is undocumented but stable
```

Meta-Harness: **partial**.

Some discoveries become repository bytes, validation failures, World learning, research evidence, or explicit handoffs. But ordinary coding-worker navigation/reasoning is not compacted into a first-class durable task memory object.

A fresh repair worker can therefore rediscover facts that were consequential but never encoded into code/evidence.

### 5. Attention memory — what should be in the next model context?

This is not persistence. It is selection.

The ideal context manager answers:

```text
what must be present now?
what may be retrieved on demand?
what should remain durable but outside the prompt?
what is obsolete or contradicted?
```

Meta-Harness: **strongly bounded, weakly adaptive**.

Its prompts are deterministic and authority-heavy, which prevents drift. It does not yet have Pi-style session compaction/tree summaries or DeepSeek-style log surface projection/session query to tune the worker's working set dynamically.

### 6. Steering memory — what did the owner change while work was active?

Meta-Harness: **gap**.

Today a different product result while an active direct work session exists becomes:

```text
OWNER_INPUT / REPLACE_ACTIVE_RESULT
-> "Finish the active result first, then state the new result."
```

There is no first-class `steer` semantic that says:

```text
change this judgment
preserve everything still valid
invalidate only what the change actually touches
continue the same product journey
```

This is where Pi is clearly ahead as an interaction harness: steering and follow-up are explicit live-session operations.

### 7. Evidence memory — why is completion trustworthy?

Meta-Harness: **very strong**.

External validation, product proof, candidate seals, local BANK, current-World integration, and retained compact delegation evidence make completion less dependent on what the model says about itself.

# SOTA comparison

## Pi Agent Harness

Pi's core product lesson is not “keep less state.” It is “keep the model-facing working set small while retaining session structure.”

Current Pi exposes:

- durable JSONL sessions;
- resume/new/fork/clone/tree navigation;
- branch summaries;
- automatic/manual compaction;
- steering and follow-up queues;
- a deliberately small coding-agent core with extensions around it.

The strongest external benchmark evidence is Databricks' 2026-07-08 production-code study. With the same model and thinking effort, changing harnesses changed cost per task by more than 2x in some comparisons while quality stayed the same. Pi sent about 3x less context per turn and finished in fewer runs.

Product implication for Meta-Harness:

> Context efficiency is no longer a theoretical architecture preference. It is a measured product variable.

Meta-Harness currently has stronger durable authority/custody semantics, but it has not produced equivalent controlled evidence that its deterministic contracts and fresh-worker reconstruction are context-efficient.

## DeepSeek Harness

DeepSeek Harness pushes the continuity substrate further than Pi in several directions:

- event-sourced session logs are the source of truth;
- JSONL and SQLite persistence can reload durable sessions;
- semantic checkpoint policy protects durability boundaries;
- same-session goals persist objective/phase/revision separately from process-local permission to continue;
- compaction is a first-class optional capability with durable summary/shadow metadata;
- session-query provides bounded reads, relationship tracing, filtering, and SQLite full-text search;
- session-reference projects a bounded current surface of another session rather than recursively injecting raw history;
- Code Mode exposes one `run_code` transport and keeps nested tool traffic out of repeated model context, returning only curated outer logs/value;
- capabilities are highly composable plugins.

DeepSeek Harness is still explicitly a developer preview with compatibility-breaking changes expected. Its breadth is therefore not evidence that Meta-Harness should copy the architecture wholesale.

The useful product lesson is narrower:

> **Persistence, retrieval, compaction, and model-visible context are separate capabilities.**

Meta-Harness already separates authority from conversation. The next frontier is to separate durable working knowledge from what must be re-fed to every fresh worker.

## Prime Intellect cross-check

Prime Agent is not the primary comparator in this scorecard, but it reinforces the same continuity conclusion: long-running agent state, detach/reattach, retained goals, memories/refinements, and direct steering are explicit runtime concerns.

This supports the thesis that “minimal owner workflow” does not imply “minimal continuity state.”

# Relative capability matrix

`LEAD` means Meta-Harness has a material product advantage for its stated solo-developer complex-coding journey. `PARITY` means the capability is credible but not clearly superior. `LAG` means the comparator has a more mature relevant capability. `DIFFERENT` means the products optimize different surfaces and a direct winner would be misleading.

| Capability | Meta-Harness vs Pi | Meta-Harness vs DeepSeek | Reason |
| --- | --- | --- | --- |
| immutable owner product direction | **LEAD** | **LEAD** | exact `PRODUCT.md` bytes are pinned into execution authority rather than inferred from session conversation |
| repository/Git custody | **LEAD** | **LEAD** | read-only worker + controller-owned materialization/candidate/commit authority is unusually strict |
| external validation/product proof | **LEAD** | **LEAD/PARITY** | candidate-independent proof + controller verification is core, not model self-report |
| process-death mechanical resume | **LEAD/PARITY** | **PARITY** | Meta preserves Claim/workspace/World; DeepSeek preserves event-sourced session; Pi preserves session state |
| fresh zero-history delegated reattachment | **LEAD** architecturally | **PARITY** | deterministic boot + exact task/workspace identity is strong, but current owner-facing host surface is narrower |
| live conversational steering | **LAG** | **LAG** | active direct result replacement is rejected rather than reconciled as a steer |
| worker-session persistence | **LAG by design** | **LAG by design** | coding worker invocations are ephemeral; valuable state must survive elsewhere |
| adaptive compaction | **LAG** | **LAG** | no first-class worker context compaction/surface folding |
| cross-session/queryable working memory | **LAG** | **LAG** | no session-query/session-reference equivalent for coding-worker discoveries |
| measured context efficiency | **LAG** | **UNPROVEN** | Pi has external fixed-model evidence; Meta has no comparable benchmark; DeepSeek has strong mechanisms but this scorecard found no equivalent external result |
| model-facing tool-context suppression | **PARITY/DIFFERENT** | **LAG** | Meta avoids broad tool transcripts through typed worker output; DeepSeek Code Mode explicitly keeps nested results outside repeated context |
| parallel product work | **LEAD/DIFFERENT** | **PARITY/DIFFERENT** | Claim/World semantics support bounded concurrent Outcomes; DeepSeek has subagent/jobs/workflow breadth |
| extension breadth | **DIFFERENT** | **DIFFERENT** | Pi/DeepSeek deliberately expose broader extension/plugin runtimes; Meta intentionally keeps a thinner product core |
| current random fresh-ChatGPT owner ingress | **LAG** | **LAG** | no pre-model ChatGPT/DevSpace direct ingress; ACP is the supported exact-text membrane |

# Why P1 changes the score

## P1-A — guidance continuity

Before P1-A, a fresh agent could read operative host guidance that reintroduced a mandatory audit/review/approval lifecycle even though the current product law says ordinary reversible work should execute immediately.

P1-A adds active host-guidance conflict detection for patterns such as:

- mandatory review before all new work;
- review/SAW after every round;
- routine owner approval/GO before ordinary continuation.

This matters because fresh-session quality is determined partly by **which local prose the new model trusts**. A durable workspace is not enough if stale host guidance can redirect the new model before it reaches the actual task.

## P1-C — legacy lifecycle quarantine

P1-C makes old context-gate/phase material explicitly compatibility-only and inspection-only.

The authority order now makes the intended split clearer:

```text
PRODUCT.md / explicit owner intent
+ current World / Claims
+ sealed work-session / ExecutionPermit
> context-gate compatibility evidence
> stale phase-map prose
```

This directly improves the golden problem: the fresh worker has fewer plausible-but-wrong authority sources.

# What still prevents a SOTA claim

## 1. No fixed-model multi-repository comparative result

This is the hard cap.

Databricks demonstrated why harness-level measurement matters: the same model and thinking effort can have equal quality but materially different task cost because one harness repeatedly feeds much more context.

Meta-Harness does not yet know whether its fresh worker reconstruction is:

```text
cheaper than retained conversation
about equal
or materially more expensive because it rereads the repository
```

Until that is measured, the product cannot claim SOTA efficiency.

## 2. Random fresh owner ChatGPT is not direct product ingress

The current path is:

```text
owner prompt
-> ChatGPT interpretation
-> DevSpace tool selection
-> open workspace
```

not:

```text
raw owner prompt
-> mechanically captured Meta-Harness ingress
```

ACP solves the exact-text ingress problem on a supported host. ChatGPT/DevSpace does not currently expose the required pre-model seam.

## 3. Fresh-Web bootstrap is not currently demonstrated reliable

Two bounded `WEB-CONNECTOR-1` proofs from the exact current environment failed to establish a successful fresh-Web connector callback: one returned `launch_failed`; one expired while still pending.

Those observations are intentionally classified as **host bootstrap friction**, not automatically as a P1 semantic/browser-isolation defect. A retained failure with enough root evidence to identify the supported-use defect and smallest repair would be required to reopen the closed browser slice.

## 4. Worker epistemic memory is implicit

Repository bytes and controller failures preserve a lot, but not every expensive discovery becomes durable.

The current design needs empirical evidence that this is sufficient.

## 5. Steering is not continuity-preserving

A mid-flight owner correction is treated as a competing result rather than a patch to current intent/state.

For long complex work, that means the owner can still pay a restart/reconciliation tax exactly when judgment changes.

## 6. Active documentation still contains one concrete stale schema story

The implementation accepts `work-session/v8`; active README/product-spec prose still names v7 in several places.

This does not corrupt controller authority, but it is a useful warning: **fresh-session semantic quality can lag behind mechanically correct state when explanatory context is stale.**

# The next product experiment: CONTINUITY-BENCH-1

Do not build a generic memory service first.

Use three real multi-module tasks and hold the coding model/thinking effort as constant as practical across harness conditions.

## Conditions

### A — Meta-Harness current

```text
one accepted result
-> current deterministic WorkSession/Claim path
-> ephemeral workers
-> validation repair/resume as needed
```

### B — Pi

```text
same task/model/repository base
-> normal Pi session
-> its native compaction/session continuation
```

### C — DeepSeek Harness

```text
same task/model/repository base when supported
-> durable session/goal
-> normal compaction/context features
```

The purpose is not to reproduce each competitor's entire product. It is to isolate context/continuity cost under equivalent code and validation tasks.

## Measure

For every journey record:

```text
held-out product/validation pass
owner intervention turns after work begins
problem-to-first-useful-edit time
problem-to-proven-result time
input/context tokens per model request
total model input tokens per task
number of model calls
files read repeatedly after repair/resume
repeated searches/navigation after repair/resume
repeated failed approach after repair/resume
stable facts rediscovered
owner facts re-explained
lost implementation/product decisions
repair attempts
resume success without owner explanation
escaped requirement/runtime defects
cost per successful task
```

The most important new metric is:

> **reconstruction tax = model/context work repeated only because execution crossed a worker/session boundary.**

## Inspect pivotal transitions, not whole transcripts

When a run is worse, identify the small number of transitions that changed the outcome:

- missing repository fact;
- stale guidance;
- lost decision;
- repeated search;
- compaction omission;
- bad retained assumption;
- validation signal;
- owner steer.

Do not summarize every run into a growing permanent prompt.

## Promotion rules

Raise to `87/100` current end-to-end only when the fresh-Web bootstrap is again demonstrated reliable or the supported product explicitly excludes that host path from the scored journey.

Raise to `88+` only when at least three real multi-module tasks show a material speed/reliability advantage over direct unmanaged coding under a controlled comparison, matching the repository's existing score discipline.

Do not add worker-memory machinery merely because Pi and DeepSeek have it.

Add a continuity mechanism only if CONTINUITY-BENCH-1 shows a repeated material reconstruction loss. Choose the smallest mechanism matching the observed loss.

Candidate solution classes, if evidence warrants them:

1. **pivotal continuation capsule** — only stable discoveries/rejected routes/unresolved facts that materially change next-worker decisions;
2. **substrate-native resumable worker session** — if same-session continuation beats reconstruction without harmful stale-state carryover;
3. **bounded task-memory retrieval** — query retained task facts rather than replaying a whole transcript;
4. **steer event** — patch owner judgment and mechanically invalidate only affected state;
5. **context budget telemetry** — measure what gets re-fed before trying to optimize it.

Do not jump directly to unlimited memory, raw transcript replay, a vector database, a daemon, a provider framework, persistent multi-agent organizations, or automatic prompt mutation.

# Product conclusion

Meta-Harness is already strong where many coding harnesses are weak:

```text
one owner result
-> exact durable authority
-> safe isolated execution
-> current repository truth
-> external proof
-> recoverable process death
-> concise closure
```

Pi and DeepSeek expose the remaining frontier more clearly:

```text
retain more useful session knowledge
while feeding less repeated context
and allow live correction without restart
```

The desired end state is therefore not “Meta-Harness with more memory.” It is:

> **A fresh worker receives exactly the durable truth that changes its next decision, can retrieve additional bounded knowledge when needed, can absorb owner steering without losing valid progress, and never needs the previous chat transcript to know what to do.**

That is the golden problem.

Current verdict:

```text
86/100 current end-to-end
87/100 banked architecture ceiling
<88 until comparative production proof
```
