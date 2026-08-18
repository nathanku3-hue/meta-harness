# Outcome Claim v1

`outcome-claim/v1` is the minimal durable responsibility record for one repo-owned Outcome. It is distinct from workspace execution custody.

```text
Claim
  "this Outcome is currently taken"

workspace-execution-lease/v1
  "this controller may currently execute this workspace generation"
```

The Claim therefore survives model/session/process replacement without becoming a second runtime lease subsystem.

## Claim shape

```json
{
  "schemaVersion": "outcome-claim/v1",
  "claimId": "uuid",
  "outcomeDigest": "sha256:<Outcome>",
  "originWorldHeadDigest": "sha256:<WorldHead>",
  "preconditionDigest": "sha256:<canonical Outcome preconditions>",
  "executionBoundary": {
    "writePaths": ["src/feature"]
  },
  "acquiredAt": "<ISO timestamp>",
  "claimDigest": "sha256:<digest of canonical Claim body>"
}
```

Claims are immutable. Release is recorded separately as `outcome-claim-release/v1`; execution custody is bound separately as `outcome-claim-binding/v1`.

## Atomic acquisition

Claim acquisition is serialized under the existing repository World-authority lock. A bounded contention retry converts transient lock contention into the semantic collision result.

```text
same Outcome already active
→ MH_OUTCOME_ALREADY_CLAIMED

overlapping write boundary
→ MH_OUTCOME_CLAIM_CONFLICT

disjoint write boundary
→ may coexist
```

The first compatibility function uses concrete write boundaries only:

```text
"." overlaps everything
same path overlaps
ancestor/descendant paths overlap
otherwise disjoint
```

There are no generic `conflictKeys` in v1. Non-filesystem conflicts are added only when a demonstrated product defect requires a wider resource model.

## Session/workspace binding

A repo-owned `work-session/v7` carries:

```json
{
  "origin": {
    "type": "REPO_OUTCOME",
    "outcomeDigest": "sha256:...",
    "claimDigest": "sha256:..."
  }
}
```

Before material execution, the Claim is durably bound to exact `sessionDigest` + `workspaceId`. AttemptEntry admission proves that binding plus the existing workspace execution lease. Repo-owned work-session persistence is Claim-addressed and does not update the owner-goal `latest.json` convenience pointer.

## World relationship

`originWorldHeadDigest` is provenance. Whole-World equality is not required for a claimed Outcome to enter execution.

World commit remains CAS-linear. Until scoped freshness is implemented, learning from a Claim whose origin predecessor is stale fails normal World CAS rather than committing blindly.
