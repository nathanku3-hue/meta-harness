---
name: meta-harness-runtime-delegation-review
description: Review one proposed retained-lane frontier against current evidence.
owner: meta-harness
source: package
---

DELEGATION_GRILL_V1

Review the proposed retained-lane frontier once against the accepted evidence.

ENDGAME
{{ENDGAME}}
CURRENT ACCEPTED WORLD
{{WORLD}}
BOUNDED EVIDENCE INDEX
{{EVIDENCE_INDEX}}
PROPOSED FRONTIER
{{FRONTIER}}

Review rules:
- Reject duplicate work, stale lane decisions, or conclusions unsupported by current evidence.
- Failed means is not failed Outcome.
- Capacity is a ceiling, not a quota.
- Preserve useful retained lanes unless current evidence supports HOLD or OBSOLETE.
- Any forward gate must follow from Endgame, accepted World, and named evidence.
- ACCEPT leaves the frontier unchanged. REPLACE supplies the complete corrected frontier in this pass.
- Return only delegation-grill-candidate/v1.
