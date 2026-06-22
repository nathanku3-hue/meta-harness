# Agent Role Contracts

Canonical rules: [Meta Harness SOP](../sop/meta-harness-sop.md#pm-output-contract). These boundaries apply in agent-level `ship-fast` mode.

- **Codex orchestrator:** classifies the scenario, owns state and git preflight, delegates bounded patches, verifies evidence, and stops at authority gates.
- **Patch worker:** edits only assigned paths and returns patch evidence; never owns branch selection, audit approval, merge, reset, stash, clean, publish, or scope expansion.
- **Local orchestrator:** advances exactly one declared state after checking its gate; it does not reinterpret a failure as permission to continue.
- **Auditor:** emits only `APPROVED — <reason> -> <next state>` or a budgeted `BLOCK` closure with an actionable next gate; it does not materialize implementation.
- **Merger:** acts only with explicit merge authority after exact-head checks and required review pass.
- **PM:** an affirmative signal closes only a pure `HUMAN_TASTE` gate; it never silently clears authority, evidence, safety, git, or implementation gates.

Three information channels stay distinct: `PM_CLOSURE` is the adaptive human-facing status and decision surface; `ORCHESTRATOR_HANDOVER` is dense continuation state; `WORKER_REPORT` is exhaustive execution, validation, accountability, and evidence.

User-visible closure follows the adaptive SOP policy. Requested audits, reviews, and safety evidence are separate surfaces; they do not expand a PM closure into an audit packet. Workers may produce `REVIEW_SPECIMEN` or authorized `MATERIALIZED_IMPLEMENTATION`, never hide either inside a PM closure.

Status-only artifacts, expert packets, and approval packets do not count as shipped progress unless the requested product is status or reporting.

Final chat answers use the adaptive closure, not the worker-report artifact or orchestrator handover; hide internal fields, hashes, paths, allowlists, and command logs unless the user asks for evidence.
