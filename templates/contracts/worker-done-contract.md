# Worker Done Contract

Status: Template
Purpose: capture worker proof before handoff or reconciliation.

## Identity

```text
RoundID: <round-id>
ScopeID: <scope-id>
WorkerID: <worker-id>
Stream: <coding|research|writing|review|other>
Owner: <name or role>
Date: <YYYY-MM-DD>
```

## Scope

```text
URL: <http://... or N/A with reason>
Route/Page: <route, page, artifact surface, or N/A>
WhatToAudit: <specific behavior, contract, or document surface>
FilesChanged:
- <path>
```

## Proof

```text
ScreenshotOrAppTestProof: <screenshot path, test name, or N/A with reason>
ChecksRun:
- <command> -> <PASS|FAIL|NOT_RUN> <summary>
KnownLimits:
- <limit, blocked item, or none>
```

## Handoff

```text
WorkerVerdict: <PASS|BLOCK>
OpenQuestions:
- <question or none>
NextOwner: <orchestrator|reviewer|stream owner>
```

Rule: if URL, route/page, audit target, proof, checks, known limits, or changed files are missing, `WorkerVerdict` must be `BLOCK`.
