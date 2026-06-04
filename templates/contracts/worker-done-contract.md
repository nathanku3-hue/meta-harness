# Worker Done / PM Brief Contract

Status: Template
Purpose: capture a MECE PM/CEO-facing worker report: what changed, why it matters, blockers, decision needed, next action, evidence, and accountability before handoff or reconciliation.

## Worker Report Artifact

```text
# Worker PM Brief

Outcome: <DONE|PARTIAL_WITH_EXPLICIT_SCOPE|REJECTED>
Round: <round or not recorded>
Progress: <before>/100 -> <after>/100, or not recorded
Confidence: <0-10>/10, or not recorded
Worker: <worker-id>
Stream: <coding|research|writing|review|provider_probe|validation|other>
Task: <bounded task>
Phase: <intake|plan|work|verify|synthesize|handoff|lookback>

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
```

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
- The first non-empty line of generated worker-report artifacts must be `# Worker PM Brief`.
- The first visible fields after the title must remain `Outcome`, `Round`, `Progress`, and `Confidence`.
- The first section after metadata must answer what actually changed.
- The Ship-Fast Decision Gate concept is folded into `## What decision is needed`: one decision, options considered, scope limit, and stop rule.
- Do not begin with `# Worker Report`, numbered logs, SAW Verdict, ClosurePacket, or command logs.
- Do not lead with command logs, reviewer chatter, or numbered SAW/logsheet detail.
- SAW Verdict, ClosurePacket, ClosureValidation, and SAWBlockValidation are evidence only and must appear under `## Validation / evidence` or evidence artifacts.
- Evidence artifacts are files, reports, commits, hashes, or zips; they are not the same field as passed validations.
- If requested work was not performed, set `Outcome: PARTIAL_WITH_EXPLICIT_SCOPE` or `REJECTED` and name the blocker.
- Missing `requested_work_type` or `actual_work_type_performed` fails closed.
- `requested_work_type` cannot be `none`.
- `actual_work_type_performed: none` requires `Outcome: PARTIAL_WITH_EXPLICIT_SCOPE` or `REJECTED` and a blocker.
- `PARTIAL_WITH_EXPLICIT_SCOPE` and `REJECTED` require a blocker that is not empty or `none`.
- Silent docs-only fallback from code, test, provider_probe, commit, validation, execution, or data_output work is forbidden.
