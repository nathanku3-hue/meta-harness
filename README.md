# Meta-Harness 0.4

Meta-Harness 0.4 is an outcome-first DELIVERY authority and execution-custody kernel for repository changes.

It preserves four separate claims:

1. an explicit owner authorization binds one exact product result and path boundary;
2. a sealed RunSpec proves bounded mechanical work only;
3. installed black-box proof and isolated Product, Domain, and Custody reviewers evaluate product acceptance;
4. exact publication reconciliation and canonical projection close the slice.

## Outcome-first planner

The installed guidance reads truth in this order: locked product intent and owner authority; immutable product and closure evidence; Git facts; status and summaries last. It selects the nearest action that completes the user journey, allows at most one pre-execution audit/repair round, and blocks only demonstrated journey prevention, material conclusion invalidation, credible irreversible loss, or supported-platform unusability.

Passed evidence is reused while its declared inputs are unchanged. After shipped or value-confirmed completion, the default result is `NO_BUILD` with `USE_PRODUCT`. Continuation requires explicit owner scope change or a complete observed supported-use defect warrant.

## Trust root

Production authority uses a create-only owner identity pin stored in the host-global repository state root, outside Git, `.meta-harness`, the npm package, execution requests, and worker-authorized paths. SliceAuthorization uses the exact `EXPLICIT_OWNER_AUTHORIZATION` marker and a sealed digest; no private signing key is required for the DELIVERY path.

```text
meta-harness authority bootstrap --owner-public-key-file <public-jwk.json>
```

The owner tool remains source-only for separately signed G-scope and publication-exception records. It is excluded from the package.

## DELIVERY execution chain

```text
external owner identity pin
→ explicit-owner SliceAuthorization
→ create-only SliceActivation
→ one or more sealed RunSpec/v2 objects
→ MechanicsAssessment
→ fast-forward IntegratedCandidate
→ exact PackageCandidate and ReleaseCandidate
→ installed BlackBoxProof
→ isolated Product/Domain/Custody reviews
→ TerminalSliceAssessment
→ exact tag and publication observation
→ deterministic canonical closure
```

Meta-Harness 0.4 exposes DELIVERY authority only. Historical alternate execution objects are inert evidence bytes and are neither shipped nor executable.

## Worker reports

Generated worker reports begin with exactly these five non-empty fields, with no title or internal metadata before them:

```text
User journey executed:
Observable result produced:
User accomplished or learned:
Product blocker:
Next executable product action:
```

`Outcome:`, round, progress, confidence, worker identity, and validation metadata follow those product fields.

## Platform policy

Contract validation, package installation, and CLI loading are cross-platform. Authoritative mechanics, proof, and reviewer process execution require Linux namespace isolation and fail closed on unsupported hosts before process spawn, counters, operation bundles, state transitions, or repository mutation.

## Release law

Build the authoritative tarball exactly once after the integrated candidate is ready. Verification and publication reuse that same tarball; they never rebuild it. Install into a clean canary first, then roll the exact package into clean worktrees based on each repository’s actual default branch. Dirty checkouts and archives are not deployment targets.
