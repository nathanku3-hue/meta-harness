# Worker Done / PM Brief Contract

Status: Template
Purpose: capture a worker report artifact while keeping the final user-facing closure concise: what changed, why it matters, blockers, decision needed, next action, evidence, and accountability before handoff or reconciliation.

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

Do not paste the full worker report into chat unless the user asks for evidence, an audit packet, or the artifact itself. For normal final answers, translate the artifact into at most four plain-language lines:

```text
Status: <what passed or changed, and what is blocked>
Why: <one plain reason>
Next: <one safe next action>
Decision needed: <approve, reject, redirect, or none>
```

Hide internal labels (`PARTIAL_WITH_EXPLICIT_SCOPE`, `Ship gate tier`, `SAW`, `ClosurePacket`, `manifest_hash`, `requested_work_type`), hashes, absolute paths, file allowlists, command logs, and accountability booleans unless they are the requested deliverable or the user asks for evidence.

If the user asks for approval text, output only the pasteable approval block without an audit recap.

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
- The first section after metadata must answer what actually changed.
- The Ship-Fast Decision Gate concept is visible in top metadata and folded into `## What decision is needed`: one decision, options considered, scope limit, and stop rule.
- The worker report is an artifact. The final chat answer must use the shorter user-facing closure unless the user asks for the artifact or evidence.
- Final chat answers must not lead with `Outcome`, `Round`, `Progress`, `Confidence`, `Ship gate tier`, or `Task resolution`.
- Final chat answers hide hashes, absolute paths, allowlists, command logs, and accountability booleans unless requested.
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
