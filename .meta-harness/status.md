# Meta-Harness Current Product State

State: CONTROLLED_DRAIN_WAKE_1_BANKED
Current checkout: `product/product-direction-continuity-1`
Banked Phase-9 baseline: `5fbf7b8` (`Implement owner-objective continuity`)
Banked Phase-10 closure: `724204d` (`Complete controlled drain/wake closure`)
Next candidate: `DIRECT_ENTRY_AUTHORITY_MEMBRANE_1` — direction accepted; ChatGPT/DevSpace raw-input seam unavailable, runtime stopped

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
- No Phase-11 runtime code has been started by the current planning patch.

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

The bounded ChatGPT/DevSpace check found no pre-model primitive that captures the exact current owner message before agent interpretation. Prompt-related connector operations occur only after an assistant/tool decision and therefore cannot supply the required raw-input seam. No Phase-11 runtime membrane was started and no direct fallback mutation is authorized.

This is a substrate stop, not a planner defect or Phase-10 reopening. The authority-membrane architecture remains a valid future experiment on a host that mechanically exposes both raw-input capture and default-deny mutation-capability suppression.

## Do now

No ChatGPT/DevSpace runtime implementation for this slice. Resume only if this substrate gains a mechanically provable raw-owner-input seam, or if the owner explicitly authorizes a different host adoption experiment.

## Stop only if

The proposed direct-entry solution requires a second executor, generic host/provider framework, target-repository governance rewrite, global agent-configuration mutation, write-enabled generic MCP expansion, direct fallback mutation, protected access, or another material authority expansion.
