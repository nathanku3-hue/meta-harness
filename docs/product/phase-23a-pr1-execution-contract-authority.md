# Phase 23A-PR1 — Execution Contract Authority

**Status:** closed under D067  
**Date:** 2026-07-11  
**Prerequisite:** 22B / D066 (`worker_entry_gate`) at `f926868`  
**Explicit non-goals:** process spawn, AO, Codex, network, public `run` CLI, fake provider, state machine

---

## Purpose

Establish the **root of execution authority** as pure contracts before any provider shape can bias them:

```text
worker_entry_gate (open)
  → authorizeRun(draft RunManifest + repoState fixtures)
  → authorized RunManifest (immutable manifestDigest)
  → EvidenceBundle (facts)
  → verifyEvidence → READY | BLOCKED | FAILED
```

## Modules

| Path | Role |
|---|---|
| `lib/contracts/digest.js` | `sha256:<hex>` via stableJson |
| `lib/contracts/scope.js` | allow/deny path matching |
| `lib/contracts/run-manifest.js` | draft/authorized validate + digest |
| `lib/contracts/authorize.js` | `authorizeRun` fail-closed seal |
| `lib/contracts/evidence-bundle.js` | facts shape + fixture builder |
| `lib/contracts/verify-evidence.js` | fact-based READY/BLOCKED/FAILED |
| `lib/contracts/index.js` | public surface |
| `tests/contracts-authorize-verify.test.js` | acceptance suite |

## Acceptance (shipped)

| # | Criterion | Status |
|---|---|---|
| 1 | authorize fails without `worker_entry_gate.open` | pass |
| 2 | authorize fails on expired / dirty / HEAD drift / missing digests / invalid scope | pass |
| 3 | `manifestDigest` canonical + immutable after authorize | pass |
| 4 | worker/delivery permissions split and validated | pass |
| 5 | READY only from head, changed files, patch hash, command cwd/exit/output hash, PR ref | pass |
| 6 | scope violation → `BLOCKED` | pass |
| 7 | missing facts → `FAILED`; policy fail on present facts → `BLOCKED` | pass |
| 8 | no process, AO, Codex, network, new execution command | pass |

## Missing-fact rule (documented)

| Case | Verdict |
|---|---|
| Evidence structure incomplete / required command fact absent / empty head | `FAILED` (infra/provider incomplete) |
| Facts present but scope violation, non-zero exit, digest mismatch, PR not draft | `BLOCKED` (policy) |
| All required facts present and policy-clean | `READY` |

Agent or AO “done” prose is **never** an input to READY.

## Repo state at authorize

PR1 does **not** inspect git. Callers supply fixture facts:

```js
repoState: { head, dirty, isGitRepo }
```

Live inspection remains a later provider/controller concern; the contract still encodes dirty/HEAD rules so providers cannot invent softer authorize semantics.

## Sequencing after PR1

```text
23A-PR2  fake provider + state machine
23A-PR3  AO provider adapter
23A-PR4  Codex draft-PR dogfood
```

Do **not** combine contracts+fake. Do not start router/DevSpace/Grok/subagents.
