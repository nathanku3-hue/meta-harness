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

Meta-Harness decides NEW, RESUME, or STOP from retained repository and workspace truth. The owner does not select a session, actor, validation command, workspace, resume mode, or commit policy.

A normal successful run may surface only coarse liveness plus closure:

```text
Working…
Validating…
Repairing validation…
Done — CSV export works. Validation and product proof passed; the result is banked locally.
```

Automatic internal transitions do not become decision requests. Liveness is deliberately coarse: no workspace UUIDs, generations, custody digests, actor handoffs, session digests, or commit hashes appear in normal output.

When nothing is mechanically active:

```text
No active slice.
Use the product.
Wait for observed real-use friction.
```

Owner intervention is reserved for product/taste decisions, scope expansion, credentials or protected access, destructive action, publication, or material risk. A surfaced owner decision is one question; an external blocker includes the smallest corrective action available.

## Tiny diagnostic surface

```powershell
meta-harness inspect
```

`inspect` reports only coarse state, the active product result when one exists, and whether continuation is automatic. It does not expose lifecycle identifiers.

Default and advanced help do not expose an operator workflow console:

```powershell
meta-harness --help
meta-harness help --advanced
```

Historical lifecycle commands remain internal maintenance implementation while their unique semantics are being retired or library-ized. They are not part of the human product grammar.

## Internal journey state

Meta-Harness keeps rich internal state so the owner does not have to operate it. The reducer answers a narrow question: what is mechanically next?

```text
new accepted result + no ACTIVE custody → NEW
same accepted result + ACTIVE custody   → RESUME
no result + ACTIVE custody              → RESUME
no result + no selected work            → STOP
different result while work is ACTIVE   → owner input
```

The reducer does not own product semantics. Product direction, scope authority, Git custody, validation evidence, repo decision authority, and publication authority remain in their existing bounded contracts.

`work-session/v6` is the complete internal coding brief. It pins exact `PRODUCT.md` bytes, provenance, immutable base, result, scope, validation, repair budget, publication authority, and one canonical pre-worker `product-proof-spec/v1`. v6 is an incompatible cut: v5 sessions are not accepted on the v6 execution path. Normal users neither author nor select this contract.

## Automatic base and scope

NEW work selects an immutable Git base before session sealing:

1. the current branch's configured remote upstream when one exists;
2. otherwise `origin`'s advertised default branch;
3. otherwise the sole configured remote's advertised default branch;
4. otherwise local `HEAD` when the repository has no remotes.

Multiple remotes without a configured upstream fail closed rather than guessing.

Normal owner work uses repository-wide internal scope with hard controller protections and bounded change budgets. `PRODUCT.md`, Git authority, and repository harness control/state files cannot be written by the coding worker. Traversal, symlink targets, duplicate paths, oversized proposals, Git-index mutation, branch movement, and changes outside the sealed boundary fail closed.

Source-checkout mutable bytes are preserved and are never execution authority. Every NEW session receives a fresh ignored repository-local `.worktrees/meta-harness-<id>` worktree at the sealed base commit. RESUME requires exact still-ACTIVE custody; terminal workspace authority never returns.

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

The coding worker is read-only and returns only typed `WRITE`, `DELETE`, or `MOVE` operations. The controller materializes them, seals one Git-authoritative `candidateTreeOid`, and verifies that exact tree inside the Linux namespace/chroot verifier. Candidate acceptance answers only whether those exact bytes may BANK safely. Worker `done`/`partial` status is advisory and cannot authorize or veto BANK. Regression failures return to the same bounded result for repair.

## Product proof

`DONE` requires candidate-independent, discriminating, materially complete evidence that the requested behavior became true. Before the coding worker sees the task, Meta-Harness compiles exactly one `product-proof-spec/v1` from owner direction, the sealed product contract, and the exact base. Every material semantic clause in `productResult`, `newlyTrueBehavior`, and `doneWhen` must map to at least one atomic proof claim or remain an explicit proof gap.

A repository may supply stronger pre-existing proof input through sealed-base `.meta-harness/product-proof.json` using `product-proof-policy/v2`. Meta-Harness reads the policy and program from exact `base.commit`, binds their Git blob OIDs, calibrates the declared claims against the base, and normalizes them into the same canonical proof spec. When no base-owned policy exists on the normal owner-goal path, a read-only pre-worker compiler may synthesize repository-native executable proof. It cannot see the future candidate. Meta-Harness owns the trust envelope, not a generic testing DSL.

Executable claims must declare whether the sealed base should `PASS` or `FAIL`. Generated proof that disagrees with its declared baseline is downgraded to an explicit `UNVERIFIABLE` gap; a false base-owned calibration fails closed. The exact proof program is then sealed into `work-session/v6` before coding begins.

The same Linux namespace/chroot verifier later executes the sealed proof program per executable claim with read-only `/candidate`, `/base`, `/proof-spec/program`, and `/session/product-contract.json` inputs. Non-executable material claims remain unresolved rather than being judged by another model.

`product-proof/v2` derives its overall state mechanically from claim results: any failed executable claim gives `FAILED`, any remaining material unresolved claim gives `GAP`, otherwise the result is `PROVEN`. `FAILED` re-enters bounded repair. `GAP` banks regression-validated bytes as `BANKED_UNPROVEN` with a non-success product outcome. Only `PROVEN` can produce `DONE`.

Machine work results retain regression verification, candidate-acceptance, and product-proof evidence plus controller-observed `work-metrics/v1` timing and repair facts (NEW/RESUME, proposal latency, verifier time, operation mix, output/event volume, repair count). Normal human output does not expose those internals. Meta-Harness does not persist execution memory unless measured repair/resume reconstruction loss later proves it necessary.

## Automatic local banking

A local commit is closure, not publication.

After controller acceptance of the exact sealed candidate under isolated verification, Meta-Harness:

1. proves the exact ACTIVE controller-owned managed worktree and generation still match;
2. proves the candidate seal is still current;
3. requires an untampered acceptance value bound to the session, candidate seal, candidate tree, and verification digest;
4. stages the exact sealed no-renames path set;
5. proves the staged Git tree equals `candidateTreeOid`;
6. creates a local immutable commit on the managed branch;
7. terminalizes the workspace as `TERMINAL_COMMITTED`.

Legacy `delivery.commit=false` metadata cannot disable this local banking step. Push, PR, merge, release, tags, credentials, destructive cleanup, and other publication/external actions remain explicit authority.

The source checkout's HEAD, index, branch, and existing dirty bytes are not rewritten by local banking.

## Optional repository decision authority

Complex repositories may opt into repo-owned decision authority through `.meta-harness/repo-charter.json`. Repository intelligence owns domain meaning; Meta-Harness owns generic identity, attestation checks it can mechanically prove, single-entry execution authority, workspace custody, operational closure, and immutable World lineage.

A current `repo-decision/v3` is either `DISPATCH` or inert `NO_DISPATCH`. DISPATCH compiles an internal `work-session/v6` with one canonical product-proof spec; NO_DISPATCH creates no workspace or attempt. The normal owner still does not route planners, coders, auditors, sessions, or generations.

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

Native Windows never silently falls back to unisolated v6 validation or product proof. Portable/package surfaces may still run natively on Windows, but authority-bearing `work` execution must use the Linux/WSL verifier boundary.

## Development

```powershell
npm test
node bin\meta-harness.js --help
```

Internal maintenance handlers are tested separately from the human CLI surface. Product tests assert that ordinary users cannot encounter lifecycle controls and that automatic states advance without asking them which workflow command, actor, session, validation path, or local commit policy comes next.

## Deliberate boundaries

Meta-Harness does not include a queue, daemon, scheduler, swarm, generic provider layer, dashboard, recursive planner packet, automatic publication, or destructive worktree management.
