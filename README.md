# Meta-Harness

Meta-Harness is a local coding system for one owner.

State the product result once. Meta-Harness carries it into a read-only coding worker, validates and materializes bounded file contents, protects existing work, runs exact validation, repairs bounded failures, and returns the observable result.

```text
accepted result
→ code
→ validation
→ repair
→ delivered result
```

## Primary command

```powershell
meta-harness work E:\Code\my-project `
  --goal "Add CSV export to the report page" `
  --allow src `
  --allow tests
```

The default output is product-facing:

```text
Outcome: DONE
Product result: Add CSV export to the report page
Current state: The owner has authorized this coding result...
Observable result: The report page now exports the visible rows as CSV.
Workspace: isolated — E:\Code\my-project\.worktrees\meta-harness-...
Validation: 2/2 passed
Commit: not_authorized
Push: not_authorized
Blocker: none
Next: Review and bank the delivered change.
```

The low-friction `--goal` path defaults to no commit or push. For each allowed path it walks toward the repository root, selects the nearest regular `package.json`, and requires every allowed path to resolve to the same package. Meta-Harness then seals exact controller-owned `npm test` validation with that package directory as `cwd`. Missing, malformed, symlinked, placeholder, or cross-package validation returns `BLOCKED` before workspace creation, worker launch, or repository mutation. Use an explicit sealed work session when validation requires another command. An explicit sealed work session may authorize the controller to commit exact validated paths and optionally push the current branch to `origin`. Tags, publication, clean, reset, stash, and revert remain outside this flow.

## Work sessions

For precise scope and validation, use a sealed `work-session/v1` JSON file:

```powershell
meta-harness work E:\Code\my-project --session .\work-session.json
```

The session binds:

- product result and current journey state;
- immediate action and newly true behavior;
- done and stop conditions;
- reversible worker authority and owner-only decisions;
- allowed paths;
- dirty-worktree policy;
- exact validation commands;
- bounded repair attempts;
- explicit controller authority to commit and optionally push.

See `templates/contracts/work-session-v1.md` for the complete contract.

A low-friction `--goal` invocation creates a safe default session. Use explicit session JSON when exact commands or path boundaries matter.

## Resume

Meta-Harness stores the sealed work session under the repository Git common directory, outside tracked working-tree bytes.

```powershell
meta-harness work E:\Code\my-project --resume
```

The resumed worker receives the same product result, boundaries, and stop conditions. It does not reconstruct intent from status files or reopen planning.

## Dirty repositories

Meta-Harness treats dirtiness as a workspace-selection fact, not a generic gate.

```text
clean checkout
→ work in place

all existing changes inside allowed paths
→ continue coherent work with --continue-dirty

unrelated or cross-boundary changes
→ preserve them and create an ignored repository-local `.worktrees/` worktree
```

Inspect the choice without creating a worktree or launching a worker:

```powershell
meta-harness work E:\Code\my-project `
  --goal "Repair the parser" `
  --allow src/parser `
  --dry-run `
  --json
```

## Validation and repair

Explicit sessions declare validation as exact argument arrays:

```json
{
  "argv": ["npm", "test", "--", "parser"],
  "cwd": ".",
  "timeoutSeconds": 300
}
```

The Codex worker remains read-only and returns complete `{ path, content }` changes. Meta-Harness rejects traversal, symlinks, duplicate paths, oversized content, and files outside the session boundary before controller-owned materialization.

Meta-Harness runs validation commands outside the model. If validation fails and the retry budget remains, the failure is returned to the same work session for bounded repair.

After a `DONE` result and passed validation, Meta-Harness hashes the exact accepted paths. It commits only when `delivery.commit` is true, blocks if those bytes changed after validation, preserves unrelated dirty and staged paths, and pushes the current branch to `origin` only when `delivery.push` is true. A successful push is reported only after remote HEAD equals the local commit.

After every worker attempt and materialization, Meta-Harness rejects:

- changes outside allowed paths;
- staging or index mutation;
- commits or HEAD movement;
- branch changes.

## Product surface and advanced tools

Default help exposes one coding journey:

```powershell
meta-harness --help
```

Authority, custody, review, release, portfolio, and maintenance tools remain available as advanced internals:

```powershell
meta-harness help --advanced
```

They are not the normal product mental model and no compatibility aliases are maintained.

## Advanced worker-report evidence

The legacy worker-report command remains an advanced evidence surface. Its first five non-empty lines are:

```text
User journey executed
Observable result produced
User accomplished or learned
Product blocker
Next executable product action
```

Worker reports place no title or internal metadata before them. This evidence contract does not replace the shorter `work` product result shown to the owner.

## Post-phase learning

Template installation adds a managed reflection block to root `AGENTS.md`. Sync verifies that active guidance matches the packaged contract.

`E:\Code\post_phase_reflection.md` is reserved for durable cross-repository lessons. Detailed branch state, test transcripts, custody receipts, and temporary blockers belong in the affected repository.

## Installation

```powershell
npm install -g @nkgss/meta-harness
meta-harness --help
```

Requirements:

- Node.js 20 or newer;
- Git;
- local Codex CLI with an authenticated `CODEX_HOME`;
- validation tools required by the target repository.

## Development

```powershell
npm test
node bin\meta-harness.js --help
node bin\meta-harness.js help --advanced
node bin\meta-harness.js quality check
node bin\meta-harness.js sync check --target .
```

## Deliberate boundaries

This coding product does not include a queue, daemon, scheduler, swarm, generic provider layer, dashboard, RunSpec migration, automatic publication, or destructive worktree management.

The owner remains responsible for scope expansion, credentials, protected access, publication, destructive action, and material risk decisions.
