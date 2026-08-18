# Meta-Harness Coding-System Roadmap

Status: execution roadmap; subordinate to owner-authored `PRODUCT.md`.

## Endgame

One solo developer supplies product intent and judgment. Meta-Harness carries that intent through a logical planner into parallel disposable execution without making the owner route tasks, scopes, sessions, workers, reviews, or resumes.

```text
OWNER
  ↕ product intent / taste / material authority only
LOGICAL PLANNER
  ↓ proposes executable outcomes
OUTCOMES
  ↓
META-HARNESS AUTHORITY KERNEL
  ↓ atomic claims + bounded capabilities
DISPOSABLE WORKERS IN ISOLATED WORKSPACES
  ↓
EXECUTION CLOSURES
  ↓ scoped revalidation + authoritative commit
LINEAR WORLD
  └──────────────► reconcile / replan only when needed
```

The human-facing product remains small. Internal continuity may become richer, but conversations, model sessions, workspaces, planners, workers, reviewers, and execution runtimes are replaceable implementation details.

## Constitutional product laws

1. **Human judgment is scarce.** The owner is contacted only for product/taste decisions, real credentials or protected access, irreversible/destructive action, publication, material risk, or another genuinely owner-exclusive decision.
2. **Outcome is work identity.** A path, directory, lifecycle phase, chat, session, or agent is not the identity of work. Path and resource scope are derived capability/safety boundaries.
3. **Outcomes are stable; means are disposable.** Failure of one API, library, runtime, data source, architecture route, or implementation tactic is not evidence that the outcome is blocked.
4. **Escalation requires proof.** Before durable `BLOCKED` or owner escalation, the system must distinguish a hard outcome constraint from failure of the currently preferred means and exhaust permissible forward motion or replan.
5. **Planner is out of the execution hot path.** The planner proposes enough executable outcomes to saturate useful capacity and then disappears. It does not babysit workers or relay their reports.
6. **One worker, one claim, one outcome, one closure.** A worker may discover future work but may not silently turn discoveries into roadmap commitment.
7. **Execution may be parallel; authoritative truth remains linear.** Expensive work can overlap. World transitions remain validated and serial.
8. **WorldHead is provenance, not global freshness.** Continued validity of an executing outcome is determined by its declared preconditions, invariants, capabilities, resources, and conflict domains rather than by equality with an unchanged whole-World digest.
9. **Durable artifacts carry continuity.** If correct continuation requires an old conversation, that is a harness defect.
10. **Research is evidence, not authority.** Raw expert chats remain source material. Only promoted, attributable findings may inform planner/outcome context.
11. **Quality is mechanically defended first.** Structural SAW runs cheap executable checks continuously; semantic architecture/security/product review is risk-triggered rather than universal ceremony.
12. **Replaceable does not mean framework-first.** Add narrow ports when needed; do not build dynamic plugin/provider infrastructure until at least two real implementations prove the interface valuable.
13. **Harness machinery must justify its continued existence.** Every nonessential rule, prompt, reviewer, context layer, retry, role, or adapter needs a demonstrated failure class, measurable benefit, cost, and deletion test.

## Current stabilization boundary

`PRODUCT_DIRECTION_CONTINUITY_1` / `work-session/v6` / product-proof stabilization is banked locally at `22fe09c`. `OUTCOME_CLAIM_AUTHORITY_1` is implemented, validated, and banked locally at `45eec13`; it hard-cuts repo-owned execution to `work-session/v7` while leaving the proven owner-goal transaction, workspace custody, verification, BANK, and closure machinery in place.

A new external score campaign is not a prerequisite for this architecture work. The purpose of the current slices is to remove demonstrated serial and human-routing bottlenecks, not to create another evidence ceremony.

`PRODUCT.md` remains owner-authored and is not changed by this roadmap. Roadmap architecture cannot silently rewrite owner product direction.

## Critical path to the endgame

### Phase 1 — Outcome identity + atomic claim authority

**Product result:** repository-owned work can represent multiple independent outcomes against one authoritative World and atomically assign temporary responsibility without a repository-global single-work singleton.

Hard cuts:

- replace work identity based on one `repo-decision` / one selected action with minimal immutable Outcome identity;
- add atomic Claim authority keyed to one Outcome;
- derive initial compatibility from concrete execution write boundaries rather than generic `conflictKeys`;
- allow multiple non-conflicting Claims to originate from one WorldHead;
- keep duplicate/conflicting responsibility fail-closed;
- remove repository-global `latest active work` as repo-owned execution authority;
- reject unsupported owner-authority assertions instead of propagating fictional authority into durable `OWNER_INPUT`;
- preserve existing workspace execution leases underneath each claimed execution;
- do not yet build a queue, general scheduler, planner runtime, full EscalationProof, or plugin host.

**Done when:** two disjoint repo-owned outcomes can be claimed independently from the same WorldHead and bind separate execution sessions/workspaces; duplicate or conflicting claims fail closed; no owner routing is required.

Banked audited slice: `OUTCOME_CLAIM_AUTHORITY_1` at `45eec13`. Claim remains separate from workspace lease, Outcome starts minimal, and generic conflict keys are deferred. The repository-root `implementation_plan.md` now describes the next Phase-2 audit candidate rather than rewriting the banked Phase-1 record.

### Phase 2 — Parallel outcome progress

**Product result:** repo-owned execution opportunities become concurrent, recoverable product progress without owner routing or stranded successful Closures.

Implemented and validated working-tree slice: `PARALLEL_OUTCOME_PROGRESS_1` (see repository-root `implementation_plan.md`). The architecture audit is incorporated; the repository wrapper passes 116 test files / 865 tests with zero failures. The slice is not yet Git-banked because no commit was requested. Phase 1 proved that independent Claims may coexist. Phase 2 hard-cuts the remaining serial semantics together:

```text
durable active Claims
→ recover commitments before mutable proposals

current World
+ repo-proposal-set/v1
→ fill remaining capacity with NEW compatible Claims
   (new Claim must still originate from current H)

recovered + new Claim sessions
→ bounded concurrent runWork()
→ independent Closures
→ fixed repository-owned interpreter against CURRENT World
→ ATTEMPT_LEARNING when durable work evidence exists
→ ATTEMPT_ABORTED when it does not
→ serialized World CAS / Claim release
```

The active mutable `repo-decision/v3` concept is replaced by `repo-proposal-set/v1`; proposals are possibilities, Claims are commitments. New Claim visibility must imply durable session recovery, so a mutable proposal disappearing cannot strand or cancel admitted work. Active model-authored `NO_DISPATCH` terminal inactivity is removed; an empty proposal set means replan/reconcile rather than `USE_PRODUCT`.

The slice does **not** pretend that the existing `preconditionDigest` is a fact snapshot: it hashes declared precondition text. Sibling Closure landing therefore requires fresh repository interpretation against current World, bound mechanically to the exact Outcome, Claim, Closure, current Head, and ordinary World CAS. Repository interpretation is part of the Phase-2 execution transaction, not an external handoff. The fixed `.meta-harness/closure-interpreter.js` seam runs read-only inside the verifier-grade Linux namespace/chroot envelope; Meta-Harness validates outputs and owns persistence/CAS. Semantic work and product-proof compilation stay outside the World lock; that lock contains only short mechanical authority operations. Use greedy deterministic admission first. No CP-SAT, fairness subsystem, reservation state machine, daemon, worker-to-worker messaging, provider framework, or corporate-agent topology.

**Done when:** active Claims survive proposal replacement; stale-Head new Claim races fail closed; several compatible Outcomes execute concurrently; one worker failure does not cancel siblings; successful sibling Closures can serialize into current World (or be deterministically invalidated/replanned) without whole-origin-Head staleness; and every terminal Claim has a durable resolution path—learning with durable work evidence, abort without it.

### Phase 3 — Continuous reconciliation + capacity refill

**Product result:** useful execution capacity stays filled as Claims land, release, block, or become newly eligible, without turning Phase 2 into a queue/scheduler product.

After every authoritative landing or material reality change:

```text
current World
+ active Claims
+ fresh proposal snapshot
→ recover commitments
→ recompute currently claimable proposals
→ fill newly free local execution capacity
```

No persistent queue, reservation state, fairness model, or worker conversation topology is required. Reconciliation is event-driven recomputation from durable truth, not a daemon-owned scheduling database.

**Done when:** after one parallel Outcome lands and releases capacity, newly legal compatible work can start without owner action or restarting the organizational plan, while active Claims retain continuity and World remains linear.

### Phase 4 — Forward-motion / escalation proof

**Product result:** an unavailable preferred route cannot prematurely consume human authority or become a false durable blocker.

Slice 1 already rejects unsupported/fabricated owner-authority assertions at the authority boundary. Phase 4 adds the stronger forward-motion rule: before `BLOCKED` / `OWNER_DECISION`, require a mechanically structured proof that distinguishes:

```text
desired outcome
required facts/capabilities
failed means
alternatives considered
hard-constraint evidence
real owner-exclusive authority requested
```

Core law:

> A failed implementation route is not a blocked outcome.

Persist disproven constraints/misconceptions so fresh sessions cannot resurrect a false blocker without new evidence.

**Done when:** a fresh-session regression with a partial source and a previously disproven fictional authority requirement selects/researches viable alternative means instead of asking the owner.

### Phase 5 — Logical planner as sole human ingress

**Product result:** the owner talks only to one logical planner role; no worker or operational lifecycle reaches the human directly.

Planner behavior:

- read owner intent, current World, outcomes, claims, closures, research findings, and relevant repository evidence;
- ask only unresolved product/taste/owner-authority questions;
- produce enough independently valuable Outcomes to saturate useful current execution capacity plus expose the next meaningful dependency boundary;
- stop planning and leave execution to Meta-Harness;
- wake only for changed intent, material discoveries, repeated worker failure, exhausted useful outcomes, failed escalation proof, or a risk-triggered challenge requiring planning.

Planner checkpoint is a reconstructable cache, never authoritative truth.

**Done when:** after minimal top-level alignment the owner can leave; planner sessions may die; workers execute/close/reconcile automatically; only genuine owner judgment returns to the human.

### Phase 6 — Research promotion + minimum sufficient context

**Product result:** research-driven coding uses accumulated expert knowledge without turning raw chats into worker memory or authority.

```text
raw /chat or docs/chats source
→ ResearchFinding / ConstraintRecord
→ planner adjudication
→ Outcome/context selector
→ smallest sufficient worker boot
```

Persist both positive findings and disproven assumptions. Workers normally receive only the findings relevant to their claimed outcome.

**Done when:** fresh planner/worker sessions use promoted research without rereading chat history, and rejected misconceptions do not silently reappear as blockers.

### Phase 7 — Structural SAW + adaptive review + meaningful `Next`

**Product result:** repository/module quality remains GitHub-ready and modular without a human repeatedly policing code structure.

Always-on mechanical SAW should cover the cheapest enforceable structure: line/module budgets, dependency direction, cycles/forbidden imports, protected paths, package/public surface, root-artifact hygiene, validation, and other repository-owned architectural invariants.

Semantic review is triggered only by risk signals such as a constitutional authority change, security boundary, large cross-cutting diff, new abstraction, material dependency-graph change, or unresolved semantic acceptance.

Post-round output law:

```text
no meaningful follow-up       → concise Done only
autonomous useful follow-up   → execute it
planner-only follow-up        → planner handles it
risk-triggered review         → run it automatically
owner judgment required       → surface one concise Need you / Next
```

**Done when:** a major authority/architecture change automatically triggers the appropriate review, while ordinary clean changes create no review ceremony and no task-list noise.

### Phase 8 — DRAIN / WAKE disposable-session proof

**Product result:** all model sessions can die safely and the organization still knows exactly what exists.

`DRAIN` must stop admission, close or checkpoint active work, park recoverable claims, release/abort irrecoverable claims, snapshot retained workspaces, and prove zero live executor leases. `WAKE` revalidates parked work and resumes or releases it using only durable artifacts.

**Done when:** kill every planner, worker, and reviewer session; start entirely fresh sessions; continuation needs no narration or old transcript.

### Phase 9 — Narrow ports + Harness Darwinism

**Product result:** planners, executors, context strategies, validators, research providers, and workspace substrates may change without changing authority semantics.

Introduce narrow ports only where a real second implementation exists or a demonstrated defect requires replacement. Dynamic plugin discovery is not a prerequisite.

Every retained harness mechanism declares:

```text
failure class
regression/eval proving it
latency/token/complexity cost
sunset experiment
```

Periodically remove mechanisms and rerun the historical regression corpus. If outcomes do not degrade, delete the mechanism.

## Permanent regression corpus

Architecture changes should be tested against real failure classes rather than architecture taste alone. Retain at least these scenarios:

- one blocked outcome while unrelated outcomes are runnable;
- two controllers race the same outcome;
- multiple compatible outcomes claim from one WorldHead;
- unrelated World commit during another execution;
- relevant World commit invalidates another execution;
- worker discovers tempting scope creep;
- preferred external means unavailable but substitutes exist;
- fictional/unsupported authority requirement is proposed;
- planner dies at context limit;
- worker/workspace process crashes;
- kill-all / DRAIN / WAKE with active work;
- raw expert chat contradicts promoted durable finding;
- stale documentation misleads an agent;
- bad evaluator approves broken product behavior;
- a large change grows a monolith or violates repository shape.

Measure product success, owner interventions, wall time, duplicate work, invalid commits, replans, false blocks, recovery success, and added harness complexity.

## Explicit non-roadmap

Do not build ahead of evidence:

- corporate personas, departments, meetings, or persistent manager-agent topology;
- worker-to-worker or planner-to-worker conversational organization;
- a generic queue/daemon/scheduler control product;
- CP-SAT/fair-share/preemption machinery before resource allocation actually requires it;
- generic provider/plugin framework before multiple real implementations exist;
- OpenFGA/OPA/A2A as internal organizational backbone;
- automatic publication or destructive cleanup;
- raw-chat memory as authoritative context;
- universal semantic review on every change;
- a dashboard as the primary user surface.

## Research anchors

The roadmap is consistent with the repository's retained conclusions in:

- `docs/research/sota-round-2026-08-product-is-continuity-not-process.md` — continuity is the durable product; stronger internal state should support a thinner owner workflow;
- `docs/research/sota-round-2026-08-alignment-thick-execution-thin.md` — alignment instruments are conditional; implementation ceremony should remain thin; persistent agent organizations are not justified by default.

The accepted 2026-08 architecture audits further sharpen those conclusions into outcome identity, disposable execution, planner-out-of-hot-path, scoped parallel validity, research-as-evidence, adaptive SAW, and the forward-motion law that failure of a means is not failure of the outcome.
