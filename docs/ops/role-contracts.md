# Agent Role Contracts

Canonical rules: [Meta Harness SOP](../sop/meta-harness-sop.md#pm-output-contract). These boundaries apply in agent-level `ship-fast` mode.

- **Codex orchestrator:** classifies the scenario, owns state and git preflight, delegates bounded patches, verifies evidence, and stops at authority gates.
- **Patch worker:** edits only assigned paths and returns patch evidence; never owns branch selection, audit approval, merge, reset, stash, clean, publish, or scope expansion.
- **Local orchestrator:** advances exactly one declared state after checking its gate; it does not reinterpret a failure as permission to continue.
- **Auditor:** emits only `APPROVED — <reason> -> <next state>` or a budgeted `BLOCK` closure with an actionable next gate; it does not materialize implementation.
- **Merger:** acts only with explicit merge authority after exact-head checks and required review pass.
- **PM:** an affirmative signal closes only a pure `HUMAN_TASTE` gate; it never silently clears authority, evidence, safety, git, or implementation gates. For S-006M the PM owns the target lock: real user, job, specialist judgment generic coding cannot replace, and observable result.

Three information channels stay distinct: `PM_CLOSURE` is the adaptive human-facing status and decision surface; `ORCHESTRATOR_HANDOVER` is dense continuation state; `WORKER_REPORT` is exhaustive execution, validation, accountability, and evidence.

User-visible closure follows the adaptive SOP policy. Requested audits, reviews, and safety evidence are separate surfaces; they do not expand a PM closure into an audit packet. Workers may produce `REVIEW_SPECIMEN` or authorized `MATERIALIZED_IMPLEMENTATION`, never hide either inside a PM closure.

Status-only artifacts, expert packets, and approval packets do not count as shipped progress unless the requested product is status or reporting.

Under active D085, the verifier independently accepts code, scope, custody, tests, and observable behavior. The first shipment requires specialist knowledge to materially shape the output but does not claim independent domain correctness, generalization, or real-world value. That claim ceiling must be present in the merged and packaged artifact. A concrete harness blocker is repaired only inside the same R3 slice before acceptance; post-shipment domain validation or replication is the exclusive R6 responsibility.

The merger may close `MERGED + PACKAGED` after package verification. `PUBLISHED`, deployed, live-capital, broker, credential, or public-performance states require a separate named human gate and may not be inferred from package creation.

Final chat answers use the adaptive closure, not the worker-report artifact or orchestrator handover; hide internal fields, hashes, paths, allowlists, and command logs unless the user asks for evidence.
