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

`--goal` creates a complete low-friction session with safe defaults. Explicit session JSON is used when exact done criteria, paths, or validation commands matter.

## Workspace resolution

Before launching a worker, Meta-Harness reads Git state with porcelain-v1 NUL framing and rename/copy awareness.

### Clean repository

Use the current checkout.

### Coherent dirty repository

When every existing changed path is inside `allowedPaths` and policy is `continue-in-scope`, preserve and continue the current work. Dirtiness is not treated as a generic blocker.

### Unrelated or cross-boundary dirtiness

Create or reuse an isolated sibling worktree and branch derived from the session digest. The original checkout remains byte-preserved.

### Prohibited dirty handling

Meta-Harness never automatically:

- resets;
- cleans;
- stashes;
- reverts;
- stages;
- commits;
- pushes;
- tags;
- publishes;
- prunes or closes worktrees.

Work-session and result artifacts are stored under the repository Git common directory, outside tracked working-tree bytes.

## Coding worker

The supported worker is the local Codex CLI in read-only mode.

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

The coding system has reached `85/100` because:

1. deterministic tests prove clean, coherent-dirty, isolated-dirty, resume, retry, and boundary behavior;
2. a real Codex process returns bounded code, the controller materializes it, and exact validation passes;
3. Meta-Harness self-hosts bounded work without a planning restart or routine owner intervention;
4. default help exposes one product journey and advanced internals remain separate;
5. complete tests, sync, whitespace, and package verification pass; quality analysis confirms one public command and no new coding-module budget violation, while unrelated inherited ratchet debt remains visible and non-blocking;
6. the durable reflection records the corrected product model.
