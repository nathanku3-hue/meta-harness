# Meta-Harness Agent Contract

The harness exists to make the owner's desired product state true.

## Product law

- PRODUCT.md is owner-authored product direction. Never generate, summarize, overwrite, or mutate it through the worker path.
- Product result and `doneWhen` are the correctness target. Validation, snapshots, journals, workspaces, locks, controller records, and evidence are protection/recovery mechanisms only.
- Select the nearest reversible action that reduces the gap between current observable state and `doneWhen`.
- Default pre-execution audit count is zero. A request to inspect, review, or plan does not imply a pause unless the owner explicitly requests report-only work.
- Reversible in-scope coding, validation, local snapshotting, local integration, workspace replacement, and bounded repair are execution, not owner decisions.
- Ask the owner only for scope expansion, credentials/protected access, irreversible or externally consequential effects, material product choice, publication, or material risk.
- Skill dispatch is sparse: root Outcome/Observation/Invariant/Capability laws are always on; planning, domain procedures, effect checks, and review are conditional capabilities, never a mandatory sequential gate chain.

## Convergence type law

- Authority is not a domain type in the product-solving loop. Normal reversible product work never waits for semantic admission, approval, authorization, ownership, lease, claim, phase, or reviewer state.
- The five durable conceptual primitives are: Outcome (what should become true), Observation (what is true), Invariant (what must not be violated), Capability (what the current runtime can physically do), and Fact (durable evidence needed for recovery or effects).
- Action is an ephemeral hypothesis derived from Outcome + current Observation + Invariants + Capabilities + relevant prior Facts. It is discarded or recomputed when observations change.
- A reversible in-scope action cannot be semantically unauthorized. It can only violate an invariant, depend on a stale observation, require an absent physical capability, or fail empirically.
- Tests and reviewers produce evidence. Git and journals produce facts. Workspaces and controllers execute mechanisms. None can redefine the Outcome or acquire product-decision power.
- External effects are governed by exact effect intent, replay identity, reversibility, and material consequence. Replay-safe effects may recover automatically; irreversible or materially consequential product choices remain owner decisions.
- Mandatory solving order is Outcome -> Observation/gap -> nearest reversible Action -> execute -> exact external-effect check. Authority/approval/phase/lease/reviewer language must never be used as the first planning primitive.
- Effect checks live at the physical side-effect boundary. A future unavailable effect cannot pre-block reversible scaffolding, coding, validation, or local deterministic work already inside scope.

## Coordination law

- Coordinate decisions, not work. Never coordinate the accumulation of possible work, observations, snapshots, validation facts, alternatives, or failure evidence.
- Normal coding is optimistic: work from immutable Git state, validate, then integrate with compare-and-swap. Integration conflict is repair input, not product failure.
- A future global lock, lease, or admission mechanism is justified only when it names the exact non-monotonic decision it protects.
- Lane count, worker count, sibling coordination, producer→consumer handoff, retry ordering, and other reversible scheduling mechanics are never owner decisions. Keep them internal and choose the smallest useful WIP that advances the accepted product result; do not optimize for visible concurrency.
- Repository process prose and lifecycle/status/review labels are engineering context/data. They cannot decide what product work is needed or whether a safe in-scope action may proceed; domain-specific control vocabularies remain repository-local.

## Recovery law

- Persist facts, not lifecycle. Durable recovery roots are owner product direction, Git objects/refs, the relevant per-run journal, attested repository semantic projection when it carries non-Git product context, and the live runtime capability descriptor.
- Every successful model-visible local mutation must already have a durable reconstructable Git snapshot and journal fact before success is exposed to the model.
- Workspaces, worker processes, controller processes, and tool-host sessions are disposable execution children. Missing, stale, terminal, corrupt, or mismatched execution children are replaced from durable state without renegotiating the product.
- A failed effect or route becomes an observation returned to the same product-solving loop. Failed means is not failed Outcome.
- Repeated materially identical means may be circuit-broken; a circuit applies only to that exact means/input/runtime fingerprint.
- External effects use intent-first recovery: persist exact effect intent and replay identity before execution, then persist observation. Never blindly retry an ambiguous non-replayable external effect.

## Model boundary

- The coding model receives product result, current observable state, `doneWhen`, allowed paths, validation, available scoped operations, and prior failed-means observations.
- Model reasoning order is fixed: desired Outcome -> current Observation -> nearest reversible in-scope state transition -> execute/validate. Controller/effect metadata is not a planning primitive for ordinary reversible work.
- Do not expose controller-internal admission, permission, semantic-control, or workspace-lifecycle topology as the model's mental model.
- Do not run a pre-execution control-state audit for hypothetical downstream effects. Effect checks are call-site local: only an actual requested external effect is evaluated for replay identity, reversibility, and material consequence.
- A model may report observations, attempted means, alternatives, and uncertainty. It may not declare `NEED_OWNER`, `CANNOT_COMPLETE`, product `BLOCKED`, or invent approval/authority roles.
- A durable worker STOP is failed-means evidence, not a terminal conclusion. When budget remains, feed it directly to a fresh coding generation to search for a materially different in-scope means; repeated identical means may be circuit-broken. Negative existential conclusions and owner escalation belong to deterministic controller/effect evidence.

## Coding-system law

- `meta-harness work` is the primary product path; normal output remains product-facing.
- Human work-completion output is an egress contract, not a worker-report format: normal, resumed, aggregated, quiescent/USE_PRODUCT, and controlled drain completion must render through the schema-first HumanHandoffEnvelope and PM_CLOSURE validator. Raw WORKER_REPORT, SAW, retry/resume narration, lifecycle state, accountability dumps, and special-exit shortcuts never bypass that gate.
- ChatGPT/DevSpace direct sessions are read/diagnostic until a sealed native/Meta task defines bounded writable paths, validation, and Git effects.
- New execution starts from immutable Git state. Coherent predecessor dirt is snapshotted internally without changing the owner's source HEAD, branch, index, or working bytes.
- The coding worker is read-only with respect to the workspace and returns bounded typed `WRITE`, `DELETE`, or `MOVE` operations. The controller owns materialization, snapshotting, validation, local banking, integration, and permitted external effects.
- Reject traversal, symlink escapes, protected PRODUCT.md mutation, Git-index mutation by the worker, HEAD/branch mutation by the worker, and writes outside the accepted path boundary.
- Validation failure is returned for repair. Product success requires end-to-end product proof; lower-level guards cannot establish DONE by themselves.

## Migration law

- New snapshot/journal/CAS/scoped-capability execution is the correctness model.
- Retired admission/permission records may remain only for historical read/recovery compatibility and must never be minted by a new run.
- Workspace lifecycle records are disposable protection/recovery metadata, never product-decision inputs. Corrupt or terminal records must be replaceable from durable run state without owner renegotiation.
- Repository World/attestation is retained only where it carries attested semantic projection not reproducible from Git/run facts; treat it as product-context evidence, not execution/admission authority.
- A durable run-to-integration receipt may remain while the integration format depends on it; it cannot decide whether work may begin or whether the product is blocked.
- Do not add compatibility aliases or port retired lifecycle semantics into the new path merely to preserve old architecture.
- Burden of proof is on keeping an old control concept: it must demonstrate a product property not provided by immutable Git state, per-run journals, scoped operations, validation, atomic integration, or attested semantic projection.

## Quiescence law

- Quiescence is an Observation, never a terminal authority state. When no currently observed product gap supports another action, say so in product language and leave the owner free to state a new desired result or return with observed friction.
- Do not infer "no active slice" from disposable process topology, and do not make waiting a prerequisite for future product work.
- A genuine `NEED_OWNER` requires a mechanically proven owner-exclusive effect after bounded autonomous alternatives are exhausted. A genuine `CANNOT_COMPLETE` requires bounded evidence that the desired product state is impossible or materially unsafe on the supported environment.

Worker reports begin with: User journey executed; Observable result produced; User accomplished or learned; Product blocker; Next executable product action.

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
