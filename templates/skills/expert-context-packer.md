---
name: expert-context-packer
description: Build a compact expert-review context packet from local harness truth.
---

# Expert Context Packer

Use this to prepare a minimal packet for expert or worker review.

## Packet Contract

Include only:

1. `Question`: the exact decision or review question.
2. `Scope`: owned files, allowed actions, and non-goals.
3. `Current Truth`: relevant excerpts from status, events, streams, and worker reports.
4. `Evidence`: focused files, commands, test results, and artifacts needed to answer.
5. `Boundaries`: forbidden actions, approval gates, and stop rules.
6. `Expected Output`: required headings, rating/verdict format, and closure tokens.

## Exclusions

Do not include:

- unrelated repo history;
- broad file dumps;
- stale packet text when live root files disagree;
- implementation hints that bias the reviewer;
- intended answer or suspected fix unless the review explicitly verifies that fix;
- credentials, private tokens, ignored local data, or unapproved governed artifacts.

## Size Rules

1. Prefer links and short excerpts over pasted files.
2. Keep each packet answerable from the included evidence.
3. If evidence is too large, split by domain or stream and make one packet per reviewer.

## Safety Rules

1. Mark local dirty or ignored artifacts as non-authoritative unless the current truth says otherwise.
2. If the packet could be read as authorizing execution, add an explicit `Not Authorized` line.
3. If the expert cannot answer without missing evidence, ask for that evidence instead of widening scope.
