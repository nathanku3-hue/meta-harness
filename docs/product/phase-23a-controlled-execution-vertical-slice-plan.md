# Immediate Next Plan — Narrow 22B + Phase 23A Controlled Execution Vertical Slice

**Status:** **APPROVED with amendments** (2026-07-11); **23A-PR1 closed under D067** (contract authority only)
**Date:** 2026-07-11
**Input:** Sequencing correction + audit approval with required amendments; post-D066 audit: contract authority first
**Prerequisite tip:** 22B / D066 at `f926868`; 22A-H at `02d9c59`
**Decision IDs:** D066 closes 22B; **D067 closes 23A-PR1 contracts only**; later IDs for PR2–PR4 / AO+Codex dogfood

---

## Audit result (binding)

| Item | Result |
|---|---|
| Sequencing 22B → 23A | **Approved** |
| A–H checklist | **Yes** (C only if 23A absorbs minimum 22C–22F controls in authorize/verify) |
| I | **CI = fake/unit only**; real AO+Codex+draft PR = operator dogfood with recorded evidence |
| Code before amendments | **Blocked** — plans + roadmap fixed first, then PR1 only |

**Do not stage** the raw untracked `Project status and rating_*.md` chat export unless curated into a product note.

---

## 1. Verdict on current state (accepted)

| Claim | Stance |
|---|---|
| Combined user-flow score ~**5.8/10** | **Accept** — 21F/22A improved pre-execution contract only |
| Product class: governance/evidence control plane, not coding orchestrator | **Accept** |
| README still under-discovers rollup → operator plan path | **Accept** |
| Next risk to retire is **not** router / DevSpace / Grok / subagents | **Accept** |

**Core product risk to retire next:**

> Can Meta-Harness safely dispatch **one** approved packet to **one** external executor, recover its state, and independently verify the resulting draft PR?

Until that path is proven, further orchestration abstractions are speculative.

---

## 2. Sequencing correction (binding)

### Do next

```text
22B (one PR, read-only consumption)
→ execution contracts
→ fake provider + run state machine
→ Agent Orchestrator provider
→ one Codex vertical slice (approved packet → draft PR → MH READY|BLOCKED)
→ deterministic verification on that path
```

### Do **not** do next

| Deferred | Why |
|---|---|
| Deterministic multi-worker **router** | No empirical provider data until Codex (then Grok) complete golden tasks |
| DevSpace / ChatGPT write-capable front door | Can bypass MH + AO; belongs **after** execution core |
| Grok as implementer | Second provider after Codex slice is repeatable |
| Native subagents (any provider) | After single-parent write path is stable; read-only first |
| Multiple simultaneous workers | After single-session reliability |
| Multi-repo DAG | After single-repo execute path |
| CI self-repair / review-repair loops | After first evidence import works |
| Automatic merge | Human remains merge authority |
| Dashboard / TUI | After exception-first CLI path works |
| 22C–22F full safety ladder **as a multi-phase read-only stack** | Superseded for velocity: minimal bind+verify lives **inside** 23A contracts and ACCEPTANCE tests, not as separate product phases before first execute |

### Ownership (binding)

| Responsibility | Owner |
|---|---|
| Whether execution is allowed | Meta-Harness |
| Scope and acceptance criteria | Meta-Harness |
| Executor selection (first slice) | Hard-coded Codex via AO |
| Worktree and branch | Agent Orchestrator only |
| Worker process | Agent Orchestrator |
| Code implementation | Codex (through AO adapter) |
| Draft PR creation | Agent Orchestrator |
| Evidence interpretation | Meta-Harness |
| Semantic completion (`READY` / `BLOCKED`) | Meta-Harness — **not** Codex, **not** AO |
| Merge authorization | Human |

**Meta-Harness must not** create a second worktree system or become AO’s session database.

---

## 3. PR 1 — Finish 22B (narrow; one PR only)

**Decision (proposed):** D066
**Plan of record for shape:** `docs/product/phase-22b-worker-gate-consumption-contract.md`
**Time-box:** **one implementation PR**.

### Time-box failure rule (binding — no “freeze without replacement”)

22B **cannot** be abandoned without a replacement gate.

| Outcome | Action |
|---|---|
| PR1 closes 22B cleanly | D066; 23A starts with existing `worker_entry_gate` |
| PR1 blows the one-PR time-box | **Fold** the **minimal** `worker_entry_gate` contract into **23A PR2** (contracts). 23A **must not** authorize from a missing gate. |

There is no path where 23A authorize runs without an equivalent `worker_entry_gate` object.

### Purpose

Give a future executor one machine-readable entry decision over fresh:

```text
poll --rollup --verify-operator-execution-plan <path>
```

### Deliverables (only)

| Item | Spec |
|---|---|
| Object | `worker_entry_gate` (**only** runtime key) |
| Aliases | **Forbidden** — no `operator_work_gate`, no dual keys, no compatibility surface |
| Trigger | Always emit on verify-op path (same as 22A always-emit) |
| Verdict vocabulary | `open` \| `blocked` (plus unit-only `not_requested` if needed) |
| Open rule | Conjunction of existing six inputs from 22B plan (validation, resolution, readiness ready+ok, RO git inspection ran, executes_child_commands false) |
| Builder | `lib/worker-entry-gate.js` pure function |
| Tests | `tests/worker-entry-gate.test.js` + thin poll smoke |
| Docs | Roadmap 22B closed; D066; plan status implemented; roadmap text must not retain `operator_work_gate` as a runtime option |

### Explicit non-goals for PR 1

- No child writes, apply, tasks, queues, readiness refresh
- No additional git inspection beyond 22A
- No proposal/review ceremony
- No 22C–22F as separate product phases
- No execution authority (`open` ≠ launch agents)
- No new public CLI command
- No AO process, Codex run, push, router, DevSpace, Grok, subagents

### Mapping note (do not inflate 22B)

User-facing mental model from sequencing note:

| Sequencing note | 22B runtime (this plan) | Deferred to 23A |
|---|---|---|
| `ALLOW` | `verdict: "open"`, `ok: true` | — |
| `BLOCK` | `verdict: "blocked"`, `ok: false` | — |
| `STALE` | **Not a 22B verdict** | Auth step re-check: dirty/HEAD drift vs `RunManifest.baseRevision` → run `BLOCKED` / `STALE` at execute time |
| `expected_head`, `scope_hash`, `expires_at` | **Not required on 22B** | Live on `RunManifest` + authorize step |
| `stop_conditions[]` | Document as future policy fields | Enforced in 23A run controller |

**Rationale:** packing HEAD binding, expiry, and STALE into 22B re-opens the multi-phase readiness ladder and violates the one-PR time-box. 22B stays pure **consumption**.

### Exit criteria (22B)

- [ ] verify-op always emits `worker_entry_gate` with `open` or `blocked`
- [ ] `ok === true` only when open rule holds
- [ ] Fail closed on missing/unknown/dirty/not_git/etc.
- [ ] Zero mutative flags; no extra git
- [ ] `npm test` green; quality/ready/sync/diff-check green (known CLI-count WARN only)
- [ ] D066 + roadmap: 22B closed as **consumption only**

**Operator rule after 22B (still manual):** before touching a child repo by hand, re-run verify-op and require `worker_entry_gate.ok === true`. Automated dispatch still **forbidden** until 23A ships.

---

## 4. Phase 23A — Controlled Execution Vertical Slice

**Name:** Phase 23A — Controlled Execution Vertical Slice
**Class:** first execution authority under hard constraints
**Depends on:** 22B closed **or** minimal `worker_entry_gate` folded into 23A PR2 (see time-box failure rule). Never authorize without an equivalent gate.

### Target path (only path in scope)

```text
Approved manual-work packet
  → worker_entry_gate (open)
  → RunManifest (immutable)
  → authorize (fail closed if STALE/dirty/scope mismatch)
  → ExecutionProvider = agent-orchestrator
  → prepare (one AO worktree)
  → start (one Codex worker via AO existing adapter)
  → inspect / recover
  → collect EvidenceBundle
  → Meta-Harness VERIFY
  → READY | BLOCKED | FAILED
```

### Deliberately excluded from 23A

- Grok (any role)
- Automatic routing
- Native subagents
- Multiple simultaneous workers
- Multi-repository DAGs
- DevSpace / ChatGPT write access
- CI self-repair loops
- Review-comment repair loops
- Automatic merge
- Dashboard / TUI
- Writable nested agents
- Custom Codex app-server client (use AO’s existing Codex adapter first)

### Initial hard-coded route

```text
implementation worker = Codex
reviewer = none
```

---

## 5. Four contracts (freeze before real processes)

Ship as **PR 2** with schema + validation tests only. No AO/Codex process required.

### 5.1 `RunManifest` (immutable instruction)

**Required binding fields (audit amendment):**

| Field | Role |
|---|---|
| `authorizedAt` | ISO timestamp when authorize succeeded |
| `expiresAt` | Hard expiry; authorize/start must fail closed after |
| `operatorPlanArtifactDigest` | Digest of 21F plan artifact at authorize |
| `workerEntryGateDigest` | Digest of the open `worker_entry_gate` object at authorize |
| `manifestDigest` | Canonical hash of the fully authorized manifest (set after authorize; immutable thereafter) |

```yaml
schemaVersion: run-manifest/v0
runId: RUN-0001
attemptId: RUN-0001-A1
packetId: MWP-0042
idempotencyToken: "run:RUN-0001:attempt:A1"   # stable; used for AO session lookup

authorizedAt: "2026-07-11T12:00:00.000Z"
expiresAt: "2026-07-11T13:00:00.000Z"
operatorPlanArtifactDigest: "sha256:…"
workerEntryGateDigest: "sha256:…"
manifestDigest: "sha256:…"   # set only after successful authorize

gate:
  workerEntryGateOk: true
  workerEntryGateVerdict: open

repository:
  path: /repos/example
  baseRevision: abc123          # expected clean HEAD at prepare

objective: Fix the session-expiration bug and add regression tests.

scope:
  allow:
    - src/session/**
    - tests/session/**
  deny:
    - migrations/**
    - infrastructure/**

validation:
  commands:
    - npm test -- session
    - npm run typecheck

delivery:
  mode: draft-pr
  targetBranch: main

budgets:
  attempts: 1
  wallClockMinutes: 45

# Split permissions (audit amendment): worker vs delivery
permissions:
  worker:
    network: denied
    protectedBranchWrite: denied
    subagents: denied
    hostCheckoutWrite: denied
  delivery:
    # AO/provider only — not the coding worker
    network: allowlisted_push_and_draft_pr_only
    createDraftPr: true
    pushBranch: true
    protectedBranchWrite: denied
    merge: denied

executor:
  provider: agent-orchestrator
  worker: codex
```

**Rules:**

- Manifest is **immutable** after authorize; retries create a new `runId`/`attemptId` or explicit attempt record, never silent rewrite.
- `baseRevision` is required and is the expected clean HEAD at prepare time.
- Scope allow/deny is the only path policy the verifier trusts (not agent prose).
- **Worker network denied** does **not** forbid AO from network for **approved branch push + draft PR delivery** only.
- Digests are computed by Meta-Harness; providers must not supply them as authoritative.

### 5.2 `ExecutionProvider` (narrow)

```ts
interface ExecutionProvider {
  capabilities(): Promise<ProviderCapabilities>;
  prepare(manifest: RunManifest): Promise<WorkspaceRef>;
  start(
    manifest: RunManifest,
    workspace: WorkspaceRef
  ): Promise<SessionRef>;
  inspect(session: SessionRef): Promise<SessionSnapshot>;
  collect(session: SessionRef): Promise<EvidenceBundle>;
  stop(session: SessionRef, reason: StopReason): Promise<void>;
  // cleanup optional later; not required for first slice if AO owns lifecycle
}
```

**Provider must not decide:** scope approval, merge policy, or semantic `READY`.

### 5.3 `SessionSnapshot` (operational only)

```ts
type SessionState =
  | "PREPARING"
  | "RUNNING"
  | "WAITING"
  | "FAILED"
  | "STOPPED"
  | "FINISHED";
```

**Invariant:** `FINISHED` ≠ product `DONE` / `READY`. It only means the executor process/session stopped. Semantic completion is a separate Meta-Harness verification step.

### 5.4 `EvidenceBundle` (independently evaluated)

**Audit amendment:** evidence must contain **verifiable facts**, not agent/AO “done” claims alone.

```yaml
schemaVersion: evidence-bundle/v0
runId: RUN-0001
attemptId: RUN-0001-A1
manifestDigest: "sha256:…"

workspace:
  baseRevision: abc123
  headRevision: def456          # exact HEAD commit after work
  branch: mh/run-0001

diff:
  patchHash: "sha256:…"         # hash of unified patch / export
  changedFiles:                 # exact list from git/diff facts
    - path: src/session/expiry.ts
      status: modified
    - path: tests/session/expiry.test.ts
      status: added

commands:
  - command: npm test -- session
    cwd: /abs/worktree/path     # exact cwd
    exitCode: 0
    outputHash: "sha256:…"      # hash of bounded captured stdout+stderr
    # optional: boundedOutput (size-capped, redacted) — hash is required

delivery:
  pullRequest:
    number: 42
    draft: true
    url: null                   # optional; may be redacted
    headRef: mh/run-0001
    baseRef: main

executor:
  provider: agent-orchestrator
  worker: codex
  sessionId: redacted-reference
  idempotencyToken: "run:RUN-0001:attempt:A1"
```

**Verifier rules (minimum for 23A READY):**

| Check | READY requires |
|---|---|
| Base revision | Evidence `baseRevision` matches manifest at prepare |
| Head | `headRevision` present and is a real commit |
| Scope | **From git/diff facts** (`changedFiles` / `patchHash` contents) — every path matches allow; none match deny. **Not** from Codex/AO done text |
| Commands | All manifest `validation.commands` present with exitCode 0, exact `cwd`, and `outputHash` (or bounded captured output + hash) |
| Delivery | Draft PR reference present when `delivery.mode: draft-pr` |
| Digests | `manifestDigest` matches authorized manifest; gate/plan digests consistent with ledger |
| Gate | Authorize-time gate was open; re-authorize fails closed on dirty child / expiry / HEAD drift |
| Attempts | Within budget |

Scope violation → **`BLOCKED`**. Missing required facts → **`FAILED`** (infra/provider) or **`BLOCKED`** (policy). Agent prose alone never yields READY.

---

## 6. Run lifecycle (controller owns this)

```text
CREATED
  → AUTHORIZED          # worker_entry_gate open + digests + clean HEAD == baseRevision + not expired
  → PREPARING           # provider.prepare
  → RUNNING             # provider.start (only after idempotent session resolve)
  → COLLECTING          # provider.collect (or after FINISHED inspect)
  → VERIFYING           # Meta-Harness evidence rules from facts
  → READY | BLOCKED | FAILED
```

### Crash / restart idempotency (acceptance #10 — strengthened)

Restarting Meta-Harness must **not** duplicate an in-flight AO session, including:

> Crash **after** `start()` begins but **before** session ref is persisted.

**Required rule:**

1. Every attempt has a stable `idempotencyToken` (or `runId`+`attemptId`).
2. Before calling provider `start()` again, Meta-Harness **must** look up existing AO sessions by that token / `runId`+`attemptId`.
3. If a session exists → adopt it (`inspect` / reconcile); **do not** create a second session.
4. Persist session ref to the run ledger **as early as the provider can return it** (ideally before long-running work); if only eventual consistency is available, lookup-by-token remains mandatory on every start path.
5. Ledger lives under parent `.meta-harness/` (local, ignored): `runId`, `attemptId`, `idempotencyToken`, provider session ref, state.

**No automatic retries** in first slice (`budgets.attempts: 1`).

---

## 7. Implementation backlog (ordered PRs)

**Roadmap tightening (binding, post-D066 audit):** split 23A into **contract authority first**, not “full functional vertical first.” Do **not** combine contracts + fake in one PR.

| PR | Name | Deliver | Depends | Status |
|---:|---|---|---|---|
| **22B** | Worker entry gate | `worker_entry_gate` only; D066 | 22A-H | **closed** |
| **23A-PR1** | Execution contract authority | RunManifest + authorize + EvidenceBundle + verify fixtures only; **no** ExecutionProvider/state machine/process | 22B | **closed under D067** |
| **23A-PR2** | Fake provider + state machine | In-memory provider; full lifecycle; restart/reconciliation; **no AO** | 23A-PR1 | planned |
| **23A-PR3** | Agent Orchestrator provider | prepare/start/inspect/collect/stop; AO state map; **no auto-retry** | 23A-PR2 | planned |
| **23A-PR4** | Codex draft-PR dogfood | One golden task → draft PR → MH READY\|BLOCKED | 23A-PR3 | planned |
| later | Grok read-only review | Only after PR4 is repeatable | 23A-PR4 | deferred |

### Suggested layout (PR 2+)

```text
lib/
  contracts/
    run-manifest.js          # build/validate
    evidence-bundle.js
    session-snapshot.js
  orchestration/
    run-controller.js        # state machine + ledger
    authorize.js             # gate + HEAD/scope preflight
    verify-evidence.js
  providers/
    fake.js
    agent-orchestrator.js
```

CLI surface for 23A (minimal; exact flags audit may trim):

```text
meta-harness run authorize --manifest <path> --json
meta-harness run start --manifest <path> --json
meta-harness run status --run <runId> --json
meta-harness run collect --run <runId> --json
meta-harness run verify --run <runId> --json
```

Prefer **one** `run` command module with subcommands over many top-level commands (CLI budget already WARN at 27 > 25).

### Codex progression (binding)

1. **AO’s existing Codex adapter** for vertical slice
2. Codex SDK / structured output when evidence gaps require it
3. App-server only for deep interactive approval streaming
4. Codex native subagents only after single-parent writes are stable

### Grok second slice (PR 6 only)

```text
Codex implements
  → deterministic validation
  → Grok reviews committed diff read-only
  → MH classifies findings
  → valid findings returned to Codex (manual or single controlled restart — not free loop)
  → tests rerun
  → READY | DECISION_REQUIRED
```

Grok initial capability:

```yaml
canRead: true
canWrite: false
canCommit: false
canPush: false
canSpawnSubagents: false
```

### After 23A (preview only — do not schedule until READY path is boring)

```text
deterministic verification polish
  → Grok read-only review
  → router (empirical)
  → bounded read-only subagents
  → Meta-Harness MCP run commands
  → DevSpace orchestrated mode (no direct write in managed runs)
  → ChatGPT exception inbox
  → parallel workers
  → multi-repository DAG
```

---

## 8. Acceptance test for the first execution milestone

**Fixture:** one small repository, one deterministic defect, recorded clean SHA.

| # | Criterion |
|---|---|
| 1 | Repo starts clean at a recorded SHA |
| 2 | Meta-Harness produces an approved immutable `RunManifest` bound to packet + baseRevision |
| 3 | Agent Orchestrator creates **exactly one** worktree for the run |
| 4 | Codex changes only allowed paths |
| 5 | Required validation commands pass |
| 6 | A **draft** PR is opened |
| 7 | Meta-Harness imports **verifiable** facts: head commit, patch/diff hash, changed-file list, command cwd + exit + output hash, draft PR reference |
| 8 | Meta-Harness—not Codex or AO—returns **`READY`** from those facts |
| 9 | A deliberate scope violation produces **`BLOCKED`** (scope from git/diff facts) |
| 10 | Restart mid-run (including crash after `start()` before session-ref persist) does **not** duplicate execution — AO lookup by `runId`/`attemptId`/idempotency token before new start |

Milestone fails if any of: host-checkout writes, second worktree owner, auto-merge, silent retry storms, READY based on agent “done” text alone, or authorize without `worker_entry_gate`.

---

## 9. What this plan supersedes

| Prior preview | This plan |
|---|---|
| 22B plan § “Roadmap after 22B”: implement 22C–22F before discussing execution | **Superseded for product sequencing** **only if** 23A authorize/verify absorb **minimum** 22C–22F controls (HEAD bind, TOCTOU recheck, scope, post-work verify facts). Standalone 22C–22F phases are not prerequisites. |
| Status/rating roadmap: DevSpace → router → Codex → Grok → AO | **Reordered:** contracts → fake → AO → Codex → (later) Grok → router → DevSpace |
| “Stop all read-only work” | **Partial:** one constrained 22B PR only (or fold gate into PR2); then stop read-only ladder |
| “Freeze 22B without replacement” | **Rejected by audit** — fold minimal gate into 23A PR2 if needed |

Existing 22B contract doc remains the **implementation blueprint for PR 1** (open/blocked consumption). This document is the **sequencing and 23A** plan of record (**approved with amendments**).

---

## 10. Non-goals (global for this plan)

1. New coding-agent implementation
2. LLM-controlled master scheduler
3. Unlimited fan-out / swarm mode
4. Second worktree manager inside Meta-Harness
5. Prompt-only completion validation
6. Host-filesystem execution as default (AO worktree is the write root)
7. Automatic merge as default
8. Tracker comments / terminal idle as completion truth
9. Importing Claude Squad source (AGPL)
10. Expanding 22B into another multi-phase readiness epic

---

## 11. Decision log entries (draft text for when closed)

### D066 — Close Phase 22B Worker Gate Consumption (read-only)

Close 22B under the existing consumption contract. `worker_entry_gate` is advisory machine preflight for manual work and a prerequisite input for future authorize; it does **not** grant automated execution.

### D067 — Close Phase 23A-PR1 Execution Contract Authority

Close pure contract authority root: RunManifest + authorize + EvidenceBundle + verify fixtures. No process/AO/Codex/network/CLI run command. Fake provider and real execution are later PRs only.

---

## 12. Audit checklist (recorded)

| # | Question | Result |
|---|---|---|
| A | Accept ~5.8 rating and “execution is next risk”? | **Yes** |
| B | Accept **one-PR time-box** for 22B with `open`/`blocked` only (no STALE/expected_head on gate object)? | **Yes** |
| C | Skip 22C–22F as separate phases? | **Yes, only if** 23A authorize/verify absorb minimum 22C–22F controls |
| D | Accept Phase name **23A** and PR order 1→5? | **Yes** |
| E | AO sole worktree owner; Codex via existing AO adapter first? | **Yes** |
| F | Grok only as PR 6 read-only reviewer? | **Yes** |
| G | DevSpace after execution core + MH MCP? | **Yes** |
| H | Minimal `meta-harness run *` subcommands? | **Yes** |
| I | CI vs dogfood | **CI = fake/unit only**; real AO+Codex+draft PR = operator dogfood with recorded evidence |

### Required amendments (incorporated above)

1. Roadmap runtime key: **`worker_entry_gate` only** — no `operator_work_gate` alias
2. No freeze-without-replacement for 22B
3. Stronger RunManifest binding fields + digests
4. Split worker vs delivery permissions
5. Stronger start idempotency (lookup before second start)
6. EvidenceBundle verifiable facts (patch hash, command cwd/hashes, head, files, PR)
7. Do not commit raw status/rating chat export unless curated

---

## 13. Immediate operator actions (after audit approve)

1. Optionally push `main` (3 commits through `02d9c59`) — **operator-only**, not part of 22B code.
2. **Amend plans + roadmap** (this revision).
3. Implement **PR 1 (22B) `worker_entry_gate` only**.
4. Do **not** start router, DevSpace, Grok, subagents, AO process, Codex run, push, or execution authority.
5. Do **not** stage raw `Project status and rating_*.md` conversation dumps.
6. After D066: open PR 2 contracts (include folded gate if 22B incomplete).

---

## Status footer

```text
Status: APPROVED WITH AMENDMENTS — PR1 22B implementation authorized
Next code: lib/worker-entry-gate.js + tests + poll attach only
Primary files for PR 1: lib/worker-entry-gate.js, tests/worker-entry-gate.test.js, poll, repo-rollup, registry, roadmap, D066
Primary files for PR 2+: lib/contracts/*, lib/orchestration/*, lib/providers/*
Forbidden now: execution, AO, Codex, Grok, DevSpace, router, subagents, push
```
