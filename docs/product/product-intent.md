# Product Intent Anchor

Status: **locked, human-authored, append-only**
Version: `intent-v1`
Effective date: 2026-07-17
Authority: product owner

## Verbatim Original Intent

> the project intent is "solo dev + researcher", object is "ultra complex multi module system + expertise application", view is "minimal script + skills based", maximize human + AI (coding + knowledge input (learning module later) + product shipping output maxed) collaboration. revise endgame and roadmap first, maximum velocity (coding + audit loop automation/ multi agent orchaestration), minimal friction (authorization, so on)+ jargon (編號based scope during planning), problem solving facing (top level PM)building each and every modular functional slice;

This block is the primary intent authority. AI workers, auditors, planners, generators, and migrations must not summarize, paraphrase, rewrite, or silently reinterpret it as a replacement source.

## Operational Interpretation

Meta-Harness exists for one solo developer/researcher shipping ultra-complex, multi-module systems that require both software engineering and specialist knowledge.

The system maximizes:

1. verified product progress per unit time;
2. useful application of human and external expertise;
3. AI coding, research, audit, integration, and shipping throughput;
4. continuity across long, interrupted, or multi-agent work;
5. minimal human intervention outside taste, authority, material risk, scope expansion, and irreversible commitments.

`Minimal script + skills based` means:

- keep the owned execution substrate small;
- encode reusable expertise as explicit, versioned skills and contracts;
- borrow general agent execution from Codex, OpenHands, Aider, CI, or later proven substrates;
- do not confuse minimal code with passive status documents;
- do not build generic orchestration infrastructure before a functional slice demonstrates the need.

## Priority Order

When trade-offs are required, preserve this order:

1. Ship the active product outcome.
2. Unlock the critical path to that outcome.
3. Reduce uncertainty blocking that path.
4. Preserve original intent and global system invariants.
5. Apply the correct expertise to the product behavior.
6. Reduce human friction and elapsed calendar time.
7. Improve the harness only when it blocks items 1–6.

## Non-Negotiables

- Work is organized as numbered, end-to-end functional slices, not horizontal infrastructure programs.
- The primary view is the top-level product problem and shipping result.
- No silent intent, scope, roadmap, authority, or evidence drift.
- Audit is frozen before planning begins.
- The original intent is read before local defects are prioritized.
- One canonical fact layer owns decision-critical truth; status and summaries are generated projections.
- A fresh worker must be able to continue from validated artifacts rather than conversation memory.
- Workers execute all reversible work already authorized; they do not wait for routine approval.
- Human gates are named, typed, minimal, and skipped whenever a valid authorization envelope already covers the action.
- The controller owns state, custody, mutation authority, leases, cancellation, and loop integrity.
- The worker owns bounded execution, not roadmap authority.
- Independent verification is required before integration or shipping claims.
- Multi-agent fan-out begins only after single-worker handoff and resume are proven.
- Test success alone is not product success; shipping effect, rework, escaped defects, and user-visible capability matter.
- No backward-compatible runtime surface is added by default. Historical evidence remains readable through versioned schemas or one-way migration.

## Human Ownership

Only the human may change:

- product intent;
- priority ordering;
- taste;
- material risk tolerance;
- scope beyond the authorized outcome;
- irreversible commitments;
- publication, credentials, protected boundaries, and equivalent authority.

A change requires a named `G-TASTE`, `G-SCOPE`, `G-RISK`, or `G-AUTHORITY` decision and a new append-only intent version. Prior versions remain available.

## Taste Signals

### Right

- Prefer one small slice that creates newly observable product behavior over a broad framework.
- Aggressively re-plan when evidence shows a faster path to the endgame.
- Delete obsolete active paths rather than preserve compatibility without a proven user need.
- Use plain PM language and short numbered scope identifiers.
- Automate audit, coding, verification, continuity, and shipping where evidence supports it.

### Wrong

- Treat documentation, governance packets, dashboards, or internal completeness as product shipping.
- Let an audit of local defects replace the original outcome as the roadmap.
- Add another approval stage when a bounded authorization envelope already exists.
- Build multiple adapters, a daemon, a queue, or a swarm before one real slice proves the need.
- Optimize token count, test count, or internal score while product delivery slows.

## Known Drift Patterns

- Audit gravity: recent defects become the roadmap even when they do not block shipping.
- Governance gravity: the system optimizes its own safety machinery instead of the product.
- Summary recursion: each handoff summarizes the previous summary until original intent disappears.
- Local optimization: a module becomes cleaner while a cross-module product invariant breaks.
- Activity substitution: more agents, plans, tests, or artifacts are counted as progress.
- Completion dilution: `locally implemented`, `merged`, `released`, and `user-observed` are treated as equivalent.
- Compatibility inertia: obsolete paths remain because deletion feels risky despite no active consumer need.

## Shipping Definition

Every objective must explicitly select its terminal shipping state:

- locally integrated;
- merged;
- packaged;
- released;
- deployed;
- externally validated;
- user-observed.

The loop may not silently stop at an easier state.

## Injection and Validation Rule

The active intent version and content hash must be attached to every:

- audit;
- plan;
- RunSpec;
- handoff;
- resume;
- outcome;
- roadmap change;
- scoring-policy evaluation.

A recommendation must explain how it advances the active intent. A harness-internal recommendation must also answer:

> Which active product slice cannot ship without this harness change?

If it cannot answer, defer the harness change.

## Owner Amendment — intent-v2-minimal-outcome

Effective date: 2026-08-02
Status: owner-directed append-only amendment

This amendment does not replace the verbatim original intent. It narrows the operating interpretation to reduce friction, audit gravity, and model-generation-specific scaffolding.

Where this amendment conflicts with earlier operational interpretation, non-negotiables, human-ownership procedure, injection requirements, or approval language, this later owner amendment governs. The verbatim original intent remains unchanged and highest authority.

### Product-first operating model

The normal loop is:

```text
PLAN -> WORK -> AUDIT -> CLOSE
```

`RESEARCH` is conditional on one named decision. `RETROSPECT` is event-triggered after closure, route abandonment, repair-budget exhaustion, repeated cross-repository failure, a major model change, or explicit request. `HANDOVER` is generated state, not a reasoning round.

The primary unit of progress is a real Product Episode: a real user in a supported environment completes the declared task, receives an observable result, and can make the next product or domain decision from it.

Acceptance proceeds in this order:

1. Product proof — the real Episode produces a useful and interpretable result.
2. System proof — the result comes from the intended reusable architecture and preserves critical invariants.
3. Release proof — the exact artifact installs, publishes, deploys, and rolls back correctly where required.

System and Release proof cannot substitute for missing Product proof.

### Notification-first action policy

Reversible work proceeds automatically and is reported. Routine owner records, hierarchy stamps, reviewer availability, status updates, branch creation, tests, commits, and branch push do not create approval waits.

External or irreversible operations are announced before execution and remain subject to configured technical safety boundaries. Existing user work is never stashed, reset, cleaned, overwritten, force-pushed, or mixed into the active slice.

### Clean isolated execution

The system inspects the repository, preserves the current checkout, creates a clean isolated worktree from the intended base, creates a deterministic slice branch, executes, validates, commits, and pushes automatically when configured. Dirty user checkouts are preserved rather than treated as blockers or installation targets.

### Role separation

- PLAN freezes one product claim, real Episode, and smallest complete slice.
- WORK executes the frozen slice and does not re-plan the roadmap.
- AUDIT evaluates only the current slice and does not select a successor.
- RESEARCH resolves one decision and transfers only the selected COPY/MODIFY/REJECT record.
- RETROSPECT produces non-authoritative KEEP/DELETE/SIMPLIFY/TEST/INVESTIGATE candidates.

No role automatically opens a successor slice after closure.

### Engineering language

Default reasoning language is problem, observation, inference, unknown, cause, constraint, option, trade-off, experiment, decision, result, and next Episode. MECE, 5W1H, first-principles analysis, and style fingerprints are adaptive tools, not mandatory forms.

Gate, authority, custody, and closure language is reserved for actual deterministic security, exact artifact identity, irreversible external actions, secret access, financial or legal commitments, or material production blast radius.

### Future-proof constraint law

Models own reversible judgment. Tests own correctness. Skills own reusable procedures. Hooks own deterministic invariants. Sandboxes and external controls own blast radius.

Every retained non-security constraint requires an originating failure, regression fixture, last demonstrated value, and deletion condition. Challenge constraints after major model upgrades, at least quarterly, or when they have not affected several real slices. Delete rules whose removal causes no material regression.
