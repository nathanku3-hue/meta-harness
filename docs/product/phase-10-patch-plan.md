# Phase 10 Patch Plan

Status: Phase 10B publish-boundary guard WIP
Roadmap phase: Phase 10 - Release/package enforcement
Implementation status: local read-only release check exists; npm publish boundary guard in progress; publish automation remains out of scope
Decision required before implementation: Phase 10B boundary guard authorized by current worker assignment
Commit plan doc: yes
Start implementation: Phase 10B npm publish-boundary guard only
Phase 10 quality baseline refresh: no; Phase 9 metadata adoption is handled separately by D022
Publish: no
Decision-log entry in this patch: none
Later decision-log entry: yes, if Phase 10 expands beyond local read-only checks

## Scope

Phase 10 defines release and package enforcement only.

This plan documents release gates, package checks, CI requirements, publish-mode behavior, and incident policy. Phase 10A is the read-only local implementation check. Phase 10B adds only the package publish-boundary guard.

## Hard Boundary

This document now reflects Phase 10A local implementation status and the Phase 10B package boundary guard. It does not permit publish, tag, CI publish automation, version bumping, registry writes, provenance publishing, or Phase 11 work.

Allowed for Phase 10A:

- read-only local `meta-harness release check`
- `.meta-harness/release-policy.json` as local package identity policy
- tests for local pass/fail, missing policy, missing evidence, and package metadata

Allowed for Phase 10B:

- `package.json` `prepublishOnly` guard that runs `node bin/meta-harness.js release check --publish --json`
- tests proving `npm publish --dry-run` fails closed through that guard
- lifecycle allowlist updates needed to keep normal readiness green

Forbidden:

- publish automation
- CI publish workflow edits
- release tags
- version bumping
- registry writes

## No-Side-Effects Rule

All Phase 10 release checks remain read-only with respect to git tags, the npm registry, GitHub settings, and CI configuration. Phase 10B may edit the package lifecycle guard, but the guard command itself must not write release artifacts or publish anything.

The only allowed writes are temporary files and directories under an isolated temp path. Temp artifacts must be cleaned up after the check, and cleanup success or failure must be recorded in release evidence.

Default local mode must not require network access. Phase 10B `--publish` mode fails closed by returning the release-check JSON and exiting nonzero unless `release_ready` is true. It still does not publish, harvest external evidence, or verify trusted publishing. A future publish mode may perform read-only npm registry and GitHub checks when the environment has permission. When local mode lacks network or repository-setting evidence, it should return `skip`, `warn`, or `unknown` instead of failing solely because external evidence is unavailable.

## Current Prerequisite Signal

- Phase 9 status: transition/adoption baseline with complexity metadata adopted
- Phase 9 commit: `20cbd080a587520839c2951d8fd5dfd735580d0c`
- Quality status: pass with no `MH_COMPLEXITY_LEGACY_BASELINE_METADATA` finding
- Complexity metadata adoption: adopted under D022; this does not by itself claim full Phase 9 closure
- Release readiness requirement: clean tree required before a real release; Phase 10A local checks report dirty state without failing local-only checks

## Files

Phase 10A implementation may add or modify:

- `.meta-harness/release-policy.json`
- `lib/release-check.js`
- `lib/commands/release.js`
- `lib/command-registry.js`
- `tests/release-check.test.js`
- `tests/command-registry.test.js`

Phase 10B implementation may add or modify:

- `package.json`
- `lib/release-check.js`
- `lib/commands/release.js`
- `lib/ready-check.js`
- `lib/command-registry.js`
- release and readiness tests
- a status note

Future implementation may add or modify, after audit approval:

- CI workflow entries for Dependency Review and trusted publishing

## Release Check Commands

Phase 10 should define these CLI surfaces. Phase 10A implements the default local check and JSON output. Phase 10B allows `--publish` to fail closed on release readiness without performing publish automation.

```text
meta-harness release check
meta-harness release check --json
meta-harness release check --publish --json  # fail-closed guard for npm publish
```

Default mode is local implementation readiness, not full release readiness. JSON mode returns the same decision as machine-readable output. Phase 10B publish mode exits on `release_ready`, not `local_ok`, and must not be treated as proof of trusted-publishing posture.

## Release Check IDs

Stable release check IDs:

- `REL_CLEAN_TREE_001`
- `REL_RELEASE_POLICY_001`
- `REL_READY_001`
- `REL_TEST_001`
- `REL_REPRO_001`
- `REL_PACKAGE_ID_001`
- `REL_PACKAGE_METADATA_001`
- `REL_NPM_LIFECYCLE_001`
- `REL_PACK_DRY_RUN_001`
- `REL_FORBIDDEN_PATH_001`
- `REL_TARBALL_PATH_CANON_001`
- `REL_PACK_EQUIV_001`
- `REL_TEMP_NPM_ENV_001`
- `REL_SMOKE_IGNORE_SCRIPTS_001`
- `REL_TARBALL_SMOKE_001`
- `REL_CLI_SMOKE_001`
- `REL_VERSION_TAG_001`
- `REL_PREPUBLISH_ONLY_001`
- `REL_DEP_REVIEW_001`
- `REL_TRUSTED_PUBLISHING_001`
- `REL_PUBLISH_PERMISSIONS_001`
- `REL_PUBLISH_ENV_001`
- `REL_TRUSTED_PUBLISHER_ENV_001`
- `REL_PACKAGE_IDENTITY_SOURCE_001`
- `REL_EXTERNAL_GITHUB_SECURITY_001`
- `REL_FULL_RELEASE_EVIDENCE_001`
- `REL_ROLLBACK_POLICY_001`

## Release Check Contract

Full Phase 10 `meta-harness release check` must fail when any required release gate fails. Phase 10A local mode fails only local-required implementation checks; release-only checks such as clean-tree status, external evidence, and full release evidence keep `release_ready: false` without making the local command fail.

Minimum checks:

- clean git tree: fail release readiness when `git status --porcelain` is non-empty
- full ready: run full `meta-harness ready`, not `--quick`, not `--read-only` in full release mode; Phase 10A local mode uses read-only ready evidence
- tests: run or reuse `npm test` evidence in full release mode; Phase 10A local mode checks test-script/read-only eligibility only
- reproducibility: validate package-lock and npm posture
- package identity: require expected package name, valid version, `private !== true`, and expected registry/access policy
- package metadata: require license, repository, bin, files, engines, and packageManager metadata
- npm lifecycle scripts: allow only canonical `prepublishOnly`
- package dry-run scan: parse dry-run JSON in full release mode; Phase 10A local mode checks eligibility only
- forbidden-path scan: fail if package output includes local state, secrets, runtime data, dependency trees, or demo run artifacts
- canonical package path matching: normalize tarball entries before forbidden-path matching
- dry-run/actual equivalence: compare dry-run packlist to actual tarball contents
- temp npm environment: isolate HOME, USERPROFILE, npm cache, npm userconfig, and auth-token environment before tarball smoke install
- smoke install scripts: use `--ignore-scripts` by default
- actual tarball smoke test: create a tarball with `npm pack --json --pack-destination <temp>` and install it into a temp project
- CLI smoke test: run the installed `meta-harness` binary from the temp project
- version/tag policy: compare `package.json` version to the release tag when a release tag is present or publish mode is active
- prepublishOnly behavior: block `npm publish` by running the release check before publish
- Dependency Review behavior: require PR/CI enforcement for dependency-risk changes
- trusted publishing behavior: verify OIDC publish posture only in `--publish` mode
- publish workflow permissions: allow `id-token: write` only in the publish job and keep other permissions minimal
- protected publish environment: verify protected environment evidence or record why unavailable
- trusted publisher environment consistency: publish-mode workflow environment must match trusted-publisher configuration when configured
- release failure and rollback policy: define what may be cleaned up automatically and what requires incident handling

## Test Execution Policy

Release check must not accidentally run the same expensive gate twice.

If full `ready` already includes `MH_TEST_001`, release check may report that ready test result as `REL_TEST_001`.

If release check re-runs `npm test`, the duplicate execution must be intentional, documented, and visible in JSON evidence.

Preferred implementation: run tests once and reuse the result.

## Reproducibility Contract

When `package.json` exists, `REL_REPRO_001` should require:

- committed `package-lock.json`
- valid lockfile version
- `package-lock.json` not ignored
- `package.json` `engines.node`
- `package.json` `packageManager`
- CI workflows use `npm ci`, not `npm install`

Local release check may validate file and workflow posture without running `npm ci`.

CI or an isolated temp workspace may run `npm ci` when the check environment supports it.

The tarball smoke test must install the packed tarball in a temp project.

## Release Policy Source Of Truth

Phase 10A uses `.meta-harness/release-policy.json` to define expected package identity and publish posture.

The policy should define:

- expected package name
- expected registry
- expected access policy
- expected tag prefix
- allowed publish workflow filename
- trusted publisher environment name, if configured

Initial expected policy for this package:

```json
{
  "schema_version": "1",
  "package": {
    "name": "meta-harness",
    "registry": "https://registry.npmjs.org/",
    "access": "public",
    "tag_prefix": "v"
  },
  "publish": {
    "workflow": null,
    "trusted_publisher_environment": null
  }
}
```

`REL_PACKAGE_ID_001` must not infer expected identity solely from the same `package.json` being checked.

`REL_PACKAGE_IDENTITY_SOURCE_001` must record which accepted policy source supplied the expected identity.

## Npm Lifecycle Policy

`REL_NPM_LIFECYCLE_001` must allow only this canonical lifecycle guard:

```json
{
  "scripts": {
    "prepublishOnly": "node bin/meta-harness.js release check --publish --json"
  }
}
```

These scripts are blocked or decision-gated because they are release attack surface:

- `prepare`
- `prepack`
- `postpack`
- `publish`
- `postpublish`
- `preinstall`
- `install`
- `postinstall`

## JSON Contract

`meta-harness release check --json` should emit a stable schema:

```json
{
  "schema_version": "1",
  "ok": false,
  "mode": "local",
  "publish": false,
  "version": "0.1.0",
  "started_at": "2026-06-08T00:00:00.000Z",
  "completed_at": "2026-06-08T00:00:01.000Z",
  "duration_ms": 1000,
  "git_commit": "20cbd080a587520839c2951d8fd5dfd735580d0c",
  "tree_hash": "sha256:example",
  "node_version": "v25.0.0",
  "npm_version": "11.16.0",
  "meta_harness_version": "0.1.0",
  "release_policy_source": ".meta-harness/release-policy.json",
  "temp_artifacts": {
    "cleanup": "pass"
  },
  "checks": [
    {
      "id": "REL_CLEAN_TREE_001",
      "name": "clean-tree",
      "status": "fail",
      "reason": "2 uncommitted files"
    }
  ]
}
```

Allowed statuses: `pass`, `fail`, `skip`, `warn`, `unknown`, `timeout`.

`tree_hash` should be defined during implementation. Preferred order:

- use `git rev-parse HEAD^{tree}` when inside a Git repo
- otherwise use deterministic SHA-256 over sorted tracked file paths and content hashes

## Forbidden Package Paths

Release package scans must reject:

```text
.meta-harness/local/
.meta-harness/snapshots/
.meta-harness/expert-packets/
.meta-harness/workers/
.meta-harness/runs/
.env
.env.*
*.pem
*.key
*.p12
*.pfx
id_rsa
id_ed25519
credentials.json
secrets
secrets.*
*.secret
*.token
.npmrc
.npmrc.*
credentials
provider-config/
runtime/
data/
demo/
__pycache__/
*.pyc
node_modules/
```

## Canonical Package Path Matching

`REL_FORBIDDEN_PATH_001` must normalize tarball entries before matching:

- normalize to POSIX-style relative paths
- replace backslashes with forward slashes
- strip one leading `package/` prefix from npm tarball entries
- reject absolute paths
- reject paths containing `..` segments
- reject empty paths
- normalize case for secret-pattern matching
- apply forbidden patterns only after canonicalization

## Pack Equivalence

`REL_PACK_EQUIV_001` must compare the file list from `npm pack --dry-run --json` with the actual tarball file list created by `npm pack --json --pack-destination <temp>`.

The check fails on drift.

## Temp Npm Environment

`REL_TEMP_NPM_ENV_001` must isolate npm configuration during tarball smoke install:

- set temp `HOME`
- set temp `USERPROFILE`
- set temp npm cache
- set temp empty npm userconfig, through `npm_config_userconfig` or `--userconfig`
- avoid inherited npm auth token environment
- record environment isolation status in JSON evidence

The smoke install must use `--ignore-scripts` by default, then separately run the installed CLI binary.

If smoke install script execution is ever required, it needs a decision-gated exception before implementation.

## Mode Boundaries

Dependency Review belongs to PR/CI mode. Phase 10 may require a Dependency Review workflow and required-check posture, but local release checks should report unavailable repository settings as `unknown` or `skip` unless CI evidence is provided.

Dependency Review evidence may be:

- a workflow file defining Dependency Review for pull requests
- a recorded required-check status in a release evidence file
- GitHub API evidence when running in CI with permission to inspect settings

Local mode must not fail solely because branch or ruleset settings are unavailable.

Trusted publishing evidence remains future work. Phase 10B `meta-harness release check --publish` fails closed on the current release-readiness truth, but it does not verify trusted-publishing or OIDC posture. A future publish mode must fail if it cannot verify trusted-publishing or OIDC posture. Default local mode must report trusted publishing as `skip`, not `fail`.

Publish workflow permissions must keep `contents: read` or equivalent minimal permissions by default. `id-token: write` is allowed only in the publish job that needs OIDC.

`REL_PUBLISH_ENV_001` is optional in local mode but required to resolve in publish mode when trusted-publisher configuration names an environment. In publish mode, if npm trusted-publisher configuration names an environment, missing or mismatched workflow environment is `fail`. Local mode remains `skip`, `warn`, or `unknown` when evidence is unavailable.

`REL_TRUSTED_PUBLISHER_ENV_001` must compare the configured trusted-publisher environment name with the publish workflow job environment when publish-mode evidence is available.

## Version And Tag Policy

Default local mode:

- if the current commit has no release tag, version/tag is `skip`
- if the current commit has a release tag, it must match `package.json` version
- the command must not create, delete, or move tags

Publish mode:

- current commit must have an exact release tag
- release tag must point at `HEAD`
- release tag must match `package.json` version
- package version must not already be published
- command still must not publish by itself

## prepublishOnly Policy

Phase 10B may add:

```json
{
  "scripts": {
    "prepublishOnly": "node bin/meta-harness.js release check --publish --json"
  }
}
```

Official publish automation, if later approved, should still run `meta-harness release check --publish` before `npm publish`. The lifecycle hook is a final local/package guard, not publish automation and not the sole trusted-publishing verifier.

## Incident And Rollback Policy

If publish fails after release checks pass:

- do not delete a tag if the package version was published
- do not delete a tag created outside the current release attempt
- delete local or remote tags only when the package was not published, the tag was created by the current attempt, and the cleanup is explicitly safe
- if a package was partially published, follow registry immutability rules and use deprecate or unpublish only where policy allows
- log a failed publish event in the release record
- require human review before retrying the same version

## Future Test Plan

Future implementation tests should cover:

- clean pass path
- dirty tree failure
- ready failure
- `npm test` failure
- duplicate test execution policy
- per-check timeout classification
- `npm ci` or lockfile mismatch failure
- missing package name failure
- missing package version failure
- `private: true` package failure
- unexpected publish registry/access failure
- missing package license failure
- missing repository metadata failure
- missing bin field failure
- missing files allowlist failure
- missing engines/packageManager failure
- blocked npm lifecycle script failure
- canonical `prepublishOnly` allow case
- dry-run JSON parse failure
- forbidden package path failure
- canonical package path matching failure
- absolute tarball path rejection
- parent-directory tarball path rejection
- key, certificate, token, and npmrc package leak failure
- dry-run/actual tarball equivalence failure
- temp npm environment isolation
- smoke install `--ignore-scripts` behavior
- smoke install script-execution exception denial
- actual tarball install smoke failure
- missing binary smoke failure
- version/tag skip in local mode
- version/tag failure in publish mode
- Dependency Review unavailable behavior
- trusted publishing skipped in local mode
- trusted publishing required in publish mode
- trusted-publisher environment mismatch failure in publish mode
- publish job permission boundary
- protected publish environment unavailable behavior
- prepublishOnly command string
- rollback policy classification
- temp artifact cleanup result

## Explicit Non-Goals

- no publish
- no release tag
- no package version bump
- no further baseline refresh as part of Phase 10 implementation
- no broader Phase 9 closure claim beyond D022 complexity metadata adoption
- no publish-mode `.meta-harness/release-policy.json` expansion
- no external publish-mode evidence harvesting beyond the fail-closed local release-readiness decision
- no release automation
- no CI workflow change before audit
- no package script change beyond the Phase 10B `prepublishOnly` guard before audit
- no release-decision change to `docs/product/decision-log.md`
- no change to `.meta-harness/baseline/quality-baseline.json`

## Merge Protocol Follow-Up

Current merge scopes may not yet include this Phase 10 planning filename. Do not modify merge gates in this patch. If needed, handle merge-protocol support in a later audited docs or gate update.

## Audit Checklist

- Confirm default local mode versus publish mode.
- Confirm `npm ci` should run in CI or isolated temp workspace.
- Confirm `prepublishOnly` should call `release check --publish --json`.
- Confirm official publish automation, if later approved, should call `release check --publish` before `npm publish`.
- Confirm Dependency Review remains PR/CI enforcement.
- Confirm trusted publishing requires OIDC evidence only in publish mode.
- Confirm publish workflow may use `id-token: write` only in publish job.
- Confirm protected publish environment is optional locally and strict only when publish-mode trusted-publisher config names it.
- Confirm dry-run/actual tarball file-list equivalence is required.
- Confirm canonical package path matching is required.
- Confirm smoke install uses isolated npm config and `--ignore-scripts`.
- Confirm npm lifecycle scripts are blocked or decision-gated except canonical `prepublishOnly`.
- Confirm package identity includes expected name, version, `private !== true`, and registry/access policy.
- Confirm package identity has a future policy source of truth.
- Confirm no decision-log entry is included in this Phase 10B boundary-guard patch.
- Decide whether accepted Phase 10 contract needs a later D018 or D017 addendum.
