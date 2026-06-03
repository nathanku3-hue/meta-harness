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
  templates/
    contracts/
    skills/
  expert-packets/
    <round-id>.zip
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
- What actually changed?
- What stream owns it?
- What files or artifacts matter?
- What constraints apply?
- What evidence must be produced?
- What blocker should be reported instead of guessed through?
- What exact next operation is safe?

Minimum worker PM brief:

```md
# Worker PM Brief

Worker:
Stream:
Task:
Phase:
Outcome: <DONE|PARTIAL_WITH_EXPLICIT_SCOPE|REJECTED>
Round: <round/task>
Progress: <before>/100 -> <after>/100
Confidence: <0-10>/10

## What I did

One paragraph answering what actually changed, what artifact/result was produced, and practical effect.

## PM-facing status

One short paragraph naming current top-level state, what is unblocked or still blocked, and whether this is execution-ready, docs-only, design-only, or rejected.

## Key decisions made

## Validation / evidence

Passed:
Skipped:
Evidence artifacts:

## What is still blocked

## Next round recommendation

Recommended next round:
Goal:
Allowed scope:
Forbidden scope:

## Worker accountability

requested_work_type:
actual_work_type_performed:
credentials_touched:
provider_access_touched:
data_output_created:
commit_created:
remaining_blocker:
```

Worker-report generation must reject missing or invalid `Outcome`. The harness must not infer `PARTIAL_WITH_EXPLICIT_SCOPE` by default, because that would recreate silent fallback behavior.

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
meta-harness templates
meta-harness expert-packet
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
| `worker-report` | Create a PM-facing worker brief and require explicit `Outcome`. |
| `templates` | List or install reusable scope, boundary, handoff, and reconciliation templates. |
| `expert-packet` | Build one bounded expert-review zip from current harness truth and optional includes. |
| `lookback` | Render retrospective from events. |
| `poll` | Read local/child status files and summarize changes. |
| `repos` | Manage child repo index. |

Implemented command examples:

```bash
meta-harness init "Build coding and research visibility"
meta-harness event --stream research --phase work --action "surveyed adjacent products" --result "copy visibility and persistence"
meta-harness worker-report codex-researcher --stream research --task "extract patterns" --outcome DONE --round ROUND-001 --progress "10/100 -> 20/100" --confidence "9/10" --result "normalized product-pattern PM brief" --human-summary "Research output is ready for PM synthesis." --validations-passed "worker brief parsed" --validations-skipped "none" --evidence-artifacts ".meta-harness/workers/codex-researcher.md" --requested-work-type docs --actual-work-type docs --next-action "synthesize status"
meta-harness templates install
meta-harness expert-packet ROUND-001 --include docs/product/product-spec.md
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
- bounded local git metadata capture inside expert packet zips;
- no network requirement;
- no model API requirement;
- no arbitrary shell execution.

## Acceptance Criteria

The one-shot MVP is acceptable when:

- `npm install -g meta-harness` exposes `meta-harness`;
- `meta-harness init` creates starter Markdown state;
- `meta-harness event` appends to `events.jsonl`;
- `meta-harness status` prints official status;
- `meta-harness worker-report` creates a `# Worker PM Brief` from a template;
- `meta-harness worker-report` rejects missing or invalid `--outcome`;
- `meta-harness templates install` copies reusable harness templates into local harness state;
- `meta-harness expert-packet` writes one compact review `.zip` without copying caches, runtime folders, dependencies, or oversized files;
- expert packet delivery has no loose sidecar `main.diff`, `main_next_scope.md`, or extra packet files beside the zip;
- `meta-harness lookback` renders a timeline;
- `meta-harness poll` reads local and child statuses without launching agents;
- docs explain the human/Codex translation boundary;
- no dashboard, daemon, agent spawning, or heavy policy layer exists.

Current implementation status: complete for the listed acceptance criteria as a local npm package binary with dependency-free Node runtime.
