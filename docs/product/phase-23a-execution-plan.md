# Phase 23A — Active Execution Plan (short)

**Status:** D069 closed under `e8e7713`. D070-A1 closed under `8ebe690`. **D071 functional execution passed under `74f8ac1`, but terminal custody closure is superseded. D072 implemented the custody substrate offline; exact candidate `5d677a8` passed the 116-file native suite and then failed the ToolLauncher live gate during functional validation before terminal publication.** Next: D073 REPLACE+CLOSE → D074 PROVE → DELETE → DECIDE. No ToolLauncher retry or compatibility bridge.

**Supersedes:** long historical vertical-slice plan (deleted from active tree)

## Now

| Step | Work |
| --- | --- |
| D068 | **Closed** under `be82763` (PR #23 squash; reviewed head `4b259c9`; base `f926868`) |
| D069 | **Closed** under `e8e7713` (PR #24 squash; reviewed head `245fa3d`; base `5afe075`) |
| D070-A1 | **Transport/custody closed** — AO `:read-only` schema artifact → post-AO custody → controller commit → validation → durable ref → replay; actual version and AO evidence are bound |
| D071 | **Functional PASS; custody closure superseded** — isolated ToolLauncher `7fab419f20ba`; sealed objective → exact PS 5.1 missing/valid/corrupt validation → live VERIFIED + in-process replay; marker deleted. Post-close audit: child object/ref and AO evidence were deleted with transient roots. |
| D072 | **Substrate implemented; legacy closure superseded** — receipt-first lookup, lazy tool binding, immutable terminal evidence, fresh-process replay, fail-closed conflicts, and portable verification pass offline. `5d677a8` live process 1 spawned AO once but failed trusted PowerShell optional-parameter validation before VERIFIED. Failed create-only root retained. |
| D073 | **Next — REPLACE+CLOSE** with one skill-owned host-neutral real child; require live VERIFIED, normal exit, fresh-process REPLAY with zero AO spawn and tool canaries, independent export verification, and leakage scan; delete ToolLauncher/PowerShell/CheckShortcut, Windows classifier, phase-lineage production identity, `internal/d069` production imports, and former path in the same change. |
| D074 onward | **PROVE** a third child through example/test only; **DELETE** unsupported surface by current user job and unique invariant; **DECIDE** public execution only after repeated real use. |

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
D073 REPLACE+CLOSE: active bounded-repository-change skill + sealed host-neutral command capsule
+ one private adapter + one production runtime root + real heterogeneous child
+ live VERIFIED → normal exit → fresh-process zero-spawn REPLAY → independent export
+ delete ToolLauncher/PowerShell/CheckShortcut/Windows classifier/internal-d069 production path
        ↓
D074 PROVE: third child through one existing-skill example + one end-to-end test only
+ no SKILL.md, runtime, kernel, CLI, roadmap, or architecture edits
        ↓
DELETE: preserve supported jobs (`init`, `record`, `status`, `check`, `sync`, and active `release check`)
+ delete everything without a current supported job or unique safety invariant
+ no compatibility path
        ↓
DECIDE public execution only after repeated real use
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
