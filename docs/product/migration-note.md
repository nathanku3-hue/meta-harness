# Migration Note

Phase 1 adds additive CLI commands for Dirty Work Autopilot:

```text
meta-harness dirty snapshot
meta-harness dirty classify
meta-harness gate scope
```

Existing command behavior and worker-report output shape are unchanged. The new commands create dirty-work audit artifacts, queue nonblocking dirt, and block or escalate decision-relevant scope dirt.
