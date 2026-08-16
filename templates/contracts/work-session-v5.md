# Work Session v5

`work-session/v5` is the canonical bridge from owner product direction plus one accepted product result into Meta-Harness's transactional execution kernel.

v5 is an incompatible cut. It replaces v4 execution semantics with typed worker mutation, an immutable candidate tree, Linux namespace verification, controller-owned BANK acceptance, and optional base-owned product proof. There is no supported v4 compatibility parser on the v5 execution path.

## Product flow

```text
owner-authored PRODUCT.md
→ exact bytes + digest pin
→ accepted product result
→ exact Git base
→ seal work-session/v5
→ fresh controller-owned managed worktree
→ read-only coding worker
→ typed WRITE / DELETE / MOVE proposal
→ controller materialization
→ immutable candidateTreeOid
→ isolated regression verifier
→ controller BANK acceptance
→ base-owned product proof when available
   ├─ FAILED → bounded repair
   ├─ UNAVAILABLE → BANKED_UNPROVEN
   └─ PROVEN → DONE
→ BANK
→ optional authorized publication
```

Worker reasoning and worker `status` are advisory. They do not authorize or veto completion. Candidate acceptance authorizes only BANK of the exact sealed candidate whose regression contract passed inside the required verifier isolation profile. `DONE` additionally requires independent product proof.

## Required JSON shape

```json
{
  "schemaVersion": "work-session/v5",
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

The base authority forms from v4 remain valid: `REMOTE_REF`, deliberate `LOCAL_REF`, and `EXACT_COMMIT` all seal one exact `base.commit`. Refs are not re-resolved after sealing and RESUME never silently adopts a newer remote.

## Worker proposal protocol

The read-only worker returns only these filesystem mutations:

```text
WRITE { type, path, content }
DELETE { type, path }
MOVE { type, from, to }
```

The controller rejects traversal, symlink targets, protected product/control paths, out-of-scope paths, duplicate touched paths, oversized writes, missing DELETE/MOVE sources, and an existing MOVE target before materialization.

The protocol intentionally does not expose arbitrary patch, chmod, shell-mutation, Git, staging, commit, branch, worktree, publication, or provider operations.

## Candidate transaction

After controller materialization, Meta-Harness derives and durably seals one Git-authoritative `candidateTreeOid` plus the exact candidate path set. BANK must later stage a `--no-renames` path set equal to that seal and produce exactly the sealed tree.

The candidate seal is authority for bytes, not evidence of correctness.

## Isolated verification

v5 verification requires Linux user, mount, network, and PID namespaces. On Windows, the supported authority path is Linux/WSL execution; native Windows does not silently fall back to an unisolated verifier.

For every attempt the controller:

1. copies Git objects without hardlinks into a disposable verifier root;
2. materializes the exact sealed `candidateTreeOid`;
3. removes the source remote from the verifier clone;
4. exposes only system runtime roots plus bounded candidate-local dependency directories such as `node_modules`, `.venv`, or `venv`, mounted read-only from the source checkout when present;
5. chroots the validation process into that disposable root;
6. creates new user, mount, network, and PID namespaces;
7. drops all effective/bounding/inheritable/ambient capabilities before the validation command executes;
8. supplies a synthetic HOME/tmp and scrubbed environment;
9. exposes no host network route;
10. rejects any Git-visible mutation of the verifier candidate after each command.

Host source files, controller state, user home, mounted Windows drives, credentials, and bankable workspace bytes are not addressable from the validation process.

## Controller acceptance

`acceptCandidate(candidateSeal, verification)` produces an ephemeral bank-authorizing value only when:

- verification uses the required v5 isolation profile;
- the verification digest is internally consistent;
- `candidateTreeOid` equals the durable candidate seal;
- every sealed validation command appears in order with the exact sealed argv/cwd;
- every sealed validation command passed.

The acceptance value is bound to `sessionDigest`, candidate seal digest, candidate tree, and verification digest. BANK rejects missing, stale, or tampered acceptance before staging anything.

Acceptance is deliberately not a registry or persistent policy subsystem. A crash before BANK may simply re-verify the sealed candidate.

## Product proof

Product proof is repository/domain-owned semantic evidence, not another model or reviewer. If `.meta-harness/product-proof.json` exists in the sealed `base.commit`, it must use `product-proof-policy/v1` and name one regular base-owned proof-program blob, one runtime executable, and a timeout. The controller constructs exactly `runtime + /base-proof/<program>`. The session need not widen: `base.commit` transitively pins both the policy and program.

The controller binds at least `sessionDigest`, candidate seal digest, `candidateTreeOid`, `base.commit`, policy blob OID, proof-program blob OID, command/result evidence, isolation profile, and `productProofDigest` into durable `product-proof/v1` before BANK.

Execution reuses the same Linux namespace/chroot verifier. It mounts `/base-proof`, `/candidate`, and `/session` read-only and exposes no source checkout, controller state, credentials, or external network route. Root dependency directories may be mounted read-only for proof execution.

The three evidence states are deliberately not workspace lifecycle states:

```text
PROVEN       independent proof passed      → eligible for DONE
FAILED       proof exists and rejected it  → bounded repair
UNAVAILABLE  no sealed proof policy exists → BANKED_UNPROVEN
```

`BANKED_UNPROVEN` leaves workspace custody as `TERMINAL_COMMITTED` and execution closure as non-complete. It is a truthful product outcome, not a new custody state. Only `DONE` is coding product success.

## Completion authority

The worker's `done`, `partial`, or `blocked` label is advisory. `blocked` with no operations can stop an attempt because there is no candidate to verify. Once a candidate exists, completion is controller-owned:

```text
sealed candidate
+ isolated regression verification
+ current controller acceptance
= eligible to BANK

eligible to BANK
+ product-proof/v1 PROVEN
= DONE
```

A worker cannot self-attest completion and cannot veto controller acceptance by returning `partial` after the BANK-safety contract passes. Regression-green bytes without independent product proof may still be retained locally, but they cannot become `DONE`.

## Continuity measurement

The persisted work result carries controller-observed `work-metrics/v1` measurements rather than a new telemetry subsystem: NEW vs RESUME, proposal latency, worker output/event volume, operation mix, verifier latency, validation-command time, and repair count. Regression verification, candidate acceptance, and durable product-proof evidence are retained while normal human output stays product-facing.

These metrics exist to measure whether cold repair/resume materially repeats work. They do not authorize execution and do not contain model reasoning.

## Continuity boundary

v5 does not add execution memory, episodic storage, session trees, vector retrieval, or a `ContinuationCapsule`. Those remain unimplemented until the measured repair/resume baseline demonstrates material reconstruction loss.

## Delivery

BANK is local immutable delivery and is always controller-owned. Publication remains separately authorized. The source checkout is never the BANK target, and Meta-Harness never automatically resets, cleans, stashes, reverts, tags, or publishes owner work.
