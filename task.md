# Active Task: D089 R3 Entry Authority Invariant

Current proof state:

```text
ROADMAP_PROOF_SCORE = 40 / 100
S-006M_EXTERNAL_LOOPS_SHIPPED = 0 / 1
```

## Authority

- [x] D088-R1 exact candidate `579c0dd04b846963b4e8fad2339317750a767eda` accepted by independent exact-commit audit.
- [x] D089 controller receipt `D089-D088-R2-ACCEPTANCE` activates D088.
- [x] R2A minimal owned layer accepted.
- [x] R2B three-repository read-only proof accepted.
- [x] R2C `ENTRY_AUTHORITY_INVARIANT` selected and accepted.
- [x] D087 retained as historical candidate reasoning.

## R3 product behavior

Before product planning, Meta-Harness determines whether the opened checkout is the trusted place to continue.

Input:

```text
externally trusted expected repository identity
+ read-only observed checkout facts
```

Output — exactly one:

```text
PASS_CURRENT
REDIRECT — exact path/ref/commit
CUSTODY_REQUIRED — product bytes lack named Git authority
BLOCK — trusted expected identity is absent or contradictory
```

## Implementation boundary

- [ ] Reuse or extract existing identity comparison from `lib/contracts/run-spec.js`, `lib/contracts/execution-readiness-facts.js`, `lib/contracts/workspace-start.js`, and existing readiness/entry infrastructure.
- [ ] Add one pure comparator; do not add a second authority architecture.
- [ ] Integrate into the existing `ready` or worker-entry surface.
- [ ] Add no public command unless the existing surface cannot express the accepted result cleanly.
- [ ] Treat repository files as observed facts only.
- [ ] Accept expected identity only from a controller-authorized RunSpec, authenticated trusted-operator boundary, signed canonical event or receipt, or independently anchored immutable evidence.
- [ ] Reject checkout-local self-promotion and arbitrary unclassified CLI strings.
- [ ] Preserve read-only, no-process, no-network, no-mutation behavior in the pure evaluator.

## Required proof

### Meta-Harness

- [ ] stale primary checkout → `REDIRECT`;
- [ ] accepted candidate authority → `PASS_CURRENT`;
- [ ] checkout-local declaration alone → `BLOCK`.

### Quant

- [ ] contaminated primary checkout → `REDIRECT`;
- [ ] exact F1A authority worktree → `PASS_CURRENT`.

### Leningrad

- [ ] contaminated research checkout with unversioned Alpha 0 bytes → `CUSTODY_REQUIRED`.

For every proof run record:

- [ ] elapsed time;
- [ ] input context size;
- [ ] authority-resolution hops;
- [ ] human questions;
- [ ] exact result;
- [ ] recovered product next action.

## Verification

- [ ] focused entry-authority contract passes under Node `25.2.1`;
- [ ] affected readiness, execution-custody, and worker-entry suites pass;
- [ ] complete suite passes or any connector-bound failure is isolated with exhaustive grouped evidence;
- [ ] evidence JSON parses;
- [ ] `git diff --check` and committed `git show --check` pass;
- [ ] canonical event, status, roadmap, product spec, SOP, plan, and focused contract agree;
- [ ] one immutable R3 candidate is pushed and execution stops for independent exact-commit audit.

## Forbidden scope

No repository registry, automatic branch promotion, worktree creation, cleanup, migration, GC, pruning, deletion, dashboard, daemon, database, scheduler, queue, generic router, portfolio manager, broad strict-readiness repair, backward compatibility for superseded entry mechanisms, Finance F1B implementation, other external product implementation, provider work, real data, live capital, broker access, deployment, or publication.

## Stop rule

Stop on any authority source supplied by the evaluated checkout; any result outside the four-value taxonomy; duplicated execution-custody logic; mutation, process execution, or network access in the pure evaluator; scope expansion; or failure to reproduce the required three-repository outcomes. After a clean pushed R3 candidate, stop for independent exact-commit audit.
