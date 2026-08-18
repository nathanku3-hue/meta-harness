# Meta-Harness Coding-System Product Specification

## Product promise

Meta-Harness turns one accepted software result into a validated, locally banked repository change with minimal owner intervention.

```text
product result
→ automatic internal routing
→ isolated coding
→ deterministic validation
→ bounded repair
→ local immutable commit
→ concise closure
```

The normal product is not a workflow console. Rich internal state is retained; user-operable state is deliberately small.

## Human interaction contract

Normal grammar:

```text
meta-harness "<result>"
meta-harness
meta-harness inspect
meta-harness --help
meta-harness --version
```

`meta-harness "<result>"` accepts one product result in the current repository. `meta-harness` continues the mechanically correct ACTIVE result or stops. `meta-harness inspect` is a coarse diagnostic view and must not expose lifecycle identifiers.

The human surface does not require or advertise:

```text
--goal
--allow
--base
--session
--resume
--dry-run
--timeout
--model
--json
--commit
--push
```

Historical command handlers remain internal maintenance implementation while they are library-ized or deleted. They are not public command metadata and are not listed by default or advanced help.

## Output law

Automatic routing is control-invisible but may be liveness-visible.

Permitted normal output classes:

```text
coarse liveness       → Working… / Validating… / Repairing validation…
successful terminal   → one concise Done sentence
owner decision        → one concise Need you question
external blocker      → blocker plus smallest corrective action
no active result      → terminal product guidance
```

Normal output must not expose workspace IDs, UUIDs, generations, custody digests, session digests, actors, handoffs, commit hashes, permit IDs, phase names, or validation counters.

The exact no-active result is:

```text
No active slice.
Use the product.
Wait for observed real-use friction.
```

## Product direction

Repository-root `PRODUCT.md` is owner-authored product direction. Meta-Harness may read, hash, pin, and fail closed on drift. It must not generate, fill, summarize, relocate, or overwrite it.

Required headings:

```text
Version
Endgame
Target user
Core user journey
Taste — prefer
Taste — reject
Non-negotiables
Shipping definition
Change rule
```

Digest is SHA-256 over raw bytes. Symlinks, non-regular files, invalid UTF-8, missing headings, empty sections, and oversized files fail closed before material work.

Controller materialization rejects any worker proposal targeting `PRODUCT.md` regardless of the session boundary.

## JourneyState / NextAction reducer

The reducer is deliberately narrow. It does not become a semantic control-plane monolith.

Inputs are already-established facts such as:

- an owner-supplied product result;
- exact ACTIVE persisted work-session custody when one exists;
- an authoritative repo DISPATCH/NO_DISPATCH result when that repository uses decision authority.

It produces only the mechanically next disposition:

```text
state: NEW | ACTIVE | IDLE
productResult
next.kind: EXECUTE | OWNER_INPUT | STOP
next.operation: NEW | RESUME | REPLACE_ACTIVE_RESULT | STOP
next.automatic: boolean
reason
```

Rules:

```text
new owner result + no ACTIVE result      → NEW, automatic
same owner result + ACTIVE result        → RESUME, automatic
no owner result + ACTIVE result          → RESUME, automatic
repo DISPATCH + no ACTIVE owner result   → NEW, automatic
repo NO_DISPATCH / no selected work      → STOP, automatic
different owner result while ACTIVE      → OWNER_INPUT
```

The reducer does not own product taste, allowed-path semantics, Git custody, validation interpretation, repo-domain claims, publication authority, credentials, or material-risk decisions.

## Internal work-session contract

`work-session/v7` is the complete digest-bound coding brief. Users do not author or select it in the normal journey. v7 is an incompatible cut; v6 is not accepted on the active execution path. Owner-goal provenance remains `OWNER_GOAL`; repo-owned provenance is `REPO_OUTCOME` bound to one immutable Outcome and active Claim.

Required fields remain:

```text
schemaVersion
productDirection.*
origin.*
base.*
productResult
journeyState
doNow
newlyTrueBehavior
doneWhen
productProofSpec.*
stopOnlyIf[]
authorizedReversibleActions[]
ownerOnlyActions[]
allowedPaths[]
validation[]
maxAttempts
delivery.commit
delivery.push
sessionDigest
```

`delivery.commit` remains in v6 bytes but is no longer task-time owner authority: successful validated results are always locally banked by the controller. `delivery.push` remains publication authority and is never inferred from successful validation.

The session digest is domain-separated SHA-256 over canonical session content excluding `sessionDigest`. Product-direction digest is SHA-256 over exact `PRODUCT.md` bytes.

## Automatic immutable base

NEW selects the immutable base before session sealing.

Selection order:

1. current branch's configured remote upstream;
2. otherwise `origin`'s advertised default branch;
3. otherwise the sole configured remote's advertised default branch;
4. otherwise exact local `HEAD` when no remotes exist.

Remote selection is race-checked: Meta-Harness resolves the remote identity, fetches the exact commit object without updating source refs or working-tree bytes, resolves the identity again, and fails if it changed.

Multiple remotes without a configured upstream are materially ambiguous and fail closed rather than guessing.

After sealing, execution consumes `base.commit`; it does not independently re-query mutable refs.

## Internal scope authority

Normal owner work seals repository-wide internal scope (`.`) rather than asking the owner to operate path flags. Scope remains real authority, not a deleted safety boundary.

Hard protections include:

- `PRODUCT.md` is never worker-writable;
- repository harness control and state files are never worker-writable;
- traversal and symlink targets are rejected;
- duplicate and oversized proposals are rejected;
- `.git` and Git authority remain controller-owned;
- materialization remains bounded by change-count and byte budgets;
- worker Git-index mutation, HEAD movement, and branch movement fail closed.

Repository or Decision authority may still produce a narrower internal scope. Owner input is required only when a proposed result materially exceeds established scope or risk authority.

## Workspace resolution and custody

Workspace authority is identity-based, not cleanliness-based.

### NEW

Every NEW session:

1. requires the sealed base commit to exist locally;
2. allocates a fresh random workspace identity;
3. creates a fresh ignored repository-local managed worktree and unique branch at `base.commit`;
4. proves the worktree is clean and exactly at the sealed base;
5. creates controller-owned workspace custody and activates generation 1;
6. acquires the exclusive controller execution lease before material execution.

The source checkout is never a coding execution workspace. Source mutable bytes are preserved but never inherited into NEW work.

### RESUME

RESUME is selected automatically from persisted state; the owner does not say `--resume` or name a session.

Reuse requires exact still-ACTIVE custody with matching repository root, workspace identity, physical path, Git administrative marker, branch, sealed base, current HEAD, generation, and live product direction. The controller also requires the exclusive execution lease.

Byte continuity is seal-first, not dirty-status-first. For generation 1, an unsealed baseline must be the exact clean sealed base. For repair generation N > 1, an unsealed baseline must exactly match durable candidate seal N-1. If candidate seal N already exists, that seal must exactly prove the live tree, index, and path set before continuation. The dirty-manifest digest remains a cheap custody consistency check but is not proof of file contents.

A current-generation sealed candidate resumes controller work in the same generation: reacquire the controller lease, re-prove the seal, then continue validation, product proof, and BANK without invoking the coding worker again. Process restart does not advance generation. If an AttemptEntry exists but no candidate seal was durably created, that coding generation is not replayed; closure remains bounded rather than silently resetting the attempt budget.

A mismatch fails closed. Terminal workspace authority never returns, even when bytes are manually cleaned or restored. A lease left by a controller process that is no longer live may be recovered immediately after its exact lock bytes are rechecked; a live controller lease still excludes concurrent execution.

### Terminalization

Successful validated work is locally committed and becomes `TERMINAL_COMMITTED`.

Blocked or exhausted work becomes `TERMINAL_BLOCKED` or `TERMINAL_BLOCKED_DIRTY` according to retained bytes. Explicit abandonment remains terminal.

`TERMINAL_SEALED_DIRTY` is retained only as historical schema/state compatibility; the normal successful path no longer produces it because local banking is automatic.

## Deterministic validation adapters

Validation is derived from the sealed base tree, never from dirty source-checkout bytes and never from model judgment.

Adapters produce exact:

```text
argv
cwd
timeoutSeconds
```

Supported adapters:

1. sealed `.meta-harness/validation.json` using schema `meta-harness-validation/v1`;
2. Node package adapter:
   - select the scope-nearest regular `package.json`;
   - require a non-placeholder `scripts.test`;
   - choose `pnpm test` for sealed `pnpm-lock.yaml`, `yarn test` for sealed `yarn.lock`, otherwise `npm test`;
3. Python adapter from scope-nearest `pytest.ini` or `pyproject.toml` → `python -m pytest`;
4. Cargo adapter from `Cargo.toml` → `cargo test`;
5. Go adapter from `go.mod` → `go test ./...`;
6. .NET adapter from one scope-nearest `.sln` or `.csproj` → `dotnet test`.

If multiple allowed paths imply different project roots, or a project root is otherwise ambiguous, validation fails closed. If no deterministic adapter matches, work blocks before workspace creation or worker launch. The product does not fall back to asking the owner to author an internal work-session contract.

## Pre-worker product-proof compiler

Every `work-session/v7` pins exactly one canonical `product-proof-spec/v1` before the coding worker can produce a candidate. Proof absence is not a second execution branch.

The proof contract binds exact:

```text
productDirection.digest
base.commit
productResult
newlyTrueBehavior
doneWhen
```

Every material semantic clause must map to at least one atomic claim. Claims are `EXECUTABLE`, `UNVERIFIABLE`, `TASTE`, or `EXTERNAL`; non-executable material claims remain explicit gaps and cannot disappear under an overall success label.

A repository may provide sealed-base `.meta-harness/product-proof.json` using `product-proof-policy/v2`. The policy and program are read from exact base Git blobs and normalized into the same product-proof spec used everywhere else. On the normal owner-goal path, absence of that policy may invoke a read-only pre-worker compiler against only owner direction, the sealed product contract, and a clean exact-base snapshot. The compiler never sees a coding candidate.

Each executable claim declares whether the sealed base is expected to `PASS` or `FAIL`. Meta-Harness calibrates the exact proof program before coding. A generated claim whose observed baseline disagrees with its declaration is downgraded to an explicit proof gap. A base-owned policy whose declared baseline is false fails closed.

Meta-Harness owns the trust envelope—inputs, temporal separation, exact bytes, calibration, isolation, claim coverage, and result derivation—not a generic product-testing DSL. Repository-native executable code expresses domain semantics.

## Coding worker

The supported coding worker remains read-only. It receives product direction before local engineering context and returns bounded structured file contents.

It may not directly mutate the filesystem or Git state. The controller rejects traversal, symlink targets, duplicate paths, oversized content, protected paths, and changes outside the sealed boundary before materialization.

Worker-reported validation is advisory. Controller validation is authoritative.

## Execution permit

Before each material attempt, Meta-Harness compiles an immutable generation-bound execution permit from the sealed session, exact ACTIVE custody, execution lease, and Git facts.

The normal material capabilities are:

```text
CODE_PROPOSE
CONTROLLER_MATERIALIZE
CONTROLLER_VALIDATE
CONTROLLER_COMMIT
```

`CONTROLLER_PUSH` is added only when publication authority is explicitly sealed.

The permit does not grant product interpretation, credentials, destructive cleanup, arbitrary root shell, publication by default, or scope widening.

After worker return, the controller re-proves live product direction, session identity, workspace identity, HEAD, branch, owned paths, and the generation's initial dirty manifest before materialization. Git-index mutation, HEAD movement, branch changes, or scope escape fail closed.

## Validation and repair loop

After controller materialization:

1. durably seal the exact candidate before validation;
2. run exact external validation;
3. if validation passes, execute the exact sealed `product-proof-spec/v1` and derive `product-proof/v2` claim results;
4. if validation fails, or product proof is `FAILED`, and attempts remain, emit optional coarse `Repairing validation…`, advance custody to the next coding generation, compile a fresh permit, and return the failure to the same accepted result;
5. if product proof is `GAP`, do not invent a repair failure: retain the regression-validated candidate as `BANKED_UNPROVEN` with unresolved material claims visible in evidence;
6. if product proof is `PROVEN`, the candidate is eligible for `DONE`;
7. do not ask the owner to choose the repair actor, session, validation command, or generation.

Candidate seals are the durable provenance chain across repair generations. Generation N+1 must begin from exact seal N bytes; the next seal admits only paths already owned by seal N plus paths changed by the new typed controller operations. Cross-generation provenance is not reconstructed from an in-memory path accumulator.

The product result, product-direction snapshot, scope, and stop conditions do not change between bounded repair attempts.

## Automatic local banking

A local commit is immutable closure, not publication.

After passed regression validation and controller candidate acceptance, Meta-Harness banks the exact candidate locally whether semantic proof is `PROVEN` (`DONE`) or `GAP` (`BANKED_UNPROVEN`). It does not bank a `FAILED` proof candidate. For an eligible candidate, Meta-Harness:

1. hashes exact accepted paths;
2. requires the exact ACTIVE controller-owned managed worktree and custody;
3. requires `CONTROLLER_COMMIT` capability;
4. verifies accepted bytes are unchanged after validation;
5. stages only accepted paths and rejects unexpected staged paths;
6. commits the accepted paths on the managed branch;
7. terminalizes the workspace as `TERMINAL_COMMITTED`.

This happens even when `work-session/v7` contains `delivery.commit=false`; that field cannot disable controller-owned local BANK.

If controller death occurs after the exact BANK commit but before operational result/closure persistence, restart must re-prove the durable candidate seal against the managed workspace Git state, recover `TERMINAL_COMMITTED`, and reconstruct durable operational closure from the exact execution origin. New repo-owned closure uses Outcome + Claim provenance; legacy Decision-origin closure remains readable for retained recovery evidence.

Push remains explicit publication authority. When `delivery.push=true`, the existing controller push path may publish the managed branch and must verify remote equality. Normal owner-result routing does not infer push authority.

The source checkout's branch, HEAD, index, and dirty bytes are never the delivery target and remain unchanged.

A `PARTIAL` or `BLOCKED` result is never delivered. `BANKED_UNPROVEN` is deliberately banked local work with non-complete product closure, not a `PARTIAL` workspace state.

## Repository decision authority

Repositories may opt into repo-owned decision authority. Domain semantics remain opaque to the generic kernel.

The authoritative path remains:

```text
immutable repo-world + attestation
→ immutable WorldHead
→ repo-decision/v3 = DISPATCH | NO_DISPATCH
```

DISPATCH persists its Decision as upstream selection evidence, compiles a minimal immutable `outcome/v1`, acquires or reuses one compatible `outcome-claim/v1`, and seals an internal `work-session/v7`. New repo-owned AttemptEntry admission is Claim-keyed and generation-bound, not singleton-Decision-keyed. Claims with disjoint concrete write boundaries may originate from the same WorldHead; duplicate Outcomes and overlapping boundaries fail closed. Repo-owned work-session continuation is claim-addressed rather than selected by one repository-global `latest.json`. Unsupported `OWNER_DECISION_REQUIRED` is rejected as unevidenced authority instead of becoming durable owner input. Authoritative World transitions remain compare-and-swap protected; scoped commit freshness after unrelated World movement is a later slice.

The JourneyState reducer consumes only the generic DISPATCH/NO_DISPATCH disposition; it does not absorb repo-domain interpretation, evidence meaning, claim validity, ranking, resurrection semantics, or allocation.

## Human diagnostic boundary

`meta-harness inspect` may report:

```text
State: active | idle
Result: <active product result>   # active only
Next: continuation is automatic. # active only
```

It must not report workspace IDs, session IDs, generations, digests, actors, custody records, permits, or internal phase state.

Machine/evidence contracts may retain richer fields internally. They are not human task modifiers.

## Internal maintenance boundary

Historical command handlers for evidence, release, layout, governance, portfolio, and other maintenance remain internal implementation while their unique semantics are classified and retired or moved behind library/script entrypoints.

Repository adoption retains two narrow operator maintenance entrypoints: `meta-harness sync check --target <repo>` is read-only, and `meta-harness templates install [--overwrite]` installs repo-local guidance while preserving the dirty-work refusal unless the operator explicitly supplies `--allow-dirty`. These adoption entrypoints remain absent from normal and advanced help because they are installation/maintenance operations, not product workflow controls.

All other historical commands are not public command metadata and must not appear in the normal or advanced human help inventory. Product tests exercise them through an explicit maintenance test context rather than treating them as supported user workflow.

The target end state has no category called "advanced user workflow command."

## Safety and owner authority

The controller may autonomously perform reversible in-scope execution, exact validation, bounded repair, workspace creation, and local immutable banking.

Owner input remains required for:

- product/taste choices;
- material scope expansion;
- credentials or protected access;
- destructive operations;
- publication, PR, merge, release, or equivalent external effect when not already explicitly authorized;
- material risk decisions.

## Black-box acceptance

A fresh supported repository must satisfy:

```text
meta-harness "Add CSV export"
```

with:

```text
owner states desired result once
→ no operational question
→ no flag selection
→ no workflow command selection
→ no manual actor routing
→ fresh isolated coding
→ deterministic native validation
→ bounded repair when needed
→ automatic local immutable commit
→ one concise closure
```

After interruption:

```text
meta-harness
```

must mechanically continue the exact ACTIVE work or stop without the owner saying resume, selecting an actor, supplying a session, choosing validation, or deciding whether successful validated bytes deserve a local commit. If the controller died after durable candidate sealing, continuation starts at verification from that same seal and same coding generation; the coding worker is not replayed merely because the process restarted.

The black-box suite must also prove that normal help and direct human invocation cannot encounter the historical lifecycle controls, while `meta-harness inspect` remains identifier-free.

## Deliberate exclusions

No queue, daemon, scheduler, swarm, dashboard, recursive planner packet, generic provider framework, automatic publication, or destructive worktree cleanup is part of this product.
