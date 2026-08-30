# CONTINUITY-BENCH-1 — 2026-08-29

## Decision

**P1 memory result: `NO_BUILD`.**

The benchmark found measurable mechanical reconstruction across fresh task/process boundaries, but it did not find a continuity-critical fact that was both decision-relevant and absent from existing durable state. The observed repetition is current repository retrieval, not evidence that Meta-Harness needs a transcript store, compactor, vector database, embedding index, generic session log, or continuation-memory service.

## Scope

The benchmark exercises three zero-history proposal scopes against the P1 external proposal substrate:

1. normal fresh-worker success;
2. validation failure followed by a fresh repair packet;
3. DevSpace/process restart while the exact proposal task remains durable.

It measures only mechanical facts. It does **not** infer semantic claims such as “the same bad idea was retried,” “implementation judgment was forgotten,” or “a conceptual fact was rediscovered.” Those claims require separate semantic evidence.

## Mechanical observations

| Scenario | Prompt bytes | Result bytes | Activations | Read calls / bytes | Search calls | In-scope repetition |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| Fresh success | 60 | 36 | 1 | 1 / 58 | 1 | none inside task |
| Validation repair | 125 | 36 | 1 | 1 / 61 | 1 | none inside task |
| Process restart | 81 | 36 | 2 | 2 / 52 | 0 | 1 repeated read of the same file |

Cross-scenario aggregation:

- repeated file-read identities: **3**;
- repeated exact search-query identities: **1**;
- same-task repeated reads caused by restart: **1**;
- telemetry truncation: **none**.

The telemetry is explicitly `NON_AUTHORITATIVE_OBSERVATION`. Search text is not retained; only digest identity and counts are kept. Relative file identities are bounded, and telemetry reports when its bounded key set truncates observations.

## Retrieval-first analysis

The observed repeated work does not justify new memory authority:

- The repair scenario received the previous validation failure in the fresh repair packet (`priorFailure`), so repair rationale already has a durable projection.
- The restart scenario recovered the exact durable proposal task and exact retained prompt after reopening the store; no parent conversation or child transcript was required.
- Re-reading `README.md` or source files is retrieval of current repository truth. Caching that truth as conversational memory would be weaker than reading the authoritative source again.
- Repeating an exact search is measurable reconstruction tax, but a query digest alone does not prove lost judgment or a missing durable semantic fact.

Existing durable/retrievable sources remain the preferred hierarchy:

```text
WorkSession / proposal packet
worker result
validation evidence
product proof
World / Closure
current repository bytes
bounded retained evidence
```

Only if later real-use evidence demonstrates costly, decision-relevant knowledge that repeatedly disappears **and is not represented by those sources** should a bounded advisory `continuation-capsule/v1` be reconsidered.

## Closure

P1-R2 closes without a memory subsystem. Keep the model disposable, keep harness state authoritative, and use the prompt as the bounded current attention surface.
