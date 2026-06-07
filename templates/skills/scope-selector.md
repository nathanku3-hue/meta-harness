---
name: scope-selector
description: Choose one bounded repo scope from current truth before execution.
---

# Scope Selector

Use this when a run has multiple plausible next steps, unclear ownership, handoff risk, or budget pressure.

## Inputs

1. Read the current harness state first:
   - `.meta-harness/status.md`
   - `.meta-harness/events.jsonl`
   - relevant `.meta-harness/streams/*.md`
   - recent `.meta-harness/workers/*.md`
2. Read wider repo docs only when the harness state conflicts or does not name the active bottleneck.

## Output Contract

```text
Chosen Scope: <one bounded scope>
Why Now: <one line>
Why Not Alternatives: <one line per rejected alternative>
Low-Confidence Items: <item or none>
Out-of-Boundary Items: <item or none>
Stop Rules: <conditions that halt execution>
Demo Target: <smallest proof target>
File Budget: <max files and owned paths/categories>
```

## Selection Rules

1. Prefer the smallest scope that unlocks the active bottleneck.
2. Preserve explicit non-goals, blocked actions, and stop criteria.
3. Do not pick a scope that requires unapproved production-impacting operations or authority expansion.
4. If no safe bounded scope exists, output `Chosen Scope: BLOCKED` and name the missing approval or evidence.

## Stop Rules

Stop before execution when:

- owned files cannot be named;
- acceptance checks cannot be named;
- required approval is absent;
- current truth surfaces disagree on the active bottleneck;
- the file budget would cross an explicit boundary.
