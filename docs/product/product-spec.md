# Meta-Harness Product Spec

Status: implemented MVP
Date: 2026-05-02

## Product Shape

Meta-Harness is a global CLI that creates and maintains per-repo Markdown state.

Target install:

```bash
npm install -g meta-harness
```

Installed command:

```bash
meta-harness
```

## MVP Principle

Use Markdown as the product surface and minimal runtime code as the mechanical helper.

The runtime should not become the product. The product is the durable workflow truth.

## Repository State

Each repository owns its own harness state:

```text
.meta-harness/
  status.md
  phase-map.md
  events.jsonl
  lookback.md
  streams/
    coding.md
    research.md
    writing.md
    review.md
  workers/
    worker-report-template.md
    <worker-id>.md
  repos.json
```

## Human Status Language

Human-facing status must answer:

- What is true?
- What changed?
- What matters?
- What needs product, intuition, or taste judgment?
- What happens next?

Minimum `status.md`:

```md
# Status

Goal:
Phase:
Current truth:
Active streams:
Pending human decisions:
Blockers:
Last verified:
Next action:
Stop criteria:
```

## Codex Worker Language

Codex-facing worker instructions must answer:

- What is the bounded task?
- What stream owns it?
- What files or artifacts matter?
- What constraints apply?
- What evidence must be produced?
- What blocker should be reported instead of guessed through?
- What exact next operation is safe?

Minimum worker report:

```md
# Worker Report

Worker:
Stream:
Task:
Phase:

## Result

## Changed Artifacts

## Evidence

## Blockers

## Proposed Next Action

## Human Summary

## Codex Continuation Note
```

## Event Memory

Events are append-only JSONL records.

Minimum event fields:

```json
{
  "time": "",
  "actor": "",
  "stream": "",
  "phase": "",
  "action": "",
  "result": "",
  "evidence": "",
  "decision": "",
  "next_action": ""
}
```

## Fixed Phase Map

MVP phase map:

```text
intake -> plan -> work -> verify -> synthesize -> handoff -> lookback
```

Phase meanings:

| Phase | Meaning |
| --- | --- |
| `intake` | Capture human intent and acceptance taste. |
| `plan` | Translate intent into bounded worker tasks. |
| `work` | Workers produce code, research, drafts, or review findings. |
| `verify` | Check evidence, tests, citations, or review results. |
| `synthesize` | Convert worker outputs into official status truth. |
| `handoff` | Prepare continuation state for a fresh human or Codex worker. |
| `lookback` | Generate timeline and decision rationale from events. |

## Stream Model

MVP streams:

- `coding`;
- `research`;
- `writing`;
- `review`.

Coding and research are the first-class MVP scenarios. Writing and review exist as status lanes but can remain lighter until coding and research are proven.

## Background Polling

MVP polling is file-only.

The harness can read:

- local `status.md`;
- local `events.jsonl`;
- worker reports;
- child repo harness statuses.

The harness does not launch agents in the MVP.

## Multi-Repo Model

Each repo has its own harness.

A parent harness may keep `repos.json`:

```json
{
  "repos": [
    {
      "name": "example",
      "path": "../example",
      "role": "child"
    }
  ]
}
```

Parent status reads child statuses. It does not centralize child event memory.

## MVP Commands

Target command surface:

```bash
meta-harness init
meta-harness status
meta-harness event
meta-harness worker-report
meta-harness lookback
meta-harness poll
meta-harness repos
```

Command responsibilities:

| Command | Responsibility |
| --- | --- |
| `init` | Create `.meta-harness/` starter docs. |
| `status` | Print or refresh official status. |
| `event` | Append one event. |
| `worker-report` | Create or ingest worker report. |
| `lookback` | Render retrospective from events. |
| `poll` | Read local/child status files and summarize changes. |
| `repos` | Manage child repo index. |

Implemented command examples:

```bash
meta-harness init "Build coding and research visibility"
meta-harness event --stream research --phase work --action "surveyed adjacent products" --result "copy visibility and persistence"
meta-harness worker-report codex-researcher --stream research --task "extract patterns" --result "report normalized"
meta-harness status --refresh
meta-harness lookback --write
meta-harness repos add child ../child-repo
meta-harness poll --write
```

## Minimal Runtime Code

Runtime code should be limited to:

- file creation;
- JSONL append/read;
- Markdown template rendering;
- status aggregation;
- no network requirement;
- no model API requirement;
- no shell execution beyond the CLI itself.

## Acceptance Criteria

The one-shot MVP is acceptable when:

- `npm install -g meta-harness` exposes `meta-harness`;
- `meta-harness init` creates starter Markdown state;
- `meta-harness event` appends to `events.jsonl`;
- `meta-harness status` prints official status;
- `meta-harness worker-report` creates a report from a template;
- `meta-harness lookback` renders a timeline;
- `meta-harness poll` reads local and child statuses without launching agents;
- docs explain the human/Codex translation boundary;
- no dashboard, daemon, agent spawning, or heavy policy layer exists.

Current implementation status: complete for the listed acceptance criteria as a local npm package binary with dependency-free Node runtime.
