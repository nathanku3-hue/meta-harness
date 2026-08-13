# Meta-Harness

Meta-Harness is a local coding system for one owner.

State the product result once. Meta-Harness carries it into a read-only coding worker, validates and materializes bounded file contents, protects existing work, runs exact validation, repairs bounded failures, and returns the observable result.

```text
owner product direction
→ accepted result
→ code
→ validation
→ repair
→ delivered result
```

Author repository-root `PRODUCT.md` once (Version, Endgame, Target user, Core user journey, Taste — prefer, Taste — reject, Non-negotiables, Shipping definition, Change rule). Every `work` session pins those exact bytes. Meta-Harness never invents or rewrites product taste.

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

For precise scope and validation, use a sealed `work-session/v2` JSON file:

```powershell
meta-harness work E:\Code\my-project --session .\work-session.json
```

The session binds:

- exact product-direction snapshot from `PRODUCT.md`;
- product result and current journey state;
- immediate action and newly true behavior;
- done and stop conditions;
- reversible worker authority and owner-only decisions;
- allowed paths;
- exact validation commands;
- bounded repair attempts;
- explicit controller authority to commit and optionally push.

The canonical coding brief is `work-session/v3`; repo-directed sessions carry one explicit `origin.decisionDigest` provenance edge, while direct owner goals carry `origin.type = OWNER_GOAL`.

A low-friction `--goal` invocation pins live `PRODUCT.md` and creates a safe default session. Use explicit session JSON when exact commands or path boundaries matter. Explicit sessions still require a live matching `PRODUCT.md`.

## Optional repo decision authority

Complex repositories may opt into repo-owned decision authority by adding `.meta-harness/repo-charter.json`. The charter is opaque policy bytes to Meta-Harness: repository intelligence owns claims, hypotheses, evidence meaning, applicability, ranking, resurrection semantics, and any domain allocator. The kernel owns only identity, mechanically checkable attestation, single-entry execution authority, operational closure, immutable World lineage, and compare-and-swap authority.

```text
repo projector / interpreter
→ immutable repo-world/v2 + world-attestation/v1
→ world-transition/v1
→ immutable world-head/v1
→ current-world-pointer/v1
→ repo-decision/v2 = DISPATCH | NO_DISPATCH
   ├─ NO_DISPATCH → no session / workspace / permit / attempt
   └─ DISPATCH → work-session/v3 → ExecutionPermit → attempt-entry/v1
                → bounded worker / validation
                → aggregate execution-closure/v1
                → repo interpretation
                → world-transition/v1 → successor WorldHead
```

A `repo-decision/v2` binds live `PRODUCT.md`, opaque charter bytes, the authoritative WorldHead, and optional owner-directive bytes. A `DISPATCH` action contains only the generic execution brief needed by the coding kernel. `NO_DISPATCH` is inert and has finite generic reasons such as `WAIT_EXTERNAL`, `USE_PRODUCT`, and `NO_VALUABLE_ACTION`.

The first `AttemptEntry` is the Decision's permit-consumption event itself. Repo Decision admission and WorldHead transitions use the same short-lived repository authority lock, so a Decision cannot enter against a Head that concurrently ceased to be current and the same Decision cannot acquire two generation-1 entries. Bounded repair generations are continuations of the same admitted session/workspace authority.

`execution-closure/v1` closes the whole bounded execution and lists every AttemptEntry in order. Its disposition is operational only; terms such as support, inconclusive evidence, claim validity, or scientific failure remain repo interpretation. A hard controller interruption after AttemptEntry is recovered from durable controller evidence without replaying the material attempt.

Every authoritative World change is a `world-transition/v1`. Immutable WorldHead objects remain dereferenceable; only the tiny current-world pointer is mutable. Once a Decision is admitted against Head H, H is frozen until that execution is durably closed and banked. A durable result therefore cannot be overtaken by an unrelated reality refresh, omitted from required learning, or applied to a different predecessor lineage.

See `templates/contracts/repo-decision-plane-v1.md` for the protocol contract.

## Resume

Meta-Harness stores the sealed work session under the repository Git common directory, outside tracked working-tree bytes.

```powershell
meta-harness work E:\Code\my-project --resume
```

Resume is the only workspace-reuse path. It succeeds only when the latest workspace remains `ACTIVE` and its session digest, workspace UUID, Git administrative identity, branch, sealed base commit, generation, live `PRODUCT.md`, and expected dirty-manifest digest all still match. Terminal or mismatched workspaces never resume and are never repaired by heuristic dirt classification.

## Workspace custody

A new session never inherits a mutable workspace, even when the source checkout is clean.

```text
NEW
→ seal exact source HEAD as immutable base commit
→ create fresh UUID-backed ignored `.worktrees/` worktree
→ verify clean Git state
→ create controller-owned workspace custody
→ ACTIVE generation 1

RESUME
→ exact still-ACTIVE workspace custody only
→ exclusive controller execution lease

TERMINAL
→ bytes may remain
→ execution authority never returns
```

Source-checkout dirtiness is preserved byte-for-byte and is never classified as safe enough to continue. Only one controller may hold the execution lease for an ACTIVE workspace generation; concurrent resume fails closed. A successful no-commit result becomes `TERMINAL_SEALED_DIRTY`; a committed result becomes `TERMINAL_COMMITTED`. Immutable commits may be used as later bases, but terminal mutable workspaces are never reused. Cleaning, resetting, or recreating a terminal worktree cannot resurrect authority.

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
