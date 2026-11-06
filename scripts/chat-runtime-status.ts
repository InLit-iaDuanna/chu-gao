import { Prisma, PrismaClient } from "@prisma/client";
import { setTimeout as sleep } from "node:timers/promises";
import { parseArgs } from "node:util";
import {
  auditChatLedger,
  type ChatLedgerAuditInput,
} from "../lib/chat-ledger-audit";

const migration = "20261018050000_chat_runtime_hardening";
const help = `Read-only chat reconciliation and drain/rollback verifier.

Usage:
  node --env-file-if-exists=.env --import tsx scripts/chat-runtime-status.ts --read-only
  ... --read-only --verify-drained
  ... --read-only --wait-drained --timeout-ms 60000 --interval-ms 1000

No database connection is made without --read-only. All connections and snapshots
enforce PostgreSQL read-only mode, including local databases. No .env is loaded by
this script. Set CHAT_STATUS_DATABASE_URL (preferred) or DATABASE_URL explicitly.
Use a database read-only role for operational runs.

--verify-drained  Check once: admission closed, zero queued/running/reserved/active,
                  and no chat audit anomalies. Never changes admission or tasks.
--wait-drained    Wait for two consecutive ready snapshots, within a hard bound.
--timeout-ms     Overall wait limit, 100..1800000 (default 60000).
--interval-ms    Poll interval, 50..60000 (default 1000).
--max-rows       Per-table metadata scan limit, 1..1000000 (default 50000).
                  Exceeding the limit fails closed, never reports partial success.

Exit: 0 clean status / verified drain; 2 anomalies or not drained; 1 input/query error.
Scope: chat holds only, not the full account ledger, remote provider termination,
legacy HTTP in-flight requests, generation queues, or worker health.
`;

class StatusError extends Error {}

function integer(
  value: string | undefined,
  name: string,
  fallback: number,
  min: number,
  max: number,
) {
  const parsed = value === undefined ? fallback : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max)
    throw new StatusError(
      `${name} must be an integer between ${min} and ${max}.`,
    );
  return parsed;
}

async function snapshot(
  client: PrismaClient,
  maxRows: number,
  remainingMs: number,
) {
  const queryTimeoutMs = Math.max(1, Math.min(5000, remainingMs));
  return client.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
      await tx.$queryRaw`SELECT set_config('statement_timeout', ${String(queryTimeoutMs)}, true), set_config('lock_timeout', '1000', true)`;
      const [database] = await tx.$queryRaw<
        { checkedAt: string; readOnly: string }[]
      >`
      SELECT CURRENT_TIMESTAMP::text AS "checkedAt", current_setting('transaction_read_only') AS "readOnly"`;
      if (database.readOnly !== "on")
        throw new StatusError("PostgreSQL did not confirm read-only mode.");
      const applied = await tx.$queryRaw<{ migration_name: string }[]>`
      SELECT migration_name FROM "_prisma_migrations" WHERE migration_name = ${migration}
      AND finished_at IS NOT NULL AND rolled_back_at IS NULL`;
      if (applied.length !== 1)
        throw new StatusError(
          `Required migration is not applied: ${migration}.`,
        );
      const configRows = await tx.$queryRaw<{ value: unknown }[]>`
      SELECT value FROM "SystemConfig" WHERE key = 'chat.runtime'`;
      const config = configRows[0]?.value;
      const enabledValue =
        config && typeof config === "object" && !Array.isArray(config)
          ? (config as Record<string, unknown>).enabled
          : undefined;
      const configValid =
        configRows.length === 0 ||
        (!!config &&
          typeof config === "object" &&
          !Array.isArray(config) &&
          (enabledValue === undefined || typeof enabledValue === "boolean"));
      const admissionClosed = configValid && enabledValue === false;
      const bounded = <T>(table: string, rows: T[]) => {
        if (rows.length > maxRows)
          throw new StatusError(
            `${table} exceeds --max-rows=${maxRows}; audit incomplete, shutdown NOT verified.`,
          );
        return rows;
      };
      const input: ChatLedgerAuditInput = {
        users: bounded(
          "User references",
          await tx.$queryRaw<ChatLedgerAuditInput["users"]>`
        SELECT id FROM "User" WHERE id IN (
          SELECT "userId" FROM "ChatTurn" UNION SELECT "userId" FROM "ChatRequestReceipt"
          UNION SELECT "userId" FROM "CreditEntry" WHERE kind LIKE 'chat.%'
            OR "attemptId" IS NOT NULL OR "turnId" IS NOT NULL OR "turnSettlementKey" IS NOT NULL
            OR "operationKey" LIKE 'reserve:%' OR "operationKey" LIKE 'close:%'
        ) LIMIT ${maxRows + 1}`,
        ),
        conversations: bounded(
          "Conversation references",
          await tx.$queryRaw<ChatLedgerAuditInput["conversations"]>`
        SELECT id, "userId" FROM "Conversation" WHERE id IN (
          SELECT "conversationId" FROM "ChatTurn" UNION SELECT "conversationId" FROM "ChatRequestReceipt"
          UNION SELECT "conversationId" FROM "ConversationMessage" WHERE "chatTurnId" IS NOT NULL OR "chatAttemptId" IS NOT NULL
        ) LIMIT ${maxRows + 1}`,
        ),
        turns: bounded(
          "ChatTurn",
          await tx.$queryRaw<ChatLedgerAuditInput["turns"]>`
        SELECT id, "userId", "conversationId", "clientRequestId", "inputHash", status,
          "activeConversationId", "activeAttemptId", "chargedCredits" FROM "ChatTurn" LIMIT ${maxRows + 1}`,
        ),
        attempts: bounded(
          "ChatAttempt",
          await tx.$queryRaw<ChatLedgerAuditInput["attempts"]>`
        SELECT id, "turnId", status, "billingState", "heldCredits" FROM "ChatAttempt" LIMIT ${maxRows + 1}`,
        ),
        entries: bounded(
          "CreditEntry (chat)",
          await tx.$queryRaw<ChatLedgerAuditInput["entries"]>`
        SELECT id, "operationKey", kind, "userId", "turnId", "attemptId", "turnSettlementKey",
          "availableDelta", "heldDelta", "consumedDelta" FROM "CreditEntry"
        WHERE kind LIKE 'chat.%' OR "attemptId" IS NOT NULL OR "turnId" IS NOT NULL OR "turnSettlementKey" IS NOT NULL
          OR "operationKey" LIKE 'reserve:%' OR "operationKey" LIKE 'close:%' LIMIT ${maxRows + 1}`,
        ),
        receipts: bounded(
          "ChatRequestReceipt",
          await tx.$queryRaw<ChatLedgerAuditInput["receipts"]>`
        SELECT id, "userId", scope, "clientRequestId", "inputHash", "conversationId", "turnId", "attemptId", "contentClearedAt"
        FROM "ChatRequestReceipt" LIMIT ${maxRows + 1}`,
        ),
        usages: bounded(
          "UsageLog (chat)",
          await tx.$queryRaw<ChatLedgerAuditInput["usages"]>`
        SELECT id, "userId", action, "creditsDelta", metadata FROM "UsageLog"
        WHERE action = 'conversation.chat' OR left(id, 12) = 'chat_settle_' LIMIT ${maxRows + 1}`,
        ),
        messages: bounded(
          "ConversationMessage (chat references)",
          await tx.$queryRaw<NonNullable<ChatLedgerAuditInput["messages"]>>`
        SELECT id, "conversationId", "chatTurnId", "chatAttemptId" FROM "ConversationMessage"
        WHERE "chatTurnId" IS NOT NULL OR "chatAttemptId" IS NOT NULL LIMIT ${maxRows + 1}`,
        ),
        events: bounded(
          "ChatEvent",
          await tx.$queryRaw<NonNullable<ChatLedgerAuditInput["events"]>>`
        SELECT id, "turnId", "attemptId" FROM "ChatEvent" LIMIT ${maxRows + 1}`,
        ),
      };
      const audit = auditChatLedger(input);
      const reasons: string[] = [];
      if (!configValid) reasons.push("invalid_admission_config");
      if (!admissionClosed) reasons.push("admission_not_closed");
      for (const [name, count] of Object.entries(audit.counts))
        if (count > 0) reasons.push(`${name}_not_zero`);
      if (!audit.clean) reasons.push("chat_audit_anomalies");
      return {
        readOnly: true,
        checkedAt: database.checkedAt,
        migration,
        admission: { closed: admissionClosed, configValid },
        scannedRows: Object.fromEntries(
          Object.entries(input).map(([name, rows]) => [name, rows.length]),
        ),
        audit,
        shutdown: { ready: reasons.length === 0, reasons },
      };
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
      maxWait: Math.min(5000, remainingMs),
      timeout: Math.max(1, Math.min(30000, remainingMs)),
    },
  );
}

async function main() {
  const { values } = parseArgs({
    options: {
      help: { type: "boolean", short: "h" },
      "read-only": { type: "boolean" },
      "verify-drained": { type: "boolean" },
      "wait-drained": { type: "boolean" },
      "timeout-ms": { type: "string" },
      "interval-ms": { type: "string" },
      "max-rows": { type: "string" },
    },
  });
  if (values.help) {
    console.log(help);
    return;
  }
  if (!values["read-only"])
    throw new StatusError(
      "No connection made. Pass --read-only explicitly to run the audit.",
    );
  if (values["verify-drained"] && values["wait-drained"])
    throw new StatusError(
      "Choose --verify-drained or --wait-drained, not both.",
    );
  const timeoutMs = integer(
    values["timeout-ms"],
    "--timeout-ms",
    60000,
    100,
    1800000,
  );
  const intervalMs = integer(
    values["interval-ms"],
    "--interval-ms",
    1000,
    50,
    60000,
  );
  const maxRows = integer(values["max-rows"], "--max-rows", 50000, 1, 1000000);
  const source =
    process.env.CHAT_STATUS_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!source)
    throw new StatusError(
      "Set CHAT_STATUS_DATABASE_URL or DATABASE_URL. No connection made.",
    );
  let url: URL;
  try {
    url = new URL(source);
  } catch {
    throw new StatusError("Invalid database URL. No connection made.");
  }
  if (!["postgres:", "postgresql:"].includes(url.protocol))
    throw new StatusError(
      "Only direct PostgreSQL URLs are supported. No connection made.",
    );
  // Startup options also protect the connection before the explicit read-only
  // transaction begins. Supplied options cannot turn read-only off.
  url.searchParams.set(
    "options",
    "-c default_transaction_read_only=on -c statement_timeout=5000 -c lock_timeout=1000",
  );
  url.searchParams.set("connect_timeout", "5");
  url.searchParams.set("pool_timeout", "5");
  url.searchParams.set("connection_limit", "1");
  const client = new PrismaClient({
    datasources: { db: { url: url.href } },
    log: [],
  });
  const startedAt = Date.now();
  const waiting = values["wait-drained"] === true;
  const verifying = waiting || values["verify-drained"] === true;
  const deadline =
    startedAt + (waiting ? timeoutMs : Math.min(timeoutMs, 30000));
  let consecutiveReady = 0;
  let samples = 0;
  let last: Awaited<ReturnType<typeof snapshot>> | undefined;
  let finished = false;
  const finish = (timedOut = false, deadlineError?: string) => {
    const verified =
      verifying &&
      !timedOut &&
      last?.shutdown.ready === true &&
      (!waiting || consecutiveReady >= 2);
    const reasons = [...(last?.shutdown.reasons ?? [])];
    if (timedOut) reasons.push("verifier_timeout");
    console.log(
      JSON.stringify(
        {
          mode: waiting
            ? "wait-drained"
            : verifying
              ? "verify-drained"
              : "status",
          ...(last ?? { readOnly: true }),
          shutdown: {
            ready: !timedOut && last?.shutdown.ready === true,
            verified,
            reasons,
            consecutiveReady,
          },
          timedOut,
          ...(deadlineError ? { deadlineError } : {}),
          samples,
          elapsedMs: Date.now() - startedAt,
        },
        null,
        2,
      ),
    );
    process.exitCode = timedOut
      ? 2
      : verifying
        ? verified
          ? 0
          : 2
        : last?.audit.clean
          ? 0
          : 2;
    finished = true;
  };
  const hardStop = setTimeout(
    () => {
      if (!finished)
        finish(
          true,
          "Hard verifier deadline exceeded; an unfinished snapshot is NOT evidence of a drained database.",
        );
      process.exit(process.exitCode ?? 2);
    },
    deadline - startedAt + 1000,
  );
  hardStop.unref();
  try {
    for (;;) {
      const remainingMs = deadline - Date.now();
      // Do not start another transaction with a near-zero timeout. A previous
      // complete snapshot may justify a refusal, never a successful drain.
      if (remainingMs <= 0 || (waiting && last && remainingMs < 500)) {
        if (remainingMs > 0) await sleep(remainingMs);
        finish(true);
        return;
      }
      let result: Awaited<ReturnType<typeof snapshot>>;
      try {
        result = await snapshot(client, maxRows, remainingMs);
      } catch (error) {
        if (
          waiting &&
          Date.now() >= deadline &&
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === "P2028" &&
          /expired transaction|transaction timeout|timeout for this transaction|timed out/i.test(
            error.message,
          )
        ) {
          finish(
            true,
            "P2028: the bounded snapshot transaction expired at the verifier deadline; no new snapshot accepted.",
          );
          return;
        }
        throw error;
      }
      last = result;
      samples += 1;
      consecutiveReady = result.shutdown.ready ? consecutiveReady + 1 : 0;
      if (!waiting || consecutiveReady >= 2) {
        finish(Date.now() >= deadline);
        return;
      }
      await sleep(Math.min(intervalMs, Math.max(1, deadline - Date.now())));
    }
  } finally {
    await client.$disconnect();
    clearTimeout(hardStop);
  }
}

main().catch((error: unknown) => {
  const code =
    error && typeof error === "object" && "code" in error
      ? String(error.code)
      : "unknown";
  console.error(
    error instanceof StatusError
      ? error.message
      : `Chat audit failed (${code}). Check the applied migration, generated client and read-only database permissions. No writes attempted.`,
  );
  process.exitCode = 1;
});
