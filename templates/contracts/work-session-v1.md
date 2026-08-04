# Work Session v1

`work-session/v1` is the canonical bridge from an accepted product decision into coding execution.

It replaces conversational planning memory, recursive planner packets, and routine approval prompts for reversible in-scope work. It does not replace owner authority for scope expansion, credentials, publication, destructive action, or material risk.

## Product flow

```text
accepted product result
→ sealed work session
→ dirty-worktree continuation or isolation
→ read-only coding worker
→ controller materialization
→ focused validation
→ bounded repair
→ observable result
```

## Required JSON shape

```json
{
  "schemaVersion": "work-session/v1",
  "intent": {
    "version": "intent-v1",
    "digest": "sha256:<64 lowercase hex>"
  },
  "productResult": "The useful result the owner expects.",
  "journeyState": "What is already true before coding starts.",
  "doNow": "The nearest executable coding action.",
  "newlyTrueBehavior": "The behavior that must exist after this session.",
  "doneWhen": "Observable completion and validation conditions.",
  "stopOnlyIf": [
    "Scope expansion, protected access, irreversible mutation, material risk, or repository evidence makes continuation invalid."
  ],
  "authorizedReversibleActions": [
    "Read relevant repository files.",
    "Edit allowed paths.",
    "Run focused validation and repair failures."
  ],
  "ownerOnlyActions": [
    "Expand scope.",
    "Provide credentials or approve publication/destructive action."
  ],
  "allowedPaths": ["src", "tests"],
  "dirtyPolicy": "continue-in-scope",
  "validation": [
    {
      "argv": ["npm", "test"],
      "cwd": ".",
      "timeoutSeconds": 300
    }
  ],
  "maxAttempts": 2,
  "sessionDigest": "sha256:<computed by Meta-Harness>"
}
```

## Dirty-worktree behavior

- Clean checkout: work in the checkout.
- Existing changes entirely inside `allowedPaths` with `continue-in-scope`: inspect and continue them.
- Unrelated or cross-boundary dirtiness: preserve it and create an isolated sibling worktree.
- Never reset, clean, stash, or revert owner work automatically.
- The coding worker remains read-only and returns complete `{ path, content }` file changes.
- Meta-Harness rejects traversal, symlinks, duplicate paths, oversized content, and out-of-bound files before controller-owned materialization.
- Staging, commits, pushes, tags, publication, deletion, and worktree cleanup are outside the coding worker’s authority.

## Human output

The normal result surface is:

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

Hashes, gate identifiers, custody records, and release evidence remain available through advanced commands and machine-readable artifacts. They are not the default product mental model.

## Commands

```text
meta-harness work <repository> --goal <result> --allow <path>
meta-harness work <repository> --session <work-session.json>
meta-harness work <repository> --resume
```

Use `--dry-run` to inspect workspace selection without creating a worktree or launching a worker.
