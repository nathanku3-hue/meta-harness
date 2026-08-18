# Work Session v5

**Retired.** Active coding sessions use `work-session/v7`; see `templates/contracts/work-session-v7.md`.

v5 is retained only for archive readability. It treated sealed-base `product-proof-policy/v1` as the only semantic proof authority and therefore mapped absence of that policy to `UNAVAILABLE → BANKED_UNPROVEN`. v6 removes that runtime architecture: every session pins one canonical pre-worker `product-proof-spec/v1`, with explicit claim coverage and baseline calibration.

There is no supported v5 compatibility parser on the v7 execution path.
