# Durable Chat Runtime

Revision `r3-recovery-20261018-105800` was deployed to `https://chugao.art` on
2026-10-18 at 11:24 UTC, following `r3-166e66dc16f8`.
Web and worker are healthy on protocol 2; admission is open. Sol is the default
at 0.2 credits per completed turn. Luna is temporarily disabled after its native
SSE probe failed; its encrypted credential and price remain intact. See
[CHAT_RUNTIME_ACCEPTANCE.md](CHAT_RUNTIME_ACCEPTANCE.md) for local acceptance,
production checks, data-preservation evidence and capability boundaries.

## Scope And Admission

The Studio uses durable turns when its catalog entry advertises
`supportsDurableTurns`. The configured default, Luna and Sol use this path.
Authenticated POST `/api/conversations/chat` now returns HTTP 426
`CLIENT_UPGRADE_REQUIRED` before any provider or billing operation; GET still
serves the catalog. A cached legacy page cannot start an independent chat charge.

`SystemConfig["chat.runtime"]` controls new creation/retry independently of model
credentials or model enabled flags. The authenticated admin endpoint
`GET/PATCH /api/admin/chat-runtime` exposes `enabled`, `profiles`, `userAllowlist`
and nullable `queueTimeoutMs`. A PATCH with `{"enabled":false}` pauses admission;
already accepted work, subscriptions, cancellation and recovery remain available.
The default is enabled, all supported profiles, no user allowlist restriction and
no queue deadline. Do not disable a model/key as a substitute for pausing admission.

Sol keeps its own encrypted settings and explicit credentials. Native Responses
uses real SSE, `store:false`, `Accept-Encoding:identity`, and native search events.
There is no silent two-stage or non-streaming fallback in the durable execution
path. This document does not establish real-provider capability or reliability.

## Execution And Retained Identity

### Bounded Upstream Recovery

An executing attempt may make at most two automatic recovery requests, after
2-second and 4-second backoffs, within its original ten-minute execution limit.
Transient forwarding/server/network faults and premature SSE EOF are eligible.
With retained answer text, recovery sends the original context and that exact
assistant prefix followed by a continuation instruction. Without text, it resends
the original request. Every request remains native SSE; there is no non-streaming
fallback or provider-side resume guarantee. A continuation is a new provider
request and can incur provider cost even though the user pays only one turn.

The same attempt, visible assistant message, lease, cancellation fence and single
credit hold remain active throughout recovery. Each parsed segment, sources and
reported/unknown usage survive in checkpoints. SSE sequence identities reset per
provider response; application event sequences remain monotonic. Stop/shutdown,
refusals, permanent errors and unknown execution after a worker crash do not
trigger automatic recovery. Exhausted recovery retains partial content and
releases the hold. A completed continuation that adds no content is not charged.

Sol requests send the tested `prompt_cache_options={mode:implicit,ttl:30m}` and a
stable hashed per-user/model `prompt_cache_key`. `store:false` remains unchanged;
response retention and prompt KV caching are different features. Cache routing
and minimum reusable prefix still belong to the provider. Assistant usage shows
actual cache-read/write fields, with missing fields labeled unknown, not zero.
New turns keep the minute-changing Beijing time in a frozen runtime note at the
end of the current input, not before reusable history in the instruction prefix.
Older stored turns retain their original frozen execution configuration.

Queued `ChatAttempt` rows are the PostgreSQL outbox. The generation worker also
hosts chat dispatch; `pnpm worker:chat` starts a standalone local dispatcher.
Workers only claim supported `protocolVersion` values (currently 2). Conditional
claiming and guarded writes fence stale execution tokens. Lost running leases
become interrupted, not an automatic second upstream request. A queue deadline,
when configured, is separate from the execution lease.

The browser persists pending submission identity and resumes by the same request
key/known turn. Disconnecting a subscriber is not cancellation. Cancellation
targets an expected attempt; retry creates a new attempt, not another user input.
The terminal attempt ID can remain on `ChatTurn.activeAttemptId`. It is NOT an
outstanding-work counter.

Snapshots/events and terminal message/usage/ledger changes commit transactionally.
Parsed partial output is retained on abnormal termination. Recovery and terminal
completion serialize against attempt/turn state. Neither PostgreSQL transactions
nor execution tokens prove exactly-once execution at a third-party provider:
after a process crash, remote execution can remain unknown.

`ChatRequestReceipt` is independent of content foreign keys. Clearing idle history
tombstones receipts and deletes content, turns/events and context snapshots, but
retains receipts, credit entries and successful UsageLog records. Replaying a
cleared request returns `CONTENT_CLEARED`, not a new execution. Clearing active
work is rejected. A cleared receipt is not permission to discard an open hold.

## Chat Hold Ledger

`CreditEntry` records six-decimal Decimal deltas. Keys and deltas are:

| Kind           | Operation Key         | Available | Held | Consumed |
| -------------- | --------------------- | --------: | ---: | -------: |
| `chat.reserve` | `reserve:<attemptId>` |      `-a` | `+a` |      `0` |
| `chat.settle`  | `close:<attemptId>`   |       `0` | `-a` |     `+a` |
| `chat.release` | `close:<attemptId>`   |      `+a` | `-a` |      `0` |

Settle/release share the unique close key. A settle additionally owns the unique
`turnSettlementKey=settle:<turnId>`, including zero-price successes. Successful
usage is `UsageLog.id=chat_settle_<turnId>`, action `conversation.chat`, delta
`-a`. A reserve is not a completed charge or an additional negative UsageLog.
Failed/cancelled/interrupted/incomplete attempts release, retaining partial data.

This is a **chat-only hold ledger**, not a full-account authoritative ledger.
`admin.adjust` uses the shared entry table but is excluded from this audit.
Opening equity, image/PPT charges, redemptions and other balance inputs have not
been unified here. Do not compare `User.credits` with chat consumption alone or
claim a full-account balance reconciliation. Upstream token usage being unknown
is also different from zero usage; this audit checks billing UsageLog consistency,
not token-estimator correctness.

## Read-Only Reconciliation

`scripts/chat-runtime-status.ts` never changes admission, tasks, receipts, balances
or schema. Without `--read-only` it refuses BEFORE connecting, even locally. It
does not load `.env` automatically. Set `CHAT_STATUS_DATABASE_URL` (preferred) or
`DATABASE_URL` deliberately; use a database read-only role for operational runs.
The script additionally enforces PostgreSQL startup read-only options and a
read-only RepeatableRead transaction. No provider or Redis connection is opened.

```sh
node --import tsx scripts/chat-runtime-status.ts --read-only
node --import tsx scripts/chat-runtime-status.ts --read-only --verify-drained
node --import tsx scripts/chat-runtime-status.ts --read-only --wait-drained --timeout-ms 60000 --interval-ms 1000
```

The default command reports a consistent metadata snapshot and chat audit. It
checks reserve/close/settlement key shape and uniqueness, per-entry conservation,
per-attempt held amount and billing state, aggregate held vs **reserved** attempts
per user, one consumption per turn, matching successful UsageLog, retained request
identity and orphan/cross-owner references. Closed ledger references to deleted
content are valid only with a matching user/turn tombstoned receipt. Open holds on
deleted content remain errors. Unlinked legacy chat UsageLog is counted separately,
not falsely attributed to managed turns.

Each queried metadata table is capped by `--max-rows` (default 50000). Exceeding a
cap is an error, never a partial clean result. Issue details are capped at 200;
total issue counts remain exact. No prompt/message body or credential is printed.

`--verify-drained` requires closed admission, no audit anomalies, and all four
counts zero: queued attempts, running attempts, `billingState=reserved` attempts,
and turns with non-null `activeConversationId`. `--wait-drained` requires two
consecutive ready snapshots and has an overall bounded wait (default 60 seconds,
maximum 30 minutes; at most one second teardown grace). A timed-out/incomplete
snapshot can never authorize shutdown. A refusal can include the last complete
snapshot with `timedOut=true`; its timestamp is not a new sample. Unexpected query
errors still fail, rather than being converted into a healthy drain result.

Exit 0 means clean status or a verified drain, depending on mode. Exit 2 means
audit anomalies, not drained, or verifier timeout. Exit 1 means invalid input,
missing migration, exceeded scan cap, or unexpected database/query failure.
Require `shutdown.verified=true` and exit 0 for a drain decision; a clean status
alone is not a shutdown authorization.

## Worker Health And Shutdown

`GET /api/health/chat` reports whether a fresh accepting worker supports the
current protocol; it does not expose private instance details. Admin runtime
status lists instance/build/protocol information and outstanding counts.
Heartbeats use per-instance `chat:worker:heartbeat:<instanceId>` keys with a
20-second TTL. Redis health operations are bounded. A stopping worker removes
only its own key, aborts local work before waiting, and uses a bounded shutdown.

The admin endpoint's `drained` field is a count summary, not the ledger verifier.
The read-only CLI deliberately does not check Redis or certify container health.
Check compatible worker health separately before enabling admission. The local
operational evidence below does not establish a live multi-container SIGTERM or
Redis-outage deployment rehearsal.

## Migration Rehearsal

```sh
pnpm db:generate
node scripts/test-chat-turns.mjs --migration-only
pnpm test:chat:db
pnpm exec vitest run --config vitest.chat.config.ts lib/chat-ledger-audit.test.ts
```

The runner accepts only a loopback PostgreSQL server. It uses `/postgres` solely
to create/drop a random `chugao_chat_it_*` database; it never connects to or
migrates the configured application database. `CHAT_TEST_DATABASE_URL` can select
the local test server, otherwise it reads the local DATABASE_URL configuration.

In scratch it applies historical migrations before chat, inserts synthetic old
messages/balances/usage, applies r2 `20261018040000_chat_turns`, inserts synthetic
queued/running/charged/released/retried r2 data, then deploys **all** remaining
migrations. Current additions are `50000_chat_runtime_hardening`,
`51000_chat_snapshot_index`, and `52000_chat_delivery_timings`. It checks final
schema drift, data preservation, receipt/ledger backfills, uniqueness/conservation
constraints, read-only audit and drain behavior. Remaining synthetic holds are
explicitly released in scratch before the tombstoned-content deletion check.
This fixture setup is not a test of the application's cancellation API.

Unless `--migration-only` is given, it then removes the synthetic fixtures and
runs the real-PostgreSQL chat integration suite with mocked providers. Scratch DB
and temporary migration copies are removed in `finally`. No existing application
users are seeded, cleared, backed up or charged; no paid provider request is sent.

## Deployment And Rollback Boundary

These are operator steps, not operations performed by this slice:

1. Close runtime admission with the authenticated admin PATCH. Retire the legacy
   POST before allowing mixed cached/new clients. Previously accepted legacy HTTP
   executions/save flows must be drained separately: they are not ChatAttempt rows.
2. Keep a compatible worker, model credentials and recovery path available. Let
   accepted work finish or explicitly cancel the expected attempt through the
   authenticated API. Do not use a model enabled flag to drain work.
3. Run the read-only `--wait-drained` verifier against the intended database.
   Exit 1 or 2 is not permission to remove the last compatible worker. Diagnose
   remaining work/ledger errors; the verifier never repairs or cancels anything.
4. Only after a verified drain may the final compatible chat worker be removed.
   Generation/PPT/other queues need their own checks, especially in a shared worker.
   Retain the new schema, receipts, ledger and terminal records during app rollback.
   Do not roll back to code that reopens independent legacy execution/billing.

No deployment, production connection, backup/restore, user-data replacement or
production mutation was performed for this operational acceptance work.

## Context And Browser Acceptance

The next local UI revision gives Sol a 96,000-token application sending budget,
with usage-triggered automatic compaction at 75% (72,000 tokens), rather than the
legacy twenty-turn trigger. Other chat profiles retain their 24,000-token budget.
These are application budgets, not verified upstream model limits. The status
request includes the selected model so the displayed budget matches execution.
Supported interactive chat models allow native web search automatically; the
retired per-draft switch no longer disables it. Search remains model-selected,
not mandatory on every turn. This UI/context revision is local, not yet deployed.

PostgreSQL `ContextSnapshot` and per-attempt request/context metadata are present
in the implementation. A table existing or a mocked summary succeeding does not
validate real long-context/vision behavior. Nullable delivery timing fields are
not measurements when no corresponding observation exists.

Keep real-provider short-text/search/reconnect, durable summary reuse, image
ordering/multi-turn vision, long-context limits, stable streaming DOM/selection,
partial HTML behavior, preview network isolation and performance measurements as
separate acceptance items. Do not infer these results from migrations, ledger
tests, a build, or older UI tests. Their evidence belongs in the acceptance record.
