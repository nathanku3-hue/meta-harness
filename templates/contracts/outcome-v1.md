# Outcome v1

`outcome/v1` is the minimal immutable identity for repo-owned autonomous work.

It describes the desired result and only the precondition/evidence semantics required by the current authority kernel. It deliberately does **not** embed planner ontology, context selection, implementation means, workspace identity, tool choice, queue state, priority, capability policy, generic conflict keys, or escalation strategy.

## Shape

```json
{
  "schemaVersion": "outcome/v1",
  "id": "stable-local-identifier",
  "desiredState": "Observable desired state",
  "preconditions": ["Fact that must hold for this Outcome"],
  "evidenceRequirement": "Evidence required to establish the desired state",
  "outcomeDigest": "sha256:<digest of canonical Outcome body>"
}
```

## Laws

```text
Outcome = durable work identity
Execution means != Outcome identity
Workspace != Outcome identity
Decision != Outcome identity
Session != Outcome identity
```

A Repo Decision may select an action that compiles to an Outcome, but the Decision digest is not carried as the active repo work-session origin.

`preconditions` are stable semantic statements in v1. Their canonical digest is pinned into a Claim. Slice 1 does not yet evaluate scoped precondition freshness against a later World; Phase 3 owns that revalidation mechanism.
