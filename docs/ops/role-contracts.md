# Agent Role Contracts

Current role authority: [Meta Harness SOP](../sop/meta-harness-sop.md). This short file preserves the shipped `ship-fast` compatibility contract and records the sequenced weak-epistemic-twin authority boundary; current roles live in the SOP.

Canonical rules: [Meta Harness SOP](../sop/meta-harness-sop.md#pm-output-contract). These boundaries apply in agent-level `ship-fast` mode.

- **Codex orchestrator:** classifies the scenario, owns state and git preflight, delegates bounded patches, verifies evidence, and stops at authority gates.
- **Patch worker:** edits only assigned paths and returns patch evidence; never owns branch selection, audit approval, merge, publication, or scope expansion.
- **Local orchestrator:** advances exactly one declared state after checking its gate; it does not reinterpret a failure as permission to continue.
- **Auditor:** emits only `APPROVED — <reason> -> <next state>` or a budgeted `BLOCK` closure with an actionable next gate; it does not materialize implementation.
- **Merger:** acts only with explicit merge authority after exact-head checks and required review pass.
- **PM:** an affirmative signal closes only a pure `HUMAN_TASTE` gate; it never silently clears authority, evidence, safety, git, or implementation gates.
- **Episode recorder:** appends immutable build, research, reading, question, decision, and outcome evidence; it cannot create instructions or assert mastery.
- **Learning compiler:** creates provisional knowledge deltas and candidate decision lessons only; it cannot approve its own output.
- **Learning evaluator:** owns transfer, boundary, and contradiction evaluation plus lesson challenge/retirement; it has no roadmap or action authority.
- **Mastery model:** records uncertain evidence of assisted action, independent action, explanation, prediction, transfer, decision, and direction generation; the human may correct it directly.
- **Frontier selector:** proposes at most one endgame-relevant question, explanation, prerequisite patch, test, or recommendation; it must remain silent when the result cannot change the active decision.
- **Discovery scout:** later recommends at most five duplicate-suppressed timeless-classic, frontier/SOTA, or justified prerequisite-bridge sources; it cannot ingest, promote, update mastery, or mutate policy.

Three information channels stay distinct: `PM_CLOSURE` is the adaptive human-facing status and decision surface; `ORCHESTRATOR_HANDOVER` is dense continuation state; `WORKER_REPORT` is exhaustive execution, validation, accountability, and evidence.

User-visible closure follows the adaptive SOP policy. Requested audits, reviews, and safety evidence are separate surfaces; they do not expand a PM closure into an audit packet. Workers may produce `REVIEW_SPECIMEN` or authorized `MATERIALIZED_IMPLEMENTATION`, never hide either inside a PM closure.

Status-only artifacts, expert packets, approval packets, learning briefs, and discovery feeds do not count as shipped progress unless the requested product is that artifact. Learning success requires transfer, better decision evidence, or reduced assistance; source volume and note count do not qualify.

Final chat answers use the adaptive closure, not the worker-report artifact or orchestrator handover; hide internal fields, hashes, paths, allowlists, and command logs unless the user asks for evidence.
