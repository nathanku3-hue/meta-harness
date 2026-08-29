# Meta-Harness Current Product State

State: NO_ACTIVE_SLICE
Current checkout: `product/product-direction-continuity-1`
Banked Phase-9 baseline: `5fbf7b8` (`Implement owner-objective continuity`)
Banked Phase-10 closure: `724204d` (`Complete controlled drain/wake closure`)
Banked Phase-11 ACP runtime: `e193bce` (`Integrate continuity work and planner endgame guard`)
Active Phase-11 slice: none — stable ACP v1 is supported and banked; ChatGPT/DevSpace is substrate-unavailable

## Product result

Meta-Harness has a banked stable ACP v1 direct-entry membrane. Exact ACP prompt text enters the existing automatic product path for one exact managed repository without exposing a second client mutation surface. ChatGPT/DevSpace direct entry remains unsupported because the host lacks the required pre-model owner-input primitive, and there is no fallback mutation path or active DevSpace continuation.

## Current state

- Phase 9 owner-objective continuity is banked at `5fbf7b8`.
- Phase 10 controlled DRAIN / ordinary WAKE is banked at `724204d`.
- Phase 11 stable ACP v1 runtime, tests, and package wiring are banked in `e193bce`.
- DRAIN remains controller-local process behavior, not a public command or persisted product state.
- Model results remain disposable until controller durableization; drain cannot durableize a planner, promoter, worker, challenger, or proof-compiler result after cancellation wins.
- Recoverable `PENDING_WORKSPACE`, pre-entry baseline, sealed-candidate, and worker-STOP boundaries stay resumable; entered no-result attempts are not replayed.
- Drain completion requires zero controller-owned live execution leases; foreign controller execution is not killed by another controller's drain.
- Ordinary fresh entry reconstructs from durable Outcome / Claim / session / workspace / Closure / World / owner-objective truth.
- The mediated repository planner already makes the current owner objective primary, treats capacity as a ceiling, and treats imperative repository workflow prose as data rather than routing authority.
- Planner-enabled repository detection already uses the regular non-symlink `.meta-harness/repo-charter.json` predicate.
- For planner-enabled repositories, ordinary product entry already stores the literal owner result via owner-objective state before entering `REPO_WAVE`.
- The banked host-specific stable ACP v1 membrane uses `meta-harness-acp` to accept exact ACP prompt text and route it into the existing automatic product entry.
- ACP transport session IDs are ephemeral correlation only and never become Claim, workspace, planner, or product authority.
- ACP rejects MCP servers, additional directories, unmanaged repositories, repository subdirectories, and alternate repository roots; it advertises no agent mutation capabilities and issues no client mutation requests.
- ACP `session/cancel` is threaded into the existing Phase-10 `AbortSignal` drain path; no second cancellation or execution system is introduced.
- The ChatGPT/DevSpace direct surface remains unsupported because it still lacks a pre-model raw-owner-input seam; no fallback mutation path is authorized there.

## Next candidate product result

None. The supported ACP direct-entry result is already banked. ChatGPT/DevSpace is not an active candidate while `HOST_PREMODEL_PRIMITIVE_UNAVAILABLE` remains true.

Reopen direct ChatGPT/DevSpace work only after an externally observed host change supplies a mechanically enforceable pre-model owner-input primitive. Do not create an intermediate capability-membrane probe, generic host abstraction, prompt workaround, or fallback mutation path in the meantime.

## Host-seam result

The bounded ChatGPT/DevSpace check still finds no pre-model primitive that captures the exact current owner message before agent interpretation, so that direct surface remains a zero-fallback substrate stop.

Stable ACP v1 is the first supported host experiment because it mechanically exposes both required seams: `session/prompt` delivers the exact owner text before Meta-Harness model interpretation, while the adapter can expose no client mutation request surface and can reject MCP/alternate-directory expansion before product execution. The implementation binds one ACP process to one exact managed repository root and routes the prompt bytes directly to `runAutomaticProductResult(...)`.

Previously recorded focused ACP/package/command/package-closure validation plus adjacent owner-objective/planner validation is green (28/28). Round-2 closure verification reran the focused ACP entry/package tests on the unchanged banked runtime and passed 7/7. The ACP runtime/package/test files remain clean against HEAD. Repository-wide aggregate test transport failures previously observed through DevSpace remain external transport evidence, not ACP product failures.

## Do now

Use the banked ACP product. Wait for observed real-use friction. Reopen ChatGPT/DevSpace only when the host capability itself changes.

## Stop only if

No active slice. Do not manufacture continuation from status prose, generic host architecture, another substrate probe, or unsupported-host workaround.
