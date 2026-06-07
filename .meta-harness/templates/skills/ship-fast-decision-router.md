---
name: ship-fast-decision-router
description: Route dirty-work classifications into reusable user decisions and a compact PM brief only when decision routing is relevant.
---

# Ship-Fast Decision Router

Use this only when dirty-work classification has produced current-scope decisions, blockers, or escalations.

## Principle

Ask the user only for reusable decisions. Keep queued residue, generated artifacts, stale warnings, and raw dirty-file lists out of the user loop.

## Workflow

1. Run `meta-harness dirty classify` after the dirty snapshots are ready.
2. Let `dirty classify` import only `DECISION` classifications into `.meta-harness/decision-inbox.json`.
3. Render the PM brief with `meta-harness brief pm`.
4. Present open decisions, blockers/escalations, evidence, and the next action.
5. Do not present `QUEUE`, `PASS`, suppressed residue, or raw dirty classifications as user decisions.

## Commands

```text
meta-harness decisions list --in .meta-harness/decision-inbox.json
meta-harness decisions resolve --id <id> --resolution <approved|rejected|deferred>
meta-harness brief pm --dirty .meta-harness/dirty-work.json --decisions .meta-harness/decision-inbox.json --out .meta-harness/pm-brief.md
```

## PM Brief Rule

The PM brief is bounded: show at most 10 open decisions and 10 blocker/escalation paths, then report remaining counts. Show queued and suppressed work as counts only.

Evidence paths are supporting proof, not decision identity. Do not reopen a decision just because an evidence path changed.
