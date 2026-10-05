# Architecture Map

## Module Ownership

| Path | Owner | Purpose |
|---|---|---|
| bin/ | nathanku3-hue | CLI entry point (thin router only) |
| lib/commands/ | nathanku3-hue | Command handlers |
| lib/ | nathanku3-hue | Shared implementation modules |
| templates/contracts/ | nathanku3-hue | Installable contract templates |
| templates/skills/ | nathanku3-hue | Installable skill templates |
| .agents/skills/ | nathanku3-hue | Active repo skills |
| .meta-harness/ | nathanku3-hue | Tracked truth and local state |
| tests/ | nathanku3-hue | Test suites |
| docs/ | nathanku3-hue | Product and architecture docs |

## Dependency Direction

```text
bin/meta-harness.js -> lib/commands/*.js -> lib/*.js
tests/*.test.js -> lib/*.js or bin/meta-harness.js
lib/commands/*.js must not import from bin/
lib/*.js must not import from bin/
lib/*.js must not import from lib/commands/
templates/ are data, not imported code
```

## Public Surface

The public CLI surface is defined by `lib/command-registry.js`.
The check-ID surface is defined by `lib/check-id-registry.js`.
Architecture changes that add commands or check families must update this map and the owning registry together.

## Human Presentation Boundary

Human-facing completion follows one-way dependency flow:

```text
product facts -> HumanHandoffEnvelope -> presentation-router -> renderer/host
```

`lib/text-presentation.js` is the default user-facing projection. It compresses a validated human handoff into 2-4 deterministic text lines and may not mutate or reinterpret semantic fields. `lib/presentation-router.js` remains a pure projection layer for renderer-neutral TEXT/DIAGRAM/APP data; it must not import command handlers, mutate repository state, create owner decisions, alter validation, or persist presentation output as product truth. Normal CLI output is text-only. Structured hosts retain the full envelope alongside the compact text projection.

The implementation contracts for this boundary are `docs/product/presentation-router-cut.md` and `docs/product/text-presentation-cut.md`.

## Model Control Boundary

Model-generated product reasoning is checked before it can be mistaken for controller state:

```text
runtime skill -> structured model output -> model-control guard -> controller execution/effect boundary
```

`lib/model-control-boundary.js` is a narrow deterministic guard over model-authored control-bearing text. It rejects history-derived consent stalls, model self-authorization, and methodology-as-authority phrasing at the logical-planner, coding-worker, and read-only interaction boundaries. It does not inspect arbitrary code/file payloads or raw evidence, and it does not infer genuine owner effects. Only the controller-owned typed `ownerEffect` path may create required human input at an exact physical consequence boundary.

The implementation contract is `docs/product/model-control-boundary-cut.md`.
