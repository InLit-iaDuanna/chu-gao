import assert from "node:assert/strict";
import { Prisma, PrismaClient } from "@prisma/client";
import { randomBytes } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseEnv } from "node:util";
import { spawn } from "node:child_process";

const hardening = "20261018050000_chat_runtime_hardening";
const r2 = "20261018040000_chat_turns";
const args = new Set(process.argv.slice(2));
if (args.has("--help")) {
  console.log(
    "Usage: node scripts/test-chat-turns.mjs [--migration-only]\nCreates a local scratch database, rehearses historical migrations with synthetic old data, applies ALL pending migrations, verifies reconciliation/constraints/drain, then runs mocked chat integration tests. Never migrates the application database.",
  );
  process.exit(0);
}
if ([...args].some((arg) => arg !== "--migration-only"))
  throw new Error("Only --migration-only and --help are supported.");
if (!existsSync(path.join("prisma/migrations", hardening, "migration.sql")))
  throw new Error(
    `Required migration is missing: ${hardening}. No database connection made.`,
  );
const config = {
  ...(existsSync(".env") ? parseEnv(readFileSync(".env", "utf8")) : {}),
  ...process.env,
};
const base = new URL(config.CHAT_TEST_DATABASE_URL ?? config.DATABASE_URL);
if (
  !["postgres:", "postgresql:"].includes(base.protocol) ||
  !["localhost", "127.0.0.1", "[::1]", "::1"].includes(base.hostname)
)
  throw new Error(
    "Migration/integration tests only permit a local PostgreSQL server. No connection made.",
  );
const databaseName = `chugao_chat_it_${randomBytes(6).toString("hex")}`;
// Use the maintenance database for CREATE/DROP, never connect to the local app DB.
const maintenance = new URL(base);
maintenance.pathname = "/postgres";
maintenance.searchParams.set("schema", "public");
maintenance.searchParams.set("connect_timeout", "5");
const admin = new PrismaClient({
  datasources: { db: { url: maintenance.href } },
  log: [],
});
const scratch = new URL(base);
scratch.pathname = `/${databaseName}`;
scratch.searchParams.set("schema", "public");
scratch.searchParams.set("connect_timeout", "5");
const db = new PrismaClient({
  datasources: { db: { url: scratch.href } },
  log: [],
});
const env = {
  ...config,
  DATABASE_URL: scratch.href,
  CHAT_STATUS_DATABASE_URL: scratch.href,
  CHAT_INTEGRATION_TEST: "1",
  PRISMA_LOG_LEVEL: "silent",
};
const migrationNames = readdirSync("prisma/migrations", { withFileTypes: true })
  .filter(
    (entry) =>
      entry.isDirectory() &&
      existsSync(path.join("prisma/migrations", entry.name, "migration.sql")),
  )
  .map((entry) => entry.name)
  .sort();
assert(
  migrationNames.includes(r2),
  "The r2 migration is required for an actual old-schema rehearsal.",
);
const temporary = mkdtempSync(path.join(tmpdir(), "chat-runtime-migration-"));
const schemaPath = path.join(temporary, "schema.prisma");
cpSync("prisma/schema.prisma", schemaPath);
mkdirSync(path.join(temporary, "migrations"));
cpSync(
  "prisma/migrations/migration_lock.toml",
  path.join(temporary, "migrations/migration_lock.toml"),
);
let child;
let interrupted = false;
const run = (
  commandArgs,
  { capture = false, expectedCode = 0, bin = "pnpm" } = {},
) =>
  new Promise((resolve, reject) => {
    if (interrupted) return reject(new Error("Interrupted"));
    let output = "";
    child = spawn(bin, commandArgs, {
      env,
      stdio: capture ? ["ignore", "pipe", "inherit"] : "inherit",
    });
    const current = child;
    current.stdout?.on("data", (data) => {
      output += data.toString();
    });
    let killTimer;
    const timer = setTimeout(() => {
      current.kill("SIGTERM");
      killTimer = setTimeout(() => current.kill("SIGKILL"), 2000);
    }, 180000);
    child.once("error", reject);
    child.once("close", (code) => {
      clearTimeout(timer);
      clearTimeout(killTimer);
      child = undefined;
      if (interrupted) reject(new Error("Interrupted"));
      else if (code === expectedCode) resolve(output);
      else {
        if (capture && output) console.error(output);
        reject(
          new Error(
            `Command ${commandArgs.join(" ")} failed (${code}; expected ${expectedCode}).`,
          ),
        );
      }
    });
  });
let signalKillTimer;
const stop = () => {
  interrupted = true;
  child?.kill("SIGTERM");
  signalKillTimer = setTimeout(() => child?.kill("SIGKILL"), 2000);
  signalKillTimer.unref();
};
process.once("SIGINT", stop);
process.once("SIGTERM", stop);
const copyMigrations = (names) => {
  for (const name of names)
    cpSync(
      path.join("prisma/migrations", name),
      path.join(temporary, "migrations", name),
      { recursive: true },
    );
};
const deploy = () =>
  run(["exec", "prisma", "migrate", "deploy", "--schema", schemaPath]);
const status = async (flags = [], expectedCode = 0) =>
  JSON.parse(
    await run(
      [
        "--import",
        "tsx",
        "scripts/chat-runtime-status.ts",
        "--read-only",
        ...flags,
      ],
      { capture: true, expectedCode, bin: process.execPath },
    ),
  );
const legacyUser = "migration-legacy-user";
const runtimeUser = "migration-r2-user";

async function seedPreChat() {
  const columns =
    await db.$queryRaw`SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'ConversationMessage'`;
  assert(
    !columns.some((row) => row.column_name === "chatTurnId"),
    "Must seed messages before chat columns exist.",
  );
  await db.$executeRaw`INSERT INTO "User" (id, email, "passwordHash", credits, "updatedAt")
    VALUES (${legacyUser}, 'migration-legacy@example.invalid', 'fixture-not-a-login', 17.125, CURRENT_TIMESTAMP)`;
  await db.$executeRaw`INSERT INTO "Conversation" (id, "userId", title, "updatedAt")
    VALUES ('migration-legacy-conversation', ${legacyUser}, 'Synthetic pre-chat history', CURRENT_TIMESTAMP)`;
  await db.$executeRaw`INSERT INTO "ConversationMessage" (id, "conversationId", role, content)
    VALUES ('migration-legacy-user-message', 'migration-legacy-conversation', 'USER', 'Synthetic old prompt'),
      ('migration-legacy-answer', 'migration-legacy-conversation', 'ASSISTANT', 'Old answer\n<>& and code fences: \x60\x60\x60')`;
  await db.$executeRaw`INSERT INTO "UsageLog" (id, "userId", action, "creditsDelta")
    VALUES ('migration-legacy-usage', ${legacyUser}, 'conversation.chat', -0.5)`;
}

async function seedR2() {
  const tables =
    await db.$queryRaw`SELECT to_regclass('public."CreditEntry"')::text AS name`;
  assert.equal(
    tables[0].name,
    null,
    "Must seed r2 before hardening tables exist.",
  );
  await db.$executeRaw`INSERT INTO "User" (id, email, "passwordHash", credits, "updatedAt")
    VALUES (${runtimeUser}, 'migration-r2@example.invalid', 'fixture-not-a-login', 10.25, CURRENT_TIMESTAMP)`;
  for (const [tag, state, billing, held] of [
    ["queued", "queued", "reserved", 0.2],
    ["running", "running", "reserved", 0.3],
    ["completed", "completed", "charged", 0.2],
    ["failed", "failed", "released", 0.2],
    ["retry", "queued", "reserved", 0.1],
  ]) {
    const turnId = `migration-turn-${tag}`;
    const conversationId = `migration-conversation-${tag}`;
    const attemptId = `migration-attempt-${tag}`;
    const active = ["queued", "running"].includes(state)
      ? conversationId
      : null;
    await db.$executeRaw`INSERT INTO "Conversation" (id, "userId", title, "updatedAt")
      VALUES (${conversationId}, ${runtimeUser}, ${`Synthetic r2 ${tag}`}, CURRENT_TIMESTAMP)`;
    await db.$executeRaw`INSERT INTO "ChatTurn" (id, "userId", "conversationId", "clientRequestId", "inputHash", input, "configSnapshot", "modelId", "priceCredits", "chargedCredits", status, "activeConversationId", "activeAttemptId", "updatedAt")
      VALUES (${turnId}, ${runtimeUser}, ${conversationId}, ${`migration-request-${tag}`}, ${`hash-${tag}`}, '{}'::jsonb, '{}'::jsonb, 'fixture-only', ${held}, ${billing === "charged" ? held : 0}, ${state}, ${active}, ${attemptId}, CURRENT_TIMESTAMP)`;
    await db.$executeRaw`INSERT INTO "ChatAttempt" (id, "turnId", ordinal, status, "heldCredits", "billingState", "rawText", "retryRequestId", "heartbeatAt", "finishedAt")
      VALUES (${attemptId}, ${turnId}, ${tag === "retry" ? 2 : 1}, ${state}, ${held}, ${billing}, ${state === "completed" ? "Synthetic old completed answer" : "Synthetic saved partial"}, ${tag === "retry" ? `${runtimeUser}:retry-fixture` : null}, CURRENT_TIMESTAMP, ${["charged", "released"].includes(billing) ? new Date("2026-10-17T00:00:00Z") : null})`;
    await db.$executeRaw`INSERT INTO "ConversationMessage" (id, "conversationId", role, content, "chatTurnId", "chatAttemptId", "chatStatus")
      VALUES (${`migration-message-${tag}`}, ${conversationId}, 'ASSISTANT', ${`Synthetic saved ${tag}`}, ${turnId}, ${attemptId}, ${state})`;
    await db.$executeRaw`INSERT INTO "ChatEvent" (id, "turnId", "attemptId", seq, type, payload)
      VALUES (${`migration-event-${tag}`}, ${turnId}, ${attemptId}, 1, 'fixture.saved', '{}'::jsonb)`;
    if (billing === "charged")
      await db.$executeRaw`INSERT INTO "UsageLog" (id, "userId", action, "creditsDelta", metadata)
      VALUES (${`chat_settle_${turnId}`}, ${runtimeUser}, 'conversation.chat', ${-held}, ${JSON.stringify({ turnId, attemptId })}::jsonb)`;
  }
  await db.$executeRaw`INSERT INTO "ChatAttempt" (id, "turnId", ordinal, status, "heldCredits", "billingState", "rawText", "finishedAt")
    VALUES ('migration-attempt-before-retry', 'migration-turn-retry', 1, 'interrupted', 0.2, 'released', 'Saved pre-retry partial', CURRENT_TIMESTAMP)`;
}

async function expectUnique(query, label) {
  await assert.rejects(
    () => db.$executeRaw(query),
    (error) => error?.meta?.code === "23505",
    label,
  );
}

async function verifyMigration(before) {
  const after =
    await db.$queryRaw`SELECT id, credits FROM "User" WHERE id IN (${legacyUser}, ${runtimeUser}) ORDER BY id`;
  assert.deepEqual(
    after,
    before,
    "Migrations must not alter existing available credits.",
  );
  const [message] =
    await db.$queryRaw`SELECT content, "chatTurnId", "chatAttemptId" FROM "ConversationMessage" WHERE id = 'migration-legacy-answer'`;
  assert.deepEqual(message, {
    content: "Old answer\n<>& and code fences: ```",
    chatTurnId: null,
    chatAttemptId: null,
  });
  const [oldUsage] =
    await db.$queryRaw`SELECT "creditsDelta" FROM "UsageLog" WHERE id = 'migration-legacy-usage'`;
  assert.equal(oldUsage.creditsDelta, -0.5);
  const receipts =
    await db.$queryRaw`SELECT scope, "clientRequestId" FROM "ChatRequestReceipt" ORDER BY scope, "clientRequestId"`;
  assert.equal(receipts.filter((row) => row.scope === "create").length, 5);
  assert.deepEqual(
    receipts.filter((row) => row.scope === "retry"),
    [{ scope: "retry", clientRequestId: "retry-fixture" }],
  );
  const balances =
    await db.$queryRaw`SELECT kind, count(*)::int AS count FROM "CreditEntry" GROUP BY kind ORDER BY kind`;
  assert.deepEqual(balances, [
    { kind: "chat.release", count: 2 },
    { kind: "chat.reserve", count: 6 },
    { kind: "chat.settle", count: 1 },
  ]);
  const applied =
    await db.$queryRaw`SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name`;
  assert.deepEqual(
    applied.map((row) => row.migration_name),
    migrationNames,
    "Every final migration, including post-hardening additions, must be applied.",
  );
  await expectUnique(
    Prisma.sql`INSERT INTO "CreditEntry" (id, "operationKey", kind, "userId", "turnId", "attemptId", "availableDelta", "heldDelta", "consumedDelta")
    SELECT 'duplicate-reserve', "operationKey", kind, "userId", "turnId", "attemptId", "availableDelta", "heldDelta", "consumedDelta" FROM "CreditEntry" WHERE "operationKey" = 'reserve:migration-attempt-queued'`,
    "Reserve operation keys must be unique.",
  );
  await expectUnique(
    Prisma.sql`INSERT INTO "CreditEntry" (id, "operationKey", kind, "userId", "turnId", "attemptId", "availableDelta", "heldDelta", "consumedDelta")
    SELECT 'duplicate-close', "operationKey", 'chat.release', "userId", "turnId", "attemptId", 0.2, -0.2, 0 FROM "CreditEntry" WHERE "operationKey" = 'close:migration-attempt-completed'`,
    "Settle and release must share one close key.",
  );
  await expectUnique(
    Prisma.sql`INSERT INTO "CreditEntry" (id, "operationKey", kind, "userId", "turnId", "attemptId", "turnSettlementKey", "availableDelta", "heldDelta", "consumedDelta")
    SELECT 'duplicate-settlement', 'close:second-attempt', kind, "userId", "turnId", 'second-attempt', "turnSettlementKey", "availableDelta", "heldDelta", "consumedDelta" FROM "CreditEntry" WHERE kind = 'chat.settle'`,
    "A turn settlement key must be unique across attempts.",
  );
  await expectUnique(
    Prisma.sql`INSERT INTO "ChatRequestReceipt" (id, "userId", scope, "clientRequestId", "inputHash", "conversationId", "turnId")
    SELECT 'duplicate-receipt', "userId", scope, "clientRequestId", "inputHash", "conversationId", "turnId" FROM "ChatRequestReceipt" WHERE "clientRequestId" = 'migration-request-queued'`,
    "Request receipt keys must be unique.",
  );
  await assert.rejects(
    () => db.$executeRaw`INSERT INTO "CreditEntry" (id, "operationKey", kind, "userId", "availableDelta", "heldDelta", "consumedDelta")
    VALUES ('bad-conservation', 'bad-conservation', 'chat.reserve', ${runtimeUser}, -0.2, 0.1, 0)`,
    (error) => error?.meta?.code === "23514",
    "Chat conservation must be enforced by PostgreSQL.",
  );
  const report = await status();
  assert.equal(report.readOnly, true);
  assert.equal(report.audit.clean, true, JSON.stringify(report.audit.issues));
  assert.deepEqual(report.audit.counts, {
    queued: 2,
    running: 1,
    reserved: 3,
    active: 3,
  });
  assert.deepEqual(report.audit.totals, {
    ledgerHeld: "0.600000",
    attemptReserved: "0.600000",
    consumed: "0.200000",
  });
  assert.equal(report.audit.legacyChatUsageIgnored, 1);
  await db.$executeRaw`INSERT INTO "SystemConfig" (key, value, "updatedAt") VALUES ('chat.runtime', '{"enabled":false}'::jsonb, CURRENT_TIMESTAMP)
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`;
  const blocked = await status(["--verify-drained"], 2);
  assert.equal(blocked.shutdown.verified, false);
  const timedOut = await status(
    ["--wait-drained", "--timeout-ms", "1000", "--interval-ms", "100"],
    2,
  );
  assert.equal(timedOut.shutdown.verified, false);
  const tooSmall = await run(
    [
      "--import",
      "tsx",
      "scripts/chat-runtime-status.ts",
      "--read-only",
      "--max-rows",
      "1",
    ],
    { capture: true, expectedCode: 1, bin: process.execPath },
  );
  assert.equal(
    tooSmall,
    "",
    "An incomplete scan must not emit a successful audit.",
  );
  console.log(
    "Migration evidence: pre-chat messages/balances/usage preserved; r2 create/retry receipts and six reserves/three closes backfilled; unique/conservation constraints enforced; readonly reconciliation clean; active drain refused and bounded wait timed out.",
  );
}

async function verifyClearedDrain() {
  // Bring synthetic active fixtures to a terminal release before clearing them.
  // Real content-clear APIs reject active work; a tombstone cannot excuse a hold.
  await db.$transaction(async (tx) => {
    await tx.$executeRaw`INSERT INTO "CreditEntry" (id, "operationKey", kind, "userId", "turnId", "attemptId", "availableDelta", "heldDelta", "consumedDelta")
      SELECT 'close_' || a.id, 'close:' || a.id, 'chat.release', t."userId", t.id, a.id,
        round(a."heldCredits"::numeric, 6), -round(a."heldCredits"::numeric, 6), 0
      FROM "ChatAttempt" a JOIN "ChatTurn" t ON t.id = a."turnId"
      WHERE t."userId" = ${runtimeUser} AND a."billingState" = 'reserved'`;
    await tx.$executeRaw`UPDATE "User" SET credits = credits + (
      SELECT sum(a."heldCredits") FROM "ChatAttempt" a JOIN "ChatTurn" t ON t.id = a."turnId"
      WHERE t."userId" = ${runtimeUser} AND a."billingState" = 'reserved') WHERE id = ${runtimeUser}`;
    await tx.$executeRaw`UPDATE "ChatAttempt" SET status = 'interrupted', "billingState" = 'released', "finishedAt" = CURRENT_TIMESTAMP
      WHERE "turnId" IN (SELECT id FROM "ChatTurn" WHERE "userId" = ${runtimeUser}) AND "billingState" = 'reserved'`;
    await tx.$executeRaw`UPDATE "ChatTurn" SET status = 'interrupted', "activeConversationId" = NULL
      WHERE "userId" = ${runtimeUser} AND "activeConversationId" IS NOT NULL`;
  });
  await db.$executeRaw`UPDATE "ChatRequestReceipt" SET "contentClearedAt" = CURRENT_TIMESTAMP WHERE "userId" = ${runtimeUser}`;
  await db.$executeRaw`DELETE FROM "Conversation" WHERE "userId" = ${runtimeUser}`;
  const drained = await status([
    "--wait-drained",
    "--timeout-ms",
    "5000",
    "--interval-ms",
    "50",
  ]);
  assert.equal(drained.audit.clean, true, JSON.stringify(drained.audit.issues));
  assert.equal(drained.shutdown.verified, true);
  assert.equal(
    drained.scannedRows.entries,
    12,
    "Content deletion must retain the ledger.",
  );
  assert.equal(
    drained.scannedRows.receipts,
    6,
    "Content deletion must retain tombstones.",
  );
  await db.$executeRaw`UPDATE "SystemConfig" SET value = '{"enabled":true}'::jsonb WHERE key = 'chat.runtime'`;
  const openGate = await status(["--verify-drained"], 2);
  assert.equal(
    openGate.shutdown.verified,
    false,
    "Empty queues alone do not prove admission is closed.",
  );
  assert(openGate.shutdown.reasons.includes("admission_not_closed"));
  console.log(
    "Drain evidence: closed admission + two clean zero-work snapshots accepted; tombstoned receipts/ledger survive content deletion; reopened admission refused even with empty queues.",
  );
  await db.$executeRaw`DELETE FROM "CreditEntry" WHERE "userId" = ${runtimeUser}`;
  await db.$executeRaw`DELETE FROM "ChatRequestReceipt" WHERE "userId" = ${runtimeUser}`;
  await db.$executeRaw`DELETE FROM "UsageLog" WHERE "userId" IN (${legacyUser}, ${runtimeUser})`;
  await db.$executeRaw`DELETE FROM "User" WHERE id IN (${legacyUser}, ${runtimeUser})`;
  await db.$executeRaw`DELETE FROM "SystemConfig" WHERE key = 'chat.runtime'`;
}

let created = false;
try {
  await admin.$executeRawUnsafe(`CREATE DATABASE "${databaseName}"`);
  created = true;
  console.log(
    `Testing in isolated database ${databaseName}; application DB/users are not used.`,
  );
  copyMigrations(migrationNames.filter((name) => name < r2));
  await deploy();
  await seedPreChat();
  copyMigrations([r2]);
  await deploy();
  await seedR2();
  const before =
    await db.$queryRaw`SELECT id, credits FROM "User" WHERE id IN (${legacyUser}, ${runtimeUser}) ORDER BY id`;
  copyMigrations(migrationNames.filter((name) => name > r2));
  await deploy();
  if (interrupted) throw new Error("Interrupted");
  await run([
    "exec",
    "prisma",
    "migrate",
    "diff",
    "--from-schema-datasource",
    schemaPath,
    "--to-schema-datamodel",
    schemaPath,
    "--exit-code",
  ]);
  await verifyMigration(before);
  await verifyClearedDrain();
  if (!args.has("--migration-only"))
    await run([
      "exec",
      "vitest",
      "run",
      "--config",
      "vitest.chat.config.ts",
      "lib/chat-turns.integration.test.ts",
    ]);
} catch (error) {
  console.error(
    error instanceof Error ? error.message : "Integration tests failed",
  );
  process.exitCode = interrupted ? 130 : 1;
} finally {
  try {
    await db.$disconnect();
    if (created) {
      assert(/^chugao_chat_it_[0-9a-f]{12}$/.test(databaseName));
      await admin.$executeRawUnsafe(
        `DROP DATABASE "${databaseName}" WITH (FORCE)`,
      );
      console.log("Removed isolated migration/integration database.");
    }
  } finally {
    await admin.$disconnect();
    rmSync(temporary, { recursive: true, force: true });
    clearTimeout(signalKillTimer);
    process.removeListener("SIGINT", stop);
    process.removeListener("SIGTERM", stop);
  }
}
