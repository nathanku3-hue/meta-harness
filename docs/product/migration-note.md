# Migration Note

Phase 1 adds additive CLI commands for Dirty Work Autopilot:

```text
meta-harness dirty snapshot
meta-harness dirty classify
meta-harness gate scope
```

Phase 1 command behavior and worker-report output shape were unchanged. The new dirty-work commands create audit artifacts, queue nonblocking dirt, and block or escalate decision-relevant scope dirt.

Batch A updates the `worker-report` CLI contract. Worker reports now require:

```text
--outcome <DONE|PARTIAL_WITH_EXPLICIT_SCOPE|REJECTED>
--requested-work-type <docs|code|test|provider_probe|commit|validation|execution|data_output>
--actual-work-type <docs|code|test|provider_probe|commit|validation|execution|data_output|none>
```

`PARTIAL_WITH_EXPLICIT_SCOPE`, `REJECTED`, and `--actual-work-type none` require `--blocker <reason>`. Generated worker reports are PM Brief artifacts and keep validations separate from evidence artifacts.

Phase 2 adds the Decision Router / Decision Inbox command surface:

```text
meta-harness decisions list --in .meta-harness/decision-inbox.json
meta-harness decisions add --kind <kind> --question <text> --state-hash <hash>
meta-harness decisions resolve --id <id> --resolution <approved|rejected|deferred>
meta-harness brief pm --dirty .meta-harness/dirty-work.json --decisions .meta-harness/decision-inbox.json --out .meta-harness/pm-brief.md
```

Dirty-work `DECISION` classifications become memoized user decisions. `QUEUE`, `PASS`, `BLOCK`, and `ESCALATE` do not become reusable decisions; blockers and escalations appear only in the current PM brief.
