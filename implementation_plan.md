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
  DIRECT_ENTRY_AUTHORITY_MEMBRANE_1 ACP runtime is already banked in e193bce
  remaining work is closure-truth reconciliation only
  ChatGPT/DevSpace direct entry is a killed substrate route after HOST_PREMODEL_PRIMITIVE_UNAVAILABLE
  no DevSpace continuation is active unless a new host primitive is externally observed
```

Phase-10 architecture remains locked:

> **DRAIN is a one-shot cancellation fence over controller-owned live activity. Every model process crosses one cancellable process boundary; every model result remains disposable until the controller durableizes it. `PENDING_WORKSPACE`, `BASELINE`, candidate seal, and worker STOP preserve the Claim; an entered attempt with no durable result becomes internal `INTERRUPTED_AFTER_ENTRY` → durable `ATTEMPT_ABORTED` → derived `EXECUTION_ABORTED`. Drain completes with zero controller-owned live activity or leases, while recoverable Claims remain for ordinary WAKE.**

## Phase 11 / P0 recut — DEVSPACE_PREMODEL_OWNER_INGRESS_1

### Stable baseline

The mediated Meta-Harness product path is not the remaining unknown. Owner-objective continuity, planner/Outcome/Claim authority, disposable execution, controlled drain/wake, and exact product landing already exist. The stable ACP v1 adapter is the current concrete reference that the desired topology works when a host exposes both seams: owner input arrives before Meta-Harness model interpretation, and the host adapter exposes no second mutation authority.

The remaining unsupported surface is direct ChatGPT/DevSpace:

> **The host has not mechanically proved that the exact current owner message can be captured before any model invocation.**

`E:\code\meta-harness` owns the Meta-Harness side and the ACP adapter. It does **not** currently expose the DevSpace ChatGPT request path that would have to enforce this ordering. That repository boundary is load-bearing: R1 must not compensate for a missing host primitive by adding bridge code inside Meta-Harness.

### P0 thesis

A fresh ChatGPT/DevSpace direct conversation is unsupported until the host can establish both properties:

```text
1. exact owner-input capture completes before model invocation
2. direct mutation authority can be removed/default-denied before execution
```

R1 intentionally tested only the first property because failure there is sufficient to kill the direct DevSpace journey.

The substrate question was:

> **Can the DevSpace host mechanically deliver the exact actual owner message to a pre-model callback whose successful completion is a hard prerequisite to model invocation?**

R1 has now answered **no** with `HOST_PREMODEL_PRIMITIVE_UNAVAILABLE`. That result is programme-changing: direct ChatGPT/DevSpace continuation is killed rather than followed by an independent capability-membrane proof. The second host property remains a future reopening criterion, not a standalone engineering programme.

Do not run `DEVSPACE_CAPABILITY_MEMBRANE_PROOF_1`, do not build the membrane speculatively, and do not search for a bridge around the missing lifecycle seam. Reopen the combined DevSpace path only after the host itself exposes a mechanically enforceable pre-model owner-input primitive.

The next executable product action is instead to finish and bank the already-proven ACP supported entry. This planning patch stops for re-audit before that closure execution begins.

## R1 — host substrate proof

### Product result

DevSpace proves one host-native pre-model owner-input primitive:

```text
actual owner message event
        ↓
host receives exact text
        ↓
PRE_MODEL_OWNER_INPUT(exact text)
        ↓
callback completes successfully
        ↓
only then may model invocation begin
```

R1 deliberately does **not**:

```text
detect Meta-Harness-managed repositories
change host tool permissions
route into runAutomaticProductResult(...)
persist owner-input/v1
create Objective / Outcome / Claim / workspace state
promote host/session correlation into product authority
solve cancellation or multi-tab scheduling
```

This is a substrate proof, not the first eighth of a finished membrane.

### Hard prerequisite — real host ownership surface

Locate the earliest host-owned point where the actual submitted owner text exists and the later point where model invocation becomes possible.

If the available DevSpace/ChatGPT host source or hook surface cannot be modified or cannot enforce a hard prerequisite between those two points, terminate R1 with:

```text
HOST_PREMODEL_PRIMITIVE_UNAVAILABLE
```

That is a successful kill result for the spike.

On this result:

```text
ChatGPT/DevSpace direct entry remains unsupported
no connector workaround
no "call Meta-Harness first" prompt convention
no Meta-Harness intent bridge
no new executor/provider/framework
no fallback direct mutation path
```

Do not write Meta-Harness runtime code merely to make the unsupported host look integrated.

### R1 engineering sequence

1. **Ordering sentinel.** Instrument only the real host request path. Prove model startup is structurally impossible until the pre-model owner callback has returned success. "Usually first" or timestamp ordering is insufficient.
2. **Inert callback.** Add the smallest host-native callback/event necessary to receive the actual owner-authored text. It observes/delivers only; it does not route product work or alter permissions.
3. **Fidelity corpus.** Exercise exact host-delivered text across leading/trailing spaces, blank lines, LF/CRLF cases at the defined host text boundary, Unicode, Chinese text, emoji, Markdown, nested code fences, quotes, JSON-looking strings, and instruction-like text.
4. **Provenance negatives.** Prove system text, model output, tool results, injected context, resumed transcript items, and sibling conversation content cannot produce the owner-input callback.

Use a deterministic digest only as proof instrumentation around the host text boundary. Do not introduce a durable `owner-input/v1` schema or make a model-facing component authoritative for what the owner typed.

### R1 acceptance — four bars only

```text
A. ORDERING

owner submits P
→ pre-model callback(P) completes successfully
→ only then model invocation is permitted


B. FIDELITY

exact host-delivered owner text bytes/text boundary
==
exact callback-delivered owner text bytes/text boundary

with deterministic digest equality over the same defined representation


C. PROVENANCE

only the actual owner-message event can produce the callback

system / model / tool / context / transcript / sibling-chat text
→ cannot impersonate owner input


D. HARD KILL + NO PRODUCT/AUTHORITY SIDE EFFECT

host cannot mechanically guarantee A-C
→ HOST_PREMODEL_PRIMITIVE_UNAVAILABLE
→ model integration work stops
→ no Meta-Harness bridge or fallback mutation is added
→ host-only probe/instrumentation is permitted, but the captured owner turn creates no repository/product/authority mutation
```

R1 does not require managed-repository semantics, a capability policy, concurrency/session correlation, cancellation, or end-to-end Meta-Harness execution. Those requirements are real, but they do not belong in the substrate question.

## Dormant future continuation — only after an externally observed DevSpace host change

This section is retained only as the architecture that would become eligible if a future DevSpace host exposes the missing pre-model primitive. It is **not** an active Round 2, capability-probe programme, or implementation authorization from the current repository state.

### Product result

```text
owner message
→ proven pre-model capture
→ deterministic managed-repository detection
→ default-deny direct-host mutation membrane
→ exact captured owner input
→ existing runAutomaticProductResult(...)
→ existing owner-objective / planner / Claim / worker path
```

For unmanaged repositories, normal host behavior remains outside Meta-Harness semantics.

For a managed repository, reuse the existing deterministic predicate:

```text
.meta-harness/repo-charter.json
is a regular file
and not a symlink
```

Detection is read-only. It must not initialize Meta-Harness, rewrite configuration, create a worktree, or alter `.meta-harness`.

### Capability membrane

The host exposes only:

```text
explicitly proven read/search/inspect capabilities
+ one exact Meta-Harness ingress
```

Everything else is absent or hard-denied before model execution:

```text
file mutation
rename / move
mutating shell
Git index / ref / branch mutation
commit / push / publication custody
worktree creation / removal / topology mutation
.meta-harness control-state mutation
unknown or newly added host capabilities
```

Prefer capability non-exposure, then deterministic pre-action denial, then OS/filesystem sandboxing as backstop. Prompt guidance, model classification, and reviewer opinion are not authority controls.

### Exact handoff

Pass the captured owner text unchanged into the already-existing normal Meta-Harness product entry. Do not add:

```text
intent schema
translation model
second planner
second Claim system
persistent bridge state
host-owned product identity
session-owned continuity
```

Host/session IDs remain ephemeral correlation only.

### Future combined-slice acceptance

If the missing host primitive is externally observed and the DevSpace route is explicitly reopened, ship the first complete direct journey only when all of these hold together:

1. exact pre-model owner capture from R1 remains true;
2. managed-repository detection is deterministic and side-effect free;
3. direct mutation capabilities are absent/default-denied before model execution;
4. exact captured owner input reaches `runAutomaticProductResult(...)` unchanged;
5. unavailable membrane or handoff produces zero direct fallback mutation;
6. a no-positive-value case still produces zero fresh Outcomes through the existing planner path.

## Robustness after the first complete journey

Do not front-load robustness into R1 unless the host implementation makes a property inseparable from the primitive itself.

After the first complete supported journey, harden only demonstrated host concerns:

```text
multiple fresh conversations / tabs
turn correlation
cancellation
duplicate/reordered delivery protection
fresh-session recovery from durable Meta-Harness truth
```

The invariants remain:

```text
host/session correlation is never Outcome / Claim / workspace authority
conversation continuity is never required for recovery
cancellation reuses existing DRAIN semantics where applicable
```

Do not run ACP/DevSpace conformance while DevSpace remains unsupported. Only after a future second host is actually supported and exposes duplicated semantics may the two real implementations be compared and a smallest common host port considered. Do not build a generic provider/plugin framework in advance.

## Hard cuts for the whole P0

Do not add:

```text
HostPort / ProviderPort framework before two hosts prove duplication
generic event bus
objective translation or second objective model
second planner / worker / Claim / execution-custody system
repository-governance classifier
universal hook/policy engine
session database or transcript persistence
write-enabled generic MCP expansion
global agent configuration mutation
target-repository AGENTS.md rewrite
prompt-only authority convention
direct edit fallback
```

Stable external references may inform topology, but not expand this P0: Copilot-style pre-prompt/pre-tool hooks validate the host-boundary shape; citation-backed memory is a reference for revalidation, not a new authority object; DeepSeek-style replaceability does not make kernel authority pluggable; MCP/ACP session handles remain transport/correlation rather than product work identity.

## R1 execution result — `HOST_PREMODEL_PRIMITIVE_UNAVAILABLE`

Re-audit passed and R1 was executed against the actual surfaces available to this ChatGPT/DevSpace session.

### Mechanical substrate finding

The complete exposed `DevSpace_Local` host surface has no operation that can intercept the **current actual owner-message event before this model invocation** or make successful callback completion a prerequisite to model startup.

The only fresh-Chat lifecycle operations are later than the required boundary:

```text
web_launch
→ create a fresh chatgpt.com conversation
→ submit supplied prompt
→ no pre-model callback or startup gate

web_connector_start
→ retain proof state
→ launch a fresh ChatGPT conversation with a fixed acceptance prompt
→ only after that launched conversation receives the challenge may web_connector_probe run

review_start
→ launch a fixed review packet into a fresh ChatGPT conversation
→ only after that conversation receives its prompt-only challenge may review_submit run
```

Those are launch/post-launch connector or review surfaces. They can prove that a model-created conversation can later discover/call DevSpace, but they cannot establish:

```text
actual owner message event
→ host callback completes
→ only then current model invocation becomes possible
```

The repository-owned source surface confirms the same boundary. `E:\code\meta-harness` contains the Meta-Harness runtime and ACP adapter, while a bounded source search finds no DevSpace ChatGPT request-path implementation or host lifecycle hook to instrument. The only pre-model references are product/status/plan statements describing the missing seam.

Therefore R1 cannot mechanically demonstrate A. ORDERING, and without the real owner-message event source it also cannot truthfully establish B. FIDELITY or C. PROVENANCE at that boundary.

### Required kill behavior

```text
HOST_PREMODEL_PRIMITIVE_UNAVAILABLE

ChatGPT/DevSpace direct entry remains unsupported
PASS continuation does not start
no managed-repo membrane implementation
no runAutomaticProductResult(...) bridge
no connector workaround
no "call Meta-Harness first" prompt convention
no new executor/provider/framework
no fallback direct mutation path
```

This is the intended successful kill result for the substrate spike, not a product failure to route around.

### Side-effect boundary

R1 performed capability/source inspection only. No owner turn was captured into product authority, and no Meta-Harness runtime, ACP adapter, tests, status/roadmap/product docs, repository authority state, Git index/ref/branch, or worktree topology was changed by R1. The accepted planning/result record remains the only edited R1 surface; unrelated pre-existing dirty/untracked owner state is preserved.

Phase 10 remains banked at `724204d`. Stable ACP v1 remains the locally implemented reference membrane and is unchanged. ChatGPT/DevSpace should be reconsidered only when the host itself exposes a mechanically enforceable pre-model owner-input primitive; that future host change is the evidence that would reopen the combined membrane + exact-handoff continuation.

Do not mutate the global/local Codex installation to unblock Phase-9 evidence as part of this result.

`docs/product/decision-log.md`, `lessons.md`, `.meta-harness/status.md`, roadmap/product docs, unrelated pre-existing dirty/untracked files, and runtime source files remain outside this R1 result patch.

## Round 2 recut — verify the already-banked ACP entry, repair closure truth, then stop

### Programme truth

Treat the two host results separately and do not leave the failed host psychologically open as active implementation work:

```text
ACP_HOST_MEMBRANE = WORKING / BANKED
DEVSPACE_HOST_MEMBRANE = SUBSTRATE_UNAVAILABLE
```

Git truth is authoritative here: stable ACP v1 runtime, tests, and package wiring are already committed in `e193bce` (`Integrate continuity work and planner endgame guard`). Round 2 must not restage or repackage that runtime merely because closure/status prose is stale.

`HOST_PREMODEL_PRIMITIVE_UNAVAILABLE` is sufficient to kill direct-DevSpace continuation. No independent DevSpace capability-membrane proof follows it. Negative substrate evidence is converted directly into saved engineering time.

### Product result

Round 2 repairs stale closure truth around an already-banked supported entry:

```text
ACP runtime already committed in e193bce
→ reuse or rerun only necessary validation
→ reconcile stale closure/status truth
→ commit only that bounded closure delta
→ STOP
```

Terminal product state:

```text
ACP direct entry = supported and banked
ChatGPT/DevSpace direct entry = unsupported, zero fallback mutation
no active host-abstraction or DevSpace successor slice
```

### Execution sequence after re-audit GO

1. **Freeze runtime scope.** Treat the ACP implementation in `e193bce` as already banked. No runtime redesign, no DevSpace work, and no new host abstraction.
2. **Reuse passed evidence whose input surface is unchanged.** The focused ACP/package/command/package-closure plus adjacent owner-objective/planner validation already recorded as green remains valid unless the closure correction changes its declared input surface.
3. **Run only the smallest repository-owned validation needed to confirm the already-banked ACP entry remains valid.** Treat DevSpace connector HTTP 502 transport as external evidence transport failure, not as a reason to redesign ACP or manufacture a second aggregate-test mechanism.
4. **Repair only stale closure/status truth.** Update the minimum documentation needed to state that ACP runtime is already committed and ChatGPT/DevSpace is substrate-unavailable.
5. **Bank only the closure delta.** The closure commit must not restage, rewrite, or absorb the already-committed ACP runtime unless validation discovers a real product defect requiring a separate repair. Preserve unrelated dirty owner state.
6. **Stop.** Do not activate a DevSpace successor. Reopen that route only on newly observed host capability evidence.

### Round 2 acceptance

Round 2 is complete when all of these are true together:

1. Git still shows the stable ACP v1 runtime as committed in `e193bce`, with no closure-only edit to ACP runtime/package/test files;
2. the stable ACP v1 direct-entry membrane remains mechanically narrow and routes exact ACP prompt text into the existing automatic product path;
3. the existing no-alternate-mutation guarantees and managed-repository restrictions remain green on the unchanged supported surface;
4. required repository-owned closure checks pass, with external DevSpace transport failures reported separately rather than converted into product failures;
5. product/status truth says ACP is supported and banked while ChatGPT/DevSpace is substrate-unavailable;
6. the closure commit contains only the bounded closure correction and does not absorb unrelated dirty/untracked owner state;
7. no `HostPort`, `ProviderPort`, generic policy layer, conformance programme, DevSpace bridge, prompt workaround, ACP v2 migration, or second executor is added.

If validation finds a real ACP runtime defect, stop treating this as a closure-only round and repair only that demonstrated defect under a separately explicit scope. Do not silently fold runtime changes into the closure commit.

### Explicit non-goals

```text
no ACP runtime restaging without a demonstrated defect
no DEVSPACE_CAPABILITY_MEMBRANE_PROOF_1
no second DevSpace substrate probe
no managed-DevSpace membrane implementation
no runAutomaticProductResult(...) DevSpace bridge
no SOTA/research expansion
no ACP v2 migration
no generic host abstraction
no generic policy DSL
no new review/evidence programme
no prompt-only authority workaround
```

A common host port remains unwarranted because there is still only one real supported implementation. The failed DevSpace substrate is evidence of absence, not a second implementation.

### Re-audit result

Round 2 is GO on this corrected closure-only scope. Execute the bounded validation/status reconciliation, commit only the closure delta, then stop.

## P0-R3 recut after architecture audit — DURABLE_EXTERNAL_PROPOSAL_CONTINUITY_1

### Re-audit corrections adopted

R3 remains one engineering round, but it no longer claims that durable external dispatch is the same thing as live worker execution and it no longer cuts the working owner path over before result fan-in exists.

The corrected programme split is:

```text
R3
→ external-dispatch architecture can be built, validated, and banked
→ one entered CODE_PROPOSE attempt can survive controller/host process loss on one external route
→ no external completion is inferred
→ normal production continue_meta_harness does NOT switch to that route yet

P1
→ challenged worker-result/v2 fan-in
→ same AttemptEntry can return to existing materialize → validate → proof → BANK → World
→ only then remove the internal cutover guard for the normal owner journey
```

Therefore distinguish:

```text
R3 external-dispatch architecture complete
!=
P0 owner journey complete
```

The owner journey is not complete while a successfully finished external worker can never return a result to Meta-Harness.

No public feature flag, user workflow toggle, or alternate owner command is added. The external proposal transport is an injected/internal host capability in R3 and is exercised by the complete R3 acceptance suite. P1 is the round that may connect that already-proven capability to the normal production `continue_meta_harness` path.

### Product result

For one already-entered Claim-bound `CODE_PROPOSE` attempt selected by the internal R3 transport injection, Meta-Harness can durably commit that exact attempt to one external proposal route **before** contacting DevSpace, release its process execution lease, and later recover the attempt without aborting or replaying it.

DevSpace idempotently binds the exact route to one restart-safe `meta-proposal-task/v1` and may ensure at most one process-local fresh-ChatGPT Activation for that task. Durable Meta truth says only that the attempt is externally open; Activation liveness remains an ephemeral host observation.

The corrected target is:

```text
Claim
→ WorkSession
→ exact workspace custody
→ live ExecutionPermit
→ AttemptEntry(CODE_PROPOSE)
→ proposal-worker-packet/v1
→ durable proposal-dispatch-intent/v1
→ EXTERNAL_OPEN
→ private DevSpace ensure operation
→ one retained meta-proposal-task/v1
→ zero or one process-local Activation
→ optional durable proposal-dispatch-receipt/v1 proving task binding only
```

R3 does **not** make the external route a completing product path. The normal owner DevSpace continuation keeps the existing synchronous/local-worker transport until P1 can return and settle `worker-result/v2`.

### Truth vocabulary — break the proposed `RUNNING_ELSEWHERE` reuse

Do not classify an externally dispatched attempt as `RUNNING_ELSEWHERE` merely because durable dispatch intent exists.

Keep the existing `RUNNING_ELSEWHERE` meaning for the case it can actually prove:

```text
ACTIVE workspace
+ validated live foreign Meta workspace execution lease
→ RUNNING_ELSEWHERE
```

Add a distinct durable recovery state:

```text
EXTERNAL_OPEN
```

Meaning exactly:

> This already-entered attempt is durably committed to one external proposal route. Do not abort it, replay it locally, or admit a duplicate Claim merely because no controller process lease is live.

It does **not** mean:

```text
worker is currently thinking
browser is alive
task is currently activated
worker finished
result exists
continuation is guaranteed to succeed
```

After R3 the important distinction is:

```text
durable task/route identity
!=
live Activation
```

Host reconciliation may observe a live Activation during the current process lifetime, but that observation never becomes durable product truth.

### Planner projection and Claim capacity

Add a truthful planner projection:

```text
EXTERNAL_OPEN
→ external_open
```

Do not project it as `running_elsewhere`.

The planning law is:

> `external_open` is an active committed Claim whose current proposal route is external and unresolved. It consumes Claim capacity but does not establish a blocker, result, or liveness claim. Independent free Claim capacity may still be planned and admitted.

The Claim remains the capacity authority. No external-task table, Activation count, or browser state participates in Claim admission.

### The dispatch intent is narrow durable continuation authority

The prior wording that dispatch intent is “not new coding authority” is too weak.

Once Meta exits, the process-owned ExecutionPermit lease is no longer current, yet the external child must be allowed to continue the already-entered proposal operation. Therefore `proposal-dispatch-intent/v1` is:

> **a derived, narrowly delegated continuation capability for this exact `CODE_PROPOSE` attempt only.**

It may authorize only the proposal-side behavior already inside the read-only worker membrane:

```text
read
search
list
reason about the sealed task
produce worker-result/v2 conceptually
```

It never grants:

```text
workspace mutation
Git mutation
materialization
validation
candidate seal
product proof
BANK
World transition
ExecutionClosure
Claim release
publication
new Outcome/Claim/session authority
```

The intent is derived while the live ExecutionPermit is current and must bind the exact current authority facts. After that derivation, the external worker continues under the durable delegated proposal capability, not under a fiction that the old process permit is still live.

### Factor worker semantics from authority projection

The current R2 packet path reuses `buildCodingPrompt()` with the full live ExecutionPermit projection. That is correct for a local worker but becomes misleading after the Meta process releases its lease.

Refactor prompt construction into:

```text
common worker semantics
+
authority projection
```

so the two paths are:

```text
local coding worker
→ common semantics
→ live ExecutionPermit projection

external proposal worker
→ same common semantics
→ durable external CODE_PROPOSE continuation projection
```

The common portion remains identical for:

```text
owner-authored product direction
task/result/journey/done condition
semantic projection
prior failure
allowed paths
controller-owned validation description
worker-result/v2 schema expectations
read-only mutation law
STOP law
```

The external authority paragraph must explicitly say that the originating ExecutionPermit is provenance for the delegation, not current process-owned authority. Do not expose the stale full ExecutionPermit projection as though its controller capabilities or lease are still live.

Avoid a digest cycle: the external prompt authority projection may contain stable session/workspace/generation/AttemptEntry facts, but must not require the final dispatch-intent digest or packet digest in order to compute the prompt that those records themselves bind.

### `proposal-dispatch-intent/v1` — persist before any host effect

Add a focused Meta module such as:

```text
lib/proposal-dispatch.js
```

Persist one create-only intent before contacting DevSpace.

Conceptually:

```json
{
  "schemaVersion": "proposal-dispatch-intent/v1",
  "sessionDigest": "sha256:...",
  "workspaceId": "...",
  "generation": 1,
  "attemptEntryDigest": "sha256:...",
  "permitDigest": "sha256:...",
  "packetDigest": "sha256:...",
  "baseline": {
    "head": "...",
    "treeOid": "...",
    "dirtyManifestDigest": "sha256:..."
  },
  "delegation": {
    "capability": "CODE_PROPOSE",
    "workspaceMutation": false,
    "controllerCompletionAuthority": false
  },
  "request": {
    "workspaceRoot": "...",
    "packet": {},
    "prompt": "...",
    "workerResultSchema": {}
  },
  "createdAt": "...",
  "intentDigest": "sha256:..."
}
```

The exact request is retained because after process death the old live permit cannot safely be reconstructed and re-projected as current authority.

Create-only equality/idempotence must be exact. A same-identity record with different bytes is corruption, not an update.

Once this intent exists:

```text
local worker fallback is forbidden for that AttemptEntry
another external packet is forbidden for that AttemptEntry
ordinary ENTERED_NO_SEAL abort inference is forbidden for that AttemptEntry
```

### `proposal-dispatch-receipt/v1` — prove task binding, never liveness

After DevSpace confirms the exact packet is bound to a retained proposal task, Meta may persist a create-only receipt:

```json
{
  "schemaVersion": "proposal-dispatch-receipt/v1",
  "intentDigest": "sha256:...",
  "packetDigest": "sha256:...",
  "taskId": "proposal_...",
  "taskDigest": "sha256:...",
  "acceptedAt": "...",
  "receiptDigest": "sha256:..."
}
```

Do not persist:

```text
state = RUNNING
activation = LIVE
browser = ACTIVE
worker = THINKING
```

The receipt proves only:

```text
exact packet accepted
exact retained task identity bound
```

An `ensureActivation()` response may include a process-local observation that an Activation was established for the caller, but that observation is not copied into durable Meta state as liveness truth.

### Crash windows and recovery law

The corrected recovery matrix is:

| Retained state | Next Meta interpretation | Host action when internal bridge exists |
| --- | --- | --- |
| Claim only, no workspace | normal execution | none |
| workspace baseline, no AttemptEntry | normal execution | none |
| AttemptEntry, no dispatch intent | existing `EXECUTION_ABORTED` recovery | none |
| valid intent, host never saw request | `EXTERNAL_OPEN` | retry exact retained request |
| task retained, Meta missed response | `EXTERNAL_OPEN` | same packet resolves same task |
| Activation launched, Meta died | `EXTERNAL_OPEN` | ensure reuses live Activation if observed |
| receipt persisted, bridge absent | `EXTERNAL_OPEN` | none; never local replay |
| DevSpace restarted, task retained | `EXTERNAL_OPEN` | ensure replacement Activation |
| worker may have naturally finished reasoning | still `EXTERNAL_OPEN` | no completion inference before P1 |

Therefore `recoverClaimCommitment()` becomes conceptually:

```text
ACTIVE workspace
│
├─ validated live foreign Meta process lease
│    → RUNNING_ELSEWHERE
│
├─ continuation != ENTERED_NO_SEAL
│    → existing recovery
│
└─ ENTERED_NO_SEAL
     │
     ├─ no valid proposal dispatch intent
     │    → existing EXECUTION_ABORTED recovery
     │
     └─ valid proposal dispatch intent
          → EXTERNAL_OPEN
```

External-dispatch validation must prove the same exact:

```text
session
Claim/Outcome origin
workspace
workspace generation
AttemptEntry
permit provenance digest
packet
baseline HEAD/tree/dirty manifest
current unchanged workspace bytes/index/HEAD
```

A corrupt, stale, substituted, broadened, or mismatched intent/receipt fails closed.

### DevSpace `ensureActivation()` — durable task identity, ephemeral Activation

Keep the R2 `MetaProposalWorkerController` and add one higher-level idempotent operation:

```text
ensureActivation(exact MetaProposalTaskInput)
```

Semantics:

```text
same exact packet already has retained task?
  yes → reuse task
  no  → seal exact task

process-local live Activation for task?
  yes → reuse it
  no  → start one fresh managed ChatGPT Activation

return task binding
+ current-call Activation establishment observation
```

Concurrent calls for the same packet converge on:

```text
one retained task
at most one live Activation in the owning process
```

`packetDigest` is the **one downstream DevSpace ensure/idempotency identity**. The task store, bridge request reconciliation, concurrent ensure path, lost-response recovery, and restart reconstruction all key the same external operation by this digest. Do not add a second dispatch request ID, activation request ID, or host-generated retry identity that could let one Meta packet fork into multiple retained operations.

After a DevSpace restart:

```text
retained task remains in SQLite
process-local Activation map is empty
ensureActivation(same packet)
→ replacement fresh Activation for same task
```

Do not add a durable browser/Activation lifecycle table, scheduler, mailbox, queue, or transcript registry.

### Mechanically enforce one DevSpace runtime per state directory

R3 requires:

> **Exactly one live DevSpace runtime owns a given DevSpace state directory at a time, and startup enforces that fact mechanically.**

Do not leave this as a deployment convention. Before the server can create or ensure any proposal Activation, acquire one exclusive state-directory runtime lock. Keep the mechanism smaller than a distributed lease system:

```text
DevSpace startup for stateDir X
→ atomically acquire runtime lock for X
→ retain owner PID + random process token

lock belongs to a live owner
→ refuse startup before any proposal task/Activation reconciliation

lock owner is demonstrably dead
→ reclaim stale lock safely
→ become the sole owner

clean shutdown
→ release only the lock whose token matches this process
```

The lock is process-custody evidence only. It is not product state, proposal-task state, an Activation lifecycle record, a scheduler, or a browser lease. A tiny create-exclusive lock file under the state directory is sufficient if stale-owner validation and token-checked release are exact on supported platforms.

Then the authority split stays small:

```text
task uniqueness
→ retained SQLite state keyed by packetDigest

Activation uniqueness
→ mechanically single owning DevSpace process

restart
→ old process gone / stale runtime lock reclaimed
→ new owner reconstructs an Activation from retained task identity
```

R3 does not support multiple live DevSpace server processes coordinating Activations against one persistence store. Reject the second runtime instead of building a cross-process Activation lease/mailbox protocol or cluster support.

### Private DevSpace↔Meta bridge

The one-operation ephemeral loopback bridge remains acceptable for R3.

A dedicated inherited child-process IPC channel may be used instead only if the existing Windows spawn path makes it strictly smaller in implementation. Do not create a separate investigation gate or block R3 on replacing the loopback design.

If loopback is retained, its invariant is:

```text
one parent continue operation lifetime
one exact operation: ensure proposal Activation
127.0.0.1 only
ephemeral port
unguessable process-local capability token
exact request schema and bounded size
no arbitrary command/path/browser/Git/review controls
listener closes with parent Meta invocation
closing listener does not revoke retained task or cancel launched Activation
```

Conceptual request:

```json
{
  "schemaVersion": "meta-proposal-ensure/v1",
  "workspaceRoot": "...",
  "packet": {},
  "prompt": "...",
  "workerResultSchema": {}
}
```

Conceptual response:

```json
{
  "schemaVersion": "meta-proposal-activation/v1",
  "packetDigest": "sha256:...",
  "taskId": "proposal_...",
  "taskDigest": "sha256:...",
  "activationEstablished": true
}
```

`activationEstablished` is a current-call observation only. It is never interpreted as durable completion or persisted as `RUNNING` truth.

### Never leak the bridge capability to a model

Controller transport environment and model subprocess environment must be split before any model process starts.

Conceptually:

```text
process environment
→ extract private DevSpace proposal host capability
→ remove URL/token/pipe identifiers
→ sanitized model environment
```

The sanitized environment is the only environment available to:

```text
logical planner
research promoter
product-proof compiler
forward-motion challenger
local coding worker
external worker launch prompt/tool environment where applicable
```

No model may discover or invoke the private host capability through environment inheritance.

### Reuse `runWork()` admission; return `EXTERNAL_OPEN` as a non-terminal controller control

Do not duplicate the existing worktree/session/permit/AttemptEntry admission path in `repo-work-wave.js`.

Extend the runner boundary only enough to provide the external runner the exact already-established controller facts it needs:

```text
repositoryPath
stateDirectory
workspace
workspaceLease
attemptBoundary
executionPermit
attemptEntry
```

The external runner sequence is:

```text
compile proposal-worker-packet/v1 with external authority projection
→ persist proposal-dispatch-intent/v1
→ attempt private ensureActivation(exact retained request)
→ persist task-binding receipt if returned
→ return internal EXTERNAL_OPEN control
```

If the host call fails or is interrupted **after intent is durable**:

```text
do not throw the attempt into generic controller rejection
do not recover it as EXECUTION_ABORTED
do not fall back to local coding worker
return/retain EXTERNAL_OPEN
```

`runWork()` must then:

1. re-check that workspace bytes/index/HEAD remain unchanged;
2. verify the intent belongs to the current session/workspace/generation/AttemptEntry and was derived from the current permit;
3. if a receipt exists, verify exact intent/packet/task binding;
4. not materialize;
5. not validate;
6. not create candidate seal/product proof/BANK;
7. not create ExecutionClosure;
8. not terminalize workspace custody;
9. return the non-terminal `EXTERNAL_OPEN` controller result;
10. release the process execution lease in the existing `finally`.

The workspace remains:

```text
ACTIVE
same generation
AttemptEntry entered
no candidate seal
no worker STOP
valid external dispatch intent
no live Meta process lease required
```

The ordinary local worker path remains semantically unchanged when it returns `worker-result/v2`.

### Reconcile an external-open route once per repo-work invocation

Recovery and host liveness are separate.

A valid external intent tells Meta:

```text
do not abort or replay this AttemptEntry
```

The private host answers only:

```text
ensure the disposable execution surface for this retained task exists now
```

When the internal R3 host capability is present, once per repo-work invocation:

```text
for each EXTERNAL_OPEN active Claim:
  call ensureActivation(exact retained intent request) once
```

Use a process-local set keyed by intent digest so the repository reconciliation loop does not repeatedly ensure the same task in one invocation.

Results remain simple:

```text
same process + live Activation
→ reuse

DevSpace restart
→ replacement Activation for same task

previous launch failure
→ retry exact route

same packet retained
→ same task

revoked/substituted task
→ fail closed
```

No polling, scheduler, transcript inspection, or completion inference is added.

### Production cutover guard — R3 must not break the working owner path

This is the main product correction.

In R3:

```text
internal/integration transport injection present
+ REPO_OUTCOME + CODE_PROPOSE
→ external proposal route may be exercised

normal production continue_meta_harness entry
→ does NOT inject/enable the external proposal route yet
→ existing local coding worker remains the completing path
```

Do not expose an environment feature flag, CLI flag, configuration knob, or user-facing toggle to bypass this guard.

The DevSpace bridge/controller can be real code and can be exercised end-to-end by R3 integration tests. What remains guarded is only the production decision to route ordinary owner work through a path that cannot yet return a result.

P1 may remove this guard only after its challenged result callback proves that the same external task/packet/AttemptEntry can feed a validated `worker-result/v2` back into the existing Meta pipeline.

Before P1 finalizes any owner-facing asynchronous `continue_meta_harness` suspension/result lifecycle, re-check the active ChatGPT MCP host for advertised `io.modelcontextprotocol/tasks` support. If native MCP Tasks is actually available end-to-end, evaluate its durable parent-facing task handle / later result channel before inventing a parallel custom polling protocol. This is a P1 research watchpoint only: R3 must not depend on Tasks support, and native parent-task support would not by itself replace the bounded child worker-result submission back into DevSpace.

### Controlled drain behavior

Controlled drain must respect the durable route commitment.

Before dispatch intent exists:

```text
existing entered-attempt drain/recovery law remains authoritative
```

After dispatch intent exists:

```text
SIGINT / cancellation / Meta process exit
→ release Meta-owned execution lease
→ keep Claim + ACTIVE workspace + AttemptEntry + intent
→ do not revoke proposal task
→ do not emit ExecutionClosure
→ do not locally replay
→ future internal reconciliation may re-ensure Activation
```

An in-flight bridge call may disappear with the parent process. That does not erase the durable external route.

### Expected Meta-Harness surface

Aim for the smallest truthful surface:

| File | R3 role |
| --- | --- |
| `lib/proposal-dispatch.js` **new** | create-only intent/receipt, exact validation, recovery lookup |
| `lib/devspace-proposal-host.js` **new** | private bridge client + capability extraction/sanitization |
| `lib/coding-worker.js` | factor common prompt semantics from local/external authority projection |
| `lib/proposal-worker-packet.js` | compile packet/prompt using external delegated authority, not stale live-permit prose |
| `lib/work-loop.js` | runner context + non-terminal `EXTERNAL_OPEN` settlement |
| `lib/repo-work-wave.js` | recovery classification, one-shot external reconciliation, Claim-capacity accounting |
| `lib/repo-planner-input.js` | `EXTERNAL_OPEN → external_open` projection |
| `lib/commands/work.js` | accept only internal host injection and sanitize model environment; no public toggle |
| `tests/proposal-dispatch.test.js` **new** | intent/receipt/authority/crash invariants |
| focused work-loop/repo-wave tests | external-open settlement, capacity, recovery, drain, production guard |
| security-focused env test | bridge capability never reaches a model subprocess |

Do not change planner candidate/Claim schemas, WorkSession identity, materializer, verifier, product proof, BANK, or World authority unless implementation uncovers a demonstrated incompatibility with the exact R3 invariant.

### Expected DevSpace surface

Continue from the accepted R2 proposal-task/controller lineage.

| File | R3 role |
| --- | --- |
| `src/meta-proposal-worker.ts` | idempotent `ensureActivation()` over retained task + process-local Activation, keyed by `packetDigest` |
| `src/meta-proposal-bridge.ts` **new** | one-operation authenticated loopback/IPC bridge |
| `src/state-dir-runtime-lock.ts` **new or equivalent focused module** | exclusive process ownership of one DevSpace state directory; stale-owner reclaim + token-checked release |
| `src/meta-harness.ts` | private bridge integration support, but keep production external cutover disabled in R3 |
| `src/server.ts` / process entry | acquire state-directory ownership before proposal controller use; release on shutdown |
| proposal/bridge/server tests | task/Activation idempotence, restart, runtime-lock exclusion, auth, lifetime, production guard |

No DB migration should be needed. `meta-proposal-task/v1` does not gain a durable Activation state or completion state in R3.

### R3 acceptance suite

R3 is ready for the next architecture re-audit only when the plan targets all of these mechanical proofs:

1. **Intent precedes host effect.** Instrumented host call count remains zero until create-only intent persistence succeeds.
2. **Intent is exact narrow delegation.** It binds current Claim/session/workspace/generation/AttemptEntry/permit provenance/packet/baseline and grants only external `CODE_PROPOSE` continuation.
3. **No stale permit authority in external prompt.** External worker text does not describe the released process-owned ExecutionPermit as current authority.
4. **Intent create-only conflict fails closed.** Same identity with changed request, packet, baseline, or authority bytes is rejected.
5. **No intent preserves existing abort law.** `ENTERED_NO_SEAL` without dispatch still recovers as existing `EXECUTION_ABORTED`.
6. **Intent changes only that recovery case.** Valid intent recovers as `EXTERNAL_OPEN`, not `RUNNING_ELSEWHERE` and not `EXECUTION_ABORTED`.
7. **Bridge unavailable is safe.** `EXTERNAL_OPEN` remains active and is never replayed locally merely because DevSpace is unavailable.
8. **Host missed-before-accept retry is exact.** Intent exists, host saw nothing, next ensure uses the byte-identical retained request.
9. **Lost response is idempotent.** DevSpace retained task + missing Meta receipt resolves to the same task on retry.
10. **One idempotency identity.** `packetDigest` is the downstream ensure/reconciliation identity everywhere; no second dispatch/activation request ID can fork one packet into another retained operation.
11. **Receipt proves binding only.** Persisted receipt contains no durable worker/Activation liveness state.
12. **Activation idempotence.** Same packet requested concurrently yields one retained task and at most one live Activation in the owning DevSpace process.
13. **DevSpace restart reconstruction.** Retained task survives; a new owning process may create one replacement Activation for that same task.
14. **Single-state-directory ownership is mechanical.** Runtime A owns stateDir X; runtime B attempting X refuses startup before creating or ensuring any Activation. After A is demonstrably dead, one new process may safely reclaim the stale runtime lock. No cross-process Activation mailbox/lease system is added.
15. **Workspace invariance.** External dispatch changes no allowed workspace bytes, Git index, HEAD, branch, or worktree topology.
16. **No premature completion.** `EXTERNAL_OPEN` creates no candidate seal, validation, product proof, BANK, World landing, ExecutionClosure, or Claim release.
17. **Claim capacity remains correct.** An external-open Claim occupies one repository Claim slot while independent remaining capacity may be planned/admitted.
18. **Planner vocabulary is truthful.** `EXTERNAL_OPEN` reaches planner context as `external_open`, never `running_elsewhere` or blocker evidence.
19. **Whole reducer treats external-open as active unresolved work.** One `EXTERNAL_OPEN` Claim with no other state is not hard-blocked, not `needsReplan`, not terminally settled, and not quiescent/no-work; it produces no endgame STOP, `EXECUTION_ABORTED`, or fabricated blocker/replan handoff.
20. **Reconcile once per invocation.** Repo-wave looping does not repeatedly call ensure for one intent digest during one process invocation.
21. **Controlled drain preserves the route.** Once intent exists, drain releases local lease without revoking task, Closing execution, or replaying the AttemptEntry.
22. **Bridge is private and bounded.** Loopback/IPC accepts only exact ensure requests, authenticates capability, is size/schema bounded, and dies with the parent continuation call.
23. **Bridge secret isolation.** Planner/promoter/proof/challenger/local worker/model subprocess environments contain none of the host endpoint/token/pipe capability.
24. **Production cutover remains off.** Normal `continue_meta_harness` does not supply the external transport in R3 and the existing completing local-worker owner path remains green.
25. **No public toggle.** CLI/config/environment surface has no user-selectable “external worker” switch.
26. **Existing deterministic regressions stay green.** R1/R2 proposal membrane, work-loop, repo-wave, controlled-drain, planner, product-direction, authority, and adjacent suites remain green on unchanged surfaces.

### R3 live/code-complete acceptance boundary

Code-complete R3 can be demonstrated without converting ordinary owner work into an unreturnable external path:

```text
Meta fixture/real repo Claim
→ real proposal-worker-packet/v1
→ real durable dispatch intent
→ real private bridge
→ real retained DevSpace proposal task/controller
→ fixture or bounded managed-browser launch acknowledgement
→ Meta returns internal EXTERNAL_OPEN
→ process lease released
→ second invocation recovers same EXTERNAL_OPEN route
→ same task is re-ensured without duplicate
```

A fresh-ChatGPT acceptance may additionally prove that the child opens the retained DevSpace task and sees only the R2 read/search/list membrane. That still does not prove product completion and must not be used to justify production cutover.

The full owner journey:

```text
fresh owner ChatGPT
→ continue_meta_harness
→ external proposal child
→ worker-result/v2 returns
→ Meta materializes/validates/proves/BANKs
→ owner receives completed result
```

belongs to P1 acceptance, because the result-return edge does not exist in R3.

### R3 non-goals

Do not add:

```text
worker_submit or any result callback
worker-result polling
transcript capture/scraping
proposal-task completion state
durable Activation/browser lifecycle state
cross-process DevSpace Activation lease/mailbox
queue/daemon/scheduler
controller materialization from child in R3
validation/repair/candidate seal/product proof/BANK/World landing for external work
Claim schema migration
WorkSession replacement
generic host RPC
generic worker/provider API
public external-worker flag/config/toggle
production default external cutover
steering
provider routing
```

Those either belong to P1 or require a new observed defect.

### R3 done definition

Use this exact boundary for the next re-audit:

> **For one already-entered Claim-bound `CODE_PROPOSE` attempt selected through an internal host capability, Meta-Harness can durably commit that attempt to exactly one external proposal route before contacting the host. Recovery recognizes that durable commitment as `EXTERNAL_OPEN` instead of aborting, locally replaying, or falsely claiming liveness. The immutable dispatch intent carries only a derived external `CODE_PROPOSE` continuation capability; `packetDigest` is the one downstream DevSpace idempotency identity; and any receipt proves exact retained task binding but not Activation state. DevSpace idempotently binds that packet to one restart-safe task and can ensure at most one process-local fresh-ChatGPT Activation because state-directory ownership is mechanically exclusive at process startup. Meta may release its process lease without surrendering or duplicating the Claim, and external-open Claims continue occupying repository Claim capacity while independent capacity remains plannable. No external completion is inferred before P1, and the normal production `continue_meta_harness` owner path does not switch to external workers until result fan-in exists.**

At that point R3 external-dispatch architecture is complete and bankable. P0 owner-journey completion remains open for P1 result fan-in.
