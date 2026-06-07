# Decision Inbox Contract

Status: Template
Purpose: keep reusable user decisions small, deterministic, and separate from raw dirty-work noise.

## Decision Shape

```json
{
  "id": "D-<identity-hash-prefix>",
  "kind": "user_decision",
  "question": "Approve touching inherited dirty path src/owned.js?",
  "recommended": "hold",
  "state_hash": "<source-classification-state-hash>",
  "identity_hash": "<canonical-decision-identity-hash>",
  "assumptions": [
    "dirty path existed before current scope",
    "path overlaps owned scope"
  ],
  "reask_when": "file state, scope hash, or credential/provider/runtime boundary changes",
  "status": "open",
  "evidence": [
    ".meta-harness/dirty-work.json"
  ]
}
```

## Allowed Values

```text
kind: user_decision
recommended: approve | reject | defer | hold
status: open | approved | rejected | deferred
resolution: approved | rejected | deferred
```

## Identity

`state_hash` is the source classification state hash supplied by `dirty classify` or `decisions add --state-hash`.

`identity_hash` is computed by Meta-Harness from canonical identity fields:

- kind;
- question;
- recommended;
- sorted and deduplicated assumptions;
- reask_when;
- source classification state hash.

Evidence paths are not identity. Moving an evidence file must not reopen a decision.

## ID Collision Rule

IDs start as `D-<identity-hash-prefix>`. If the prefix collides, lengthen the prefix until unique. If the full identity hash collides with different canonical identity content, fail closed with `MH_USAGE`.

## Routing

Only dirty-work `DECISION` classifications enter the inbox. `QUEUE`, `PASS`, `BLOCK`, and `ESCALATE` must not become reusable user decisions. `BLOCK` and `ESCALATE` stay visible only as current PM blocker/escalation state.
