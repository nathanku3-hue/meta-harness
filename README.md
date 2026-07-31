# Meta-Harness 0.4

Meta-Harness 0.4 is a fail-closed semantic authority and execution-custody kernel for repository changes.

It separates four claims that earlier releases conflated:

1. **Owner authority** — an externally pinned owner key signs one exact `SliceAuthorization`.
2. **Mechanical correctness** — bounded RunSpecs may produce `MECHANICS_VERIFIED` only.
3. **Product acceptance** — installed black-box proof and isolated Product, Domain, and Custody reviews bind one immutable integrated release candidate.
4. **Closure** — only `TERMINAL_SLICE_VERIFIED`, exact publication reconciliation, and deterministic canonical projection close a slice.

## Breaking release

Meta-Harness 0.4 does not parse, convert, migrate, or replay pre-0.4 execution or truth-authority contracts.

Historical interpretation requires the pinned 0.3.0 package. Historical files remain inert evidence bytes under 0.4.

## Trust root

Production authority is a create-only Ed25519 owner public-key pin stored in the host-global repository state root. It is outside:

- the Git checkout;
- `.meta-harness`;
- the npm package;
- execution requests;
- worker-authorized paths.

Install it explicitly:

```text
meta-harness authority bootstrap --owner-public-key-file <public-jwk.json>
```

A tracked repository copy of a key or pin has no trust effect.

The offline owner signer lives under `internal/owner-tool/` in the source repository and is excluded from the npm package. It accepts an explicit private-key path and emits only the signed object.

## One active functional slice

All linked worktrees share one host-global state universe derived from the canonical Git common directory, Git object format, and protocol namespace `meta-harness/0.4`.

A controller lease may expire, but the active slice does not. A replacement controller may take over only the same slice, generation, state digest, operation-event head, and owner-authorized controller binding.

## Execution chain

```text
external owner pin
→ owner-signed SliceAuthorization
→ create-only SliceActivation
→ append-only operation bundles
→ sequential RunSpec/v2
→ MechanicsAssessment
→ fast-forward IntegratedCandidate
→ exact PackageCandidate
→ exact ReleaseCandidate
→ installed BlackBoxProof
→ isolated Product/Domain/Custody reviews
→ TerminalSliceAssessment
→ exact fast-forward and tag
→ publish the existing tarball
→ independent registry reconciliation
→ deterministic canonical closure
```

Any acceptance byte change requires a separately owner-signed G-SCOPE replacement. Meta-Harness 0.4 does not attempt to classify a change as stronger, weaker, equivalent, or editorial.

## Execution requests

`meta-harness execute` accepts only `meta-harness-execution-request/v2` objects. Supported actions are:

- `ACTIVATE_SLICE`
- `SEAL_RUN_SPEC`
- `RECORD_MECHANICS`
- `CERTIFY_CANDIDATE`
- `RECORD_TERMINAL_CANDIDATE`
- `RECORD_PUBLICATION_OBSERVATION`
- `CLOSE_SLICE`

Example invocation:

```text
meta-harness execute --request <absolute-request.json> --json
```

Execution requests cannot select the state root, repository identity, controller policy, or production clock.

Mechanical completion is rendered as:

```text
MECHANICS VERIFIED
PRODUCT ACCEPTANCE: NOT EVALUATED
```

Only terminal closure carries product authority.

## Release flow

Build exactly one tarball before terminal proof:

```text
meta-harness release candidate create <evidence options>
```

Verify that existing tarball before installed proof and review:

```text
meta-harness release candidate verify-preterminal <evidence options>
```

After terminal verification, exact fast-forward, and exact tag creation, verify publication readiness without rebuilding:

```text
meta-harness release candidate verify-publication <evidence options>
```

Publish only the existing pre-bound tarball:

```text
meta-harness release publish <evidence options>
```

Local command success is non-authoritative. Closure requires an independent registry observation of the exact package version and integrity.

The package `prepublishOnly` hook runs publication verification only. It performs zero `npm pack` operations.

## Delivery versus certification

Every owner authorization selects one exact terminal mode and binds `authorityExecutionPlatform: "linux"`:

- `DELIVERY` is for Meta-Harness package shipment. It requires the exact npm package candidate, installed-package proof, Product/Domain/Custody review, terminal assessment, tag, publication observation, and canonical closure.
- `CERTIFICATION` is for a repository application such as Quant. It binds the exact Git commit and tree, installed Python environment identity, dependency-lock digest, application entry point, operator-visible proof, and Product/Domain/Custody review. It forbids npm package, registry, Git tag, and publication fields and emits `CERTIFICATION_VERIFIED`, not a shipment claim.

Public execution requests cannot submit successful mechanics, proof, reviewer, or terminal assessment objects. The installed controller executes sealed validation commands, resolves and hashes evaluator/reviewer programs, launches their isolated processes, captures their output, and constructs the authoritative evidence objects.

Fail-closed process and network isolation in 0.4 uses Linux user, mount, and network namespaces. Windows is a validation and packaging host, not an authority-execution host.

| Capability | Linux | Windows |
| --- | --- | --- |
| Contract and signature validation | Yes | Yes |
| Operation-bundle verification | Yes | Yes |
| Package installation and CLI loading | Yes | Yes |
| Controller-observed mechanics execution | Yes | Fail closed |
| Installed proof/evaluator execution | Yes | Fail closed |
| Reviewer process isolation | Yes | Fail closed |
| Publication verification | Yes | Yes, where tooling permits |

On a non-Linux host, every evidence-producing controller entry point returns `AUTHORITY_EXECUTION_PLATFORM_UNSUPPORTED` before process spawn, attempt or run counter changes, operation-bundle publication, state transition, or repository mutation. The accurate 0.4 claim is cross-platform validation and packaging with Linux-only authoritative evidence production.

## Advisory repository files

`meta-harness init` creates advisory `.meta-harness` status and template files. It does not install authority, accept a product result, or create canonical truth.

Status prose, worker reports, words such as “complete,” decision IDs, and evidence headings have no product-authority effect.

Generated worker-report artifacts follow one stable parsing contract: the first non-empty line is `Outcome:` and no title appears before those fields. This is an evidence-format rule only; it does not grant product authority.

## Development verification

Focused 0.4 tests cover:

- canonical Git-common-directory state identity;
- external create-only owner pinning;
- active-slice compare-and-swap and same-slice lease takeover;
- hard rejection of retired contracts and caller-controlled clocks or roots;
- exact acceptance inheritance and G-SCOPE;
- typed quantitative bounds;
- fast-forward-only integration;
- crash-safe operation bundles;
- owner-bound proof and reviewer programs;
- generation invalidation after candidate mutation;
- zero-rebuild release verification;
- publication reconciliation;
- deterministic closure;
- package exclusion of owner signing tools and retired authority modules;
- recursive static-relative dependency closure across every shipped JavaScript file;
- dry-run/actual packlist equality, isolated offline installation, every installed command load path, and installed CLI startup;
- Windows unsupported-platform proof with zero spawn, counters, bundles, state, or repository mutation.
