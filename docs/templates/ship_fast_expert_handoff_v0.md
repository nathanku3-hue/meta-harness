# Ship-Fast Expert Handoff v0

Status: Template
Purpose: replace broad expert packets with a one-decision handoff.

Mode: <ADVISORY_REVIEW|APPROVAL_GATE|EXECUTION_PACKET|CLOSURE_REPORT>

Modes:
ADVISORY_REVIEW
APPROVAL_GATE
EXECUTION_PACKET
CLOSURE_REPORT

No artifact may use more than one mode.

Stale report rule:
If an expert report predates current truth, prepend:
"Superseded on authorization status by <RoundID>; still valid only for guardrails."

Question:
<answer one decision only>

Current delta since packet build:

Evidence needed:

Forbidden scope:

Output schema:
1. Recommendation
2. Why
3. Required preconditions, max 3
4. Stop rules, max 3
5. Next action, one line
