# LOGICAL_PLANNER_AUTODISPATCH_1

Status: **IMPLEMENTED LOCALLY — ARCHITECTURE RE-AUDIT PASS — VALIDATED — UNCOMMITTED**

## Owner-authority prerequisite — satisfied

This slice changes the human/product journey, not merely an internal implementation detail. The owner explicitly authorized execution after the re-audit and supplied the new journey/execution law. `PRODUCT.md` is now `product-direction-v2` and defines:

```text
owner-authored product direction
→ high-level intent
→ planner decomposition
→ multiple Outcomes
→ automatic dispatch
→ exact validation
→ bounded repair
→ observable result
```

with:

```text
Planner proposes meaning.
Kernel grants exact capability.
Claim makes commitment durable.
Worker executes.
World learns.
```

The former owner-direction implementation gate is therefore satisfied. Publication/push authority remains unchanged and was not granted.

## Product result

`FORWARD_MOTION_PROOF_1` is banked at `a63e82c`. The live substrate now prevents failed means and fictional authority from consuming owner attention, so the next bottleneck is the remaining human transport layer between durable repository truth, logical planning, and initial execution.

Eliminate that transport layer.

The two observed Quant friction cases are the acceptance reference:

```text
worker/research slice finishes
→ durable handoff exists
→ owner currently has to paste it into planner with "explain to me:"
```

and:

```text
planner determines two useful independent streams
→ says "run two streams"
→ owner currently has to boot/route workers or relay worker prompts
```

After this slice, one normal repo-owned invocation performs:

```text
recover existing Claims first
        ↓
current WorldHead(World, productCommit)
+ owner-authored product direction / directive
+ active commitments
+ unresolved durable Closure / forward-motion handoff
        ↓
fresh disposable logical planner
        ↓
bounded ordered semantic candidates
        ↓
controller validates each candidate + compiles bounded capability
        ↓
existing atomic Claim + session admission
        ↓
bounded concurrent runWork()
        ↓
existing Closure / integration / World landing
```

The owner does not:

```text
type "explain to me:"
copy/paste worker handoff
copy/paste planner output
say "run these two streams"
start worker A / worker B
see or relay worker prompts
choose Claim/session/workspace identifiers
```

The logical planner is still **out of the execution hot path**. It runs only when the command has useful capacity and needs fresh proposal possibilities. Once the initial frontier is produced/admitted, it disappears.

This slice deliberately stops before continuous refill/reconciliation. Phase 6 owns repeated planner wake/refill after landings free capacity or change World.

## Constitutional slice laws

```text
planner proposes possibilities
kernel grants commitments
workers execute commitments

planner output is not authority
planner output has no durable identity
Claim is authority

planner never chooses Git base
planner never issues ExecutionPermits
planner never boots workers directly
planner never writes repository bytes
planner never creates owner authority

owner never transports handoff between agents
owner never transports worker prompts

active Claims recover before planner invocation
mutable/planner possibilities may not cancel commitments

planner runs only when fresh possibilities are useful
no capacity need → no planner call

one initial planning frontier
not a queue
not a daemon
not continuous refill

fresh planner context comes from durable truth
not previous planner/worker conversation
```

## Hard cut 1 — delete `.meta-harness/repo-proposals.json` as active work ingress

`repo-proposal-set/v2` is currently read from:

```text
.meta-harness/repo-proposals.json
```

Once the planner is internal, keeping that mutable file as active work ingress preserves exactly the manual routing surface Phase 5 is meant to remove.

Hard cut:

```text
active mutable .meta-harness/repo-proposals.json
→ no longer accepted as new active repo-work input
```

Historical `repo-proposal-set/v2` bytes remain readable where Phase-2/3 migration/tests require them. The file may remain protected so workers cannot mutate historical/control material, but it is not consulted for fresh active admission after this cut.

Do **not** replace it with another mutable `current-planner-output.json` pointer.

Planner proposal candidates are disposable. If the process dies before a Claim is visible, no commitment exists and a fresh planner may recompute from current truth. Once a Claim is visible, existing Claim/session recovery owns continuity and planner output is no longer needed.

## Hard cut 2 — delete the active Proposal Set abstraction; planner emits disposable semantic candidates

The audit cut is stronger than removing `.meta-harness/repo-proposals.json`: **do not introduce `repo-proposal-set/v3` on the new active path.**

Historical `repo-proposal-set/v2` parsing may remain explicitly legacy-only for migration/regression evidence. It is not compiled, persisted, or used as active Phase-5 work identity.

The fresh planner returns only:

```text
planner-candidate-batch/v1
proposals[]
```

Each candidate contains exactly:

```text
id
productResult
journeyState
doNow
newlyTrueBehavior
doneWhen
stopOnlyIf[]
expectedWritePaths[]
```

`expectedWritePaths[]` is a **non-authoritative footprint prediction**, not a capability grant. The planner is saying where it expects the Outcome to touch; it is not choosing `Claim.executionBoundary` or `ExecutionPermit.ownedPathSet`.

The candidate batch has:

```text
no authority binding
no recovery responsibility
no durable identity
no required persistence
```

If the planner dies before Claim creation, recompute from current durable truth. If it dies after Claim creation, the Claim/session already owns continuity.

The planner does **not** author:

```text
productDirectionDigest
charterDigest
worldHeadDigest
ownerDirectiveDigest
base
validation
maxAttempts
delivery
Claim execution boundary
Claim identity
session identity
worker prompt
owner request
```

For each semantic candidate the controller performs one direct, exact-or-reject boundary compilation:

```text
normalize expectedWritePaths
        ↓
constitutional safety validation
        ├─ valid   → exact normalized Claim.executionBoundary
        └─ invalid → reject whole candidate
```

Boundary compilation is **non-widening and non-shrinking**. It may normalize equivalent path syntax or reject the candidate; it may never silently change the semantic write footprint.

```text
NEVER:
planner asks for A
→ controller grants A+B

NEVER:
planner asks for A+B
→ B is unsafe/conflicting
→ controller grants only A
```

At minimum, compilation must reject path escape, `.git`, `PRODUCT.md`, protected `.meta-harness` authority/control material, invalid/duplicate paths, and anything outside the controller's existing reversible coding envelope before Claim visibility. A requested `"."` footprint may be legal only when its exact normalized boundary remains representable under those protected-path exclusions; otherwise reject the whole candidate rather than silently narrowing it.

Concurrency/compatibility is a separate authority operation after exact boundary compilation:

```text
candidate
→ exact safe requested boundary
→ atomic Claim admission
    ├─ compatible  → Claim
    └─ conflicting → skip/reject whole candidate
```

A Claim is never minted for a semantically smaller or larger footprint than the candidate proposed.

The controller then derives mechanics from exact current authority:

```text
base = EXACT_COMMIT(currentHead.productCommit)
validation = existing deterministic resolver(base, Claim.executionBoundary.writePaths)
maxAttempts = controller bounded policy
local delivery = BANK only; push false unless separately authorized
productProofSpec = existing pre-worker compiler against exact derived base
```

This keeps the logical planner responsible for **what outcome is worth attempting** while the kernel alone decides **what capability it actually receives**.

## Hard cut 3 — one fresh read-only logical planner runtime

Add one narrow planner runner using the already-supported model/Codex execution substrate directly.

Extract exactly one concrete structured-model process helper so the third model invocation shape does not duplicate Codex child-process mechanics:

```text
runEphemeralStructuredModel({
  cwd,
  prompt,
  outputSchema,
  timeoutSeconds,
  model
})
```

The coding worker, forward-motion challenger, and logical planner continue to own their own prompts/contracts. This helper is **read-only by construction** and owns only executable resolution, ephemeral read-only Codex invocation, timeout/output-cap handling, and structured-output parsing. There is no dormant writable mode. It is not a provider, port, plugin host, or agent framework.

Do not add:

```text
provider interface
planner plugin API
manager-agent framework
long-lived planner process
planner conversation store
planner-to-worker messaging
```

The planner is:

```text
fresh model context
read-only repository snapshot
no ExecutionPermit
no filesystem/Git mutation authority
no Claim authority
no publication authority
no owner authority
bounded output schema
```

Use a fresh isolated read-only snapshot of exact `currentHead.productCommit`, not the owner/source checkout's mutable bytes.

Conceptual modules:

```text
lib/ephemeral-structured-model.js    # one concrete Codex process helper
lib/repo-logical-planner.js          # planner prompt/schema + snapshot invocation
```

The planner may inspect repository files inside that exact product commit through its read-only working directory. Meta-Harness injects durable authority/context artifacts separately; it does not copy the Git-common authority store into the snapshot.

## Hard cut 4 — compile one exact planner boot context from durable truth

Do not give the planner old chat transcripts or human-written handoff summaries.

Build a narrow derived, non-authoritative:

```text
repo-planner-input/v1
```

The planner input is an **attributable deterministic projection**, not a bag of full authority objects:

```text
PlannerInput {
  schemaVersion: repo-planner-input/v1
  productDirection

  head {
    headDigest
    productCommit
  }

  currentWorld        // only domain truth needed for frontier reasoning
  repoCharterDigest
  ownerDirective { content, digest } | null

  capacity {
    localBound
    occupiedSlots
    availableSlots
  }

  activeCommitments[]
  unresolvedHandoffs[]
}
```

Do not feed full World attestation envelopes, Claim/session structures, ExecutionPermit internals, AttemptEntry internals, validation timing, custody records, candidate seals, or raw worker output merely because they exist.

### `activeCommitments[]`

Mechanically project active Claims before planning:

```text
{
  outcomeDigest
  claimDigest
  outcome {
    id
    desiredState
    preconditions
    evidenceRequirement
  }
  grantedWritePaths[]
  state: pending | executable | running_elsewhere | closure_awaiting_landing
  relevantPreconditions[]
}
```

The digests preserve exact attribution; the planner receives the semantic commitment and granted boundary, not workspace IDs, execution permits, worker prompts, or recovery internals.

### `unresolvedHandoffs[]`

This is the concrete fix for the `explain to me:` friction.

Derive only the latest authoritative unresolved learning for each Outcome:

```text
{
  outcomeDigest
  outcome semantics
  disposition
  observableResult | unsatisfiedRequirement
  failedMeans[]
  viableAlternatives[]
  disprovedAssertions[]
  validatedOwnerRequiredFact | null
  closureDigest | null
  workResultDigest | null
  forwardMotionProofDigest | null
  transitionDigest
}
```

The projection may include concise semantic fields already carried by those authoritative objects, but not their whole operational envelopes. A validated Phase-4 owner-required fact may be represented; planner output still has no owner-escalation field.

If a later authoritative transition for the same Outcome superseded the unresolved state with accepted success, omit the older handoff.

This is a narrow Phase-5 compiler, not the future generic `ContextCompiler` from Phase 7. Its only job is reconstructing the planning frontier without human narration while preserving exact digest attribution.

No raw worker/planner chat is input.

## Hard cut 5 — planner prompt is product/frontier reasoning only

The planner receives laws such as:

```text
- Propose independently valuable executable Outcomes, not lifecycle tasks.
- Outcome identity is product result, not path/phase/agent identity.
- Prefer enough useful possibilities to fill current available capacity plus expose the nearest dependency boundary.
- Existing Claims are commitments; do not cancel, rewrite, or duplicate them.
- A failed means is not a failed outcome; consume durable forward-motion evidence.
- Do not manufacture owner authority. Only an already-validated constitutional owner request may be treated as owner-required state.
- Do not produce worker prompts.
- Do not tell the owner to run streams/workers.
- Do not choose base commits, validation commands, attempt counts, delivery policy, workers, sessions, or workspaces.
- Do not create integration/review/docs/evidence-refresh lifecycle slices.
- Empty proposal output is not terminal product authority.
```

The planner returns only structured proposal candidates.

It may return zero proposals. Zero proposals means **no new planner proposal from this current boot**, not `USE_PRODUCT`, not `NO_DISPATCH`, and not an owner escalation.

## Hard cut 6 — planner output flows directly into existing Claim/session compiler

Do not create a separate planner dispatch engine.

The control path should reuse the already-proven Phase-1/2/3 admission machinery:

```text
planner candidate
→ validatePlannerCandidate()
→ compileExecutionBoundary(expectedWritePaths)
→ create/persist Outcome
→ derive base + validation + attempts + local delivery + product proof
→ acquireOutcomeClaimSession()
→ runWork()
```

Do **not** synthesize a Proposal Set between planner output and Outcome admission.

Keep `loadRepoProposalSet()` / `repo-proposal-set/v2` validation only behind an explicitly legacy path for migrations and historical regressions. Active Phase-5 admission should use a small direct compiler, conceptually:

```text
validatePlannerCandidate()
compileExecutionBoundary()
preparePlannerCandidate()
admitPreparedPlannerCandidate()
```

These helpers may live in a narrow `repo-planner-admission.js` module or another existing authority module if that stays smaller; do not repurpose `repo-proposal-set.js` into a v3 active abstraction.

Planner candidate bytes are not required telemetry. If non-authoritative diagnostics retain a digest, that digest is observation only and never work identity or recovery authority.

## Hard cut 7 — planner is invoked only for unused initial capacity

At repo-work command entry:

```text
1. ensure authoritative linear product Head
2. recover/classify all active Claims
3. select recoverable executable commitments up to local bound
4. read current WorldHead
5. compute unused local slots
6. if unused slots > 0:
      run ONE fresh planner against current H
      validate/compile candidates one by one
      greedily Claim compatible possibilities
7. run selected sessions concurrently
8. land Closures serially through existing integration/World path
9. stop
```

Planner invocation is skipped when recovered executable work already fills local capacity.

A live Claim running under another controller remains a commitment and is supplied to planner context so duplicate/conflicting proposals can be avoided, while the kernel remains the final compatibility authority.

The planner is not awakened after the first landing in the same invocation merely because capacity becomes free. That is Phase 6.

## Hard cut 8 — stale planner output is disposable

Planner output is bound by the controller to one exact `worldHeadDigest`.

If World changes before new Claim acquisition:

```text
MH_OUTCOME_CLAIM_STALE_HEAD
→ discard remaining planner proposal candidates
```

Do not rewrite their Head binding.

For this slice, allow at most **one bounded fresh replan retry** against the new current Head when no new Claim from the stale planner output became visible. If any new Claim was already admitted, recover commitments and stop after the current initial wave; do not recursively planner-loop.

This prevents a concurrent landing from turning initial dispatch into an owner-visible false stop while still avoiding continuous reconciliation semantics.

## Hard cut 9 — worker boot and prompts stay internal

The planner never outputs worker prompts.

Worker boot remains exactly:

```text
validated proposal
→ Outcome
→ Claim
→ sealed work-session/v7
→ ExecutionPermit
→ coding-worker prompt compiled internally
→ disposable coding worker
```

Normal human output may show coarse liveness only.

It must not show or ask the owner to relay:

```text
planner prompt
planner candidate JSON
worker prompt
session JSON
Claim IDs
workspace IDs
"run stream A"
"run stream B"
```

This is a black-box product requirement, not merely documentation style.

## Hard cut 10 — planner has no owner-escalation channel

Phase 4 already owns owner-authority admission through `forward-motion-proof/v1`.

The logical planner must not introduce another owner-question path.

Planner candidate schema contains no `ownerRequest`, `question`, `blocked`, or arbitrary authority field.

If current durable state contains a validated `OWNER_REQUIRED` proof, the planner may treat that Outcome as unresolved and avoid proposing duplicate work. Human routing continues through the already-validated Phase-4 owner request.

If planner reasoning believes new owner judgment might be useful but no validated owner proof exists, it may simply omit that proposal or propose autonomous evidence-gathering work. It may not manufacture `Need you`.

## Product-path effect

Before Phase 5:

```text
human/repository process writes repo-proposals.json
→ meta-harness reads it
→ Claims / workers execute
```

After Phase 5:

```text
meta-harness work
→ recover commitments
→ compile durable planning handoff automatically
→ fresh logical planner
→ proposal candidates
→ Claim/session admission
→ workers boot automatically
```

The owner-facing absence is the product improvement:

```text
no "explain to me:"
no "what next?"
no "run two streams"
no prompt relay
```

## Quant reference regression A — automatic handoff consumption

Starting state:

```text
E5/source qualification Outcome has authoritative durable completion
World says source/semantic uncertainty is resolved
implementation/economic validity remains unproven
scientific freeze remains unchanged
no old planner/worker chat is available
```

Kill all previous model context.

Run normal Meta-Harness repo work.

Expected:

```text
planner input automatically contains the durable relevant handoff
planner independently derives the next bounded implementation/research opportunity
owner does NOT paste:
  "explain to me: <handover>"
```

The exact next proposal is planner/domain judgment; the acceptance requirement is that the durable facts are present and the human transport step is absent.

## Quant reference regression B — two streams become workers automatically

Starting durable state supports two useful independent possibilities, e.g. conceptually:

```text
A = system-level causal replay work
B = tiny read-only CRV1 existing-bytes mechanism eligibility work
```

Planner returns ordered candidates A and B with disjoint `expectedWritePaths[]`; the controller independently compiles compatible execution boundaries.

Expected:

```text
controller compiles both
Claim A + Claim B
session A + session B
workers A + B execute concurrently within local bound
```

Owner output must not contain:

```text
"Run two useful parallel streams"
worker A prompt
worker B prompt
instructions to open/route agents
```

If A/B conflict mechanically, Claim admission decides; planner does not force concurrency.

## Acceptance suite

### 1. Mutable proposal file is no longer active ingress

A repo contains stale `.meta-harness/repo-proposals.json`. Fresh Phase-5 work does not dispatch from it. Planner/current truth owns new possibilities; historical file remains inert evidence only.

### 2. Planner candidate cannot author authority bindings

Candidate output has only semantic fields plus non-authoritative `expectedWritePaths[]`. Attempts to include base, World digest, validation, delivery, maxAttempts, owner request, Claim/session identity, `allowedPaths`, execution boundary, worker prompt, or unexpected fields fail schema validation.

### 3. Controller compiles scope and mechanics

For planner candidate A:

```text
candidate.expectedWritePaths == planner footprint prediction
claim.executionBoundary == exact normalized safe requested footprint
session.allowedPaths == claim.executionBoundary.writePaths
session.base.commit == currentHead.productCommit
validation == deterministic resolver result over granted paths
maxAttempts == controller bounded policy
delivery.push == false without explicit publication authority
```

A candidate requesting `PRODUCT.md`, `.git`, protected `.meta-harness` control material, traversal, invalid/duplicate paths, or scope outside the reversible coding ceiling is rejected before Claim visibility. Compilation may normalize equivalent path syntax but may neither widen nor shrink the requested semantic footprint. Planner cannot alter any derived mechanic.

### 4. Existing Claims recover before planner

Delete/change all previous proposal/planner outputs. Fresh invocation resumes active Claim sessions first. Planner receives those commitments as context and cannot cancel them.

### 5. Full recovered capacity skips planner

When recoverable sessions already fill local execution bound, planner invocation count is zero.

### 6. Automatic durable handoff

Fresh planner receives exact unresolved latest Closure/work-result/forward-motion learning from durable authority without old transcript or owner paste.

### 7. Superseded handoff is omitted

An Outcome with older REPLAN_REQUIRED followed by later authoritative LANDED success does not present the obsolete replan handoff as current planner input.

### 8. Two compatible planner candidates auto-dispatch

One planner boot returns A+B with disjoint expected footprints. The controller compiles both into non-overlapping Claim boundaries; both pass existing Claim/session admission and workers overlap. No human routing step occurs.

### 9. Planner cannot force conflicting streams or partial Claims

Planner returns overlapping expected footprints A/B plus disjoint C. Boundary compilation preserves each candidate's exact normalized footprint. Atomic Claim admission admits A, rejects/skips the **whole** B candidate on conflict, and admits C. It never shrinks B to a non-conflicting subset. No owner question and no planner retry for ordinary compatibility conflict.

### 10. Planner output stale before any Claim

Planner plans on H; concurrent transition advances H→H1 before Claim acquisition. No stale Claim is created. Controller may run one fresh planner retry against H1.

### 11. Planner output stale after one Claim admitted

A from H becomes a durable Claim, then H advances before B admission. A remains commitment; B is not admitted from stale H. No recursive planner loop occurs in this slice.

### 12. Planner death before Claim is harmless

Planner process/output disappears before any Claim. Fresh invocation recomputes. No orphan work authority exists.

### 13. Controller death after Claim is harmless

Planner output disappears after Claim/session visibility. Fresh invocation recovers the Claim/session without rerunning planner for continuity.

### 14. Worker prompts never reach normal output

Normal CLI output contains no planner prompt, worker prompt, candidate JSON, Claim/session/workspace identifiers, or copy/paste instructions.

### 15. Planner cannot manufacture owner authority

Planner candidate schema has no owner-routing field. A model attempting to ask owner/manager/librarian is rejected/ignored as invalid candidate output; only existing validated Phase-4 `OWNER_REQUIRED` evidence may reach `Need you`.

### 16. Zero planner proposals is nonterminal

Planner returns `proposals: []`. Result is a nonterminal no-new-proposal/replan state, not `USE_PRODUCT`, not `NO_DISPATCH`, and not automatic owner escalation.

### 17. Owner/source checkout remains untouched

Planner snapshot, proposal compilation, Claim admission, worker execution, and integration do not mutate owner checkout branch/HEAD/index/dirty/untracked bytes.

### 18. Phase-4 behavior remains intact

Worker STOP → forward-motion challenger → same-session alternative / REPLAN_REQUIRED / HARD_BLOCKED / OWNER_REQUIRED continues to work unchanged after planner introduction.

## Implemented surface

New narrow modules:

```text
lib/ephemeral-structured-model.js    # one concrete read-only Codex process helper
lib/repo-logical-planner.js          # planner prompt/schema + exact-commit snapshot invocation
lib/repo-planner-input.js            # slim attributable current-frontier projection
lib/repo-planner-admission.js        # candidate validation + exact boundary/mechanics compilation
lib/repo-work-wave-telemetry.js      # non-authoritative wave observations extracted from orchestration
```

Changed execution/product modules:

```text
lib/repo-work-wave.js                # recover → one planner boot → direct candidate admission → execute → land
lib/commands/work.js                 # repo-owned normal path derives work from durable truth, not proposal file
lib/coding-worker.js                 # reuses concrete read-only structured-model process helper
lib/work-forward-motion.js           # reuses same helper without changing Phase-4 semantics
lib/work-git.js                      # exposes existing managed-worktree helpers for exact planner snapshots
PRODUCT.md                           # owner-authored product-direction-v2 journey and Phase-5 execution law
AGENTS.md / README.md / package.json # product-facing contract/description alignment
```

Historical `lib/repo-proposal-set.js` remains unchanged and legacy-only. `.meta-harness/repo-proposals.json` remains protected historical/migration evidence; active Phase-5 work does not load it. No generic provider/runtime port was introduced.

Focused regression surface:

```text
tests/logical-planner-autodispatch.test.js
tests/repo-planner-input.test.js
tests/repo-planner-admission.test.js
tests/parallel-outcome-progress.test.js
tests/forward-motion-repo-landing.test.js
tests/linear-product-head.test.js
tests/forward-motion-proof.test.js
tests/outcome-claim-authority.test.js
tests/execution-permit.test.js
tests/work-git.test.js
tests/work-loop.test.js
tests/cli-work.test.js
```

## Deliberately deferred

```text
continuous planner wake/refill after each landing
persistent planner session/checkpoint
planner conversation memory
planner-to-worker messaging
owner-intent change/cancellation protocol beyond existing owner-authored direction/directive
research promotion / ResearchFinding
full minimum-sufficient ContextCompiler
raw chat ingestion
semantic retrieval/vector memory
adaptive SAW reviewer triggering
DRAIN / WAKE
provider/runtime ports
plugin framework
queue / daemon / fairness / preemption
remote publication
```

Phase 6 owns event-driven repeated reconciliation/refill. Phase 7 owns richer research promotion and context minimization if planner input becomes too large or raw research must be promoted.

## Architecture audit resolutions

The architecture audit is accepted with the required cuts incorporated here:

1. **Delete the entire active Proposal Set layer.** `.meta-harness/repo-proposals.json` and `repo-proposal-set/v2` remain historical/legacy only; there is no `repo-proposal-set/v3` on the fresh planner path.
2. **Make planner path output explicitly non-authoritative and exact-or-reject.** `expectedWritePaths[]` is only a footprint prediction; `compileExecutionBoundary()` may normalize equivalent syntax or reject, but may never widen or shrink it. Constitutional safety is checked during compilation; active-Claim compatibility is decided separately by atomic Claim admission, which accepts or rejects the whole candidate.
3. **Use a slim attributable planner projection.** Durable truth is deterministically projected into product/head, capacity, semantic active commitments, and latest unresolved handoffs with exact digests; operational envelopes and raw chats stay out.

Additional accepted audit resolutions:

- recover commitments first, then invoke one planner whenever unused initial capacity remains;
- exactly one stale-Head replan is allowed only before any new Claim becomes visible;
- planner candidates require no persistence; continuity begins at Claim;
- no replacement owner-ingress artifact is introduced;
- one concrete `runEphemeralStructuredModel()` helper may remove repeated Codex process mechanics; it is read-only by construction and exposes no writable mode, provider port, or plugin framework.

## Validation evidence

Current local implementation evidence:

- Phase-5 planner/admission/input + parallel/linear/landing integration suite: **30/30 passed**.
- Worker runtime + Phase-4 forward-motion + Claim/permit authority + Git custody + work-loop + CLI regression suite: **81/81 passed**.
- Repository wrapper topology: all **123/123 discovered `.test.js` files passed by file** under the wrapper's `META_HARNESS_INTERNAL_CLI=1` environment. Connector-safe replay used bounded 41/21/20/20/20/1-file chunks after DevSpace returned upstream 502 for the larger middle command; every bounded command returned an actual PASS verdict.
- Monolithic `npm test` did not return a repository verdict because DevSpace returned an upstream 502. No monolithic-wrapper PASS is claimed; the discovered test topology itself is fully green.
- `quality check` remains blocked by the repository's stale complexity/ratchet baseline across many pre-existing modules. After extracting wave telemetry, `lib/repo-work-wave.js` is 396 lines, and no quality finding message names any new Phase-5 module (`ephemeral-structured-model`, logical planner, planner input/admission, wave telemetry, or repo work wave).
- All new Phase-5 implementation modules are below the 400-line source budget and all new Phase-5 test files are below the 300-line test budget; `lib/repo-work-wave.js` is 396 lines after telemetry extraction.
- `npm pack --dry-run --json`: package assembly succeeded and includes all five new Phase-5 runtime modules.
- Active-path invariant scan finds no `loadRepoProposalSet`, `.meta-harness/repo-proposals.json`, or `repo-proposal-set/v3` reference in the Phase-5 work/planner path, and the common structured-model helper exposes no writable/readOnly mode switch.
- `git diff --check`: PASS.

## Stop boundary

**`LOGICAL_PLANNER_AUTODISPATCH_1` is implemented and validated locally.**

The normal fresh repo-owned path now consumes durable truth, boots one disposable read-only planner only for unused initial capacity, compiles exact-or-reject semantic candidates directly into Outcome/Claim/session authority, runs compatible workers automatically, and lands through the existing linear World/product path. Active mutable proposal-file ingress is gone; continuity begins at Claim; worker/planner prompt relay is absent from normal human output.

Stop here. Phase 6 owns repeated event-driven refill/reconciliation after landings. Persistent planner sessions, queues/daemons, provider/plugin frameworks, richer generic context compilation, and publication expansion remain deliberately deferred.

The implementation is **uncommitted and unpushed**. Publication/push remains explicit owner authority and was not requested.
