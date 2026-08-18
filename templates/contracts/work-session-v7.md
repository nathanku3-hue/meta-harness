# Work Session v7

`work-session/v7` is the canonical bridge from owner product direction plus one accepted product result or one claimed repository Outcome into Meta-Harness's transactional execution kernel.

v7 is an incompatible cut. It keeps v6's exact product-direction snapshot, immutable base, canonical pre-worker `product-proof-spec/v1`, typed worker mutation, isolated verification, controller-owned BANK acceptance, and bounded repair. It changes repository-owned execution provenance: a repo session is organized around `REPO_OUTCOME`, not `REPO_DECISION`. There is no supported v6 compatibility parser on the v7 execution path.

## Product flow

```text
owner-authored PRODUCT.md
→ exact bytes + digest pin
→ accepted product result OR durable Outcome claim
→ exact Git base
→ compile product-proof-spec/v1 before any coding candidate exists
→ seal work-session/v7
→ fresh controller-owned managed worktree
→ bind Outcome Claim to exact session + workspace when repo-owned
→ read-only coding worker
→ typed WRITE / DELETE / MOVE proposal
→ controller materialization
→ immutable candidateTreeOid
→ isolated regression verification
→ exact sealed product proof
→ controller BANK acceptance
→ BANK
→ optional authorized publication
```

The coding worker never authors completion evidence after seeing its own candidate. The pre-worker proof compiler may propose executable proof, but that proposal is not truth: Meta-Harness owns temporal separation, sealed bytes, baseline calibration, isolation, claim coverage, execution, and terminal derivation.

## Required JSON shape

Owner-directed work uses:

```json
{
  "schemaVersion": "work-session/v7",
  "productDirection": {
    "schemaVersion": "product-direction/v1",
    "sourcePath": "PRODUCT.md",
    "version": "product-direction-v1",
    "digest": "sha256:<64 lowercase hex of raw PRODUCT.md bytes>",
    "content": "<exact owner-authored PRODUCT.md text>"
  },
  "origin": { "type": "OWNER_GOAL" },
  "base": {
    "type": "EXACT_COMMIT",
    "commit": "<exact lowercase Git object id>"
  },
  "productResult": "The useful result the owner expects.",
  "journeyState": "What is already true before coding starts.",
  "doNow": "The nearest executable coding action.",
  "newlyTrueBehavior": "The behavior that must exist after this session.",
  "doneWhen": "Observable completion and validation conditions.",
  "productProofSpec": {
    "schemaVersion": "product-proof-spec/v1",
    "source": { "type": "BASE_OWNED | COMPILED | GAP", "...": "source provenance" },
    "contractDigest": "sha256:<product contract digest>",
    "baseCommit": "<same exact base.commit>",
    "claims": [],
    "program": null,
    "calibration": [],
    "specDigest": "sha256:<sealed proof-spec digest>"
  },
  "stopOnlyIf": ["Material stop condition."],
  "authorizedReversibleActions": ["Read relevant files.", "Edit allowed paths.", "Run validation."],
  "ownerOnlyActions": ["Change PRODUCT.md.", "Expand scope.", "Approve protected or destructive action."],
  "allowedPaths": ["src", "tests"],
  "validation": [
    { "argv": ["npm", "test"], "cwd": ".", "timeoutSeconds": 300 }
  ],
  "maxAttempts": 2,
  "delivery": { "commit": false, "push": false },
  "sessionDigest": "sha256:<computed by Meta-Harness>"
}
```

Repository-owned work differs only in provenance:

```json
{
  "origin": {
    "type": "REPO_OUTCOME",
    "outcomeDigest": "sha256:<immutable Outcome>",
    "claimDigest": "sha256:<durable active Claim>"
  }
}
```

`REPO_DECISION` is not a valid v7 work-session origin. A Repo Decision may remain upstream evidence that selected or described an action, but it is not autonomous work identity and it cannot regain repository-global execution-gate authority through the session contract.

## Outcome/Claim relationship

The kernel keeps Outcome intentionally small:

```text
Outcome
  id
  desiredState
  preconditions
  evidenceRequirement
```

Claim is a separate durable responsibility record. It binds one Outcome to its origin WorldHead, precondition digest, and concrete execution write boundary. Claim is not a duplicate workspace lease: workspace custody still controls which executor may mutate one physical workspace generation.

Initial compatibility is derived from concrete write boundaries. Two active claims whose write paths overlap are incompatible; disjoint write boundaries may coexist. v7 does not introduce generic planner-authored `conflictKeys`.

Repo-owned session persistence is claim-addressed. Multiple active repo sessions can coexist and no repository-global `latest.json` chooses which repo Outcome is authoritative work. Owner-goal continuation may retain its existing single-user convenience pointer until the logical planner replaces that ingress.

## Authority assertions

A model cannot manufacture owner authority by assertion. The active Decision schema has no evidence-bearing authority-resource object, so an unsupported `OWNER_DECISION_REQUIRED` assertion is rejected rather than propagated as durable owner input.

This is intentionally narrower than full forward-motion / EscalationProof. v7 prevents fictional authority now; later planner/research work will prove that failure of one means does not establish blockage of an Outcome until viable alternatives are exhausted.

## Product-proof specification

Every v7 session carries exactly one canonical `product-proof-spec/v1`; proof absence is not a separate runtime branch. Material claims are `EXECUTABLE`, `UNVERIFIABLE`, `TASTE`, or `EXTERNAL`, and the complete spec must cover `productResult`, `newlyTrueBehavior`, and `doneWhen`.

Executable claims declare whether the sealed base should `FAIL` or `PASS`. Meta-Harness calibrates executable claims against the exact base before coding. False trusted calibration fails closed; unsupported generated proof becomes an explicit gap.

## Worker proposal protocol

The read-only coding worker returns only:

```text
WRITE { type, path, content }
DELETE { type, path }
MOVE { type, from, to }
```

The controller rejects traversal, symlink targets, protected product/control paths, out-of-scope paths, duplicate touched paths, oversized writes, missing DELETE/MOVE sources, and existing MOVE targets before materialization.

## Candidate transaction and verification

After controller materialization, Meta-Harness derives and durably seals one Git-authoritative `candidateTreeOid` plus the exact candidate path set. The seal is authority for bytes, not evidence of correctness.

v7 regression verification requires Linux user, mount, network, and PID namespaces. Candidate acceptance answers only whether the exact regression-validated bytes may BANK. It remains separate from semantic product proof.

`product-proof/v2` derives terminal semantic state mechanically:

```text
any material claim FAILED          → FAILED
else any material claim unresolved → GAP
else                               → PROVEN
```

`FAILED` enters bounded repair. `GAP` may bank regression-validated work as `BANKED_UNPROVEN`. Only `PROVEN` can produce `DONE`.

## Execution closure and World linearity

AttemptEntry and ExecutionClosure provenance follows the session origin. New repo-owned attempts therefore use the Outcome Claim origin; legacy Decision-origin closure remains readable only for retained recovery evidence.

Outcome admission does not freeze its origin WorldHead. Independent reality refresh may advance the linear World while claimed work continues. Outcome learning still commits through World compare-and-swap: until scoped freshness is implemented, a learning transition from a stale predecessor fails rather than committing blindly.

Thus v7 establishes:

```text
Outcome stable
Means disposable
Execution independently claimable
Workspace custody exact
World linear
Stale World commit rejected
```

It does not yet claim scoped commit freshness across unrelated World changes; that belongs to the next dedicated slice.

## Continuity and delivery

A current-generation sealed candidate may resume controller validation, product proof, and BANK without invoking the coding worker again. Bounded repair preserves seal-first provenance across generations.

BANK is local immutable delivery and always controller-owned. `delivery.commit=false` cannot disable BANK; publication remains separately authorized. Source checkout HEAD, index, branch, and existing dirty owner bytes are never the BANK target.
