# Effective Guidance Rollout

Status: COMPLETE
Completed: 2026-06-21T12:11:08.4375644Z
Source commit: `3378f3916360d9f2a50d7aaa926fe065ea7367f0`

## Result

Meta-Harness now rejects active repository guidance that requires the worker-report artifact or its metadata as the final chat response. Quant and its disposable clone now explicitly require concise plain-language chat closure while keeping worker reports and SAW packets as evidence artifacts.

The scope-selector schema is now internal planning output and must not be pasted into normal chat.

## Verification

- Focused source tests: 37 passed.
- Full source suite: 63/63 test files passed.
- Template sync: 10/10 local installs passed.
- Effective active-guidance scan: 10/10 passed.
- Scope-selector chat boundary: 10/10 installed copies passed.
- Existing status and unrelated dirty work were preserved.

## Activation

Fresh agent contexts in Quant load the corrected `AGENTS.md`. An already-running conversation may retain the old instruction snapshot and should not be used as proof of the new behavior.

## Decision

Effective-guidance rollout: COMPLETE.
