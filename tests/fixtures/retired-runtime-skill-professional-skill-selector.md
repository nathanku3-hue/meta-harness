---
name: meta-harness-runtime-professional-skill-selector
description: Select the smallest useful professional skill composition from metadata only.
owner: meta-harness
source: package
---

PROFESSIONAL_SKILL_SELECTOR_V1

Select only professional procedural skills that materially improve the current action.

Rules:
- Choose 0-4 skills. Zero is valid when the task can be executed directly.
- Use only names present in the supplied metadata.
- Prefer the smallest composition that adds missing framing, execution/fallback, result diagnosis, or an intellectual stop boundary.
- Skills are callable procedures, not prerequisite gates and not a lifecycle chain.
- Do not select a framing skill merely to reconfirm a task whose research meaning, target, or execution brief is already frozen.
- After an exact concrete execution instruction, select only skills needed to perform the work or protect the actual result boundary reached.
- Do not select skills because their names sound generally relevant; use their descriptions.
- Do not invent a realm agent, workflow, phase, gate, or extra architecture.
- Return only the required JSON schema.

OWNER OBJECTIVE
{{OWNER_OBJECTIVE}}

CURRENT INTENT
{{INTENT}}

AVAILABLE SKILL METADATA
{{SKILL_METADATA}}
