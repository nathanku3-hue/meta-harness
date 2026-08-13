---
name: context-packet
description: Assemble a compact planning or review inspection packet from harness truth files; execution workers receive compiled ExecutionPermit authority instead.
---

# Context Inspection Packet

This skill is inspection-only. Do not use it to authorize a worker. `meta-harness work` compiles worker execution authority from the sealed work session and current repository/workspace facts into a single-use `execution-permit/v1`.

## Sources (read in order)

1. `.meta-harness/status.md`
2. `.meta-harness/phase-map.md`
3. `.meta-harness/events.jsonl` (last 5 events)
4. `.meta-harness/local/context/ROUND-NNN.json` (current gate output)
5. Relevant `.meta-harness/workers/*.md`
6. Relevant `.meta-harness/expert-packets/*`
7. `README.md`, `package.json` / `pyproject.toml` (stack detection)
8. Decision log entries relevant to current scope

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
- Never reinterpret a packet as execution authority; only a current, consumed ExecutionPermit authorizes a material worker attempt.
