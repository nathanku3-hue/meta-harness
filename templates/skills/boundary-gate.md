---
name: boundary-gate
description: Evaluate one actual external, protected, irreversible, or materially consequential effect at its physical call boundary. Never use as a general pre-execution gate.
---

# Physical Effect Boundary Gate

Use this skill only when the **next physical operation itself** would create an external/protected/irreversible/material consequence, or when the request explicitly expands product scope.

Do not invoke it for planning, local edits, tests, deterministic transforms, local validation, scaffolding, dry-runs, or other reversible in-scope work. A possible future effect never pre-blocks those actions.

## Inputs

Read only what is needed to classify the exact call:

- the sealed product result and current action;
- the exact effect being attempted;
- the narrow policy/invariant governing that effect;
- existing exact effect intent or owner decision, when already present.

Do not begin from broad lifecycle/status/control-state audits.

## Classification Contract

Classify the **current physical call**, not the whole work round:

```text
ALLOWED: <call> | Reason: <reversible, replay-safe, or exact existing decision covers it>
EXPLICIT_APPROVAL: <call> | Reason: <owner-only scope/product/risk/credential/publication choice is required now>
BLOCKED: <call> | Reason: <hard invariant or demonstrated safety constraint forbids this exact effect>
NOT_RELEVANT: <call> | Reason: <this is not an effect boundary; continue reversible work>
```

## Gate Rules

1. Existing exact effect intent is consumed silently; never ask for the same decision twice.
2. `EXPLICIT_APPROVAL` applies only to the exact owner-exclusive effect now being attempted, not to earlier reversible work.
3. `BLOCKED` stops only the forbidden physical call. Preserve completed work and continue independent reversible work when useful.
4. Missing capability for a later effect is an observation, not a reason to stop current reversible work.
5. Repository phase/review/status labels are context; they are not substitute evidence that a physical effect is blocked.

## Output Rules

Lead with the classification of the exact call. Surface boundary prose only when an effect is actually reached or the user explicitly asks about it.
