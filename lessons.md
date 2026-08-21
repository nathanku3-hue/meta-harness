# Meta-Harness durable lessons

These are architecture lessons worth carrying across future Meta-Harness work. This file is not a status log, roadmap, test transcript, or replacement for owner-authored `PRODUCT.md`.

## Authority and continuity

- Durable truth should remove human transport. If correct continuation requires an old chat, pasted handoff, worker prompt, or planner narration, the harness still owns an unresolved continuity defect.
- Model output is evidence or a proposal until a narrow controller boundary grants authority. Planner candidates, worker reports, research promotion, and semantic challenges must not silently become capability, owner authority, or canonical product truth.
- Commitments deserve durability; possibilities usually do not. Claim/session visibility is the point where disposable planning becomes recoverable work.
- Execution may be parallel and completion order nondeterministic while authoritative product/World truth remains linear. Correctness comes from current-truth reinterpretation and atomic authority, not aesthetic scheduling order.

## Mechanical boundaries

- Prefer current authoritative state as the ratchet baseline over manually refreshed freshness snapshots. A baseline that must be periodically blessed becomes a lifecycle tax and eventually blocks already-accepted history.
- A candidate must be evaluated under the predecessor's exact policy. Never let a candidate weaken, widen, or reinterpret the rules used to judge that same candidate.
- Canonical checks should compare normalized facts derived from the exact candidate/predecessor trees. Runtime-global registries, mutable checkout state, timestamps, prose diagnostics, and operator-maintained snapshots are unsuitable as canonical evidence unless the contract explicitly makes them authoritative.
- Grandfather old debt only by exact predecessor presence. New debt, growth of grandfathered debt, or newly introduced forbidden structural facts should fail without requiring cleanup of unrelated historical debt.
- Run cheap deterministic rejection before expensive model or retained semantic proof. Add model review only when mechanical checks have a demonstrated false-negative class that justifies its cost.

## Simplicity and deletion

- Use the smallest state that survives the failure being solved. Events can wake reconciliation without becoming durable scheduler state; content-addressed evidence can cache research without creating a research organization; a pure tree delta can replace a mutable quality-baseline lifecycle.
- Replaceability does not imply framework-first design. Introduce a port, provider layer, queue, reviewer topology, retrieval system, or policy language only after a second real implementation or observed failure makes the seam valuable.
- When an old abstraction loses its active responsibility, remove it from the hot path rather than preserving it as a renamed compatibility layer. Historical readers may remain when they are needed to interpret already-banked evidence.

## Evidence and research

- Source material, promoted research, execution learning, and authority are different layers. Preserve provenance instead of collapsing them into one belief/constraint ontology prematurely.
- Exact attribution should be mechanically reopenable from immutable bytes where possible. Mechanical attribution proves what the source said; it does not pretend the kernel can prove every promoted semantic statement true.
- Contradictory research may coexist as advisory evidence. Product direction, current World/authoritative execution learning, and active Claims outrank promoted research.

## Review trigger

- Structural protection is cheap enough to run continuously when deterministic. Semantic review should remain risk-triggered and evidence-driven; ordinary clean integrations should pay zero model-review tax until real use proves otherwise.
