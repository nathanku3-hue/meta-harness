# Work Session v2

`work-session/v2` is the canonical bridge from owner product direction plus an accepted product result into coding execution.

It replaces conversational planning memory, recursive planner packets, and routine approval prompts for reversible in-scope work. It does not replace owner authority for scope expansion, credentials, publication, destructive action, product-direction changes, or material risk.

There is no supported `work-session/v1` compatibility path. Active sessions must carry an exact product-direction snapshot.

## Product flow

```text
owner-authored PRODUCT.md
→ exact bytes + digest pin
→ accepted product result
→ sealed work session
→ dirty-worktree continuation or isolation
→ read-only coding worker (direction first)
→ controller materialization
→ focused validation
→ bounded repair
→ authorized exact-path commit
→ optional authorized push and remote verification
→ observable result
```

## Required JSON shape

```json
{
  "schemaVersion": "work-session/v2",
  "productDirection": {
    "schemaVersion": "product-direction/v1",
    "sourcePath": "PRODUCT.md",
    "version": "product-direction-v1",
    "digest": "sha256:<64 lowercase hex of raw PRODUCT.md bytes>",
    "content": "<exact owner-authored PRODUCT.md text>"
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
    "Change PRODUCT.md.",
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
  "delivery": {
    "commit": true,
    "push": false
  },
  "sessionDigest": "sha256:<computed by Meta-Harness>"
}
```

## Product direction rules

- `PRODUCT.md` is repository-root, owner-authored, regular-file only.
- Required headings: Version, Endgame, Target user, Core user journey, Taste — prefer, Taste — reject, Non-negotiables, Shipping definition, Change rule.
- Digest hashes raw file bytes. Session content must recompute to the same digest.
- `--goal`, `--session`, and `--resume` all require a live `PRODUCT.md` that matches the sealed snapshot.
- Any mid-session change, deletion, symlink, unreadable file, malformed headings, or digest mismatch returns:

```text
Product direction changed since this work session was created.
Start a new work session from the new direction.
```

- Controller materialization rejects any write targeting `PRODUCT.md` even if a session lists it in `allowedPaths`.

## Dirty-worktree behavior

- Clean checkout: work in the checkout.
- Existing changes entirely inside `allowedPaths` with `continue-in-scope`: inspect and continue them.
- Unrelated or cross-boundary dirtiness: preserve it and create an isolated sibling worktree.
- Never reset, clean, stash, or revert owner work automatically.
- The coding worker remains read-only and returns complete `{ path, content }` file changes.
- Meta-Harness rejects traversal, symlinks, duplicate paths, oversized content, out-of-bound files, and `PRODUCT.md` mutations before controller-owned materialization.

## Human output

The normal result surface is:

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

Hashes, gate identifiers, custody records, and release evidence remain available through advanced commands and machine-readable artifacts. They are not the default product mental model.

## Commands

```text
meta-harness work <repository> --goal <result> [--allow <path>]
meta-harness work <repository> --session <work-session.json>
meta-harness work <repository> --resume
```
