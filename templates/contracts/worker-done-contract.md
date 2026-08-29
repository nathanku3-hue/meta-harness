# Outcome-First Worker Report Contract

Status: Meta-Harness 0.4 distributable contract
Purpose: record the user journey and observable product result before internal execution metadata.

## Required leading fields

The first five non-empty lines of every generated worker report are exactly:

```text
User journey executed: <the complete journey actually run>
Observable result produced: <what the user can now observe or use>
User accomplished or learned: <the practical user outcome>
Product blocker: <demonstrated blocker or none>
Next executable product action: <nearest action, USE_PRODUCT, or none>
```

Only after those five lines may the report include:

```text
Outcome: <DONE|PARTIAL_WITH_EXPLICIT_SCOPE|REJECTED>
Round: <round or not recorded>
Progress: <value or not recorded>
Confidence: <value or not recorded>
Worker: <worker-id>
Stream: <stream>
Task: <bounded task>
Updated: <ISO timestamp>
```

`Outcome:` is evidence metadata, not the product result. No title, hash, command log, reviewer note, or status field may precede the five required product fields.

## Legacy compatibility boundary

The internal worker-report CLI may continue accepting legacy lifecycle and decision inputs, and machine event records may retain `phase`, `ship_gate_tier`, and `task_resolution` for compatibility. Newly generated Markdown worker reports must not render `Phase:`, `Ship gate tier:`, `Task resolution:`, `## What decision is needed`, or `Decision needed from user:`. Historical reports are not migrated.

Those compatibility values do not grant product, planner, Outcome, Claim, work-session, ExecutionPermit, worker, or owner authority.

## Completion law

- `DONE` requires an executed user journey and an observable result.
- A blocker is valid only when evidence demonstrates journey prevention, material conclusion invalidation, credible irreversible loss, or supported-platform unusability.
- Preferences, optional cleanup, additional review, stale status, and already-passed unaffected gates are non-blocking.
- Reuse passed evidence when its declared dependency surface is unchanged.
- After shipped or value-confirmed completion, return `USE_PRODUCT`; do not queue another build unless the owner explicitly changes scope or a complete observed supported-use defect warrant exists.
- `PARTIAL_WITH_EXPLICIT_SCOPE` and `REJECTED` require a concrete product blocker.
- Silent documentation-only fallback from requested implementation, execution, validation, or data-output work is forbidden.

## Supporting sections

After metadata, include only useful sections: what changed, why it matters, blocker, next action, validation/evidence, and accountability. The normal chat closure remains concise and must not paste the full report unless requested.
