# Phase 23A — Active Execution Plan (short)

**Status:** D069 closed under `e8e7713`. D070-A1 closed under `8ebe690`. D071 functional execution passed but custody closure was superseded. D072 implemented the custody substrate and its ToolLauncher closure gate failed. **D073 REPLACE+CLOSE closed under exact implementation candidate `87de018`: 111-file native suite PASS, live Fluxara VERIFIED with one spawn, normal fresh-process REPLAY with zero spawns and unusable tools, independent portable verification PASS, leakage PASS, and former ToolLauncher/Windows/phase-lineage runtime deleted.** D074 cross-ecosystem implementation is audit-accepted: shared phase-neutral live workflow, exact shallow DevSpace authority, strengthened lifecycle-preserving Node validation, and expired replay pass offline; 112-file native suite PASS. Next: bank one immutable candidate → exact suite → DevSpace-only authenticated live closure → D075 OPERATE → DECIDE → DELETE.

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
| D074 | **Implementation audit accepted; candidate/live closure next** — DevSpace `00952c05` / tree `65e24966`, `scripts/dev-server.mjs`, symbolic `node` validation; one phase-neutral shared workflow; exact depth-one authority; receipt-derived expired replay; lifecycle-preserving validator. Production skill/runtime/kernel/CLI/package surfaces remain frozen. Bank one immutable candidate, run exact 112-file suite, then run only the authenticated DevSpace live gate. |
| D075 | **OPERATE after D074** through one minimal private example-driven seam for repeated real changes. No public CLI, compatibility, provider registry, delivery, concurrency, or workflow framework. |
| DECIDE / DELETE | Decide a stable public execution surface from repeated D075 evidence, then delete unsupported surfaces only after replacement usability exists. |

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
IMMUTABLE CANDIDATE + exact 112-file suite + DevSpace-only authenticated live closure
        ↓
D075 OPERATE: minimal private example-driven seam + repeated real operator changes
+ record friction; no public CLI or compatibility path
        ↓
DECIDE one stable public execution surface from actual use
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
