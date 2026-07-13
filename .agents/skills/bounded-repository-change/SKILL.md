---
name: bounded-repository-change
description: Produce one useful single-file repository change through sealed authority, controller-owned materialization, trusted validation, durable Git custody, fresh-process replay, and portable verification.
owner: nathanku3-hue
source: local
allowed_tools: [read_file, list_dir, grep_search]
forbidden_paths: [.env, secrets, credentials, provider-config, runtime, data]
---

# Bounded Repository Change

## Goal

Given one approved example, return exactly one schema-bound `{ path, content }` artifact for the literal allowed path. The agent remains read-only; the controller owns all filesystem mutation, Git commit creation, validation, evidence publication, and durable-ref creation.

## Example contract

Examples live under `examples/*.json` and bind:

- repository identity and immutable base revision/tree;
- one literal modified path;
- one useful sealed objective;
- one host-neutral validation capsule containing symbolic command names and repository-relative arguments only.

Host executable paths, executable hashes, credentials, home directories, and environment values are local bindings. They are never copied into the sealed RunSpec.

## Required flow

1. Verify the child clone is independent, clean, detached, and pinned to the example base.
2. Seal and approve one RunSpec from the example.
3. Bind authenticated Codex and the validation executable only for a genuinely new attempt.
4. Ask Codex read-only for exactly one `{ path, content }` artifact.
5. Prove Codex did not mutate Git or the worktree.
6. Materialize exactly the allowed file, commit as the controller, and run every capsule command sequentially.
7. Re-attest clean Git state after every command.
8. Publish terminal evidence manifest-last and create the durable ref without replacement.
9. After normal close and process exit, replay from retained custody with unusable execution-tool paths and zero agent spawns.
10. Export and independently verify the prerequisite bundle, result ref, changed path, result bytes, validation commands, canonical receipt, and leakage boundary.

## Boundaries

- Exactly one modified file; no add/delete/rename/no-op.
- No direct agent writes, Git commands, or validation execution.
- No public execution CLI, provider registry, compatibility adapter, dual runtime, delivery, recovery, concurrency, or cancellation framework.
- No secrets or host environment values in examples, RunSpec, prompts, evidence exports, or logs.
- A failed create-only custody root is retained and never reused.

## Output

Return only the schema-bound change artifact. Runtime disposition and evidence are controller outputs, not agent-authored claims.
