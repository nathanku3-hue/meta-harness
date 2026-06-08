# Meta Harness

Markdown-first workflow harness for making agent-assisted work visible, durable, restartable, and reviewable.

## Current Artifacts

- [PRD](docs/product/prd.md)
- [Product spec](docs/product/product-spec.md)
- [Decision log](docs/product/decision-log.md)
- [GitHub research](docs/research/github-projects.md)
- [Draft SOP](docs/sop/meta-harness-sop.md)
- [Post-worker SAW workflow template](docs/templates/post_worker_saw_workflow.md)
- [Pre-MVP prototype CLI](meta_harness.py)

## MVP CLI

Run locally from this repo:

```powershell
node bin/meta-harness.js init "Build coding and research visibility"
node bin/meta-harness.js event --stream research --phase work --action "surveyed adjacent products" --result "copy visibility and persistence, reject full swarm"
node bin/meta-harness.js worker-report codex-researcher --stream research --task "extract product patterns" --outcome DONE --round ROUND-001 --progress "10/100 -> 20/100" --confidence "9/10" --result "normalized product-pattern PM brief" --human-summary "Research output is ready for PM synthesis." --validations-passed "worker brief parsed" --validations-skipped "none" --evidence-artifacts ".meta-harness/workers/codex-researcher.md" --requested-work-type docs --actual-work-type docs --next-action "synthesize status"
node bin/meta-harness.js templates install
node bin/meta-harness.js expert-packet ROUND-001 --include README.md
node bin/meta-harness.js status --refresh
node bin/meta-harness.js lookback --write
```

After package installation, the command is:

```bash
meta-harness init "Build coding and research visibility"
meta-harness status
```

## Direction

The first version should stay product-first and small:

1. create per-repo Markdown harness state;
2. translate human product intent into Codex worker task language;
3. record PM-facing worker briefs and structured events;
4. render official status truth;
5. render a retrospective lookback from the event ledger;
6. read child repo statuses through file-only polling.

The harness should wrap existing agents and tools rather than becoming a new agent framework.

## Target MVP CLI

The product target is a global npm CLI. This repo now exposes the `meta-harness` binary through `package.json`:

```bash
npm install -g meta-harness
meta-harness init
meta-harness status
meta-harness templates install
meta-harness expert-packet ROUND-001
```

See [Product spec](docs/product/product-spec.md) for the intended MVP command surface.

## Clean-Code Governor

`quality` installs a repo-local clean-code contract for meta-harness or any managed repo:

```bash
meta-harness quality init
meta-harness quality baseline --force
meta-harness quality check
meta-harness quality explain
```

The gate runs in ratchet mode: existing debt may be grandfathered, new debt is blocked, touched debt must not get worse, and compatibility-breaking CLI or report behavior requires an explicit migration note and approval.
Refreshing the baseline is audited maintenance only; normal patch work should fix findings rather than run `quality baseline --force`.

## Worker PM Briefs

`worker-report` now requires an explicit outcome, requested work type, and actual work type:

```bash
meta-harness worker-report codex-researcher --stream research --task "extract patterns" --outcome DONE --requested-work-type docs --actual-work-type docs --result "created a PM-facing brief" --next-action "synthesize status"
```

Allowed outcomes are `DONE`, `PARTIAL_WITH_EXPLICIT_SCOPE`, and `REJECTED`.

Generated reports use the worker-report artifact v2 shape. The first non-empty line is `Outcome:`, followed by `Round`, `Progress`, and `Confidence`; no title appears before those fields. They are organized around what changed, why it matters, blockers, one decision-needed block, next action, evidence, and accountability.

The Ship-Fast Decision Gate concept is preserved inside `## What decision is needed` with one user decision, options considered, scope limit, and stop rule.

The command rejects missing or invalid `--outcome`, `--requested-work-type`, or `--actual-work-type`. It also rejects `DONE` when requested execution, data output, code, tests, provider probes, commits, or validation were silently performed as docs-only or not performed. Use `PARTIAL_WITH_EXPLICIT_SCOPE` or `REJECTED` with the blocker instead.

SAW Verdict, ClosurePacket, ClosureValidation, and SAWBlockValidation are evidence only. They must not become a second primary report skeleton after the PM brief.

## Post-Worker GitHub Actions / SAW

The repo includes a read-only reusable workflow at `.github/workflows/post-worker-saw.yml` and a packaged skill template at `templates/skills/post-worker-github-actions.md`.

The workflow validates worker-report artifact v2 shape, skips `worker-report-template.md`, blocks silent docs-only fallback, checks changed files against an allowlist with optional explicit `base_sha` and `head_sha`, and emits a SAW evidence summary. It does not use secrets, provider access, WRDS, runtime/dashboard/scoring/broker paths, or data output, and it must not pass issue or PR body text into agent prompts.

For cross-repo reuse, call the workflow with `workflow_call` from a job-level `uses:` reference pinned to a full commit SHA after audit.

## Expert Packets And Scope Contracts

The CLI now ships a small generic kit for bounded review and delegated work:

```bash
meta-harness templates list
meta-harness templates install
meta-harness expert-packet ROUND-001 --include docs/product/product-spec.md
```

`templates install` copies reusable skill and contract templates into `.meta-harness/templates/`. `expert-packet` writes one compact archive at `.meta-harness/expert-packets/<round-id>.zip` using current harness truth, packaged templates, optional includes, and bounded git metadata when the target is a Git repo. Packet consumers should receive the zip only; diff notes, next-scope notes, and other review aids belong inside the archive rather than beside it as separate deliverables.

Patch/status exports must not be written beside the repo with `../...` paths such as `../example-staged.patch`. Use `.meta-harness/local/` for repo-local ignored evidence, or an explicit temp directory for cross-worktree transfer. `ready` includes a root-leak check for common sibling sidecars such as `*_staged.patch`, `*-mixed-workspace.patch`, `*-porcelain-status.txt`, and `*-untracked-files.txt`.

## Read-Only Trust Checks

Phase 5 closes the source-only trust/sync flywheel with adoption checks that report without mutating target repos:

```text
meta-harness sync check --target <repo>
meta-harness trust check --target <repo>
meta-harness contract scan --target <repo>
meta-harness state check --target <repo>
meta-harness brief scan --target <repo>
meta-harness decisions scan --target <repo>
```

These checks detect template drift, untrusted local skill references, old contract headings, state-layout drift, PM brief shape drift, and malformed, invalid, or duplicate decision-inbox records. They do not install templates, clean inherited dirty files, rewrite generators, or write `.meta-harness/status.md` or `.meta-harness/events.jsonl`.

## Pre-MVP Prototype CLI

The current Python script is an earlier local prototype. It is useful as a behavior sketch, not the final product packaging target.

```powershell
python meta_harness.py init "write a minimal SOP harness" --actor codex --owner codex
python meta_harness.py event --phase implementation --action "added CLI" --result "local commands work" --verification "unit test passed" --artifact meta_harness.py --next-action "review status"
python meta_harness.py status --refresh
python meta_harness.py lookback --write
```

The CLI writes:

```text
.meta-harness/
  current-run
  runs/
    <run-id>/
      status.md
      events.jsonl
      decisions.md
      handoff.md
      lookback.md
      artifacts/
      background/
```

## Verification

```bash
npm test
```

The older Python prototype test can still be run separately with `python -m unittest discover -s tests`.
