# Meta Harness

Markdown-first workflow harness for making agent-assisted work visible, durable, restartable, and reviewable.

## Current Artifacts

- [PRD](docs/product/prd.md)
- [Product spec](docs/product/product-spec.md)
- [Decision log](docs/product/decision-log.md)
- [GitHub research](docs/research/github-projects.md)
- [Draft SOP](docs/sop/meta-harness-sop.md)
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

## Worker PM Briefs

`worker-report` now requires an explicit outcome:

```bash
meta-harness worker-report codex-researcher --stream research --task "extract patterns" --outcome DONE --result "created a PM-facing brief" --next-action "synthesize status"
```

Allowed outcomes are `DONE`, `PARTIAL_WITH_EXPLICIT_SCOPE`, and `REJECTED`.

Generated reports start with `# Worker PM Brief` and are organized around what changed, PM-facing status, key decisions, validation/evidence, blockers, next round recommendation, and worker accountability. The command rejects missing or invalid `--outcome` so execution work cannot silently become a docs-only fallback.

## Expert Packets And Scope Contracts

The CLI now ships a small generic kit for bounded review and delegated work:

```bash
meta-harness templates list
meta-harness templates install
meta-harness expert-packet ROUND-001 --include docs/product/product-spec.md
```

`templates install` copies reusable skill and contract templates into `.meta-harness/templates/`. `expert-packet` writes one compact archive at `.meta-harness/expert-packets/<round-id>.zip` using current harness truth, packaged templates, optional includes, and bounded git metadata when the target is a Git repo. Packet consumers should receive the zip only; diff notes, next-scope notes, and other review aids belong inside the archive rather than beside it as separate deliverables.

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
