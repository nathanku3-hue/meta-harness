---
name: repo-adoption-doctor
description: Given a target repo, diagnose why it is not Meta-Harness adopted and recommend the smallest fix sequence.
owner: nathanku3-hue
source: local
allowed_tools: [read_file, list_dir, grep_search]
forbidden_paths: [.env, secrets, credentials, provider-config, runtime, data]
---

# Repo Adoption Doctor

## Goal

Identify why a target repo is not fully Meta-Harness adopted and produce a prioritized fix list.

## Checks

1. Missing installed templates (sync check)
2. Missing root status.md / events.jsonl (state check)
3. Old runs/ layout present (state check migration)
4. Missing .gitattributes
5. Missing SECURITY.md, CODEOWNERS, dependabot.yml
6. Quality gate failures (oversized files)
7. Package boundary issues (forbidden paths in dry-run)
8. Weak .gitignore (missing secret patterns)

## Output

Return a prioritized list:

- Issue
- Severity (block / warn / info)
- Fix command or manual action
- Phase reference (which roadmap phase addresses this)

## Boundaries

- Read-only: does not modify target repo
- Does not read .env, secrets, credentials, provider output
- Does not expand permissions
