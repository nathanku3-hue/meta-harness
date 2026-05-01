# GitHub Research: Meta Harness And Workflow Visibility

Date: 2026-05-01

## Research Question

What existing GitHub projects already show useful patterns for a meta harness that can:

- run a self-iterating work loop;
- expose current local status truth;
- support single-session, team, and background-worker modes;
- preserve a god's-view lookback through artifacts and event history;
- work for coding, research, and writing workflows.

## Short Read

The strongest pattern is not "build another agent framework." The stronger pattern is:

1. define work as a governed state machine;
2. persist every meaningful transition as an artifact or event;
3. keep a concise Markdown status surface as the current truth;
4. separate execution from visibility;
5. let humans inspect, gate, redirect, and review from the status layer.

For this repo, the best first MVP is a Markdown-first harness with a tiny local ledger, not a full multi-agent runtime.

## Project Map

| Project | What it demonstrates | Useful pattern for this harness | Caveat |
| --- | --- | --- | --- |
| [LangGraph](https://github.com/langchain-ai/langgraph) | Long-running, stateful agents represented as graphs with durable execution, human-in-the-loop, memory, and trace/debug support. | Model work as explicit nodes, edges, checkpoints, and resumable state. | Heavier than needed for an initial Markdown-first SOP. |
| [Dapr Agents](https://github.com/dapr/dapr-agents) | Production-grade agent systems with workflow orchestration, state, messaging, retries, observability, and security. | Treat durability, retries, state, and messaging as first-class infrastructure. | Better as a later backend reference than an MVP dependency. |
| [CrewAI](https://github.com/crewAIInc/crewAI) | Role-based crews plus event-driven flows with state management and conditional branching. | Separate role collaboration from controlled workflow transitions. | Crew abstractions can hide too much if the goal is local truth and traceability. |
| [AutoGen](https://github.com/microsoft/autogen) | Multi-agent applications that can work autonomously or alongside humans; now points new users toward Microsoft Agent Framework. | Historical reference for multi-agent conversation patterns and human cooperation. | Maintenance mode, so avoid anchoring new design on it. |
| [Chorus](https://github.com/Chorus-AIDLC/Chorus) | Agent harness around session lifecycle, task state machine, context injection, sub-agent orchestration, observability, and failure recovery. | Very close conceptual match: a wrapper around agents rather than a replacement for agents. | Larger product surface than the minimal local-first MVP. |
| [Archon](https://github.com/coleam00/Archon) | AI coding workflows encoded as deterministic YAML phases, gates, and artifacts. | For coding, make the process deterministic while the agent supplies the reasoning. | Mostly coding-oriented; research/writing needs evidence and claim tracking. |
| [OpenHands](https://github.com/OpenHands/OpenHands) | Software agent SDK, CLI, local GUI, and cloud modes for AI-driven development. | Useful reference for code task execution surfaces and repo-level agent behavior. | Full software-agent product, not just a visibility harness. |
| [SWE-agent](https://github.com/SWE-agent/SWE-agent) | Agent takes a GitHub issue and autonomously fixes it; configurable by one YAML file and designed for research. | A coding loop should be issue/task driven, tool-using, configurable, and trajectory-producing. | The project itself recommends mini-SWE-agent for new usage. |
| [MCO](https://github.com/mco-org/mco) | Dispatches prompts to multiple coding CLIs in parallel and aggregates structured outputs. | Team mode can be a dispatcher plus structured reports, not necessarily one shared agent brain. | Focused on coding CLI delegation. |
| [AgentUse](https://github.com/agentuse/agentuse) | Markdown-defined agents that run locally, on cron, in CI/CD, via webhooks, or Docker. | Markdown can be the configuration interface for automations and scheduled/background tasks. | Execution engine is separate from the workflow visibility problem. |
| [ResearchClaw](https://github.com/ymx10086/ResearchClaw) | Local-first research OS with durable projects, workflows, tasks, artifacts, claims, evidence, experiments, reminders, and channels. | Research/writing needs claim/evidence/artifact state, not only task status. | Alpha-like scope; use patterns, not necessarily code. |
| [Academic Research Skills](https://github.com/Imbad0202/academic-research-skills) | Skills for research -> write -> review -> revise -> finalize, including integrity gates and anti-hallucination checks. | Research SOP should include integrity gates, citation checks, and human judgment points. | Skill pack, not a runtime harness. |
| [AutoLabOS](https://github.com/lhy0718/AutoLabOS) | Governed, checkpointed autonomous research from brief to manuscript with auditable artifacts and backtracking. | Best reference for academic/research "run state" and evidence-bounded claims. | Early project; strongest value is methodology. |
| [Atomic Knowledge](https://github.com/Nimo1987/atomic-knowledge) | Markdown-first work-memory protocol with maintained knowledge, candidates, insights, procedures, and source captures. | Strong fit for the "implicit how from existing whats" layer: durable procedures and insights extracted from work. | It is a memory protocol, not a process runner. |
| [work-buddy](https://github.com/KadenMc/work-buddy) | Local agent coordination with workflows, dashboard, inter-agent messaging, sidecar jobs, notifications, and project memory. | Visibility should include active sessions, task state, health, notifications, and decision prompts. | Tied to a broader personal stack. |
| [AI Collab Playbook](https://github.com/cnfjlhj/ai-collab-playbook) | Practical playbook for research, writing, reading, and coding; emphasizes human judgment and workflow sedimentation. | The SOP should keep the human as the judge of problem framing, acceptance criteria, and final tradeoffs. | Playbook/reference repo, not an executable system. |
| [Langfuse](https://github.com/langfuse/langfuse) | Open-source LLM engineering platform for traces, prompts, evals, datasets, playgrounds, and metrics. | Use traces and evaluations as the mature version of the visibility module. | Heavy for a local MVP; useful as integration target. |
| [Phoenix](https://github.com/Arize-ai/phoenix) | AI observability and evaluation platform using OpenTelemetry/OpenInference traces. | Visibility should eventually speak trace/event concepts, not just freeform notes. | More LLM app observability than workflow SOP. |
| [AgentOps](https://github.com/AgentOps-AI/agentops) | Agent monitoring, execution graphs, cost tracking, benchmarking, and framework integrations. | A later UI can replay agent execution and track cost/latency per run. | SaaS/platform orientation may exceed local-first needs. |

## Extracted Methodology

### 1. Work Is A Run, Not A Chat

Every meaningful task should become a run with:

- objective;
- mode: solo, team, background, review, or retrospective;
- current phase;
- current owner;
- known facts;
- open questions;
- artifacts;
- acceptance criteria;
- next action.

### 2. The Flywheel Is Simple

The universal loop is:

```text
observe local truth -> decide next action -> act -> verify -> record -> update status -> continue / hand off / stop
```

This applies to coding, research, writing, review, and team orchestration.

### 3. Visibility Is A Separate Module

The visibility module should not be the agent. It should read the ledger and artifacts, then publish:

- current status truth;
- what changed since last checkpoint;
- what is running in the background;
- what conclusion is new or revised;
- what decision needs human review;
- what the next action is and why.

### 4. Markdown Is The Right First Truth Layer

Markdown works well for the first version because it is:

- readable by humans and agents;
- diffable;
- portable across Codex, Claude Code, OpenHands, and other local-capable agents;
- enough for SOPs, status, decisions, run logs, claims, evidence, and retrospectives.

Structured JSONL can sit beside Markdown for events.

### 5. The God's-View Lookback Comes From Events

Do not rely on chat memory for retrospectives. Record event facts:

- timestamp;
- actor;
- phase;
- action;
- evidence or command used;
- artifact changed;
- verification result;
- decision made;
- next action selected.

The lookback can then be rendered after the fact as a timeline, handoff report, or "why did we do this" narrative.

### 6. Background Work Must Introduce Conclusions Explicitly

For research and writing, background work should not silently mutate the main argument. It should publish a conclusion update:

- new conclusion;
- source/evidence;
- confidence;
- impact on draft or plan;
- whether it replaces, weakens, or strengthens prior claims;
- required human decision.

## Recommended First MVP

Create a local `.meta-harness/` run directory:

```text
.meta-harness/
  runs/
    <run-id>/
      status.md
      events.jsonl
      decisions.md
      handoff.md
      artifacts/
      background/
```

The first runnable code should only do four things:

1. `init`: create a run from a goal.
2. `event`: append a structured event.
3. `status`: render current status truth from the latest event plus `status.md`.
4. `lookback`: render the god's-view retrospective from `events.jsonl`.

## Candidate SOP Shape

The SOP should define:

- session start protocol;
- task intake protocol;
- loop protocol;
- visibility update protocol;
- background worker protocol;
- conclusion update protocol;
- coding MVP iteration protocol;
- academic research/writing protocol;
- team handoff protocol;
- retrospective protocol;
- done/stop criteria.

## Design Bias

Start as a harness around existing agents and tools. Avoid becoming a model wrapper, agent framework, or dashboard too early.

The product promise should be:

> Make the workflow state visible, durable, reviewable, and restartable while existing agents do the work.

