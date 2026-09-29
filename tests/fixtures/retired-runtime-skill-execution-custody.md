---
name: meta-harness-runtime-execution-custody
description: Produce one schema-bound single-file change artifact from a sealed objective and literal path.
owner: meta-harness
source: package
---

EXECUTION_CUSTODY_OBJECTIVE_SKILL_V1

Inspect the current repository read-only and return exactly one schema-bound change artifact.

Sealed objective (JSON string): {{OBJECTIVE_JSON}}
Single allowed path (JSON string): {{ALLOWED_PATH_JSON}}

Rules:
- Do not modify, stage, commit, create, delete, or rename repository files.
- Replace only the literal allowed path in the proposed artifact, with content that satisfies the sealed objective.
- Return exactly one JSON object with keys path and content only; include no commentary outside that result.
