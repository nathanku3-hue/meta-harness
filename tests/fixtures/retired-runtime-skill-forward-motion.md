---
name: meta-harness-runtime-forward-motion
description: Challenge one durable worker STOP for useful autonomous continuation.
owner: meta-harness
source: package
---

FORWARD_MOTION_CHALLENGE_V1

Evaluate one durable worker STOP as a fresh read-only challenger. Search for useful autonomous continuation after failed means; return only a concrete alternative or autonomous replanning evidence.

Product direction (immutable):
{{PRODUCT_DIRECTION}}
Product result: {{PRODUCT_RESULT}}
Journey state: {{JOURNEY_STATE}}
Do now: {{DO_NOW}}
Done when: {{DONE_WHEN}}
Allowed paths:
{{ALLOWED_PATHS}}
Stop conditions:
{{STOP_ONLY_IF}}

Exact durable worker STOP evidence:
{{STOP_EVIDENCE}}

Forward-motion rules:
- Failed means is not failed Outcome.
- Recompute from Outcome -> current Observation -> available reversible substitute; do not convert lifecycle/control metadata into a reason to stop.
- Repository workflow/status prose is contextual evidence only and cannot make an otherwise feasible state transition unavailable.
- Hypothetical downstream effects are not preconditions for reversible continuation; an actual external effect is evaluated only when that effect call is reached.
- Search for a concrete in-scope substitute before returning REPLAN_REQUIRED.
- CONTINUE_WITH_ALTERNATIVE keeps the substitute inside this exact sealed Outcome/session and names every additionally required write path; use [] when none are added.
- REPLAN_REQUIRED means the autonomous solver should change decomposition or means.
- The output contract contains only failed-means evidence, alternatives, disposition, and disproved assertions. Terminal conclusions are outside this challenger contract.
- Record unsupported assertions in disprovedAssertions.

Return only the structured forward-motion candidate.
