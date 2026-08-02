# Meta-Harness

Meta-Harness is a minimal, outcome-first operating layer for one solo developer/researcher shipping complex products with AI.

The normal flow is:

```text
PLAN -> WORK -> AUDIT -> CLOSE
```

Optional research and retrospective lanes are opened only when a named decision or a costly failure justifies them. Handover is generated state, not another reasoning round.

## Product result

Meta-Harness should help a user:

1. define one real Product Episode;
2. preserve the current checkout;
3. create a clean isolated worktree automatically;
4. execute the smallest complete product slice;
5. run the real Episode early;
6. reuse unchanged evidence;
7. make one smallest repair or re-plan the method;
8. prove the system and release only after Product proof;
9. stop after the result is useful.

## Proof order

```text
Product proof
-> System proof
-> Release proof
```

- Product proof: a real user completes a real task and receives a useful, interpretable result.
- System proof: the result comes from the intended reusable architecture and preserves affected invariants.
- Release proof: the exact artifact installs, publishes, deploys, and rolls back where required.

Tests, packages, hashes, reviews, and custody cannot substitute for a missing real Product Episode.

## Roles

- **PLAN** frames the product problem and freezes one Slice Charter.
- **WORK** executes the charter in a clean isolated worktree and does not redesign the roadmap.
- **AUDIT** evaluates only the current slice and cannot select a successor.
- **RESEARCH** resolves one named decision and transfers only a COPY/MODIFY/REJECT record.
- **RETROSPECT** runs only after closure or costly failure and produces non-authoritative KEEP/DELETE/SIMPLIFY/TEST/INVESTIGATE findings.

## H3R2 worker-report compatibility

The existing 0.4 runtime keeps these first five non-empty lines, with no title or internal metadata before them:

```text
User journey executed:
Observable result produced:
User accomplished or learned:
Product blocker:
Next executable product action:
```

The 0.5 target renders the simpler Result Card for normal chat while retaining exhaustive evidence outside the primary user surface.

## Notify-first actions

Reversible local work proceeds automatically and is reported:

- isolated worktree and branch creation;
- edits and tests;
- focused commit creation;
- configured branch push.

Existing user work is never auto-stashed, reset, cleaned, overwritten, force-pushed, or mixed into the slice.

External or irreversible actions are announced before execution and remain subject to configured technical safety boundaries:

- merge to a protected shared branch;
- tag or package publication;
- production deployment;
- destructive migration;
- shared-history rewrite;
- secret use;
- financial or legal commitment.

Notification does not become an approval wait unless a configured hold exists.

## Git autopilot

Before work, Meta-Harness should detect the repository root, actual default branch, upstream, HEAD, dirty state, and existing worktrees. It preserves the current checkout and creates a clean isolated worktree from the intended base. It then creates a deterministic slice branch, executes, validates, commits, and pushes when configured.

A dirty current checkout is not a blocker. It is a reason to isolate.

## Engineering language

Use problem, observation, inference, unknown, cause, constraint, option, trade-off, experiment, decision, result, smallest correction, and next Episode.

Use gate, authority, custody, and closure language only for deterministic security, exact artifact identity, irreversible external action, secret access, financial or legal commitment, or material production blast radius.

## Product-specific Episodes

- **Leningrad:** complete the declared simulation, verify retained evidence, inspect the report, and learn what persisted, coexisted, or disappeared.
- **Quant:** complete a prospective paper strategy Episode through thesis, decision, portfolio transition, fills, accounting, reopen, and explanation.
- **DevSpace:** complete the real conversation-to-conversation action and return a useful structured result.
- **Meta-Harness:** a fresh session resumes the correct product outcome, executes in isolation, and stops after a useful result without a long prompt or successor drift.

## Current release frontier

Meta-Harness 0.4 H3R2 remains the exact release candidate. Finish its supported-runtime fresh-session Product Episode, terminal assessment, exact publication, and closure before implementing the 0.5 simplification roadmap.

Do not mix the redesign into the H3R2 artifact.

## Canonical documents

- [Product Anchor](docs/product/product-anchor.md)
- [Product Intent](docs/product/product-intent.md)
- [Product Requirements](docs/product/prd.md)
- [Product Specification](docs/product/product-spec.md)
- [Top-Level Roadmap](docs/product/roadmap.md)
- [Minimal Outcome Operating Model](docs/product/minimal-outcome-operating-model.md)
- [Detailed Update Checklist](docs/product/minimal-outcome-update-checklist.md)
- [Operating SOP](docs/sop/meta-harness-sop.md)

Historical decision logs, phase plans, audits, and evidence remain historical sources. They do not override the active documents above.
