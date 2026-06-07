# Security Policy

## Reporting Vulnerabilities

Report security vulnerabilities by opening a private security advisory in this repository.

Do not open public issues for security vulnerabilities.

## Supported Versions

Only the latest published version receives security fixes.

## Credential Rotation

If a secret is committed to this repository at any time:
1. Rotate the credential immediately.
2. Treat the old credential as compromised.
3. Do not rely on git history removal as a security control.

## Agent Security Boundaries

Meta-Harness agents, skills, and subagents must not:
- Read .env, secrets, credentials, or provider output files.
- Write secrets into PM briefs, worker reports, expert packets, or events.
- Expand workflow permissions, dependency lists, or provider access without decision-inbox approval.
