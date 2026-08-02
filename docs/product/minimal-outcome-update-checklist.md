# Minimal Outcome System Update Checklist

Status: owner-directed implementation checklist after Meta-Harness 0.4 terminal closure

## A. Preserve current release identity

- [ ] Keep H3R2 source, commit, tarball, mechanics evidence, and canary evidence immutable.
- [ ] Complete the pending supported-runtime fresh-session terminal Episode.
- [ ] Complete one terminal product/system/release assessment using the same tarball.
- [ ] Publish and tag only the exact proven artifact; do not rebuild.
- [ ] Record any Node-version warning separately from product failure.
- [ ] Do not mix the 0.5 operating-model redesign into H3R2.

## B. Replace the normal control loop

- [ ] Make the only normal sequence `PLAN -> WORK -> AUDIT -> CLOSE`.
- [ ] Prohibit PLAN and AUDIT authority in the same session.
- [ ] Prohibit WORK from changing roadmap, acceptance, or score.
- [ ] Prohibit AUDIT from selecting a successor slice.
- [ ] Prevent automatic PLAN invocation after closure.
- [ ] Return `STOP_NO_BUILD` when no new real product result is warranted.
- [ ] Keep one repair candidate maximum before method re-evaluation.
- [ ] Remove evidence-only, documentation-only, packaging-only, review-only, integration-only, and status-only product slices.

## C. Create lean role skills

- [ ] Create one PLAN skill.
- [ ] Create one WORK skill.
- [ ] Create one AUDIT skill.
- [ ] Create conditional RESEARCH and RETROSPECT skills.
- [ ] Create one shared adaptive engineering-reasoning skill.
- [ ] Create one concise communication-style skill.
- [ ] Keep root AGENTS instructions to role routing and truth precedence only.
- [ ] Load exactly one decision role per session.
- [ ] Remove duplicated scope-selector, ship-fast, decision-gate, and worker-contract prose when the role skills cover the behavior.
- [ ] Add fixtures proving each role refuses another role’s authority.

## D. Freeze the product context once

- [ ] Create one concise current product anchor containing endgame, frontier, non-goals, protected external actions, shipping state, and explicit roadmap deviations.
- [ ] Keep the full original intent and historical decisions available but outside normal context.
- [ ] Compile or generate status from current product authority; never let status create roadmap work.
- [ ] Make events historical observations only; remove their authority to define the next action.
- [ ] Load only the active frontier and relevant ancestors, not the entire roadmap.
- [ ] Bind every active slice to the current product-anchor digest or exact version.
- [ ] Detect and reject stale slice context when the product anchor changes.

## E. Replace prose handoff with typed artifacts

- [ ] Define a compact active Slice Charter.
- [ ] Include user, product claim, real Episode, current state, smallest action, success conditions, change boundary, reusable evidence, repair budget, notification points, and stop conditions.
- [ ] Define a compact Result Record.
- [ ] Include whether the Episode ran, observable result, user decision enabled, actual problem, changed paths, validations, reused evidence, assumptions, and deviations.
- [ ] Generate a handover from Slice Charter plus Result Record.
- [ ] Do not let handover reinterpret intent, score the project, or plan a successor.
- [ ] Keep detailed execution evidence available but outside normal chat and normal worker context.

## F. Make Product Episodes the primary acceptance surface

- [ ] Require every slice to name one real user or operator.
- [ ] Require one real task and one observable result.
- [ ] Require the result to enable a decision, understanding, or action.
- [ ] Mark Product proof as incomplete when only tests, fixtures, packages, schemas, or hashes exist.
- [ ] Run the smallest complete real Episode before broad release hardening.
- [ ] Record whether the Episode is supported, interpretable, and nontrivial.
- [ ] Add product-specific Episode fixtures for Leningrad, Quant, DevSpace, Eureka, and Meta-Harness itself.
- [ ] Prevent aggregate readiness scores from exceeding the Product-proof state.

## G. Separate Product, System, and Release proof

- [ ] Product proof: real task, real user, observable useful result.
- [ ] System proof: shared architecture, persistence/reopen/replay/correction, representative scale, changed invariants.
- [ ] Release proof: exact artifact, clean supported-runtime install, publication/deployment identity, rollback where needed.
- [ ] Prevent System or Release proof from substituting for Product proof.
- [ ] Permit Product proof to happen before optional packaging, terminology cleanup, broad custody, and duplicate verification.
- [ ] Apply terminal product review only to actual product candidates.
- [ ] Allow diagnostic findings to close with reproducibility, bounded scope, and decision usefulness.
- [ ] Treat deterministic documentation projection as a consequence of acceptance, not a new approval round.

## H. Replace gate language with engineering language

- [ ] Lead with problem, user, observation, cause, option, trade-off, experiment, decision, and result.
- [ ] Separate observed facts, inferences, and unknowns.
- [ ] Use MECE only to improve causal coverage.
- [ ] Use 5W1H only when missing context affects the decision.
- [ ] Compare use-as-is, smallest repair, and replace/simplify when the route is uncertain.
- [ ] Compare time to value, correctness risk, reversibility, blast radius, permanent complexity, operating burden, evidence reuse, learning value, and cost of delay.
- [ ] Require the cheapest discriminating experiment for material unknowns.
- [ ] State the decision, accepted trade-off, deliberate deferral, next executable action, and change-course condition.
- [ ] Reserve gate/authority/custody language for actual irreversible or deterministic protection boundaries.

## I. Make research decision-bound

- [ ] Open RESEARCH only when a named decision changes depending on external evidence.
- [ ] State decision, options, missing evidence, decision effect, and stop condition before research.
- [ ] Use primary sources for technical claims.
- [ ] Put rejection reason and citation first for every rejected repository.
- [ ] Classify each candidate as COPY, MODIFY, or REJECT.
- [ ] State exact files, patterns, concepts, dependencies, tests, and constraints to reuse.
- [ ] State what must not be imported.
- [ ] Pass only the selected Research Decision Record into WORK.
- [ ] Prevent broad research surveys from entering coding context.
- [ ] Permit mid-WORK research only after a concrete unknown blocks or materially changes the current method.

## J. Make retrospective event-triggered

- [ ] Trigger RETROSPECT only after closure, route abandonment, budget exhaustion, repeated intervention, repeated cross-repository failure, major model change, or explicit request.
- [ ] Diagnose product drift, velocity drift, human friction, obsolete constraints, and repeated process.
- [ ] Allocate causes among prompt, harness, worker/auditor loop, tooling, and external environment.
- [ ] Classify findings as KEEP, DELETE, SIMPLIFY, TEST, or INVESTIGATE.
- [ ] Store findings as non-authoritative improvement candidates.
- [ ] Require repeated failure or material irreversible risk before promoting a candidate into active harness work.
- [ ] Prohibit retrospective findings from reopening the product slice or adding gates to the next slice automatically.

## K. Adopt notify-first action policy

- [ ] Make reversible local actions automatic and report them afterward.
- [ ] Do not stop for routine owner records, hierarchy stamps, reviewer availability, status updates, branch creation, tests, commits, or branch push.
- [ ] Announce external or irreversible actions before execution.
- [ ] Keep hard technical prevention only for secret exposure, destructive mutation, history rewrite, publication/deployment blast radius, financial/legal commitment, or equivalent irreversible effect.
- [ ] Make user-configured holds explicit rather than inferred from generic owner-authority language.
- [ ] Ensure notification does not become another approval wait state.

## L. Automate clean-worktree Git operation

- [ ] Inspect repository root, current branch, default branch, upstream, HEAD, worktrees, and dirty state.
- [ ] Never require the user to clean the current checkout.
- [ ] Never auto-stash, reset, clean, or overwrite current user work.
- [ ] Create a clean isolated worktree from the intended base automatically.
- [ ] Use deterministic slice branch naming.
- [ ] Verify clean start and exact base revision.
- [ ] Keep edits, tests, package artifacts, and generated files inside the isolated worktree or declared external evidence path.
- [ ] Create one focused commit after coherent validation.
- [ ] Push the exact branch automatically when configured and available.
- [ ] Avoid force push and shared-history rewrite.
- [ ] Detect main/master/default branch rather than assuming `main`.
- [ ] Integrate each repository separately.
- [ ] Never blanket-install into dirty checkouts, archives, evidence folders, bootstrap copies, or managed worktrees.
- [ ] Reuse the exact proven package for rollout; never rebuild per repository.

## M. Reduce active reporting

- [ ] Replace score-first and gate-first reports with a Result Card.
- [ ] Result Card fields: Product question; real Episode executed; observable result; user learned/can do; validity; demonstrated defect; next product action.
- [ ] Omit round, progress, confidence, hashes, allowlists, command logs, and accountability booleans from normal chat.
- [ ] Show detailed evidence only on request or at an actual release/security boundary.
- [ ] Change score only when observable capability, demonstrated product problem, or terminal shipping state changes.
- [ ] Report `Score: unchanged` otherwise.

## N. Delete obsolete harness surface

- [ ] Inventory all commands, templates, hooks, context gates, reports, packets, phases, and checks.
- [ ] Map each item to an originating real failure and current regression fixture.
- [ ] Delete items with no current demonstrated value.
- [ ] Consolidate overlapping routers and contracts into role skills.
- [ ] Remove intake/plan/work/verify/synthesize/handoff/lookback ceremony from the normal coding loop.
- [ ] Demote expert packets, lookbacks, rollups, detailed review packets, and context scores to optional tools.
- [ ] Keep only exact identity, sandboxing, secret protection, irreversible-action control, and proven correctness checks as deterministic enforcement.
- [ ] Do not preserve backward compatibility for removed orchestration concepts without an active consumer.

## O. Build a future-proof constraint challenge

- [ ] Test historical scenarios using model+repo only, lean role skills, and full old harness.
- [ ] Delete rules when model+repo or lean skills achieve the same correct outcome.
- [ ] Keep a skill only when it changes a repeatable reasoning outcome.
- [ ] Keep a test only when behavior must be mechanically correct.
- [ ] Keep a hook only for a deterministic invariant.
- [ ] Keep sandbox/authority substrate only for real blast-radius control.
- [ ] Attach origin, regression, last demonstrated value, and deletion condition to every retained non-security constraint.
- [ ] Run the challenge after major model upgrades and at least quarterly.
- [ ] Prefer deleting constraints over adding compatibility layers.

## P. Acceptance scenarios for the minimal system

- [ ] Closed Eureka state returns STOP and does not plan another slice.
- [ ] Leningrad with no full Episode selects and runs the complete profile before more hardening.
- [ ] Quant reuses unchanged evidence and executes a prospective strategy Episode.
- [ ] A real product defect receives one smallest repair.
- [ ] A repeated failure forces method re-evaluation rather than R2/R3 recursion.
- [ ] A diagnostic closes without terminal product ceremony.
- [ ] Research rejects unsuitable repositories with citation first and transfers only the selected decision.
- [ ] Dirty user checkout remains byte-identical while WORK occurs in a clean isolated worktree.
- [ ] Git branch, commit, and push are automated without stashing, resetting, cleaning, force pushing, or rewriting shared history.
- [ ] Notification of an irreversible action does not create routine approval friction.
- [ ] A stronger model passes scenarios with fewer loaded rules, allowing deletion.

## Q. Documentation consistency

- [x] Update Product Intent with an append-only owner amendment and explicit amendment precedence.
- [x] Create the concise active `docs/product/product-anchor.md`.
- [x] Update PRD, Product Specification, Roadmap, SOP, README, migration note, architecture map, role contracts, task, implementation plan, root `AGENTS.md`, and current status.
- [x] Mark historical decision logs, audits, and phase plans as historical rather than rewriting them.
- [x] Remove stale active canonical-document guidance that requires universal owner authorization, universal terminal review, score-first reports, or automatic successor planning.
- [x] Verify Markdown links, conflict markers, `git diff --check`, focused contract/sync/package tests, and the complete Node 25 suite.
- [ ] Update packaged role skills and installed copies only in the 0.5 implementation slice, with manifest regeneration and sync checks; do not mix them into H3R2.
- [ ] Add a dedicated documentation test ensuring every active canonical document agrees on the normal flow and Product/System/Release proof order.
- [ ] Preserve this documentation change on a focused branch and push it without changing the H3R2 candidate.

## R. Final deletion test

Before adding any new Meta-Harness mechanism, answer:

1. Which real Product Episode cannot complete without it?
2. What repeated failure demonstrates the need?
3. Why can a repository fact, model judgment, existing test, or small role skill not solve it?
4. What permanent complexity does it add?
5. What is its deletion condition?

If these cannot be answered, do not build it.
