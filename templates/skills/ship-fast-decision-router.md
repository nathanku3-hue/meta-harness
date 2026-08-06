---
name: ship-fast-decision-router
description: Route directly to the nearest user outcome while preserving authority and terminal stop conditions.
---

# Outcome-First Ship-Fast Router

## Route order

1. Reconcile locked intent and explicit owner authority; read status and summaries last because they cannot create work.
2. Determine whether the complete user journey has run.
3. Choose the nearest reversible action that produces the observable result.
4. Retain only demonstrated blockers.
5. Reuse unaffected passed evidence.
6. Stop when the product is shipped or value-confirmed.

## Routes

- `EXECUTE_NOW`: begin the nearest reversible authorized action in the same round and carry it through the complete journey.
- `OWNER_ACTION_REQUIRED`: product direction, scope, taste, credentials, protected access, irreversible action, publication, or material-risk acceptance requires the owner.
- `BLOCKED`: retained evidence demonstrates journey prevention, material conclusion invalidation, credible irreversible loss, or supported-platform unusability.
- `NO_BUILD`: the product is already complete or no valid continuation warrant exists; primary action `USE_PRODUCT`.

Default pre-execution audit count: zero.

A request to audit, review, or plan does not imply a pause. Unless the owner explicitly requests report-only work or says not to execute, perform any warranted diagnostic inline and continue with `EXECUTE_NOW`.

One pre-execution audit is permitted only when a complete audit warrant contains:

```json
{
  "unresolvedFact": "The exact concrete unknown",
  "evidenceChecked": ["Specific retained evidence"],
  "potentialImpact": "journey prevention|material conclusion invalidation|credible irreversible loss|supported-platform unusability",
  "smallestCheck": "One bounded check",
  "decisionChangedByResult": "How either result changes the action"
}
```

Missing any field means no audit. One audit is the absolute ceiling. It is not a route, phase, approval requirement, gate, or reason to defer reversible execution. Do not request GO, plan approval, routine permission, or blanket ambiguity confirmation.

## Fresh worker handoff

When direct fresh-conversation launch capability is available and requested, launch exactly one worker conversation with the exact sealed task brief. Do not ask the owner to copy or paste the brief. Require the worker to begin one reversible in-scope change in its first round and retain `taskId` as the only required continuation input.

If the launcher is unavailable or blocked, report Web-flow evidence as unverified and continue authorized repository work. Do not convert launcher unavailability into a routine owner gate.

## Valid blockers

Only demonstrated journey prevention, material conclusion invalidation, credible irreversible loss, or supported-platform unusability block. State the evidence source and impact. Preferences and speculative risks remain non-blocking.

## Evidence reuse

A passed gate remains passed while its input surface is unchanged. Rerun only the changed gate unless new concrete evidence shows a product defect.

## Continuation

After completion:

- default → `NO_BUILD`, `USE_PRODUCT`;
- owner changes scope → `OWNER_ACTION_REQUIRED`;
- complete observed supported-use defect warrant → `EXECUTE_NOW` with the smallest repair.

Do not emit `FOLLOW_UP_QUEUED` after `NO_BUILD`, claim successor activation, or add review/evidence gates after closure.

## Output

```text
Product result: <observable outcome>
Route: <EXECUTE_NOW|OWNER_ACTION_REQUIRED|BLOCKED|NO_BUILD>
Primary action: <one action>
Blocking findings: <demonstrated findings or none>
Non-blocking residue: <optional findings or none>
Next: <one executable action or USE_PRODUCT>
```
