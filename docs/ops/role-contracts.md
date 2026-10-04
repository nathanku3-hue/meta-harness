# Agent Role Contracts

Canonical rules: [Meta Harness SOP](../sop/meta-harness-sop.md#pm-output-contract). These boundaries apply in agent-level `ship-fast` mode.

- **Codex orchestrator:** classifies the scenario, owns state and git preflight, delegates bounded patches, verifies evidence, and stops at authority gates.
- **Patch worker:** edits only assigned paths and returns patch evidence; never owns branch selection, audit approval, merge, reset, stash, clean, publish, or scope expansion.
- **Local orchestrator:** advances exactly one declared state after checking its gate; it does not reinterpret a failure as permission to continue.
- **Auditor:** emits only `APPROVED — <reason> -> <next state>` or a budgeted `BLOCK` closure with an actionable next gate; it does not materialize implementation.
- **Merger:** acts only with explicit merge authority after exact-head checks and required review pass.
- **PM:** an affirmative signal closes only a pure `HUMAN_TASTE` gate; it never silently clears authority, evidence, safety, git, or implementation gates.

Three information channels stay distinct: `PM_CLOSURE` is the human-facing status and decision surface; `ORCHESTRATOR_HANDOVER` is dense continuation state; `WORKER_REPORT` is exhaustive execution, validation, accountability, and evidence.

`PM_CLOSURE` is schema-first and uses the distributable `templates/contracts/human-handoff-contract.md` plus runtime `lib/human-handoff.js`. Normal completion, resumed completion, subagent aggregation, quiescent/`USE_PRODUCT`, and controlled drain completion must all become a HumanHandoffEnvelope, render deterministically, and pass the egress validator before user-visible output.

The complete HumanHandoffEnvelope retains status, reason, next-action context, locks, completion conditions, and rejected alternatives for structured hosts. Default user-visible text is a 2-4 line deterministic projection: result/blocker/action first, then the exact next action. Genuine owner input uses one `Need input — <question>` line plus a deterministic product-facing reason; `Decision needed` and the expanded `Where / Why now / Lock / Done when / Why not other candidates` form are not normal chat output. Resume state, worker state, review state, lifecycle labels, and ordinary reversible scheduling cannot manufacture owner attention.

Requested audits, reviews, and safety evidence are separate surfaces; they do not expand a PM closure into an audit packet. Workers may produce `REVIEW_SPECIMEN` or authorized `MATERIALIZED_IMPLEMENTATION`, never hide either inside a PM closure.

Status-only artifacts, expert packets, and approval packets do not count as shipped progress unless the requested product is status or reporting.

Final chat answers use the validated PM closure, not the worker-report artifact or orchestrator handover; raw worker text, hashes, paths, allowlists, command logs, resume narration, reviewer availability, and machine state dumps stay out unless the user explicitly requests audit evidence.
