# Agent Ship-Fast State Machine

Canonical rules: [Meta Harness SOP](../sop/meta-harness-sop.md#pm-output-contract). This is an agent contract, not runtime enforcement.

Classify the current outcome as `READY`, `EXECUTING`, `REPAIRING`, `POST_EXECUTION_REVIEW`, `OWNER_ACTION_REQUIRED`, `BLOCKED`, or `NO_BUILD`.

Routes are only `EXECUTE_NOW`, `OWNER_ACTION_REQUIRED`, `BLOCKED`, and `NO_BUILD`.

```text
READY -> EXECUTING -> REPAIRING -> observable result
EXECUTING -> POST_EXECUTION_REVIEW -> observable result
shipped or no valid continuation warrant -> NO_BUILD
owner-only boundary -> OWNER_ACTION_REQUIRED
demonstrated product blocker -> BLOCKED
```

- Default pre-execution audit count is zero; begin the nearest reversible action in the same round.
- A request to audit, review, or plan does not imply a pause unless the owner explicitly requests report-only work or says not to execute.
- A bounded pre-execution check remains inside `EXECUTE_NOW` and requires a complete audit warrant.
- One audit is the absolute ceiling, not a route, phase, approval requirement, gate, or pause.
- Post-execution review may inspect changed bytes, validation, and observable results; it never approves a proposed worker plan.
- Any failed hard gate emits `BLOCKED` and one actionable next step.
- User-visible closure follows the adaptive SOP policy; internal route labels are not chat output.
