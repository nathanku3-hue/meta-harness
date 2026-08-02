# Product Documentation Authority

Status: canonical index
Date: 2026-07-31

## Read Order

1. [Product Intent Anchor](product-intent.md) — immutable human intent and priorities.
2. [Problem-Solving Questions](problem-questions.md) — subtle failure modes and proof conditions.
3. [PRD](prd.md) — target user, problem, outcomes, boundaries, and success measures.
4. [Roadmap](roadmap.md) — locked endgame and numbered functional-slice build order.
5. [Product Specification](product-spec.md) — operating contracts and artifact expectations.
6. [Architecture Map](../architecture/map.md) — layer and dependency boundaries.
7. [SOP](../sop/meta-harness-sop.md) — auditor-planner and worker operating loop.
8. [Runtime Authority Architecture](runtime-authority-architecture.md) — frozen custody and execution-authority substrate.
9. [Decision Log](decision-log.md) — append-only decisions and deviations.

## Current Product Addition

The active product now includes a sequenced weak epistemic twin alongside the shipping loop. Its authority is defined by `product-intent.md`, `prd.md`, `product-spec.md`, `roadmap.md`, and `problem-questions.md`.

Key frozen doctrines:

- learn while build without interrupting the human or auto-promoting policy;
- keep domain truth, decision lessons, personal mastery, and action authority separate;
- combine an authoritative spine with a bottom-up active frontier;
- learn the best only: timeless classics plus latest frontier/SOTA primary work;
- defer the scheduled top-five repository/paper/mental-model scout until `L9`;
- keep the current custody closure and `S-006M` ahead of learning implementation.

## Authority Order

When active documents disagree, use this order:

```text
human intent version
→ explicit human decision or override
→ immutable run and execution evidence
→ canonical event/fact ledger
→ current roadmap and product specification
→ generated status and summaries
→ historical plans and audits
```

A material disagreement must block `ok: true` until reconciled.

## Document Classes

### Active authority

- `product-intent.md`
- `problem-questions.md`
- `prd.md`
- `roadmap.md`
- `product-spec.md`
- `runtime-authority-architecture.md`
- `decision-log.md`
- `../architecture/map.md`
- `../sop/meta-harness-sop.md`
- `../ops/role-contracts.md`
- `../ops/state-machine.md`

### Generated projections

- `.meta-harness/status.md`
- readiness reports;
- PM summaries;
- handoff views;
- behavior maps;
- scorecards.

Generated projections must declare their canonical sources, hashes, generator version, creation time, expiry, and contradiction policy.

### Historical evidence

The following remain readable evidence but do not define current direction:

- `phase-*.md` planning documents;
- closed audit records under `docs/ops/audits/`;
- top-level `implementation_plan.md`, `walkthrough.md`, and `task.md`;
- superseded phase maps and release plans;
- historical MVP and phase-era sections retained inside active documents for compatibility and traceability.

Historical evidence is not rewritten to make current direction appear inevitable.

## Change Rules

- Product intent changes only through a human-authored append-only version.
- Roadmap changes must state the deviation from active intent and expected shipping benefit.
- Active projections cannot be edited as independent truth once their generators exist.
- No runtime backward compatibility is presumed.
- Historical artifact readability is preserved through versioned readers or one-way migration.
- Documentation-only work is not counted as shipped product progress unless documentation is the requested product.
- Learning architecture does not create implementation authority; each `L*` phase opens only after its predecessor acceptance evidence exists.
- Discovery recommendations cannot become canonical knowledge, mastery evidence, or action policy without their separate gates.
