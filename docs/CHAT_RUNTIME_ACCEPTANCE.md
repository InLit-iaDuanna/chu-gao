# Chat Runtime Acceptance

Updated 2026-10-18. The supplied r2 review's implementation batches A-D are
complete and revision `r3-recovery-20261018-105800` is deployed at
`https://chugao.art`, following `r3-166e66dc16f8`.
Local mock/real-provider HTTP acceptance, browser checks, typecheck and production
build passed. Production health, native Sol SSE/search, migration and preservation
checks also passed. This is not approval of a full-account financial ledger.

## Scope And Data

During local acceptance, existing local application users, balances,
conversations, messages, generations and images were
not used as test fixtures or modified. Before/after counts are 5 users, 14
conversations, 35 messages, 22 generations, 11 images and zero managed chat turns.
The ordered id/credit SHA256 remains
`d0f43ea229929006cbe022f42e3b11c2464268c452e35044f9d935022c378622`.

Additive migrations were rehearsed locally. Sol uses encrypted configuration at
`https://ai.ldai.us` and 0.2 credits per completed turn, now in production as well.
The local development app remains at
`http://127.0.0.1:3000/app`; its standalone chat worker is online on protocol 2.
The image-generation worker was already offline and was not enabled by this task;
its global health status must not be confused with `/api/health/chat`.

## Production Rollout

The active production root is `/opt/chugao-v2.3-main`, compose project
`chugao-studio`, behind Nginx on loopback port 3002. The release was prepared on
an isolated port, old requests were drained, API writes were paused, and old
web/worker processes were stopped before the final data checkpoint. Admission
reopened at 2026-10-18 10:27 UTC after all release checks passed. Nginx disables
buffering, caching and gzip for `/api/chat/` SSE.

- All 13 previously applied migration checksums matched. The production-only
  `20260927090000_material_inbox_beta_access` migration and its administrator
  permission were preserved in source. Four additive chat migrations brought
  production to 17 migrations; no reset, seed or schema push was used.
- The server built the locked Linux amd64 worker/dependencies. Native web builds
  stalled and were cancelled. The successful web image uses verified standalone
  JavaScript built with production origin `https://chugao.art`, plus those same
  locked Linux dependencies. The payload scan found no secrets, environment
  files or Mac native binaries. Candidate login, Prisma reads, authorization,
  redirects and JS/CSS assets passed before cutover.
- The quiescent comparison retained 68 users, 500 conversations, 4410 messages,
  3742 generations, 3590 image records, 4690 usage records, 70 image price rows,
  3 providers, 8 provider accounts, 8 PPT jobs and 46 slides. All protected
  pre-existing column hashes matched after migration and startup, including
  user balances. Environment hash and original Docker volumes matched; all
  2817 checkpointed storage files remained present with unchanged sizes.
  The public image model catalog and pricing response were identical.
- The production read-only chat audit was clean and verified two consecutive
  drained snapshots with admission closed. No outstanding holds or active tasks
  were present. Web and worker subsequently passed their health checks, and
  direct public health/chat-health requests returned 200.
- Two synthetic Sol requests passed from the Linux production network. Plain SSE
  completed in 3235 ms with 5 text deltas; native search completed in 10411 ms,
  reported search execution and one citation. Both reported usage. No existing
  user history or balance was used by these probes.
- One Luna probe produced only a blank character, then EOF without a completed
  event. Luna is disabled in the public catalog; its encrypted key and 0.2 price
  remain unchanged. Sol is the default at 0.2 credits. Existing DeepSeek prices
  and all image channels/prices remain unchanged. Deployment used 3 provider
  requests, taking the conservative authorized running count from 90 to 93/100.

Root-only rollback artifacts and reports are retained at
`/opt/server-fix-backups/20261018-092608-r3-runtime`, including the original code,
environment, database/Redis snapshots, original image tags, quiescent dump,
`data-preservation.json`, native probe reports and release hashes. The initial
database dump was restored into a disposable scratch database and checked;
production data was never replaced by a restore. The temporary candidate
container and build workspace are removed after release; rollback artifacts are
not build-cache cleanup targets.

## Upstream Recovery Follow-Up

Revision `r3-recovery-20261018-105800` reopened admission at 2026-10-18
11:24 UTC. Both web and worker are healthy. No migration or dependency change
was required; production remains on 17 applied migrations.

- A real failed upstream SSE reported `Unable to forward upstream stream`
  after about 40 seconds, with 5307 characters retained. This was not the
  application's execution timeout. Transient failures now receive at most two
  recovery requests within the original deadline, retaining the same attempt,
  message and single user charge. This is a new upstream continuation request,
  not a guarantee of native provider-side resumption.
- The real synthetic interruption check preserved its 602-character prefix and
  completed all 100 numbered lines in order, without repeated or missing line
  numbers. The earlier mid-line test exposed a skipped unfinished line; its
  failed report is retained separately, and the continuation boundary was fixed.
- Two stable-prefix cache requests both completed with 4517 input tokens. The
  second reported 4328 cached tokens. The test sent no user history. New turns
  place the frozen runtime time note at the end of current input, keeping the
  reusable instruction/history prefix stable. Missing cache fields remain
  unknown; response storage is not prompt KV caching.
- Focused node recovery/worker/subscription checks passed 28 tests; related
  frontend/instruction/context/upstream checks passed 63 tests. The real
  PostgreSQL suite passed 29 tests and rehearsed all 17 migrations in scratch
  databases. Production build, included typecheck, scoped lint and diff checks
  passed. Test counts overlap earlier runs and are not cumulative totals.
- Before restart, existing image work was allowed to finish. A temporary write
  gate also blocked uploads with `SERVICE_UPDATING`; uploads were restored during
  drain, and the final brief freeze was removed after cutover. Public upload POST
  now reaches normal authentication (401 without a session), rather than the
  maintenance gate. Public health/chat health and login return 200; `/app`
  redirects once to the login path for an unauthenticated request.
- All 17 protected table hashes matched the final quiescent checkpoint: 68 users,
  503 conversations, 4439 messages, 3754 generations and 3603 image records.
  Balances, provider accounts, 70 price rows, protected configuration, environment
  hash and original Docker volumes were unchanged. All 2859 checkpointed storage
  files remained present with unchanged sizes. The read-only chat audit found no
  active attempts or outstanding holds before admission reopened.
- Six real provider calls were used for cache and interruption checks, taking
  the conservative authorized running count to 99/100. No user balance was used
  for these probes. The local standalone worker was refreshed to the same source
  and local admission restored; the local image worker remains untouched.

Root-only backups and release evidence are retained at
`/opt/server-fix-backups/20261018-105800-r3-runtime`. See
`data-preservation.json`, `worker-source-proof.json`, `cache-probe.jsonl`,
`continuation-probe-final.json` and `deployment-result.json`. Local build and
database logs are `output/chat-recovery-build-release-20261018.log` and
`output/chat-recovery-db-release-20261018.log`.

## Implementation Worklist

| Batch                           | State            | Result                                                                                                                                                                                        |
| ------------------------------- | ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A: execution and money identity | Complete locally | Persistent pending submissions; same-key replay and lookup; old POST 426 before billing; independent receipts/tombstones and Decimal hold entries; idempotent administrator adjustments.      |
| A: terminal races               | Complete locally | Turn then attempt locks; recheck lease/token after locking; one terminal winner and one hold close; two-worker CAS coverage.                                                                  |
| B: recovery                     | Complete locally | Expected attempt on cancel/retry; known-turn snapshot reconciliation; stale events cannot replace a newer attempt; accepted submissions do not become new sends after history-read failure.   |
| B: partial results              | Complete locally | Catch persists the current accumulator; parts, annotations, sources and raw/unknown usage survive failure and refresh; guarded events cannot follow a terminal result.                        |
| C: operations                   | Complete locally | Separate queue deadline, database-clock leases, bounded Redis calls and stop, per-instance protocol/build health, independent admission and administrator controls.                           |
| C: upgrade and exit             | Complete locally | Actual historical migrations, retained receipts/ledger, read-only reconciliation, negative and positive drain checks; rollback procedure preserves recovery and identity.                     |
| D: context                      | Complete locally | PostgreSQL snapshots, revision/hash validation, complete turn bundles, historical images, ordered mixed references and actual request manifests.                                              |
| D: presentation                 | Complete locally | Stable assistant nodes, truthful phase/wait/reconnect feedback, retained source links, completed-only automatic HTML preview, labeled partial source/preview and mobile overflow containment. |

The hold ledger covers managed chat and shared administrator adjustment entries,
not opening equity, redemption, image/PPT jobs and every account balance input.
A database transaction cannot guarantee exactly-once remote provider computation.
Neither limitation is disguised as an implemented guarantee.

## Database, Static And Unit Verification

- `pnpm test:chat:db`: **28/28** real PostgreSQL integration tests passed.
  The same runner rehearsed all **16 actual migrations** from pre-chat and r2
  synthetic schemas, without `db push`.
- Migration evidence includes unchanged synthetic legacy messages, UsageLog and
  balances, receipt/hold backfills, duplicate-key rejection, conservation checks,
  no schema drift, read-only audit, timeout/row-limit refusals, two-snapshot drain
  and retained tombstones/ledger after content deletion. Scratch databases were
  removed.
- `pnpm test:chat`: **62 passed**, **28 PostgreSQL tests skipped** in this
  non-database command. Those skipped tests are covered by the separate DB run,
  not counted as unit-test passes.
- The related UI/service run passed **258 tests across 26 files**, including
  actual managed Studio branches, rendering, ordered references, legacy retirement,
  image/chat history concurrency and administrator adjustment recovery.
- After the final Sol capability/cookie changes, the focused context/route/summary/
  cookie run passed **87/87**. The dedicated authentication regression run passed
  **20/20**. These overlap the broader runs and are not additive totals.
- Final `pnpm exec tsc --noEmit --incremental false --pretty false`, scoped ESLint,
  scoped Prettier and `git diff --check` passed.
- Final `pnpm build` passed with 60 prerendered pages and a prepared standalone
  runtime. See `output/chat-runtime-build-final.log`.
  The helper supplies the complete locked Next 15.5.18 runtime/static/public files
  and removes environment files from the generated standalone bundle.
- The local read-only CLI reports a clean, quiescent chat ledger with zero
  outstanding holds/tasks. Admission is open, so this is deliberately **not**
  reported as authorization to stop the final worker.

Earlier intermediate test-runner/typecheck failures were fixed; they are not the
current project status.

## Final HTTP And Provider Evidence

`output/chat-runtime-acceptance-mock-final-20261018.jsonl` ends in
`status=passed`: 15 core checks, one durable-summary probe and four interactive
HTML/Markdown requests, for **17 mocked requests** and zero real requests.

`output/chat-runtime-acceptance-real-final-20261018.jsonl` ends in
`status=passed`: 15 core checks, durable summary and website multi-turn/ordered
vision, using **16 actual provider requests**. There were no denied or unexpected
requests. The run verifies:

- Real authentication/device sessions, catalog and retired legacy POST.
- Plain Responses SSE, idempotent creation and a single completed settlement.
- Native search events and citations; an allowed-but-unused search is not labeled
  as performed.
- Explicit incomplete, malformed-frame and non-SSE faults; parsed partial text is
  retained and incomplete/failed attempts are not charged. Missing usage remains
  unknown rather than fabricated zero.
- Attempt-bound cancellation/retry, late-operation rejection, disconnect/reconnect,
  independent admission pause and protection of active conversation history.
- Cleared create/retry keys remain tombstoned, without another upstream call.
- Ledger/API/worker parity and quiescence after all accepted work.
- Actual SSE summary generation, durable snapshot reuse after appending history,
  current request hash/snapshot binding and correct anchor/count recall.
- Three actual website image turns: an initial image with a non-descriptive ACK,
  later visual recall from the historical original image, and generated/upload
  images sent in the specified mixed order. Images are self-authored solid colors.

The earlier real run used **19 requests**. Its direct medium/high/xhigh and
vision/order probes passed, but its initial partial-text observer and escaped
summary assertion failed. Those harness defects were corrected; the final run
above passed the affected cancellation/summary paths. The earlier report remains
at `output/chat-runtime-acceptance-real-20261018.jsonl` and is not relabeled as a
passing overall run. This revision used **35 actual requests** in total; with the
prior conservative count of 55, the authorized 100-request allowance is not
exceeded.

All requests used direct sockets without proxy, redirect-following or hidden
upstream retries. Real credentials were provided in memory, never saved in source,
reports or synthetic database fixtures. Both final harness runs stopped their
processes, removed their own heartbeat records, dropped scratch databases and
removed private temporary files.

## Browser And Stop Evidence

`output/chat-browser-acceptance-20261018.json` records actual headed Chrome checks
on macOS ARM64 at 1440x900 and 390x844, without CPU throttling:

- A real production-mode loopback login retains both device and session cookies.
  The loopback cookie fix leaves configured production shared-domain behavior
  intact.
- During a 15,696-character Markdown stream with 100 code lines and 70 table rows,
  the assistant article identity, code folding, selected text and upward scroll
  position survive the terminal snapshot. Code copying exactly matches displayed
  source, including `<>&`.
- No >50ms long tasks were observed in that sample; maximum recorded interaction
  duration was 24ms. This is a bounded rendering sample, not a load-test result.
- The mobile table has a 356px scroll viewport and 576px content; its internal
  horizontal scroll works while document width remains 390px.
- The mobile five-position effort popup measures 288x134px and fits the viewport.
- Completed HTML automatically previews. Incomplete HTML initially shows labeled
  source with no iframe; explicit fragment preview remains labeled.
- Normal and enlarged preview have empty sandbox permissions and no-referrer.
  Script/handler, image, CSS URL/import, stylesheet, iframe, form and refresh
  fixtures produce **zero sentinel network requests**, including button clicks.
  The 16 console errors are expected CSP blocks; no application exceptions were
  observed.
- Administrator admission pause saves and persists after refresh, then restores.
  The administrator page also remains within the 390px viewport.

Screenshots are under `output/playwright/chat-r3-*.png`.

`output/chat-worker-blackhole-20261018.json` records an actual worker against
scratch PostgreSQL and a TCP Redis blackhole: 134 RESP bytes accepted, no replies,
SIGTERM exit 0 in **2016ms**, zero provider calls and complete scratch cleanup.

## Capability And Release Boundaries

Sol's low/medium/high/xhigh/max controls and vision are enabled in the source after
successful real compatibility probes. Parameter acceptance does not establish a
quantitative difference in reasoning strength or long-term upstream reliability.
The 24k limit is the application's estimated **input** budget, not a verified
provider context capacity. Raw reported usage and estimator/profile versions are
retained for later calibration.

Application-managed durable summary compression is implemented and verified.
Native provider compaction/token-count endpoints, maximum context limits and
arbitrary native tool-result replay are **not enabled or claimed**. They remain
separate opt-in capability experiments; no unverified provider feature is silently
used as a dependency.

The live rollout and backup restore rehearsal above were performed; an actual
production downgrade was not. For deployment and rollback, use
[CHAT_RUNTIME.md](CHAT_RUNTIME.md):
close new admission, keep compatible workers/recovery available, require clean
audit and zero queued/running/reserved/active counts, and retain migrations,
receipts and ledger. A remaining terminal activeAttemptId is not pending work.

## Reproduction

```sh
pnpm db:generate
pnpm test:chat:db
pnpm test:chat
pnpm build
node --env-file=.env --import tsx scripts/verify-chat-runtime.ts --run --keep-alive --probes=context-summary
```

The harness creates only random local scratch databases and synthetic identities.
For a separately authorized real run, add `--real --key-stdin`, a strict request
budget and the intended `CHAT_VERIFY_UPSTREAM_BASE_URL`. See script help before
running; credentials must not be put in command arguments or committed files.

Operational reconciliation is opt-in and read-only:

```sh
node --import tsx scripts/chat-runtime-status.ts --read-only
node --import tsx scripts/chat-runtime-status.ts --read-only --wait-drained --timeout-ms 60000 --interval-ms 1000
```
