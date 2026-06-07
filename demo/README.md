# Meta-Harness Demo Workspaces

This directory contains simulated and historical workspaces used as demo run configurations and test fixtures for terminal visualization.

## Contents

- `2026-05-02-terminal-visualization/`: Contains mock workspaces (`parent`, `coding-session`, `research-session`) showing events, status, and worker reports layout.

These directories are intentional test fixtures and historical references. Do not run active workspace commands directly inside them unless testing demo behaviors.

The nested `.meta-harness` directories are synthetic fixture state, not live source-repo runtime state. They must not contain secrets, provider configuration, runtime outputs, local locks, or raw trace data.

The npm package intentionally excludes `demo/` through the package `files` allowlist. `npm pack --dry-run` should not include these fixtures.
