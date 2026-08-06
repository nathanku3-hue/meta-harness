---
name: dirty-work-autopilot
description: Classify repo dirt for current scope, suppress or queue inherited/generated/nonblocking residue, and escalate only current-scope, boundary-touching, or decision-relevant dirt.
---

# Dirty Work Autopilot

Use this when repo dirt could distract the PM loop or confuse current-scope closure.

## Principle

Move dirt out of the PM loop unless it is current-scope, boundary-touching, or decision-relevant. Suppress or queue inherited, generated, unchanged, and nonblocking residue.

## Workflow

1. Take before/after snapshots when useful evidence is missing or stale.
2. Classify dirt by origin, scope, boundary, and whether the current task changed it.
3. Suppress or queue inherited outside-scope dirt, generated/cache artifacts, stale warnings, and unchanged nonblocking residue.
4. Escalate only current-scope dirt, boundary-touching dirt, changed inherited dirt, staged/outside-scope dirt, automation failures, or decision-relevant drift.
5. Return route, terminal outcome, visible dirt, evidence, next action, and queued/suppressed counts only.

## Product Routes

- `EXECUTE_NOW`: current-scope dirt is reversible and bounded, or only suppressed/queued residue exists; continue the accepted action now.
- `OWNER_ACTION_REQUIRED`: product direction, scope, taste, credentials, protected access, irreversible action, publication, or material-risk acceptance requires the owner.
- `BLOCKED`: retained evidence demonstrates that missing access, dependency, evidence, or boundary clearance prevents the supported journey.
- `NO_BUILD`: no active product action exists; keep residue outside the product loop and use the product.

A request to review dirt does not imply a pre-execution pause. Perform bounded diagnosis inline and continue with `EXECUTE_NOW` unless an owner-only boundary or demonstrated blocker is present. Post-execution review may inspect changed bytes and validation without approving a proposed plan.

## Outcomes

- `PASS_AND_CONTINUE`: the current action remains authorized.
- `REPAIR_IN_PLACE`: make the smallest correction inside the same task.
- `OWNER_ACTION_REQUIRED`: state the exact owner-only decision.
- `BLOCKED`: state the demonstrated blocker and smallest clearing action.
- `NO_BUILD`: no valid continuation warrant exists.

## Escalation Rules

1. Never self-approve authority-changing work; route it to `OWNER_ACTION_REQUIRED` or `BLOCKED`.
2. Escalate credential, provider, runtime, governed data, broker, scoring, dashboard, release, package, permission, and data-output dirt by path/status metadata.
3. Escalate inherited dirt that the current task removed, cleaned, staged, or changed unless explicitly allowlisted.
4. Do not escalate unchanged inherited outside-scope dirt, generated/cache artifacts, or repeated queued chores with unchanged state hash.
5. Do not show raw dirty-file lists in PM output.

## Optional Evidence Tools

```text
meta-harness dirty snapshot --out .meta-harness/snapshots/before.json
meta-harness dirty snapshot --out .meta-harness/snapshots/after.json
meta-harness dirty classify --before .meta-harness/snapshots/before.json --after .meta-harness/snapshots/after.json --scope .meta-harness/scope.json --out .meta-harness/dirty-work.json
meta-harness gate scope --dirty .meta-harness/dirty-work.json --scope .meta-harness/scope.json
```

## PM Output

```text
Route: <EXECUTE_NOW|OWNER_ACTION_REQUIRED|BLOCKED|NO_BUILD>
Outcome: <PASS_AND_CONTINUE|REPAIR_IN_PLACE|OWNER_ACTION_REQUIRED|BLOCKED|NO_BUILD>
Visible dirt: <current blockers/escalations/decisions or none>
Evidence: <snapshot/classification artifact or none>
Next: <one action and owner>
Queued/Suppressed: <counts only>
```

## Safety

Classify secret and provider-output dirt by path/status metadata. Do not read secret or provider-output contents.
