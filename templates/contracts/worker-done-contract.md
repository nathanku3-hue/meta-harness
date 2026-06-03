# Worker Done / PM Brief Contract

Status: Template
Purpose: capture what actually changed, PM-facing status, evidence, blockers, next action, and worker accountability before handoff or reconciliation.

## PM Brief

```text
Outcome: <DONE|PARTIAL_WITH_EXPLICIT_SCOPE|REJECTED>
Round: <round/task>
Progress: <before>/100 -> <after>/100
Confidence: <0-10>/10
What I did: <one paragraph answering what actually changed and practical effect>
PM-facing status: <one short paragraph naming current state and blocked/unblocked status>
```

## Ship-Fast Decision Gate

```text
What is done:
What is blocked:
User order interpreted as:
Recommended next step:
Why this is correct:
Alternatives considered:
Decision needed from user: <approve|redirect|hold>
Scope limit:
Stop rule:
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

## Scope And Artifacts

```text
RequestedWorkType: <docs|code|test|provider_probe|commit|validation|execution|data_output>
ActualWorkTypePerformed: <docs|code|test|provider_probe|commit|validation|execution|data_output|none>
FilesChanged:
- <path or none>
EvidenceArtifacts:
- <path/report/commit/hash/zip or none>
```

## Decisions And Evidence

```text
KeyDecisionsMade:
- <decision or none>
ValidationPassed:
- <check or none>
ValidationSkipped:
- <check + reason, or none>
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
- The report must begin with the Ship-Fast PM Brief fields, not Identity, `# Worker Report`, a numbered logsheet, SAW Verdict, ClosurePacket, or command logs.
- The first paragraph must answer what actually changed.
- The Ship-Fast Decision Gate must choose one next decision before governance expansion.
- Do not lead with command logs, reviewer chatter, or numbered SAW/logsheet detail.
- SAW Verdict, ClosurePacket, ClosureValidation, and SAWBlockValidation are evidence only and must appear under Validation / evidence or evidence artifacts.
- Evidence artifacts are files, reports, commits, hashes, or zips; they are not the same field as passed validations.
- If requested work was not performed, set `Outcome: PARTIAL_WITH_EXPLICIT_SCOPE` or `REJECTED` and name the blocker.
- Missing `requested_work_type` or `actual_work_type_performed` fails closed.
- Silent docs-only fallback from code, test, provider_probe, commit, validation, execution, or data_output work is forbidden.
