# Publication Route 0.4 (C0-PUBLICATION-ROUTE-1)

Route infrastructure only. Product package bytes are the pre-built generation-3 tarball.

## Pins

| Field | Value |
| ----- | ----- |
| Source commit | `99057c4e2334e3c243123683448ef5108e514786` |
| Source tree | `a44b374aa411e928af6a89dcbdb08df826f11e15` |
| Staged tarball | `publication-route/custody/nkgss-meta-harness-0.4.0.tgz` |
| Bytes | `311004` |
| SHA-256 | `67374d0f0d94a1a55b2380432482aaaee4c70aa704ee9416a8a0316789dc4892` |

## Workflow

- File: `.github/workflows/publication-route-0.4.yml`
- Default / push path: **verify only** (no `npm publish`, no `npm pack`)
- Publish path: `workflow_dispatch` with `mode=publish` **and** `c0_publish_authorization=AUTHORIZED_C0_PUBLISH_EXACT`
- Environment: `publication-route-0.4` (publish job only)
- OIDC: `id-token: write` on verify and publish jobs

## Local verify

```bash
node scripts/publication-route/verify-staged-tarball.mjs
```

## Forbidden on this route

- Creating `v0.4.0` without C0
- `npm pack` / rebuild
- Changing generation-3 evidence or authority state
- Mutating product/runtime sources on this branch beyond route files
