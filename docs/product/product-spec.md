# Meta-Harness 0.4 Product Specification

## Product result

An installed outcome-first planner reconciles locked product intent and repository authority before status, executes the nearest complete user journey, blocks only demonstrated threats to that outcome, reuses unaffected evidence, and stops after shipped or value-confirmed completion unless explicit owner scope change or a complete observed supported-use defect warrant justifies continuation.

## Required planner behavior

- Truth precedence: locked intent and owner authority; immutable product/closure evidence; Git facts; status and summaries.
- At most one audit/repair round before the complete journey executes.
- Blocking impacts are limited to journey prevention, material conclusion invalidation, credible irreversible loss, and supported-platform unusability.
- Optional findings are retained as non-blocking residue.
- Passed evidence remains valid while its declared input surface is unchanged.
- Lifecycle stages remain inside one functional slice.
- Terminal default is `NO_BUILD` and `USE_PRODUCT`.
- Owner scope change requests new authorization; a complete observed supported-use defect warrant selects the smallest repair.
- No post-closure successor activation claim or queued follow-up after `NO_BUILD`.

## Worker-report contract

The first five non-empty lines are, in order: `User journey executed:`, `Observable result produced:`, `User accomplished or learned:`, `Product blocker:`, and `Next executable product action:`. Reports must not begin with `# Worker PM Brief`, internal status, hashes, or command logs. `Outcome:` and accountability metadata follow the five product fields.

## Authority and custody

One external create-only Ed25519 owner pin signs the exact SliceAuthorization. The installed runtime supports DELIVERY only. Mechanics cannot claim product acceptance. Candidate integration is fast-forward only. The authoritative package is built once, installed for proof, reviewed by isolated Product/Domain/Custody processes, published without rebuild, reconciled independently, and closed through deterministic projection.

## Deployment

Install the exact terminal package into one clean canary. After the fresh-session terminal interaction passes, install the same package into clean worktrees based on each repository’s actual default branch and integrate each repository separately. Never install directly into dirty checkouts, archives, evidence folders, or managed worktrees.
