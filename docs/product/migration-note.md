# Meta-Harness 0.4 Migration Note

Meta-Harness 0.4 is a breaking outcome-first DELIVERY release.

## Changed behavior

- Locked product intent and owner authority outrank status and roadmap prose.
- The planner defaults to zero pre-execution audits, begins the nearest reversible action in the same round, and permits one bounded audit only with a complete warrant; that audit is an absolute ceiling, not a route, phase, approval gate, or pause.
- Only demonstrated journey prevention, material conclusion invalidation, credible irreversible loss, or supported-platform unusability blocks.
- Passed evidence is reused while its declared inputs are unchanged.
- Worker reports begin with the five product fields before `Outcome:` or internal metadata.
- Terminal completion returns `NO_BUILD` and `USE_PRODUCT` unless owner scope change or a complete observed supported-use defect warrant exists.
- The installed runtime exposes DELIVERY authority only.

## Removed behavior

Historical alternate authority objects, executable paths, state stages, capabilities, and package surfaces are removed rather than migrated. Old tracked files remain inert historical evidence and have no authority effect.

## Adoption

Do not install an older bootstrap tarball. Build the exact H3 package once, prove it in one clean canary, and reuse that package for every clean default-branch worktree. Inspect and integrate each repository separately. Existing dirty checkouts are not installation targets.
