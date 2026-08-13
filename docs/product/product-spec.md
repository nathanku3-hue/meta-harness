# Meta-Harness Coding-System Product Specification

## Product promise

Meta-Harness turns one accepted software result into a delivered repository change with minimal owner intervention:

```text
product result
→ sealed working brief
→ safe workspace
→ coding worker
→ exact validation
→ bounded repair
→ observable result
```

The normal product is not a gate console. Authority, custody, review, release, and evidence machinery remain internal support surfaces.

## Primary interaction

```text
meta-harness work <repository> --goal <result> [--allow <path>]
meta-harness work <repository> --session <work-session.json>
meta-harness work <repository> --resume
```

`--dry-run` resolves the work session and workspace without creating a worktree or launching a worker. `--json` emits `work-result/v1`.

Exactly one top-level command is public: `work`. All other commands are advanced/internal and remain discoverable through:

```text
meta-harness help --advanced
```

No deprecated aliases or compatibility command names are maintained.

## Product direction

Repository-root `PRODUCT.md` is the owner-authored product direction. Meta-Harness may read, hash, snapshot, and fail closed on drift. It must not generate, fill, summarize, relocate, or overwrite it. Required headings:

```text
Version
Endgame
Target user
Core user journey
Taste — prefer
Taste — reject
Non-negotiables
Shipping definition
Change rule
```

Digest is SHA-256 over the raw file bytes. Maximum size is 128 KiB. Symlinks, non-regular files, invalid UTF-8, missing headings, empty sections, and oversized files fail closed before workspace creation or worker launch.

Controller materialization rejects any proposed write targeting `PRODUCT.md` regardless of `allowedPaths`.

## Work-session contract

`work-session/v2` is exact, digest-bound JSON. There is no supported v1 compatibility path. Required fields:

```text
schemaVersion
productDirection.schemaVersion
productDirection.sourcePath
productDirection.version
productDirection.digest
productDirection.content
productResult
journeyState
doNow
newlyTrueBehavior
doneWhen
stopOnlyIf[]
authorizedReversibleActions[]
ownerOnlyActions[]
allowedPaths[]
validation[]
maxAttempts
delivery.commit
delivery.push
sessionDigest
```

The session digest is domain-separated SHA-256 over canonical session content excluding `sessionDigest`. Product-direction digest is SHA-256 over raw `PRODUCT.md` bytes and must match `productDirection.content`.

### Meaning

- `productDirection`: exact owner-authored direction snapshot used for the whole session.
- `productResult`: owner-visible result to deliver.
- `journeyState`: relevant truth already established.
- `doNow`: first executable coding action.
- `newlyTrueBehavior`: behavior that must become true.
- `doneWhen`: observable completion and validation.
- `stopOnlyIf`: material conditions that invalidate continued execution.
- `authorizedReversibleActions`: work the coding worker may perform without another owner decision.
- `ownerOnlyActions`: scope, product-direction change, access, publication, destructive action, or material risk reserved for the owner.
- `allowedPaths`: exact repository-relative edit boundary; traversal and `.git` are rejected; `PRODUCT.md` remains protected even if listed.
- `validation`: exact argv, cwd, and timeout commands run by Meta-Harness, not trusted from worker narrative.
- `maxAttempts`: one to three coding/repair attempts.
- `delivery.commit`: explicit controller authority to commit the exact validated accepted paths.
- `delivery.push`: explicit controller authority to push the resulting commit; valid only when commit authority is also true.

`--goal` pins live `PRODUCT.md` and creates a complete low-friction session with safe defaults. For each allowed path, Meta-Harness selects the nearest regular `package.json` between that path and the repository root; every allowed path must resolve to the same package. It seals exact controller-owned `npm test` validation with the selected package directory as `cwd`. Missing product direction, missing validation, malformed packages, symlinks, placeholders, or cross-package validation returns `BLOCKED` before workspace creation, worker launch, or repository mutation. Explicit session JSON is required when validation uses another command or when exact done criteria and path boundaries matter. Explicit sessions still require a live matching `PRODUCT.md`.

## Workspace resolution and custody

Workspace authority is identity-based, not cleanliness-based. `dirtyPolicy` and `continue-in-scope` do not exist.

### NEW

Every new work session:

1. resolves the source repository and seals its exact current HEAD as the immutable `baseHead`;
2. allocates a fresh random `workspaceId`;
3. creates a new ignored repository-local `.worktrees/meta-harness-<workspaceId>` worktree and unique branch from `baseHead`, even if the source checkout is clean;
4. proves the new worktree is clean and exactly at `baseHead`;
5. writes a create-only workspace identity marker inside that linked worktree's Git administrative directory;
6. writes digest-bound `workspace-custody/v1` under the Git common directory and transitions `CREATED_CLEAN → ACTIVE`, generation 1;
7. acquires a controller-owned workspace execution lease before any material attempt begins.

The source checkout is never a coding execution workspace. Existing source mutable bytes are preserved but never inherited.

### RESUME

`--resume` is the only reuse path. It requires the exact persisted session plus controller-owned workspace custody to remain `ACTIVE`, with matching repository root, workspace UUID, physical path, Git administrative identity marker, branch, sealed `baseHead`, current HEAD, generation, live `PRODUCT.md`, and expected dirty-manifest digest. Before execution, the controller must also acquire the workspace's exclusive execution lease; a concurrent controller receives `MH_WORKSPACE_BUSY`. A mismatch returns `MH_WORKSPACE_CUSTODY_MISMATCH`; a terminal state returns `MH_WORKSPACE_NOT_EXECUTABLE`. Meta-Harness never updates the expected manifest because new dirt "looks in scope."

### Terminalization

A workspace becomes permanently non-executable when the bounded session ends:

- committed success → `TERMINAL_COMMITTED`;
- validated success without commit authority → `TERMINAL_SEALED_DIRTY`;
- blocked/exhausted work → `TERMINAL_BLOCKED` or `TERMINAL_BLOCKED_DIRTY`;
- explicit abandonment → `TERMINAL_ABANDONED`.

Terminal bytes may remain for inspection or owner action. Cleaning, resetting, restoring the same bytes, or deleting/recreating the same physical path cannot restore workspace authority. Immutable commits may be selected as later bases; terminal mutable workspaces are never reused.

### Prohibited dirty handling

Meta-Harness never automatically:

- resets;
- cleans;
- stashes;
- reverts;
- tags;
- publishes;
- prunes or closes worktrees.

Staging, commit, and push are controller-owned delivery actions. They occur only after a `DONE` result and passed validation, and only when the sealed `delivery` authority permits them.

Work-session, result, execution-permit, and workspace-custody artifacts are stored under the repository Git common directory, outside tracked working-tree bytes. The workspace identity marker lives in the linked worktree's Git administrative directory, also outside working-tree bytes.

## Coding worker

The supported worker is the local Codex CLI in read-only mode. In WSL, Meta-Harness may invoke the installed Windows Codex through its Windows Node executable while translating only controller-owned workspace, schema, and output paths; prompt and argument boundaries remain direct and shell-free.

The process receives, in order:

- product direction exact snapshot;
- product result, journey state, do-now, newly true behavior, and done when;
- repository-local instructions and relevant implementation context;
- read-only sandbox authority and no interactive approval prompts;
- exact path and action boundaries;
- explicit prohibition on planning restart, product-direction mutation, direct filesystem mutation, scope widening, compatibility work, Git publication, credentials, and destructive operations.

The worker returns structured JSON:

```text
status: done | partial | blocked
observableResult
changes[] = { path, content }
validation[]
blocker
nextAction
```

Meta-Harness validates every proposed path, rejects traversal, symlink targets, duplicates, oversized content, and out-of-bound files, then materializes regular-file writes through the controller. Deletion is not supported in this slice.

Worker-reported validation is advisory. Declared session validation remains authoritative for the work result.

## Post-worker enforcement

Before each worker attempt, Meta-Harness compiles an immutable `execution-permit/v1` from the sealed work session plus the exact current `ACTIVE` workspace custody, exclusive controller execution lease, and Git facts. `ExecutionPermit.generation` equals `WorkspaceCustody.generation`, and the permit binds the workspace UUID, custody-record digest, and execution-lease digest in addition to HEAD, branch, owned paths, and dirty manifest. Permit issuance, generation advance, and terminalization require the same live lease. The permit is create-only and consumed before worker launch. A bounded repair advances workspace custody to generation N+1 before the next permit is compiled; replay of a consumed or stale-generation permit fails closed. The permit grants only named material capabilities. Outcome read, evaluation, trial debit, state transition, route reopening, publication, and capital-action capabilities are known but denied unless a future controller path explicitly grants them.

The normal worker runtime cannot be replaced by the configured test worker hook unless `META_HARNESS_TEST_MODE=1`; production execution remains on the sandboxed read-only worker.

Before materialization, Meta-Harness proves the consumed permit still matches live `PRODUCT.md`, session identity, repository/workspace identity, HEAD, branch, owned paths, and the attempt's initial dirty manifest. This proves the read-only worker left the generation baseline unchanged. It then validates and materializes the returned file contents only under the permit's `CONTROLLER_MATERIALIZE` capability.

After materialization, Meta-Harness proves:

- HEAD is unchanged;
- branch identity is unchanged;
- Git index bytes are unchanged;
- all changed and renamed paths remain inside `allowedPaths`.

Any violation fails closed.

Meta-Harness then runs each exact validation command. If validation fails and attempts remain, the controller advances the same ACTIVE workspace to the next generation using the exact post-validation dirty-manifest digest, then sends the failure output back for bounded repair under a newly compiled permit. The product result, product-direction snapshot, and boundaries do not change between attempts. `--resume` never repairs custody mismatches and never reopens terminal workspaces.

## Delivery close

After a `DONE` result and passed validation, Meta-Harness:

1. captures SHA-256 hashes for the exact worker-returned accepted paths;
2. checks sealed commit authority;
3. verifies those path hashes are unchanged;
4. stages only the accepted paths and verifies no additional path entered staging;
5. commits only those paths while preserving unrelated dirty and staged paths;
6. optionally pushes the current branch to `origin` when push authority is sealed;
7. reports `remote_equal` only after remote HEAD equals the local commit.

A `PARTIAL` or `BLOCKED` result is never delivered.

## Work result

`work-result/v1` reports:

```text
outcome: READY | DONE | PARTIAL | BLOCKED
productResult
currentState
observableResult
workspace
changedPaths
validation
delivery
blocker
nextAction
attempts
sessionDigest
executionPermits[] = { permitId, attemptId, generation, permitDigest, state }
timestamps
```

Human output leads with product meaning. Evidence details are secondary.

## Product-language boundary

Normal human surface:

```text
Outcome
Product result
Current state
Observable result
Workspace
Validation
Commit
Push
Blocker
Next
```

Advanced evidence surface may expose:

```text
gate/check identifiers
hashes
candidate identities
custody
review verdicts
publication reconciliation
```

Internal terminology must not dominate the coding journey.

## Advanced worker-report evidence

The historical `worker-report` command remains an advanced evidence surface. Reports must not begin with `# Worker PM Brief` or other metadata. Their first five non-empty lines remain:

```text
User journey executed
Observable result produced
User accomplished or learned
Product blocker
Next executable product action
```

This contract preserves machine and audit consumers without making worker-report terminology the default coding product.

## Post-phase reflection

The canonical reflection contract is installed as an idempotent marked block in root `AGENTS.md` and checked by sync.

`E:\Code\post_phase_reflection.md` contains durable cross-repository lessons only. It excludes repository status logs, branch inventories, test transcripts, custody receipts, temporary blockers, and duplicate roadmap state.

## Safety and authority

The coding worker may perform reversible edits and focused validation within the work session. It cannot decide or perform:

- scope expansion;
- credential use or protected access;
- irreversible data mutation;
- publication;
- destructive cleanup;
- material product or risk decisions.

The historical semantic authority, execution-custody, review, and release subsystems remain advanced tools for decisions that genuinely require them. They do not gate ordinary coding by default.

## Deliberate exclusions

No RunSpec/v3, provider abstraction, queue, daemon, scheduler, swarm, dashboard, recursive planner packet, compatibility path, or automatic Git publication is part of this product slice.

## Acceptance

`SOTA_ASSIMILATION_EPISODE_1` raises the working product evidence to `84/100`:

1. exact baseline on Eureka revision `41723ff80d7b919cb536c4fa296670de9b7ce5aa` reproduced `--goal` as `BLOCKED` because validation existed only in `learn-diff/package.json`;
2. two bounded frontier-search rounds selected scope-nearest package resolution over repository-wide enumeration or additional configuration, then the resolver changed the same journey from `BLOCKED` to `READY`;
3. the accepted Eureka change rejects unknown CLI options, preserves documented parsing, and reaches terminal `DONE` in an isolated repository-local worktree with controller-owned `npm test` passing 30/30;
4. WSL launches the existing Windows Codex through Windows Node without a shell, and passed controller validation can return a contradictory worker-marked partial result for bounded completion instead of accepting narrative as product truth;
5. the unconsumed research ingest, summarize, and handoff runtime paths and their self-referential tests were deleted without aliases or a compatibility interval;
6. terminal Meta-Harness verification passes 109 test files and 762 tests, sync checks 33 artifacts, whitespace and package dry-run checks pass, and the episode's new modules/tests remain inside their line budgets.

The quality ratchet still reports inherited and pre-existing working-tree debt, including the already-open `work-git.js` isolation slice; it did not identify a new Episode 1 module-budget violation. `85/100` remains unclaimed because the successful target delivery required an explicit sealed session and a deterministic status finalizer after observed worker transport/policy defects. Commit and push were not authorized.
