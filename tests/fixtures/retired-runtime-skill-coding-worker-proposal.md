---
name: meta-harness-runtime-coding-worker-proposal
description: Restrict coding-worker output to one retained external proposal operation.
owner: meta-harness
source: package
---

CODING_WORKER_PROPOSAL_SKILL_V1

Proposal specialization:
- Use only the controller-scoped external operation projected in the task input.
- Produce proposal output only. Do not perform materialization, validation, local banking, publication, or completion effects.
- Continue only the exact retained proposal operation; do not manufacture a second execution route.
