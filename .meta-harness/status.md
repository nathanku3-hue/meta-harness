# Status

Goal:
Close durable child-result custody through D073 REPLACE+CLOSE: migrate the D072 custody substrate into one host-neutral functional slice, prove live VERIFIED → fresh-process REPLAY → independent export, and delete the ToolLauncher/Windows/phase-lineage path in the same change. Then execute PROVE → DELETE → DECIDE. No compatibility layer, delivery actor, public run CLI, provider registry, concurrency framework, or recurring closure ceremony.

Phase:
in_progress

Current truth:
Phases 16–21E remain closed as previously recorded through D063. Phase 21F closed under D064 (`2fedfd4`). Phase 22A-H closed under D065 (`02d9c59`). Phase 22B closed under D066 (`f926868`). Phase 23A-PR1 (D067) is superseded and archived at `fb40d18` on `archive/23a-pr1-d067-fb40d18`. **D068 closed under squash `be82763` (PR #23; reviewed head `4b259c9`; base `f926868`; tree-object equality PASS; ancestry PASS).** **D069 closed under squash `e8e7713` (PR #24; reviewed head `245fa3d`; base `5afe075`; tree-object equality PASS; ancestry PASS).** D070-A0.1 NO-GO / A0.2 GO remain binding. **D070-A1 transport/custody slice closed** under audit-hardening commit `8ebe690`. **D071 functional execution passed under `74f8ac1`, but its closure claim remains superseded by the post-close custody audit:** sealed objective → authenticated Codex `:read-only` → controller commit → Windows PowerShell 5.1 validator (missing+valid+corrupt) → live `IMPLEMENTATION_VERIFIED` + in-process replay against isolated ToolLauncher `7fab419f20ba` / `scripts/utils/CheckShortcut.ps1`. That historical live test deleted both the isolated child repository and its state root in `finally`; the claimed child commit `9f41bbbb…`, create-only ref, AO metadata, change artifact, schema, terminal journal, assessment, and receipt are not retained. The audit also traced restart failure to authorization-before-lookup combined with a time-varying readiness digest. Audit evidence: `docs/ops/audits/d071-post-close-custody-audit.json`. **D072 custody mechanics are implemented offline, but the ToolLauncher-specific closure procedure is superseded:** exact candidate `5d677a8` passed native Windows Node 25 `npm test` across 116 files with zero failures, then its retained live root failed in process 1 after one successful AO spawn because the generated PowerShell artifact mishandled an omitted string parameter and failed trusted validation before terminal publication. This neither closes nor disproves the custody protocol; it proves the gate still conflates model output quality, legacy Windows semantics, and custody. Audit: `docs/ops/audits/d072-exact-commit-live-gate-audit.json`. **D073 now combines REPLACE with custody closure:** carry forward canonical receipt-first replay, lazy execution-tool binding, manifest-last terminal publication, fail-closed conflict handling, fresh-process zero-spawn replay, portable prerequisite-bundle verification, and leakage controls into one host-neutral real-child slice, then delete ToolLauncher/PowerShell/CheckShortcut, the Windows classifier, phase-numbered production identity, `internal/d069` production imports, and the former path in the same change. No ToolLauncher retry or compatibility bridge is authorized. Marker path remains deleted. Quant remains excluded. `lib/contracts/*` remains frozen.

Phase 18 truth:
- JSON output includes top-level `response_handoff`.
- Markdown includes a compact Response Handoff section.
- Handoff items are review-only and `mutates=false`.
- Handoff items do not change readiness state.
- Handoff/drift alone does not make `ok=false`.
- `poll --rollup --write` remains rejected and non-mutating.

Phase 19A truth:
- JSON output includes per-repo `next_action_candidates`.
- Summary output includes `summary.next_action_candidates`.
- Candidate schema includes `id`, `priority`, `kind`, `reason`, `repo`, `source_state`, `source_warning_ids`, `source_warning_kinds`, `source_check_ids`, `target_paths`, and `mutates`.
- Markdown output includes deterministic compact priority action lines under child repos.
- Candidate routing preserves existing readiness state.
- Candidate routing and drift-only warnings do not make top-level `ok=false` by themselves.

Phase 19B truth:
- JSON output includes top-level `next_action_brief`.
- Brief kind is `read_only_worker_brief`.
- If no candidates exist, the brief is a no-op read-only packet.
- If candidates exist, one candidate is selected by priority, configured repo order, and per-repo candidate order.
- Brief schema includes structured `reason`, `source_state`, `source_warning_ids`, `source_check_ids`, and `target_paths` copied from the selected candidate.
- Brief body includes repo name, candidate ID, priority, reason, source state, source warning IDs, source check IDs, target paths, read-only boundary, and explicit instruction not to mutate parent/child repo truth.
- Markdown output includes `## Next Action Brief`.
- Brief generation preserves existing readiness state and top-level `ok` behavior.
- Brief generation does not write files, create queues, create action files, create proposal files, apply patches, execute child commands, or mutate parent/child repos.

Phase 20A truth:
- JSON output includes top-level `proposal_draft`.
- Draft kind is `read_only_proposal_draft`.
- Draft source is `next_action_brief`.
- Draft type is `review_brief`.
- Draft title is generic and deterministic: `Review rollup next action for <repo>`.
- Draft body uses structured brief fields, not parsed human-readable brief body text.
- If no selected candidate exists, the draft is a deterministic no-op packet.
- `proposal_draft.diff` is always `null`.
- `proposal_draft.mutates` is always `false`.
- Markdown output includes `## Proposal Draft`.
- Draft generation preserves existing readiness state and top-level `ok` behavior.
- Draft generation does not write files, create queues, create action files, create proposal files, apply patches, execute child commands, refresh readiness, or mutate parent/child repos.

Phase 20B truth:
- JSON output includes top-level `proposal_validation` after `proposal_draft` and before `proposal_review_gate`.
- Validation kind is `read_only_proposal_validation`.
- Validation is proposal safety only and validates the embedded `proposal_draft` surface.
- Checks cover kind, source, proposal type, `diff=null`, `mutates=false`, relative target paths, selected candidate match, read-only boundary language, no legacy patch proposal field, and no proposal/action/queue file output fields.
- `proposal_validation.ok` may be false without changing top-level rollup `ok`.
- Markdown output includes `## Proposal Validation` after `## Proposal Draft`.
- Validation preserves child repo readiness state and top-level `ok` behavior.

Phase 20C truth:
- JSON output includes top-level `proposal_review_gate` after `proposal_validation` and before `proposal_review_packet`.
- Gate kind is `read_only_proposal_review_gate`.
- Gate verdict is review-only: `blocked`, `not_needed`, or `ready_for_review`.
- If `proposal_validation.ok !== true`, gate verdict is `blocked`, `blocking_check_ids` lists non-pass validation checks, and `next_action` is `fix_proposal_validation`.
- If validation passes and no selected candidate exists, gate verdict is `not_needed` and `next_action` is `none`.
- If validation passes and a selected candidate exists, gate verdict is `ready_for_review` and `next_action` is `review_proposal_draft`.
- Gate output has `mutates=false`.
- Gate does not export, write, queue, apply, execute, refresh, or mutate.
- Gate does not change top-level rollup `ok` or child readiness state.
- Markdown output includes `## Proposal Review Gate` after `## Proposal Validation`.

Phase 20D truth:
- JSON output includes top-level `proposal_review_packet` after `proposal_review_gate` and before `proposal_review_options`.
- Packet kind is `read_only_proposal_review_packet`.
- Packet is an envelope only.
- Packet ID is a stable hash of `proposal_draft`, `proposal_validation`, and `proposal_review_gate`.
- Packet verdict is `blocked`, `not_needed`, or `ready_for_review`.
- Packet includes sections for Proposal Draft, Proposal Validation, and Proposal Review Gate.
- Packet output has `mutates=false`.
- Packet creates no files, queues, exports, or diffs.
- Packet does not change top-level rollup `ok` or child readiness state.
- Markdown output includes `## Proposal Review Packet` after `## Proposal Review Gate`.

Phase 20E truth:
- JSON output includes `proposal_review_options` after `proposal_review_packet` and before `proposal_review_receipt_template`.
- Options kind is `read_only_proposal_review_options`.
- Options are advisory only and do not record any decision.
- `ready_for_review` allows `approve_for_manual_work`, `reject_packet`, and `defer_packet`; default is `defer_packet`.
- `blocked` allows `fix_proposal_validation` and `defer_packet`; default is `defer_packet`.
- `not_needed` allows `no_action`; default is `no_action`.
- Missing or unknown packet state allows `defer_packet` and defaults to `defer_packet`.
- Options have `mutates=false` and do not change top-level rollup `ok` or child readiness state.
- Markdown output includes Proposal Review Options after Proposal Review Packet.

Phase 20F truth:
- JSON output includes `proposal_review_receipt_template` after `proposal_review_options` and before `proposal_review_receipt_validation`.
- Receipt template kind is `read_only_proposal_review_receipt_template`.
- Receipt template source is `proposal_review_options`.
- Receipt template `packet_id` matches `proposal_review_options.packet_id`.
- `allowed_decision_ids` are derived from `proposal_review_options.allowed_decisions`.
- Required fields are `packet_id`, `decision_id`, `reviewer`, `reviewed_at`, and `reason`.
- `template.decision_id`, `template.reviewer`, `template.reviewed_at`, and `template.reason` are null.
- The receipt template does not use `default_decision` as a recorded or selected decision.
- `records_decision=false` and `mutates=false`.
- Missing options produce `packet_id=null`, `verdict=unknown`, `allowed_decision_ids=[]`, `records_decision=false`, and `mutates=false`.
- Markdown output includes Proposal Review Receipt Template after Proposal Review Options.
- Receipt template generation preserves top-level rollup `ok` and child readiness state.

Phase 20G truth:
- JSON output includes `proposal_review_receipt_validation` after `proposal_review_receipt_template` and before `repos`.
- Receipt validation kind is `read_only_proposal_review_receipt_validation`.
- Receipt validation checks the receipt-template safety surface.
- Checks cover receipt template kind, source, `packet_id`, verdict, `allowed_decision_ids`, required fields, decision-field nulls, `records_decision=false`, `mutates=false`, no forbidden file-output fields, and no `patch_proposals`.
- The bounded forbidden-field scan covers rollup, summary, repos, proposal review options, and proposal review receipt template containers.
- Receipt validation verdict is `pass` only when every check passes; otherwise it is `fail`.
- Receipt validation output has `mutates=false`.
- Receipt validation records no decision and no approval.
- Receipt validation preserves top-level rollup `ok` and child readiness state.
- Markdown output includes Proposal Review Receipt Validation after Proposal Review Receipt Template.
- Receipt validation writes no proposal, export, queue, or action files.
- Receipt validation creates no task, executes no child command, refreshes no readiness, and mutates no parent or child repo truth.

Phase 20H truth:
- JSON output includes `proposal_review_copy_block` after `proposal_review_receipt_validation` and before `repos`.
- Copy block kind is `read_only_proposal_review_copy_block`.
- Copy block source is `proposal_review_receipt_validation`.
- Passing receipt validation produces deterministic copy text; failing or missing validation produces `copy_text=null` and a blocked reason.
- Copy block uses `export_target=null`, not `export_path`.
- Copy block has `writes_files=false`, `records_decision=false`, `records_approval=false`, and `mutates=false`.
- Markdown output includes Proposal Review Copy Block after Proposal Review Receipt Validation.
- Copy block preserves top-level rollup `ok` and child readiness state.

Phase 20I truth:
- JSON output includes `proposal_review_copy_block_validation` after `proposal_review_copy_block` and before `repos`.
- Copy block validation kind is `read_only_proposal_review_copy_block_validation`.
- Enforces copy block kind, source, packet ID consistency, verdict match, includes list, read-only safety, correct blocked/passed text states, safety from forbidden words/diffs, no forbidden output fields, and no `patch_proposals`.
- Validation verdict is `pass` only when every check passes, otherwise it is `fail`.
- Validation preserves top-level rollup `ok` and child readiness state.
- Markdown output includes Proposal Review Copy Block Validation after Proposal Review Copy Block.

Phase 20J truth:
- JSON output includes `proposal_review_export_intent` and `proposal_review_export_safety_gate` after `proposal_review_copy_block_validation` and before `repos`.
- Export intent kind is `read_only_proposal_review_export_intent`.
- Export safety gate kind is `read_only_proposal_review_export_safety_gate`.
- Intent enforces read-only safety fields (`export_target=null`, `declared_intent=none/null`, `writes_files=false`, etc.).
- Safety gate verifies export intent kind, packet ID consistency, copy block validation matching, intent constraints, absence of forbidden output fields, and absence of `patch_proposals`.
- Safety gate verdict is `pass` only when every check passes, otherwise it is `fail`.
- Export intent and safety gate preserve top-level rollup `ok` and child readiness state.
- Markdown output includes Proposal Review Export Intent and Proposal Review Export Safety Gate after Proposal Review Copy Block Validation.

Phase 21A truth:
- JSON output includes top-level `autonomy_plan` after `proposal_review_export_safety_gate`.
- JSON output includes top-level `autonomy_approval_receipt_validation` after `autonomy_plan`.
- `poll --rollup --json` accepts `--autonomy-approval-receipt` and `--autonomy-approval-receipt-file` as explicit stdout-only approval evidence inputs.
- Approval receipt validation requires `autonomy_plan.verdict=ready_for_human_approval`, matching packet ID, `decision_id=approve_for_manual_work`, non-empty reviewer/reason, strict ISO `reviewed_at`, and no unsafe mutation/output fields.
- Receipt validation records no decision and no approval: `records_decision=false` and `records_approval=false`.
- Receipt validation does not write files, create tasks/queues, execute child commands, apply patches, refresh readiness, or mutate parent/child truth.

Phase 21B truth:
- JSON output always includes top-level `manual_work_packet` after `autonomy_approval_receipt_validation` and before `repos`.
- Packet kind is `approved_manual_work_packet` and source is `autonomy_approval_receipt_validation`.
- Packet shell verdicts are explicit: `not_needed`, `missing_approval`, `blocked`, `invalid`, and `ready_for_manual_work`.
- A valid approval receipt unlocks `ready_for_manual_work`.
- Packet fields are built from structured rollup fields only, not parsed Markdown/body text.
- Packet includes selected repo, selected candidate, packet ID, priority, reason, target paths, source state, source check IDs, source warning IDs, normalized receipt reviewer/reviewed_at/reason, and deterministic manual instructions.
- Packet is stdout-only and non-mutating: `mutates=false`, `writes_files=false`, `writes_parent_files=false`, `writes_child_files=false`, `executes_child_commands=false`, `creates_tasks=false`, `creates_queues=false`, `applies_patches=false`, `refreshes_readiness=false`, `records_decision=false`, and `records_approval=false`.
- Markdown output includes `## Approved Manual Work Packet`.

Phase 21C truth:
- `poll --rollup` still rejects generic `--write`.
- `poll --rollup --json` accepts `--write-manual-work-packet <path>` as the only approved materialization flag.
- Materialization requires `manual_work_packet.verdict=ready_for_manual_work`.
- The artifact is one parent-local JSON file with `schema_version="1.0.0"`, `kind="approved_manual_work_packet_artifact"`, `source="poll_rollup_manual_work_packet"`, `rollup_schema_version`, `generated_from`, `packet_id`, and embedded `manual_work_packet`.
- Output paths must be relative, below `.meta-harness/`, file-targeted, outside child repo roots, and overwrite only with `--force`.
- The artifact wrapper declares `writes_files=true`, `writes_parent_files=true`, and `writes_child_files=false`; the embedded packet remains non-writing.
- `--json` still prints the full rollup JSON.
- No child execution, patch application, child file write, queue/task creation, readiness refresh, approval recording, decision recording, or parent/child truth mutation is shipped.

Phase 21D truth:
- JSON output always includes top-level `manual_work_packet_artifact_validation` after `manual_work_packet` and before `repos`.
- `poll --rollup --json` accepts `--verify-manual-work-packet <path>` as a read-only parent-local artifact verification input.
- Verification reads an already materialized artifact independently; it does not require approval receipt input, packet writing, or `--force`.
- Validation verdicts are deterministic: `not_requested`, `missing`, `invalid`, `blocked`, and `pass`; only `pass` sets `ok=true`.
- Missing files at syntactically valid `.meta-harness/` paths return validation verdict `missing` rather than crashing the command.
- Invalid paths are rejected at the command layer: absolute paths, paths outside `.meta-harness/`, child repo paths, empty paths, and repeated verify flags.
- Content validation checks artifact schema/version/kind/source, packet ID consistency, embedded `manual_work_packet.verdict=ready_for_manual_work`, wrapper safety fields, embedded packet safety fields, forbidden fields, path boundary checks, and read-only no-mutation behavior.
- Artifact verification does not change top-level rollup `ok`, child readiness state, approvals, decisions, readiness files, tasks, queues, patch state, parent truth, or child repos.
- No execution semantics are shipped: `pass` means structurally valid and safe to consume as an operator artifact, not ready to execute/apply.

Superseded/deferred truth:
- D047's action/proposal closure is superseded by D048 as current truth.
- No `patch_proposals` output is shipped.
- No proposal files are written and no proposal application exists.
- Phase 20D review packet envelope is closed.
- Phase 20E review decision options are closed.
- Phase 20F read-only review decision receipt template is closed locally.
- Phase 20G read-only proposal review receipt validation is closed locally.
- Phase 20H read-only copy block rendering is closed locally.
- Phase 20I read-only copy block validation is closed locally.
- Phase 20J read-only export intent/safety gate is closed locally.
- Phase 20K explicit export-file workflow is bypassed and remains future/non-goal unless a real user need appears.
- Phase 21A–21F, 22A, and 22B are closed. D067 superseded. **D068 closed under `be82763`** (PR #23 squash; reviewed head `4b259c9`). Slice 0B.1 repaired stale active pre-merge wording; historical events unchanged.

Active streams:
- coding: D072 runtime, restart, adversarial, default-parameter, and portable-export slices are green offline; exact-commit persistent live closure remains the blocking gate.
- research: closed; direct write remains NO-GO and controller-materialized artifact execution remains the selected seam.
- writing: post-close custody correction + score/roadmap alignment; historical D071 closure event remains preserved and superseded.
- review: functional validation/replay passed at run time, but post-cleanup object/ref/evidence retention failed audit.

Scope boundary:
- D068 public contract kernel is frozen on main under `be82763` (no delivery actor, no public run CLI).
- D070-A1/D072 remain the private walking-slice lineage and custody substrate. D073 REPLACE+CLOSE must leave one host-neutral production runtime root, no production import from `internal/d069`, and no active ToolLauncher/PowerShell closure path.
- D070 uses authenticated Codex read-only structured output followed by controller validation/materialization. Direct AO filesystem write, sandbox bypass, generic `ExecutionProvider`, and a D069 compatibility adapter are rejected.
- Content is not sealed by RunSpec. Path is single-literal `scope.allow`; semantic acceptance is established by the exact trusted validation command. A1 used exact bytes historically, while D071 validates behavior rather than one canonical implementation.
- D064–D066 objects are historical/read-only guidance only — not load-bearing authority inputs.
- Original-intent deviation is explicit: the implemented MVP specification says the harness does not launch agents and requires no network/model API; Phase 23A is a deliberate post-MVP execution-custody expansion. Product identity is now explicitly re-chartered as a local authority-bound agent execution-custody harness; the lightweight Markdown MVP remains historical shipped scope.
- Process-tree timeout custody shipped in A1; broader concurrency/cancellation remains deferred because D071 exposed a persistence problem, not an overlap/cancellation problem.

Relevant decisions:
- D046 (2026-06-30): Phase 18 read-only response handoff closure.
- D047 (2026-06-30): Superseded follow-on action/proposal closure.
- D048 (2026-06-30): Phase 19A read-only next-action routing corrective split closure.
- D049 (2026-06-30): Phase 19B read-only next-action brief closure.
- D050 (2026-06-30): Phase 20A read-only proposal draft packet closure.
- D051 (2026-06-30): Phase 20B read-only proposal validation closure.
- D052 (2026-06-30): Phase 20C read-only proposal review gate closure.
- D053 (2026-06-30): Phase 20D read-only proposal review packet envelope closure.
- D054 (2026-06-30): Phase 20E read-only proposal review options closure.
- D055 (2026-07-01): Phase 20F read-only proposal review decision receipt template closure.
- D056 (2026-07-01): Phase 20G read-only proposal review receipt validation closure.
- D057 (2026-07-01): Phase 20H read-only proposal review copy block closure.
- D058 (2026-07-02): Phase 20I read-only proposal review copy block validation closure.
- D059 (2026-07-02): Phase 20J read-only proposal review export intent and safety gate closure.
- D060 (2026-07-02): Phase 21A/21B approved manual-work packet closure and Phase 20K bypass.
- D061 (2026-07-02): Phase 21C approved packet materialization closure.
- D062 (2026-07-03): Phase 21D approved packet artifact verification closure.
- D063 (2026-07-03): Phase 21E read-only operator execution plan closure.
- D064: Phase 21F closed (`2fedfd4`).
- D065: Phase 22A-H closed (`02d9c59`).
- D066: Phase 22B closed (`f926868`).
- D067: superseded; archive `fb40d18`.
- D068: **closed** under squash `be82763` (PR #23; reviewed head `4b259c9`; base `f926868`).
- D069: **closed** under squash `e8e7713` (PR #24; reviewed head `245fa3d`; base `5afe075`).
- D070-A0 decision: direct worker-write seam **NO-GO**; controller-materialized artifact seam **GO**.
- D070-A1: **transport/custody closed** under audit-hardening commit `8ebe690` on controller-materialized Codex `:read-only` artifacts (provider `meta-harness-ao-codex` / `d070-ao-artifact-v1`).
- D071: **functional child execution PASS; terminal custody closure superseded** by `docs/ops/audits/d071-post-close-custody-audit.json`.
- D072: **custody substrate implemented; ToolLauncher-specific live closure failed and is superseded** — `5d677a8` passed the 116-file native suite, then one live AO artifact failed trusted default-parameter validation before terminal publication. The create-only failed root is retained and must not be reused. Audit: `docs/ops/audits/d072-exact-commit-live-gate-audit.json`.
- D073: **approved — Functional Custody Replacement Slice**. Pull REPLACE forward and absorb D072 closure into one host-neutral real-child gate. Require live AO count one → VERIFIED, normal exit, fresh-process tool-canary REPLAY with AO count zero, independent portable verification, and leakage scan; delete the former Windows/ToolLauncher/phase-lineage production path in the same change, with no compatibility pair.
- Product re-charter: **decided now**, not deferred. Meta-Harness post-MVP direction is a local authority-bound agent execution-custody harness; the lightweight Markdown-only MVP remains historical and supported as the shipped surface, not the governing end-state.

Pre-D072 audit score baseline (2026-07-12; historical, before the current implementation):
- overall product flow: **7.6/10**
- meaningful functional execution: **8.1/10**
- Phase 23A execution custody: **7.0/10**
- trusted runtime custody: **6.2/10**
- AO verified integration: **8.7/10**
- durable child-result custody: **1.2/10**
- graceful terminal replay: **0.5/10**
- independently portable evidence: **3.2/10**
- reusable multi-child core: **2.5/10**
- CI/test truth integrity: **6.8/10**
- engineering health: **8.1/10**
- roadmap honesty: **9.7/10**
- continuity with original MVP: **4.0/10**
- alignment with re-chartered direction: **8.8/10**

Current audit score (2026-07-14; after exact-commit live failure and roadmap correction):
- overall product flow: **7.4/10**
- meaningful functional execution: **8.0/10**
- Phase 23A execution custody: **7.6/10**
- trusted runtime custody implementation: **7.8/10**
- live closure evidence: **4.8/10**
- AO verified integration: **8.7/10**
- durable child-result custody: **6.8/10**
- graceful terminal replay: **7.2/10**
- independently portable evidence: **7.0/10**
- reusable multi-child core: **2.5/10**
- CI/test truth integrity: **5.9/10**
- engineering health: **8.0/10**
- roadmap honesty after this audit: **9.8/10**
- continuity with original MVP: **3.8/10**
- alignment with re-chartered direction: **8.4/10**

Score interpretation:
- The custody architecture earns material implementation credit because adversarial replay, manifest-last publication, tool canaries, and portable verification pass offline.
- Closure evidence remains below midpoint because the exact live candidate never reached VERIFIED, terminal publication, replay, or export.
- CI/test truth integrity drops because the complete deterministic suite passed while the live artifact violated the same stated optional-parameter behavior; the suite proves the controller against known-good bytes, not live model compliance.
- The roadmap score rises only because the coupling and pivot are now explicit; no capability score is inflated by the decision change.

Blockers:
- No host-neutral real child has yet completed the combined D073 live custody gate.
- No live candidate has yet reached `VERIFIED` AO-count-one → normal process exit → fresh-process `REPLAY` AO-count-zero → independently verified portable export under the replacement runtime.
- The active private runtime still hardcodes Windows PowerShell, `scripts/utils/CheckShortcut.ps1`, D071-specific argv, phase-numbered module identity, and production imports from `internal/d069`.
- The deterministic suite does not independently establish live model compliance with a sealed functional objective; D073 must keep a live dogfood gate while making its objective and validator host-neutral and narrowly reliable.
- Direct Codex workspace writes remain NO-GO on this host.

Last verified:
- Historical D071 implementation commit `74f8ac17e66aafb86546227ec8ec93f1f48f6f17` reported live `IMPLEMENTATION_VERIFIED`, AO count one, and in-process replay, but child commit `9f41bbbb28d89301223292bc5aea11039fba47bb` and its claimed ref remain absent after historical cleanup.
- D072 semantic truth, focused D070 runtime, D072 fresh-controller replay, graceful process restart, adversarial custody, default-parameter validation, and portable export/independent verification pass offline on the current working tree.
- The graceful process restart proof executes in process 1, closes normally, exits, starts process 2 from retained repository/state, replays after receipt expiry with absolute nonexistent Codex/validator paths, and reports AO count zero.
- Abrupt termination recovery, stale-owner recovery, partial-publication recovery, and filesystem-crash durability are not D072 claims.
- The portable verifier starts with the exact prerequisite base, verifies the thin bundle, fetches the result ref, proves parent equality and changed-path scope, compares result bytes, recomputes exported hashes, and reruns the PowerShell validator.
- Quality, sync, quick read-only readiness, and `git diff --check` pass; the existing public CLI-count warning remains.
- The persistent live D072 test is intentionally skipped unless `D072_LIVE_TOOLLAUNCHER=1` and a clean tracked implementation commit are both present.
- `networkPolicy: denied` remains trust-based, not OS firewall isolation.

Next action:
Execute D073 as one no-compatibility replacement slice. Select one real non-ToolLauncher child with an existing host-neutral test command and one useful single-file objective. Create the active bounded-repository-change skill, sealed host-neutral validation-command capsule, thin child adapter, and sole production custody runtime. Migrate the D072 receipt-first replay, lazy binding, manifest-last evidence, fail-closed state checks, fresh-process replay, export, and leakage invariants. The exact live candidate must produce AO count one and `VERIFIED`; after normal close and process exit, a second process with unusable execution-tool paths must produce `REPLAY` and AO count zero; independent portable verification must pass. In the same change, delete ToolLauncher/PowerShell/CheckShortcut active fixtures and validation, the Windows classifier, phase-numbered production identity, all production imports from `internal/d069`, and the former path. Preserve historical audits only. Then D074 PROVE adds a third child through one existing-skill example and one end-to-end test only; afterward DELETE unsupported surface and DECIDE a public execution surface only after repeated real use.

Updated:
2026-07-14
