---
name: dirty-work-autopilot
description: Classify dirty work, queue or suppress nonblocking residue, and escalate only current-scope or safety-relevant dirt.
---

# Dirty Work Autopilot

Use this when repo dirt could distract the PM loop or confuse current-scope closure.

## Principle

Move dirty work out of the PM loop unless it blocks the current scope, requires approval, touches credential/provider/data/runtime/governance boundaries, changes product or architecture taste, or automation failed.

## Workflow

1. Take a before snapshot.
2. Execute the bounded task.
3. Take an after snapshot.
4. Classify after-state and before-only dirt against owned scope.
5. Queue or suppress nonblocking inherited/generated dirt.
6. Escalate only decision-relevant dirt.
7. Return a PM summary, not a raw dirty-file list.

## Commands

```text
meta-harness dirty snapshot --out .meta-harness/snapshots/before.json
meta-harness dirty snapshot --out .meta-harness/snapshots/after.json
meta-harness dirty classify --before .meta-harness/snapshots/before.json --after .meta-harness/snapshots/after.json --scope .meta-harness/scope.json --out .meta-harness/dirty-work.json
meta-harness gate scope --dirty .meta-harness/dirty-work.json --scope .meta-harness/scope.json
```

## PM Output Rule

Report classification summary, blockers, decisions, and evidence artifacts only. Do not repeat inherited outside-scope dirt unless its state changes or it becomes decision-relevant.

## Safety

Classify credential, provider, runtime, governed data, broker, scoring, dashboard, and data-output dirt by path/status metadata. Do not read secret or provider-output contents to classify it.
