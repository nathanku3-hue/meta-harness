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

### ACP direct entry

ACP-capable clients may use the packaged `meta-harness-acp` executable as a front door to the same product path. It is not a second executor.

For a Meta-Harness-managed repository, the ACP process binds to the exact repository root, accepts one text prompt without rewriting its bytes, and passes that text directly into normal automatic product entry. It rejects MCP servers, additional directories, alternate repository roots, unmanaged repositories, and repository subdirectories. The adapter advertises no direct mutation capabilities and does not request client filesystem, terminal, Git, worktree, or publication actions; all material work remains behind Meta-Harness planner/Claim/worker authority.

ACP transport session IDs are ephemeral correlation only. `session/cancel` uses the same controlled-drain signal path as ordinary work, so cancellation does not create another persisted lifecycle. Direct coding surfaces that cannot mechanically provide both pre-model owner-input capture and default-deny mutation authority remain outside this execution boundary rather than receiving a fallback edit path.

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

`work-session/v7` is the complete internal coding brief. It pins exact `PRODUCT.md` bytes, provenance, immutable base, result, scope, validation, repair budget, publication authority, and one canonical pre-worker `product-proof-spec/v1`. v7 is an incompatible cut: repo-owned work uses Outcome + Claim provenance rather than Repo Decision identity, and v6 sessions are not accepted on the v7 execution path. Normal users neither author nor select this contract.

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

The coding worker is read-only and emits incompatible `worker-result/v2`: advisory `DONE` / `PARTIAL`, or structured `STOP`, plus only typed `WRITE`, `DELETE`, or `MOVE` operations. `STOP` carries zero operations and cannot name an owner, manager, librarian, approver, approval gate, or human question. The controller materializes non-STOP operations, seals one Git-authoritative `candidateTreeOid`, and verifies that exact tree inside the Linux namespace/chroot verifier. Candidate acceptance answers only whether those exact bytes may BANK safely; worker status cannot authorize or veto BANK. Regression failures return to the same bounded result for repair.

## Product proof

`DONE` requires candidate-independent, discriminating, materially complete evidence that the requested behavior became true. Before the coding worker sees the task, Meta-Harness compiles exactly one `product-proof-spec/v1` from owner direction, the sealed product contract, and the exact base. Every material semantic clause in `productResult`, `newlyTrueBehavior`, and `doneWhen` must map to at least one atomic proof claim or remain an explicit proof gap.

A repository may supply stronger pre-existing proof input through sealed-base `.meta-harness/product-proof.json` using `product-proof-policy/v2`. Meta-Harness reads the policy and program from exact `base.commit`, binds their Git blob OIDs, calibrates the declared claims against the base, and normalizes them into the same canonical proof spec. When no base-owned policy exists on the normal owner-goal path, a read-only pre-worker compiler may synthesize repository-native executable proof. It cannot see the future candidate. Meta-Harness owns the trust envelope, not a generic testing DSL.

Executable claims must declare whether the sealed base should `PASS` or `FAIL`. Generated proof that disagrees with its declared baseline is downgraded to an explicit `UNVERIFIABLE` gap; a false base-owned calibration fails closed. The exact proof program is then sealed into `work-session/v7` before coding begins.

The same Linux namespace/chroot verifier later executes the sealed proof program per executable claim with read-only `/candidate`, `/base`, `/proof-spec/program`, and `/session/product-contract.json` inputs. Non-executable material claims remain unresolved rather than being judged by another model.

`product-proof/v2` derives its overall state mechanically from claim results: any failed executable claim gives `FAILED`, any remaining material unresolved claim gives `GAP`, otherwise the result is `PROVEN`. `FAILED` re-enters bounded repair. `GAP` banks regression-validated bytes as `BANKED_UNPROVEN` with a non-success product outcome. Only `PROVEN` can produce `DONE`.

A worker `STOP` is persisted first as `worker-stop/v1`, binding its consumed AttemptEntry and exact workspace HEAD/branch/index/dirty-manifest/Git-tree boundary. One fresh read-only challenger then tries to falsify the claim that autonomous progress is exhausted. Its slim `forward-motion-proof/v1` references the stop and may authorize `CONTINUE_WITH_ALTERNATIVE`, `REPLAN_REQUIRED`, `HARD_BLOCKED`, or one typed `OWNER_REQUIRED`. The proof is semantic judgment, not custody evidence. Successful work invokes no challenger. Only seven owner-exclusive kinds can reach `OWNER_REQUIRED`: `PRODUCT_TASTE`, `SCOPE_EXPANSION`, `CREDENTIALS`, `PROTECTED_ACCESS`, `DESTRUCTIVE_ACTION`, `PUBLICATION`, or `MATERIAL_RISK`; punctuation and arbitrary organizational roles have no authority.

Machine `work-result/v2` values retain regression verification, candidate-acceptance, product-proof evidence, optional exact `forwardMotionProofDigest`, and controller-observed `work-metrics/v1` timing/repair facts. Normal human output exposes `Need you:` only for a proof-backed `OWNER_REQUIRED`. `REPLAN_REQUIRED` remains autonomous work; a failed preferred means is not silently upgraded to owner intervention.

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

## Optional repository progress authority

Complex repositories may opt into repo-owned progress authority through `.meta-harness/repo-charter.json`. Repository intelligence owns domain meaning; Meta-Harness owns generic Outcome identity, atomic Claim compatibility, attestation checks it can mechanically prove, workspace custody, operational Closure, immutable World lineage, and one linear authoritative product commit.

Fresh repo-owned work is derived from durable truth rather than a mutable proposal file. After active Claims recover, one fresh read-only logical planner receives a deterministic projection of current `world-head/v2`, product direction, available local capacity, semantic active commitments, and the latest unresolved authoritative handoffs. It returns disposable semantic candidates only; `.meta-harness/repo-proposals.json` / `repo-proposal-set/v2` are historical migration/regression evidence, not active ingress.

For each candidate, `expectedWritePaths[]` is only a predicted footprint. The controller may normalize equivalent path syntax or reject the whole candidate, but never silently widen or shrink it. Atomic Claim admission separately decides conflicts. The controller derives the exact base from `WorldHead.productCommit`, deterministic validation, bounded attempts, local-only delivery, product proof, Claim/session identity, and worker boot. Multiple compatible Claims may execute concurrently in disposable workspaces; Closures are interpreted against current World and landed through serialized World transitions. Successful worker BANK commits are integrated into one cumulative `productCommit` before authoritative learning advances.

Planner state is disposable: before Claim visibility it may be recomputed, while after Claim visibility the Claim/session owns continuity. The active command reconciles from durable truth after each local settlement: terminal Closures land before planning, recovered executable Claims fill capacity first, and a released slot may receive one fresh planner boot for the new current Head while slower siblings continue. Each unchanged Head is planned at most once per controller epoch; unused candidates die on Head change. No queue, daemon, watcher, or durable scheduler state is introduced. `repo-decision/v3` remains historical-only. Unsupported owner-authority assertions cannot manufacture human authority; proof-backed Phase-4 `OWNER_REQUIRED` remains the only model-mediated owner-routing path.

For bounded external delegation, `meta-harness-delegation-round2/v1` projects the exact PRODUCT Endgame, authoritative current World/WorldHead provenance, one explicit current gate, and immutable Outcome evidence references into DevSpace-compatible zero-history memory. Each lane's acceptance criteria derive mechanically from `Outcome.desiredState` and `Outcome.evidenceRequirement`. `lane-result-card/v1` fan-in is reduced to a compact acceptance matrix without child transcripts; disputed evidence is fetched only by refs already named by the compact card. Advisory lane `worldDelta` is never applied by this contract. This Round-2 seam remains frozen: it does not itself own Grill, lifecycle, World mutation, or runtime routing.

Round 3 adds one bounded event-driven orchestrator over that frozen seam. Result-bearing lanes close and their compact cards become immutable `meta-harness-delegation-learning/v1`; the repository interpreter re-evaluates that learning against **current** World and commits a no-code `DELEGATION_LEARNING` World transition with replay protection. Still-live lanes receive exactly one challenged `CONTINUE | HOLD | OBSOLETE` decision. HOLD persists a compact task/workspace checkpoint before exact `cancel_lane {delegationId,laneKey}`; obsolete lanes cancel directly; interrupted useful delegations use `resume_delegation`. Released capacity may immediately refill: the frontier predicts only lane semantics/footprint, Meta-Harness normalizes scope and derives deterministic validation from the current product commit, then sends the frozen DevSpace `spawn_delegation {repository,baseRef,memory,lanes[]}` shape with non-publishing task custody. One fresh Grill may accept or replace the complete frontier before lifecycle/refill action; if World changes during that reasoning, the stale frontier is discarded and re-run before host action. Only a changed post-lifecycle semantic frontier can surface a new forward/owner gate, and every surfaced gate is retained as immutable current-World evidence so restart does not repeat it. Unchanged or `CONTINUE` frontiers stay automatic. No queue, daemon, watcher, durable scheduler, swarm, or runtime/browser router is introduced; fidelity/resource routing remains Round 4.

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
