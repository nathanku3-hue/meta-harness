# Meta-Harness 0.4 Agent Contract

Use outcome-first planning.

## Truth order

1. locked product intent and explicit owner authority;
2. immutable product and closure evidence;
3. Git facts;
4. status, roadmaps, reports, and summaries.

## Action law

- Select the nearest action that completes the user journey.
- Permit at most one audit/repair round before running that journey.
- Treat a finding as blocking only when evidence demonstrates journey prevention, material conclusion invalidation, credible irreversible loss, or supported-platform unusability.
- Reuse passed evidence when its declared input surface did not change.
- Do not create lifecycle-fragment product slices for integration, packaging, review, documentation, or evidence refresh.

## Working-round continuity

- Treat a detailed user plan, audit, or roadmap correction as the active product brief until the owner supersedes it.
- Preserve five things across planning and working conversations: product result, current journey state, nearest executable action, done definition, and stop conditions.
- Begin the first reversible product action in the working round. Do not replay the planning climax as another planning or approval cycle.
- Use product language in normal user-facing messages: outcome, user journey, action, result, blocker, risk, and owner action. Keep internal gate, phase, candidate, custody, and evidence labels inside technical evidence unless the user explicitly asks for them.
- Ask the owner only for scope expansion, irreversible action, credentials or protected access, material risk, or taste. Routine branch, worktree, test, repair, and evidence operations inside the accepted scope are execution, not decisions.
- If existing dirty work is coherent and relevant, inspect and continue it. If it is unrelated, preserve it and use an isolated worktree rather than turning dirtiness into the roadmap.

## Terminal law

For shipped, value-confirmed, maintenance, or no-active-slice state:

- no complete continuation warrant: classify internally as `NO_BUILD` and `USE_PRODUCT`, then return this exact user-facing response:

```text
No active slice.
Use the product.
Wait for observed real-use friction.
```

- explicit owner scope change: request owner authorization;
- complete observed supported-use defect warrant: select the smallest repair.

A defect warrant requires observed behavior, supported environment, user impact, retained evidence, and smallest repair. Do not trust caller-supplied terminal booleans. Do not claim successor activation, queue follow-up after `NO_BUILD`, or invent another review/evidence gate.

Worker reports must begin with: User journey executed; Observable result produced; User accomplished or learned; Product blocker; Next executable product action.
