# Meta-Harness Current Product State

State: VALIDATED_GOAL_1_COMPLETE
Current checkout: `integration/post-0.4`
Accepted product score: `82/100`

## Product result

A solo developer can state one coding result through `meta-harness work --goal`. Meta-Harness now requires controller-owned external validation before it creates a workspace or launches the coding worker, carries that exact validation through repair, and reports a terminal product result without treating worker narrative as proof.

## Current state

- The prevention-pilot stream and Quant operation remain historical evidence, not the roadmap.
- `meta-harness work` remains the only public command and the default product surface.
- A standalone `--goal` resolves a regular root `package.json` `scripts.test` into exact `npm test` validation.
- Missing, malformed, empty, symlinked, or placeholder root validation returns terminal `BLOCKED` before workspace creation, worker launch, or repository mutation.
- The exact controller validation is included in the coding prompt, executed outside the model, and returned to the same sealed session for bounded repair after failure.
- Clean, coherent-dirty, isolated-dirty, resume, exact-path delivery, and Git/path/index/HEAD boundaries remain enforced.
- WSL-mounted repositories use native Git; Windows-spelled repositories may use Windows Git when available.
- The web-originated operation ended terminally as `BLOCKED`; it is not still running and is not counted as a successful delivered goal.
- Closure verification passes 112 test files and 768 tests with zero failures, plus focused validation, sync, whitespace, and package dry-run checks.
- Quality observation retains inherited repository-wide ratchet debt. The validated-goal files add no new coding-module budget violation, so unrelated cleanup is not the active product work.
- The installed template manifest contains the verified `work-session-v1.md` hash `16a0982742033a655a39c28915ee3cdadee4c6b2ce9bb689d01498ae45ea3d87`.

## Do now

No active slice. Use `meta-harness work` and wait for observed real-use friction. Do not open `TRUST-BOUNDARY-1` or another successor from this closure alone.

## Done when

- standalone `--goal` cannot proceed without usable controller-owned validation;
- unsupported validation blocks before workspace creation, worker launch, or mutation;
- failed validation returns to the same sealed session for bounded repair;
- focused and complete tests pass;
- sync, whitespace, package dry-run, and quality observation are reconciled;
- the exact closure paths are committed and `origin/integration/post-0.4` equals local HEAD;
- product truth remains at `82/100` until a real web-originated validated goal reaches `DONE` with an observable result.

## Stop only if

A required validation command cannot run, the accepted path boundary is insufficient, unique owner work would be endangered, protected access is required, or repository evidence proves the requested result materially unsafe or impossible.
