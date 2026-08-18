# Work Session v3 (retired)

**Retired.** Active coding sessions use `work-session/v6`; see `templates/contracts/work-session-v6.md`. The v3 material below is retained for archive readability only and has no supported compatibility parser.

It replaces conversational planning memory, recursive planner packets, and routine approval prompts for reversible in-scope work. It does not replace owner authority for scope expansion, credentials, publication, destructive action, product-direction changes, or material risk. There is no supported `work-session/v1` or `work-session/v2` compatibility parser.

## Product flow

```text
owner-authored PRODUCT.md
→ exact bytes + digest pin
→ accepted product result
→ sealed work-session/v3 with explicit origin
→ fresh controller-owned workspace generation from immutable base commit
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
  "schemaVersion": "work-session/v3",
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

## Origin rules

Direct owner work carries exactly:

```json
{ "type": "OWNER_GOAL" }
```

Repo-directed work carries exactly:

```json
{
  "type": "REPO_DECISION",
  "decisionDigest": "sha256:<immutable repo-decision/v2 byte digest>"
}
```

The Repo Decision digest is the only Decision Plane provenance edge duplicated into the work session. World, attestation, and Head digests remain behind that immutable Decision reference rather than being copied into the coding brief.

## Product direction rules

- `PRODUCT.md` is repository-root, owner-authored, regular-file only.
- Required headings: Version, Endgame, Target user, Core user journey, Taste — prefer, Taste — reject, Non-negotiables, Shipping definition, Change rule.
- Digest hashes raw file bytes. Session content must recompute to the same digest.
- `--goal`, `--session`, and `--resume` all require a live `PRODUCT.md` that matches the sealed snapshot.
- Any mid-session change, deletion, symlink, unreadable file, malformed headings, or digest mismatch fails closed.
- Controller materialization rejects any write targeting `PRODUCT.md` even if a session lists it in `allowedPaths`.

For repo-directed work, the authoritative `repo-world/v2.productDirectionDigest`, `repo-decision/v2.productDirectionDigest`, and live `PRODUCT.md` digest must all agree before dispatch.

## Workspace custody

- `dirtyPolicy` does not exist. Workspace safety is not an owner preference.
- Every NEW session seals the source checkout's exact HEAD commit and creates a fresh UUID-backed ignored `.worktrees/` worktree from that immutable commit, even when the source checkout is clean.
- The source checkout is never a coding execution workspace and its mutable bytes are never inherited.
- Only `--resume` may reuse a workspace, and only when controller-owned custody remains `ACTIVE` with exact session, workspace UUID, Git administrative marker, branch, base HEAD, generation, `PRODUCT.md`, and expected dirty-manifest identity.
- The controller must hold the workspace's exclusive execution lease before material execution; concurrent execution fails closed.
- Each bounded repair advances the same workspace custody generation; `ExecutionPermit.generation` must equal `WorkspaceCustody.generation`.
- Successful committed work terminalizes as `TERMINAL_COMMITTED`; successful uncommitted work terminalizes as `TERMINAL_SEALED_DIRTY`; exhausted or blocked work terminalizes and cannot resume.
- Terminal workspace bytes may remain, but workspace authority never returns.
- Never reset, clean, stash, or revert owner work automatically.
- The coding worker remains read-only and returns complete `{ path, content }` file changes.
- Meta-Harness rejects traversal, symlinks, duplicate paths, oversized content, out-of-bound files, protected Decision Plane control paths, and `PRODUCT.md` mutations before controller-owned materialization.

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

Hashes, gate identifiers, custody records, and Decision Plane evidence remain available through advanced commands and machine-readable artifacts. They are not the default product mental model.

## Commands

```text
meta-harness work <repository> --goal <result> [--allow <path>]
meta-harness work <repository> --session <work-session.json>
meta-harness work <repository> --resume
```
