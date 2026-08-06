# Meta-Harness 0.4 Outcome-First SOP

## Operating rule

Read locked product intent and explicit owner authority first. Read immutable product and closure evidence second, Git facts third, and status/report prose last. Resolve conflicts in that order.

## Product execution

1. State the observable product result.
2. Determine whether the complete user journey has run.
3. Select one nearest executable action.
4. Default the pre-execution audit count to zero and begin the nearest reversible in-scope action in the same round.
5. A request to audit, review, or plan does not imply a pause. Treat it as an inline diagnostic unless the owner explicitly requests report-only work or says not to execute.
6. Permit one pre-execution audit only with a complete warrant naming the unresolved fact, retained evidence checked, permitted blocking impact, smallest check, and how either result changes the action.
7. Treat one audit as the absolute ceiling, never a route, phase, approval requirement, gate, or reason to defer reversible execution.
8. Accept a blocker only with evidence of journey prevention, material conclusion invalidation, credible irreversible loss, or supported-platform unusability.
9. Keep optional findings as non-blocking residue.
10. Reuse passed evidence whose declared inputs did not change.
11. Continue the same functional slice through mechanics, integration, package, installed proof, isolated reviews, terminal assessment, publication observation, and closure.

## Terminal continuation

At shipped, value-confirmed, maintenance, or no-active-slice state:

- no warrant or incomplete warrant: `NO_BUILD`, `USE_PRODUCT`;
- explicit owner scope change: `OWNER_DECISION_REQUIRED`, `REQUEST_OWNER_AUTHORIZATION`;
- complete observed supported-use defect warrant: `BUILD_RECOMMENDED`, `SELECT_SMALLEST_REPAIR`.

The warrant must contain observed behavior, supported environment, user impact, retained evidence, and smallest repair. Never claim successor activation, queue follow-up after `NO_BUILD`, or add a review/evidence gate after closure.

## Worker evidence

Worker reports begin with the five product fields: User journey executed; Observable result produced; User accomplished or learned; Product blocker; Next executable product action. Internal outcome, round, confidence, validation, and accountability follow.

## PM output contract

Normal user-facing closure states the result and practical effect first, then a necessary reason, one remaining executable action, and one real owner decision when applicable. Omit empty fields and internal ceremony. Requested audits remain separate evidence surfaces.

## Release and deployment

Run focused product trials before the contribution commit. The sealed mechanics assessment runs the complete suite once. Build the authoritative package once, install it into one clean canary, and reuse the exact package through proof, publication, and clean-worktree rollout. Never install directly into dirty checkouts or non-product directories.
