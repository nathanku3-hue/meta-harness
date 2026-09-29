---
name: meta-harness-runtime-delegation-frontier
description: Classify retained delegation lanes against current accepted evidence.
owner: meta-harness
source: package
---

DELEGATION_FRONTIER_V1

Classify retained lanes only.

ENDGAME
{{ENDGAME}}
CURRENT ACCEPTED WORLD
{{WORLD}}
CURRENT GATE
{{CURRENT_GATE}}
LIVE LANES
{{LIVE_LANES}}
BOUNDED EVIDENCE INDEX
{{EVIDENCE_INDEX}}
Retained live-lane bound: {{MAX_FRONTIER_LANES}}.

FRONTIER LAWS
- Decide every live lane exactly once: CONTINUE, HOLD, or OBSOLETE.
- CONTINUE only for positive-value retained work.
- HOLD only for still-relevant work that should checkpoint and release live capacity.
- OBSOLETE only when accepted evidence makes the lane no longer relevant.
- Failed means is not failed Outcome.
- newOutcomes must always be an empty array; fresh coding work belongs to the repository planner.
- Capacity is throughput only and never creates a new product task.
- CONTINUE means useful retained work remains. FORWARD_GATE is allowed only when retained autonomous work is exhausted and replanning is needed.
- Do not create owner decisions or owner requests.
- Cite only refs present in the bounded evidence index.
- Return only delegation-frontier-candidate/v1.
