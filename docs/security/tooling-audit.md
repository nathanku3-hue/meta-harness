# Tooling Audit

Current gate: G1-G6 materialized tooling evidence
Date: 2026-06-19
Target: MAIN_INSTALL_READY

## Status

G0 was closed externally on 2026-06-19 by the bounded approval record for the P0-P8 sequence. This document records that external decision and the current materialized tooling boundary; it does not approve itself and is not a substitute for review.

The earlier packet content and its fenced YAML examples remain `REVIEW_SPECIMEN` material. They are useful for comparison, but they are not active tooling merely because they appeared in the packet. The active P8 tooling materialized by this change is the new root `.semgrep.yml` and `.github/workflows/semgrep.yml`; this file records the audit taxonomy, boundaries, and evidence requirements for that materialization.

## Gate Sequence

```text
G0  Human approves bounded packet       ✓ closed externally 2026-06-19
G1  Semgrep determinism passes          ← current materialized gate
G2  Waiver policy documented
G3  Code Scanning wording correct
G4  Context7 boundary documented
G5  GitHub MCP boundary documented
G6  Merged-main install smoke evidence  → MAIN_INSTALL_READY
```

G6 evidence is recorded on the pull request and workflow/run comments after the merged-main smoke. It is not recorded by changing `main` after the smoke.

## Taxonomy

| Classification | Meaning | Current status |
| --- | --- | --- |
| `PM_CLOSURE` | External approval/status artifact that authorizes the bounded P0-P8 sequence. | Closed externally on 2026-06-19; this repository file is not the approval source. |
| `REVIEW_SPECIMEN` | Non-active packet content shown for review, including proposed config or workflow blocks. | The dirty source packet remains reference-only and does not activate tooling. |
| `MATERIALIZED_IMPLEMENTATION` | Files created at repository paths on the approved branch and verified by gates. | `.semgrep.yml` and `.github/workflows/semgrep.yml` are active materialized tooling; this audit file records the boundary. |

## Materialized Scope

Allowed materialized files for this transition:

- `.semgrep.yml`
- `.github/workflows/semgrep.yml`
- `docs/security/tooling-audit.md`

No other package, dependency, lockfile, release, CODEOWNERS, or SECURITY changes are in scope.

Forbidden in this transition:

- Runtime dependencies or lockfile changes.
- Publish, tag, release, or registry automation.
- Repository secrets, credentials, GitHub PAT fallback, or token fallback.
- Write-enabled GitHub MCP tools or broad credentials.
- SARIF upload, `security-events: write`, or GitHub Code Scanning dashboard claims.
- Self-approval by this audit document or by any materialized config.

## Semgrep Determinism

Semgrep is approved only as a fail-closed CI gate using local audited rules. It is not a GitHub Code Scanning integration in this transition.

Approved image:

```text
semgrep/semgrep:1.167.0@sha256:06938c1f365d3f67b8cedd8bc117607ae64253f88a0e768e9da9408548927dd6
```

Pinned action SHAs:

- `actions/checkout@08eba0b27e820071cde6df949e0beb9ba4906955`
- `actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02`

The workflow must run:

```text
semgrep scan --config .semgrep.yml --error --strict --metrics=off --json --output semgrep-results.json
```

The Semgrep workflow has only `permissions: contents: read`, uses `persist-credentials: false`, uploads `semgrep-results.json` as an artifact with `if-no-files-found: error`, and does not upload SARIF.

The local rules enforce:

- No `security-events: write`, including quoted YAML keys or values.
- No SARIF upload/output constructs while leaving harmless comments alone.
- No Semgrep config source except `.semgrep.yml` or `./.semgrep.yml`, including multiline, registry, URL, and `auto` forms.
- Exact Semgrep image allowlist, catching `latest`, untagged, digest-only, and wrong-digest image references.

Do not use `semgrep scan --validate` as gate evidence for this transition; the evidence is the actual pinned scan.

## Waiver Policy

Allowed suppression syntax:

```text
# nosemgrep: <rule-id> -- owner=@github-handle; expires=YYYY-MM-DD; review=<ticket-or-pr>; reason=<specific false-positive or temporary exception>
```

Waiver requirements:

- Owner is required and must be a named GitHub handle or team.
- Expiry is required and must be no more than 90 days after introduction.
- Review reference is required and must point to a PR, issue, or decision record.
- Reason must describe the bounded false positive or temporary exception.
- File-wide suppressions are forbidden unless separate human approval explicitly allows them.
- Expired suppressions block the gate until removed or renewed through review.

All findings from the local audited config are blocking in CI through `--error`; missing artifacts, internal errors, parse failures, and non-zero Semgrep exits are also blocking.

## GitHub Code Scanning Boundary

Approved wording:

```text
Semgrep CI gate only. No SARIF upload. No security-events: write. No GitHub Code Scanning dashboard claim.
```

Forbidden wording:

- "GitHub Code Scanning is enabled."
- "Semgrep findings appear in the Code Scanning dashboard."
- "Security alerts are uploaded by Semgrep."

Those claims require SARIF upload and `security-events: write`, which are out of scope for MAIN_INSTALL_READY.

## Context7 Boundary

Context7 may be used only as a bounded public documentation oracle.

Allowed payloads:

- Package, library, framework, API, or GitHub Actions names.
- Public version numbers.
- Public documentation questions.
- Short public error messages that do not contain project secrets or private source.

Forbidden payloads:

- Secrets, tokens, API keys, credentials, or `.env` contents.
- Private source files or full repository dumps.
- Private issue, PR, review, or comment content.
- Roadmap, business context, customer data, or non-public architecture context.
- Provider outputs, runtime data, or local machine paths that reveal private context.

Context7 output is advisory documentation context only. It is not final authority for security, release, dependency, or repository policy decisions.

## GitHub MCP Boundary

Approved profile name:

```text
github-readonly-meta-harness-audit
```

Allowed capability classes:

- Repository metadata read.
- File/content read.
- Pull request read.
- Issue read.
- Commit/status/check read.
- GitHub Actions workflow, run, job, and log read.

Forbidden capability classes:

- Create, update, delete, merge, close, lock, label, assign, comment, react, rerun, dispatch, upload, or write actions.
- Any workflow or repository mutation.
- Any token with broad organization access.
- Any GitHub PAT or token fallback for this transition.

Credential policy:

- Do not store credentials in this repository.
- Prefer a connector-managed GitHub App credential with read-only repository access.
- Keep the named read-only profile separate from any write-capable profile.
- No PAT or token fallback is approved for G1-G6.

## ast-grep Boundary

ast-grep remains a repo-external, pinned CLI for deliberate local structural search and interactive codemods.

Allowed use:

- Invoke an exact pinned CLI version outside repository dependency management.
- Search or preview AST-aware rewrites against explicitly selected local paths.
- Apply a rewrite only when its diff is reviewed and the repository's normal tests are run.

Forbidden in this transition:

- Adding ast-grep to `dependencies`, `devDependencies`, a lockfile, or repository runtime.
- Adding ast-grep to CI, a persistent service, or an MCP server.
- Treating generated rewrites as approved without diff review and verification.
- Committing ast-grep config or rules as a way to bypass a separately approved scope item.

Any promotion of ast-grep into repository-managed tooling requires a separate approval.

## Evidence Checklist

Preflight evidence:

- [x] Fresh clone created from `https://github.com/nathanku3-hue/meta-harness.git`.
- [x] `git fetch --prune origin` completed before branch creation.
- [x] Branch `codex/tooling-g1-g6-001` was absent locally and remotely before creation.
- [x] `BASE_SHA` resolved from `origin/main^{commit}`.
- [x] Branch was created exactly at `BASE_SHA`, with a clean status before edits.

Pre-PR evidence required:

- [ ] `npm test`
- [ ] `node bin/meta-harness.js ready --target . --quick --read-only --json`
- [ ] `git diff --check`
- [ ] `npm pack --dry-run --json --ignore-scripts`
- [ ] Optional pinned-container Semgrep positive/negative fixture smoke, or a recorded note that Docker was unavailable.

PR and CI evidence required:

- [ ] Pull request opened to `main` with task id `TOOLING-G1-G6-001`.
- [ ] Node CI passes for the PR head SHA.
- [ ] Semgrep CI passes for the PR head SHA and uploads `semgrep-results.json`.
- [ ] PR/run comments record Semgrep job URL, image digest, config commit SHA, and the absence of SARIF upload and `security-events: write`.

Merged-main G6 evidence required after merge:

- [ ] Confirm the authoritative PR record says merged and record `PR_MERGE_SHA`.
- [ ] Fetch `origin/main` again and resolve `MERGED_MAIN_SHA` from `refs/remotes/origin/main^{commit}`.
- [ ] Verify `PR_MERGE_SHA` is an ancestor of `MERGED_MAIN_SHA`.
- [ ] Run the package/install smoke from a fresh checkout of exactly `MERGED_MAIN_SHA`.
- [ ] Record SHA, commands, exit statuses, and generated package identity on the PR/run evidence trail.
