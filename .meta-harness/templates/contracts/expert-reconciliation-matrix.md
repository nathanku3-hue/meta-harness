# Expert Reconciliation Matrix

Status: Template
Purpose: reconcile expert recommendations into one orchestrator decision.

## Mode And Stale Rules

```text
Mode: <ADVISORY_REVIEW|POST_EXECUTION_REVIEW|EXECUTION_PACKET|CLOSURE_REPORT>
No artifact may use more than one mode.
This matrix is never a routine pre-execution gate and never approves a proposed worker plan.
StaleReportRule: if an expert report predates current truth, prepend "Superseded on authorization status by <RoundID>; still valid only for guardrails."
OneDecisionRule: reconcile to one next action; downstream architecture belongs in deferred recommendations.
If no single next action can be selected because of a demonstrated blocker or owner-only boundary, return `BLOCKED` or `OWNER_ACTION_REQUIRED` with at most three findings.
```

## Header

```text
RoundID: <round-id>
ScopeID: <scope-id>
Date: <YYYY-MM-DD>
Orchestrator: <name or role>
PreRoute: <NO_BUILD|USE_EXISTING_REPO_PATTERN|USE_PLATFORM_NATIVE|MINIMAL_PATCH|HUMAN_TASTE|EXPERT_PACKET|AUTHORITY_BLOCK>
Route: <EXECUTE_NOW|OWNER_ACTION_REQUIRED|BLOCKED|NO_BUILD>
Outcome: <PASS_AND_CONTINUE|REPAIR_IN_PLACE|OWNER_ACTION_REQUIRED|BLOCKED|NO_BUILD>
DecisionState: <EXECUTING|OWNER_ACTION_REQUIRED|BLOCKED|COMPLETE>
```

## Matrix

```text
+--------------+----------------+------+----------------+-----------------+--------------+-----------------------+
| Expert       | Recommendation | Veto | LowConfidence  | OutOfBoundary   | StreamOrder  | OrchestratorDecision  |
+--------------+----------------+------+----------------+-----------------+--------------+-----------------------+
| Product      | <short rec>    | Y/N  | Y/N + reason   | Y/N + boundary  | <1..N/hold>  | <accept/defer/reject> |
| Architecture | <short rec>    | Y/N  | Y/N + reason   | Y/N + boundary  | <1..N/hold>  | <accept/defer/reject> |
| Domain       | <short rec>    | Y/N  | Y/N + reason   | Y/N + boundary  | <1..N/hold>  | <accept/defer/reject> |
| Ops          | <short rec>    | Y/N  | Y/N + reason   | Y/N + boundary  | <1..N/hold>  | <accept/defer/reject> |
+--------------+----------------+------+----------------+-----------------+--------------+-----------------------+
```

## Findings

```text
+------------+----------+-------------------+----------------+--------------+----------+-------------+
| FindingID  | Severity | Impact            | Fix            | Owner        | Status   | Disposition |
+------------+----------+-------------------+----------------+--------------+----------+-------------+
| F-01       | <...>    | <short impact>    | <short fix>    | <owner/role> | <open/fixed/deferred> | <accept/defer/reject> |
| F-02       | <...>    | <short impact>    | <short fix>    | <owner/role> | <open/fixed/deferred> | <accept/defer/reject> |
+------------+----------+-------------------+----------------+--------------+----------+-------------+
```

## Reconciliation Rules

```text
VetoRule: an in-scope veto blocks only with retained evidence of journey prevention, material conclusion invalidation, credible irreversible loss, or supported-platform unusability; owner-only boundaries map to `OWNER_ACTION_REQUIRED`.
LowConfidenceRule: low confidence permits one bounded inline check only with a complete audit warrant; otherwise record non-blocking residue and continue.
BoundaryRule: out_of_boundary items move to open risks or future scope.
StreamOrderRule: stream_order defines execution sequence; hold is valid only for an owner-only boundary or demonstrated blocker.
FindingRule: every material post-execution finding needs evidence, affected user behavior, smallest repair, and disposition.
BuildVsBorrowRule: if the pre-route is not `EXPERT_PACKET` or `HUMAN_TASTE`, reconcile why expert judgment was still necessary or defer the packet.
AuthorityRule: product, architecture, security, release, provider, and domain-authority changes require `OWNER_ACTION_REQUIRED`; routine reversible implementation continues with `EXECUTE_NOW`.
```

## Decision

```text
OrchestratorDecision: <one-line final decision>
AcceptedRecommendations:
- <expert>: <item or none>
DeferredRecommendations:
- <expert>: <item or none>
RejectedRecommendations:
- <expert>: <item or none>
OpenRisks:
- <risk or none>
NextAction: <single next action>
```
