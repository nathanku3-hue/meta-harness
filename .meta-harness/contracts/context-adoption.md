# Context Gate Adoption Contract

## Purpose

This repository adopts Phase 13C context gate enforcement. Required context transitions must be backed by a fresh, matching context gate artifact or an auditable override.

## Activation

This repo-local file activates context gate adoption for `MH_CONTEXT_GATE_001`.

## Required Transitions

- `intake->plan`
- `plan->work`
- `work->verify`
- `verify->synthesize`

## Advisory Transitions

- `synthesize->handoff`
- `handoff->lookback`

## Bypass

Bypass requires a reason, a valid reason code, artifact metadata, and a matching `context-gate-override` event whose timestamp is at or after the artifact generation timestamp.

## Packets

Worker packets must not proceed from blocked required gates without a valid override. Review and planning packets may inspect blocked or stale artifacts only after artifact shape validation succeeds.
