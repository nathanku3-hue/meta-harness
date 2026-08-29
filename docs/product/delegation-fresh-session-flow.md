# Delegation Fresh-Session User Flow

Status: canonical delegation journey and programme closure
Date: 2026-08-28

## Product rule

A delegated ChatGPT conversation is a disposable execution surface, not continuity authority.

```text
fresh ChatGPT conversation
+ deterministic zero-history boot packet
+ retained taskId/workspace authority
= project continuation
```

If correct continuation requires an old chat transcript, the harness is defective. Durable product direction, accepted World truth, Outcome/task identity, workspace custody, evidence, and compact handoff carry continuity instead.

## 1. Create the retained delegation before opening chats

The orchestrator first decides that bounded external evidence is useful. DevSpace atomically retains one delegation and 1-4 lanes before any child conversation becomes authority.

Each lane already has durable identity such as:

```text
delegationId
laneKey
taskId
taskDigest
workspaceId
laneBriefDigest
resultChallenge
```

The delegation also retains one sealed zero-history context:

```text
original PRODUCT Endgame
current accepted World / WorldHead projection
current semantic gate
bounded evidence index
```

The browser sessions are therefore replaceable. SQLite/native-task state, not a ChatGPT thread, owns continuity.

## 2. Open fresh authenticated ChatGPT conversations

Machine-owned lanes start as fresh `chatgpt.com` conversations. The accepted browser-host architecture keeps the explicit human browser path separate:

```text
persistent authenticated ChatGPT profile
        |
        |-- explicit human web_launch uses this profile directly
        |
        `-- copied browser storage state
                 |
                 v
            one managed Chrome process
             |-- BrowserContext A
             |-- BrowserContext B
             |-- BrowserContext C
             `-- BrowserContext D
```

Each machine lane owns an independent BrowserContext. Result, cancellation, failure, or expiry closes only that lane context. Sibling lanes remain alive. The browser host is a fidelity/resource boundary only; it is not a scheduler or work-authority system.

## 3. Inject the first prompt automatically

The first prompt is not a vague `continue the project` message and does not contain parent chat history. DevSpace compiles one deterministic `DELEGATION-R2` boot packet for the exact retained lane.

Its order is fixed:

```text
1. ORIGINAL ENDGAME
2. CURRENT ACCEPTED WORLD
3. CURRENT GATE
4. LANE-SPECIFIC BRIEF
5. EVIDENCE INDEX
6. EXECUTION INSTRUCTIONS
```

The lane brief contains the exact objective and acceptance criteria. The execution instructions tell the fresh child to:

```text
use the connected DevSpace connector
invoke open_workspace(taskId=<exact retained taskId>)
provide no replacement path/worktree/task brief
follow only the sealed native-task authority returned by DevSpace
do not reconstruct purpose from parent/sibling chat history
do not manage sibling lanes
call lane_submit exactly once when complete or bounded uncertainty is known
then stop
```

The packet also includes the one-time `lane_submit` challenge. DevSpace hashes the exact boot prompt and retains that digest with the lane.

## 4. Reattach project execution through `open_workspace(taskId)`

The fresh ChatGPT child continues the project by calling:

```text
open_workspace(taskId=<retained taskId>)
```

It does not reopen the repository by path and does not ask the owner where the previous conversation stopped.

DevSpace resolves the task ID to the exact retained native task and workspace:

```text
taskId
  -> exact workspaceId
  -> exact managed worktree
  -> sealed task brief
  -> allowed write boundary when applicable
  -> deterministic validation authority
  -> retained task outcome / custody
```

The child now has two intentionally separate context layers:

```text
boot packet
-> why this lane exists

open_workspace(taskId)
-> which exact execution state this lane owns
```

Together they provide semantic and mechanical continuation without conversational continuation.

## 5. Execute independently

The child may inspect repository instructions and perform only its sealed task. Sibling chats are neither required nor trusted as shared memory.

```text
A --\
B ---+--> no child-to-child conversational authority
C ---+
D --/
```

Common grounding comes from the same sealed Endgame/World/gate projection. Local repository detail cannot overwrite that higher-level context.

The live browser conversation may accumulate arbitrary reasoning, but that transcript is disposable. It is never the fan-in contract.

## 6. Return one compact result through `lane_submit`

When the lane has completed its evidence task or reached bounded uncertainty, it calls `lane_submit` exactly once with only:

```text
challenge
claim
criterion verdicts: PASS | FAIL | UNKNOWN
evidence objects: ref + summary + detail
advisory worldDelta facts
remaining uncertainty
recommended handoff or null
```

Every criterion is covered exactly once and every evidence reference must name evidence in the same payload.

The child does not supply its own delegation/task/workspace/context/result identity. DevSpace binds those server-side and seals `lane-result/v1` with:

```text
delegationId
laneKey
taskId
workspaceId
contextDigest
laneBriefDigest
bootPromptDigest
taskOutcome
compact result bytes
submittedAt
resultDigest
```

After persistence succeeds, the lane's BrowserContext can be released. No transcript needs to survive.

## 7. Fan in compact state, not child conversations

Meta-Harness observes the delegation through compact `get_delegation` snapshots. A normal lane card contains claim, criterion verdicts, evidence summaries, advisory World deltas, remaining uncertainty, and handoff. Raw messages are excluded.

Detailed evidence is expanded only by already-named refs when a disputed criterion requires it.

While lanes are still pending, one active repo-work invocation may wait on compact lane state plus current WorldHead. Unchanged polling is only a process-local wakeup and does not rerun Planner/Grill or create durable scheduler state.

## 8. Interpret evidence against current World

A worker claim is not World authority. Meta-Harness interprets a newly retained compact result against the current authoritative World/attestation through the fixed repository interpreter.

Accepted external evidence may produce a `DELEGATION_LEARNING` World transition, but that transition preserves `WorldHead.productCommit`. Delegation learning cannot manufacture canonical product code or impersonate a Claim Closure.

Claim-bound coding Outcomes remain exclusively on the normal coding path:

```text
logical planner
-> Outcome
-> atomic Claim
-> sealed coding session
-> controller validation / product proof
-> local BANK
-> cumulative product integration
-> World learning
```

Round 3 cannot mint fresh coding work from released delegation capacity.

## 9. Recompute the retained-lane frontier

After accepted evidence changes World, every still-live evidence lane receives exactly one challenged lifecycle decision:

```text
CONTINUE
  lane remains positive-value; keep it running

HOLD
  lane remains relevant but should stop consuming live resources
  -> persist delegation-hold-checkpoint/v1
  -> cancel lane / release its browser context

OBSOLETE
  current accepted World makes the lane no longer decision-relevant
  -> cancel directly
```

One fresh Grill may accept or replace the complete frontier once. There is no recursive review loop.

Before lifecycle action, Meta-Harness rechecks both WorldHead and a fresh compact DevSpace snapshot. Drift in taskId, workspaceId, launch status, or resultDigest invalidates the stale frontier and forces recomputation.

## 10. Resume with another fresh conversation when needed

An interrupted useful lane may be resumed through the retained delegation substrate. Resume preserves the same delegation/task/workspace/memory/result-challenge identity.

The replacement execution surface is again a fresh ChatGPT conversation:

```text
fresh conversation
-> inject retained deterministic boot packet
-> open_workspace(same taskId)
-> continue same retained project task
```

A HOLD checkpoint is semantic continuity/evidence for later frontier reasoning; it is not a parked live chat and not scheduling authority.

## 11. Surface only material owner movement

The owner does not manage A/B/C/D, copy prompts, transport handoffs, choose workspaces, or poll workers.

Normal internal flow is:

```text
owner/orchestrator: go delegation
-> fresh A/B/C/D conversations
-> deterministic boot injection
-> open_workspace(taskId) reattachment
-> independent work
-> lane_submit
-> compact fan-in
-> current-World interpretation
-> CONTINUE / HOLD / OBSOLETE
-> normal Claim path for any fresh coding
```

The owner should see only a materially changed product boundary:

```text
Done -- product result is complete
Next: <new semantic forward gate>
Need you: <genuinely owner-exclusive taste/access/risk decision>
```

Internal lane IDs, task IDs, browser contexts, checkpoints, Grill decisions, and polling are not owner workflow controls.

## Programme closure

The delegation programme is closed at this architecture boundary. Rounds 1-5 established:

```text
durable 1-4 lane substrate
-> zero-history memory + compact fan-in
-> current-World evidence lifecycle
-> active-turn waiting without durable scheduler state
-> isolated authenticated machine BrowserContexts
```

Accepted Round-5 browser-host reference: DevSpace `product/autopilot-alpha` commit `94f8ea8` (`Fix authenticated managed browser isolation`). Later dirty edits in that DevSpace worktree are separate owner/worktree state and are not part of this programme closure unless independently accepted.

Do not create a Round 6 from programme momentum. Reopen only for a newly observed supported-use defect with retained evidence and a smallest repair. Browser optimization, provider routing, queues, daemons, generic swarms, dashboards, and persistent idle workers remain out of scope without such a defect.
