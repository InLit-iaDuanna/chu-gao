import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { debitChatCredits, refundChatCredits } from "@/lib/chat-billing";

export const creditDecimal = (value: number) =>
  new Prisma.Decimal(value.toFixed(6));

export function operationHash(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export async function recordChatReserve(
  tx: Prisma.TransactionClient,
  input: { userId: string; turnId: string; attemptId: string; amount: number },
) {
  const amount = creditDecimal(input.amount);
  const balance = await tx.user.findUniqueOrThrow({
    where: { id: input.userId },
    select: { credits: true },
  });
  return tx.creditEntry.create({
    data: {
      operationKey: `reserve:${input.attemptId}`,
      kind: "chat.reserve",
      userId: input.userId,
      turnId: input.turnId,
      attemptId: input.attemptId,
      availableDelta: amount.negated(),
      heldDelta: amount,
      consumedDelta: 0,
      balanceAfter: creditDecimal(balance.credits),
    },
  });
}

export async function closeChatReserve(
  tx: Prisma.TransactionClient,
  input: {
    userId: string;
    turnId: string;
    attemptId: string;
    amount: number;
    success: boolean;
  },
) {
  const amount = creditDecimal(input.amount);
  // Turn and attempt locks are held by the caller. The same close key protects
  // both terminal choices, including callers introduced in future releases.
  const closed = await tx.creditEntry.findUnique({
    where: { operationKey: `close:${input.attemptId}` },
  });
  if (closed) throw new Error("CHAT_HOLD_ALREADY_CLOSED");
  if (!input.success && input.amount)
    await refundChatCredits(tx, input.userId, input.amount);
  const account = await tx.user.findUniqueOrThrow({
    where: { id: input.userId },
    select: { credits: true },
  });
  await tx.creditEntry.create({
    data: {
      operationKey: `close:${input.attemptId}`,
      kind: input.success ? "chat.settle" : "chat.release",
      userId: input.userId,
      turnId: input.turnId,
      attemptId: input.attemptId,
      turnSettlementKey: input.success ? `settle:${input.turnId}` : null,
      availableDelta: input.success ? 0 : amount,
      heldDelta: amount.negated(),
      consumedDelta: input.success ? amount : 0,
      balanceAfter: creditDecimal(account.credits),
    },
  });
  return account;
}

export async function adjustCreditsIdempotently(
  tx: Prisma.TransactionClient,
  input: {
    userId: string;
    actorId: string;
    operationKey: string;
    amount: number;
    note?: string;
  },
) {
  const operationKey = `admin:${input.actorId}:${input.operationKey}`;
  const payloadHash = operationHash({
    userId: input.userId,
    amount: input.amount,
    note: input.note ?? "",
  });
  // Lock before replay lookup so concurrent identical operations see the commit.
  await tx.$queryRaw(
    Prisma.sql`SELECT "id" FROM "User" WHERE "id" = ${input.userId} FOR UPDATE`,
  );
  const existing = await tx.creditEntry.findUnique({ where: { operationKey } });
  if (existing) {
    if (existing.payloadHash !== payloadHash)
      throw new Error("IDEMPOTENCY_CONFLICT");
    return {
      user: existing.result as { id: string; email: string; credits: number },
      replayed: true,
    };
  }
  const user = await tx.user.findUnique({
    where: { id: input.userId },
    select: { id: true, email: true, credits: true },
  });
  if (!user) throw new Error("NOT_FOUND");
  if (input.amount < 0) {
    if (!(await debitChatCredits(tx, input.userId, -input.amount)).count)
      throw new Error("NEGATIVE_BALANCE");
  } else {
    await refundChatCredits(tx, input.userId, input.amount);
  }
  const updated = await tx.user.findUniqueOrThrow({
    where: { id: input.userId },
    select: { id: true, email: true, credits: true },
  });
  await tx.creditEntry.create({
    data: {
      operationKey,
      payloadHash,
      kind: "admin.adjust",
      userId: input.userId,
      actorId: input.actorId,
      availableDelta: creditDecimal(input.amount),
      heldDelta: 0,
      consumedDelta: 0,
      balanceAfter: creditDecimal(updated.credits),
      result: updated,
    },
  });
  await tx.usageLog.create({
    data: {
      userId: input.userId,
      action:
        input.amount > 0 ? "admin_credit_recharge" : "admin_credit_adjust",
      creditsDelta: input.amount,
      metadata: {
        adminId: input.actorId,
        note: input.note ?? null,
        operationKey: input.operationKey,
      },
    },
  });
  return { user: updated, replayed: false };
}
