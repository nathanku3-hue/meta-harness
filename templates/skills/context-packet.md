---
name: context-packet
description: Assemble a compact planning or review inspection packet from harness truth files; execution workers receive compiled ExecutionPermit authority instead.
---

# Context Inspection Packet

This skill is inspection-only. Do not use it to authorize a worker. `meta-harness work` compiles worker execution authority from the sealed work session and current repository/workspace facts into a single-use `execution-permit/v1`.

## Sources (read in order)

1. `PRODUCT.md` / explicit owner direction, when present
2. `.meta-harness/status.md`, when present
3. `.meta-harness/events.jsonl` (last 5 events), when present
4. Current context-gate artifact being inspected
5. `.meta-harness/phase-map.md` only when `.meta-harness/contracts/context-adoption.md` exists and the phase map is present; label it legacy compatibility evidence
6. `README.md`, `package.json` / `pyproject.toml` (stack detection)
7. Decision log entries relevant to current scope

Relevant `.meta-harness/workers/*` and `.meta-harness/expert-packets/*` remain related inspection files, not authority sources.

## Packet Sections

1. **Goal** - one sentence from gate's product_outcome
2. **Scope** - owned files, forbidden files, out-of-scope
3. **Stack** - runtime, framework, test command
4. **Evidence required** - what proves done
5. **Stop rules** - when to stop instead of improvise
6. **Decisions** - relevant prior decisions by ID
7. **Freshness** - any docs/API uncertainty flags

## Rules

- Audience is `review` or `planning`; standalone `worker` packets are retired.
- Max 3 pages equivalent.
- No raw chat logs.
- Stale or low-freshness packets are inspection-only and must carry warnings.
- If gate verdict was `narrowed`, packet must state the narrowed scope explicitly.
- Context-gate material is compatibility/inspection evidence only. Explicit owner direction, current World / Claims, and sealed work-session / ExecutionPermit authority outrank it.
- An unadopted repository never gains legacy lifecycle semantics merely because a stale `phase-map.md` exists.
- Never reinterpret a packet as execution authority; only a current, consumed ExecutionPermit authorizes a material worker attempt.
