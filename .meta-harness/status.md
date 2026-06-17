# Status

Goal:
Build the Build-vs-Borrow Expert Routing Contract as a docs/templates/status slice without adding public command, MCP, connector, daemon, or runtime automation surface.

Phase:
verify

Current truth:
The prior Silent Shipper route/outcome layer now has a build-vs-borrow pre-route. The SOP and product spec ask Question Zero ("Does this need to be built?") before FAST/REVIEW/SLOW/BLOCK routing, require local repo/platform/dependency/template scan before new implementation, and keep terminal outcomes unchanged (`SHIP`, `REVIEW`, `DECISION_NEEDED`, `BLOCKED`, `FOLLOW_UP_QUEUED`). The new reusable skill template `build-vs-borrow-router` is packaged and installed.

Product outcome evidence:
Phase 6B / 13D is documented as a Build-vs-Borrow Expert Routing Contract. Routing now chooses no-build, existing repo pattern, platform native, minimal patch, human taste, expert packet, or authority block before choosing worker, patch, or expert.

Scope boundary evidence:
This patch adds no public CLI command, no MCP/connector/web/daemon/model or network scoring, no auto-search worker, no release/publish automation, no provider credentials, no write-enabled fanout, and no self-approval for authority-changing work. Remote/public skills may inspire patterns but cannot be imported or executed unless vendored, provenance-recorded, evaluated, and explicitly authorized. Product, architecture, security, release, provider, and domain changes cannot close with terminal outcome `SHIP`.

Repo stack evidence:
Meta-Harness remains a dependency-light Node.js CLI package using npm and the built-in `node:test` runner through `node scripts/run-tests.js`.

Owned surface:
Owned paths for this slice are `docs/product/product-spec.md`, `docs/product/roadmap.md`, `docs/sop/meta-harness-sop.md`, `templates/skills/build-vs-borrow-router.md`, `templates/skills/ship-fast-decision-router.md`, `templates/skills/scope-selector.md`, `templates/skills/expert-front-card.md`, `templates/skills/expert-context-packer.md`, `templates/contracts/expert-reconciliation-matrix.md`, matching installed templates and manifest under `.meta-harness/templates/`, `.meta-harness/status.md`, and `.meta-harness/events.jsonl`.

Forbidden surface:
Forbidden behavior remains new public command surface, MCP/connector/web/daemon integration, release/publish automation, CI weakening, security/release/package gate weakening, provider credentials, network/model scoring, dashboards/daemons/autonomy, write-enabled fanout, and self-approval of authority-changing work.

Active streams:
- coding: Build-vs-Borrow Expert Routing Contract documented and locally verified
- research: idle
- writing: idle
- review: ready for human review

Pending human decisions:
- none

Blockers:
- none

Last verified:
Build-vs-Borrow routing verification passed on 2026-06-18 after the route/outcome terminology patch: `git diff --check` passed; `node bin/meta-harness.js sync check --target . --json` passed checked=29; `node bin/meta-harness.js ready --target . --quick --read-only --json` returned ok true with 12 passed, 0 failed, 1 warning, 1 unknown, and 6 skipped; `node bin/meta-harness.js quality check --json` returned ok true with existing warning `MH_COMPLEXITY_CLI_COMMAND_COUNT_WARN`; `npm test` passed 60/60 test files.

Next action:
Review and commit the Build-vs-Borrow Expert Routing Contract if accepted.

Stop criteria:
Fresh human and Codex worker can resume from the Question Zero pre-route contract, packaged build-vs-borrow skill, updated expert packet templates, installed template sync, current status truth, and verification results without adding command/MCP/daemon surface.

Updated:
2026-06-18T02:01:20+08:00
