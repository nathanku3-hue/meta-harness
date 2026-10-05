# Human Handoff Contract

Status: Meta-Harness 0.4 distributable contract

Purpose: define the cross-repository human-facing completion envelope. Domain repositories fill business semantics; Meta-Harness owns the generic shape, deterministic rendering boundary, and leakage rules.

## Separation of responsibility

Meta-Harness owns:
- the generic `HumanHandoffEnvelope` schema;
- deterministic rendering;
- PM-closure leakage checks;
- the normal / resume / aggregation egress source contract;
- the distinction between human closure and machine evidence.

Domain repositories own:
- domain-specific `status` and `why`;
- end-to-end meaning for `where`, `locks`, and `why_not_others`;
- the deterministic computation of `human_stop_required` from their local effect membrane or business rules.

Meta-Harness must not infer permission to act from repository-local lifecycle vocabulary.

## Envelope

A valid human handoff always contains:

```text
status
why
human_stop_required
human_stop_reason
decision_question
egress_source
```

`next` is required only while actionable product work remains. Terminal `COMPLETION`, `QUIESCENT`, and `SAFE_STOP` handoffs may set `next=null` rather than manufacture a follow-up action. When present, `next` contains:

```text
next.action
next.where
next.why_now
next.locks[]
next.done_when
next.unlocks
next.why_not_others[1..3]
```

`egress_source` is one of:
- `NORMAL_COMPLETION`
- `RESUME_COMPLETION`
- `SUBAGENT_AGGREGATION`

The source is machine provenance only. It is never rendered into PM chat.

A handoff may also contain a `presentation` hint with `kind`, `shape`, `itemCount`, `hasBranches`, `hasEvidence`, and `textMode`. These fields describe information shape and projection mode only. They cannot change status, next action, human-stop state, product truth, or validation. Missing presentation hints normalize to conservative text-first defaults.

## Render law

The complete `HumanHandoffEnvelope` remains the semantic payload. Normal PM text is a deterministic compressed projection of that envelope, not a second summary authored by a model.

Normal text uses the smallest truthful shape. Terminal completion/quiescence does not invent continuation:

```text
Done — <observable result>
```

```text
No current product gap.
```

```text
Not done — <current result>
Next — <next action>
```

```text
Blocked — <current blocker>
Next — <next action>
```

```text
Need input — <one concrete owner question>
Why — <deterministic product-facing reason>
Then — The same work continues.
```

```text
Update — <aggregate product status>
Next — <next action>
```

```text
Stopped safely — current product state is preserved.
```

When real in-scope work remains, continuation/blocker/aggregate modes retain an explicit `Next — <next action>` line.

Normal PM text contains at most four non-empty lines. `Where`, `Why now`, `Lock`, `Done when`, and `Why not other candidates` exist only when a real `next` action exists; they remain structured-host/diagnostic data and are not rendered by default. `Decision needed` is never the normal user-facing label; genuine owner input uses exactly one `Need input` line.

## Clear technical English law

Normal text uses STE-inspired clear technical English. This is a readability contract, not a claim of ASD-STE100 compliance.

- Use one stable term for one concept. Do not rotate synonyms for internal concepts.
- Put the observable product result before implementation detail.
- Prefer short direct sentences and active voice when the actor matters.
- Put one result, blocker, question, or next action on one line.
- Use concrete verbs such as `use`, `change`, `run`, `check`, and `continue`.
- Do not expose internal control vocabulary such as authority, admission, custody, approval rounds, claims, permits, leases, phases, or reviewer topology.
- Keep machine provenance in structured evidence rather than translating it into user-facing ceremony.

## Evidence boundary

`WORKER_REPORT`, SAW, closure packets, hashes, validator output, reviewer availability, retry/resume narration, and raw state counters are machine/audit evidence. They do not appear in PM closure unless the user explicitly requests audit evidence.

Audit mode is explicit. It does not weaken PM-closure validation by default.

## Anti-leakage law

PM closure rejects:
- lifecycle headings such as `Outcome:`, `Round:`, `Progress:`, `Confidence:`;
- worker-accountability or validation sections;
- SAW/ClosurePacket tokens;
- `OWNER_DECISION`, `NO_AUTO_OPEN`, and `auto_open=false`;
- bureaucratic stalls such as `wait for owner`, `awaiting owner`, or `if you want to proceed`;
- resume narration such as `On resume I detected`, `during the interruption`, or `I did not rerun`;
- raw machine-state dumps such as `provider calls=0`, `broker=false`, or `real capital=NONE`.

Business counts such as `4 clear / 0 reject` remain valid.

## Egress law

Normal completion, resumed completion, and subagent aggregation must all follow:

```text
raw result
-> HumanHandoffEnvelope
-> deterministic Text Presentation Compiler
-> PM_CLOSURE / text-egress validator
-> user
```

Completion-like special exits are not exemptions. `USE_PRODUCT`/quiescence and controlled drain/stop output must use the same envelope and validator before user-visible text. Explicit JSON and read-only conversational answers are separate machine/advisory surfaces, not PM completion closures.

There is no direct raw-worker-to-user path. There is no direct special-exit-to-user path.

Rich presentation follows a second projection-only boundary:

```text
validated HumanHandoffEnvelope
-> deterministic Presentation Router
-> TEXT | DIAGRAM | APP projection
```

The compact text projection is always retained as the universal fallback. DIAGRAM and APP payloads are renderer-neutral and disposable; they are not persisted as product truth and cannot create human decision points or alter the canonical handoff. Cut 2 remains text-first and does not add or activate any visualization runtime.

A failed PM-closure validation is an egress failure and must not silently fall back to the raw worker report.
