---
name: build-vs-borrow-router
description: Decide whether work should be built, reused, solved natively, minimally patched, or escalated before ship-fast routing or expert packets.
---

# Build-vs-Borrow Router

Use this before scope selection, ship-fast routing, or expert packet creation when work may require new code, new templates, new dependencies, product judgment, or authority-boundary review.

## Principle

Question Zero: does this need to be built?

Prefer local truth and existing capabilities before new implementation. Remote/public skills, connectors, MCP servers, and external patterns may inspire a local pattern, but do not import or execute them unless they are vendored, provenance-recorded, evaluated, and explicitly authorized.

## Inputs

Read the smallest useful set:

1. Current request, acceptance criteria, and forbidden surface.
2. `.meta-harness/status.md` and recent `.meta-harness/events.jsonl`.
3. Local repo search results for existing docs, templates, commands, helpers, and conventions.
4. Runtime, platform, stdlib, config, and installed dependency evidence available in the repo.
5. Security, release, provider, domain, architecture, and product authority boundaries.

## Pre-Route Decisions

| Pre-route | Use when | Then maps to |
| --- | --- | --- |
| `NO_BUILD` | The request is speculative, unnecessary, already covered, or better answered with a short explanation. | `FOLLOW_UP_QUEUED` or compact explanation |
| `USE_EXISTING_REPO_PATTERN` | A local skill, template, helper, command, docs pattern, or convention already solves the gap. | `SHIP` or `REVIEW` |
| `USE_PLATFORM_NATIVE` | Runtime, stdlib, platform config, or local docs can solve it without new owned code. | `SHIP` or `REVIEW` |
| `MINIMAL_PATCH` | The gap is real, owned, bounded, and locally verifiable. | `REVIEW` |
| `HUMAN_TASTE` | Product taste, UX tradeoff, naming, priority, or acceptance judgment is the blocker. | `DECISION_NEEDED` |
| `EXPERT_PACKET` | Architecture, domain, security, provider, release, or specialist judgment is needed. | `DECISION_NEEDED` or `BLOCKED` |
| `AUTHORITY_BLOCK` | Credentials, permissions, publishing, protected boundary, or missing authority prevents progress. | `BLOCKED` |

## Routing Order

1. Restate the desired outcome in one sentence.
2. Scan the repo for an existing solution before proposing new implementation.
3. Check platform, runtime, stdlib, config, and local docs before adding code.
4. Check installed dependencies and packaged templates before adding dependencies or templates.
5. Choose `MINIMAL_PATCH` only when the gap is real, owned, bounded, and verifiable.
6. Choose `HUMAN_TASTE` or `EXPERT_PACKET` only after the local scan shows judgment outside the worker's authority.
7. Choose `AUTHORITY_BLOCK` for credentials, permissions, publishing, protected boundaries, or missing approval.

## Output Contract

```text
Question Zero: <does this need to be built?>
Pre-route: <NO_BUILD|USE_EXISTING_REPO_PATTERN|USE_PLATFORM_NATIVE|MINIMAL_PATCH|HUMAN_TASTE|EXPERT_PACKET|AUTHORITY_BLOCK>
Route: <FAST|REVIEW|SLOW|BLOCK>
Outcome: <SHIP|REVIEW|DECISION_NEEDED|BLOCKED|FOLLOW_UP_QUEUED>
Existing Evidence: <repo/platform/dependency/template evidence or none>
Chosen Path: <one sentence>
Human/Expert Need: <one question or none>
Forbidden Surface: <boundaries that remain closed>
Next: <one action and owner>
```
