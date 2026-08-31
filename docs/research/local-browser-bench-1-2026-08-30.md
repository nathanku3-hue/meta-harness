# LOCAL-BROWSER-BENCH-1 — 2026-08-30

Status: **bounded browser/resource branch stopped on wrong-cause host failure**
Authority: non-authoritative measurement
Campaign base: `57a2564f1fe199de3a8ab8cfb8ae45834e9ec656`

## Intended R1 question

```text
B0 = current accepted local fresh-Web path
B1 = same path under one sequential live ChatGPT/browser activation
```

The purpose is to identify a browser/RAM/resource bottleneck before considering one remote candidate. It is **not** to reclassify known host ingress/bootstrap failures as browser defects.

## Retained current-host observations

The still-current 2026-08-29 scorecard records two bounded `WEB-CONNECTOR-1` observations on the same host path:

```text
2f1bb7a99bed35c4cfc1b0689a2052d9d12c602ca580479325e688ffc5baa783
→ failed / launch_failed

ac6c6162160ccb956b18979812a2272b570fe254e3b45c5599df5b1adc644e94
→ expired after remaining pending
```

Those observations were already classified as host bootstrap friction rather than evidence of a Meta-Harness semantic/browser-isolation defect.

## New one-slot observation

R1 launched exactly one fresh connector proof while keeping the test sequential so there was only one live activation under measurement:

```text
proofId = 601345382940e4e48512853a81f19e787423efef86c822b947c91a3d2b5ab56c
startedAt = 2026-08-30T16:16:48.694Z
expiresAt = 2026-08-30T16:18:48.694Z
terminal status = expired
assistant output captured = false
```

No concurrent browser load was introduced by R1.

## Why R1 stopped this branch early

The exposed bounded proof does not provide a distinct physical-slot control that can cleanly separate B0 from B1, and the fresh failure is the same host/bootstrap/callback class already retained—not a RAM exhaustion, auth contamination, cross-lane bleed, or correctness-under-pressure observation.

Continuing nine or nineteen more identical two-minute proofs would increase sample count without isolating the browser/resource variable R1 is supposed to test.

The precommitted causal law therefore wins over trial-count ceremony:

```text
observed failure = host/bootstrap/callback friction
not demonstrated = local RAM/browser resource defect
remote escape-hatch warrant = NOT SATISFIED
```

This is a bounded stop, not a browser pass.

## B0 / B1 disposition

```text
B0 current local path
→ retained host bootstrap failures exist

B1 sequential one-slot observation
→ expired
→ no evidence of memory exhaustion or slot-pressure correctness loss

B0 vs B1 resource comparison
→ not causally identifiable through the exposed proof surface
```

No claim is made that the local browser architecture is generally reliable. No claim is made that one slot is generally sufficient. The narrower R1 conclusion is only that the observed current failure does not warrant browser/provider architecture work.

## Decision

```text
NO remote browser trial
NO browser router
NO provider registry
NO multi-provider matrix
NO resource scheduler
```

Reopen browser/resource adaptation only when a supported journey produces retained evidence of an actual local browser/resource defect rather than host/bootstrap failure.
