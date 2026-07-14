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

The runtime should not become the MVP product. The MVP product is the durable workflow truth.

## Post-MVP Product Direction — Execution Custody

The governing post-MVP direction is a local authority-bound agent execution-custody harness. A sealed RunSpec and approval authorize one isolated attempt; an authenticated read-only agent returns a bounded artifact; the controller materializes, commits, validates, retains, replays, and exports the result. D073 closed that path under exact candidate `87de018` on Fluxara: one live agent spawn reached VERIFIED, a normally started fresh process replayed with zero spawns despite unusable execution-tool paths, independent portable verification passed, leakage scanning passed, and the active ToolLauncher/PowerShell/phase-lineage path was deleted. The sole production runtime root is `internal/execution-custody` and the active skill is `.agents/skills/bounded-repository-change/SKILL.md`. D073 portable verification is same-host independent reconstruction, not a self-contained third-party dependency environment.

This is an intentional deviation from the MVP constraints below: the private Phase 23A runtime launches an agent and uses its authenticated network path. The original CLI and Markdown surfaces remain shipped MVP behavior, but the no-launch/no-network rule is historical MVP scope rather than the current end-state. D073 closure does not authorize a public execution CLI or generic provider abstraction. D074 closed under exact candidate `4ad92f0`: a real DevSpace Node example used the same phase-neutral custody workflow as Fluxara, exact shallow pinned authority, one authenticated spawn → VERIFIED child `30ad240b`, receipt-derived REPLAY after expiry with unusable tools and zero spawns, independent portable Node validation, and leakage PASS; language-specific validation dependencies remain at child edges. The DevSpace capsule binds import safety, `npx --no-install`, and preservation of restart, crash-delay, recursive watcher, termination fallback, and shutdown behavior. D075 must now establish repeated private operator use. Public execution and broad deletion remain blocked until that evidence exists.

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
      post-worker-github-actions.md
  expert-packets/
    <round-id>.zip
  repos.json
```

Repo-level automation may also include `.github/workflows/post-worker-saw.yml` as a reusable read-only workflow for post-worker checks.

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

## Build-vs-Borrow Routing

Meta-Harness routing is top-level aware: before deciding who reviews or implements work, it decides whether the work should exist and what existing path should be reused.

Question Zero:

```text
Does this need to be built?
```

Routing answers two questions:

| Axis | Harness question |
| --- | --- |
| What is built? | Is this gap real, already solved, product-important, or speculative? |
| How is it built? | Use repo docs/config, platform/native behavior, installed dependencies, existing templates, a minimal owned patch, or expert review, in that order. |

The pre-route layer maps to existing outcomes; it does not add a new public command or terminal outcome.

| Pre-route | Meaning |
| --- | --- |
| `NO_BUILD` | Speculative, unnecessary, already covered, or better answered with explanation. |
| `USE_EXISTING_REPO_PATTERN` | A local skill, template, helper, command, docs pattern, or convention already solves the gap. |
| `USE_PLATFORM_NATIVE` | Runtime, stdlib, platform config, or local docs can solve it without new owned code. |
| `MINIMAL_PATCH` | The gap is real, owned, bounded, and locally verifiable. |
| `HUMAN_TASTE` | Product taste, UX tradeoff, naming, priority, or acceptance judgment is needed. |
| `EXPERT_PACKET` | Architecture, domain, security, provider, release, or specialist judgment is needed. |
| `AUTHORITY_BLOCK` | Credentials, permissions, publishing, protected boundaries, or missing authority prevent progress. |

Expert packets are created only after the router says outside judgment is needed. Product, architecture, security, release, provider, and domain-authority changes cannot close with terminal outcome `SHIP`. Remote/public skills, MCP servers, connectors, and external patterns may inspire local design, but they are not imported or executed unless vendored, provenance-recorded, evaluated, and explicitly authorized.

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
Outcome: <DONE|PARTIAL_WITH_EXPLICIT_SCOPE|REJECTED>
Round: <round/task>
Progress: <before>/100 -> <after>/100
Confidence: <0-10>/10
Worker:
Stream:
Task:
Phase:

## What changed

One paragraph answering what actually changed, what artifact/result was produced, and practical effect.

## Why it matters

One short paragraph naming current top-level state and PM/product effect.

## What is blocked

Blocker plus exact reason, or none.

## What decision is needed

Decision needed from user:
Options considered:
Scope limit:
Stop rule:

## Next action

Recommended next action:
Goal:
Allowed scope:
Forbidden scope:

## Evidence

Passed:
Skipped:
Evidence artifacts:

## Accountability

requested_work_type:
actual_work_type_performed:
credentials_touched:
provider_access_touched:
data_output_created:
commit_created:
remaining_blocker:
```

Worker-report generation must reject missing or invalid `Outcome`, `requested_work_type`, or `actual_work_type_performed`. The harness must not infer `PARTIAL_WITH_EXPLICIT_SCOPE` by default, because that would recreate silent fallback behavior.

Generated worker-report artifacts must use artifact v2 only: the first non-empty line is `Outcome:`, with `Round`, `Progress`, and `Confidence` immediately visible. The Ship-Fast Decision Gate concept is folded into `## What decision is needed` as one user decision, options considered, scope limit, and stop rule. Reports must not begin with `# Worker PM Brief`, `# Worker Report`, numbered logs, SAW Verdict, ClosurePacket, or command logs. SAW and ClosurePacket details are evidence only and must not appear as a second primary report skeleton. Silent docs-only fallback from code, test, provider_probe, commit, validation, execution, or data_output work is forbidden.

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

## Domain Governance Validation Surface

Phase 11 adds a read-only validation/control-plane gate for downstream domain governance. The product surface is evidence validation, not domain execution: no provider credentials, trading/ranking behavior, broker/order/alert paths, ontology UI, release automation, or publish-policy weakening is authorized.

```bash
meta-harness domain-governance check --target <repo> --json
meta-harness ready --target <repo> --quick --read-only --json
```

When a repo has `.meta-harness/domain-governance/activation.json`, `.meta-harness/domain-governance/pilot-chain.json`, or `domain/` rule evidence, `ready` runs `MH_DOMAIN_GOVERNANCE_001`. The gate validates activation, pilot chain, fact ledger, ontology terms, fact-to-code mappings, golden cases, signed domain reviews, mapped `fact_id` references in code, patch-plan code coverage, and expired facts. Repos without a domain-governance surface skip the check.

## Post-Worker GitHub Actions

Post-worker automation is a read-only evidence wrapper. It may validate worker-report v2 shape while excluding `worker-report-template.md`, no-silent-fallback accountability, changed-file allowlists with explicit `base_sha` and `head_sha`, YAML/Markdown hygiene, and SAW evidence placement.

It must not use repository secrets, provider access, WRDS, runtime/dashboard/scoring/broker paths, data output, or untrusted issue/PR/comment text as agent prompt input. Third-party actions and reusable workflow callers must be pinned by full commit SHA before cross-repo production reuse. Repair edits require a separate explicit approval.

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
meta-harness quality
meta-harness lookback
meta-harness poll
meta-harness repos
meta-harness mcp
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
| `quality` | Install and enforce a repo-local clean-code contract and ratcheting baseline. |
| `lookback` | Render retrospective from events. |
| `poll` | Read local/child status files and summarize changes. |
| `repos` | Manage child repo index. |
| `mcp` | Run a local read-only stdio MCP server and Strategic Semantic Loop utilities. |

Implemented command examples:

```bash
meta-harness init "Build coding and research visibility"
meta-harness event --stream research --phase work --action "surveyed adjacent products" --result "copy visibility and persistence"
meta-harness worker-report codex-researcher --stream research --task "extract patterns" --outcome DONE --round ROUND-001 --progress "10/100 -> 20/100" --confidence "9/10" --result "normalized product-pattern PM brief" --human-summary "Research output is ready for PM synthesis." --validations-passed "worker brief parsed" --validations-skipped "none" --evidence-artifacts ".meta-harness/workers/codex-researcher.md" --requested-work-type docs --actual-work-type docs --next-action "synthesize status"
meta-harness templates install
meta-harness expert-packet ROUND-001 --include docs/product/product-spec.md
meta-harness quality init
meta-harness quality check
meta-harness status --refresh
meta-harness lookback --write
meta-harness repos add child ../child-repo
meta-harness poll --write
meta-harness mcp init
meta-harness mcp serve --list-tools
meta-harness mcp insight extract --diff HEAD --json
meta-harness mcp research prompt --question "DuckDB concurrency" --files lib/insight-extractor.js
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
- no MCP connector, daemon, or agent execution surface for routing.

Phase 16 exception (D041): a dependency-free read-only stdio JSON-RPC server is authorized as the `meta-harness mcp serve` surface. It exposes deterministic read-only tools (`harness-status`, `harness-research-prompt`, `harness-insight-summary`) and pure strategic-loop library utilities (`mcp insight extract`, `mcp research prompt`). No write-enabled file tools, shell execution tools, HTTP/SSE listener, OAuth, Cloudflare tunnel, LLM API calls, network calls, or committed MCP config are authorized in this slice.

## Acceptance Criteria

The one-shot MVP is acceptable when:

- `npm install -g meta-harness` exposes `meta-harness`;
- `meta-harness init` creates starter Markdown state;
- `meta-harness event` appends to `events.jsonl`;
- `meta-harness status` prints official status;
- `meta-harness worker-report` creates a worker-report artifact from a template;
- `meta-harness worker-report` starts generated reports with `Outcome`, `Round`, `Progress`, and `Confidence` as the first visible fields;
- `meta-harness worker-report` rejects missing or invalid `--outcome`, `--requested-work-type`, or `--actual-work-type`;
- `meta-harness worker-report` rejects `DONE` when code, test, provider_probe, commit, validation, execution, or data_output work silently falls back to docs-only output;
- `meta-harness templates install` copies reusable harness templates into local harness state, refreshes the generated worker-report template on `--overwrite`, and preserves existing status truth;
- `meta-harness contract scan` rejects active repository guidance that requires worker-report metadata or the full PM brief as the final chat response;
- SOP and packaged templates define Question Zero: "Does this need to be built?";
- routing requires local repo, platform/native, existing dependency, and packaged-template scans before new implementation;
- expert packets are created only after build-vs-borrow routing says outside judgment is needed;
- product, architecture, security, release, provider, and domain-authority changes cannot close with terminal outcome `SHIP`;
- remote/public skills, MCP servers, connectors, and external patterns are not imported or executed unless vendored, provenance-recorded, evaluated, and explicitly authorized;
- `meta-harness expert-packet` writes one compact review `.zip` without copying caches, runtime folders, dependencies, or oversized files;
- `meta-harness quality init` creates `.meta-harness/clean-code-contract.json` and `.meta-harness/baseline/quality-baseline.json`;
- `meta-harness quality check` blocks new overbudget files and ratchets grandfathered debt;
- expert packet delivery has no loose sidecar `main.diff`, `main_next_scope.md`, or extra packet files beside the zip;
- packaged templates include `post-worker-github-actions.md`;
- repo-level post-worker workflow checks remain read-only and do not use secrets or provider/runtime/data paths;
- `meta-harness lookback` renders a timeline;
- `meta-harness poll` reads local and child statuses without launching agents;
- docs explain the human/Codex translation boundary;
- no dashboard, daemon, or agent spawning exists; a substantial local governance/control-plane surface has accumulated and is scheduled for R1 reduction;
- `meta-harness mcp serve` starts a dependency-free read-only stdio JSON-RPC MCP server exposing `harness-status`, `harness-research-prompt`, and `harness-insight-summary` tools;
- `meta-harness mcp insight extract` reads a git diff and task log and returns a structured JSON/Markdown insight summary;
- `meta-harness mcp research prompt` reads local file context and a user question and returns a formatted Deep Research prompt for copy-paste to external web UIs;
- `meta-harness mcp` tools do not make network calls, access provider credentials, write files, execute shell commands, or require package dependencies beyond the existing runtime.

Current implementation status: complete for the listed acceptance criteria as a local npm package binary with dependency-free Node runtime.
