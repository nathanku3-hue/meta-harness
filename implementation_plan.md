# CONTROLLED_DRAIN_WAKE_1

Status: **IMPLEMENTED — DETERMINISTICALLY VALIDATED; LIVE MODEL EVALS REMAIN EXTERNAL**

## Stabilization boundary

`OWNER_OBJECTIVE_CONTINUITY_1` is banked at `5fbf7b8` (`Implement owner-objective continuity`). Git is authoritative for that custody fact.

Phase 7B remains unwarranted. Phase 8B remains unwarranted. Phase 9 is implemented and deterministically green, but its required real-planner A/B/C `pass^3` behavioral eval is still blocked by the local Codex installation failing before prompt execution with an incompatible models-cache error (`missing field base_instructions`). The native WSL Codex package is also incomplete.

That installation failure is **not** promoted into a new Meta-Harness architecture slice:

- Meta-Harness already reaches the installed Codex runtime;
- the failure occurs before planner prompt execution;
- mutating global Codex caches/installations is outside repository authority;
- adding a second evaluator/provider/fallback would violate the current no-framework/no-substitute-evaluator laws.

The Phase-9 implementation is complete and its repository-owned continuity path is now the input to Phase 10. The retained real-planner A/B/C evaluation remains a separate external behavioral-evidence item; it does not gate controlled shutdown correctness or cause a substitute evaluator to be added.

`PRODUCT.md` remains owner-authored and untouched.

## Observed continuity defect

Crash recovery is already strong, but **intentional quiescence is not**.

Today Meta-Harness can recover:

```text
sealed candidate
worker STOP
terminal BANK / Closure
stale dead execution lease
active Claim/session/workspace custody
```

But there is no controller-owned shutdown boundary that can deliberately say:

```text
stop admitting/planning new work
terminate every local ephemeral model subprocess
preserve already-durable recoverable work
resolve truly non-recoverable entered work honestly
release every lease owned by this controller
prove local execution quiescence
exit
```

The current failure path is deliberately fail-closed: a coding generation that already consumed an `AttemptEntry` but produced neither a durable candidate seal nor a durable worker STOP is not replayed. Generic exceptions may terminalize that workspace and record controller rejection. That is correct for faults, but the controller cannot currently distinguish **intentional shutdown** from an ordinary execution failure or preserve a recoverable safe boundary without flowing through the generic exception path.

The endgame defect is therefore:

> **A model/controller process can die safely by accident, but Meta-Harness cannot yet intentionally make every local model session disposable and prove a clean handoff to fresh execution.**

## Product result

A first process signal requests a bounded controller drain rather than immediately abandoning process state.

```text
active meta-harness work
        ↓
SIGINT / SIGTERM (or injected internal AbortSignal)
        ↓
DRAINING  # controller-local mode only
        ↓
stop new planner / promotion / Claim admission / worker launch
        ↓
terminate live ephemeral model subprocesses
        ↓
classify each admitted execution from durable truth

safe durable boundary
  PENDING_WORKSPACE
  BASELINE before AttemptEntry
  SEALED_CANDIDATE
  WORKER_STOP
→ keep Claim/session active
→ keep existing workspace ACTIVE when one exists
→ create no workspace for PENDING_WORKSPACE
→ release execution lease when one exists
→ ordinary future work resumes it

AttemptEntry consumed
+ no candidate seal
+ no worker STOP
→ generation is irrecoverable
→ durable no-result Closure
→ ATTEMPT_ABORTED current-World transition
→ Claim release

terminal Closure already exists
→ finish ordinary landing/release before drain completes
        ↓
assert no workspace execution lease owned by draining controller
assert no local model subprocess remains
        ↓
process exits cleanly
```

**WAKE is not a new lifecycle command.** The existing normal `meta-harness` / `meta-harness work` entry re-reads durable authority, lands terminal Closures first, resumes recoverable active Claims, and replans released/aborted work from current owner objective + World when warranted.

Core law:

> **DRAIN changes process liveness, not product authority. WAKE is ordinary reconstruction from durable truth.**

## Constitutional slice laws

```text
no public drain command
no public wake command
no persisted global draining flag
no parked Claim state
no parked workspace state
no shutdown queue
no executor registry database

first signal = cooperative controlled drain
second signal may force ordinary process termination

stop new commitments before stopping existing execution

model subprocesses are disposable
Claims are not disposable

all model subprocesses cross one cancellable process boundary
all model results remain disposable until controller durableization

safe durable boundary → preserve Claim
PENDING_WORKSPACE is a safe boundary before workspace creation
no durable boundary after AttemptEntry → abort attempt/Claim honestly

first live termination cause wins: DRAIN | TIMEOUT | OUTPUT_CAP
cancellation cause is runtime-only; durable truth records only interruption outcome

planner output → fence → Claim
promoter output → fence → canonical promotion
worker output → fence → worker STOP or candidate seal
challenger output → fence → forward-motion proof
proof-compiler output → fence → compiled product-proof spec

worker STOP / candidate seal are durable recovery boundaries

foreign controller leases are not owned or killed
local drain proves zero leases owned by this controller

ATTEMPT_ABORTED is execution interruption evidence
not a hard Outcome blocker

WAKE = normal product entry
not lifecycle ceremony
```

## Hard cut 1 — make one cancellable model-process membrane actually universal

Extend:

```text
runEphemeralStructuredModel(...)
```

with optional:

```text
signal: AbortSignal
```

Do not add a provider/runtime interface.

The helper already owns the correct detached-process-group / Windows process-tree termination mechanics. Cancellation belongs there, and **every model-authored subprocess must use it**.

Live code has one exception today:

```text
lib/work-proof-compiler.js
→ runProofCompilerAgent()
→ bespoke spawnSync(Codex)
```

Delete that bespoke model launcher. Keep deterministic/no-model proof compilation, Git snapshot preparation, calibration, and proof execution synchronous where they already are, but route the model-authored proof compiler through `runEphemeralStructuredModel()` like planner/promoter/worker/challenger.

This is a hard simplification, not a second cancellation implementation.

Required behavior:

```text
signal already aborted before invocation
→ spawn no child
→ reject with typed MH_DRAIN_REQUESTED

signal not aborted
→ existing behavior unchanged

signal aborts while child live
→ first terminationCause write wins
→ terminate exact child/process tree exactly once
→ WAIT for child close
→ reject according to the winning cause
```

Cancellation setup must be race-safe around spawn: check `signal.aborted` before listener attachment, use a one-shot listener, recheck the race window, and remove the listener on ordinary close/error settlement. A pre-aborted signal may not spawn a child.

Use one local cause value, not independent booleans:

```text
terminationCause = null | DRAIN | TIMEOUT | OUTPUT_CAP
```

First write wins:

```text
timeout then SIGINT while child is dying → TIMEOUT
SIGINT then timeout while child is dying → DRAIN
output cap then SIGINT → OUTPUT_CAP
```

Natural child close with no termination cause retains ordinary exit/result behavior.

The rejection for a live child must occur only after the subprocess is no longer live and stdio close has been observed. This is what lets controller code prove model-session quiescence without a second process registry.

Keep distinct failures:

```text
MH_*_TIMEOUT
MH_*_OUTPUT_CAP
MH_DRAIN_REQUESTED
```

Do not reinterpret timeout/error as drain and do not reinterpret drain as model failure.

Every model-authored caller threads the same signal:

```text
logical planner
research promoter
coding worker
forward-motion challenger
product-proof compiler
```

For the proof compiler specifically:

```text
ordinary compiler failure
→ existing GAP product-proof behavior

MH_DRAIN_REQUESTED
→ propagate cancellation
→ DO NOT manufacture a GAP
```

A controlled interruption may not mutate semantic product-proof state merely because the compiler was interrupted.

Future structured-model callers inherit the same cancellation contract by using the same helper.

## Hard cut 2 — every model result is discardable until its durableization fence

Planner candidate batches have no authority before Claim visibility.

Therefore:

```text
drain during logical planner
→ terminate planner child
→ discard partial/no output
→ create no Claim
→ no durable planner artifact required
```

Research promotion is content-keyed and canonical only after exact promotion validation/persistence.

Therefore:

```text
drain during promoter
→ terminate promoter child
→ discard uncanonicalized output
→ retain any already-canonical promotions
→ future planner boot may re-promote still-missing exact content
```

Drain is also an authority fence after model return, not only a child-kill mechanism:

```text
planner output returned in memory
+ signal observed before Claim admission
→ discard the batch
→ admit zero Claims

promoter output returned in memory
+ signal observed before canonical promotion persistence
→ discard the candidate
→ persist no new promotion
```

The same law applies to worker, challenger, and model-authored proof-compiler output:

```text
worker output returned in memory
+ signal observed before durableization
→ do not record worker STOP
→ do not materialize operations
→ do not seal candidate
→ because AttemptEntry exists, classify internally as `INTERRUPTED_AFTER_ENTRY`
→ this label is runtime/controller logic only, not a new durable state

challenger output returned in memory
+ signal observed before proof persistence
→ do not record forward-motion proof
→ retain exact durable worker STOP
→ WAKE reruns challenger

proof-compiler output returned in memory
+ signal observed before compiled spec is sealed/returned
→ discard model output
→ propagate MH_DRAIN_REQUESTED
→ do not synthesize GAP
```

The universal fence is therefore:

```text
planner output        → signal fence → Claim
promoter output       → signal fence → canonical promotion
worker output         → signal fence → STOP or candidate seal
challenger output     → signal fence → forward-motion proof
proof-compiler output → signal fence → compiled product-proof spec
```

This closes every race where a model process has already exited but its still-disposable semantic output has not crossed the controller-owned durable boundary.

Do not create planner checkpoints, promoter checkpoints, model session IDs, cancellation-cause receipts, or drain receipts.

## Hard cut 3 — worker execution needs an explicit drain-aware safe-boundary classifier

`runWork()` already has the information needed to distinguish safe durable continuation from irrecoverable in-flight model work.

Add optional:

```text
signal: AbortSignal
```

and a small internal classification helper rather than spreading signal checks across arbitrary catch blocks.

`PARKED` below is only an ephemeral in-memory settlement label returned to the controller. It is never written into Claim, workspace, session, World, Closure, or queue state.

The relevant states are existing states:

### A. `PENDING_WORKSPACE`

A Claim + work session is already durable, but no workspace exists yet.

If drain is already observed before `runWork()` performs verifier setup, worktree creation, or lease acquisition:

```text
Claim/session remain active
create no workspace
acquire no execution lease
consume no AttemptEntry
return internal PARKED drain settlement
```

`runWork()` must check an already-aborted signal at its earliest executable boundary, before `assertVerifierAvailable()`, `prepareWorkspace()`, and lease acquisition. Do not create a workspace merely to park it.

### B. `BASELINE` with no current AttemptEntry

If drain is observed before issuing the next `ExecutionPermit` / `AttemptEntry`:

```text
workspace remains ACTIVE
Claim/session remain active
no new attempt is consumed
release execution lease
return internal PARKED drain settlement
```

Future normal recovery sees the same executable generation.

### C. durable `SEALED_CANDIDATE`

If exact candidate seal exists and still proves current bytes:

```text
workspace remains ACTIVE
Claim remains active
release lease
return PARKED
```

WAKE resumes controller validation/product proof/BANK from that same seal without worker replay.

### D. durable `WORKER_STOP`

If worker STOP is exact/current:

```text
workspace remains ACTIVE
Claim remains active
release lease
return PARKED
```

If the forward-motion challenger was live when drain arrived, `MH_DRAIN_REQUESTED` must propagate instead of being converted by `fallbackForwardMotionCandidate()` into `REPLAN_REQUIRED`.

WAKE reruns the one bounded challenger from the durable STOP when no proof exists.

### E. AttemptEntry consumed, no candidate seal, no worker STOP

This coding generation has no recoverable semantic output and replay is forbidden by existing law.

Controlled drain must not pretend otherwise.

```text
verify exact workspace boundary remains inside authority
terminate worker model
record exact no-result ExecutionClosure
terminalize only this unrecoverable workspace generation
release lease
land ATTEMPT_ABORTED
release Claim
```

Prefer existing `TERMINAL_ABANDONED` workspace state for the intentionally abandoned execution custody rather than describing it as a hard product block. Do not add `PARKED`, `DRAINED`, or another workspace state.

The owner objective/World remains, so WAKE may derive a fresh Outcome/Claim if the work is still positive-value and lawful.

### F. terminal Closure already durable

Drain does not strand terminal learning.

If no model subprocess is needed, finish ordinary current-World Closure landing and Claim release before drain returns.

## Hard cut 4 — controlled drain must bypass the generic destructive exception path for recoverable work

Current `runWork()` catch behavior is intentionally conservative for arbitrary faults: record closure where possible, terminalize ACTIVE custody, release lease, rethrow.

Do not weaken that generic safety behavior.

Instead handle `MH_DRAIN_REQUESTED` separately before the generic error path:

```text
if PENDING_WORKSPACE and drain already requested
→ PARKED internal settlement
→ create no workspace / acquire no lease / write no Closure

if exact recoverable workspace boundary exists
→ PARKED internal settlement
→ leave custody ACTIVE
→ no Closure
→ lease release in finally

if AttemptEntry exists without durable boundary
→ controlled abort path
→ terminal custody + no-result Closure

else
→ generic error handling unchanged
```

A normal exception must never gain the less-destructive drain behavior merely by looking similar.

## Hard cut 5 — reconciliation gets one controller-local DRAINING mode

`runRepoWorkWave()` is already the active-command reconciliation loop.

Add a controller-local mode driven only by the passed AbortSignal:

```text
RUNNING
→ signal.abort
→ DRAINING
```

While DRAINING:

```text
DO NOT:
  boot planner
  run research promotion
  admit new Claims
  launch recoverable/new workers
  refill freed slots

DO:
  await/collect already-running local execution settlements
  consume PARKED vs ABORTED results
  land any durable terminal Closures
  release/observe Claims exactly
  reread durable truth
```

The AbortSignal is a hard launch/admission fence, not merely a mode bit checked once per reconciliation turn. Check it at every boundary that can create new work:

```text
before each recovered-worker launch
before `runWork()` creates a PENDING_WORKSPACE workspace
before research promotion starts
immediately after promoter return / before canonical persistence
before logical planner starts
immediately after planner return
before each candidate admission
immediately after worker return / before STOP or materialization+seal
immediately after challenger return / before proof persistence
before any refill launch after an awaited settlement
```

If promotion/planning rejects with `MH_DRAIN_REQUESTED`, `runRepoWorkWave()` consumes that typed cancellation as the transition into/continuation of DRAINING and keeps settling already-local work. It must not escape through the generic command error path.

The `running` map remains ephemeral and is emptied before return.

No `draining.json`, queue flag, World field, Claim flag, or scheduler state is persisted.

## Hard cut 6 — controlled drain never kills foreign execution

A second controller may legitimately hold a live workspace lease for another Claim.

Drain authority is process-local.

Therefore:

```text
lease.pid == draining process pid
→ local lease must be gone before drain completes

lease belongs to live foreign controller
→ leave untouched
→ remains RUNNING_ELSEWHERE
```

Do not add cross-process kill, lease stealing, repository-global stop-the-world, or process discovery beyond current exact lease ownership.

The kill-all acceptance test may launch multiple controllers and request drain for each; only then should repository-global live executor count reach zero.

## Hard cut 7 — prove local quiescence mechanically, without a durable drain record

Add a read-only custody helper that can enumerate/validate workspace execution leases and answer:

```text
leases owned by pid X
```

At drain completion require:

```text
local running promise set is empty
AND
no validated workspace execution lease has pid == process.pid
AND
all aborted local Claim Closures have been landed/released
```

Because `runEphemeralStructuredModel()` only returns/rejects after child close, no separate persistent model-process registry is required.

This is a proof at shutdown time, not new authority state.

Telemetry may record non-authoritative drain counts/timing if useful, but execution correctness must not depend on telemetry persistence.

## Hard cut 8 — ATTEMPT_ABORTED must stop masquerading as a hard blocker in planner context

Current derived semantics map no-result execution interruption to `BLOCKED` in more than one place:

```text
repo-planner-input.js
ATTEMPT_ABORTED / no work result
→ BLOCKED

repo-outcome-landing.js
workResult === null
→ state BLOCKED

repo-work-wave.js
BLOCKED
→ hardBlocked aggregation
```

That was tolerable before intentional drain, but it is semantically wrong for controlled interruption and questionable for crash interruption too.

Hard cut the complete derived classification to:

```text
ATTEMPT_ABORTED
→ EXECUTION_ABORTED
```

Meaning:

```text
this admitted attempt produced no durable product result
```

It does **not** mean:

```text
Outcome impossible
hard constraint established
owner authority needed
```

Project `EXECUTION_ABORTED` consistently through:

```text
landOutcomeClosure() result
reconciliation outcomeStates
aggregate repo-wave result logic
planner unresolved handoff
normal machine/human interpretation where applicable
```

`EXECUTION_ABORTED` counts with interruption/replan semantics, never with `hardBlocked`. It may contribute to an overall `REPLAN_REQUIRED`/continuation-needed result, but never establishes `BLOCKED` by itself.

Add `EXECUTION_ABORTED` to the planner's unresolved handoff projection and planning laws:

> An aborted execution is interruption evidence only; re-evaluate the Outcome from current objective and truth.

Do not change World transition semantics: `ATTEMPT_ABORTED` remains the existing linear authority transition that preserves World/product commit and releases the Claim.

No new forward-motion proof is needed because the abort is controller/process evidence, not a worker claim of terminality.

## Hard cut 9 — signal handling lives at process entry, not as a public lifecycle command

Normal CLI remains:

```text
meta-harness "<objective>"
meta-harness
```

No:

```text
meta-harness drain
meta-harness wake
--drain
--park
```

At the executable boundary, install temporary **one-shot** cooperative handlers around active normal work:

```text
first SIGINT / SIGTERM
→ remove both cooperative SIGINT + SIGTERM listeners
→ AbortController.abort()
→ let controlled drain complete

subsequent OS termination signal
→ no cooperative handler remains to swallow it
→ ordinary/default forced process termination is available
```

Do not implement the first signal with permanent `process.on()` handlers that remain installed throughout drain; on POSIX that would suppress Node's default signal exit and make the stated second-signal escape false.

Tests and library callers may inject an AbortSignal directly without sending OS signals.

`runWork()` / `runRepoWorkWave()` may return one non-durable internal drain-complete sentinel/result to the command layer after all required parking/abort/landing/quiescence work finishes. That control result is process-local only: it is not a new Outcome, Claim, Closure, workspace state, schema lineage, or persisted lifecycle record. `runAutomatic()` / `commandWork()` recognize it before normal outcome rendering so a deliberate drain is never reported as `Blocked` or `Replan` merely because ACTIVE work remains resumable.

Human output after a completed first-signal drain should remain concise, e.g.:

```text
Stopped safely — continuation is automatic next time.
```

Do not expose Claim/workspace/session IDs.

Use conventional signal exit semantics where practical; exact shell exit code is not authority.

## Hard cut 10 — controller-only mechanical work may finish its current atomic step

DRAIN's purpose is model/session disposability and safe authority handoff, not violent interruption of short controller transactions.

Do not attempt to asynchronously kill:

```text
World CAS
Git integration commit
structural SAW filesystem scan
retained proof command already executing synchronously
atomic create-only persistence
```

Instead:

- stop starting new expensive/model work once drain is observed;
- let the current short mechanical/atomic operation reach its existing consistency boundary;
- then park/land/release as appropriate.

Do not invent rollback protocols for already-safe controller transactions.

## Hard cut 11 — WAKE is existing recovery, not a second implementation

After a fully drained process exits, a fresh ordinary invocation does exactly what Phase 6 already requires:

```text
ensure current product head
→ drain terminal Closures first
→ recover active Claims
→ PENDING_WORKSPACE Claim/session remains executable without prior workspace custody
→ active BASELINE/SEALED_CANDIDATE/WORKER_STOP with no live lease becomes executable
→ start recoverable commitments before planning
→ planner only for remaining capacity/current objective epoch
```

No old process memory, signal history, model session, planner conversation, or drain record may be required.

For an intentionally aborted no-boundary Claim:

```text
ATTEMPT_ABORTED transition already released it
→ fresh planner sees EXECUTION_ABORTED handoff
→ may re-propose useful work from current objective/World
```

## Hard cut 12 — do not solve the Phase-9 Codex installation issue here

The current live-planner closure blocker is external model-runtime health.

This slice must not add:

```text
Codex cache deletion
Codex auto-update/install
CODEX_HOME migration
model-provider fallback
second evaluator
bundled Codex binary
runtime plugin interface
```

If supported real use later shows Meta-Harness must qualify multiple concrete runtime installations before starting work, that can justify a narrow runtime-health slice. One broken local installation encountered during an opt-in eval is not sufficient warrant for a provider/runtime framework.

## Product-path effect

Before:

```text
process/model death
→ crash recovery eventually reconstructs what survived
```

After:

```text
intentional first signal
→ stop new authority creation
→ kill local ephemeral model sessions
→ preserve exact recoverable Claim/workspace boundaries
→ abort/release only no-boundary attempts
→ zero local leases
→ process exit

fresh normal invocation
→ durable truth only
→ resume / replan automatically
```

This proves disposability rather than merely surviving accidents.

## Acceptance suite

### 1. Planner dies cleanly before Claim

Logical planner is blocked mid-model call.
Abort signal fires.

Expected:

```text
planner child terminated
no Claim created
no durable planner output required
no workspace lease exists
```

Fresh normal invocation may plan the same unchanged epoch again.

### 2. Research promoter dies cleanly before canonicalization

Promotion model is blocked on unseen committed research.
Abort signal fires.

Expected:

```text
model child terminated
no malformed/partial canonical research-promotion object
already-canonical promotions preserved
```

WAKE may retry exact missing content.

### 3. Baseline Claim parks before AttemptEntry

Claim/session/workspace is ACTIVE but coding AttemptEntry has not yet been issued.
Drain fires.

Expected:

```text
Claim remains active
workspace remains ACTIVE same generation
no Closure
lease released
```

WAKE starts that exact generation.

### 4. Mid-worker no-boundary attempt aborts honestly

Worker model has consumed an AttemptEntry but has returned no durable candidate/STOP.
Drain fires.

Expected:

```text
worker child terminated
workspace boundary rechecked
workspace terminalized as intentionally abandoned execution custody
no-result Closure durable
ATTEMPT_ABORTED lands
Claim released
```

The same generation is never replayed.

### 5. Aborted attempt is not planner hard-block evidence

After scenario 4, fresh planner input contains:

```text
disposition = EXECUTION_ABORTED
```

not `BLOCKED`, `OWNER_REQUIRED`, or a fabricated hard constraint.

Planner may re-propose the Outcome if current objective/truth still support positive value.

### 6. Sealed candidate parks without worker replay

Candidate seal is durable and current.
Drain fires before validation/BANK.

Expected:

```text
Claim active
workspace ACTIVE
lease released
no terminal Closure
```

WAKE resumes at validation from the same seal and worker invocation count does not increase.

### 7. Durable worker STOP parks while challenger dies

Worker STOP is persisted; forward-motion challenger is live.
Drain fires.

Expected:

```text
challenger child terminated
no fallback REPLAN_REQUIRED proof synthesized from drain
STOP remains exact
Claim/workspace remain ACTIVE
lease released
```

WAKE reruns the one challenger.

### 8. Terminal Closure is not stranded by drain

Worker already reached durable terminal Closure when drain is requested.

Expected:

```text
ordinary Closure landing completes
Claim releases
product/World semantics remain existing behavior
```

### 9. Multiple local workers drain independently

A has SEALED_CANDIDATE.
B is mid-worker with no durable output.
C has WORKER_STOP + live challenger.

Drain all.

Expected:

```text
A parked
B aborted/released
C parked
all local model children terminated
all local leases released
```

No sibling is misclassified from another sibling's state.

### 10. Foreign controller is untouched

Another live controller owns Claim D lease.
This controller drains.

Expected:

```text
D remains RUNNING_ELSEWHERE
foreign lease unchanged
no process kill attempted
```

### 11. Local zero-lease proof

After drain result returns:

```text
validated leases owned by draining PID == []
```

No stale local lease is left for WAKE to guess about.

### 12. Kill-all proof

Start several controllers plus worker/planner/challenger/promoter/product-proof-compiler model processes under test custody.
Request controlled drain on every controller.

Expected after all return:

```text
zero model subprocesses from those controllers
zero live workspace execution leases
no owner narration required
```

Then start a fresh process and continue from durable state only.

### 13. First signal is cooperative; no new admission occurs afterward

Abort while capacity is free and another planner opportunity exists.

Expected:

```text
planner boot/admission count after drain request == 0
```

Already-visible Claims retain their existing authority semantics.

### 14. Second signal is a real OS escape hatch

Process-entry regression proves:

```text
first signal
→ cooperative listeners are removed
→ drain begins

controller is then held in a bounded mechanical operation
second SIGINT / SIGTERM
→ process terminates instead of waiting for cooperative drain
```

Do not build a signal supervisor framework or configurable drain timeout in this slice.

### 15. Owner/source checkout stays untouched

Controlled drain/wake does not mutate owner checkout branch/HEAD/index/tracked dirt/untracked bytes.

### 16. No persistent drain lifecycle artifacts

After repeated drain/wake cycles, assert there is no:

```text
drain-state
parked-work queue
wake token
shutdown ledger
executor registry database
```

Durable continuity is existing Outcome/Claim/session/workspace/Closure/World evidence only.

### 17. Generic failures remain fail-closed

A non-drain worker/controller error still takes the existing generic rejection/terminalization path. The new recoverable PARKED behavior is reachable only from the explicit controlled AbortSignal.

### 18. Phase 1–9 deterministic regressions remain green

Outcome/Claim races, forward motion, linear product head, event-driven refill, research promotion, structural SAW, objective revision races, neutral planner instruction/data layering, and capacity-as-ceiling semantics remain unchanged.

### 19. Phase-9 real planner eval remains separate evidence

The existing Phase-9 opt-in real planner A/B/C `pass^3` eval should still run on a healthy supported Codex installation and remains required for Phase-9 behavioral closure.

Phase 10 does not count as evidence for Phase-9 planner behavior.

### 20. Pre-aborted signal spawns nothing

Call each structured-model path with an already-aborted signal.

Expected:

```text
planner/worker/challenger/promoter/product-proof-compiler child spawn count == 0
MH_DRAIN_REQUESTED returned through the controlled path
```

No temp output is interpreted as model failure.

### 21. Post-model pre-authority races admit nothing

Deterministically fire drain after a planner/promoter model result exists in memory but before its durable boundary.

Expected:

```text
planner result → zero new Claims
promoter result → zero new canonical promotions
```

Already-canonical evidence and already-visible Claims remain unchanged.

### 22. Drain completion is not rendered as product failure

Exercise both repo-wave and direct-work command surfaces through a recoverable controlled drain.

Expected:

```text
concise safe-stop human output
no Blocked/Replan label caused solely by drain
no persisted drain result/state
```

Ordinary non-drain failures keep their existing rendering and exit behavior.

### 23. Product-proof compiler uses the single cancellation membrane

Run non-repo-planner owner-goal work while the model-authored product-proof compiler is live, then request drain.

Expected:

```text
no bespoke Codex spawn path remains
proof-compiler child terminates through runEphemeralStructuredModel()
child close observed before MH_DRAIN_REQUESTED settles
no GAP product-proof spec manufactured from drain
no work session created from interrupted compiler output
```

Ordinary proof-compiler failure still uses the existing honest GAP behavior.

### 24. Worker post-return fence prevents durableization

Return a valid typed worker result, fire drain deterministically before STOP recording/materialization.

Expected:

```text
STOP result → no worker-stop persisted
operations result → no operation materialized / no candidate sealed
AttemptEntry already exists
→ no-result Closure
→ ATTEMPT_ABORTED
→ EXECUTION_ABORTED
→ Claim released
```

Returned model bytes remain ephemeral.

### 25. Challenger post-return fence preserves worker STOP

Return a valid challenger result, fire drain before `recordForwardMotionProof()`.

Expected:

```text
no forward-motion proof persisted
no fallback REPLAN_REQUIRED synthesized
existing worker STOP unchanged
Claim/workspace remain recoverable
WAKE reruns challenger
```

### 26. PENDING_WORKSPACE parks without creating custody

Admit a Claim/session, keep it at `PENDING_WORKSPACE`, and provide an already-aborted signal to `runWork()`.

Expected:

```text
no verifier/model setup requiring execution begins
no worktree/workspace created
no execution lease acquired
no AttemptEntry consumed
Claim/session remain active
internal PARKED settlement only
```

### 27. First termination cause wins

Race DRAIN against TIMEOUT and OUTPUT_CAP in both orders.

Expected:

```text
TIMEOUT first then DRAIN → timeout code
DRAIN first then TIMEOUT → MH_DRAIN_REQUESTED
OUTPUT_CAP first then DRAIN → output-cap code
DRAIN first then OUTPUT_CAP → MH_DRAIN_REQUESTED
```

Only the winning cause triggers process-tree termination; all cases settle after child close.

### 28. ATTEMPT_ABORTED is nowhere derived as hard BLOCKED

Land a no-result Closure through normal reconciliation after an interrupted generation.

Expected:

```text
World transition cause = ATTEMPT_ABORTED
landing state = EXECUTION_ABORTED
outcomeStates = EXECUTION_ABORTED
hardBlocked count unchanged
planner handoff = EXECUTION_ABORTED
aggregate semantics treat it as interruption/replan, not hard block
```

No World/schema migration is introduced.

## Likely implementation surface

Primary shared cancellation:

```text
lib/ephemeral-structured-model.js
  AbortSignal
  first-cause terminationCause
  typed MH_DRAIN_REQUESTED
  child-close-before-reject law
```

Model callers:

```text
lib/repo-logical-planner.js
lib/repo-research-promotion.js
lib/coding-worker.js
lib/work-forward-motion.js
lib/work-proof-compiler.js
  delete bespoke model spawn
  reuse structured-model helper
  drain propagates instead of GAP fallback
```

Execution/reconciliation:

```text
lib/work-loop.js
  pre-workspace abort fence for PENDING_WORKSPACE
  drain-aware safe-boundary classifier
  post-worker-result durableization fence
  post-challenger-result durableization fence
  PARKED internal settlement
  controlled no-boundary abort path

lib/repo-work-wave.js
  controller-local DRAINING mode
  no new plan/admit/launch after abort
  await/resolve local running set
  land abort Closures before return

lib/repo-outcome-landing.js
lib/repo-work-wave.js
lib/repo-planner-input.js
lib/commands/work.js
  ATTEMPT_ABORTED → EXECUTION_ABORTED derived semantics end-to-end

lib/workspace-custody.js
  read-only lease enumeration / local-pid quiescence assertion
```

Process boundary:

```text
bin/meta-harness.js
  one-shot first-signal AbortController
  remove cooperative handlers before draining
  subsequent signal force escape

lib/commands/work.js
  thread signal through normal work + proof compilation
  drain-complete control rendering
```

Prefer not to change:

```text
Outcome schema
Claim schema
work-session/v7
workspace-custody/v1 state enum
world-transition/v2
world-head/v2
product integration / structural SAW
owner-objective-state/v1
planner candidate schema
```

## Expected focused tests

New:

```text
tests/controlled-drain-wake.test.js
tests/ephemeral-structured-model-cancel.test.js
tests/work-proof-compiler-drain.test.js
```

Likely retained/expanded:

```text
tests/work-loop.test.js
tests/parallel-outcome-progress.test.js
tests/logical-planner-autodispatch.test.js
tests/forward-motion-proof.test.js
tests/research-promotion.test.js
tests/execution-permit.test.js
tests/repo-outcome-landing.test.js
tests/cli-work.test.js
```

Then run the repository wrapper topology, module loads, `npm pack --dry-run --ignore-scripts`, and `git diff --check`, reporting DevSpace transport/timeout ceilings separately from repository test verdicts as in prior slices.

## Deliberately deferred

```text
Phase 7B worker ContextCompiler
Phase 8B semantic reviewer
Codex install/cache repair
runtime/provider abstraction
model fallback routing
persistent drain state
public drain/wake commands
cross-process kill-all service
executor registry database
checkpointing model hidden state
planner conversation resume
worker conversation resume
remote/multi-host drain
automatic publication
plugin framework
```

## Roadmap consequence

Current custody is now:

```text
Phase 9 — Owner-objective continuity
  banked at 5fbf7b8
  deterministic implementation green
  live real-planner A/B/C pass^3 remains a separate behavioral-evidence item

Phase 10 — Controlled DRAIN / ordinary WAKE
  banked at 724204d
  deterministic closure implemented

Phase 11 — Narrow ports + Harness Darwinism
  active slice is DIRECT_ENTRY_AUTHORITY_MEMBRANE_1 through the stable ACP v1 host seam
  ChatGPT/DevSpace direct entry remains unsupported because it lacks a pre-model raw-input seam
  ACP membrane implementation is locally green and not yet banked
```

Phase-10 architecture remains locked:

> **DRAIN is a one-shot cancellation fence over controller-owned live activity. Every model process crosses one cancellable process boundary; every model result remains disposable until the controller durableizes it. `PENDING_WORKSPACE`, `BASELINE`, candidate seal, and worker STOP preserve the Claim; an entered attempt with no durable result becomes internal `INTERRUPTED_AFTER_ENTRY` → durable `ATTEMPT_ABORTED` → derived `EXECUTION_ABORTED`. Drain completes with zero controller-owned live activity or leases, while recoverable Claims remain for ordinary WAKE.**

## Phase 11 candidate — DIRECT_ENTRY_AUTHORITY_MEMBRANE_1

### Diagnosis

The mediated repository planner does not need another intent or governance redesign.

For a planner-enabled repository, the normal product entry already takes the literal owner result, stores it through `replaceOwnerObjectiveState(...)`, and enters the existing `REPO_WAVE` path. The planner already treats repository-local `Next`, `Decision needed`, `Phase`, `Review`, `SAW`, `Gate`, status, and `AGENTS` prose as repository data rather than routing authority. Managed/planner mode already has one deterministic predicate: `.meta-harness/repo-charter.json` is a regular non-symlink file.

The remaining defect is outside that mediated path:

> **A direct coding host can become a second mutation authority before the owner request crosses the existing Meta-Harness product entry.**

Do not build an intent bridge. Build one mutation choke point.

### Product result

```text
direct supported coding surface
        ↓
is this a Meta-Harness-managed repository?
        │
        ├─ no  → host behaves normally
        │
        └─ yes → preserve exact owner utterance
                  ↓
                existing normal Meta-Harness product entry
                  ↓
                owner-objective state
                  ↓
                existing planner / Claim / worker path

managed repository
→ direct host mutation is unavailable
```

Observable result:

> **A managed Meta-Harness repository cannot accidentally acquire a second direct mutation authority merely because the owner entered through another coding surface.**

### Authority membrane law

A direct coding surface may be a front door to Meta-Harness, but it is not a second executor.

For a managed repository, direct-host authority is **default deny by capability**:

```text
explicitly proven read-only capabilities
  read / search / inspect only
→ may remain exposed

one Meta-Harness ingress
→ may remain exposed

all other repository / Git / workspace / publication capabilities
  file mutation
  rename / move
  mutating shell
  Git index / refs / branch mutation
  commit / push / publication custody
  worktree creation / removal / topology mutation
  .meta-harness control-state mutation
  unknown or newly added host capabilities
→ absent or hard-denied by default

owner asks for product work
→ exact owner bytes enter the existing Meta-Harness product path

host cannot establish the capability boundary
→ zero direct fallback mutation
→ direct surface is outside Meta-Harness execution authority
```

The first adapter names its tiny allowed surface explicitly; there is no generic tool-effect ontology. No prompt-precedence classifier or repository-governance ontology is part of the authority boundary.

Enforcement preference:

```text
capability not exposed
→ deterministic pre-action hard deny
→ OS / filesystem sandbox backstop
→ never prompt-only guidance, LLM risk classification, or reviewer opinion
```

The wrong operation should be unavailable rather than merely discouraged.

### Hard cuts

Do not add:

```text
second planner
second worker
second Claim mechanism
second execution-custody system
objective translation/schema
repository-governance classifier
Reviewer-C service or routine reviewer phase
per-host/provider framework
persistent bridge state
write-enabled generic MCP expansion
global agent configuration mutation
target-repository AGENTS.md rewrite
direct edit fallback when mediated entry is unavailable
```

The existing `meta-harness work` path remains the execution product.

### Host seams — both must be proved independently

The first supported direct-entry host needs two orthogonal capabilities:

```text
A. raw owner-input seam
   receive the exact owner bytes before agent interpretation
   and hand those bytes to ordinary Meta-Harness work

B. capability seam
   remove or deterministically deny every direct repository / Git / workspace
   mutation capability before execution begins
```

A mutation gate alone prevents damage but does not prove that the exact owner objective crossed the membrane. A raw-input hook alone preserves intent but still leaves a second executor alive. Both are required.

If both are proved, implement only that smallest host-specific membrane.

If either is absent, do not compensate with another prompt, objective rewrite, governance classifier, or direct fallback. Record that direct surface as outside Meta-Harness execution authority until the missing host seam exists.

#### First host selection — ACP stable v1 — 2026-08-20

The observed ChatGPT/DevSpace connector still does **not** expose a pre-model raw-owner-input interception primitive, so that direct surface remains outside Meta-Harness execution authority. No prompt convention or fallback mutation is added there.

The stable Agent Client Protocol v1 surface provides the two required seams without adding another executor:

```text
A. raw owner-input seam
session/prompt carries the owner's text into the ACP agent before any Meta-Harness model/planner interpretation

B. capability seam
the ACP agent advertises no mutation capabilities, rejects MCP servers and alternate directories,
and never issues client requests for filesystem, terminal, Git, or publication effects
```

The first host-specific membrane is therefore intentionally small:

```text
meta-harness-acp
→ bind one process to one exact managed repository root
→ accept exactly one non-empty text block per prompt without trimming/normalizing/concatenating
→ pass those exact bytes to runAutomaticProductResult(...)
→ let existing owner-objective / planner / Claim / worker authority execute the result
→ emit only ACP session/update text notifications
→ keep ACP session IDs transport-local and ephemeral
→ map session/cancel into the existing Phase-10 AbortSignal drain path
```

Rejected at the membrane:

```text
unmanaged repository
repository subdirectory instead of the exact root
second repository root in the same ACP process
MCP servers
additional directories
multi-block or non-text prompt shapes
unknown transport sessions
```

This is an ACP adapter, not a generic host/provider framework. ChatGPT/DevSpace remains a substrate stop; ACP is the first mechanically provable direct-entry host.

### Acceptance — four observations only

1. **Capture regression** — a Quant-like managed repository containing imperative SAW, Review, Decision-needed, phase, and status prose receives the exact direct owner request through the host. Meta-Harness, not the host agent, chooses the work.
2. **Bypass regression** — while inside a managed repository, attempted direct-host action cannot alter repository authority state outside Meta-Harness: worktree bytes, Git index/refs/branches, worktree topology, `.meta-harness` control state, or publication/push custody. Unknown or newly added host capabilities fail closed.
3. **Unavailable seam** — when the host cannot establish the membrane or enter the normal Meta-Harness path, it performs zero direct fallback mutation.
4. **Zero-work case** — imperative governance prose with no positive-value lawful Outcome still produces zero fresh Outcomes.

### Controlled comparison

Run the first demonstrated host/repository fixture with:

```text
same model
same repository
same owner request

current direct entry
vs
DIRECT_ENTRY_AUTHORITY_MEMBRANE_1
```

Measure:

```text
owner interventions
governance-only work
time to first useful evidence
false hard blocks
direct out-of-membrane mutations
```

Keep the experiment only if the membrane materially improves the direct-entry journey without creating a second execution system.

### Explicitly outside this slice

The W6 per-arm irreversible-eligibility case remains a one-time falsification probe against today's mediated planner, not part of direct-entry architecture.

If the mediated planner passes W6, delete it from this slice. If it independently fails, that evidence may warrant a separate tiny law:

> **Irreversible eligibility is evaluated per independently consumable evidence/custody unit; parent initiative authority is not transitive.**

Likewise, scientific-constraint preservation remains a planner regression. The membrane does not interpret scientific constraints; it only ensures the request reaches the planner that already does.

## Stop boundary

**Phase 10 is implemented and banked at `724204d`. The stale planning-only sentence is retired.**

**Phase 11 `DIRECT_ENTRY_AUTHORITY_MEMBRANE_1` is implemented locally for stable ACP v1 and remains unbanked. The ChatGPT/DevSpace direct surface still stops with zero fallback mutation because it lacks the raw-input seam; ACP is the separate supported host experiment that mechanically supplies both seams. Focused ACP/package/authority and adjacent owner-objective/planner validation are green; repository-wide test-run transport is currently failing externally before a trustworthy aggregate result is returned.**

Do not mutate the global/local Codex installation to unblock Phase-9 evidence as part of this planning patch.

`docs/product/decision-log.md`, `lessons.md`, unrelated pre-existing dirty/untracked files, and runtime source files remain outside this patch.
