# Post-Worker SAW Workflow

Mode: ADVISORY_REVIEW

Purpose: provide a read-only GitHub Actions wrapper around worker-report v2 and SAW evidence checks.

Security model:
- no repository secrets;
- read-only `contents` permission;
- checkout pinned by full commit SHA;
- no provider, WRDS, runtime, dashboard, scoring, broker, or data-output paths;
- do not feed issue bodies, PR bodies, review comments, or other untrusted text into agent prompts;
- SAW output is evidence only, not the primary final-answer format.

Reusable workflow shape:

```yaml
jobs:
  post-worker-saw:
    uses: owner/meta-harness/.github/workflows/post-worker-saw.yml@<full-commit-sha>
    with:
      worker_report_glob: ".meta-harness/workers/*.md"
      base_sha: ${{ github.event.pull_request.base.sha }}
      head_sha: ${{ github.sha }}
```

Use a full commit SHA for cross-repo callers after audit. Same-repo callers may use `./.github/workflows/post-worker-saw.yml`.

Checks:
- PM/CEO worker-report v2 shape, excluding `worker-report-template.md`;
- no silent docs-only fallback;
- changed-file allowlist with optional explicit `base_sha` and `head_sha`;
- forbidden path guard;
- YAML workflow parse check;
- Markdown conflict-marker/encoding hygiene;
- SAW evidence wrapper summary.

Stop rule: if any check fails, report the failure and propose a repair plan; do not edit files unless a separate repair round is approved.
