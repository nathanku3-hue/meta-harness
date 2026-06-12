# Status

Goal:
Create a context artifact that must be refused before tracked archival because it contains Authorization: Bearer abcdefghijklmnopqrstuvwxyz0123456789.

Phase:
plan -> work

Scope:
Owned files are tests only. Forbidden files include runtime implementation.

Evidence required:
The redaction scanner must catch the bearer token before `.meta-harness/context/` writes.

Stop rules:
Never commit context artifacts containing raw secret-like strings.

Freshness:
Confirmed from local implementation plan.

Handoff:
Worker C reports refusal behavior.
