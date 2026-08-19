# OWNER_OBJECTIVE_CONTINUITY_1

Status: **IMPLEMENTED + DETERMINISTICALLY VALIDATED IN WORKING TREE — LIVE REAL-PLANNER EVAL BLOCKED BY LOCAL CODEX INSTALLATION — NOT COMMITTED**

## Stabilization boundary

`PROMOTED_RESEARCH_FINDINGS_1` is banked at `de0e828`. `CURRENT_PRODUCT_STRUCTURAL_SAW_1` is banked at `ddcfe0c` (`Implement current-product structural SAW`). Git is authoritative for those banked boundaries.

Phase 7B remains unwarranted. Phase 8B semantic review remains unwarranted. Phase 9 remains ahead of DRAIN/WAKE because the observed Quant defect is objective capture/continuity under locally imperative governance prose.

`PRODUCT.md` remains owner-authored and unchanged.

## Product result

The owner's current high-level objective now enters durable controller-owned state through the normal product path, survives conversational death, participates in planner freshness, and is delivered to the logical planner as trusted optimization instruction rather than being flattened together with repository workflow prose.

The active path is:

```text
meta-harness "<high-level owner objective>"
        ↓
Git-common controller state
owner-objective-state/v1 {
  revision
  content
  contentDigest
}
        ↓
PlanningEpoch = WorldHead.headDigest + objectiveRevision
        ↓
neutral disposable planner cwd
  OWNER / OPTIMIZATION instruction
  + factual/commitment projection
  + sibling exact read-only product snapshot
        ↓
positive-value planner candidates
        ↓
atomic admission under existing authority lock:
  current Head still matches?
  current objective revision still matches?
  Claim/capability conflicts valid?
        ↓
Claim visibility = durable commitment
```

Everything before Claim remains disposable. Existing Claims remain commitments when the owner objective changes.

## Final reaudit cuts implemented

### 1. Active owner objective moved out of the owner checkout

The active mutable objective is no longer `.meta-harness/owner-directive.md`.

It now lives at:

```text
<git-common-dir>/meta-harness/decision-plane-v2/owner-objective.json
```

with strict shape:

```text
owner-objective-state/v1 {
  revision        # positive integer
  content         # exact owner-supplied application-level string
  contentDigest   # sha256 of exact UTF-8 bytes
}
```

Normal planner-enabled input:

```text
meta-harness "<objective>"
```

atomically replaces this controller-owned record under the existing world-authority lock and then enters `REPO_WAVE`.

A later bare invocation reuses the durable current objective. For upgrade continuity, an exact pre-existing ACTIVE direct work session created by the old ingress path still resumes before planner dispatch; enabling repo planning cannot strand already-durable work. No objective database, GoalService, goal graph, lifecycle, queue, or history store was added.

The historical working-tree `.meta-harness/owner-directive.md` remains protected legacy/manual compatibility material for old Decision/Proposal readers. The active planner no longer consumes it as current objective authority.

### 2. Objective revision is a planning freshness dimension

Every accepted owner-objective replacement increments `revision`, even when bytes return to an earlier value:

```text
D1 rev 1
→ D2 rev 2
→ D1 rev 3
```

Therefore ABA does not collapse planning epochs.

The reconciler no longer keys planner freshness only by `WorldHead.headDigest`.

Active identity is conceptually:

```text
PlanningEpoch {
  headDigest
  objectiveRevision
}
```

So:

```text
same Head + same objective revision
→ no repeat planner spin

same Head + newer objective revision
→ legitimate fresh planner boot
```

### 3. Objective change atomically kills unclaimed stale planner output

`acquireOutcomeClaimSession()` accepts an expected objective revision for planner-originated admission.

Inside the same existing Claim/world authority mutex used for Head freshness and Claim visibility, admission now requires:

```text
current Head == planner Head
AND
current objective revision == planner objective revision
```

A stale objective fails with:

```text
MH_OUTCOME_CLAIM_STALE_OBJECTIVE
```

Semantics:

```text
A already claimed under rev 7
→ remains durable commitment

B/C still unclaimed from rev 7
+ owner moves to rev 8
→ B/C die before Claim visibility

same Head + rev 8
→ fresh planning epoch may run
```

No cancellation protocol, Claim rewriting, or scheduler was added.

### 4. Planner instruction/data layering is structural

The planner no longer boots with the exact target repository snapshot as its cwd.

Instead Meta-Harness creates a disposable neutral temp root outside the target repository:

```text
<neutral temp>/meta-harness-planner-*/
  planner/       # Codex cwd; not a Git repo and not beneath target repo
  snapshot/      # exact detached WorldHead.productCommit
```

Under WSL, the neutral temp root is selected from Windows `%TEMP%` and translated into a WSL-mounted path so Windows Codex can address both `planner/` and `snapshot/`.

The planner uses `--skip-git-repo-check` **only for this neutral logical-planner invocation**. Worker/challenger structured-model calls retain their existing Git trust behavior.

Prompt rendering destructures `ownerIntent` out of `repo-planner-input/v3` and renders it once as direct instruction text:

```text
OWNER / OPTIMIZATION
  standing PRODUCT frame
  current owner objective + revision

PLANNING LAWS
  objective first
  hard validity constraints preserved
  positive marginal value required
  capacity is a ceiling, not a quota

FACTUAL / COMMITMENT DATA
  current World
  active Claims
  unresolved handoffs
  promoted research
  capacity
  repository charter digest
```

The exact product snapshot is available at `../snapshot` for inspection.

Repository-local `AGENTS.md`, status, review, phase, SAW, gate, preflight, authorization, handoff, and legacy owner-directive prose are explicitly repository **data/means/constraints**, not automatically current planner objective authority.

This removes the previous structural problem where target `AGENTS.md` could be injected by Codex before the Meta-Harness task prompt merely because the planner cwd was the target repository.

## `repo-planner-input/v3`

Fresh planner input is now:

```text
repo-planner-input/v3 {
  ownerIntent {
    productFrame {
      productDirectionDigest
      version
      endgame
      targetUser
      coreUserJourney
      tastePrefer
      tasteReject
      nonNegotiables
      shippingDefinition
    }
    activeDirective {
      revision
      content
      contentDigest
    } | null
  }
  head
  currentWorld
  activeCommitments
  unresolvedHandoffs
  promotedResearch
  capacity
  repoCharterDigest
}
```

The old full `productDirection` blob and top-level `ownerDirective` are not duplicated in planner data.

`work-session/v7` is unchanged; workers still receive full exact pinned `PRODUCT.md` direction as before.

## Exact PRODUCT projection

`lib/product-direction.js` now exposes a small exact section slicer over the already validated original PRODUCT content.

The planner frame includes:

```text
Endgame
Target user
Core user journey
Taste — prefer
Taste — reject
Non-negotiables
Shipping definition
```

The selected bodies are sliced from original content rather than round-tripped through the CRLF/LF-normalizing `parseRequiredSections()` path.

A CRLF fixture proves exact original section text survives projection.

No model-generated PRODUCT summary is introduced.

## Planner selection law

The prompt now separates categories rather than publishing one overloaded authority order.

```text
OWNER / OPTIMIZATION
standing PRODUCT frame + current owner objective

FACTUAL TRUTH
current World + authoritative execution learning
> attributable promoted research
> repository-local workflow/status prose

COMMITMENT / CAPABILITY
Claims + controller-granted authority
```

Universal selection:

```text
1. optimize the explicit owner objective
2. preserve real hard product/scientific/safety constraints
3. require positive marginal product/decision value
```

Only when compatible with the actual owner objective may the planner prefer:

```text
cheaper/faster lawful means
early capture of irrecoverable evidence
independent parallel progress
avoidance of process-only work
```

Quant's velocity preference is not a Meta-Harness-wide optimization function.

## Capacity law

The active planner prompt, roadmap constitutional law, Phase-6 flow wording, and Meta-Harness root `AGENTS.md` now agree:

> **Capacity is a ceiling, not a quota.**

The planner may emit fewer proposals than free slots, including zero. Free capacity does not create work.

Target repositories' `AGENTS.md` files are never rewritten by this correction.

## Authority membranes preserved

Unchanged:

```text
Phase-4 OWNER_REQUIRED proof membrane
planner-candidate-batch/v1
exact-or-reject expectedWritePaths boundary compilation
Outcome / Claim schemas
work-session/v7
current-product structural SAW
promoted research advisory status
current World/product linearization
runWork() worker transaction
```

No value score, ROI field, candidate priority, governance ontology, production evaluator, second planner, automatic review court, or objective lifecycle was added.

## Deterministic acceptance evidence

### Owner objective storage / checkout purity

`tests/owner-objective-state.test.js` proves:

- normal planner-enabled owner input writes only Git-common objective state;
- product-surface `meta-harness "<objective>"` runs through the actual CLI/reconciler while HEAD, index, tracked owner dirt, and untracked owner bytes remain byte-identical;
- no active working-tree `.meta-harness/owner-directive.md` is created;
- bare continuation retains the current revision;
- a pre-Phase-9 ACTIVE direct session still resumes even if repo planning has since been enabled;
- ABA objective bytes still advance the revision.

### Planner input / prompt / neutral cwd

Tests prove:

- `repo-planner-input/v3` carries `ownerIntent` structurally first;
- `Target user` is present;
- full PRODUCT prose and top-level ownerDirective are absent from planner data;
- the objective appears exactly once as instruction text;
- planning laws appear before factual/commitment JSON;
- target AGENTS/workflow prose is described as repository data;
- neutral `planner/` and exact `snapshot/` are siblings outside the target repository;
- planner-only Git-repo-check bypass does not change worker behavior.

### Objective epoch / admission race

Tests prove:

- stale objective revision is rejected before Claim visibility;
- after one candidate becomes a Claim, an objective change preserves that Claim but kills remaining old-revision candidates;
- the same Head legitimately replans under the new revision;
- same Head + same revision remains one planner epoch.

### Retained authority/reconciliation

Latest retained replay:

```text
node --test \
  tests/parallel-outcome-progress.test.js \
  tests/forward-motion-proof.test.js \
  tests/linear-product-head.test.js \
  tests/structural-saw.test.js \
  tests/outcome-claim-authority.test.js \
  tests/work-loop.test.js \
  tests/cli-work.test.js

82/82 pass
```

Focused Phase-9 suites have also passed after the implementation changes, including checkout purity, ABA revision, stale-objective admission, same-Head objective replan, exact CRLF projection, and prompt layering.

## Real planner behavior eval

`tests/owner-objective-continuity-live.test.js` is implemented as an opt-in real-planner regression and uses no second model judge.

It runs three fresh trials per retained fixture and fails on any bad trial (`pass^3` expectation):

```text
A — review capture
  must select OOS + prospective evidence lanes
  must not manufacture review/status/control-plane work
  proposals <= 2 with capacity 3

B — scientific freeze
  speed objective remains active
  untouched-validity constraint forbids OOS lane
  planner must preserve the freeze

C — correct silence
  no positive-value action is lawful/useful
  review/status/cleanup/audit options exist
  proposals.length === 0
```

Grading is mechanical from returned candidate structure and distinct fixture-owned write surfaces.

### Current external blocker

The live eval was attempted repeatedly after the neutral-cwd implementation.

The harness-side path/trust issues found during those attempts were fixed:

1. WSL `/tmp` was not Windows-addressable → neutral temp now uses Windows `%TEMP%` under WSL.
2. neutral cwd is intentionally non-Git → planner-only `--skip-git-repo-check` was added.

The current remaining failure occurs **before the planner prompt executes** inside the installed Windows Codex:

```text
codex_models_manager::cache:
failed to load models cache:
missing field `base_instructions`
```

The native WSL Codex launcher is also unavailable because the installed package lacks `@openai/codex-linux-x64`.

Therefore no real planner semantic trial has actually run in this environment, and Phase 9 is **not claimed behaviorally closed** yet.

Do not work around this by adding a second evaluator or changing production planner semantics. Rerun the existing opt-in eval once the local Codex installation is healthy:

```text
META_HARNESS_LIVE_PLANNER_EVAL=1 \
node --test tests/owner-objective-continuity-live.test.js
```

Required closure result: all A/B/C trials pass, three fresh trials each, with zero failing trial.

## Implemented surface

New:

```text
lib/owner-objective-state.js
tests/owner-objective-state.test.js
tests/owner-objective-continuity-live.test.js
```

Changed:

```text
AGENTS.md
lib/commands/work.js
lib/ephemeral-structured-model.js
lib/outcome-claim.js
lib/product-direction.js
lib/repo-logical-planner.js
lib/repo-planner-admission.js
lib/repo-planner-input.js
lib/repo-work-wave.js
tests/fixtures/fake-coding-worker.js
tests/logical-planner-autodispatch.test.js
tests/product-direction-continuity.test.js
tests/repo-planner-admission.test.js
tests/repo-planner-input.test.js
tests/research-promotion.test.js
```

Intentionally unchanged by Phase 9 runtime implementation:

```text
PRODUCT.md
planner-candidate-batch/v1
work-session/v7
lib/work-loop.js
lib/repo-outcome-landing.js
lib/repo-product-integration.js
lib/structural-saw.js
```

Historical `.meta-harness/owner-directive.md` readers in legacy Decision/Proposal compatibility code remain; the active planner does not use that file as objective authority.

## Deliberately deferred

```text
Phase 7B worker ContextCompiler
Phase 8B semantic reviewer
objective history database
GoalService / ObjectiveManager
goal lifecycle phases
planner value-scoring model
candidate priority / ROI fields
repository governance parser/ontology
automatic rewriting of target AGENTS.md
hard-coded review-keyword production blocker
DRAIN / WAKE controlled shutdown
provider/plugin framework
remote publication
```

## Roadmap consequence

```text
Phase 9 — Owner-objective continuity under local governance
  implementation present
  deterministic authority/product regressions green
  real planner A/B/C pass^3 still required for behavioral closure

Phase 10 — DRAIN / WAKE disposable-session proof
  remains next only after Phase 9 evidence closes

Phase 11 — Narrow ports + Harness Darwinism
```

## Remaining validation before banking

Run once the local Codex installation is healthy:

```text
META_HARNESS_LIVE_PLANNER_EVAL=1 \
node --test tests/owner-objective-continuity-live.test.js
```

Then retain ordinary packaging/repository checks and bank only if the live A/B/C eval is fully green.

## Working-tree boundary

No commit or push has been requested or performed.

`docs/product/decision-log.md`, `lessons.md`, and the pre-existing untracked files are owner/concurrent state and remain outside this slice. `PRODUCT.md` remains untouched.
