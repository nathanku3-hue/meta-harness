# Meta-Harness Current Product State

State: DIRECT_ENTRY_AUTHORITY_MEMBRANE_1_IMPLEMENTED_LOCAL
Current checkout: `product/product-direction-continuity-1`
Banked Phase-9 baseline: `5fbf7b8` (`Implement owner-objective continuity`)
Banked Phase-10 closure: `724204d` (`Complete controlled drain/wake closure`)
Active Phase-11 slice: `DIRECT_ENTRY_AUTHORITY_MEMBRANE_1` — stable ACP v1 host membrane implemented locally; not yet banked

## Product result

Meta-Harness can intentionally quiesce controller-owned live work without inventing a persistent shutdown lifecycle. A first cooperative drain stops new work, cancels local ephemeral model execution through the shared cancellation membrane, preserves exact recoverable durable boundaries, converts only entered no-result attempts into `ATTEMPT_ABORTED` / `EXECUTION_ABORTED`, lands terminal Closures, releases controller-owned execution leases, and returns only after local quiescence. Ordinary future `meta-harness` / `meta-harness work` entry is WAKE: it reconstructs from durable truth with no saved conversation or model session.

## Current state

- Phase 9 owner-objective continuity is banked at `5fbf7b8`.
- Phase 10 controlled DRAIN / ordinary WAKE is banked at `724204d`.
- DRAIN remains controller-local process behavior, not a public command or persisted product state.
- Model results remain disposable until controller durableization; drain cannot durableize a planner, promoter, worker, challenger, or proof-compiler result after cancellation wins.
- Recoverable `PENDING_WORKSPACE`, pre-entry baseline, sealed-candidate, and worker-STOP boundaries stay resumable; entered no-result attempts are not replayed.
- Drain completion requires zero controller-owned live execution leases; foreign controller execution is not killed by another controller's drain.
- Ordinary fresh entry reconstructs from durable Outcome / Claim / session / workspace / Closure / World / owner-objective truth.
- The mediated repository planner already makes the current owner objective primary, treats capacity as a ceiling, and treats imperative repository workflow prose as data rather than routing authority.
- Planner-enabled repository detection already uses the regular non-symlink `.meta-harness/repo-charter.json` predicate.
- For planner-enabled repositories, ordinary product entry already stores the literal owner result via owner-objective state before entering `REPO_WAVE`.
- Phase 11 now has a host-specific stable ACP v1 membrane: `meta-harness-acp` accepts exact ACP prompt text and routes it into the existing automatic product entry.
- ACP transport session IDs are ephemeral correlation only and never become Claim, workspace, planner, or product authority.
- ACP rejects MCP servers, additional directories, unmanaged repositories, repository subdirectories, and alternate repository roots; it advertises no agent mutation capabilities and issues no client mutation requests.
- ACP `session/cancel` is threaded into the existing Phase-10 `AbortSignal` drain path; no second cancellation or execution system is introduced.
- The ChatGPT/DevSpace direct surface remains unsupported because it still lacks a pre-model raw-owner-input seam; no fallback mutation path is authorized there.

## Next candidate product result

`DIRECT_ENTRY_AUTHORITY_MEMBRANE_1` would make a managed repository unable to acquire a second direct mutation authority merely because the owner entered through another coding surface.

```text
raw owner-input seam
+ default-deny capability seam
→ detect managed repository without topology mutation
→ preserve exact owner bytes before agent interpretation
→ invoke existing Meta-Harness product entry
→ expose only proven read-only host capabilities plus ingress
→ relay existing product result
```

The membrane must not become another planner, worker, objective schema, reviewer service, provider framework, persistent bridge state, or direct-edit fallback.

## Reaudit acceptance

The candidate is narrow enough only if the next implementation can prove all four observations without reopening planner architecture:

1. Quant-like imperative governance prose cannot capture direct entry; Meta-Harness chooses the work from the exact owner request.
2. Direct-host activity cannot alter repository authority state outside Meta-Harness: worktree bytes, Git index/refs/branches, worktree topology, `.meta-harness` control state, or publication/push custody; unknown capabilities fail closed.
3. If the host cannot establish the membrane or enter ordinary Meta-Harness work, it performs zero direct fallback mutation.
4. With no positive-value lawful Outcome, imperative governance prose still yields zero fresh Outcomes.

W6 per-arm irreversible eligibility is outside this slice unless today's mediated planner independently fails that falsification probe.

## Host-seam result

The bounded ChatGPT/DevSpace check still finds no pre-model primitive that captures the exact current owner message before agent interpretation, so that direct surface remains a zero-fallback substrate stop.

Stable ACP v1 is the first supported host experiment because it mechanically exposes both required seams: `session/prompt` delivers the exact owner text before Meta-Harness model interpretation, while the adapter can expose no client mutation request surface and can reject MCP/alternate-directory expansion before product execution. The implementation binds one ACP process to one exact managed repository root and routes the prompt bytes directly to `runAutomaticProductResult(...)`.

Focused ACP/package/command/package-closure validation plus adjacent owner-objective/planner validation are green (28/28). `git diff --check` is clean. Attempts to obtain one repository-wide aggregate `npm test` result are currently failing at the DevSpace connector transport with HTTP 502 before a trustworthy suite result is returned; that external transport failure is not counted as a product test failure.

## Do now

Keep the ACP membrane narrow. Finish only repository-owned validation/documentation needed to bank this slice; do not add a generic host/provider layer or mutate the unsupported ChatGPT/DevSpace surface.

## Stop only if

The proposed direct-entry solution requires a second executor, generic host/provider framework, target-repository governance rewrite, global agent-configuration mutation, write-enabled generic MCP expansion, direct fallback mutation, protected access, or another material authority expansion.
