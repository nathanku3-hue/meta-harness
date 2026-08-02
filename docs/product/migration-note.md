# Meta-Harness Migration Note

## 0.4 release boundary

Meta-Harness 0.4 H3R2 remains an exact outcome-first DELIVERY release candidate. Complete its supported-runtime fresh-session Product Episode, terminal assessment, exact tag/publication, and closure without rebuilding or mixing in the redesign below.

## 0.5 operating-model break

The next release intentionally removes or demotes orchestration concepts that create friction without improving real Product Episodes.

### New normal flow

```text
PLAN -> WORK -> AUDIT -> CLOSE
```

- PLAN freezes one Slice Charter.
- WORK executes it in a clean isolated worktree.
- AUDIT evaluates the current slice only.
- CLOSE stops; it does not invoke another PLAN automatically.

RESEARCH and RETROSPECT are conditional. HANDOVER is generated state.

### New product acceptance

Acceptance is separated into:

1. Product proof;
2. System proof;
3. Release proof.

A real Product Episode is required before internal verification or release ceremony can claim product completion.

### New action policy

Reversible local actions proceed automatically and are reported. Missing routine owner records, hierarchy stamps, reviewer availability, or status updates do not create approval waits.

External or irreversible actions are announced before execution and remain subject to configured technical safety boundaries.

### New Git behavior

The system preserves the current checkout and creates a clean isolated worktree automatically. It detects the actual default branch, creates a deterministic slice branch, executes, validates, commits, and configured-pushes from isolation.

The system never auto-stashes, resets, cleans, overwrites, force-pushes, rewrites shared history, or mixes unrelated user work.

### New context behavior

Fresh sessions load a concise product anchor, one role skill, and the active Slice Charter. Status, events, worker reports, and historical summaries become supporting evidence rather than roadmap authority.

### New research behavior

Research opens only for one named decision. Reports use rejection-first citations and COPY/MODIFY/REJECT classification. WORK receives only the selected Research Decision Record.

### New retrospective behavior

Retrospective runs only after closure, abandonment, budget exhaustion, repeated failure/intervention, major model change, or explicit request. Findings are non-authoritative Meta-Harness candidates.

## Removed active behavior

No backward compatibility is required for:

- audit and successor planning in one session;
- worker roadmap re-planning;
- automatic successor slices;
- mandatory phase choreography;
- score-first worker reports;
- universal owner-approval waits for reversible work;
- evidence-only and lifecycle-fragment product slices;
- universal Product/Domain/Custody treatment for diagnostics;
- full research surveys injected into coding context;
- mandatory retrospective after every round;
- status or event `next_action` acting as roadmap authority.

Historical artifacts remain readable where useful, but their retired process semantics are inert.

## Adoption order

1. close 0.4 exactly;
2. implement clean-worktree Git autopilot and PLAN/WORK/AUDIT separation;
3. introduce Slice Charter, Result Record, and generated handover;
4. separate Product/System/Release proof;
5. add conditional RESEARCH and RETROSPECT;
6. delete obsolete routers, reports, phases, and constraints;
7. challenge remaining constraints against stronger models.
