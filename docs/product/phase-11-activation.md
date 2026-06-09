# Phase 11 Activation - G9 Quant Pilot

Status: D025 active bounded pilot; downstream ready and pilot governance evidence passed
Date: 2026-06-09

## Decision

D025 records a Phase 11 activation decision for a real downstream G9 Quant pilot. The pilot is active only for the bounded FINRA short-interest G9 market-behavior signal-card path recorded here.

This is not broad Phase 11 framework approval.

## Downstream Evidence

| Field | Value |
|---|---|
| Path | `E:\Code\Quant-g9-market-behavior-signal-card` |
| Remote | `https://github.com/nathanku3-hue/Quant.git` |
| Branch | `codex/v2-d0-wrds-permission-snapshot-provenance-20260601` |
| HEAD | `61edd14949fc8a7d7232748c27f75e7706010490` |
| Owner/requester | `nathanku3-hue` |
| Reviewer | `codex-phase-11-reviewer` |

Ready evidence:

- command: `node E:\Code\meta-harness\bin\meta-harness.js ready --target E:\Code\Quant-g9-market-behavior-signal-card --json`
- result: `ok: true`, `passed: 12`, `failed: 0`, `skipped: 4`, `warned: 1`, `next_action: none`
- generated_at: `2026-06-09T02:45:07.298Z`
- git_commit: `61edd14949fc8a7d7232748c27f75e7706010490`
- state_hash: `ed879a175a5872ec0ff90aa54b03f62264c0df54d52dc7429a85ecad6ec46332`

Domain-governance evidence:

- command: `node bin\meta-harness.js domain-governance check --target E:\Code\Quant-g9-market-behavior-signal-card --json`
- result: `ok: true`, `pass: 9`, `fail: 0`, `skip: 0`
- activation decision: `D025`
- pilot chain: `PHASE11-G9-FINRA-SHORT-INTEREST-001`

## Domain Boundary

Pilot boundary: FINRA short-interest G9 market-behavior signal card.

Governed in scope:

- FINRA short-interest source interpretation
- observed-vs-estimated classification
- signal-card fact records
- ontology terms
- code mapping
- golden case

Out of scope:

- buy/sell signals
- ranking/scoring
- provider credential access
- broker/order/alert paths
- broad ontology platform
- release/publish automation

## Evidence Files

- `.meta-harness/domain-governance/activation.json`
- `.meta-harness/domain-governance/pilot-chain.json`
- `opportunity_engine/signal_card.py`
- `opportunity_engine/signal_card_schema.py`
- `data/signal_cards/FINRA_short_interest_signal_card_v0.json`
- `data/signal_cards/FINRA_short_interest_signal_card_v0.manifest.json`
- `tests/test_g9_market_behavior_signal_card.py`
- `docs/architecture/g9_finra_short_interest_signal_card_policy.md`

## First Slice

Allowed:

- validator command
- pilot evidence files for this FINRA short-interest G9 signal-card boundary

Non-goals:

- broad Phase 11 domain-governance framework
- buy/sell signals, ranking, or scoring
- provider credential access
- broker, order, or alert paths
- broad ontology platform
- release or publish automation
- weakening Phase 10 release guard

## Release Impact

Phase 11 D025 does not change Phase 10 release policy. Phase 10 release readiness remains blocked/not release-ready until external GitHub/security evidence satisfies policy and is recollected for the exact release commit. Publish remains guarded by `prepublishOnly` and must continue to fail closed while `release_ready` is false.
