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

## Work-session contract

`work-session/v1` is exact, digest-bound JSON. Required fields:

```text
schemaVersion
intent.version
intent.digest
productResult
journeyState
doNow
newlyTrueBehavior
doneWhen
stopOnlyIf[]
authorizedReversibleActions[]
ownerOnlyActions[]
allowedPaths[]
dirtyPolicy
validation[]
maxAttempts
delivery.commit
delivery.push
sessionDigest
```

The digest is domain-separated SHA-256 over canonical session content excluding `sessionDigest`.

### Meaning

- `productResult`: owner-visible result to deliver.
- `journeyState`: relevant truth already established.
- `doNow`: first executable coding action.
- `newlyTrueBehavior`: behavior that must become true.
- `doneWhen`: observable completion and validation.
- `stopOnlyIf`: material conditions that invalidate continued execution.
- `authorizedReversibleActions`: work the coding worker may perform without another owner decision.
- `ownerOnlyActions`: scope, access, publication, destructive action, or material risk reserved for the owner.
- `allowedPaths`: exact repository-relative edit boundary; traversal and `.git` are rejected.
- `dirtyPolicy`: `continue-in-scope` or `isolate`.
- `validation`: exact argv, cwd, and timeout commands run by Meta-Harness, not trusted from worker narrative.
- `maxAttempts`: one to three coding/repair attempts.
- `delivery.commit`: explicit controller authority to commit the exact validated accepted paths.
- `delivery.push`: explicit controller authority to push the resulting commit; valid only when commit authority is also true.

`--goal` creates a complete low-friction session with safe defaults. For each allowed path, Meta-Harness selects the nearest regular `package.json` between that path and the repository root; every allowed path must resolve to the same package. It seals exact controller-owned `npm test` validation with the selected package directory as `cwd`. Missing, malformed, symlinked, placeholder, or cross-package validation returns `BLOCKED` before workspace creation, worker launch, or repository mutation. Explicit session JSON is required when validation uses another command or when exact done criteria and path boundaries matter.

## Workspace resolution

Before launching a worker, Meta-Harness reads Git state with porcelain-v1 NUL framing and rename/copy awareness.

### Clean repository

Use the current checkout.

### Coherent dirty repository

When every existing changed path is inside `allowedPaths` and policy is `continue-in-scope`, preserve and continue the current work. Dirtiness is not treated as a generic blocker.

### Unrelated or cross-boundary dirtiness

Create or reuse an ignored repository-local `.worktrees/meta-harness-<digest>` worktree and branch derived from the session digest. The physical path, persisted session identity, and Git registration must agree; symlink, junction, substituted-path, or unregistered-worktree state fails closed. The original checkout remains byte-preserved.

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

Work-session and result artifacts are stored under the repository Git common directory, outside tracked working-tree bytes.

## Coding worker

The supported worker is the local Codex CLI in read-only mode. In WSL, Meta-Harness may invoke the installed Windows Codex through its Windows Node executable while translating only controller-owned workspace, schema, and output paths; prompt and argument boundaries remain direct and shell-free.

The process receives:

- read-only sandbox authority;
- no interactive approval prompts;
- the complete work session;
- repository-local instructions;
- exact path and action boundaries;
- explicit prohibition on planning restart, direct filesystem mutation, scope widening, compatibility work, Git publication, credentials, and destructive operations.

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

Before materialization, Meta-Harness proves the read-only worker left HEAD, branch identity, Git index bytes, and working-tree bytes unchanged. It then validates and materializes the returned file contents.

After materialization, Meta-Harness proves:

- HEAD is unchanged;
- branch identity is unchanged;
- Git index bytes are unchanged;
- all changed and renamed paths remain inside `allowedPaths`.

Any violation fails closed.

Meta-Harness then runs each exact validation command. If validation fails and attempts remain, the failure output is sent back to the same work session for repair. The product result and boundaries do not change between attempts.

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
