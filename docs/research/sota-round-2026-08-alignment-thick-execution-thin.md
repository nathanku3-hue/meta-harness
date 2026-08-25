# SOTA Research Round — Alignment Thickens, Execution Thins

Research timestamp: 2026-08-10 America/Los_Angeles
Status: research conclusion / falsifiable product hypothesis; no runtime authorization

## Research question

What should Meta-Harness learn from the current coding-agent frontier without violating its existing product direction: one accepted software result, exact owner direction, a thin coding path, controller-owned validation, bounded repair, KISS, long-term maintainability, and no patch-driven accumulation?

The user hypothesis for this round is:

> The requirement-alignment side will become thicker while the requirement-implementation side becomes thinner.

The research question is therefore not “which agent framework should Meta-Harness copy?” It is:

1. Which frontier patterns reduce uncertainty about **what should be built**?
2. Which implementation-era ceremonies are becoming obsolete as coding agents improve?
3. Which failure signals justify changing the harness at all?
4. How can the harness improve without accumulating prompt/process debt?

## Executive conclusion

The hypothesis is directionally correct, with one important correction:

**Alignment should become richer in available instruments, not heavier as a mandatory pipeline. Implementation should become thinner by default, with extra review/orchestration activated only by demonstrated risk or failure.**

The frontier evidence points toward five durable principles:

1. **Treat misalignment as the primary pre-code uncertainty.** Multiple current skill systems now put interrogation/refinement at the front of the workflow. Matt Pocock explicitly calls misalignment the most common failure mode; Addy Osmani includes a one-question-at-a-time `interview-me` skill for underspecified requests.
2. **Use concrete artifacts to answer product questions, not to create ceremony.** A throwaway prototype can resolve interaction/design uncertainty faster than a longer specification. A questionnaire can externalize what must be learned from stakeholders. Perspective-guided questioning can expose blind spots without creating persistent “role agents.”
3. **Once the accepted result is clear, collapse toward direct execution.** The current Meta-Harness `work-session/v2` contract already contains the useful implementation boundary: product result, current journey state, do-now action, newly true behavior, done condition, stop conditions, allowed paths, and exact validation. A detailed implementation plan should not be mandatory when the coding worker can safely discover the route while executing.
4. **Before changing the harness, localize the failure.** The new “Model or Harness?” taxonomy makes the repair-assignment problem explicit: the visible failure may belong to the model, harness, tool/environment, user interaction, or grader. Patching the harness before locating the fault is exactly the patch-thinking this product should reject.
5. **Self-improvement must be bounded, attributable, and reversible.** Prime Agent’s useful lesson is not “add daemons and autonomous subagents.” It is the separation between immutable base instruction and small evidence-backed refinements with history/rollback. OpenRSI adds the equally important benchmark discipline: hold the model fixed to measure harness gain, and hold the harness fixed to measure model gain.

This round does **not** justify adding a swarm, daemon, generic provider layer, detailed planning pipeline, persistent multi-role organization, automatic taste mining, or autonomous prompt mutation.

## First-principles model

### 1. The expensive error is increasingly “build the wrong thing,” not “fail to type the code”

As coding models improve at long-horizon editing, repository navigation, test repair, and tool use, implementation uncertainty falls faster than product-intent uncertainty.

That changes where process has leverage.

Old defensive process often looked like:

```text
idea
→ long spec
→ detailed plan
→ task decomposition
→ implementation
→ reviews
→ repair
```

The emerging higher-leverage shape is:

```text
goal
→ resolve what the repository already knows
→ reduce only the remaining product uncertainty
→ freeze a small accepted-result contract
→ implement directly
→ exact validation
→ bounded repair
```

The important distinction is that “alignment gets thicker” does **not** mean every request gets more steps. It means the system has better instruments for the cases where words alone have not produced enough certainty.

### 2. Alignment work should be selected by uncertainty type

Use the cheapest instrument that can answer the unresolved question:

| Uncertainty | Cheapest useful instrument | Avoid |
| --- | --- | --- |
| Owner has not decided between product behaviors | one-question-at-a-time grilling | a full plan before the decision exists |
| UI/interaction cannot be decided from prose | throwaway prototype | polishing prototype code into production by accident |
| Required knowledge lives with another person/team | stakeholder questionnaire | model inventing stakeholder preferences |
| Terminology/domain meaning is inconsistent | repo-grounded domain clarification | asking questions the repository already answers |
| A decision may hide a product/design/security/ops blind spot | bounded perspective challenge | persistent role-agent bureaucracy |
| Implementation route is uncertain but result/validation are clear | coding worker exploration | detailed speculative task decomposition |

### 3. A plan is a tool, not a stage

A detailed plan is justified only when it changes execution safety or correctness—for example, an irreversible migration, a cross-repository dependency sequence, or a change whose ordering is itself part of the product risk.

Otherwise, a detailed plan is increasingly a lossy re-description of work the coding agent can discover against the real repository.

For Meta-Harness, the current session contract should remain the default implementation boundary. Do not create a second planning contract unless a real delivery failure proves the existing one is insufficient.

## Adversarial first-principles review

Every attractive frontier pattern should survive these challenges before adoption.

### “More grilling is better”

Counterargument: questioning can become a tax, and agents frequently ask what they could have learned from the repository.

Rule: **repo before question**. Ask only when the answer is product judgment or external knowledge, not discoverable local fact. Stop as soon as the accepted result is executable and verifiable.

### “Prototype everything”

Counterargument: prototypes can become a parallel implementation track and create cleanup debt.

Rule: a prototype must name the decision it is meant to answer, be explicitly disposable, and terminate once that decision is resolved.

### “Add product/design/security agents to alignment”

Counterargument: role proliferation can simulate organizational theater without adding independent evidence.

Rule: start with **perspectives, not persistent agents**. A product/design/security/ops lens is a questioning frame. Promote it to a separate actor only when independent context, tools, or authority materially changes the result.

### “Use an adversarial coding graph by default”

Counterargument: Ranteck/graph-engineer currently describes an eight-node Claude↔Codex loop but explicitly labels itself design-stage and not end-to-end dogfooded. Its elevated review path is intentionally risk-triggered rather than default.

Rule: Meta-Harness should not replace its thin worker→validation→bounded-repair loop with a multi-node review graph without measured escaped-defect evidence. If adversarial review is adopted later, make it a risk-triggered tool, not a universal stage.

### “Self-improving harness means mutate the prompt continuously”

Counterargument: uncontrolled prompt/memory growth creates invisible behavior drift and maintenance debt.

Rule: owner product direction stays immutable. Any learned harness delta must be small, evidence-linked, reviewable, rollbackable, and measured against a fixed baseline. No automatic taste mutation.

### “More agents means more correctness”

Counterargument: multiple calls to the same model are correlated, and majority voting can erase a unique true finding. graph-engineer itself calls its same-model parallel lenses angle diversity, not independent verification.

Rule: fan-out must have a measured marginal benefit. Corroboration is evidence metadata, not truth by vote.

## Source-by-source findings

### Matt Pocock / skills

Primary source: https://github.com/mattpocock/skills

Useful signal:

- The repository is intentionally a set of small, adaptable, composable skills rather than a process-owning framework.
- It explicitly identifies misalignment as the common failure mode and puts `grill-me` / `grill-with-docs` at the front.
- `grilling` is factored as a reusable interview primitive instead of duplicating the method inside every workflow.
- `prototype` exists as a cheap concrete artifact for questions that are hard to settle in prose.
- `to-questionnaire` is now part of the user-invoked surface, reinforcing the move from “ask me what I mean” toward “help me discover what I need to ask other people.”

Meta-Harness lesson:

**Alignment primitives should be reusable and composable, but they should not own the implementation lifecycle.**

### Addy Osmani / agent-skills

Primary source: https://github.com/addyosmani/agent-skills

Useful signal:

- `interview-me` performs one-question-at-a-time requirement interrogation for underspecified asks.
- Skills are expected to be specific, verifiable, battle-tested, and minimal.
- Progressive disclosure keeps irrelevant skill content out of context.

Adversarial caveat:

The pack still models a broad DEFINE→PLAN→BUILD→VERIFY→REVIEW→SHIP lifecycle and can enforce mandatory skill hops. Meta-Harness should take the alignment and progressive-disclosure lessons without importing the full lifecycle as a default gate sequence.

### obra / superpowers

Primary source: https://github.com/obra/superpowers

Useful signal:

- Composable agent skills can carry a coherent engineering methodology across coding agents.
- It begins by clarifying what the user is actually trying to build.
- Skill behavior itself is evaluated rather than treated as static prose.

Adversarial caveat:

Its default methodology still proceeds from spec approval to a detailed implementation plan and subagent-driven development. That is useful as a conservative reference, but it is not evidence that Meta-Harness should restore detailed planning after deliberately thinning its execution path.

### Ranteck / graph-engineer

Primary source: https://github.com/Ranteck/graph-engineer

Useful signal:

- Separates orchestration/judgment from implementation and review roles.
- Mechanical gates are distinct from functional verification.
- Explicit retry/anti-loop ceilings are better than unbounded “keep reviewing.”
- Higher-assurance review is opt-in/risk-triggered.

Critical caveat:

The repository currently states that the eight-node cycle is **design-stage, adversarially reviewed, and not dogfooded end-to-end**. It should therefore be treated as a design reference, not SOTA production evidence.

Meta-Harness lesson:

**Keep the current simple execution loop. Borrow risk-triggered adversarial review only if real escaped defects justify it.**

### Prime Intellect / Prime Agent

Primary source: https://github.com/PrimeIntellect-ai/prime-agent

Useful signal:

- RLM: context as variables and recursive subagents as programmatic calls inside a persistent control environment.
- Continual Harness: supplemental prompts, memories, skill descriptions, and reusable subagent specifications can receive small evidence-backed updates.
- `/refine` does not rewrite the immutable base system prompt; refinement history supports rollback.

Critical caveat:

Prime Agent also deliberately includes background daemons, agent-to-agent communication, schedules, autonomous mode, and user-permission execution; its README explicitly says this is not a security sandbox.

Meta-Harness lesson:

**Adopt the immutability/refinement separation, not the runtime breadth.** `PRODUCT.md` is already the correct immutable owner layer. Any future learned layer should remain subordinate to it and require evidence plus rollback.

### Pi agent + Databricks harness benchmark

Primary sources:

- https://github.com/earendil-works/pi
- https://www.databricks.com/blog/benchmarking-coding-agents-databricks-multi-million-line-codebase

Useful signal:

- A comparatively small, self-extensible coding-agent harness can expose the agent loop, state management, and tool APIs without turning the workflow into a large process framework.
- The project separates coding-agent UI/runtime from the core agent loop and LLM API.
- Databricks' July 8, 2026 production-code benchmark reports that, with the same model and thinking effort, changing harness changed task cost by more than 2x in some comparisons while quality stayed the same; Pi sent about 3x less context per turn.
- Databricks grades with held-out executable tests rather than an LLM judge and seals Git history against solution leakage.

Meta-Harness lesson:

**Harness context is a first-class efficiency variable. Keep the model-facing working set thin and put durable coordination in repository/controller truth rather than repeated prompt context.**

### mini-SWE-agent

Primary source: https://github.com/SWE-agent/mini-swe-agent/blob/main/docs/index.md

Useful signal:

- mini-SWE-agent v2 presents a roughly 100-line agent core and reports more than 74% SWE-bench Verified.
- Its model surface is intentionally radical: bash is the only tool, history is linear, and actions are independent subprocess executions that are easy to redirect into sandboxes.
- The authors explicitly argue that much of the special tool/interface engineering emphasized in 2024 is no longer required to build a useful coding agent.

Meta-Harness lesson:

**Every permanent harness mechanism should justify why the model plus a simpler execution substrate cannot do without it.** Do not copy unrestricted bash; keep Meta-Harness's stronger authority/materialization boundary while applying the same deletion pressure to orchestration surface.

### Anthropic Managed Agents

Primary source: https://www.anthropic.com/engineering/managed-agents

Useful signal:

- Anthropic separates durable session context from the harness process and from execution containers; session context lives outside the model context window and can be re-read selectively.
- Their scaling model uses many stateless harnesses and provisions execution containers only when needed.

Meta-Harness lesson:

**Controller/tab processes should remain disposable.** Claim + WorkSession + World already provide the durable continuity needed here; do not add another session-log abstraction merely to imitate the implementation.

### Anthropic parallel Claude compiler experiment

Primary source: https://www.anthropic.com/engineering/building-c-compiler

Useful signal:

- Agents claim tasks with simple text-file locks, work in separate environments, and synchronize through Git.
- The prototype explicitly has no orchestration agent and no separate agent-to-agent communication mechanism.

Meta-Harness lesson:

Meta-Harness already has stronger primitives for the same need: **Claim is the durable task lock; isolated workspaces contain execution; serialized World integration carries completed facts. Workers do not need sibling chat.**

### DeepSeek Harness Code Runtime

Primary source: https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/code-runtime/code-runtime/README.md

Useful signal:

- Code Mode places model-written computation behind a narrow `run_code`-style surface and keeps intermediate binding traffic out of repeated model context.
- The shipped runtime is currently a worker-thread backend. DeepSeek's own documentation describes `isolation` as a diagnostic label rather than a security claim and states that a hard security boundary awaits a container backend.

Meta-Harness lesson:

**Thin model surface, thick deterministic substrate remains the useful pattern; worker-thread containment is not authority isolation.** Keep Meta-Harness's read-only worker and controller-owned materialization/validation boundary rather than moving model-written computation inside trusted authority.

### OpenAI Codex CLI

Primary source: https://github.com/openai/codex

Useful signal:

- The local Codex CLI is open source under Apache-2.0.
- The open implementation exposes a real local coding-agent substrate rather than requiring Meta-Harness to become its own generic model runtime.
- Codex also has a plugin/skills/MCP ecosystem, reinforcing the idea that domain capability should live in composable extensions rather than in one ever-growing harness prompt.

Meta-Harness lesson:

Continue treating Codex as an execution substrate behind a stricter controller boundary. Do not build a generic provider abstraction until a real product defect requires another substrate.

### Anthropic Claude Code

Primary source: https://github.com/anthropics/claude-code

This round intentionally does **not** use leaked or reverse-engineered proprietary Claude Code internals as design evidence. The public Anthropic repository and official documentation are sufficient for observable product/plugin patterns.

Meta-Harness lesson:

Public interfaces and reproducible behavior are admissible evidence. Leaked implementation details are not required for this product decision and would weaken provenance.

### xAI / Grok Build

Primary source: https://github.com/xai-org/grok-build

Useful signal:

- Grok Build publishes its Rust CLI/TUI and agent runtime.
- It supports headless operation plus Agent Client Protocol (ACP), skills, plugins, hooks, MCP, and sandboxing surfaces.

Meta-Harness lesson:

Agent interoperability is converging around external protocols/extensions. If Meta-Harness later needs another execution substrate, prefer a narrow existing protocol adapter over inventing a broad provider framework. No current defect requires that adapter today.

### Sentry for AI / Codex plugin

Primary sources:

- https://github.com/getsentry/sentry-for-ai
- https://github.com/getsentry/sentry-mcp

Useful signal:

- Sentry keeps one skill source tree and builds installable distributions for Claude Code, Cursor, Codex, and Grok.
- The same capability can combine skills with an MCP server rather than duplicating product logic inside each coding agent.

Meta-Harness lesson:

**One domain capability source, thin agent-specific packaging.** If Meta-Harness consumes domain plugins later, it should not fork Sentry-style knowledge into its own permanent prompt or add provider-specific copies.

### PraisonAI

Primary source: https://github.com/MervinPraison/PraisonAI

Useful signal:

- Demonstrates the full “agent platform” direction: multi-agent workflows, planning, self-reflection, memory, MCP, external coding-agent orchestration, background tasks, channels including Discord, and many workflow patterns.

Meta-Harness lesson:

This is mainly a **negative architecture reference** for the current product. Its breadth is legitimate for its product, but importing that breadth would recreate the framework/control-plane gravity Meta-Harness is explicitly trying to avoid.

### TencentCloud / Octop

Primary source: https://github.com/TencentCloud/Octop

Useful signal:

- Shows a single-process self-hosted assistant composing agent runtime, gateway/channels, memory, browser automation, ACP, cron, web UI, and multi-user state.

Meta-Harness lesson:

Again, breadth is not free. Discord/channels, cron, dashboard, multi-user state, memory services, and agent teams do not solve the current solo-developer coding journey and should stay out until an observed user journey demands them.

### FrontisAI / OpenRSI

Primary source: https://github.com/FrontisAI/OpenRSI

Strongest methodological signal of this round:

- OpenRSI explicitly tries to make AI-improving-AI measurable and attributable rather than just recursive.
- Its released results separate model gain from search/harness gain through controlled comparisons.
- It explicitly warns that end-to-end numbers are **model–harness results, not standalone one-shot model scores**.

Meta-Harness lesson:

Any future “harness improvement” claim should be tested by controlled comparison:

```text
same model + old harness
vs
same model + candidate harness
```

and, when evaluating a model change:

```text
old model + same harness
vs
new model + same harness
```

Without this, the product cannot know what actually improved.

## Papers

### Model or Harness? An Interaction-Centric Taxonomy for Localizing Agent Failures

Primary source: https://arxiv.org/abs/2607.28802

The paper frames agent debugging as a repair-assignment problem and provides an interaction-centric taxonomy with 41 failure modes localized to component interactions and a fault side.

Direct Meta-Harness consequence:

Before adding a new rule, gate, retry, prompt, skill, or worker, classify the failure origin at least coarsely:

```text
owner/alignment
model
harness/orchestration
tool/environment
validation/grader
external dependency
```

Only a harness-side failure is presumptive evidence for a harness patch. This should remain a reasoning discipline first; do not create a new schema or dashboard until repeated real failures require one.

### AgentOPSD: Recursive Self-Distillation for Agentic Reinforcement Learning

Primary source: https://arxiv.org/abs/2608.05987

The paper attacks long-horizon credit assignment by identifying pivotal turns instead of assigning all credit at trajectory level. It is a model-training method, not a drop-in local harness feature.

Conceptual Meta-Harness lesson:

When learning from a work trajectory, attach a lesson to the **small number of interactions that changed the outcome** rather than summarizing the whole session into generic “best practices.” This is another defense against prompt/memory accretion.

### STORM / Co-STORM

Primary source: https://github.com/stanford-oval/storm

Useful signal:

- STORM’s core research contribution is not merely retrieval; it emphasizes generating good questions through multiple perspectives.
- Co-STORM adds experts, a moderator that surfaces underexplored questions, a human participant, and a shared concept structure.

Meta-Harness lesson:

For requirement alignment, different professional perspectives are most useful as **question generators that expose missing information**, not necessarily as autonomous implementation agents. This maps directly to the progression:

```text
/grill-me
→ /prototype
→ /to-questionnaire
→ perspective-guided stakeholder alignment
```

The next step is richer question discovery, not more implementation workers.

## Community popularity is not product evidence

The star counts supplied for several skill repositories are volatile and the web indexes observed in this round disagree with one another depending on crawl freshness. Do not put exact star counts into product truth or use them to rank architecture choices.

Stars may justify **what to inspect**. They do not justify **what to adopt**.

The stronger evidence order for Meta-Harness is:

```text
real product failure / measured outcome
> controlled benchmark or dogfood
> battle-tested documented workflow
> primary-source design claim
> adoption/popularity signal
```

## Product hypothesis: Alignment Contract, not Planning Pipeline

The highest-leverage candidate direction is a **conditional alignment front-end that terminates in the existing work-session contract**.

Conceptually:

```text
goal
  ↓
read repo + PRODUCT.md; answer discoverable facts locally
  ↓
material product uncertainty remains?
  ├─ no ───────────────────────────────→ work
  │
  └─ yes
      ↓
choose cheapest resolving instrument
      ├─ grill: owner judgment
      ├─ prototype: experiential/UI uncertainty
      ├─ questionnaire: external stakeholder knowledge
      └─ perspective challenge: missing product/design/security/ops questions
      ↓
accepted result contract
      ↓
meta-harness work
      ↓
controller validation
      ↓
bounded repair
```

The output of alignment should be no larger than what execution already needs:

- product result;
- current journey state;
- do-now action;
- newly true behavior;
- done condition;
- stop conditions;
- path/authority boundary where known;
- exact validation where known.

Do **not** automatically expand this into implementation tasks, a DAG, a detailed plan, a new persistent product-state schema, or a multi-agent organization.

## Proposed invariants if alignment is later implemented

1. **Repo before question.** Never ask what local code/docs can answer.
2. **One high-information question at a time** unless the user explicitly wants a batch questionnaire.
3. **Question until executable, not until exhaustive.** Stop when the accepted result and validation boundary are clear enough to act.
4. **Prototype answers one named uncertainty.** It is disposable by default.
5. **Questionnaires are for external knowledge.** They must distinguish facts to discover from decisions the owner can make directly.
6. **Perspectives are lenses before they are agents.** Do not create persistent product/design/security workers just to simulate job titles.
7. **No detailed plan by default.** Planning is conditional on risk/dependency structure, not a mandatory lifecycle stage.
8. **PRODUCT.md remains immutable owner authority.** Alignment may clarify a task; it may not infer or mutate owner taste.
9. **Implementation starts immediately after acceptance.** Research/review/alignment must not become a pause once uncertainty is closed.
10. **Every new harness rule needs a localized failure and a measurable expected benefit.** No patch accumulation.

## Failure-localization discipline

When a future run fails, use this decision order before editing Meta-Harness:

```text
1. Did the accepted result/owner intent remain ambiguous?
   → alignment problem

2. Was the result clear but the model reasoned/implemented badly inside a sufficient harness?
   → model-side problem

3. Did the harness hide context, route badly, over-constrain, fail to resume, or mis-handle tool results?
   → harness-side problem

4. Did a tool, sandbox, dependency, repository layout, or environment prevent correct action?
   → tool/environment problem

5. Did validation fail to measure the intended behavior or report a false result?
   → validation/grader problem

Only then choose the smallest root fix.
```

This is the concrete interpretation of “杜绝补丁思维”: do not turn every visible failure into another prompt sentence or workflow node.

## Next evidence: use the existing 85/100 journey as the experiment

The repository already has a stronger immediate obligation than adding alignment runtime: demonstrate the external low-friction direction-carrying `--goal` journey that justifies `85/100`.

Use that real external task as a natural experiment rather than building speculative infrastructure first.

Compare two equivalent real tasks or two comparable slices:

### Baseline A — current direct path

```text
owner goal
→ current meta-harness work --goal
→ worker
→ validation/repair
```

### Candidate B — manually alignment-assisted, no new runtime

Before invoking the same current work path, use only the proposed alignment discipline:

```text
repo answers first
→ minimal grill/prototype/questionnaire only if needed
→ produce the existing work-session-sized accepted contract
→ current meta-harness work
```

Measure:

- time from initial goal to first implementation edit;
- number of owner clarification turns;
- number of post-implementation “that is not what I meant” corrections;
- validation/repair attempts;
- escaped requirement defects;
- total problem-to-DONE time;
- whether a detailed implementation plan would actually have prevented any observed failure.

### Promotion rule

Only implement an alignment surface in Meta-Harness if the alignment-assisted path demonstrates a material reduction in owner correction/rework or improves successful delivery without creating comparable alignment latency.

If it does not, keep alignment outside the runtime and preserve the thinner product.

## Decision from this round

**Bank the hypothesis, not the feature.**

The likely future architecture is:

> richer conditional alignment → tiny accepted-result contract → thinner execution → exact validation → bounded repair → localized learning

But the current repository does not yet have evidence that a new alignment command, artifact, or worker is necessary. The next real external delivery should generate that evidence.

This keeps the research useful while honoring first principles, adversarial review, KISS, long-term maintainability, and the rule against patch-driven complexity.
