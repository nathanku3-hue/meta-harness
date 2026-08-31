# FIELD-EXPERT-BENCH-1 — 2026-08-30

Status: **R1 bounded mechanism evidence complete**
Authority: non-authoritative measurement; does not modify `PRODUCT.md`, World, Claim, WorkSession, browser authority, memory authority, or score
Campaign base: `57a2564f1fe199de3a8ab8cfb8ae45834e9ec656`
Frozen fixture contract: `docs/research/field-expert-bench-1-fixture-contract.json`
Fixture-contract SHA-256: `2b1d4930e2ae4a23c301c5778db4b7feef931d90743742cb5874231a6f04568e`

## Interpretation law

This is a mechanism/falsification battery, not a prevalence estimate. F1–F5 are not averaged into one score. Three fresh semantic trials can expose trajectory variance or a repeated mechanism failure; 3/3 pass would still not establish general field-expert reliability.

## Results

| Fixture | Verdict | Evidence | Causal interpretation |
| --- | --- | --- | --- |
| F1 `OPEN_EXISTING` | **FAIL 0/3** | Three fresh stable-ACP sessions rejected artifact-bearing prompt input before product execution: `session/prompt requires exactly one non-empty text block`. | Current supported direct ingress is exact-text only. Artifact-bearing field-expert ingress is absent. Cause is `expert-ingress / translation` plus `agent/artifact legibility / ACI`, not planner prompting. |
| F2 `PURSUE_CONSTRAINED` | **FAIL 0/3** | Three fresh repositories failed before planner boot in research promotion. Each production attempt exited with `MH_RESEARCH_PROMOTION_EXIT` and `Not inside a trusted directory and --skip-git-repo-check was not specified.` | The expert artifact never becomes planner-legible. Domain-constraint/uncertainty reasoning is therefore **not independently graded** in current production. |
| F3 `CHANGE_JUDGMENT` | **DIAGNOSTIC** | An already-visible Claim remained active across owner-objective revision 1; the same claim digest existed before and after the judgment change. | Commitment continuity is preserved, but selective judgment-sensitive invalidation/preservation is not a first-class current mechanism. Retain for R6 DEEP STEERING; do not fix in R1. |
| F4 `CLOSE_STREAM` | **FAIL 0/3 end-to-end; closure semantics not independently graded** | Three fresh repositories failed at the same research-promotion membrane before planner boot. | Current field-expert close journey fails end-to-end because its artifact/evidence cannot reach the semantic layer. Do **not** claim that semantic closure itself is falsified yet. |
| F5 `GREENFIELD_DIAGNOSTIC` | **DIAGNOSTIC GAP** | Stable ACP rejected a non-repository start with `cwd must be an existing managed Git repository root`. | Greenfield product establishment from domain intent alone is absent on the current supported direct-entry surface. Retain for R3 EXPERTIZE. |

## F1 raw bounded evidence

All three fresh trials produced the same deterministic ingress result:

```text
acceptedArtifactBearingInput = false
error.code = -32602
error.message = session/prompt requires exactly one non-empty text block
killRuleViolated = true
```

This falsifies the current F1 field-expert abstraction without implying that Meta-Harness needs a richer generic tool interface. The deletion-first question remains active: the later expert-ingress repair should add only the smallest artifact/procedure path actually needed by the product journey.

## F2 raw bounded evidence

Three fresh production trials failed at `RESEARCH_PROMOTION` before a planner prompt could be measured:

```text
trial 1 elapsed = 8586 ms
trial 2 elapsed = 1526 ms
trial 3 elapsed = 1613 ms

code = MH_RESEARCH_PROMOTION_EXIT
stderr contains:
Not inside a trusted directory and --skip-git-repo-check was not specified.
```

Because the failure is pre-planner, F2 does not support a prompt-elicitation conclusion. It is an ACI/model-invocation/artifact-legibility failure.

## F3 diagnostic

The current owner-objective mechanism advances a durable objective revision while already-visible Claims remain commitments. In the diagnostic fixture the exact Claim digest survived the judgment change unchanged.

That is intentionally not treated as a defect by itself: preserving durable commitments is a core authority invariant. The missing capability is a later semantic mechanism that can determine which committed/landed meaning remains valid after expert judgment changes without throwing away unaffected work or silently preserving invalid meaning.

## F4 raw bounded evidence

Three fresh production trials failed at `RESEARCH_PROMOTION` before close semantics could be evaluated:

```text
trial 1 elapsed = 1463 ms
trial 2 elapsed = 1437 ms
trial 3 elapsed = 1419 ms

code = MH_RESEARCH_PROMOTION_EXIT
stderr contains:
Not inside a trusted directory and --skip-git-repo-check was not specified.
```

The fixture deliberately retained a non-invalidating domain uncertainty while requesting semantic close. Since current production never reached planner/closure interpretation, the correct conclusion is:

```text
F4 end-to-end capability = FAIL
semantic-close mechanism itself = UNMEASURED behind ACI blocker
```

## F5 diagnostic

The supported ACP entry binds one exact managed Git repository root before product execution. That is compatible with the current developer/researcher product but does not provide the planned field-expert greenfield journey.

No bootstrap implementation is authorized by this measurement alone; it remains an R3 productization requirement after the R2 execution blocker is removed.

## Activation/state observation

F1 used fresh ACP transport sessions. F2/F4 used fresh temporary repositories and fresh model activations for every trial attempt. No trial relied on conversation history. F3 shows durable execution commitment survives objective revision independent of activation state. No memory object was required or observed missing.

## Memory disposition

`CONTINUITY-BENCH-1` remains **NO_BUILD**. R1 found no repeated decision-relevant knowledge class that disappears despite being absent from existing durable/retrievable truth. The blocking failures are ingress/model-interface/productization failures, not memory loss.

## Fixture-level disposition

```text
F1 FAIL
F2 FAIL (pre-planner ACI blocker)
F3 DIAGNOSTIC
F4 FAIL end-to-end / semantic close UNMEASURED behind blocker
F5 DIAGNOSTIC GAP
```

No composite field-expert score is calculated.
