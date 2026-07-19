# Meta Harness

AI-native operating harness for one solo developer/researcher shipping ultra-complex, multi-module systems. It combines a frozen intent anchor, an auditor-planner/worker loop, skills and research application, minimal human gates, and an authority-bound agent execution-custody harness for independently verifiable bounded changes.

## Current Product Authority

Read in this order:

- [Product documentation authority](docs/product/README.md)
- [Locked product intent](docs/product/product-intent.md)
- [Problem-solving questions](docs/product/problem-questions.md)
- [PRD](docs/product/prd.md)
- [Locked functional-slice roadmap](docs/product/roadmap.md)
- [Product spec](docs/product/product-spec.md)
- [Architecture map](docs/architecture/map.md)
- [Operating SOP](docs/sop/meta-harness-sop.md)
- [Decision log](docs/product/decision-log.md)

Historical MVP, phase-era, and custody evidence remains in the repository but does not override the authority order above.

## Locked Direction

The product intent is one solo developer/researcher applying coding and specialist knowledge to ship ultra-complex, multi-module products with maximum verified velocity and minimal routine human friction.

The governing loop is:

```text
reconcile truth
→ freeze audit
→ re-read human intent
→ compare forward alternatives
→ authorize one numbered functional slice
→ execute all reversible authorized work
→ independently verify and integrate
→ record prediction versus outcome
→ continue, ship, repair, re-plan, gate, or stop
```

The human owns intent, taste, authority, material risk, scope expansion, and irreversible commitments. The auditor-planner owns truthful direction. The worker owns bounded authorized execution. The controller owns canonical state, leases, cancellation, integration, custody, and loop integrity.

S-001 is shipped as package `@nkgss/meta-harness@0.3.0` under one-way authority epoch 2 (`G-AUTHORITY-001`). Candidate `588bbe9` was accepted (Linux/Windows × Node 20/25). Epoch-1 public contract, D078 signed truth, and prior status are frozen historical evidence under `docs/ops/audits/authority-epoch-1-frozen/` and are not an active mutation path. Immediate work is `S-006M`: one real non-fixture coding loop in a **non-Meta-Harness product repository** through installed `0.3.0` to merged and packaged state. Internal vaults, signer services, dual-epoch compatibility, databases, broad filesystem frameworks, horizontal governance, and multi-agent programs remain deferred unless that real loop proves a concrete blocker.

## Historical and Supporting Artifacts

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
node bin/meta-harness.js init --authority-public-key-file C:\\external\\truth-authority-public.json --authority-receipt-file C:\\external\\initial-truth-receipt.json
node bin/meta-harness.js event --stream research --phase work --action "surveyed adjacent products" --result "copy visibility and persistence, reject full swarm"
node bin/meta-harness.js worker-report codex-researcher --stream research --task "extract product patterns" --outcome DONE --round ROUND-001 --progress "10/100 -> 20/100" --confidence "9/10" --result "normalized product-pattern PM brief" --human-summary "Research output is ready for PM synthesis." --validations-passed "worker brief parsed" --validations-skipped "none" --evidence-artifacts ".meta-harness/workers/codex-researcher.md" --requested-work-type docs --actual-work-type docs --next-action "synthesize status"
node bin/meta-harness.js templates install
node bin/meta-harness.js expert-packet ROUND-001 --include README.md
node bin/meta-harness.js status --refresh
node bin/meta-harness.js lookback --write
```

After package installation, the command is:

```bash
meta-harness init --authority-public-key-file /external/truth-authority-public.json --authority-receipt-file /external/initial-truth-receipt.json
meta-harness status
```

## Historical MVP Direction

The first version should stay product-first and small:

1. create per-repo Markdown harness state;
2. translate human product intent into Codex worker task language;
3. record PM-facing worker briefs and structured events;
4. render official status truth;
5. render a retrospective lookback from the event ledger;
6. read child repo statuses through file-only polling.

The harness should wrap existing agents and tools rather than becoming a new agent framework.

### Post-MVP re-charter — 2026-07-12

The governing product direction has intentionally moved beyond the original no-launch, no-network MVP. Meta-Harness is now being developed as a **local authority-bound agent execution-custody harness**: sealed intent and scope authorize one isolated agent attempt; the controller owns mutation, validation, durable result custody, and replay. Markdown status remains a core product surface, but visibility alone is no longer the end-state.

D071 proved one meaningful child-repository change but lost retained custody. D073 replaced that path with durable host-neutral execution custody; D074 proved cross-ecosystem reuse; D075 proved repeated private operator use across DevSpace/Node and Fluxara/Python. D076 is closed under exact immutable repair candidate `ce02548`: the isolated packed artifact exposes one installed-package command, `meta-harness execute --request <absolute-path> [--json]`, and a retained novel Leningrad operation completed exact one-revision authority, one authenticated spawn → VERIFIED, durable child/ref custody, expiry+60s fresh-process REPLAY with zero spawns and unusable tools, portable independent validation, leakage PASS, and a create-only public receipt while leaving the dirty source checkout unchanged. Release preparation selects `0.2.0`, keeps feature development frozen, and requires exact-commit CI, CodeQL closure, branch protection, release evidence, tag validation, and the fail-closed publish gate before publication. No generic provider framework, compatibility layer, concurrency framework, broad deletion, or DELETE prerequisite is implied.

## Target MVP CLI

The product target is a global npm CLI. This repo now exposes the `meta-harness` binary through `package.json`:

```bash
npm install -g meta-harness
meta-harness init --authority-public-key-file C:\\external\\truth-authority-public.json --authority-receipt-file C:\\external\\initial-truth-receipt.json
meta-harness status
meta-harness templates install
meta-harness expert-packet ROUND-001
meta-harness execute --request C:\\absolute\\path\\execution-request.json
```

`execute` accepts only `meta-harness-execution-request/v1`. The request must already bind the sealed approval and authorization identities, exact base tree, expected Node/launcher/native-agent/validation SHA-256 identities, an existing non-symlink custody parent, and an absent final custody root. The command does not accept the former private schema or tracked example adapters. Human output is a compact VERIFIED/REPLAY summary; `--json` emits one `meta-harness-execute-result/v1` document. The retained host-local receipt uses `meta-harness-execution-receipt/v1`.

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

## Context Quality Gate

`context` checks whether a round has enough compact, evidence-backed context for a fresh worker to execute without guessing product intent, scope, or stop rules:

```bash
meta-harness context check --target . --from plan --to work --round ROUND-013 --json
meta-harness context ask --target . ROUND-013 --json
meta-harness context packet --target . ROUND-013 --for worker --json
```

The gate scores eight dimensions: product outcome, scope boundary, repo/stack, owned surface, evidence plan, risk/stop rules, freshness, and handoff completeness. It returns `blocked`, `narrowed`, `proceed`, or `excellent`.

- `blocked`: answer the blocker-clearing questions before proceeding.
- `narrowed`: proceed only within the narrowed scope recorded in the packet.
- `proceed` or `excellent`: context is sufficient for a fresh worker.

Artifacts are written to `.meta-harness/local/context/` by default. Use `--commit-artifact` to write tracked `.meta-harness/context/` artifacts after redaction checks pass. `ready --quick --read-only` validates present artifacts without creating new ones.

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

## Governed Skill Self-Evolution

Phase 12 closes the local self-evolution lifecycle without adding publish automation or external evidence harvesting. Candidate drafts stay inactive under `.agents/candidate/` until explicit evidence and decision gates pass:

```bash
meta-harness distill candidate <distillation-id> --target . --json
meta-harness skill preflight <skill-name> --target . --json
meta-harness skill preflight <skill-name> --target . --json --permission-decision D028
meta-harness skill promote <skill-name> --target . --decision-id D028 --json
meta-harness skill rollback <skill-name> --target . --decision-id D029 --json
```

Promotion requires explicit eval, complexity, rollback, and permission evidence. Promotion writes registry lifecycle fields and appends a redacted `skill.promote` event. Rollback restores the previous hash, quarantines the current version, updates the registry, and appends a redacted `skill.rollback` event. Candidate skills are never active guidance before promotion.

## Expert Packets And Scope Contracts

The CLI now ships a small generic kit for bounded review and delegated work:

```bash
meta-harness templates list
meta-harness templates install
meta-harness expert-packet ROUND-001 --include docs/product/product-spec.md
```

`templates install` copies reusable skill and contract templates into `.meta-harness/templates/`. With `--overwrite`, it also refreshes `.meta-harness/workers/worker-report-template.md`; an existing `.meta-harness/status.md` is preserved. `expert-packet` writes one compact archive at `.meta-harness/expert-packets/<round-id>.zip` using current harness truth, packaged templates, optional includes, and bounded git metadata when the target is a Git repo. Packet consumers should receive the zip only; diff notes, next-scope notes, and other review aids belong inside the archive rather than beside it as separate deliverables.

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

These checks detect template drift, untrusted local skill references, old contract headings, active guidance that forces worker artifacts into final chat, state-layout drift, PM brief shape drift, and malformed, invalid, or duplicate decision-inbox records. They do not install templates, clean inherited dirty files, rewrite generators, or write `.meta-harness/status.md` or `.meta-harness/events.jsonl`.

## Domain Governance Validation

Phase 11 closes the downstream domain-governance validation/control-plane gate without adding provider credentials, trading, ranking, broker/order paths, ontology UI, release automation, or publish behavior.

```bash
meta-harness domain-governance check --target <repo> --json
meta-harness ready --target <repo> --quick --read-only --json
```

For repos that declare a domain-governance surface, the gate requires activation and pilot-chain evidence plus a source-to-code rule chain: `domain/facts/ledger.jsonl`, `domain/ontology/terms.json`, `domain/mappings/fact-to-code.json`, `domain/golden-cases/*.json`, `domain/reviews/*.json`, `fact_id` references in mapped code, patch-plan code coverage, and non-expired facts. Repos without that surface skip `MH_DOMAIN_GOVERNANCE_001`; repos with that surface must pass it before local release readiness can pass.

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
node bin/meta-harness.js quality check
npm_config_force=true node --test tests/domain-governance.test.js tests/cli-domain-governance.test.js tests/cli-ready.test.js tests/command-registry.test.js
```

The older Python prototype test can still be run separately with `python -m unittest discover -s tests`.
