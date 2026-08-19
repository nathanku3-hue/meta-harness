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

`PRODUCT_DIRECTION_CONTINUITY_1` is banked locally at `22fe09c`; `OUTCOME_CLAIM_AUTHORITY_1` at `45eec13`; `PARALLEL_OUTCOME_PROGRESS_1` at `9616bd4`; `LINEAR_PRODUCT_HEAD_1` at `e2172bc`; `FORWARD_MOTION_PROOF_1` at `a63e82c`; `LOGICAL_PLANNER_AUTODISPATCH_1` at `234b5b1`; and `EVENT_DRIVEN_RECONCILIATION_1` at `39ab56a`. The live active path now has Outcome/Claim identity, parallel disposable workers, current-World Closure interpretation, one cumulative authoritative product commit, retained cross-wave proof continuity, a typed forward-motion boundary, fresh durable-handoff planning, exact-or-reject capability compilation, automatic planner→Claim→worker dispatch, and settlement-driven within-command refill without a queue or daemon.

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

Banked audited slice: `PARALLEL_OUTCOME_PROGRESS_1` at `9616bd4`. The architecture audit is incorporated; the repository wrapper passes 116 test files / 865 tests with zero failures. Phase 1 proved that independent Claims may coexist. Phase 2 hard-cuts the remaining serial execution/landing semantics together:

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

### Phase 3 — Linear integrated product head

**Product result:** parallel worker BANK commits converge into one cumulative locally integrated code commit, and every later repo-owned Outcome is mechanically based on that commit.

Banked audited slice: `LINEAR_PRODUCT_HEAD_1` at `e2172bc`. The exact repository test topology passed in bounded replay: 117 test files / 870 tests / 0 failures; the monolithic wrapper itself could not return through DevSpace because of an upstream 502, so no wrapper-pass claim was made. Phase 2 made World learning linear but left successful worker commits on separate managed branches. Phase 3 closes that code-continuity gap before automatic refill can amplify it.

```text
current Head H(product P)
+ APPLIED worker BANK commit W
→ controller-owned isolated integration
→ cumulative validation + product proof
→ integrated commit P1
→ successor Head H1(product P1)
```

Hard cuts: active `world-head/v2` carries the authoritative integrated `productCommit`; active `world-transition/v2` carries `successorProductCommit` so transition identity determines the full successor Head; code-producing accepted learning binds immutable `product-integration/v1`; active `repo-proposal-set/v2` removes proposal-authored base authority; new work-session base is derived from current Head; worker BANK remains immutable execution evidence distinct from integrated product state; owner checkout and publication remain untouched.

Every integration replays all retained executable validation/product-proof obligations from prior accepted integration lineage against the cumulative tree, including across wave boundaries. Legacy Phase-2 accepted semantic history is migrated to v2 only after its exact BANK commits are cumulatively reconstructed/re-proven. `refs/meta-harness/product-head` is a repairable non-authoritative Git GC root; `WorldHead.productCommit` remains sole authority.

**Done when:** A and B may execute concurrently from P0, BANK independently, and land into one linear P0→P1→P2 code history whose final tree contains both accepted effects; a later wave cannot break an earlier retained product obligation; legacy A+B semantic history cannot migrate without matching cumulative code; transition identity cannot choose a second product commit; and every next repo-owned session is mechanically based on current Head productCommit.

### Phase 4 — Forward-motion / escalation proof

**Product result:** an unavailable preferred route cannot prematurely consume human authority or become a false durable blocker, and a permissible substitute can continue the same Outcome without planner or owner routing.

Banked validated slice: `FORWARD_MOTION_PROOF_1` at `a63e82c`. The active path hard-cuts worker-authored routing and question-punctuation authority; focused worker/CLI/forward-motion tests passed 58/58, repo proof landing plus linear/parallel landing 18/18, the broader authority/Git/parallel/complexity set 43/43, and all 120 discovered test files passed by file in bounded wrapper-topology replay. The monolithic wrapper itself did not return through DevSpace because of an upstream 502, so no monolithic-wrapper pass is claimed.

```text
worker proposes structured STOP
→ durable worker-stop evidence
→ one fresh read-only forward-motion challenge
→ forward-motion-proof/v1

available in-scope alternative
→ same Outcome / Claim / session
→ next bounded generation automatically

Outcome decomposition must change
→ REPLAN_REQUIRED
→ no owner attention

supported hard outcome constraint
→ BLOCKED

validated constitutional owner-exclusive need
→ OWNER_REQUIRED
→ one concise Need you
```

Only these owner-exclusive kinds may reach the human:

```text
PRODUCT_TASTE
SCOPE_EXPANSION
CREDENTIALS
PROTECTED_ACCESS
DESTRUCTIVE_ACTION
PUBLICATION
MATERIAL_RISK
```

Arbitrary model-invented roles such as librarian/manager/approver are not owner authority. Question punctuation is not authority. Successful work pays no challenger/reviewer tax.

Core law:

> A failed implementation route is not a blocked outcome.

`worker-stop/v1` records the exact mechanical STOP boundary (AttemptEntry, workspace generation, HEAD/branch/index/dirty-manifest/Git-tree identity, and exact STOP bytes). `forward-motion-proof/v1` references that immutable stop and records semantic judgment only: failed means, alternatives, hard-constraint evidence, unsupported assertions, and any real owner request. A next generation after STOP requires both byte-identical worker-stop continuity and a separate `CONTINUE_WITH_ALTERNATIVE` proof. Repository World learning retains semantic evidence for fresh-session continuation; a generic belief graph/constraint ontology is deferred until real use proves it necessary.

**Done when:** the Quant-style fresh-session regression with a partial source and a fictional authority requirement cannot reach `Need you`; if an in-scope substitute exists, the same Outcome continues automatically under a fresh execution generation; otherwise it becomes autonomous replan/hard-block learning unless one of the seven real owner-exclusive authorities is actually established.

### Phase 5 — Logical planner + automatic initial dispatch

**Owner-authority boundary:** satisfied. The owner explicitly authorized the re-audited Phase-5 journey; `PRODUCT.md` is now `product-direction-v2` with planner decomposition, multiple Outcomes, automatic dispatch, and the execution law `Planner proposes meaning → Kernel grants exact capability → Claim makes commitment durable → Worker executes → World learns`.

**Product result:** durable repository truth turns directly into one fresh logical planning frontier and automatic worker launch without the owner transporting handoff, proposal text, streams, or prompts.

Banked audited slice: `LOGICAL_PLANNER_AUTODISPATCH_1` at `234b5b1`. The required audit/re-audit cuts are incorporated. This first cut is deliberately one-shot rather than continuous reconciliation:

```text
recover active Claims first
→ current WorldHead(World, productCommit)
→ compile durable planner input
→ one fresh read-only logical planner
→ ordered semantic proposal candidates
→ controller binds current authority + derives mechanics
→ atomic Claim/session admission
→ bounded concurrent workers
→ existing Closure/integration/World landing
→ stop
```

Hard cuts:

- remove `.meta-harness/repo-proposals.json` as active fresh-work ingress; historical proposal bytes remain evidence/migration-only;
- delete the active Proposal Set abstraction as well as the mutable proposal file: historical `repo-proposal-set/v2` parsing may remain legacy-only, but fresh planner candidates flow directly into Outcome/Claim admission and have no durable Proposal Set identity;
- planner candidates carry semantic result/journey/action/done/stop plus non-authoritative `expectedWritePaths[]`; the controller may normalize equivalent path syntax or reject the whole candidate, but must never widen or shrink that semantic footprint. Constitutional safety (`PRODUCT.md`, `.git`, protected `.meta-harness`, traversal, reversible scope) is checked during boundary compilation; active-Claim compatibility is decided separately by atomic Claim admission;
- derive planner context through a slim attributable projection of current World/productCommit, capacity, active commitments, and the latest unresolved authoritative Closure/work-result/forward-motion learning; preserve exact digests while omitting raw chats, workspace/permit/custody internals, and full operational envelopes;
- reuse one concrete ephemeral structured-model process helper across worker/challenger/planner invocation mechanics; it is read-only by construction, with no dormant writable mode and no provider/plugin abstraction;
- consume worker/Closure handoff automatically, eliminating the `explain to me:` transport step;
- emit machine-consumable proposal candidates, never instructions such as `run two streams` for the owner to relay;
- feed accepted candidates directly into existing Outcome/Claim/session admission so compatible workers boot automatically;
- keep worker prompts internal; normal output never asks the owner to copy, paste, inspect, or route them;
- skip planner invocation when recovered executable commitments already fill local capacity;
- allow at most one bounded stale-Head replan before any new Claim becomes visible; repeated wake/refill remains Phase 6;
- planner has no owner-escalation field. Only already-validated Phase-4 `OWNER_REQUIRED` proof may reach `Need you`.

Planner context/output is reconstructable, disposable, and non-authoritative. `expectedWritePaths[]` is a footprint prediction rather than capability, and boundary compilation is exact-or-reject: no silent widening or shrinking. Claims remain the durable commitment boundary; planner death before Claim creation is harmless, and planner output disappearing after Claim creation cannot cancel work.

**Implemented/validated:** fresh planner input reconstructs unresolved durable Closure/work-result/forward-motion handoff with attribution digests and no chat/custody internals; two compatible semantic candidates auto-admit and overlap; exact-or-reject boundaries reject whole conflicting candidates; stale planner output gets at most one pre-Claim retry; stale `.meta-harness/repo-proposals.json` is inert; recovered full capacity skips planning; planner snapshots exclude owner-checkout dirt; normal human rendering exposes no prompts/Claim/workspace identifiers; and Phase-4 remains the sole owner-escalation membrane. The post-bank self-audit identified the Phase-6 defects: terminal Closures could sit behind a fresh planner boot after restart, local workers still passed through a whole-wave `Promise.all()` barrier, and ordinary rejected planner candidates could leave inert Outcome debris.

### Phase 6 — Event-driven reconciliation + capacity refill

**Product result:** remove the remaining whole-wave barrier so terminal Closures land as soon as they are ready, authoritative releases immediately free local capacity, and fresh current-Head planning refills that capacity while slower siblings continue.

**Banked validated slice:** `EVENT_DRIVEN_RECONCILIATION_1` at `39ab56a`. Phase 5's synchronous-barrier/counterfactual-refill telemetry established the defect; Phase 6 replaced that counterfactual with actual event-driven landing/refill behavior and telemetry.

```text
command entry
→ land already-terminal Closures before planning
→ recover commitments
→ fill local capacity
→ workers run concurrently

first worker settles
→ durable Closure lands immediately
→ World/product Head advances
→ Claim releases
→ recompute from current durable truth
→ recover admitted work first
→ fresh planner only if a slot still needs possibilities
→ new compatible worker starts

slower siblings keep running throughout
```

Hard cuts:

- replace the active static-wave/`Promise.all()` settlement barrier with an ephemeral controller-local running set and next-completion wakeups;
- always drain landing-ready durable Closures before a planner boot, including Closures left by a crashed/foreign controller;
- treat worker completion only as a wake signal: every action is re-derived from current Head, Claims, Closures, and workspace custody;
- invoke planner at most once for one unchanged authoritative Head in a controller quiescence epoch; a Head advance creates a fresh planning epoch;
- discard every unused planner candidate on Head change; admitted Claims survive as commitments;
- recover/start already-admitted executable Claims before spending a free slot on fresh planning;
- move ordinary planner Outcome persistence behind Claim availability so rejected/conflicting candidates do not leave deterministic durable Outcome debris;
- derive quiescence from durable truth and current planner result rather than persisting queue/event/scheduler state;
- keep `runWork()` as the one-worker transaction and current-World/product CAS landing as the only authoritative linearization mechanism;
- evolve orchestration telemetry only as non-authoritative measurement of completion→landing and released-slot→redispatch latency.

“Event-driven” here means events inside one active `meta-harness work` command plus exact reconstruction on the next command after interruption. It does **not** mean a daemon, filesystem watcher, cron loop, event bus, job queue, or persistent scheduler service.

**Validated:** with local bound 2, A and B start together; A lands while B is deliberately held inside its worker; the released slot admits/starts C from the post-A authoritative `productCommit` before B is released; B later reinterprets against the current World/product Head; command-entry terminal Closures land before planner input is compiled; recovered Claims start before fresh planning; stale candidates are discarded per Head; ordinary conflict rejection leaves no orphan Outcome; and normal owner interaction contains no rerun/continue/stream-routing step merely to refill useful capacity.

### Phase 7 — Research promotion + minimum sufficient context

**Product result:** research-driven coding uses accumulated expert knowledge without turning raw chats into planner memory, worker memory, or authority.

Phase 7 is deliberately split by evidence rather than implemented as one context framework.

#### Phase 7A — Promoted research findings

**Implemented/validated in the working tree:** `PROMOTED_RESEARCH_FINDINGS_1` (see repository-root `implementation_plan.md`). The slice is not yet banked.

```text
current WorldHead.productCommit
→ exact tracked docs/research/** + docs/chats/** source occurrences
→ sha256(exact committed source bytes)
→ unseen content gets one fresh read-only content-only promotion pass
→ mechanically verify exact unique UTF-8 quotation bytes + byte offsets
→ one canonical immutable non-authoritative research-promotion/v1 with nested findings[]
→ project current source occurrence provenance
→ compact repo-planner-input/v2.promotedResearch[]
→ fresh logical planner
```

Hard cuts:

- raw research source bytes are source material only and never enter planner context directly;
- source occurrences carry current path/blob provenance, but promotion cache identity is exact content digest, so a pure rename does not repromote unchanged bytes;
- the promoter receives source content plus fixed extraction law, not path/World/product metadata, so the cached result is genuinely content-keyed;
- promoted research lives in a separate immutable evidence store rather than World/Claim authority, with one durable promotion object per content digest and no independent finding lifecycle;
- concurrent promotion is create-once at the content key; racing controllers may waste one duplicate model call, but only one canonical result survives and the loser rereads it;
- every retained finding has mechanically reopenable exact source quote bytes with persisted `byteStart` / `byteEnd`; missing or ambiguous quotation attribution rejects that finding;
- `FINDING`, `CONSTRAINT`, and `DISPROVED_ASSUMPTION` are advisory source-reported evidence. A promoted constraint is not an execution/constitutional restriction, and a disproved assumption is not a kernel prohibition;
- PRODUCT/owner authority, current World + authoritative execution learning, and active Claims outrank promoted research;
- only findings whose source content is currently present in authoritative `productCommit` enter planner context; historical promotions remain evidence without mutable supersession flags;
- contradictory current findings coexist with separate attribution; the kernel does not silently adjudicate domain truth;
- promotion runs before planner boot and unchanged content pays zero repeat model cost;
- compact promoted context fails explicitly with `MH_RESEARCH_CONTEXT_BUDGET` rather than silently truncating;
- do not reuse the historical scored context-gate/context-packet machinery;
- no embeddings, vector store, research daemon, web/source provider framework, worker research packet, generic ContextCompiler, or research-driven World transition.

**Validated for 7A:** after prior research/planner conversation state is absent, normal repo work can reconstruct compact attributable findings from current committed research automatically; dirty/untracked owner research stays invisible; same-content rename reuses promotion; edit/delete currentness is derived from `productCommit`; contradictory evidence remains separately attributable; zero-source repos pay zero promotion tax; concurrent promoters converge on one canonical receipt; and retained Phase-1–6 authority/event-driven reconciliation regressions remain green.

#### Phase 7B — Minimum sufficient execution context, only on observed need

Do not build a generic ContextCompiler yet. The current promoted corpus is small and there is no demonstrated retrieval-scale defect.

A later Phase-7 slice is warranted only when real use proves either:

```text
promoted planner context exceeds a bounded safe budget
OR
planner synthesis loses research detail that a worker materially needs
```

Then add the smallest selector/context binding necessary to carry only relevant promoted findings into planner/worker boot. No semantic/vector retrieval system is justified before that regression exists.

**Phase 7 complete when:** fresh planner and, where demonstrated necessary, worker sessions use promoted attributable research without rereading raw chat history; disproved assumptions remain visible across fresh sessions; contradictory evidence stays attributable; and research context remains bounded without becoming authority.

### Phase 8 — Structural SAW + adaptive review + meaningful `Next`

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

### Phase 9 — DRAIN / WAKE disposable-session proof

**Product result:** all model sessions can die safely and the organization still knows exactly what exists.

`DRAIN` must stop admission, close or checkpoint active work, park recoverable claims, release/abort irrecoverable claims, snapshot retained workspaces, and prove zero live executor leases. `WAKE` revalidates parked work and resumes or releases it using only durable artifacts.

**Done when:** kill every planner, worker, and reviewer session; start entirely fresh sessions; continuation needs no narration or old transcript.

### Phase 10 — Narrow ports + Harness Darwinism

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
