---
name: post-worker-github-actions
description: Audit post-worker GitHub Actions and SAW evidence for worker-report v2 artifacts; use when Codex needs to inspect CI/run evidence, validate PM-facing worker reports, enforce read-only/no-secret/no-provider boundaries, and propose a repair plan before edits.
---

# Post-Worker GitHub Actions

Use this skill for read-only post-worker CI and SAW checks.

## Workflow

1. Inspect concrete run evidence with `gh` when available:
   - `gh run view <run-id> --json name,workflowName,conclusion,status,url,event,headBranch,headSha`
   - `gh run view <run-id> --log`
2. Validate the worker-report v2 artifact:
   - first visible fields are `Outcome`, `Round`, `Progress`, `Confidence`;
   - skip `worker-report-template.md`, because it is a template and not a completed report;
   - required PM sections exist;
   - `requested_work_type` and `actual_work_type_performed` are present;
   - `DONE` is rejected when code/test/provider_probe/commit/validation/execution/data_output silently became docs-only or none.
3. Check changed files against an explicit allowlist, preferably with caller-supplied `base_sha` and `head_sha`.
4. Fail closed on secrets, provider access, WRDS, runtime/dashboard/scoring/broker paths, or data output.
5. Summarize SAW evidence as evidence only.
6. Propose the next action and stop before edits.

## Boundaries

- Do not pass secrets or use `secrets: inherit`.
- Do not read credentials, `.env`, `secret.txt`, provider output, WRDS output, or runtime data.
- Do not feed issue text, PR body text, comments, or review text into agent prompts.
- Do not repair workflows or code unless the user explicitly approves a separate repair round.
- Treat composite actions, Harden-Runner, and skill-validation actions as optional later hardening.

## Evidence Summary

Report:
- failing check name and run URL;
- exact worker-report validation failure;
- changed-file allowlist failure;
- skipped checks with reason;
- one recommended next action.
