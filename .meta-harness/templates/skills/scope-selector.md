---
name: scope-selector
description: Select the nearest complete product action from authority-ordered truth.
---

# Outcome-First Scope Selector

## Authority-ordered inputs

1. Locked product intent and owner-signed acceptance.
2. Immutable product, closure, package, proof, and mechanics evidence.
3. Git facts and changed dependency surfaces.
4. Status, roadmaps, reports, and summaries last.

Resolve conflicts in favor of the higher source. Status cannot create work when higher authority says the product is closed.

## Selection

Name:

```text
Product result: <observable user outcome>
Journey state: <not run|partial|complete>
Primary action: <nearest complete action>
Affected evidence: <only gates whose inputs changed>
Demonstrated blockers: <list or none>
```

Default pre-execution audit count: zero. When the journey has not run, begin the nearest reversible in-scope action in the same round.

A request to audit, review, or plan does not imply a pause. Unless the owner explicitly requests report-only work or says not to execute, perform any warranted diagnostic inline and continue toward execution. Permit one pre-execution audit only when a complete warrant names the unresolved fact, retained evidence checked, permitted blocking impact, smallest check, and how either result changes the selected action. One audit is the absolute ceiling, not a route, phase, approval requirement, gate, or pause.

Do not request GO, plan approval, routine permission, or blanket ambiguity confirmation. Select one functional slice that owns implementation through terminal closure; do not create acceptance-only, integration-only, packaging-only, review-only, documentation-only, or evidence-refresh product slices.

A blocker requires evidence of journey prevention, material conclusion invalidation, credible irreversible loss, or supported-platform unusability. Everything else is non-blocking residue.

Reuse passed evidence when its declared input surface is unchanged. Rerun only the affected check unless new concrete evidence demonstrates a product-relevant defect.

## Working-round carryover

Treat the accepted plan or audit correction as the active product brief. Carry these five fields unchanged into the working round:

```text
Product result: <observable user outcome>
Journey state: <not run|partial|complete>
Do now: <nearest reversible action>
Done when: <observable completion>
Stop only if: <material blocker or authority expansion>
```

Begin `Do now` before opening another planning cycle. Routine branch, worktree, test, repair, and evidence actions inside the accepted scope are execution, not owner decisions. When a fresh worker conversation can be launched directly, pass the exact sealed brief without asking the owner to copy it, require the worker to change one reversible in-scope byte in its first round, and retain `taskId` as the only required continuation input. Normal user-facing updates use product and risk language; internal gate, phase, candidate, custody, and evidence labels stay in technical evidence unless explicitly requested.

## Terminal stop

For shipped, value-confirmed, maintenance, or no-active-slice state:

- no warrant or incomplete defect warrant → `NO_BUILD`, `USE_PRODUCT`;
- explicit owner scope change → `OWNER_DECISION_REQUIRED`, `REQUEST_OWNER_AUTHORIZATION`;
- complete observed supported-use defect warrant → `BUILD_RECOMMENDED`, `SELECT_SMALLEST_REPAIR`.

Never claim successor activation after closure. Never queue follow-up work after `NO_BUILD`.
