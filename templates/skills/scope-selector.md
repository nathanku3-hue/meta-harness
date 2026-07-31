---
name: scope-selector
description: Select one owner-authorized end-to-end functional slice without weakening its acceptance.
---

# Scope Selector

Use this before execution when multiple next steps, ownership ambiguity, handoff risk, or budget pressure exist.

## Authority-Ordered Inputs

Read in this order. Later surfaces may report progress but may not weaken or replace earlier authority.

1. Locked product intent and explicit owner decisions.
2. Roadmap acceptance and the active owner-signed `SliceAuthorization`, including its exact embedded `SliceAcceptance`.
3. Immutable repository facts: canonical Git common-directory identity, initial base, object format, owned paths, and installed external owner pin identity.
4. Immutable mechanics, integration, package, proof, review, publication, and terminal evidence for the active slice generation.
5. Repository-global `slice-state` and operation-event head.
6. Active briefs, worker reports, `.meta-harness/status.md`, stream files, and summaries last.

Status, events, reports, objectives, and summaries are advisory. They cannot create acceptance, change acceptance bytes, authorize execution, or support product closure.

If no valid owner-signed SliceAuthorization exists, output `Chosen Scope: BLOCKED` and name that missing authority. Do not infer authority from prose.

## Output Contract

This is an internal planning artifact. Do not paste it into normal chat unless the user explicitly requests a formal scope artifact or full plan.

```text
Pre-route Decision: <NO_BUILD|USE_EXISTING_REPO_PATTERN|USE_PLATFORM_NATIVE|MINIMAL_PATCH|HUMAN_TASTE|EXPERT_PACKET|AUTHORITY_BLOCK>
Slice ID: <active owner-authorized slice ID>
Acceptance Digest: <exact immutable SliceAcceptance digest>
Chosen Scope: <one bounded end-to-end functional slice or BLOCKED>
Product Result: <observable end-to-end capability or restored user flow>
Terminal Closure: <verification -> acceptance -> integration -> package -> installed proof -> A/B/C -> terminal assessment -> exact publication -> deterministic closure, or one named protected-boundary gate>
Why Now: <one line>
Why Not Alternatives: <one line per rejected alternative>
Low-Confidence Items: <item or none>
Out-of-Boundary Items: <item or none>
Stop Rules: <conditions that halt execution>
Demo Target: <smallest end-to-end proof target>
File Budget: <max files and owned paths/categories>
```

## Selection Rules

1. Preserve the exact active SliceAcceptance bytes. Any byte change requires a new owner-signed G-SCOPE replacement; do not classify changes as stronger, weaker, or editorial.
2. Prefer the smallest end-to-end functional slice that can produce both the named `Product Result` and full `Terminal Closure`; do not optimize for the smallest lifecycle fragment.
3. The `Product Result` must be observable through the slice's operator flow. Internal cleanup, infrastructure, governance, or blocker removal is work inside the slice, not the terminal result, unless it directly restores that flow.
4. Prefer no-build, existing repository patterns, platform-native behavior, and installed templates before new implementation.
5. Preserve explicit non-goals, aggregate path boundaries, execution limits, publication policy, and stop criteria.
6. Reject acceptance-only, integration-only, evidence-banking, authority-update, packaging-only, review-only, and documentation-only rounds as standalone product scopes. They are lifecycle stages inside the owning functional slice.
7. Keep implementation or repair, verification, required acceptance, deterministic integration, exact packaging, installed proof, isolated A/B/C, terminal assessment, exact publication, canonical projection, and continuation in one logical slice.
8. A closure-repair scope is allowed only for an observable user-flow defect in a previously materialized functional slice. It must restore that flow, rerun the original functional-slice exit, and repeat every affected closure stage.
9. If a protected boundary blocks the slice, output `BLOCKED` with the exact owner action or evidence required. Do not create a substitute governance scope.

## Stop Rules

Stop before execution when:

- the owner pin is absent or does not match the signed authorization;
- the repository-global active slice or generation differs;
- the exact acceptance digest is missing or changed;
- owned paths, execution limits, proof oracle, reviewer programs, or publication policy are not bound;
- the proposed scope is only a lifecycle fragment;
- the `Product Result`, original functional-slice exit, or `Terminal Closure` cannot be named;
- required approval is absent;
- authority-ordered inputs conflict;
- the build-vs-borrow pre-route is `NO_BUILD`, `HUMAN_TASTE`, `EXPERT_PACKET`, or `AUTHORITY_BLOCK`;
- the file budget crosses the owner-authorized boundary;
- `SHIP` would be claimed before exact terminal and publication evidence exists.
