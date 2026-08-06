# Meta-Harness Current Product State

State: PRODUCT_DIRECTION_CONTINUITY_1_IMPLEMENTED
Current checkout: `product/product-direction-continuity-1`
Accepted product score: `84/100` (banked Episode 1; implementation-only does not raise score)
Revised score target: `85/100` after real external direction-carrying `--goal` DONE

## Product result

Owner states product direction once in repository-root `PRODUCT.md`. Every coding session, repair, resume, and fresh-worker continuation carries the exact same taste, philosophy, endgame, and shipping definition. Engineering cannot silently rewrite it. Controller rejects any worker mutation of `PRODUCT.md`.

## Current state

- Episode 1 banked at `58a8b2a`; this branch builds from that tip.
- Active contract is `work-session/v2` with `product-direction/v1` exact content snapshot (no v1 compat).
- Low-friction `--goal` pins live `PRODUCT.md` before workspace creation.
- `--session` and `--resume` require live `PRODUCT.md` matching the sealed snapshot (I1).
- Worker prompt injects product direction before product result and engineering context.
- Materializer hard-rejects `PRODUCT.md` writes regardless of `allowedPaths`.
- New `init` no longer generates `phase-map.md`; retained readers tolerate absence.
- Meta-Harness repository has owner-authored root `PRODUCT.md`.
- `npm test`: 110 files, 771 tests, zero failures.
- Score remains `84/100` until a real external repository proves the revised 85 journey.
- Feature-branch commit/push not authorized yet.

## Do now

Owner review and bank this branch when ready. Claim 85 only after a real external low-friction `--goal` journey carries exact direction to DONE without explicit session or status finalizer repair.

## Done when

- missing/malformed/oversized/non-regular PRODUCT.md fails before worker/workspace activity;
- v2 sessions store exact bytes and matching raw-byte digest;
- fake-worker prompt receives those exact bytes first;
- repair and resume keep unchanged snapshot bytes while live file is unchanged;
- live-file change or deletion blocks resume with the stated product message;
- PRODUCT.md mutations are controller-rejected even if listed as allowed;
- new init does not write phase-map;
- focused and complete tests remain green;
- 85 is claimed only after real external direction-carrying DONE.

## Stop only if

Product-direction format debate expands into a schema platform, phase-map cleanup becomes a multi-system rewrite, unique owner work would be endangered, or protected access is required.
