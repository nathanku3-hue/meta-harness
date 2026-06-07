# Meta Harness SOP

Status: draft
Date: 2026-05-01

## Purpose

This SOP defines a Markdown-first operating loop for agent-assisted work. It is designed to keep local status truth visible while work proceeds through coding, research, writing, review, and team handoff.

The harness is not the agent. The harness is the workflow wrapper that records what is happening, what changed, what is known, what is uncertain, and what should happen next.

## Core Principle

Work must be recoverable from artifacts, not from memory.

Every run keeps:

- current status;
- event ledger;
- decisions;
- artifacts;
- background updates;
- handoff notes;
- retrospective lookback.

## Run Modes

| Mode | Use when | Visibility requirement |
| --- | --- | --- |
| `solo` | One agent or person is driving the loop. | Current status and next action are always explicit. |
| `team` | Multiple agents or people are working in parallel. | Owners, assignments, dependencies, and merge points are explicit. |
| `background` | Research, monitoring, or validation continues while primary work proceeds. | New conclusions are introduced through conclusion updates, not silent edits. |
| `review` | Work is being checked against acceptance criteria. | Findings, evidence, severity, and required fixes are explicit. |
| `retrospective` | The run is being reconstructed after the fact. | Timeline and decision rationale are generated from the event ledger. |

## Universal Flywheel

```text
observe -> decide -> act -> verify -> record -> update -> continue / hand off / stop
```

### Observe

Read the current local truth:

- goal;
- status;
- files/artifacts;
- open tasks;
- recent events;
- blockers;
- user constraints.

### Decide

Choose one next action. Record why it is the next action.

### Act

Perform the action in the smallest useful unit.

### Verify

Check whether the action changed the local truth as expected.

Examples:

- code compiles;
- tests pass;
- source supports a claim;
- draft section satisfies outline;
- reviewer concern is resolved;
- background finding is incorporated or explicitly rejected.

### Record

Append an event with:

- actor;
- phase;
- action;
- artifact touched;
- verification result;
- decision;
- next action.

### Update

Refresh `status.md` so a new reader can resume without reading the full chat.

## Status Truth Template

```md
# Status

Run: <run-id>
Mode: solo | team | background | review | retrospective
Phase: <phase>
Owner: <owner>
Updated: <timestamp>

## Goal

<one paragraph>

## Current Truth

- <fact>
- <fact>

## Active Work

- <task> - <owner> - <state>

## Background Work

- <task> - <owner> - <last update>

## Decisions

- <decision> - <why>

## New Or Revised Conclusions

- <conclusion> - <evidence> - <impact>

## Blockers

- <blocker> - <needed decision or action>

## Next Action

<single next action and reason>

## Stop Criteria

- <done condition>
- <done condition>
```

## Coding Workflow

1. Define the MVP behavior and acceptance criteria.
2. Inspect the repo and record current local truth.
3. Choose one small implementation step.
4. Edit only the relevant files.
5. Run the nearest useful verification.
6. Record result and update status.
7. Iterate until MVP criteria pass.
8. Produce a lookback: what changed, what was verified, what remains risky.

## Academic Research And Writing Workflow

1. Define research question, scope, and target artifact.
2. Separate claims, evidence, draft text, and open questions.
3. Let background research continue as a separate workstream.
4. When background research changes the argument, publish a conclusion update.
5. Incorporate only evidence-backed conclusions into the draft.
6. Run integrity checks before finalizing: citation validity, claim strength, missing counterarguments, and unsupported transitions.
7. Produce a lookback: how the thesis changed, which sources caused changes, and what remains uncertain.

## Background Conclusion Update

```md
# Conclusion Update

Source workstream: <name>
Updated: <timestamp>

## New Conclusion

<claim>

## Evidence

- <source or artifact>

## Confidence

low | medium | high

## Impact

strengthens | weakens | replaces | adds nuance to | conflicts with

## Required Action

accept | reject | revise draft | request more research | human decision needed
```

## Team Handoff

A handoff must include:

- goal;
- current status truth;
- assigned owner;
- artifact map;
- decisions already made;
- blocked questions;
- next action;
- stop criteria.

## Expert Packet And Scope Kit

When a run needs specialist review or delegated work, keep the packet smaller than the repo:

1. install reusable templates with `meta-harness templates install`;
2. choose one bounded scope with the scope-selector template;
3. classify ambiguous work with the boundary-gate template;
4. build a packet with `meta-harness expert-packet <round-id> --include <focused-path>`;
5. reconcile reviewer output through the expert reconciliation matrix.

Expert packets are advisory evidence bundles. They do not authorize execution, production-impacting actions, or scope expansion by themselves. The deliverable is a single `.zip` archive; do not publish sidecar `main.diff`, `main_next_scope.md`, or other loose packet files beside it. If those aids are needed, include them as entries inside the archive.

## Retrospective Lookback

The retrospective is generated from events, not from chat memory.

It should answer:

- What was the original goal?
- What changed?
- What evidence or local verification drove the changes?
- Which decisions mattered?
- Where did the loop backtrack?
- What is done?
- What remains open?

## MVP Implementation Target

The first running version should support:

```text
meta-harness init "<goal>"
meta-harness event --phase <phase> --action <action> --result <result>
meta-harness status
meta-harness lookback
```

No agent framework is required for the first version. The harness can start as local files plus a small CLI.

## Minimal Code Contract

The current minimal implementation is [meta_harness.py](../../meta_harness.py). It intentionally uses only the Python standard library.

The CLI owns these responsibilities:

- create a run directory and active run pointer;
- append JSONL events;
- regenerate `status.md` from the event ledger;
- render `lookback.md` from the event ledger.

The CLI does not own these responsibilities yet:

- launch agents;
- run background workers;
- synchronize multiple collaborators;
- render a dashboard;
- validate research citations.

Those should stay outside the first code path until the event schema and Markdown status surface are stable.
