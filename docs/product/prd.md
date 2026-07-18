# Meta-Harness PRD

Status: active
Date: 2026-06-29
Owner: product / harness
Intent authority: [Product Intent Anchor](product-intent.md)
Roadmap authority: [Roadmap](roadmap.md)
Question authority: [Problem-Solving Questions](problem-questions.md)

## Governing Product Statement

Meta-Harness is an AI-native operating harness for one solo developer/researcher shipping ultra-complex, multi-module systems that require both software engineering and specialist knowledge.

It maximizes verified product progress per unit calendar time and human attention by combining:

- a frozen human intent anchor;
- one canonical fact layer;
- an auditor-planner and worker loop;
- numbered end-to-end functional slices;
- validated handoff and resume;
- expertise and research converted into product evidence;
- borrowed coding-agent execution;
- controller-owned authorization, integration, custody, and replay;
- independent verification;
- measured outcome learning later, after baseline and holdout evaluation exist.

The primary interface is the top-level PM problem, not workflow machinery. It answers what outcome is being shipped, what is true, what blocks it, which slice moves the critical path, what requires human judgment, and what proof closes the slice.

## Locked User and Object

Primary user: one solo developer/researcher.

Primary object: an ultra-complex, multi-module product whose correct implementation requires coordinated coding, research, domain expertise, integration, and shipping.

The system is not optimized for enterprise queue administration, generic swarms, or maximum agent count.

## Locked Role Boundary

- The human owns intent, priority, taste, authority, material risk, scope expansion, and irreversible commitment.
- The auditor-planner owns truthful diagnosis, intent-aligned direction, candidate comparison, RunSpec creation, and outcome scoring.
- The worker owns all reversible execution already covered by the RunSpec and authorization envelope.
- The controller owns canonical state, mutation authority, custody, leases, cancellation, atomic transitions, and loop integrity.

## Product Problems

Meta-Harness must solve:

1. **Intent drift:** audits and repeated plans can optimize local defects or governance instead of the original product outcome.
2. **Context amnesia:** fresh or compacted agents cannot reconstruct decisions, authority, evidence, and the exact next operation.
3. **Complexity collapse:** no single context contains the full cross-module behavior and global invariants.
4. **Expertise loss:** research and specialist input can remain documents rather than becoming product constraints, tests, and behavior.
5. **Execution ambiguity:** agents can mutate outside scope, lose evidence, or make unverifiable completion claims.
6. **Workflow friction:** humans repeatedly reconstruct context or approve reversible work already inside an accepted boundary.
7. **Local completion bias:** tests and internal artifacts can pass while the product remains unshipped.
8. **Learning without proof:** the harness can overfit prior runs or optimize internal metrics rather than product outcomes.
9. **Parallel-work failure:** multiple agents can duplicate, conflict, contaminate review, or increase integration cost.
10. **Silent drift:** current truth, intent, scope, authority, roadmap, and shipping definition can disagree without blocking progression.

Detailed questions and proof conditions are canonical in [Problem-Solving Questions](problem-questions.md).

## Product Outcomes

The target system should:

- convert a top-level product problem into a numbered critical-path functional slice;
- preserve original intent verbatim across audits, handoffs, compaction, and re-planning;
- let a fresh worker continue from artifacts alone;
- apply research and expertise directly to requirements, tests, constraints, decisions, and implementation;
- execute and independently verify bounded work with minimal routine human gates;
- preserve global invariants across modules;
- produce release and rollback evidence through the selected shipping state;
- measure prediction versus observation and improve future recommendations without silent policy mutation.

## Success Measures

Primary measures:

- problem-to-shipping elapsed calendar time;
- verified end-to-end slice throughput;
- user-visible product capability shipped;
- human gates and clarification count per slice;
- fresh-worker continuation success;
- escaped defects and rework;
- research-to-product conversion rate;
- intent-aligned recommendation acceptance;
- evidence strength and independent verification rate;
- multi-agent latency benefit net of coordination and integration cost.

Activity measures such as token count, patch count, test count, agent count, and artifact count are diagnostic only.

## Current Build Boundary

`CANDIDATE-S001R5F` is implemented on clean exact commit `88e17bf` (fail-preserving direct rename, rename-boundary regression, D082 authority in-candidate). Immediate authorized work is direction-close (`S001R5F-CLOSE`), exact-commit independent audit, and hosted CI on Node 20 and Node 25—not another runtime repair cycle. Non-force candidate push is allowed for remote custody and CI only. After acceptance: `G-001`, integrate and package as `0.3.0` (do not reuse `0.2.1`), then `S-006M`: one real non-fixture coding loop to merged and packaged. Internal secret infrastructure, broad filesystem frameworks, and standalone projection, corpus, handoff, learning, or multi-agent programs remain deferred.

No loop controller, adapter expansion, mass module decomposition, outcome learning, or multi-agent fan-out is authorized in parallel. The historical execution-custody runtime remains a frozen lower layer and is changed only when a real product slice exposes a blocking defect.

## Historical Product Statement

> All remaining equal-level sections below preserve the original MVP and custody-era PRD for traceability and shipped documentation compatibility. They do not override the governing sections above.

Meta-Harness is a Markdown-first, Codex-native workflow visibility harness.

It translates human product intent into Codex worker task language, then translates worker output back into official project truth.

## One-Line Positioning

Meta-Harness is a Codex-native mission log for making multi-stream agent work understandable, resumable, and product-directed.

## Current Post-MVP Re-charter

Meta-Harness is now intentionally evolving into a **local authority-bound agent execution-custody harness**. The current direction keeps durable Markdown truth, but adds sealed authorization, isolated execution, controller-owned mutation and validation, durable Git result custody, and terminal replay.

This is a major, explicit deviation from the original lightweight MVP, which did not launch agents or require network/model access. D071 proved useful work but lost retained custody; D072 repaired the substrate and exposed the legacy ToolLauncher gate as a coupling problem. D073 closed the host-neutral replacement under exact candidate `87de018`: live Fluxara VERIFIED with one agent spawn, normal fresh-process REPLAY with zero spawns and unusable tools, independently verified portable export, leakage PASS, and deletion of the former ToolLauncher/Windows/phase-lineage runtime without compatibility. D074 closed under exact candidate `4ad92f0`: the DevSpace Node example used the same phase-neutral custody workflow as Fluxara, exact depth-one pinned authority, one authenticated spawn → VERIFIED child `30ad240b`, receipt-derived REPLAY 60 seconds after expiry with unusable tools and zero spawns, independent portable Node validation, and leakage PASS. D075 closed repeated private operator use across DevSpace/Node and Fluxara/Python under exact candidate `cd63e52`. D076 now authorizes exactly one installed-package execution command, `meta-harness execute --request <absolute-path> [--json]`, and rejects source-checkout wrapper closure because the current seam is fixture-only, depends on source-only roots and Meta-Harness Git metadata, and is absent from the npm package. Closure requires one novel user-authored bounded change from an isolated packed installation before broad deletion. These roadmap changes are explicit, not silent drift.

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
- lightweight multi-repo status reading;
- insight extraction from execution evidence (git diffs, task logs);
- structured copy-paste prompt generation for external Deep Research workflows.

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

### Strategic Semantic Loop (Phase 16)

After a round of execution, the harness can extract structured insights from git diffs and task logs, surface architectural observations, and generate a structured Deep Research prompt scoped to the repo's known constraints and PRD goals. The human copies the prompt to an external web-based reasoning engine (e.g. OpenAI Deep Research, Gemini Advanced), pastes the resulting report back as a local file, and the harness reads it as evidence for the next round. No proprietary API calls, credentials, or network access are required from the local CLI.

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
- installation and init feel lightweight;
- `meta-harness mcp insight extract` produces a structured insight summary from a git diff;
- `meta-harness mcp research prompt` produces a copy-paste-ready Deep Research prompt from local context and a user question.

## Product Boundary

Meta-Harness is not SOP v2.

SOP is a formal governance control plane. Meta-Harness is a lightweight live status and translation layer for Codex-led work.

