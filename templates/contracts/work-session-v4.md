# Work Session v4

**Retired.** Active coding sessions use `work-session/v6`; see `templates/contracts/work-session-v6.md`. v4 remains here only for archive readability and has no supported compatibility parser on the v6 execution path.

The historical v4 break made trusted Git base authority explicit. A NEW session did not infer its base from the source checkout's current `HEAD`; downstream execution consumed the sealed exact `base.commit`.

## Product flow

```text
owner-authored PRODUCT.md
→ exact bytes + digest pin
→ accepted product result
→ resolve trusted base identity to exact commit
→ derive low-friction validation from that exact commit tree
→ seal work-session/v4
→ fresh controller-owned managed worktree at base.commit
→ read-only coding worker
→ controller materialization
→ exact validation
→ bounded repair
→ identity-gated managed-worktree delivery
→ observable result
```

## Required JSON shape

```json
{
  "schemaVersion": "work-session/v4",
  "productDirection": {
    "schemaVersion": "product-direction/v1",
    "sourcePath": "PRODUCT.md",
    "version": "product-direction-v1",
    "digest": "sha256:<64 lowercase hex of raw PRODUCT.md bytes>",
    "content": "<exact owner-authored PRODUCT.md text>"
  },
  "origin": {
    "type": "OWNER_GOAL"
  },
  "base": {
    "type": "REMOTE_REF",
    "remote": "origin",
    "ref": "refs/heads/main",
    "commit": "<exact lowercase Git object id>"
  },
  "productResult": "The useful result the owner expects.",
  "journeyState": "What is already true before coding starts.",
  "doNow": "The nearest executable coding action.",
  "newlyTrueBehavior": "The behavior that must exist after this session.",
  "doneWhen": "Observable completion and validation conditions.",
  "stopOnlyIf": ["Material stop condition."],
  "authorizedReversibleActions": ["Read relevant files.", "Edit allowed paths.", "Run validation."],
  "ownerOnlyActions": ["Change PRODUCT.md.", "Expand scope.", "Approve protected or destructive action."],
  "allowedPaths": ["src", "tests"],
  "validation": [
    { "argv": ["npm", "test"], "cwd": ".", "timeoutSeconds": 300 }
  ],
  "maxAttempts": 2,
  "delivery": { "commit": false, "push": false },
  "sessionDigest": "sha256:<computed by Meta-Harness>"
}
```

## Base authority

`base` is a closed sum type.

Default low-friction goal work seals a freshly resolved remote default branch:

```json
{
  "type": "REMOTE_REF",
  "remote": "origin",
  "ref": "refs/heads/main",
  "commit": "<exact commit>"
}
```

An explicit local ref selected through `--base` seals:

```json
{
  "type": "LOCAL_REF",
  "ref": "HEAD",
  "commit": "<exact commit>"
}
```

An explicit exact object ID seals:

```json
{
  "type": "EXACT_COMMIT",
  "commit": "<exact commit>"
}
```

Rules:

- Default `--goal` resolves `origin`'s symbolic `HEAD` and advertised commit, acquires the required Git object without pulling or moving the source checkout, re-checks the same remote default identity, then seals it.
- A remote default branch or OID change during that resolution fails closed and requires a fresh NEW invocation.
- `--base` is a deliberate local-authority override. It may name `HEAD`, an explicit slash-qualified local ref, `refs/heads/*`, `refs/remotes/*`, or an exact commit already available in the repository object database. Ambiguous bare branch names are rejected.
- The selected ref is not consulted again after the session is sealed. `worktreePlan`, workspace custody, permits, delivery, and RESUME consume `base.commit`.
- RESUME never re-resolves `origin`; an advancing remote does not change an existing ACTIVE session's base.

## Low-friction validation

For `--goal`, validation is derived from the exact sealed base commit rather than mutable source-checkout files.

For every allowed path, Meta-Harness walks the selected commit tree toward the repository root and chooses the nearest regular non-symlink `package.json`. All allowed paths must resolve to one package. Its exact blob bytes must contain a non-placeholder `scripts.test`; the controller then seals `npm test` with that package directory as `cwd`.

Dirty, staged, or untracked `package.json` files in the source checkout cannot influence this contract.

## Origin provenance

Direct owner work carries:

```json
{ "type": "OWNER_GOAL" }
```

Repo-directed work carries:

```json
{
  "type": "REPO_DECISION",
  "decisionDigest": "sha256:<immutable repo-decision/v3 byte digest>"
}
```

A `repo-decision/v3` DISPATCH action must carry the same resolved `base` authority that is copied into the resulting `work-session/v4`. Repo-directed callers cannot bypass Decision authority with a command-line `--base`.

## Product direction

- Repository-root `PRODUCT.md` is owner-authored, regular-file only, and pinned by exact raw bytes plus digest.
- `--goal`, `--session`, and `--resume` require the live file to match the sealed snapshot.
- Controller materialization rejects any `PRODUCT.md` mutation regardless of `allowedPaths`.

## Workspace custody

- Every NEW session creates a fresh ignored repository-local `.worktrees/meta-harness-<workspaceId>` worktree at exact `base.commit`.
- Source-checkout HEAD, index, and mutable code bytes are never NEW execution authority and are never inherited.
- Workspace creation proves the managed worktree is clean and exactly at `base.commit`, creates a Git administrative identity marker, writes `workspace-custody/v1`, and activates generation 1.
- Only `--resume` may reuse a workspace, and only under exact still-`ACTIVE` custody, session identity, workspace UUID, Git identity marker, branch, base commit, generation, product direction, dirty manifest, and exclusive execution lease.
- Terminal workspace authority never returns even if bytes are cleaned or restored.

## Delivery

Staging, commit, and push are controller-owned actions after `DONE` plus passed validation. If commit authority is present, the delivery primitive must first prove the target is the exact ACTIVE controller-owned managed worktree for the session: source repository root, workspace UUID/path, Git registration, identity marker, custody, branch, and sealed `base.commit` must agree.

The source checkout cannot be used as the delivery target. Meta-Harness never automatically resets, cleans, stashes, reverts, tags, or publishes owner work.

## Commands

```text
meta-harness work <repository> --goal <result> [--allow <path>] [--base <HEAD|ref|oid>]
meta-harness work <repository> --session <work-session.json>
meta-harness work <repository> --resume
```
