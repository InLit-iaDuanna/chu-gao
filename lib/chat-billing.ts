import { Prisma } from "@prisma/client";

export async function debitChatCredits(
  tx: Prisma.TransactionClient,
  userId: string,
  credits: number,
) {
  // Decimal arithmetic avoids losing the final 0.2-credit turn to float drift.
  const count = await tx.$executeRaw(Prisma.sql`
    UPDATE "User"
    SET "credits" = ROUND(("credits"::numeric - ${credits}::numeric), 6)::double precision,
        "updatedAt" = CURRENT_TIMESTAMP
    WHERE "id" = ${userId} AND ROUND("credits"::numeric, 6) >= ${credits}::numeric
  `);
  return { count };
}

export async function refundChatCredits(
  tx: Prisma.TransactionClient,
  userId: string,
  credits: number,
) {
  await tx.$executeRaw(Prisma.sql`
    UPDATE "User"
    SET "credits" = ROUND(("credits"::numeric + ${credits}::numeric), 6)::double precision,
        "updatedAt" = CURRENT_TIMESTAMP
    WHERE "id" = ${userId}
  `);
  return tx.user.findUniqueOrThrow({
    where: { id: userId },
    select: { credits: true },
  });
}
