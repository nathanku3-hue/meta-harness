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

1. Dirty checkout recovery comes first: Git may establish dirt, not mutation origin. Preserve the checkout and classify retained provenance, authority/custody, protected current work, reversibility, and the exact repair set before generic code review.
2. Missing installed templates (sync check)
3. Missing root status.md / events.jsonl (state check)
4. Old runs/ layout present (state check migration)
5. Missing .gitattributes
6. Missing SECURITY.md, CODEOWNERS, dependabot.yml
7. Quality gate failures (oversized files)
8. Package boundary issues (forbidden paths in dry-run)
9. Weak .gitignore (missing secret patterns)
10. Operative host-guidance action-law conflicts (universal review/SAW/fixed Architecture→GO pauses/routine owner approval for ordinary reversible work)

## Output

Return a prioritized list:

- Issue
- Severity (block / warn / info)
- Fix command or manual action
- Phase reference (which roadmap phase addresses this)

## Boundaries

- Read-only: does not modify target repo
- Never reset, clean, stash, checkout, or otherwise rewrite a dirty target while diagnosing adoption
- Does not read .env, secrets, credentials, provider output
- Does not expand permissions
