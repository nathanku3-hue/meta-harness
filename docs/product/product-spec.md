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

Inputs are already-established owner-work facts such as:

- an owner-supplied product result;
- exact ACTIVE persisted owner work-session custody when one exists.

Repo-owned proposal/Claim work is no longer collapsed into this single-result reducer. When a repository charter enables repo control and no owner result is active, the command path enters the Claim-recovery/proposal wave directly.

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
different owner result while ACTIVE      → OWNER_INPUT
no owner result + no ACTIVE owner result → STOP, automatic unless repo control routes to a Claim wave first
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

Byte continuity is seal-first, not dirty-status-first. For generation 1, an unsealed baseline must be the exact clean sealed base. For repair generation N > 1, previous-generation continuity is either exact durable candidate seal N-1, or an exact `worker-stop/v1` boundary plus a separately bound `forward-motion-proof/v1` authorizing `CONTINUE_WITH_ALTERNATIVE`. The stop—not the semantic proof—owns mechanical continuity through exact HEAD, branch, index digest, dirty-manifest digest, and Git tree identity. If candidate seal N already exists, that seal must exactly prove the live tree, index, and path set before continuation. The dirty-manifest digest remains a cheap custody consistency check but is not proof of file contents.

A current-generation sealed candidate resumes controller work in the same generation: reacquire the controller lease, re-prove the seal, then continue validation, product proof, and BANK without invoking the coding worker again. A current-generation durable `worker-stop/v1` also resumes without replaying the coding worker: if no forward-motion proof exists, run the one bounded challenger; if a terminal proof exists, close from it; if `CONTINUE_WITH_ALTERNATIVE` exists and budget remains, re-prove the stop boundary and advance exactly once. If an AttemptEntry exists but neither candidate seal nor worker STOP was durably created, that coding generation is not replayed.

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

The supported coding worker remains read-only. It receives product direction before local engineering context and emits incompatible `worker-result/v2` with status `DONE`, `PARTIAL`, or `STOP`.

`DONE` / `PARTIAL` may return bounded typed `WRITE`, `DELETE`, or `MOVE` proposals and must set `stop: null`. `STOP` must return zero mutation operations and a structured stop containing the unsatisfied requirement, failed means with evidence, alternatives considered, and an observed constraint if any. Worker vocabulary has no organizational `blocked` authority and no worker-authored `blocker` / `nextAction`; it may not nominate an owner, manager, librarian, approver, approval gate, or human question.

It may not directly mutate the filesystem or Git state. After worker return the controller compares the exact Git-visible byte/tree boundary as well as HEAD, branch, index, dirty manifest, and allowed paths before trusting the result. Traversal, symlink targets, duplicate paths, oversized content, protected paths, changes outside the sealed boundary, or direct worker mutation fail closed.

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

After worker return, the controller re-proves live product direction, session identity, workspace identity, HEAD, branch, owned paths, the generation's initial dirty manifest, and exact Git-tree bytes before materialization. Git-index mutation, HEAD movement, branch changes, same-status byte mutation, or scope escape fail closed.

## Validation and repair loop

After controller materialization:

1. durably seal the exact candidate before validation;
2. run exact external validation;
3. if validation passes, execute the exact sealed `product-proof-spec/v1` and derive `product-proof/v2` claim results;
4. if validation fails, or product proof is `FAILED`, and attempts remain, emit optional coarse `Repairing validation…`, advance custody to the next coding generation, compile a fresh permit, and return the failure to the same accepted result;
5. if product proof is `GAP`, do not invent a repair failure: retain the regression-validated candidate as `BANKED_UNPROVEN` with unresolved material claims visible in evidence;
6. if product proof is `PROVEN`, the candidate is eligible for `DONE`;
7. do not ask the owner to choose the repair actor, session, validation command, or generation.

Candidate seals are the durable provenance chain across code-producing repair generations. Generation N+1 normally begins from exact seal N bytes; a zero-operation `STOP` generation instead carries exact mechanical continuity through `worker-stop/v1` and can advance only with a separate `CONTINUE_WITH_ALTERNATIVE` proof. The next candidate seal retains paths from the most recent actual candidate plus paths changed by the new typed controller operations. Cross-generation provenance is not reconstructed from an in-memory path accumulator.

A `STOP` invokes one fresh read-only challenger and no universal reviewer. The challenger has no ExecutionPermit or material/owner/Git authority. It tries to falsify terminality and returns semantic evidence for exactly one of `CONTINUE_WITH_ALTERNATIVE`, `REPLAN_REQUIRED`, `HARD_BLOCKED`, or `OWNER_REQUIRED`. Only `PRODUCT_TASTE`, `SCOPE_EXPANSION`, `CREDENTIALS`, `PROTECTED_ACCESS`, `DESTRUCTIVE_ACTION`, `PUBLICATION`, or `MATERIAL_RISK` may inhabit `OWNER_REQUIRED`; unsupported roles fail toward autonomous replan, never human routing. The challenger itself does not consume a coding attempt; a new coding generation does.

The product result, product-direction snapshot, scope, Claim, and stop conditions do not change when only implementation means change. Exhausted implementation/validation without typed owner proof becomes `REPLAN_REQUIRED`, not implicit owner escalation.

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

A `REPLAN_REQUIRED`, `BLOCKED`, or `OWNER_REQUIRED` result is never delivered. `BANKED_UNPROVEN` is deliberately banked local work with non-complete product closure, not a partially authoritative workspace state. Human `Need you:` output is permitted only for proof-backed `OWNER_REQUIRED`; question punctuation alone has no authority.

## Repository proposal / Claim authority

Repositories may opt into repo-owned progress authority with `.meta-harness/repo-charter.json`. Domain semantics remain opaque to the generic kernel.

Fresh repo-owned possibilities are reconstructed from durable truth rather than read from mutable proposal state:

```text
immutable repo-world + attestation
→ immutable world-head/v2 H(productCommit=P)
→ active Claims + unresolved authoritative handoffs
→ fresh read-only logical planner
→ disposable semantic candidates
```

`repo-decision/v3`, `repo-proposal-set/v1`, `repo-proposal-set/v2`, `world-transition/v1`, and `world-head/v1` remain readable only as retained historical/migration/regression evidence where applicable. `.meta-harness/repo-proposals.json` is not active fresh-work ingress. New repo-owned session base is mechanically `EXACT_COMMIT(current WorldHead.productCommit)`.

The normal repo-owned reconciliation transaction is:

```text
drain landing-ready terminal Closures
→ recover active Claims from durable session/workspace custody
→ start recoverable executable Claims up to local worker concurrency
→ if repository active-Claim capacity remains, plan the current Head at most once in this controller epoch
→ admit compatible candidates as NEW Claims up to repository active-Claim capacity
→ run independent runWork() transactions concurrently
→ wake on the next local settlement only
→ reread durable truth and land the resulting Closure against CURRENT World
→ controller-owned cumulative code integration + retained proof
→ world-transition/v2 CAS + Claim release
→ repository Claim capacity reopens; plan the successor Head while slower siblings continue
```

A planner candidate is disposable possibility; an Outcome is immutable work identity materialized as part of successful Claim admission; a Claim is durable temporary commitment. Candidate preparation constructs the prospective Outcome bytes/digest in memory. Under the World/Claim authority lock, the controller proves current-Head and boundary availability before persisting that Outcome prerequisite, exact session, `outcome-claim-session/v1`, and finally the Claim. Ordinary stale/conflicting rejection therefore leaves no Outcome object; crash residue before Claim visibility remains inert.

Existing Claims deliberately do not gain whole-World equality: unrelated World advancement cannot cancel admitted responsibility. Once Claim visibility exists, the exact Claim/session owns continuity even if the planner batch disappears. The later `outcome-claim-binding/v1` still binds Claim→Session→Workspace custody.

Repo-owned continuation is Claim-addressed rather than selected by repository-global `latest.json`. Claims with disjoint concrete write boundaries may coexist; duplicate Outcomes and overlapping boundaries fail closed. Controller-local fan-out is a bounded operational limit only and is never persisted as queue, priority, reservation, event history, or World state. Terminal Closures are always drained before a fresh planner boot, planner completion is never authority, and an unchanged Head receives at most one planner boot per active controller epoch.

### Delegation Round 2 contract seam

`meta-harness-delegation-round2/v1` is a pure projection/acceptance contract for a bounded DevSpace `DELEGATION-R2` run. It does not own dispatch, lane lifecycle, or World mutation. Input memory is reconstructed only from authoritative current product truth: the exact owner-authored PRODUCT Endgame projection, the current `world-head/v2` plus current accepted World, one explicit current gate, and immutable evidence references. Each lane names one immutable `outcome/v1`; lane acceptance criteria are mechanically `desired-state = Outcome.desiredState` and `evidence-requirement = Outcome.evidenceRequirement`.

Meta-Harness computes the exact DevSpace `delegation-context/v1` digest before launch. Compact `lane-result-card/v1` fan-in must bind that context and the sealed lane objective/criteria. The normal acceptance path rejects transcript/message payloads and does not ingest expanded evidence bodies. A disputed criterion may issue one bounded evidence request for refs already present in that lane's compact result; the returned evidence set must match exactly. Lane `worldDelta` remains advisory until a later authoritative interpreter/World transition accepts it.

This Round-2 seam remains frozen and explicitly excludes Grill, DONE/HOLD/obsolete lifecycle, released-capacity refill/kill/frontier scheduling, automatic World landing, and runtime/fidelity routing.

### Delegation Round 3 autonomous lifecycle

Round 3 is one bounded event-driven reconciliation layer over the frozen Round-2 contract. It does not introduce a scheduler or new execution substrate. The retained DevSpace parent/child task lifecycle remains the host; Meta-Harness decides only what remains positive-value after accepted evidence changes World.

A result-bearing Round-2 lane is terminal at the host and is reduced to immutable `meta-harness-delegation-learning/v1`. That learning binds the delegation/contract/context, lane/Outcome, task/workspace, lane-brief/boot-prompt, compact result digest, criterion verdicts, evidence summaries, advisory `worldDelta`, remaining uncertainty, and handoff. Raw transcript fields are still excluded.

The repository-owned fixed closure interpreter receives the compact learning plus its immutable Outcome against the **current** World/attestation. A validated successor commits through `world-transition/v2` cause `DELEGATION_LEARNING`. This transition preserves `WorldHead.productCommit` exactly, so external delegation may update accepted semantic truth while unrelated Claims/lanes continue but can never manufacture canonical product code. CAS loss reinterprets against the winning current World. A compact result digest already present in authoritative World lineage is replay-rejected/idempotently recognized.

After each newly landed result, and on an explicit reconciliation event, a fresh read-only frontier planner receives only PRODUCT Endgame, current World/WorldHead, current gate, still-live sealed lane objectives/criteria, compact landed-result evidence, and retained HOLD checkpoint refs. Every live lane receives exactly one semantic decision:

```text
CONTINUE  still positive-value on the current frontier
HOLD      still relevant but should checkpoint and stop consuming live capacity
OBSOLETE  current accepted World makes the lane no longer decision-relevant
```

Round 3 is lifecycle-only. Its frontier contract keeps `newOutcomes` as an exact-empty compatibility field; any attempt to propose fresh work is rejected before host action. Fresh coding remains exclusively on the logical planner → immutable Outcome → atomic Claim → controller integration path. Claim-history Outcomes and pre-fix writable `r3-*` refill lanes are classified as CODE; Round 3 accepts only EVIDENCE lanes, so neither a pending coding lane nor its PASS result can bypass canonical validation/integration through delegation learning.

Before HOLD cancellation, Meta-Harness persists deterministic `delegation-hold-checkpoint/v1` containing the exact retained task/workspace and sealed contract/lane/context identities, current WorldHead, gate, reason, and bounded evidence refs. It contains no chat history and grants no scheduling authority. Only after the checkpoint exists may `cancel_lane` terminate the lane. OBSOLETE cancels without a HOLD checkpoint. A useful `INTERRUPTED`/`FAILED` retained delegation is continued through existing `resume_delegation` rather than a new worker/scheduler abstraction.

Every executable frontier gets one fresh read-only Grill pass. Grill either `ACCEPT`s the frontier or `REPLACE`s it once with a complete corrected frontier; there is no recursive review loop. It specifically challenges unnecessary decomposition, stale/duplicate lanes, premature owner gates, and the invalid inference `failed route = failed Outcome`. If WorldHead changes while frontier/Grill reasoning is running, that stale result is discarded and the full pass retries. After planner + Grill + World recheck, Meta-Harness force-refreshes the compact host snapshot and compares taskId, workspaceId, launch status, and resultDigest; any drift also discards the frontier before HOLD/OBSOLETE/resume action.

Owner-visible gate behavior is derived from the post-lifecycle semantic frontier:

```text
CONTINUE       autonomous positive-value work remains; surface nothing
FORWARD_GATE   autonomous lane frontier is empty and a new semantic gate follows
OWNER_DECISION only a typed owner-exclusive scope/taste/access/risk choice remains
```

The frontier digest includes continuing lanes, blockers, and gate semantics; `newOutcomes` is always empty. It excludes completed HOLD/OBSOLETE cleanup actions, so cancelling a stale lane does not make the same gate appear again. Before a non-`CONTINUE` gate is returned, Meta-Harness persists immutable `delegation-surfaced-frontier/v1` evidence bound to the exact current WorldHead and rechecks that Head before persistence. Restart finds the latest surfaced record on current World lineage and suppresses the same digest without conversational memory; a caller-supplied prior digest may only agree with retained evidence. The retained Round-2 gate string is used only when no surfaced-frontier evidence exists yet.

The Round-3 host seam maps only to compact `get_delegation {delegationId}`, `resume_delegation {delegationId}`, and `cancel_lane {delegationId,laneKey}`. `spawn_delegation` remains a frozen Round-2 creation primitive but is not callable from Round-3 lifecycle authority. A retained delegation id may be reconciled directly; Meta-Harness consumes MCP `structuredContent`, fetches the compact snapshot, and re-runs Round-2 context/lane binding itself.

### Delegation Round 4 runtime + complete UX

Round 4 changes execution cost and active-turn continuity without changing authority. When a product host attaches a retained Round-3 request, one ordinary repo-work invocation reconciles it, continues the existing Claim work path, and—only while evidence lanes remain pending—waits on compact `get_delegation` state plus current WorldHead. Polling is process-local wakeup only: unchanged snapshots do not rerun frontier/Grill, no polling state is durable, and Ctrl-C/SIGTERM uses the existing controlled drain. A changed lane identity/status/result or WorldHead wakes the same Round-3 reconciliation; fresh code is still admitted only by the repository logical planner and Claims.

Runtime fidelity is operation-fixed rather than planner-selected. Meta-Harness schema/Git/custody/SAW/validation work remains ordinary local execution; structured frontier/Grill reasoning remains the existing ephemeral headless model path. Browser reality stays in DevSpace. DevSpace uses one real authenticated Chromium host with independent managed conversation pages for machine browser jobs; a result, cancellation, failure, or expiry releases only that job's page and does not close sibling lanes or the shared context. Human `web_launch` remains the explicit full-fidelity owner/UI path. No provider router, browser scheduler, queue, daemon, swarm, persistent idle worker, or second coding dispatcher is introduced.

A delegation gate is owner-visible only when it is still bound to the final current WorldHead after ordinary repository work has had a chance to advance product truth. Thus `go delegation` can remain one active product action: compact evidence changes wake reconciliation automatically, while stale gates disappear rather than requiring the owner to manage streams.

Round-4 scope closure additionally requires a live authenticated multi-lane ChatGPT acceptance, not only an intercepted Chromium fixture. The 2026-08-28 candidate proved one authenticated managed conversation can establish a durable identity, while concurrent managed conversations intermittently failed prompt insertion, conversation-identity establishment, or page survival even though the four-page real-Chromium fixture passed. That is an observed supported-use defect in the shared-browser approach and therefore the exact warrant for one later bounded browser-host repair. Until that repair passes the same live acceptance, do not claim delegation scope complete and do not widen the response into a generic browser pool/provider/scheduler framework.

### Current-World Closure landing

Worker success is not repo-level product success until current authoritative truth accepts it. For every terminal Claim with durable work evidence, Meta-Harness supplies the exact current World+attestation, Outcome, Claim, ExecutionClosure, and work result to the repository-owned fixed interpreter at `.meta-harness/closure-interpreter.js`.

The interpreter is a self-contained Node program executed read-only inside the same Linux user/mount/network/PID namespace + chroot trust envelope used by verification. It receives the complete landing packet only through stdin and returns exactly:

```text
repo-closure-interpretation/v1
interpretation
successor repo-world/v2
successor world-attestation/v1
APPLIED | INVALIDATED_REPLAN
```

Meta-Harness validates and persists those immutable semantic objects outside the World authority lock. A `DONE` + `APPLIED` Closure must then integrate its exact worker BANK commit onto current `WorldHead.productCommit` in a fresh controller-owned integration worktree. The controller replays every retained executable validation/product-proof obligation from the immutable `product-integration/v1` lineage against the same cumulative candidate tree. Git conflict, path mismatch, or any retained proof failure rejects the new integration and is returned to repository interpretation as `INVALIDATED_REPLAN`; authoritative `productCommit` does not move.

Accepted code integration produces immutable `product-integration/v1`. Active `world-transition/v2` carries both `successorProductCommit` and the exact `integrationDigest`; the receipt must prove `receipt.predecessorProductCommit == predecessorHead.productCommit` and `receipt.integratedCommit == successorProductCommit`. Thus transition identity deterministically determines the complete successor Head. `ATTEMPT_ABORTED`, invalidated/non-code learning, and `REALITY_REFRESH` preserve predecessor productCommit exactly.

`Claim.originWorldHeadDigest` remains provenance only. If World CAS loses, both the stale semantic successor and stale integration candidate are discarded and reconstructed against the winning current World/product commit; stale code is never mechanically rebased by changing only its predecessor field.

A durable `PARTIAL`/`BLOCKED` work result still lands through `ATTEMPT_LEARNING` so failure/replan learning can close the Claim. A terminal ExecutionClosure with no work result resolves through `ATTEMPT_ABORTED` and releases its Claim without semantic interpretation. `BANKED_UNPROVEN` never enters canonical product code.

`WorldHead.productCommit` is the sole product-base authority. `refs/meta-harness/product-head` is non-authoritative Git reachability/inspection plumbing and is mechanically repaired from the current Head when absent or stale. The integration branch/worktree remains a GC root until World CAS and this mirror ref retain an accepted commit.

The one-time v1→v2 migration traverses authoritative legacy World lineage. Every code-producing accepted Phase-2 learning is resolved to its exact Closure/work result/BANK commit and cumulatively integrated/re-proven in transition order before the first v2 Head is activated. If accepted semantic history cannot be reconstructed as code, migration fails closed rather than seed a semantically inconsistent product commit.

The World authority lock protects only short authority operations: current-Head admission checks, compatibility checks, session/Claim visibility ordering, transition CAS, and Claim release. Product-proof compilation, repository semantic interpretation, Git integration, and cumulative retained-proof execution occur outside that lock.

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
