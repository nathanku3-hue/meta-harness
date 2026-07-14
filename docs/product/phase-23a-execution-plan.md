# Phase 23A — Active Execution Plan (short)

**Status:** D069 closed under `e8e7713`. D070-A1 closed under `8ebe690`. D071 functional execution passed but custody closure was superseded. D072 implemented the custody substrate and its ToolLauncher closure gate failed. **D073 REPLACE+CLOSE closed under exact implementation candidate `87de018`; D074 PROVE closed under exact repair candidate `4ad92f0`; D075 OPERATE closed under exact candidate `cd63e52`. D076 offline implementation is complete and candidate-ready: exactly one installed command, one strict public request/receipt boundary, packaged phase-neutral custody runtime, deleted private operator path, 115 native Windows test files with zero failures, and 234-entry dry-run/actual pack equality. The isolated installed-package proof completed one authenticated fake-agent spawn → VERIFIED, retained child/ref, expiry+60s zero-spawn REPLAY with unusable tools, portable independent validation, leakage PASS, and create-only receipt against a novel dirty-source repository.** Next: create the immutable candidate once, rerun exact candidate evidence, perform one authenticated novel operation from that exact tarball, then close separately. DELETE remains blocked.

**Supersedes:** long historical vertical-slice plan (deleted from active tree)

## Now

| Step | Work |
| --- | --- |
| D068 | **Closed** under `be82763` (PR #23 squash; reviewed head `4b259c9`; base `f926868`) |
| D069 | **Closed** under `e8e7713` (PR #24 squash; reviewed head `245fa3d`; base `5afe075`) |
| D070-A1 | **Transport/custody closed** — AO `:read-only` schema artifact → post-AO custody → controller commit → validation → durable ref → replay; actual version and AO evidence are bound |
| D071 | **Functional PASS; custody closure superseded** — isolated ToolLauncher `7fab419f20ba`; sealed objective → exact PS 5.1 missing/valid/corrupt validation → live VERIFIED + in-process replay; marker deleted. Post-close audit: child object/ref and AO evidence were deleted with transient roots. |
| D072 | **Substrate implemented; legacy closure superseded** — receipt-first lookup, lazy tool binding, immutable terminal evidence, fresh-process replay, fail-closed conflicts, and portable verification pass offline. `5d677a8` live process 1 spawned AO once but failed trusted PowerShell optional-parameter validation before VERIFIED. Failed create-only root retained. |
| D073 | **Closed under `87de018`** — Fluxara `8548fe5` → verified child `2f2e615`; live spawn one → VERIFIED; fresh process with unusable tools → REPLAY spawn zero; independent export and leakage PASS; former ToolLauncher/PowerShell/CheckShortcut/Windows/phase-lineage path deleted without compatibility. |
| D074 | **Closed under `4ad92f0`** — exact candidate suite 112/112 PASS; DevSpace pinned base `00952c05` → verified child `30ad240b`; one authenticated spawn → terminal VERIFIED; normal process exit; fresh process after expiry → REPLAY spawn zero with unusable tools; independent export validation and leakage PASS; failed `87472e1` and both create-only roots retained. Production skill/runtime/kernel/CLI/package surfaces remained frozen. |
| D075 | **Closed under `cd63e52`** — exact 113-file candidate suite PASS; retained DevSpace/Node child `47c0d016` and Fluxara/Python child `c0032669`; each operation used exact one-revision shallow authority, one authenticated spawn → VERIFIED, expiry+60s zero-spawn REPLAY, independent validation, leakage PASS, unchanged source checkout, and create-only receipt. The seam remains private and unregistered. |
| D076 / SHIP | **Implementation complete; immutable candidate and authenticated closure pending.** Exactly `meta-harness execute --request <absolute-path> [--json]` ships from `lib/`. Offline isolated-package proof passes the complete custody chain on a novel request; private request/script/example identities are deleted with no alias or compatibility. |
| DELETE | **Blocked until D076 closes.** Reduce by supported user job and unique safety invariant only; no aliases, deprecation dispatch, compatibility path, or speculative framework. |

## Functional-first roadmap

```text
D068 closed (be82763)
        ↓
D069 local controller walking slice → IMPLEMENTATION_VERIFIED (closed e8e7713)
        ↓
D070-A0.1 direct AO workspace-write → NO-GO on current Windows host
        ↓
D070-A0.2 read-only schema artifact → controller materialization → GO
        ↓
D070-A1 AO transport/custody path → CLOSED + audit-hardened
        ↓
D071 ToolLauncher single-file functional execution PASS (74f8ac1)
(`scripts/utils/CheckShortcut.ps1`; sealed objective; JSON validator; no marker compatibility)
        ↓
post-close audit: transient cleanup erased child ref/object and replay evidence
        ↓
D072 custody substrate implemented offline; 5d677a8 legacy live closure fails before terminal publication
        ↓
D073 REPLACE+CLOSE CLOSED (87de018)
+ Fluxara live VERIFIED spawn one → normal exit → fresh-process zero-spawn REPLAY
+ independent portable export + leakage PASS
+ ToolLauncher/PowerShell/CheckShortcut/Windows/internal-d069 production path deleted
        ↓
D074 CROSS-ECOSYSTEM IMPLEMENTATION AUDIT ACCEPTED
+ DevSpace pinned commit/tree, one Node example, one real-child end-to-end test
+ one phase-neutral shared harness; Python binding only at Fluxara edge
+ exact depth-one authority with no remote and one visible revision
+ later-than-expiry fresh-process zero-spawn REPLAY
+ semantic validator preserves restart/watcher/shutdown lifecycle
+ no production SKILL.md, runtime, kernel, CLI, package, or lockfile edits
        ↓
FIRST IMMUTABLE CANDIDATE 87472e1
+ exact 112-file suite PASS
+ one authenticated spawn → terminal VERIFIED child b821c485 + durable ref
+ expired zero-spawn REPLAY assertions + export + leakage PASS
+ FAIL only at independent `git bundle verify`: shallow prerequisite object was unanchored
+ candidate/root preserved; no rerun or amend
        ↓
BOUNDED TEST-VERIFIER REPAIR
+ anchor exact fetched base at refs/verify/base
+ real shallow-source thin-bundle regression PASS
+ retained export re-verifies: exact parent/path, both Node commands exit 0, leakage PASS
        ↓
REPAIR CANDIDATE 4ad92f0 → D074 CLOSED
+ exact 112-file suite PASS
+ exact one-revision shallow DevSpace authority; no remote; clean pinned-base primary clone
+ one authenticated spawn → terminal VERIFIED child 30ad240b + durable ref
+ normal exit → process 2 at expiry + 60s → REPLAY with unusable tools and zero spawns
+ independent two-command Node validation + leakage PASS across 16 files
        ↓
D075 OPERATE CLOSED (cd63e52)
+ exact 113-file suite PASS
+ DevSpace/Node retained receipt: VERIFIED → expiry+60s REPLAY → Node validation/leakage PASS
+ Fluxara/Python retained receipt: VERIFIED → expiry+60s REPLAY → Python validation/leakage PASS
+ actual friction recorded; private entrypoint remains unregistered
        ↓
D076 SHIP INSTALLED-PACKAGE EXECUTION (offline candidate ready)
+ exactly `meta-harness execute --request <absolute-path> [--json]`
+ packaged `lib/execution-custody`; old private runtime/script/schema/example path deleted
+ strict public request binds sealed intent, base tree, and all executable SHA-256 identities
+ isolated `npm pack` install; no source checkout or Meta-Harness `.git` dependency
+ novel dirty-source test repository; immutable object authority only
+ one authenticated fake-agent spawn → VERIFIED → expiry+60s zero-spawn REPLAY
+ portable independent validation rechecks validation executable hash
+ leakage PASS + create-only public receipt
+ 115 native test files PASS; 234-entry dry-run/actual pack equality
+ immutable candidate and authenticated exact-tarball closure remain pending
        ↓
DELETE: preserve supported jobs (`init`, `record`, `status`, `check`, `sync`, and active `release check`)
+ delete everything without a current supported job or unique safety invariant
+ no compatibility path
```

## Explicit non-goals for D068 (historical)

- Delivery assessor / MERGE_READY
- User-facing state mapper
- Generic ExecutionProvider
- Transcript reducer as a standalone product phase
- Durable single-use journal (documented as runtime responsibility)
- Fabricated backdated decision events

## Authority chain

```text
RunSpec
→ RunSpecApproval
→ ExecutionReadinessFacts
→ AttemptAuthorization
→ WorkspaceAttestation
→ WorkspaceStartCheck
→ trusted ImplementationFacts
→ ImplementationAssessment (IMPLEMENTATION_VERIFIED)
```
