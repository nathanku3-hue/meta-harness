# Phase 8 Read-Only Scout Plan

Status: planning-only
Roadmap phase: Phase 8 - Read-only subagent scout pilot
Implementation status: not started
Promotion status: none
Decision required before implementation: explicit Phase 8 go decision

## Activation Gate

Phase 8 planning may be merged only when:

- The PR base includes the PR #6 merge-protocol gate.
- The PR base includes the Phase 7 repo-adoption-doctor prototype.
- Current gate evidence is green: `npm test`, `node bin/meta-harness.js quality check`, `git diff --check`, `npm pack --dry-run --json`, and `node bin/meta-harness.js merge check --scope roadmap-docs`.
- No Phase 7 promotion is required for planning.

Phase 8 implementation must not start until an explicit Phase 8 go decision is recorded.
If any activation gate is not true, the planning PR must remain draft or blocked.

## Pilot Boundary

Phase 8 pilots read-only scouts only.

Allowed:

- bounded repo inspection
- bounded file listing
- bounded text search
- structured evidence return
- reconciler validation by the main agent

Forbidden:

- arbitrary shell execution
- repo writes
- package or dependency changes
- workflow changes
- promotion changes
- Phase 8 command implementation
- raw chat transcripts
- secrets, credentials, provider output, runtime data, or governed data
- binary, archive, dependency, cache, or oversized file reads
- broad repo dumps

## Scout Roles

| Role | Access | Purpose |
|---|---|---|
| Repo Scout | read-only | Map files, ownership, directory structure, and template state. |
| Security Scout | read-only | Check secrets posture, CI posture, dependency files, workflows, gitignore, CODEOWNERS, and security policy. |
| Test Scout | read-only | Identify coverage gaps, regression paths, oversized tests, and missing focused tests. |

## Packet Schema

Each scout packet must include:

```json
{
  "role": "repo-scout",
  "task": "",
  "allowed_tools": ["read_file", "list_dir", "grep_search"],
  "allowed_shell_commands": [],
  "forbidden_paths": [
    ".env",
    ".env.*",
    "secrets",
    "credentials",
    "provider-config",
    "runtime",
    "data",
    "node_modules",
    ".git"
  ],
  "max_files": 50,
  "max_kb": 100,
  "return_schema": {
    "findings": [
      {
        "path": "",
        "issue": "",
        "severity": "block|warn|info",
        "evidence": ""
      }
    ],
    "summary": "",
    "check_ids_referenced": []
  },
  "stop_rule": "Stop if the task requires writes, shell execution, forbidden paths, secrets, provider/runtime data, governed data, broad repo dumps, or more context than the packet budget allows."
}
```

## Fanout Budget

Initial budget:

```json
{
  "max_concurrent_scouts": 2,
  "max_context_per_scout_kb": 100,
  "max_total_fanout_kb": 200,
  "timeout_seconds": 120,
  "max_retries_per_scout": 0
}
```

Use 3 scouts only after a separate review confirms the 2-scout pilot is too narrow.

## Reconciler Rule

Scout output is evidence, not authority.

The reconciler must:

- validate findings against current repo state
- deduplicate overlapping findings
- discard unsupported claims
- preserve evidence paths
- leave final decisions to the main agent or reviewer

## Implementation Exit Criteria

A future Phase 8 implementation PR may proceed only when it includes:

- scout packet generation
- enforced fanout budget
- reconciler validation and deduplication
- tests for denylist behavior
- tests for budget enforcement
- tests for schema validation
- tests proving scouts cannot write to the repo
- tests proving scout paths are canonicalized under the repo root
- tests proving scouts cannot follow symlinks into forbidden or outside paths

## Non-Goals

This planning PR does not:

- implement `lib/subagent-packet.js`
- add `lib/scout-reconciler.js`
- add `lib/fanout-budget.js`
- add tests
- add a Phase 8 command
- promote repo-adoption-doctor
- start Phase 8 code
- run CRLF normalization
- apply the roadmap stash
