# Worker Done / PM Brief Contract

Status: Template
Purpose: capture a worker report artifact while keeping the final user-facing closure concise: what changed, why it matters, blockers, decision needed, next action, evidence, and accountability before handoff or reconciliation.

## Information Channels

- `PM_CLOSURE`: adaptive human-facing status and decision surface.
- `ORCHESTRATOR_HANDOVER`: dense continuation state for the next orchestrator.
- `WORKER_REPORT`: exhaustive execution, validation, accountability, and evidence record.

These channels are separate outputs. A worker report supplies evidence; it is not the normal chat answer. An orchestrator handover preserves continuation state; it is not a PM closure or an audit packet.

## Worker Report Artifact

```text
Outcome: <DONE|PARTIAL_WITH_EXPLICIT_SCOPE|REJECTED>
Round: <round or not recorded>
Progress: <before>/100 -> <after>/100, or not recorded
Confidence: <0-10>/10, or not recorded
Worker: <worker-id>
Stream: <coding|research|writing|review|provider_probe|validation|other>
Task: <bounded task>
Phase: <intake|plan|work|verify|synthesize|handoff|lookback>
Updated: <ISO timestamp>
Ship gate tier: <FAST|REVIEW|SLOW|BLOCK>
Task resolution: <ship|blocked|decision-needed|follow-up-queued>

## What changed

<one paragraph answering what actually changed, what artifact/result was produced, and practical effect>

## Why it matters

<one short paragraph naming current top-level state and PM/product effect>

## What is blocked

<blocker + exact reason, or none>

## What decision is needed

Decision needed from user: <approve|redirect|hold>
Options considered: <option list or none>
Scope limit: <allowed boundary>
Stop rule: <condition that halts the next move>

## Next action

Recommended next action: <one next move>
Goal: <goal>
Allowed scope: <allowed scope>
Forbidden scope: <forbidden scope>

## Validation / evidence

Passed:
- <check or none>
Skipped:
- <check + reason, or none>
Evidence artifacts:
- <path/report/commit/hash/zip or none>

## Accountability

requested_work_type: <docs|code|test|provider_probe|commit|validation|execution|data_output>
actual_work_type_performed: <docs|code|test|provider_probe|commit|validation|execution|data_output|none>
credentials_touched: <true|false>
provider_access_touched: <true|false>
data_output_created: <true|false>
commit_created: <true|false>
remaining_blocker: <blocker or none>
ship_gate_tier: <FAST|REVIEW|SLOW|BLOCK>
task_resolution: <ship|blocked|decision-needed|follow-up-queued>
```

## User-Facing Closure

Do not paste the full worker report into chat unless the user asks for evidence, an audit packet, or the artifact itself. Normal final chat is a concise, plain-language closure, not a worker-report or PM artifact.

Use one canonical user-visible closure policy, separate from machine classifier tiers, worker evidence fields, and internal handover schemas. Include only applicable semantic items, in this order: result and practical effect; reason or nearest evidence when needed to interpret the result; next action when work remains; the highest-priority user decision when one is required. Omit empty or `none` items. Use one short paragraph for simple completion; otherwise use no more than four applicable semantic items. Labels are optional.

This budget applies only to normal human-facing closure. Requested audits, reviews, safety evidence, and orchestrator handover state are separate surfaces and may expand as needed without converting `PM_CLOSURE` into an audit packet.

Decision-needed questions must use exactly one owner tag:

- `Decision needed (human: taste/acceptance): <question>`
- `Decision needed (expert: domain knowledge): <question>`
- `Decision needed (expert: system methodology): <question>`

Use `Approval needed: <bounded authority, scope, and consequence, or none>` for authority, credentials, publishing, provider access, execution permission, protected-boundary access, and commit or rollout permission. These are approval boundaries or blockers, not expert-decision tags.

Hide internal labels (`PARTIAL_WITH_EXPLICIT_SCOPE`, `Ship gate tier`, `SAW`, `ClosurePacket`, `manifest_hash`, `requested_work_type`), hashes, absolute paths, file allowlists, command logs, and accountability booleans unless they are the requested deliverable or the user asks for evidence.

If the user asks for approval text, output only the pasteable approval block without an audit recap.

## Orchestrator Handover

`ORCHESTRATOR_HANDOVER` has no arbitrary line cap. Preserve dense continuation state without turning it into user-facing closure:

```text
CurrentTruth:
MaterialDelta:
Validation: <passed, failed, skipped, and nearest evidence>
OpenRisks: <severity, impact, owner, disposition>
BlockedBy:
DecisionQueue:
- <decision tag, question, evidence required, unlock, and owner>
NextExecutableAction:
Boundaries: <allowed, forbidden, stop rules>
HumanAuditState: <not-needed|pending|accepted|rejected|revise>
HumanAuditScope:
Provenance: <source head, artifact paths, artifact hashes, timestamps>
```

Keep all material decisions in `DecisionQueue`; expose only the highest-priority tagged question in `PM_CLOSURE`. Permission and authority boundaries remain `Approval needed` or `Blocked` rather than decision-owner tags.

## Identity

```text
RoundID: <round-id>
ScopeID: <scope-id>
WorkerID: <worker-id>
Stream: <coding|research|writing|review|provider_probe|validation|other>
Owner: <name or role>
Date: <YYYY-MM-DD>
```

## Compatibility Metadata

```text
RequestedWorkType: <docs|code|test|provider_probe|commit|validation|execution|data_output>
ActualWorkTypePerformed: <docs|code|test|provider_probe|commit|validation|execution|data_output|none>
FilesChanged:
- <path or none>
EvidenceArtifacts:
- <path/report/commit/hash/zip or none>
```

## Blockers And Next Action

```text
WhatIsStillBlocked: <blocker + exact reason, or none>
RecommendedNextRound: <round or none>
Goal: <goal>
AllowedScope: <allowed scope>
ForbiddenScope: <forbidden scope>
NextOwner: <orchestrator|reviewer|stream owner>
```

## Worker Accountability

```text
requested_work_type: <docs|code|test|provider_probe|commit|validation|execution|data_output>
actual_work_type_performed: <docs|code|test|provider_probe|commit|validation|execution|data_output|none>
credentials_touched: <true|false>
provider_access_touched: <true|false>
data_output_created: <true|false>
commit_created: <true|false>
remaining_blocker: <blocker or none>
```

Rules:
- The first non-empty line of generated worker-report artifacts must be `Outcome: <DONE|PARTIAL_WITH_EXPLICIT_SCOPE|REJECTED>`.
- The first visible fields must remain `Outcome`, `Round`, `Progress`, and `Confidence`, with no title before them.
- Generated worker reports must include `Ship gate tier` and `Task resolution` immediately after `Updated`.
- `SLOW`, `Ship gate tier`, and `ship_gate_tier` remain valid in worker-report accountability and evidence fields; they must not appear in normal chat or `PM_CLOSURE` output.
- The first section after metadata must answer what actually changed.
- The Ship-Fast Decision Gate concept is visible in top metadata and folded into `## What decision is needed`: one decision, options considered, scope limit, and stop rule.
- The worker report is an artifact. The final chat answer must use the adaptive user-facing closure unless the user asks for the artifact or evidence; requested audits and orchestrator handovers remain separate surfaces.
- Final chat answers must not lead with `Outcome`, `Round`, `Progress`, `Confidence`, `Ship gate tier`, or `Task resolution`.
- Final chat answers omit empty fields such as `Decision needed: none` and hide hashes, absolute paths, allowlists, command logs, and accountability booleans unless requested.
- Approval text requests return only pasteable approval text, not the worker report or audit recap.
- Do not begin with `# Worker PM Brief`, `# Worker Report`, numbered logs, SAW Verdict, ClosurePacket, or command logs.
- Do not lead with command logs, reviewer chatter, or numbered SAW/logsheet detail.
- SAW Verdict, ClosurePacket, ClosureValidation, and SAWBlockValidation are evidence only and must appear under `## Validation / evidence` or evidence artifacts.
- Evidence artifacts are files, reports, commits, hashes, or zips; they are not the same field as passed validations.
- If requested work was not performed, set `Outcome: PARTIAL_WITH_EXPLICIT_SCOPE` or `REJECTED` and name the blocker.
- Missing `requested_work_type` or `actual_work_type_performed` fails closed.
- `requested_work_type` cannot be `none`.
- `actual_work_type_performed: none` requires `Outcome: PARTIAL_WITH_EXPLICIT_SCOPE` or `REJECTED` and a blocker.
- `PARTIAL_WITH_EXPLICIT_SCOPE` and `REJECTED` require a blocker that is not empty or `none`.
- Silent docs-only fallback from code, test, provider_probe, commit, validation, execution, or data_output work is forbidden.
