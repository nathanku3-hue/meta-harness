# Status

Goal:
D075 private operator use is closed under immutable candidate `cd63e52` after the exact 113-file native suite and retained DevSpace/Node and Fluxara/Python operations passed. D076 now authorizes one installed-package execution vertical slice: `meta-harness execute --request <absolute-path> [--json]`. Closure must run from an isolated `npm pack` installation, accept a novel user-authored bounded-change request rather than a tracked fixture, and retain VERIFIED → expiry+60s zero-spawn REPLAY → independent validation/leakage PASS evidence. A source-checkout wrapper is not closure. DELETE remains blocked until D076 closes.

Phase:
in_progress

Current truth:
Phases 16–21E remain closed as previously recorded through D063. Phase 21F closed under D064 (`2fedfd4`). Phase 22A-H closed under D065 (`02d9c59`). Phase 22B closed under D066 (`f926868`). Phase 23A-PR1 (D067) is superseded and archived at `fb40d18` on `archive/23a-pr1-d067-fb40d18`. **D068 closed under squash `be82763` (PR #23; reviewed head `4b259c9`; base `f926868`; tree-object equality PASS; ancestry PASS).** **D069 closed under squash `e8e7713` (PR #24; reviewed head `245fa3d`; base `5afe075`; tree-object equality PASS; ancestry PASS).** D070-A0.1 NO-GO / A0.2 GO remain binding. **D070-A1 transport/custody slice closed** under audit-hardening commit `8ebe690`. **D071 functional execution passed under `74f8ac1`, but its closure claim remains superseded by the post-close custody audit:** sealed objective → authenticated Codex `:read-only` → controller commit → Windows PowerShell 5.1 validator (missing+valid+corrupt) → live `IMPLEMENTATION_VERIFIED` + in-process replay against isolated ToolLauncher `7fab419f20ba` / `scripts/utils/CheckShortcut.ps1`. That historical live test deleted both the isolated child repository and its state root in `finally`; the claimed child commit `9f41bbbb…`, create-only ref, AO metadata, change artifact, schema, terminal journal, assessment, and receipt are not retained. The audit also traced restart failure to authorization-before-lookup combined with a time-varying readiness digest. Audit evidence: `docs/ops/audits/d071-post-close-custody-audit.json`. **D072 custody mechanics are implemented offline, but the ToolLauncher-specific closure procedure is superseded:** exact candidate `5d677a8` passed native Windows Node 25 `npm test` across 116 files with zero failures, then its retained live root failed in process 1 after one successful AO spawn because the generated PowerShell artifact mishandled an omitted string parameter and failed trusted validation before terminal publication. This neither closes nor disproves the custody protocol; it proves the gate still conflates model output quality, legacy Windows semantics, and custody. Audit: `docs/ops/audits/d072-exact-commit-live-gate-audit.json`. **D073 closed under exact implementation candidate `87de018`:** the 111-file native Windows Node 25 suite passed with zero failures; live Fluxara process 1 spawned the authenticated agent once and reached `VERIFIED` at child commit `2f2e6156`; after normal exit, process 2 used unusable execution-tool paths and returned `REPLAY` with zero spawns; portable export independently reconstructed the result, reran both sealed validation commands, and passed leakage scanning across 16 files. The sole production runtime is `internal/execution-custody`; the active ToolLauncher/PowerShell/CheckShortcut path, Windows classifier, phase-numbered production identity, and production imports from `internal/d069` are deleted with no compatibility or dual runtime. Closure audit: `docs/ops/audits/d073-functional-custody-replacement-audit.json`. **Post-close audit found two bounded forward gaps, not a D073 closure reversal:** the production runtime was example-driven, but the live integration plumbing remained Fluxara/Python/D073-specific, and replacement tests had lost later-than-expiry replay coverage. Post-close audit: `docs/ops/audits/d073-post-close-forward-audit.json`. **D075 is closed under exact immutable candidate `cd63e5295b8bbde1afaf1ab5d991aadc13cc0442` / tree `5b15623e7646da18e2417bd38767ff3f5be54547`:** `internal/execution-custody/operator.js` owns the single example-driven orchestration path outside tests. It requires a clean immutable Meta-Harness candidate before root creation; accepts only tracked bounded-repository-change examples and create-only roots directly under `.meta-harness/local/custody`; binds the exact request bytes; performs exact depth-one authority preparation, fresh-process VERIFIED, receipt-derived expiry+60s REPLAY with unusable tools and zero spawns, portable export, independent validation, leakage verification, and a create-only `operator-receipt.json`; then rechecks candidate commit/tree/cleanliness. `scripts/operate-execution-custody.js` is intentionally unregistered in `bin/`, package scripts, and exports. The former test-owned orchestration, child, and verifier are now thin adapters over the production-owned path. Focused coverage passes 18 with two authenticated gates skipped; the exact candidate native suite passed 113 files with zero failures and exit 0 while commit, tree, and tracked cleanliness remained unchanged. Distinct retained operations now prove repeated use: `d075-devspace-01` produced VERIFIED child `47c0d016`, expiry+60s zero-spawn REPLAY, independent Node validation, and leakage PASS; `d075-fluxara-01` produced VERIFIED child `c0032669`, the same replay properties, independent Python validation under Python 3.14.4, and leakage PASS. Both dirty source operator checkouts were unchanged because working-tree bytes were never authority. Observed friction was explicit local binding, synchronous latency, one pre-launch PowerShell-wrapper correction, and a connector duplicate-suite-wrapper race; none was an operator-seam defect or candidate mutation. Audits: `docs/ops/audits/d075-private-operator-functional-slice-audit.json` and `docs/ops/audits/d075-private-operator-closure-audit.json`.

**D076 is authorized as the installed-package execution surface:** audit found that the D075 seam is reusable custody machinery but still a source-checkout fixture runner. It accepts only examples tracked below `.agents/skills/bounded-repository-change/examples`, resolves production code from `internal/` and `scripts/`, requires Meta-Harness Git metadata and a clean candidate, while `package.json` publishes only `bin/`, `lib/`, product/SOP docs, templates, and README. Merely registering the private script would therefore expose an internal ceremony without shipping the re-chartered product. D076 must provide exactly one public command, `meta-harness execute --request <absolute-path> [--json]`, from an isolated packed installation with no source checkout or `.git` dependency; consume one versioned public request that binds a sealed approved bounded change not present in the two tracked fixtures; prove exact shallow authority, one authenticated spawn → VERIFIED, retained custody, expiry+60s zero-spawn REPLAY, portable independent validation, leakage PASS, and a create-only public receipt; and replace rather than preserve the private request/script path. No alias, backward compatibility, provider registry, concurrency, delivery, workflow, daemon, queue, dashboard, or broad DELETE is authorized. Audit: `docs/ops/audits/d076-public-execution-surface-decision-audit.json`.

**D074 implementation was audit-accepted before candidate execution:** the DevSpace Node example binds commit `00952c05f01248773a90cd293aed528672eb6f1b`, tree `65e249664f7146e7bff6c36d530f3de1cd0068e4`, and only `scripts/dev-server.mjs`; one phase-neutral shared live workflow now serves Fluxara and DevSpace; Python dependency binding remains only at the Fluxara edge; both generic and live process-2 clocks derive from the stored receipt and advance beyond expiry; child authority uses an empty repository plus exact depth-one fetch of the pinned commit, with no remote and one visible revision. Audit found and repaired an under-validation defect: the initial DevSpace capsule could have accepted a command-exporting stub that deleted the restart/watcher/shutdown lifecycle, so the sealed validator now also binds preservation landmarks for restart delay, crash restart, termination fallback, recursive watching, and shutdown. The exact shallow clone, focused expired replay, strengthened validator, 8-test truth contract, and complete 112-file native Windows Node 25 suite passed before candidate creation. **First immutable D074 candidate `87472e1` / tree `7a447d81` then passed the exact native suite again: 112 files, zero failures, exit 0. Its single DevSpace-only live attempt spawned the authenticated agent once, produced terminal `IMPLEMENTATION_VERIFIED` at child commit `b821c485`, retained the create-only durable ref, passed the receipt-derived later-than-expiry zero-spawn replay assertions, produced a leakage-clean portable export, and left the primary shallow clone clean at the pinned base. The end-to-end test still failed after export because the independent verifier fetched the shallow prerequisite object without anchoring it to a local ref before `git bundle verify`; Git reported a disconnected prerequisite. Candidate `87472e1` and root `.meta-harness/local/custody/custody-devspace-87472e187a8d-5c3362472026` are preserved and must not be rerun or amended. A two-file test-only repair anchors `refs/verify/base`, passes a real shallow thin-bundle regression, and independently re-verifies the retained export with both Node commands exit 0 and leakage PASS. **D074 is now closed under exact repair candidate `4ad92f0bf0643a48bb90ab86ee3fe7f9fd31184b` / tree `064689e945889c1ee2d5b4a132d6c7a12cf2d706`: native Windows Node `v25.2.1` `npm test` passed 112 files with zero failures; the one DevSpace-only live gate exited 0 after one authenticated spawn produced terminal VERIFIED child `30ad240b`, a create-only durable ref, normal controller close, process-2 REPLAY exactly 60 seconds after receipt expiry with unusable tools and zero spawns, independent two-command Node validation, and leakage PASS across 16 exported files. The clean primary child clone remained at pinned base `00952c05` with one visible shallow revision and no remote.** Audits: `docs/ops/audits/d074-pre-candidate-functional-slice-audit.json`, `docs/ops/audits/d074-candidate-87472e1-live-failure-audit.json`, and `docs/ops/audits/d074-cross-ecosystem-custody-closure-audit.json`. Marker path remains deleted. Quant remains excluded. `lib/contracts/*` remains frozen.

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
- coding: D076 installed-package execution is authorized; implementation has not started. The slice must ship one `execute` command from `npm pack`, not register the source-only D075 script.
- research: closed; direct write remains NO-GO and controller-materialized artifact execution remains the selected seam.
- writing: D076 decision audit, installed-package closure boundary, updated scores, and explicit roadmap deviation; all D075 retained evidence remains preserved.
- review: D075 closure remains valid. D076 must prove one novel public request from an isolated package, exact custody/replay/verification, no dual private/public path, and no speculative framework growth.

Scope boundary:
- D068 public contract kernel is frozen on main under `be82763` (no delivery actor, no public run CLI).
- D073 left one host-neutral production runtime root at `internal/execution-custody`, zero production imports from `internal/d069`, and no active ToolLauncher/PowerShell closure path.
- D070 uses authenticated Codex read-only structured output followed by controller validation/materialization. Direct AO filesystem write, sandbox bypass, generic `ExecutionProvider`, and a D069 compatibility adapter are rejected.
- Content is not sealed by RunSpec. Path is single-literal `scope.allow`; semantic acceptance is established by the exact trusted validation command. A1 used exact bytes historically, while D071 validates behavior rather than one canonical implementation.
- D064–D066 objects are historical/read-only guidance only — not load-bearing authority inputs.
- Original-intent deviation is explicit: the implemented MVP specification says the harness does not launch agents and requires no network/model API; Phase 23A is a deliberate post-MVP execution-custody expansion. Product identity is now explicitly re-chartered as a local authority-bound agent execution-custody harness; the lightweight Markdown MVP remains historical shipped scope.
- Process-tree timeout custody shipped in A1; broader concurrency/cancellation remains deferred because no real overlap/cancellation need has been observed.
- D074 must use a different validation executable family from Fluxara. Another Python child would not prove the example/adapter seam.
- Test-only helper parameterization is allowed in D074; copy-pasting a second child-specific live harness is rejected.
- D075 OPERATE is complete through the unregistered private seam. D076 explicitly authorizes a stable public execution surface only as an installed-package functional slice; source-checkout command registration is rejected. DELETE remains after D076 closure.

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
- D073: **closed under `87de018` — Functional Custody Replacement Slice**. Fluxara live process 1 reached VERIFIED with one spawn; fresh process 2 replayed with unusable tool paths and zero spawns; independent portable verification and leakage scanning passed; the former Windows/ToolLauncher/phase-lineage path was deleted without compatibility.
- D074: **closed under `4ad92f0` — Cross-Ecosystem Reuse Proof**. DevSpace pinned base `00952c05` / tree `65e24966` produced verified child `30ad240b` through one authenticated spawn; exact depth-one authority remained clean with one revision and no remote; process 2 replayed 60 seconds after expiry with unusable tools and zero spawns; independent Node validation and leakage scanning passed. Failed candidate `87472e1` and both create-only roots remain retained. Production runtime, skill, kernel, CLI, package, and lockfile were unchanged.
- D075: **closed under `cd63e52` — Private Operator Use Gate**. The exact 113-file suite passed; distinct retained DevSpace/Node and Fluxara/Python operations each used exact shallow authority, one authenticated spawn → VERIFIED, expiry+60s zero-spawn REPLAY, independent validation, leakage PASS, unchanged source checkout, and a create-only operator receipt. Public CLI/package/contracts/examples remain frozen.
- D076: **authorized — Installed-Package Execution Surface**. Add exactly one command, `meta-harness execute --request <absolute-path> [--json]`, and close only from an isolated `npm pack` installation performing one novel user-authored bounded change with retained custody/replay/independent-verification evidence. Replace the private request/script path; no compatibility or dual surface.
- Product re-charter: **decided now**, not deferred. Meta-Harness post-MVP direction is a local authority-bound agent execution-custody harness; the lightweight Markdown-only MVP remains historical shipped scope until D076 proves the replacement from the installed package.

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

Current audit score (2026-07-14; D075 closed and D076 installed-package execution authorized):
- overall product flow: **8.8/10**
- meaningful functional execution: **9.2/10**
- Phase 23A execution custody: **9.3/10**
- trusted runtime custody implementation: **9.0/10**
- live closure evidence: **9.4/10**
- AO verified integration: **9.2/10**
- durable child-result custody: **9.2/10**
- graceful terminal replay: **9.2/10**
- independently portable evidence: **9.0/10**
- reusable multi-child core: **8.8/10**
- private operator usability: **8.7/10**
- installed public execution usability: **2.0/10**
- CI/test truth integrity: **8.8/10**
- engineering health: **8.9/10**
- roadmap honesty after this audit: **9.9/10**
- continuity with original MVP: **3.1/10**
- alignment with re-chartered direction: **9.8/10**

Score interpretation:
- D075 materially raises functional execution and operator usability because the same production-owned path completed retained DevSpace/Node and Fluxara/Python operations outside tests.
- Custody, replay, and live evidence are now strong: both operations retained exact shallow authority, one-spawn VERIFIED children, expiry+60s zero-spawn REPLAY, independent validation, leakage PASS, and create-only receipts.
- Reuse rises because one host-neutral workflow spans two language/validation ecosystems without a provider registry or copied runtime.
- Installed public execution remains **2.0/10** because the working seam is not in the npm package, depends on source-tree-only roots and Meta-Harness Git metadata, and accepts only two tracked fixture examples. This is the dominant remaining product gap.
- Portable evidence still means same-host independent reconstruction and validation, not a self-contained third-party dependency environment.
- CI/test truth rises from the exact 113-file candidate suite, separate closure worktree suite, retained receipt hash checks, and explicit preservation of failed/successful roots; remote CI remains absent.
- Roadmap honesty rises because the prior generic DECIDE gate is sharpened aggressively: a source-only wrapper cannot close D076; only an isolated installed-package operation on a novel request can.
- Original-MVP continuity declines slightly because the product is explicitly moving from Markdown visibility to a shipped mutative agent-execution command. This remains deliberate, not silent drift.

Blockers:
- D073 has no remaining local closure blocker.
- D074 has no remaining local closure blocker. Failed candidate `87472e1` and successful candidate `4ad92f0` remain immutable with both create-only roots retained.
- The DevSpace operator checkout remains dirty by design; D074 authority came only from the exact shallow fetch of pinned commit `00952c05...`, never working-tree bytes.
- Ubuntu CI and remote publication remain pending because no push or remote action was authorized.
- Direct Codex workspace writes remain NO-GO on this host.
- D075 has no remaining local blocker. Repeated private operator usability is proved across DevSpace/Node and Fluxara/Python.
- D076 is the active gate. Its blockers are product boundaries, not custody mechanics: the current operator is fixture-only, source-checkout-only, excluded from the npm package, and coupled to Meta-Harness Git cleanliness. DELETE remains blocked until D076 closes.

Last verified:
- Historical D071 implementation commit `74f8ac17e66aafb86546227ec8ec93f1f48f6f17` reported live `IMPLEMENTATION_VERIFIED`, AO count one, and in-process replay, but child commit `9f41bbbb28d89301223292bc5aea11039fba47bb` and its claimed ref remain absent after historical cleanup.
- Exact D073 candidate `87de018b06cb788eedbc8d3cf9e0737989702471` / tree `1ecfc71dc28f67e62832aa594d4efe7a5c4548f1` passed native Windows Node `v25.2.1` `npm test`: 111 files, zero failures, exit 0.
- The final D074 audit-accepted worktree passed native Windows Node `v25.2.1` `npm test`: 112 files, zero failures, exit 0, 256.8 seconds; immutable candidate `87472e187a8d228bbf0a5b51167bb5969aa4dfb5` then passed the same 112-file suite with zero failures and exit 0 in 191.0 seconds. After its live failure, the bounded repair/truth worktree passed the complete native suite again: 112 files, zero failures, exit 0, 188.8 seconds, with unchanged nine-path status. Exact repair candidate `4ad92f0bf0643a48bb90ab86ee3fe7f9fd31184b` / tree `064689e945889c1ee2d5b4a132d6c7a12cf2d706` then passed 112 files, zero failures, exit 0 in 190.5 seconds and remained clean.
- Exact D075 candidate `cd63e5295b8bbde1afaf1ab5d991aadc13cc0442` / tree `5b15623e7646da18e2417bd38767ff3f5be54547` passed native Windows Node `v25.2.1` `npm test`: 113 files, zero failures, exit 0; the final durable runner duration was 195.2 seconds and the candidate remained clean before and after. The complete closure-truth worktree suite also passed 113 files, zero failures, exit 0 in 181.6 seconds with the exact eight-path status and candidate identity unchanged.
- Retained root `.meta-harness/local/custody/d075-devspace-01-cd63e52` contains VERIFIED child `47c0d01671d6d69a9a9cc3f097f99ce9300fb74e`, durable ref `refs/meta-harness/attempts/de6c8718956fe5276466d8b77ae61de5a14668f3aa73e081e5764408e7b4d559`, terminal manifest `sha256:6ff77c811ac5626d7ca075fb6fa93f38c7003cbf0025a0ba526e212072d62d64`, expiry+60s zero-spawn REPLAY, export manifest `sha256:a4a3b98545aaf9a96d0c59e9625bb51f7e6135b1c90394583873a5ad39d75e81`, both Node validations exit 0, and leakage PASS.
- Retained root `.meta-harness/local/custody/d075-fluxara-01-cd63e52` contains VERIFIED child `c00326698c19e7cc096f45eca78ea0b54bb8e535`, durable ref `refs/meta-harness/attempts/d60da65c52fd6a4026fdd1672aafb41407def59104823df829588959d4260640`, terminal manifest `sha256:4eda210e73ac9b9ba4053905bdad9e75e925f4a9214f7720d6bd868a3a2acb20`, expiry+60s zero-spawn REPLAY, export manifest `sha256:5c659e24181121e0af2a647b19e129ab2e3b7725f0d9ad365055b4de7d28b68d`, both Python validations exit 0, and leakage PASS.
- Retained root `.meta-harness/local/custody/d073-fluxara-87de018b06cb-25704bfbcfd6` contains process-1 VERIFIED, process-2 zero-spawn REPLAY, terminal evidence, durable child ref, portable export, and independent verifier checkout.
- Fluxara child base `8548fe5460511c86ed312284b3712e17622134d2` remained the clean primary checkout; verified child commit is `2f2e6156b5b89726e4047a1118e2aebac5c55f27` and changed only `fluxara_core/demo.py`.
- The portable verifier proved exact parent equality, single-path scope, content equality, both validation commands exit 0, export manifest integrity, and leakage PASS across 16 exported files.
- Failed candidate roots for `1fa3e0e`, `b61109a`, and `f31b443` remain retained and were not reused.
- Abrupt termination recovery, stale-owner recovery, partial-publication recovery, and filesystem-crash durability are not D073 claims.
- The live replacement test is intentionally skipped unless `D073_LIVE_CUSTODY=1` and a clean tracked implementation commit are both present.
- Candidate `87472e1` retained one successful authenticated agent process (`spawnOrdinal=1`, exit 0), terminal `IMPLEMENTATION_VERIFIED`, child commit `b821c48548a0ce7faeb1ccbdb97c85af0b44a270`, exact parent `00952c05f01248773a90cd293aed528672eb6f1b`, one changed path, and durable ref `refs/meta-harness/attempts/4fa101470f79398df6a8896759c2c428e6d6d744064bc96105104a23cb8876a9`.
- Its process-2 input clock is `2026-07-14T12:29:22.121Z`, exactly 60 seconds after receipt expiry, with unusable agent and validator paths. The helper reached export only after asserting `REPLAY` and zero process-2 spawns.
- Its export manifest digest is `sha256:e19392949e88367145b300393988fdfe37d4ffef13d3b25113fbca620f865d95`; leakage scanning passed across 16 files. The repaired verifier reconsumed that retained export without agent/controller rerun, verified exact parent and path, reran both Node validation commands with exit 0, and returned leakage PASS.
- Successful root `.meta-harness/local/custody/custody-devspace-4ad92f0bf064-b2e76672f6b4` retains process-1 VERIFIED child `30ad240b0b709cd330132b978e096ccbc7620c1a`, durable ref `refs/meta-harness/attempts/babefc9946271112317c7119e5ae2d824a3b91fd5cb46bf5515c17eebbdb4680`, terminal manifest digest `sha256:ff8c695ecf57f94218f5c2c936ed2f4004c46b9117a6bc86a4de07804614ac7a`, process-2 REPLAY 60 seconds after expiry with zero spawns, and portable export digest `sha256:ec4f1b5f3d11a02a7df14d1023a733a4289f8afca928149b6c2ddda81622a348`.
- The successful independent verifier proved exact parent `00952c05f01248773a90cd293aed528672eb6f1b`, one changed path `scripts/dev-server.mjs`, both Node validation commands exit 0, and leakage PASS across 16 files. The primary child clone remained clean at the pinned base with one visible shallow revision and no remote.
- Generic and shared live workflows derive process 2 from `authorization-receipt.json`, advance 60 seconds beyond `expiresAt`, bind unusable agent and validation paths, and require `REPLAY` with zero spawns.
- The shared live helper contains no Fluxara, Python, or D073 identity; Python dependency probing remains only in the Fluxara live test edge.
- The DevSpace validator was strengthened during audit after a concrete defect was found: syntax/import/command checks alone could have certified a lifecycle-deleting stub. It now also binds restart, crash-delay, recursive watcher, termination fallback, and shutdown landmarks and passes a representative known-good implementation.
- `networkPolicy: denied` remains trust-based, not OS firewall isolation.

Next action:
Implement D076 as one installed-package execution vertical slice. Add exactly `meta-harness execute --request <absolute-path> [--json]`; replace the private request/script rather than preserving compatibility; package the required runtime; run from an isolated `npm pack` installation with no Meta-Harness `.git` or source-tree dependency; accept one versioned public request for a real bounded change not present in the tracked DevSpace/Fluxara fixtures; require exact shallow authority, one authenticated spawn → VERIFIED, retained child/ref, normal close, expiry+60s zero-spawn REPLAY with unusable tools, portable independent validation, leakage PASS, and a create-only public receipt. Create an immutable candidate and close separately. Do not add aliases, provider, compatibility, concurrency, delivery, recovery, daemon, queue, dashboard, or workflow frameworks. Do not begin broad DELETE until D076 closes.

Updated:
2026-07-14
