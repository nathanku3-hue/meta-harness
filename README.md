# Meta-Harness

Meta-Harness is a local coding system for one owner.

State the software result once. Meta-Harness chooses the mechanically correct internal continuation, works in a controller-owned isolated worktree, validates outside the model, repairs bounded failures, banks validated bytes in a local immutable commit, and returns the product result.

```text
product result
→ code
→ validation
→ bounded repair when needed
→ local immutable commit
→ concise result
```

Repository-root `PRODUCT.md` remains owner-authored product direction. Meta-Harness reads and pins its exact bytes; it never invents, rewrites, or mutates product taste.

## Use the product

From the target repository:

```powershell
meta-harness "Add CSV export to the report page"
```

If work is interrupted, run:

```powershell
meta-harness
```

Meta-Harness reconstructs the next action from PRODUCT, Git, run-journal, and recoverable execution facts. The owner does not select a session, actor, validation command, workspace, resume mode, or commit policy.

To detach from the current interaction without declaring success or abandoning the durable result, use the exact owner turn `close`. It performs no model dispatch or goal mutation and reports `Stopped safely — continuation is automatic next time.` The next bare `meta-harness` invocation resumes from durable facts.

### ACP direct entry

ACP-capable clients may use the packaged `meta-harness-acp` executable as a front door to the same product path. It is not a second executor.

For a Meta-Harness-managed repository, the ACP process binds to the exact repository root, accepts one text prompt without rewriting its bytes, and passes that text directly into normal automatic product entry. It rejects MCP servers, additional directories, alternate repository roots, unmanaged repositories, and repository subdirectories. The adapter advertises no direct mutation capabilities and does not request client filesystem, terminal, Git, worktree, or publication actions; all material work remains behind Meta-Harness planning, scoped worker operations, controller validation, and Git integration.

ACP transport session IDs are ephemeral correlation only. `session/cancel` uses the same controlled-drain signal path as ordinary work, so cancellation does not create another persisted lifecycle. Direct coding surfaces that cannot mechanically provide both pre-model owner-input capture and default-deny mutation authority remain outside this execution boundary rather than receiving a fallback edit path.

A normal successful run may surface only coarse liveness plus closure:

```text
Working…
Validating…
Repairing validation…
Done — CSV export works. Validation passed; the result is banked locally.
```

Automatic internal transitions do not become decision requests. Liveness is deliberately coarse: no workspace UUIDs, generations, custody digests, actor handoffs, session digests, or commit hashes appear in normal output.

When no current product gap is observed:

```text
No product gap is currently observed.
Use the product and continue when observed friction or a new desired result appears.
```

Owner intervention is reserved for product/taste decisions, scope expansion, credentials or protected access, destructive action, publication, or material risk. A surfaced owner decision is one question; an external blocker includes the smallest corrective action available.

## Tiny diagnostic surface

```powershell
meta-harness inspect
```

`inspect` reports only coarse state, the active product result when one exists, and whether continuation is automatic. It does not expose lifecycle identifiers.

Repositories may declare bounded startup-context sources in `.meta-harness-project.json`. A source may set `maxBytes` (1 byte through 2 MiB); oversized required sources fail closed before projection, so repositories can enforce that current-truth/control surfaces stay small instead of silently becoming historical dumps. Successful inspection reports each declared source's exact `sizeBytes` and SHA-256 alongside freshness status, making the projected context traceable to immutable observed bytes without turning that projection into a second authority plane.

Default and advanced help do not expose an operator workflow console:

```powershell
meta-harness --help
meta-harness help --advanced
```

Historical lifecycle commands remain internal maintenance implementation while their unique semantics are being retired or library-ized. They are not part of the human product grammar.

## Internal execution facts

Meta-Harness does not use a conversational lifecycle reducer as product authority. Public repository entry has only two coarse outcomes: continue mechanically when durable facts warrant work, or report that there is no active slice.

Recovery is reconstructed from exact `PRODUCT.md` direction, the current Git product commit, append-only run journals, immutable Git snapshots and banked commits, and exact external-effect intent/observation facts where an external effect exists. Workspaces, worker processes, controller processes, and custody labels are disposable execution children rather than product truth.

`work-session/v10` is the complete internal coding brief. It seals exact product direction, `OWNER_GOAL` or `REPO_RUN` origin, immutable base, product result, current journey state, immediate action, newly true behavior, `doneWhen`, stop conditions, allowed paths, controller validation, bounded attempts, and the optional push effect. It contains no semantic projection, Endgame projection, product-proof permission, Claim, or Permit fields. Normal users neither author nor select this contract.

## Automatic base and scope

NEW work selects an immutable Git base before session sealing:

1. the current branch's configured remote upstream when one exists;
2. otherwise `origin`'s advertised default branch;
3. otherwise the sole configured remote's advertised default branch;
4. otherwise local `HEAD` when the repository has no remotes.

Multiple remotes without a configured upstream fail closed rather than guessing.

Normal owner work uses repository-wide internal scope with hard controller protections and bounded change budgets. `PRODUCT.md`, Git authority, and repository harness control/state files cannot be written by the coding worker. Traversal, symlink targets, duplicate paths, oversized proposals, Git-index mutation, branch movement, and changes outside the sealed boundary fail closed.

Source-checkout mutable bytes are preserved and are never execution authority. Each physical execution uses a fresh ignored repository-local `.worktrees/meta-harness-<id>` worktree at the sealed base commit or an immutable recovery snapshot. If an execution child is missing, stale, corrupt, mismatched, or terminal, Meta-Harness preserves that child's unexplained bytes, replaces it with a fresh managed worktree reconstructed from durable Git and run-journal facts, re-proves the reconstructed boundary, and continues instead of treating workspace lifecycle state as product authority.

## Deterministic validation adapters

Validation is derived from the **sealed base tree**, never dirty source-checkout bytes and never model judgment.

Supported adapters include:

- sealed `.meta-harness/validation.json` → exact repository-declared argv/cwd/timeout;
- `package.json` → package-manager-native `test` (`pnpm`, `yarn`, or `npm` according to the sealed lockfile);
- `pytest.ini` or `pyproject.toml` → `python -m pytest`;
- `Cargo.toml` → `cargo test`;
- `go.mod` → `go test ./...`;
- one scope-nearest `.sln` or `.csproj` → `dotnet test`.

Each adapter resolves the scope-nearest project from immutable tree facts and fails closed when allowed paths imply multiple projects or otherwise ambiguous validation. If no deterministic adapter matches, work blocks before workspace creation or worker launch.

The coding worker is read-only and emits incompatible `worker-result/v2`: advisory `DONE` / `PARTIAL`, or structured `STOP`, plus only typed `WRITE`, `DELETE`, or `MOVE` operations. `STOP` carries zero operations and cannot name an owner, manager, librarian, approver, approval gate, or human question. The controller materializes non-STOP operations, seals one Git-authoritative `candidateTreeOid`, and verifies that exact tree inside the Linux namespace/chroot verifier. Candidate acceptance answers only whether those exact bytes may BANK safely; worker status cannot authorize or veto BANK. Regression failures return to the same bounded result for repair.

## Post-mutation validation and forward motion

Validation is evidence after mutation, not permission to begin. The coding worker receives the sealed product result and scope, returns typed operations, and cannot mutate the workspace directly. The controller materializes those operations, seals the exact candidate tree, and verifies that candidate with the session's controller-owned validation. Validation failure returns to the same bounded product-solving loop for repair.

There is no pre-execution product-proof compiler or proof-authority assertion on the current path. Candidate acceptance records that the exact sealed bytes satisfied the exact validation contract; the banked Git commit and run journal provide durable recovery facts.

A worker `STOP` is persisted as failed-means evidence. If attempt budget remains, that exact evidence is fed directly to a fresh coding generation, which must choose a materially different in-scope means; repeated identical STOP means are circuit-broken. No reviewer/challenger model is required between STOP and CODE, and owner-exclusive effects are surfaced only from concrete controller/effect evidence.

## Automatic local banking

A local commit is closure, not publication.

After controller acceptance of the exact sealed candidate under isolated verification, Meta-Harness:

1. proves the candidate still belongs to the exact session, managed worktree, and generation boundary;
2. proves the candidate seal is still current;
3. requires an untampered acceptance value bound to the session, candidate seal, candidate tree, and verification digest;
4. stages the exact sealed no-renames path set;
5. proves the staged Git tree equals `candidateTreeOid`;
6. creates a local immutable commit on the managed branch;
7. terminalizes the workspace as `TERMINAL_COMMITTED`.

Legacy `delivery.commit=false` metadata cannot disable this local banking step. Push, PR, merge, release, tags, credentials, destructive cleanup, and other publication/external actions remain explicit authority.

The source checkout's HEAD, index, branch, and existing dirty bytes are not rewritten by local banking.

## Optional repository planning

Complex repositories may opt into planner-mediated repo work through `.meta-harness/repo-charter.json`. The charter is an opt-in boundary; it does not create a second product authority.

Fresh planner input is `repo-planner-input/v5`: the owner-authored PRODUCT frame and active owner directive, the current Git product commit, active `REPO_RUN` commitments reconstructed from run journals and recoverable execution facts, settled observations including failed means, and current promoted evidence. The logical planner returns disposable `planner-candidate-batch/v4` candidates. There is no durable proposal-set identity or mutable proposal file on the current path.

Each admitted candidate becomes an immutable Outcome plus a `REPO_RUN` work session pinned to the current product commit, bounded write paths, validation, and attempts. Compatible runs may execute concurrently in private worktrees. Validated results bank locally, then product integration prepares against the current Git product head and publishes through one compare-and-swap owner. A stale publisher is repair input: it is rebuilt against the newer head, and retained validation can reject a cumulative regression before the next CAS.

Run journals and immutable Git snapshots provide restart continuity. External proposal dispatch uses intent-first replay identity and persisted observations for the non-reconstructable effect boundary. Retired World lineage, Outcome Claims, semantic authority, pre-execution proof permission, and round-based delegation lifecycle are not part of the normal product path.

## Installation

```powershell
npm install -g @nkgss/meta-harness
meta-harness --help
```

Requirements:

- Node.js 20 or newer;
- Git;
- local Codex CLI with an authenticated `CODEX_HOME`;
- validation tools required by the target repository;
- for `meta-harness work`, Linux with unprivileged user, mount, network, and PID namespaces plus `chroot`/`setpriv` (WSL is the supported Windows execution route).

Native Windows never silently falls back to unisolated validation. Portable/package surfaces may still run natively on Windows, but material `work` execution must use the Linux/WSL verifier boundary.

## Development

```powershell
npm test
node bin\meta-harness.js --help
```

Internal maintenance handlers are tested separately from the human CLI surface. Product tests assert that ordinary users cannot encounter lifecycle controls and that automatic states advance without asking them which workflow command, actor, session, validation path, or local commit policy comes next.

## Deliberate boundaries

Meta-Harness does not include a queue, daemon, scheduler, swarm, generic provider layer, dashboard, recursive planner packet, automatic publication, or destructive worktree management.
