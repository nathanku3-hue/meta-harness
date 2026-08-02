# Architecture Map

## Product architecture

```text
Product anchor
    ↓
One selected role
    ↓
Slice Charter
    ↓
Clean isolated worktree
    ↓
Real Product Episode
    ↓
Result Record
    ↓
Current-slice audit
    ↓
CLOSE or one repair
```

Conditional side lanes:

```text
PLAN -> RESEARCH -> PLAN
CLOSE or budget breach -> RETROSPECT
```

Handover is generated data, not a reasoning service.

## Authority direction

```text
verbatim product intent and `docs/product/product-anchor.md`
-> active Slice Charter
-> exact Git facts and retained product evidence
-> Result Record
-> status, events, reports, and historical summaries
```

Lower layers cannot create roadmap work or weaken higher product truth.

## Responsibility layers

| Layer | Responsibility | Must not own |
|---|---|---|
| Model judgment | reversible engineering choices | irreversible external commitment |
| Repository facts | commands, architecture, conventions, current code | product roadmap authority |
| Role skills | reusable PLAN/WORK/AUDIT/RESEARCH/RETROSPECT procedure | deterministic correctness |
| Tests | mechanical correctness and regressions | product strategy |
| Hooks | deterministic invariants only | next-slice selection |
| Sandbox/external controls | blast radius, secrets, destructive effects | normal reversible workflow |

## Git execution architecture

The active user checkout is observation-only for slice execution. Git autopilot discovers repository facts, preserves the checkout, and creates a clean isolated worktree from the intended base.

```text
current checkout, possibly dirty
    ↓ preserve exactly
base and default-branch discovery
    ↓
clean isolated worktree
    ↓
deterministic slice branch
    ↓
edit -> Product Episode -> affected validation
    ↓
focused commit -> configured branch push
```

Prohibited operations include automatic stash, reset, clean, overwrite, force push, shared-history rewrite, and mixing unrelated user changes.

## Proof architecture

```text
Product proof
-> System proof
-> Release proof
```

- Product proof owns real user value.
- System proof owns reusable architecture and affected invariants.
- Release proof owns exact artifact and external operation.

Later proof levels cannot synthesize missing earlier proof.

## Module ownership

| Path | Purpose |
|---|---|
| `bin/` | thin CLI routing |
| `lib/commands/` | command handlers |
| `lib/` | implementation and deterministic controls |
| `templates/skills/` | on-demand role and reasoning skills |
| `templates/contracts/` | compact typed artifacts and deterministic contracts |
| `.meta-harness/` | current product state, local execution state, and installed templates |
| `tests/` | regression and invariant tests |
| `docs/product/` | product authority and roadmap |
| `docs/sop/` | operating procedure |
| `docs/ops/` | optional operational and historical evidence |

## Dependency direction

```text
bin/meta-harness.js -> lib/commands/*.js -> lib/*.js
tests/*.test.js -> lib/*.js or bin/meta-harness.js
lib/commands/*.js must not import from bin/
lib/*.js must not import from bin/
lib/*.js must not import from lib/commands/
templates/ are data, not imported runtime code
```

## Deletion architecture

Every non-security constraint must have an originating failure, regression fixture, last demonstrated value, and deletion condition. Stronger models should reduce active skills, hooks, phases, and reports over time.
