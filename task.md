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

- [x] Extracted the existing identity comparison from `lib/contracts/execution-readiness-facts.js`; RunSpec and readiness consumers reuse it.
- [x] Added one pure comparator; no second authority architecture.
- [x] Integrated raw-input recomputation into the existing worker-entry surface.
- [x] Added no public command.
- [x] Repository files remain observed facts only.
- [x] Expected identity accepts only classified controller RunSpec, authenticated trusted-operator, signed canonical, or immutable-evidence sources.
- [x] Checkout-local self-promotion and arbitrary unclassified strings block.
- [x] Pure evaluation remains read-only, process-free, network-free, and mutation-free.

## Required proof

### Meta-Harness

- [x] stale primary checkout → `REDIRECT`;
- [x] accepted candidate authority → `PASS_CURRENT`;
- [x] checkout-local declaration alone → `BLOCK`.

### Quant

- [x] contaminated primary checkout → `REDIRECT`;
- [x] exact F1A authority worktree → `PASS_CURRENT`.

### Leningrad

- [x] contaminated research checkout with unversioned Alpha 0 bytes → `CUSTODY_REQUIRED`.

For every proof run record:

- [x] elapsed time;
- [x] input context size;
- [x] authority-resolution hops;
- [x] human questions;
- [x] exact result;
- [x] recovered product next action.

## Verification

- [x] focused entry-authority contract passes under Node `25.2.1`;
- [x] affected readiness, execution-custody, and worker-entry suites pass 64/64;
- [x] complete suite passes 124/124 test files; connector 502 was isolated from the still-running local process and final log;
- [x] evidence JSON parses;
- [x] `git diff --check` and committed `git show --check` pass;
- [x] canonical event, status, roadmap, product spec, SOP, plan, and focused contract agree;
- [x] one immutable R3 candidate is pushed and execution stops for independent exact-commit audit.

## Forbidden scope

No repository registry, automatic branch promotion, worktree creation, cleanup, migration, GC, pruning, deletion, dashboard, daemon, database, scheduler, queue, generic router, portfolio manager, broad strict-readiness repair, backward compatibility for superseded entry mechanisms, Finance F1B implementation, other external product implementation, provider work, real data, live capital, broker access, deployment, or publication.

## Stop rule

Stop on any authority source supplied by the evaluated checkout; any result outside the four-value taxonomy; duplicated execution-custody logic; mutation, process execution, or network access in the pure evaluator; scope expansion; or failure to reproduce the required three-repository outcomes. After a clean pushed R3 candidate, stop for independent exact-commit audit.
