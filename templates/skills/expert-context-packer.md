---
name: expert-context-packer
description: Build a compact expert-review context packet from local harness truth.
---

# Expert Context Packer

Use this to prepare a minimal packet for expert or worker review after the build-vs-borrow router says outside judgment is needed.

## Packet Contract

Deliver exactly one zip archive. Do not publish loose sidecar files such as `main.diff`, `main_next_scope.md`, or extra packet folders beside the zip; if those aids are needed, include them as entries inside the archive.

Put the one-page front card first. Appendices come second. The expert must be able to answer from the front card; appendices are evidence, not the primary prompt.

Include only:

1. `Front Card`: current delta, build-vs-borrow pre-route, route/outcome, one question, recommended next decision, scope limit, and stop rule.
2. `Question`: the exact decision or review question.
3. `Scope`: owned files, allowed actions, and non-goals.
4. `Current Truth`: short relevant excerpts from status, events, streams, and worker reports.
5. `Evidence`: focused files, commands, test results, and artifacts needed to answer.
6. `Boundaries`: product/architecture boundary, forbidden actions, approval gates, and stop rules.
7. `Expected Output`: required headings, verdict format, and one next action.

## Exclusions

Do not include:

- unrelated repo history;
- broad file dumps;
- stale packet text when live root files disagree;
- raw chat logs;
- implementation hints that bias the reviewer;
- intended answer or suspected fix unless the review explicitly verifies that fix;
- credentials, private tokens, ignored local data, or unapproved governed artifacts.

## Size Rules

1. Keep the front card to one page.
2. Prefer links and short excerpts over pasted files.
3. Put large truth excerpts in appendices only.
4. Summarize chat logs; do not include them raw.
5. Keep each packet answerable from the front card plus included evidence.
6. If evidence is too large, split by domain or stream and make one packet per reviewer.

## Safety Rules

1. Mark local dirty or ignored artifacts as non-authoritative unless the current truth says otherwise.
2. If the packet could be read as authorizing execution, add an explicit `Not Authorized` line.
3. If the expert cannot answer without missing evidence, ask for that evidence instead of widening scope.
4. Do not build an expert packet for work routed to `NO_BUILD`, `USE_EXISTING_REPO_PATTERN`, `USE_PLATFORM_NATIVE`, or `MINIMAL_PATCH` unless a separate boundary judgment remains.
