# FORWARD_MOTION_PROOF_1

Status: **AUDIT PASSED WITH MATERIAL REVISIONS; IMPLEMENTED LOCALLY, UNCOMMITTED; VALIDATION IN PROGRESS**

## Product result

Make the constitutional law

> A failed means is not a blocked outcome.

mechanically real on the active coding path.

`LINEAR_PRODUCT_HEAD_1` is banked locally at `e2172bc`. Meta-Harness now has parallel disposable execution, linear semantic World truth, one cumulative authoritative product commit, and current-Head-bound repo work. The next observed failure is not concurrency or Git continuity. It is false stopping and false human escalation.

Before this slice, a coding worker could return free-form `blocked`, `blocker`, and `nextAction`, and normal owner-goal presentation treated a question mark as sufficient authority to emit `Need you:`. A fresh model could therefore turn a failed API/source/implementation route into apparent owner authority even when the requested authority did not exist and autonomous substitutes remained. The active implementation now removes that path.

The Quant failure class is the reference defect:

```text
desired scientific outcome remains valid
preferred/partial API route is insufficient
fresh model invents or repeats a "librarian" authority requirement
owner is asked to resolve a fictional gate
next fresh session can repeat the same mistake
```

After this slice:

```text
worker proposes STOP
        ↓
exact stop evidence becomes durable
        ↓
fresh read-only forward-motion challenge
        ↓
┌───────────────────────────────────────────────────────┐
│ in-scope alternative exists                          │
│   → same Outcome / Claim / session continues         │
│   → next bounded execution generation automatically │
│                                                       │
│ Outcome needs a different plan                       │
│   → REPLAN_REQUIRED learning                         │
│   → no owner attention                               │
│                                                       │
│ hard outcome constraint is supported                 │
│   → BLOCKED with durable proof                       │
│                                                       │
│ genuine owner-exclusive authority is supported       │
│   → OWNER_REQUIRED with typed authority proof        │
└───────────────────────────────────────────────────────┘
```

The worker may report what it could not satisfy. It may not manufacture owner authority or decide that a failed route exhausts the Outcome.

This slice does **not** add the logical planner, automatic proposal regeneration, a research agent, a queue, a daemon, or a generic policy/evidence language.

## Constitutional slice laws

```text
Outcome is stable
means are disposable

worker STOP is a proposal
not terminal authority

failed route
≠ hard outcome constraint
≠ owner-exclusive authority

owner attention requires a typed validated proof
punctuation is never authority

an in-scope substitute keeps the same Outcome / Claim / session
planner is not required merely to change means

replan is autonomous organizational work
not an owner question

one worker STOP may trigger one bounded fresh challenger
normal successful work triggers no extra reviewer

no arbitrary authority roles
no "librarian", "approver", "manager", or other model-invented owner gate

fresh-session continuity comes from durable proof
not conversation memory
```

## Hard cut 1 — worker STOP becomes structured and loses owner-routing prose

Hard-cut the active coding-worker result to `worker-result/v2`.

Delete worker-authored:

```text
blocker
nextAction
```

The worker is not the organizational router and is not allowed to formulate a human escalation.

Conceptual active shape:

```json
{
  "schemaVersion": "worker-result/v2",
  "status": "DONE | PARTIAL | STOP",
  "observableResult": "...",
  "operations": [],
  "validation": [],
  "stop": null
}
```

For `status = STOP`:

```json
{
  "stop": {
    "unsatisfiedRequirement": "...",
    "failedMeans": [
      {
        "means": "preferred source/API/implementation route",
        "evidence": ["exact observed reason it failed"]
      }
    ],
    "alternativesConsidered": [
      {
        "means": "another permissible route",
        "disposition": "FAILED | RULED_OUT | AVAILABLE",
        "evidence": ["..."]
      }
    ],
    "assertedConstraint": null
  }
}
```

Rules:

- a `STOP` worker must return zero mutation operations;
- `stop` is required for `STOP` and must be null for `DONE` / `PARTIAL`;
- the worker may state an observed constraint but may not nominate an owner, authority role, approval gate, or owner question;
- worker-level `blocked` terminology is deleted from the active contract: workers can stop executing, but cannot declare the organization blocked;
- `status` remains advisory; controller evidence still decides operational completion;
- the prompt explicitly requires alternatives to be sought before `STOP` is proposed;
- read-only worker sandboxing is still not a blocker;
- worker STOP bytes are untrusted evidence input, not an EscalationProof.

Historical worker-result shape needs no compatibility parser on the active path; these are ephemeral internal worker outputs. Existing durable historical work results/Closures remain readable as evidence.

## Hard cut 2 — persist the exact consumed STOP before interpreting it

A material generation has already consumed its AttemptEntry before the worker returns. If the worker returns `STOP`, the controller must not rely on the mutable agent-output file or conversation to know why that generation stopped.

Persist immutable:

```text
worker-stop/v1
```

Minimum identity:

```text
schemaVersion
sessionDigest
workspaceId
generation
attemptEntryDigest
startBoundary { HEAD, branch, indexDigest, dirtyManifestDigest, treeOid }
endBoundary   { HEAD, branch, indexDigest, dirtyManifestDigest, treeOid }
exact worker-result/v2 STOP
recordedAt
stopDigest
```

The controller must mechanically prove:

```text
STOP worker returned zero operations
workspace boundary is still inside authority
end bytes equal the exact bytes observed after the worker
Git HEAD/index/branch authority is unchanged
```

For a no-operation stop, byte continuity is explicit. The stop record is create-only and generation-addressed.

Crash law:

```text
AttemptEntry + durable worker-stop + no forward-motion proof
→ fresh controller resumes blocker evaluation
→ worker attempt is not replayed

AttemptEntry + no stop + no candidate seal
→ retain current fail-closed INTERRUPTED_AFTER_ENTRY behavior
```

Thus process death after a valid worker STOP no longer converts a known stop into an opaque interruption merely because the challenger had not yet run.

## Hard cut 3 — one bounded read-only forward-motion challenger

A worker STOP triggers exactly one fresh, ephemeral, read-only forward-motion challenge for that generation.

This is not another planner and not a universal reviewer. It is a risk-triggered falsification step for one specific high-cost claim: "the Outcome cannot autonomously continue."

Use the already-supported coding-model runtime directly. Do not build a provider abstraction.

The challenger receives only the minimum exact context:

```text
owner-authored PRODUCT direction
sealed work-session
exact execution boundary / AttemptEntry
worker-stop/v1
prior forward-motion proofs for this same Outcome/session
relevant repository snapshot
constitutional owner-exclusive authority kinds
```

It must answer one question:

> Does the evidence establish a hard/owner-exclusive stop, or did only the currently preferred means fail?

The challenger must actively seek a permissible substitute before confirming a terminal stop.

It returns a candidate that the controller validates and seals as:

```text
forward-motion-proof/v1
```

## `forward-motion-proof/v1`

Minimum shape after audit slimming:

```text
schemaVersion
workerStopDigest

disposition
failedMeans[]
alternatives[]
hardConstraint
ownerRequest
disprovedAssertions[]

evaluatedAt
proofDigest
```

`workerStopDigest` immutably resolves session / Outcome / Claim provenance, workspace, generation, AttemptEntry, and exact byte boundary. The proof does not duplicate those bindings, which removes contradictory identity states.

Allowed dispositions:

```text
CONTINUE_WITH_ALTERNATIVE
REPLAN_REQUIRED
HARD_BLOCKED
OWNER_REQUIRED
```

### `CONTINUE_WITH_ALTERNATIVE`

Requires:

- at least one concrete `AVAILABLE` alternative;
- that alternative stays inside the existing Outcome, allowed paths, product direction, and reversible execution authority;
- no owner request.

### `REPLAN_REQUIRED`

Means the current sealed execution brief is no longer the right means decomposition, but no owner-exclusive decision has been proved.

Examples:

- the Outcome remains valuable but requires a new engineering/research route outside this session's `doNow` decomposition;
- attempts are exhausted while viable autonomous alternatives remain;
- evidence is insufficient to claim a hard constraint.

`REPLAN_REQUIRED` is **not** `OWNER_REQUIRED`.

### `HARD_BLOCKED`

Requires:

- a stated outcome-level constraint;
- no `AVAILABLE` alternative in the bounded challenge;
- no owner request.

The proof does not claim generic logical impossibility. It records the strongest current evidence for a hard stop and remains supersedable by new evidence.

### `OWNER_REQUIRED`

The owner request is a strict sum type. No arbitrary role/name is accepted.

Allowed kinds are exactly the product's constitutional owner-exclusive categories:

```text
PRODUCT_TASTE
SCOPE_EXPANSION
CREDENTIALS
PROTECTED_ACCESS
DESTRUCTIVE_ACTION
PUBLICATION
MATERIAL_RISK
```

Minimum request:

```text
kind
question
evidence[]
```

Rules:

- arbitrary authority identities such as `librarian`, `manager`, `review board`, or `approver` are invalid schema values;
- at least one bounded challenge must have searched for autonomous alternatives;
- any `AVAILABLE` permissible alternative invalidates `OWNER_REQUIRED`;
- the question is generated from the validated owner request, never copied from worker `nextAction` prose;
- unsupported owner-authority output fails closed to `REPLAN_REQUIRED`, not to `Need you`.

The kernel validates identity/binding/enum/structural invariants. It does not pretend to mechanically understand all domain semantics. The independent challenger supplies semantic falsification; repository World interpretation may retain the resulting learning.

## Hard cut 4 — same-Outcome alternative means continue automatically

When `forward-motion-proof/v1.disposition == CONTINUE_WITH_ALTERNATIVE` and bounded attempts remain:

```text
same Outcome
same Claim
same work-session/v7
same workspace
new execution generation
fresh ExecutionPermit / AttemptEntry
```

Do **not** create a new proposal or call a planner merely because implementation means changed.

The controller converts the accepted alternative into bounded repair guidance analogous to validation repair:

```text
"The previous route failed but is not a hard blocker.
Continue the same sealed Outcome using this permissible alternative: ..."
```

The product result, scope, done condition, product direction, Claim, and session bytes remain unchanged.

### Byte continuity across a STOP generation

Current workspace recovery historically assumed generation N+1 is based on candidate seal N. A zero-operation `STOP` generation has no coding candidate.

Do not fake a successful candidate seal and do not let semantic evaluation become custody evidence.

Previous-generation continuity is now:

```text
candidate-seal/v1
OR
(worker-stop/v1 exact current byte boundary
 AND forward-motion-proof/v1 == CONTINUE_WITH_ALTERNATIVE)
```

The responsibilities are intentionally separate:

```text
worker-stop/v1
= what mechanically happened / exact byte continuity

forward-motion-proof/v1
= what that evidence means

ExecutionPermit
= what may happen next
```

Generation N+1 is legal only while the live HEAD / branch / index digest / dirty-manifest digest / Git tree identity still equal `worker-stop/v1.endBoundary`, and the separately bound proof authorizes `CONTINUE_WITH_ALTERNATIVE`. Mechanical truth never depends on evaluator semantics.

Crash laws:

```text
proof CONTINUE durable; generation not yet advanced
→ fresh controller advances once and continues

proof CONTINUE + next generation already active
→ exact proof is previous-generation continuity evidence

proof terminal disposition durable
→ do not invoke coding worker again
→ construct terminal work result / Closure from that proof
```

## Hard cut 5 — active work result distinguishes replan, block, and owner authority

Hard-cut active controller result to `work-result/v2` for new executions.

Preserve the current operational/product fields and add exact forward-motion binding:

```text
forwardMotionProofDigest: sha256:... | null
```

New non-success outcome classes:

```text
REPLAN_REQUIRED
BLOCKED
OWNER_REQUIRED
```

Rules:

```text
DONE / BANKED_UNPROVEN
→ forwardMotionProofDigest = null

REPLAN_REQUIRED
→ proof disposition REPLAN_REQUIRED
  or CONTINUE_WITH_ALTERNATIVE after bounded attempts are exhausted

BLOCKED
→ proof disposition HARD_BLOCKED
  or controller-proven non-semantic hard failure

OWNER_REQUIRED
→ proof disposition OWNER_REQUIRED only
```

Controller-proven integrity/authority failures remain fail-closed exceptions or mechanically backed blocked states; they do not need a model challenger to prove that a digest or Git boundary mismatch occurred.

Exhausted implementation/validation failure is not silently upgraded to an owner decision. If bounded repair fails without owner-exclusive evidence, classify for autonomous replan.

Historical work-result/v1 remains readable inside existing durable `execution-work-result/v1` evidence. New active execution emits v2 only.

ExecutionClosure remains an **operational** record. It does not need to become the semantic blocker ontology. `REPLAN_REQUIRED`, `BLOCKED`, and `OWNER_REQUIRED` may all retain an operational non-completed Closure while the exact forward-motion proof carries the reason/disposition.

## Hard cut 6 — punctuation and worker prose lose owner authority

Delete the current human-routing heuristic:

```text
nextAction.endsWith("?")
→ Need you
```

Normal output may emit `Need you:` **only** when the result references a validated `forward-motion-proof/v1` whose disposition is `OWNER_REQUIRED`.

Examples:

```text
worker says: "Ask the librarian for permission"
→ impossible to encode as owner authority
→ no Need you

worker says: "API route unavailable"
challenger finds SEC filing route
→ same Outcome continues automatically

challenger proves missing credential is required and no permissible substitute remains
→ OWNER_REQUIRED(CREDENTIALS)
→ Need you: <one concise credential/protected-access question>
```

Repo-owned aggregate output must likewise distinguish:

```text
LANDED
REPLAN_REQUIRED / INVALIDATED_REPLAN
BLOCKED
OWNER_REQUIRED
RUNNING_ELSEWHERE
```

Owner attention is not inferred from generic `BLOCKED`.

## Hard cut 7 — repository landing receives the proof as learning evidence

For repo-owned work, current-World Closure landing must resolve and include the exact `forward-motion-proof/v1` when one exists.

Conceptual landing packet:

```text
current World + Head/productCommit
Outcome
Claim
Closure
work result
forward-motion proof | null
integration failure | null
```

Rules:

- non-DONE results never enter canonical product code;
- `REPLAN_REQUIRED` must become current-World replan learning rather than an owner stop;
- `OWNER_REQUIRED` may be retained in World as a real owner-exclusive unresolved fact and surfaces the validated question;
- `HARD_BLOCKED` may be retained as current evidence of an outcome-level stop;
- Claim still resolves through one linear World transition;
- later evidence may supersede a prior hard-block interpretation; no false global terminality is inferred.

Do not create a separate mutable blocker database.

The immutable proof + authoritative World learning are the durable continuity substrate. Phase 5's planner/context boot will consume those artifacts rather than old chat.

## Fresh-session law

The Quant regression must survive total conversational amnesia.

At minimum:

```text
session 1:
preferred source/API fails
model asserts nonexistent librarian/authority gate
forward-motion boundary rejects owner authority
proof records failed means + unsupported assertion / alternative
World learns replan/forward-motion state

kill model session

fresh session:
no old transcript
same unsupported arbitrary authority role cannot become OWNER_REQUIRED
prior failed means/proof is available as durable context to the challenger/planner path
```

This slice does **not** attempt semantic de-duplication of every differently worded misconception. The hard owner-authority membrane is mechanical: only the seven constitutional owner kinds exist. Durable failed-means/disproved-assertion evidence gives later planner/context work something exact to consume.

Do not build a generic belief graph or constraint ontology here.

## Forward-motion challenger trust boundary

The challenger is deliberately weaker than kernel authority and stronger than one worker's self-report.

It is:

```text
fresh model context
read-only
no execution permit
no materialization authority
no Git authority
no owner authority
bounded to one STOP evaluation
```

It may recommend a means or classify evidence. The controller alone:

- validates schema and exact bindings;
- decides whether the means remains within the sealed execution authority;
- grants the next execution generation;
- accepts only bounded owner-authority kinds;
- persists the proof;
- determines user-facing routing.

No second planner, manager agent, provider framework, or recursive review packet is introduced.

## Product-path effect

Normal successful work remains unchanged:

```text
Outcome → Claim → runWork() → BANK → Closure → integration → World
```

Only a proposed stop takes the additional path:

```text
worker STOP
→ durable worker-stop
→ fresh challenger
→ forward-motion proof

CONTINUE_WITH_ALTERNATIVE
→ next runWork generation automatically

REPLAN_REQUIRED
→ durable Closure/World learning
→ future planner handles it without owner

HARD_BLOCKED
→ durable Closure/World learning

OWNER_REQUIRED
→ durable Closure/World learning
→ one concise Need you
```

The planner stays out of the execution hot path.

## Quant reference regression

Use the observed partial-source failure class rather than a toy approval example.

Scenario:

```text
Outcome requires a scientific evidence result
preferred API/source exposes only partial coverage
worker says the unavailable route requires "librarian authority"
repository contains or permits another legitimate source route
```

Required behavior:

```text
"librarian" cannot become OWNER_REQUIRED
worker STOP cannot become terminal merely from prose
fresh challenger seeks substitute means

if substitute is inside current sealed Outcome/session:
→ CONTINUE_WITH_ALTERNATIVE
→ next generation executes without owner/planner

if substitute requires a different Outcome decomposition:
→ REPLAN_REQUIRED
→ no owner question

only genuine constitutional owner-exclusive need:
→ OWNER_REQUIRED
```

A fresh process/model run must produce the same authority boundary without relying on previous conversation memory.

## Acceptance suite

### 1. Arbitrary authority cannot reach the owner

Blocked worker reports a fictional `librarian`/manager approval requirement. The active schema has no arbitrary owner-role field; the forward-motion proof cannot validate `OWNER_REQUIRED`; normal output contains no `Need you`.

### 2. Failed means with available substitute continues the same Outcome

Generation 1 reports preferred API unavailable with zero operations. Challenger identifies an allowed repository/source alternative. Generation 2 receives a fresh permit and executes the same session/Claim with alternative guidance. No proposal/planner/owner round-trip occurs.

### 3. Alternative route does not widen authority

Challenger suggests a path or action outside the sealed session. Controller rejects it as `CONTINUE_WITH_ALTERNATIVE`; disposition becomes `REPLAN_REQUIRED` or a real typed owner proof if and only if constitutional owner authority is actually implicated.

### 4. Crash after durable STOP / before challenge

Fresh controller finds `worker-stop/v1`, does not replay the consumed worker generation, runs the forward-motion challenger, and continues/terminates from durable evidence.

### 5. Crash after CONTINUE proof / before generation advance

Fresh controller advances exactly once and executes the next generation from byte-identical continuity.

### 6. STOP-generation byte continuity is exact

Generation N returns `STOP` with no operations. `worker-stop/v1` is the mechanical previous-generation boundary; a separate `CONTINUE_WITH_ALTERNATIVE` proof authorizes advancement. Any HEAD / branch / index / dirty-manifest / Git-tree byte drift fails closed.

### 7. Genuine owner credential need is typed

No permissible substitute exists; challenger returns `OWNER_REQUIRED(CREDENTIALS)` with exact bound proof. Human output emits one concise `Need you` question.

### 8. Question punctuation has no authority

A controller/work-result string ending in `?` without an OWNER_REQUIRED proof never renders `Need you`.

### 9. Exhausted implementation means replans, not owner escalation

Validation/implementation attempts exhaust without a genuine owner-exclusive proof. Active result is `REPLAN_REQUIRED`; repo-owned landing records replan learning and releases the Claim.

### 10. Hard block remains possible

A bounded challenge finds no permissible substitute and records a supported outcome-level constraint. Result is `BLOCKED`, not OWNER_REQUIRED, and the proof remains supersedable by later evidence.

### 11. Repo landing binds exact proof

Repository interpreter receives the exact forward-motion proof with Closure/work result. Non-DONE code is never integrated; Claim resolves through linear World learning.

### 12. Fresh-session Quant regression

After a first fresh model proposes the fictional authority and the system rejects/records it, kill all model context. A second fresh run cannot convert that arbitrary role into owner authority and must prefer autonomous alternative/replan behavior when evidence permits it.

### 13. Successful path pays no review tax

A normal worker producing a valid candidate never invokes the forward-motion challenger and retains existing work-loop behavior/latency.

### 14. Owner-goal path also obeys the membrane

Direct owner-goal work can ask the owner only through a validated typed proof. No model-authored `nextAction` can directly control human routing.

## Likely implementation surface

Primary modules:

```text
lib/coding-worker.js                  # worker-result/v2; remove blocker/nextAction routing prose
lib/work-forward-motion.js            # fresh read-only challenger + proof schema
lib/work-forward-motion-record.js     # worker-stop/proof immutable identities if split is cleaner
lib/work-loop.js                      # STOP interception + same-session continuation
lib/work-git.js                       # recovery/continuity from forward-motion proof
lib/execution-closure.js              # active work-result/v2 classification only if needed
lib/repo-outcome-landing.js           # include proof in semantic landing
lib/repo-work-wave.js                 # aggregate OWNER_REQUIRED / REPLAN_REQUIRED truthfully
lib/commands/work.js                  # delete punctuation authority heuristic
```

Prefer keeping the proof contract and challenger execution outside `work-loop.js`; the loop should orchestrate one Outcome transaction, not become a blocker-policy monolith.

Expected focused tests:

```text
tests/forward-motion-proof.test.js
tests/work-loop.test.js
tests/cli-work.test.js
tests/parallel-outcome-progress.test.js
tests/linear-product-head.test.js
```

## Roadmap consequence — strengthen Phase 5 with observed owner-routing regressions

The next planner phase now has three concrete black-box frictions it must eliminate:

```text
owner must not type "explain to me:" to make a planner consume worker handover
owner must not relay "run two streams" into worker launches
owner must never copy/paste or inspect worker prompts to boot execution
```

Phase 5 therefore must end at **automatic initial dispatch**, not merely proposal-file production:

```text
fresh logical planner
→ consumes durable World / Closures / forward-motion proofs
→ emits current-Head-bound proposals
→ Meta-Harness validates/Claims compatible proposals
→ worker sessions boot automatically
→ planner disappears
```

Planner output is machine-consumable execution intent, never instructions for the owner to route agents.

Phase 6 remains event-driven refill after capacity/World changes; it repeatedly wakes/reconstructs the planner only when fresh proposals are needed.

This Phase-5 strengthening is roadmap planning only. Do not implement planner boot or dispatch generation in this slice.

## Deliberately deferred

```text
logical planner runtime
automatic proposal generation
planner handoff/context compiler
continuous capacity refill
broad research/source acquisition service
generic misconception / belief graph
semantic aliasing of differently worded constraint claims
EscalationProof policy DSL
provider abstraction
multi-model reviewer framework
queue / daemon / scheduler
DRAIN / WAKE
remote publication
```

A later context/research phase may promote durable forward-motion findings into richer ConstraintRecords if repeated real use proves exact proof/World learning insufficient.

## Architecture audit resolutions

The architecture audit passed the slice with material revisions and no additional research round:

1. structured `STOP` replaces worker-authored `blocker` / `nextAction`, and active worker vocabulary deletes `blocked` entirely;
2. keep exactly one fresh read-only challenger only on `STOP`; ordinary success pays zero review tax;
3. each new coding generation selected through `CONTINUE_WITH_ALTERNATIVE` consumes the normal bounded attempt budget; the challenger itself does not;
4. `worker-stop/v1` carries mechanical byte continuity; `forward-motion-proof/v1` references it and carries semantic judgment only;
5. mechanical integrity failures need no semantic challenger; exhausted implementation/validation without owner proof becomes autonomous `REPLAN_REQUIRED`;
6. the seven owner-exclusive kinds remain the closed enum; no `OWNER_INTENT_CHANGE` or arbitrary organizational role is added;
7. `disprovedAssertions[]` remains immutable proof/World evidence; no generic ConstraintRecord is introduced;
8. repo landing keeps non-DONE code out of canonical product history and records replan/block/owner learning through the existing linear World path.

Fresh-session product correctness is part of the same slice: any active protocol cut must leave agent boot surfaces truthful. `AGENTS.md`, README, and the product spec are updated alongside `worker-result/v2`; documentation drift is not deferred as a separate hygiene slice.

## Validation target after implementation

Focused acceptance first:

```text
node --test tests/forward-motion-proof.test.js
node --test tests/work-loop.test.js tests/cli-work.test.js
node --test tests/parallel-outcome-progress.test.js tests/linear-product-head.test.js
node --test tests/outcome-claim-authority.test.js tests/execution-permit.test.js tests/work-git.test.js
```

Then run/reproduce the repository wrapper topology and `git diff --check`, reporting wrapper/tool failures separately from test failures exactly as in Phase 3.

## Current implementation boundary

`FORWARD_MOTION_PROOF_1` is implemented and validated locally on the active checkout and remains uncommitted.

Implemented in this slice: incompatible `worker-result/v2`; durable `worker-stop/v1`; one STOP-only read-only challenger; slim `forward-motion-proof/v1`; same-session alternative continuation; `work-result/v2`; exact STOP recovery; typed owner authority; punctuation-authority deletion; repo landing/aggregate propagation; focused regressions; and fresh-session boot documentation alignment.

Validation evidence:

- focused worker/CLI/forward-motion suite: 58/58 passed;
- repo-owned proof landing plus linear/parallel landing: 18/18 passed;
- broader authority/Git/parallel/complexity regression set: 43/43 passed;
- repository wrapper topology: all 119 pre-existing discovered test files passed in bounded replay, then the new repo-landing regression passed, for 120/120 test files passing by file;
- monolithic `npm test` did not return through DevSpace because the connector returned an upstream 502, so no monolithic-wrapper PASS is claimed;
- `git diff --check`: PASS;
- new source modules are within the active 400-line budget and new focused test files are within the active 300-line budget;
- `quality check` remains BLOCKED by the repository's stale ratchet baseline, which classifies many already-banked/pre-existing modules as new or grown; the new forward-motion modules are not among its findings. The baseline is not rewritten in this slice.

Not implemented: Phase-5 logical planner boot/automatic proposal generation, generic constraint ontology, provider abstraction, queue/daemon/scheduler, or publication expansion.

`PRODUCT.md` remains owner-authored and untouched. Before Phase 5 implementation, the owner must explicitly update `PRODUCT.md` if the logical-planner-only interface and automatic decomposition/dispatch are to become product direction rather than roadmap intent.
