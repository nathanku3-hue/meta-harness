# Work Session v6 (retired)

**Retired.** Active coding sessions use `work-session/v7`; see `templates/contracts/work-session-v7.md`. There is no supported v6 compatibility parser on the v7 execution path.

The historical v6 contract below is retained for archive readability. v6 kept v5's typed worker mutation, immutable candidate tree, Linux namespace verification, controller-owned BANK acceptance, and bounded repair, but replaced base-owned-only semantic proof with one pre-worker canonical `product-proof-spec/v1`.

## Product flow

```text
owner-authored PRODUCT.md
→ exact bytes + digest pin
→ accepted product result
→ exact Git base
→ compile product-proof-spec/v1 before any coding candidate exists
   ├─ normalize trusted base-owned product-proof-policy/v2 when present
   ├─ otherwise synthesize repository-native executable proof when possible
   ├─ calibrate executable claims against the sealed base
   └─ expose every material proof gap explicitly
→ seal work-session/v6 with exact proof-spec digest
→ fresh controller-owned managed worktree
→ read-only coding worker
→ typed WRITE / DELETE / MOVE proposal
→ controller materialization
→ immutable candidateTreeOid
→ isolated regression verifier
→ exact sealed product-proof-spec against candidate
   ├─ FAILED → bounded repair
   ├─ GAP → BANKED_UNPROVEN
   └─ PROVEN → DONE
→ controller BANK acceptance
→ BANK
→ optional authorized publication
```

The coding worker never authors completion evidence after seeing its own candidate. The pre-worker compiler may propose executable proof, but that proposal is not truth: Meta-Harness owns temporal separation, sealed bytes, baseline calibration, isolation, claim coverage, execution, and terminal derivation. Before any non-dry-run execution, the controller re-proves the sealed spec against the exact base; imported session JSON cannot substitute claimed calibration or base-owned provenance for controller-observed evidence.

## Required JSON shape

```json
{
  "schemaVersion": "work-session/v6",
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

The proof contract is derived from exact `productDirection.digest`, `base.commit`, `productResult`, `newlyTrueBehavior`, and `doneWhen`. A proof spec compiled for different semantics cannot be reused in a session.

## Product-proof specification

Every v6 session carries exactly one canonical `product-proof-spec/v1`; proof absence is not a separate runtime branch.

Each material claim is one of:

```text
EXECUTABLE    mechanically decidable in the isolated proof runtime
UNVERIFIABLE  no trustworthy executable oracle was established
TASTE         requires owner/product judgment
EXTERNAL      requires unavailable external truth or protected access
```

Every claim names which sealed semantic clauses it covers. The complete spec must cover all of:

```text
productResult
newlyTrueBehavior
doneWhen
```

No material clause may disappear during proof compilation. A non-executable material claim remains an explicit proof gap and therefore cannot be hidden under overall `PROVEN`.

Executable claims declare an expected baseline relationship:

```text
FAIL  newly true behavior should fail on the sealed base
PASS  preservation/invariant should already pass on the sealed base
```

Before the coding worker runs, Meta-Harness executes every executable claim against the exact sealed base. A generated claim whose observation disagrees with its declared baseline is downgraded to an explicit `UNVERIFIABLE` gap. A trusted base-owned proof policy whose declared calibration is false fails closed as invalid repository proof authority.

### Base-owned input

A repository may provide `.meta-harness/product-proof.json` using `product-proof-policy/v2`. The policy names one regular base-owned proof program, a safe-system runtime, timeout, and atomic claims with baseline expectations and coverage.

This policy is an **input source**, not a second runtime mechanism. Meta-Harness reads the policy/program from exact `base.commit`, binds their Git blob OIDs as source provenance, calibrates them, and normalizes them into the same canonical `product-proof-spec/v1` consumed by every v6 session.

### Compiled input

When no base-owned v2 policy exists on the normal owner-goal path, Meta-Harness may invoke a read-only pre-worker proof compiler against only owner direction, the sealed product contract, and a clean snapshot of the exact base. The compiler cannot see a coding candidate because none exists yet.

If it can express material behavior with repository-native executable proof, it returns one program run once per executable claim using `META_HARNESS_PROOF_CLAIM_ID`. Meta-Harness does not create a generic HTTP/browser/database assertion DSL.

If proof cannot be compiled, or generated proof fails calibration, the session still carries a canonical GAP spec. Coding may proceed and useful regression-validated bytes may be banked, but the unresolved material claim prevents `DONE`.

## Worker proposal protocol

The read-only coding worker returns only:

```text
WRITE { type, path, content }
DELETE { type, path }
MOVE { type, from, to }
```

The controller rejects traversal, symlink targets, protected product/control paths, out-of-scope paths, duplicate touched paths, oversized writes, missing DELETE/MOVE sources, and an existing MOVE target before materialization.

## Candidate transaction and isolated regression verification

After controller materialization, Meta-Harness derives and durably seals one Git-authoritative `candidateTreeOid` plus the exact candidate path set. The seal is authority for bytes, not evidence of correctness.

v6 regression verification requires Linux user, mount, network, and PID namespaces. The controller materializes the exact sealed candidate in a disposable verifier root, exposes only bounded runtime/dependency inputs, drops capabilities, supplies scrubbed HOME/tmp state, exposes no host network route, and rejects Git-visible mutation.

Candidate acceptance answers only whether the exact regression-validated bytes may BANK. It remains separate from semantic product proof.

## Product-proof execution

The same isolation boundary executes the exact program sealed in `product-proof-spec/v1` with read-only inputs:

```text
/candidate                    exact candidateTreeOid
/base                         exact sealed base tree
/proof-spec/program           exact sealed proof-program bytes
/session/product-contract.json exact sealed product contract
```

For each `EXECUTABLE` material claim, the controller runs the program with that claim's ID. Exit zero is `PASSED`; nonzero is `FAILED`. Non-executable material claims remain `UNRESOLVED` without model judgment.

`product-proof/v2` derives its overall state mechanically:

```text
any material claim FAILED       → FAILED
else any material claim unresolved → GAP
else                            → PROVEN
```

`FAILED` is actionable repair evidence and enters the existing bounded repair loop. `GAP` banks regression-validated work as `BANKED_UNPROVEN` with a non-success product outcome. Only `PROVEN` can produce `DONE`.

## Completion authority

```text
sealed candidate
+ isolated regression verification passes
+ current controller candidate acceptance
= eligible to BANK

eligible to BANK
+ product-proof/v2 PROVEN
= DONE
```

Worker `done`/`partial` status is advisory. A model-authored proof proposal is also advisory until sealed, calibrated, and mechanically executed. Neither the coding worker nor the proof compiler can self-attest completion.

## Continuity and delivery

A current-generation sealed candidate may resume controller validation, product proof, and BANK without invoking the coding worker again. Bounded repair preserves seal-first provenance across generations.

BANK is local immutable delivery and always controller-owned. `delivery.commit=false` cannot disable BANK; publication remains separately authorized. Source checkout HEAD, index, branch, and existing dirty owner bytes are never the BANK target.
