# Meta-Harness 0.4 Agent Contract

Use outcome-first planning.

## Truth order

1. locked product intent and explicit owner authority;
2. immutable product and closure evidence;
3. Git facts;
4. status, roadmaps, reports, and summaries.

## Action law

- Select the nearest action that completes the user journey.
- Default pre-execution audit count: zero.
- Begin the nearest reversible in-scope action in the same round.
- A request to audit, review, or plan does not imply a pause. Unless the owner explicitly requests report-only work or says not to execute, perform any warranted diagnostic inline and continue toward execution in the same round.
- Permit one pre-execution audit only when a complete audit warrant identifies one concrete unresolved fact, the exact retained evidence already checked, one permitted blocking impact, the smallest bounded check, and how either result changes the selected action.
- One audit is the absolute ceiling. It is not a route, phase, approval requirement, gate, or reason to defer reversible execution.
- Do not request GO, plan approval, routine permission, or blanket ambiguity confirmation for reversible in-scope work.
- Treat a finding as blocking only when evidence demonstrates journey prevention, material conclusion invalidation, credible irreversible loss, or supported-platform unusability.
- Reuse passed evidence when its declared input surface did not change.
- Do not create lifecycle-fragment product slices for integration, packaging, review, documentation, or evidence refresh.

## Working-round continuity

- Treat a detailed user plan, audit, or roadmap correction as the active product brief until the owner supersedes it.
- Preserve five things across planning and working conversations: product result, current journey state, nearest executable action, done definition, and stop conditions.
- Begin the first reversible product action in the working round. Do not replay the planning climax as another planning or approval cycle.
- Use product language in normal user-facing messages: outcome, user journey, action, result, blocker, risk, and owner action. Keep internal gate, phase, candidate, custody, and evidence labels inside technical evidence unless the user explicitly asks for them.
- Ask the owner only for scope expansion, irreversible action, credentials or protected access, material risk, or taste. Routine branch, worktree, test, repair, and evidence operations inside the accepted scope are execution, not decisions.
- Preserve existing dirty work as evidence or owner state, but do not infer execution authority from cleanliness, path scope, or apparent coherence. For `meta-harness work`, NEW always gets a fresh controller-owned managed worktree; only an exact still-ACTIVE session may RESUME its owned generation.

## Coding-system law

- `meta-harness work` is the primary product path. Normal help and normal reporting must remain product-facing.
- ChatGPT/DevSpace direct sessions are not a Meta-Harness execution membrane. Without a mechanically admitted Meta-Harness task capability, treat the source checkout as read/diagnostic only: never edit, reset, clean, stash, stage, commit, push, or claim Meta-Harness execution authority from an arbitrary cwd. Route material owner work through supported `meta-harness` or ACP entry.
- Repository-root `PRODUCT.md` is owner-authored product direction. Pin exact bytes into every `work-session/v7`. Never generate, summarize, or overwrite it. Never mutate it through the worker path.
- `work-session/v7` is the complete active coding brief. The worker must consume it directly, receive product direction before local engineering context, and must not reconstruct product intent from status files or reopen broad planning.
- For repo-owned fresh work, recover active Claims first, then use at most one fresh read-only logical planner boot per exact WorldHead + owner-objective revision to propose the positive-value frontier up to repository active-Claim capacity. Repository active-Claim capacity is authority; local worker concurrency is throughput only. Capacity is a ceiling, not a quota; unused slots are correct when no additional positive-value Outcome exists. Planner input is reconstructed from durable truth; planner candidates are disposable semantics and never authority or continuity.
- Planner `expectedWritePaths[]` is only an exact footprint prediction. Boundary compilation may normalize equivalent syntax or reject the whole candidate; it may never silently widen or shrink the footprint. Atomic Claim admission decides conflicts separately, and Claim visibility is the durable commitment boundary.
- Start implementation immediately. Reversible edits, focused validation, bounded repair, and controller-owned workspace creation inside the session are already authorized.
- A NEW work session never inherits a mutable workspace. Seal an immutable base commit, create a fresh clean managed worktree with a new workspace identity, and execute there. RESUME is the only reuse path and requires exact ACTIVE workspace custody, generation, Git identity, dirty-manifest agreement, and the exclusive controller execution lease. Concurrent execution of one ACTIVE generation fails closed. Terminal workspace authority never returns even if its bytes are cleaned or restored.
- The coding worker remains read-only with respect to the workspace and emits `worker-result/v2`: bounded typed `WRITE`, `DELETE`, or `MOVE` proposals, or a zero-operation structured `STOP`. Meta-Harness validates/materializes proposals through the controller; a worker may stop executing but may not declare the Outcome blocked or route owner attention.
- The coding worker may not directly mutate workspace bytes, reset, clean, stash, revert, stage, commit, push, tag, publish, change branches, mutate worktree topology, or change `PRODUCT.md`.
- Reject traversal, symlink targets, duplicate or oversized proposals, changes outside `allowedPaths`, any `PRODUCT.md` mutation, Git-index mutation, HEAD movement, or branch changes.
- Run declared validation outside the model and return failures to the same session until its attempt budget is exhausted.
- Do not add compatibility aliases, recursive planner packets, RunSpec migrations, queues, daemons, swarms, or provider frameworks without a new observed product defect.

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

<!-- META-HARNESS:POST-PHASE-REFLECTION:BEGIN -->
## Meta-Harness post-phase reflection

When updating `E:\Code\post_phase_reflection.md`:

- Read Meta-Harness product intent before repository status or recent execution evidence.
- Record only durable cross-repository lessons that improve Meta-Harness, prompting, worker-auditor behavior, or tool boundaries.
- Do not use the file as a repository status report, execution log, test transcript, commit history, custody record, or duplicate roadmap.
- Repository-specific facts may appear only as the minimum evidence needed to support a reusable lesson.
- Keep detailed repository evidence in that repository's local status, worker report, or evidence directory.
- Every retained lesson must identify what failed or added friction, why it happened, product impact, cause class, smallest durable correction, and whether the correction belongs in Meta-Harness, repository-local guidance, or future prompting.
- Reject proposed harness work that does not unblock an active product outcome or prevent a repeated demonstrated failure.
<!-- META-HARNESS:POST-PHASE-REFLECTION:END -->
