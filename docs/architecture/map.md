# Architecture Map

Status: canonical current architecture
Date: 2026-07-31
Intent authority: [Product Intent Anchor](../product/product-intent.md)
Roadmap authority: [Roadmap](../product/roadmap.md)

## Product Architecture

```text
┌────────────────────────────────────────────────────────────┐
│ PM CONTROL PLANE                                           │
│                                                            │
│ intent anchor       immutable human intent and priorities  │
│ objective map       product outcomes and shipping state    │
│ truth reconciler    authoritative facts and contradictions │
│ system map          modules, behaviors, dependencies       │
│ slice planner       numbered vertical functional slices    │
│ action scorer       alternatives, economics, uncertainty   │
│ expertise router    skills, agents, and named human gates  │
│ auditor-planner     frozen audit then intent-aligned plan   │
│ loop controller     one bounded, atomic cycle               │
│ outcome evaluator   prediction versus observed result       │
├────────────────────────────────────────────────────────────┤
│ WEAK EPISTEMIC TWIN — SEQUENCED PRODUCT LAYER              │
│                                                            │
│ episode observer    immutable build/research evidence       │
│ knowledge compiler  provisional deltas and scoped lessons   │
│ lesson evaluator    transfer, boundary, contradiction gate  │
│ mastery model       uncertain human capability evidence     │
│ frontier selector   one high-value question/intervention    │
│ discovery scout     later top-five classic/frontier brief   │
├────────────────────────────────────────────────────────────┤
│ ARTIFACT CONTRACT KERNEL                                   │
│                                                            │
│ schemas · validation · IDs · atomic I/O · result types      │
│ event/fact ledger · authority maps · version manifests     │
├────────────────────────────────────────────────────────────┤
│ SKILLS, KNOWLEDGE, AND EVIDENCE                            │
│                                                            │
│ skills/<name>/skill.md                                     │
│ skills/<name>/contract.json                                │
│ skills/<name>/evals/*.json                                 │
│ outcomes/<run-id>/...                                      │
│ evidence/<claim-or-result>/...                             │
│ behavior maps and role-specific context projections        │
├────────────────────────────────────────────────────────────┤
│ EXECUTION WORKCELLS                                        │
│                                                            │
│ planner · builder · verifier · integrator                  │
│ thin measured adapters: Codex and CI first                 │
│ later adapters only after demonstrated task-class need     │
├────────────────────────────────────────────────────────────┤
│ EXECUTION CUSTODY — FROZEN LOWER LAYER                     │
│                                                            │
│ authority · isolation · materialization · validation       │
│ durable result custody · replay · portable evidence        │
└────────────────────────────────────────────────────────────┘
```

## Authority Boundaries

- **Human:** intent, priority, taste, learning direction, material risk, scope expansion, irreversible commitment, credentials, publication, and protected boundaries.
- **Auditor-planner:** diagnosis, intent alignment, alternative comparison, RunSpec, scorecard, and next-slice recommendation.
- **Worker:** reversible execution inside the RunSpec and authorization envelope.
- **Verifier:** independent acceptance and process-quality evidence; no roadmap authority.
- **Controller:** canonical state, leases, duplicate suppression, cancellation, mutation authority, integration order, custody, atomic transitions, and loop disposition.
- **Execution substrate:** performs bounded work; it is not a source of authority or official truth.
- **Episode recorder:** appends immutable learning evidence only.
- **Learning compiler:** creates provisional knowledge deltas and candidate decision lessons only.
- **Learning evaluator:** owns transfer/boundary/contradiction evaluation and lesson state transitions; it does not own roadmap or action authority.
- **Frontier selector:** may propose at most one endgame-relevant learning intervention; it cannot promote knowledge or override human direction.
- **Discovery scout:** later recommends at most five best-only sources; it cannot ingest, update mastery, or mutate policy.

## Canonical Data Flow

```text
human intent version
  → objective and slice
  → frozen audit
  → RunSpec and authorization
  → worker candidate and evidence
  → independent verification
  → controller integration/custody
  → immutable outcome and events
  → provisional episode and knowledge delta
  → independently evaluated lesson/mastery evidence
  → one frontier intervention or silence
  → generated status, handoff, learning brief, behavior map, and PM view
```

Generated views never become independent authority. Every projection declares canonical source hashes, generator and policy versions, creation time, expiry, and contradiction behavior.

The epistemic branch is subordinate to evidence and authority:

```text
verified episode
  → provisional knowledge delta
  → candidate decision lesson
  → held-out transfer + boundary + contradiction evaluation
  → active/challenged lesson
  → one recommendation
  → separately authorized action, if any
```

Domain truth, decision lessons, personal mastery, and executable action authority remain separate state domains.

Source intake follows the best-only doctrine: timeless classics plus latest frontier/SOTA primary work; middle-layer material requires an explicit blocking bridge role. The later scheduled scout is a read-only adapter around this contract.

## Module Dependency Direction

```text
bin/meta-harness.js
  → lib/commands/*.js
  → feature modules
  → artifact contract kernel

loop controller
  → feature modules through explicit contracts
  → adapters through one bounded execution interface
  → custody through the existing public execution boundary

feature modules
  → artifact contract kernel only
  ✕ no direct imports from unrelated feature modules

adapters
  → external execution substrate
  ✕ no product planning or authority decisions

projections
  → canonical artifacts
  ✕ no independent mutation of canonical truth
```

Pure function calls are preferred inside one process. File I/O is used for durable boundaries, restartability, inter-process exchange, auditability, and explicit contracts—not merely to avoid imports.

## Context-Footprint Rule

A module is safely AI-changeable when one bounded packet can contain:

- contract;
- implementation;
- tests;
- direct dependencies;
- relevant behavior map;
- active evidence;
- allowed change boundary.

Line count is a ratchet signal, not the definition. Existing frozen custody files are not mass-split. New or materially touched modules must reduce context footprint or record an explicit temporary exception.

## Behavior Localization

The behavior handbook is a source-verified projection:

```text
behavior
→ entry points
→ implementation sites
→ contracts and invariants
→ state read and written
→ tests and evidence
→ downstream consumers
→ known exceptions
```

It supports progressive disclosure:

1. product behavior;
2. affected modules and dependencies;
3. exact source locations and tests.

A code graph or graphification plugin may help generate this projection, but it cannot define intent, authority, current facts, or shipping priority.

## Handoff and Resume Boundary

A handoff is a typed, hash-bound state transition. A resume is accepted only after:

- schema and version validation;
- intent and authority validation;
- repository identity and state validation;
- lease and split-brain checks;
- evidence availability checks;
- receiver-comprehension proof;
- no superseding override or completed equivalent run.

Conversation summaries are never the resume authority.

## Multi-Agent Boundary

Parallel execution is allowed only when:

- single-worker continuation is already proven;
- work units have disjoint writes or read-only roles;
- each unit has a lease and acceptance contract;
- duplicate objectives are rejected;
- reviewer contamination is declared;
- partial results have salvage classes;
- integration order is deterministic;
- measured latency benefit exceeds orchestration and merge cost.

## Module Ownership

| Path | Owner | Purpose |
|---|---|---|
| `bin/` | product/controller | Thin CLI entry point only |
| `lib/commands/` | product/controller | Command handlers and input normalization |
| `lib/` | product/controller | Current feature modules and contract kernel |
| `lib/execution-custody/` | custody | Frozen authority-bound execution substrate |
| `templates/contracts/` | contracts | Installable artifact and work contracts |
| `templates/skills/` | skills | Installable reusable expertise |
| `.agents/skills/` | skills | Active repository skills |
| `.meta-harness/` | controller | Tracked truth, generated projections, and ignored local runtime evidence |
| `tests/` | verification | Behavioral, contract, regression, and continuity evaluation |
| `docs/product/` | product | Intent, questions, PRD, roadmap, specification, and decisions |
| `docs/architecture/` | architecture | Current structural and dependency truth |
| `docs/ops/` | operations | Role, state, audit, release, and recovery contracts |
| external Eureka kernel / future thin adapter | epistemic twin | Episodes, knowledge deltas, lessons, mastery, frontier, evaluations, and Markdown projections; no implementation dependency before `L1` |

## Public Surface

- Public CLI commands are defined by `lib/command-registry.js`.
- Check IDs are defined by `lib/check-id-registry.js`.
- Artifact schemas are versioned and strict at durability boundaries.
- Historical artifacts remain readable through versioned readers or one-way migration.
- No runtime compatibility alias is added without proven consumer need and explicit authorization.

## Current Build Boundary

Only `CANDIDATE-S001R5F — Fail-preserving exact-candidate finalization` is authorized now, followed by exact audit, `G-001`, integration, and `S-006M`. The weak epistemic twin architecture is frozen product direction, not permission to build its layers horizontally. `L1` opens only after one real verified coding episode exists; the scheduled discovery scout remains closed until `L9`.
