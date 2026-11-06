# Agent Skill Access

## Local implementation

- Settings: `/app/settings#agent` provides Skill export and client revocation.
- Browser consent: `/app/agent/authorize?user_code=XXXX-XXXX`.
- Device authorization: `/api/agent/device-authorization` and `/api/agent/token`.
- Agent API: `/api/v1/me`, `/api/v1/models`, `/api/v1/uploads`, `/api/v1/generations`, task status and owned image endpoints.
- See `resources/chugao-image/references/api.md` for request formats and `resources/chugao-image/SKILL.md` for the portable Agent workflow.

Device codes expire after 10 minutes. Clients poll every 5 seconds and back off on `slow_down`. Browser approval grants one task for at most 24 hours, or an absolute duration of 1 hour to 30 days. Credentials are separate from the exported ZIP; only hashes are persisted on the server. Agent authentication is separate from website sessions and cannot authenticate admin routes.

Generation uses the existing queue, account limits, pricing snapshot, reserve, actual-size settlement and refund functions. An operation must retain its `Idempotency-Key` and body when retried. Revocation stops new API calls without canceling submitted jobs. Reauthorization can recover the same owned job without another debit.

## Verification

Run these commands sequentially with the local PostgreSQL and Redis services available:

```sh
node node_modules/vitest/vitest.mjs run --config vitest.agent.config.ts
node scripts/test-agent-access.mjs
node node_modules/vitest/vitest.mjs run --config vitest.config.ts components/agent
node node_modules/vitest/vitest.mjs run --config vitest.config.ts components/auth lib/safe-next-path.test.ts
PYTHONDONTWRITEBYTECODE=1 python3.12 -m unittest discover -s resources/chugao-image/tests -v
node node_modules/typescript/bin/tsc --noEmit --incremental false
pnpm build
```

The database test script refuses a remote database, creates its own local scratch database, verifies the additive migration and removes the scratch database afterward. Providers, queue submission and image storage are simulated; it does not call a paid upstream.

Verified on 2026-10-20: 45 server unit/regression tests, 6 real PostgreSQL integration tests, 38 Agent UI/duration tests, 33 Python tests and 33 login/session/redirect tests passed (155 unique tests). Prisma schema and Skill format validation passed. The last UI rerun passed all 41 Agent and login tests after the browser-discovered fixes below.

Full TypeScript checking and the final production build passed, including all 74 static-generation entries, build tracing and standalone preparation. ESLint reported warnings, not errors. No paid upstream generation calls were made.

### Latest retry on 2026-10-20

The iCloud source-download blocker is resolved. Explicit downloads restored all required application sources; two dependency caches were restored at their existing locked versions. No unavailable working-tree source was replaced with an older Git version.

Build inspection found Tailwind scanning backend runtime files and documentation. `app/globals.css` now excludes `services`, `docs` and `validation` from class detection while retaining application, component and library sources. This removed the invalid CSS generated from a documentation example and avoided unrelated cloud-file reads.

Real browser acceptance passed at desktop 1280x720 and mobile 390x844, with no horizontal overflow. The test account had zero credits. Verified the default single-task option, seven-day custom default, rejection of 31 days, two-hour consent, successful token receipt, one-time token exchange, account reads, client listing, last-used time, revocation, immediate 401 for the revoked token, and browser refusal followed by `access_denied`.

Two UI issues discovered during this acceptance were fixed: successful login now starts a fresh same-origin document navigation instead of racing router push/refresh, and the asynchronously loaded Agent settings section honors the `#agent` anchor. The browser retest reached consent immediately after login without a manual refresh, and the mobile client list scrolled into view.

Screenshots are under `output/playwright/agent-access/`: `authorization-approved.png`, `authorize-mobile.png`, `settings-mobile-revoked.png` and `authorization-denied-mobile.png`.

The current Skill ZIP was independently opened and contains exactly three nonempty files: `SKILL.md` (4,822 bytes), `scripts/chugao.py` (40,392 bytes) and `references/api.md` (11,524 bytes).

The final standalone server was started separately and tested through its actual cookie-authenticated endpoints using simulated reverse-proxy headers. Login and Skill download both returned 200; the downloaded ZIP was 18,815 bytes and contained the same three nonempty runtime files. No environment files were present at the standalone root. Full-stack local health remains degraded because not all generation dependencies are running; no generation worker was started to consume existing local jobs during this check.

The user has requested deployment after successful acceptance. SSH connectivity was restored by binding a direct `nc` socket to physical interface `en13`; unsetting proxy variables alone did not bypass the TUN route. The user accepted the presented new host fingerprint, kept separately from the older host-key record. Both the server identity and current Chugao runtime were then verified.

## Production release on 2026-10-20

Revision `agent-access-20261020` is deployed at `https://chugao.art`. The active production root is `/opt/chugao-v2.3-main`, compose project `chugao-studio`, not the retained `/opt/chugao-studio` directory. The web image is `chugao-studio-web:agent-20261020`; the existing worker remains on `r3-recovery-20261018-105800` and was not restarted. Both are healthy. The additive migration `20261020090000_agent_authorizations` is applied, bringing production to 18 migrations. No reset, seed or schema push was used.

The release was merged onto a downloaded production baseline, not synchronized from the whole local working tree. It excludes local Research models/routes and preserves the dependency lock except for `fflate@0.8.2`. This merged baseline passed 45 server checks, 41 UI/login checks, six PostgreSQL integration tests, full TypeScript checking and a production build with 70 static-generation entries. Source hydration completed before packaging. All 53 transferred source files and 781 runtime files were hash-verified. The Linux image reuses the existing locked production dependency layers with a newly generated Agent Prisma client; the copied web payload contains no environment files or Mac native binaries.

A temporary loopback instance passed full health and authorization checks before web cutover. Public HTTPS then passed nine smoke checks: login, exact three-file Skill ZIP, same-origin enforcement, two-hour device grant, one-time exchange, bearer account/model reads, denied administrator access, client listing/immediate revocation, and pending/denied authorization. The ZIP is 18,815 bytes and its entries match the accepted resources. Synthetic accounts had zero credits and were removed; no paid upstream requests were made. An initial candidate probe used a domain-blind cookie jar that discarded the shared-domain session when clearing a legacy host cookie; the probe was corrected without changing application code.

The protected backup `/opt/server-fix-backups/20261020-agent-access` contains original source/environment, PostgreSQL and Redis snapshots, a fresh pre-migration database dump, manifests and release reports. Existing application traffic added two generations/images between the initial backup and the migration checkpoint. The pre-migration checkpoint and final release comparison retain 71 users, 3821 generations, 3671 image records, three providers, eight provider accounts, 70 price rows and 39 configuration rows. All pre-existing row fingerprints match, including balances and credentials; the new nullable generation column is excluded from the legacy-column comparison. All 3022 checkpointed storage files remain present with unchanged sizes. The original environment checksum and storage volume are unchanged. Public model/pricing responses are byte-identical before and after release.

Direct physical-interface public health and chat health return 200. The unauthenticated consent page redirects once to login with its return path intact. Temporary release instances and build workspaces are removed after acceptance; rollback tags and protected backup evidence are retained.

## Release boundary

Future releases must continue to compare the live baseline and preserve environment files, existing users, credits, images and provider settings. This working tree contains unrelated local Research changes that are not deployed. Rollback images are tagged `chugao-studio-web:before-agent-20261020` and `chugao-studio-worker:before-agent-20261020`; keep the additive Agent schema and existing user data during application rollback. The current worker is compatible with the added nullable field and does not need a restart for Agent image submissions.
