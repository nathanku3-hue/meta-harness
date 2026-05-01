# Meta-Harness PRD

Status: starter
Date: 2026-05-02
Owner: product / harness

## Product Statement

Meta-Harness is a Markdown-first, Codex-native workflow visibility harness.

It translates human product intent into Codex worker task language, then translates worker output back into official project truth.

## One-Line Positioning

Meta-Harness is a Codex-native mission log for making multi-stream agent work understandable, resumable, and product-directed.

## Problem

Codex and other CLI agents can do strong bounded work, but multi-step work still fails in predictable ways:

- product intent gets buried in chat;
- worker outputs do not become durable project truth;
- background research can silently change conclusions;
- coding, research, writing, and review streams drift apart;
- a new human or agent cannot reliably resume from local artifacts;
- project status becomes either raw terminal output or stale prose.

## Target User

Primary user:

- a human product/engineering operator using Codex to run coding and research work.

Secondary users:

- Codex worker sessions;
- future worker CLIs such as Claude Code, Gemini CLI, OpenCode, or GitHub-hosted agents;
- a parent harness reading child repository statuses.

## Human Role

Humans own:

- product direction;
- intuition;
- taste;
- priority;
- acceptance judgment.

Humans should not have to manually compile status, preserve worker memory, or reconcile every stream by hand.

## Harness Role

Meta-Harness owns:

- status truth;
- translation between human and Codex worker language;
- continuity;
- phase tracking;
- worker report normalization;
- lookback generation;
- per-repo state;
- lightweight multi-repo status reading.

## Codex Worker Role

Codex workers own:

- bounded execution;
- coding;
- research;
- verification;
- evidence production;
- proposed next actions.

Workers do not directly overwrite official truth. They produce reports, evidence, and proposals.

## MVP Scope

The MVP is product-first and Markdown-first.

It must support:

- a fixed phase map;
- per-repo harness state;
- official human-readable status;
- append-only event memory;
- worker reports;
- lookback generation;
- file-only background polling;
- parent harness reading child repo statuses;
- global npm installation.

## Fixed Phase Map

The first version uses a fixed tram-stop map:

```text
intake -> plan -> work -> verify -> synthesize -> handoff -> lookback
```

The phase map is not configurable in the MVP.

## Primary Product Scenarios

### Coding

A human starts with product intent. The harness turns it into a bounded Codex worker task. Codex works, reports changed files and verification. The harness updates status and records the event.

### Research

A human starts with a research goal. Codex researches and reports sources, claims, confidence, and conclusion changes. The harness introduces new conclusions explicitly before they affect official status.

### Coding Plus Research

Coding and research can run as separate streams. The harness keeps their current truth separate, then synthesizes them into one official status.

## Non-Goals

The MVP will not include:

- hosted service;
- dashboard;
- terminal multiplexer UI;
- autonomous agent spawning;
- full swarm orchestration;
- SOP-style policy gates;
- configurable workflow graph;
- chatroom/message-bus architecture;
- large agent persona library;
- workers directly editing official status;
- cloud storage or account system.

## Copy / Modify / Reject Inputs

### Copy

- MCO: neutral layer over existing agent CLIs.
- Gas Town: persistent worker identity and work history.
- agtx: blackboard/kanban-style work visibility.
- BMAD: strong lifecycle language and handoff discipline.
- Claude Code subagent collections: small subagent cards with name, when-to-use, and output expectations.

### Modify On Top

- SuperClaude: use command/persona ideas sparingly; avoid persona overload.
- Claude Flow: borrow npm/global install and status ergonomics; reject full swarm UI for MVP.
- OpenHands: keep as future scaling reference, not an MVP dependency.
- MS-Agent: adapt coding and research pipeline examples as templates.
- SwarmClaw: borrow durable sessions and background concepts, not the full platform.

### Reject

- full swarm platform;
- dashboard-first product;
- huge subagent libraries;
- workers rewriting official truth;
- heavyweight policy engine;
- hosted runtime;
- message bus as the first control plane.

## Success Criteria

The MVP succeeds when:

- a fresh human can read `status.md` and understand what is true now;
- a fresh Codex worker can read worker instructions and continue safely;
- events provide a credible lookback without chat history;
- coding and research streams can be tracked separately and synthesized;
- parent harness can list child repo statuses;
- installation and init feel lightweight.

## Product Boundary

Meta-Harness is not SOP v2.

SOP is a formal governance control plane. Meta-Harness is a lightweight live status and translation layer for Codex-led work.

