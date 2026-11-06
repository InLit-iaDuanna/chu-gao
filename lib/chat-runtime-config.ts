import { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { LUNA_MODEL_ID, SOL_MODEL_ID } from "@/lib/chat-model-options";

export const CHAT_TASK_PROTOCOL_VERSION = 2;
export const CHAT_RUNTIME_PROTOCOL_VERSION = CHAT_TASK_PROTOCOL_VERSION;
export const CHAT_RUNTIME_PROTOCOL_VERSIONS = [CHAT_RUNTIME_PROTOCOL_VERSION];
export const CHAT_RUNTIME_CONFIG_KEY = "chat.runtime";

const configSchema = z
  .object({
    enabled: z.boolean(),
    profiles: z.array(z.enum(["default", LUNA_MODEL_ID, SOL_MODEL_ID])).max(3),
    userAllowlist: z.array(z.string().trim().min(1).max(128)).max(10_000),
    queueTimeoutMs: z.number().int().min(1_000).max(86_400_000).nullable(),
  })
  .strict();

export const chatRuntimeUpdateSchema = configSchema
  .partial()
  .refine((value) => Object.keys(value).length > 0);
export type ChatRuntimeSettings = z.infer<typeof configSchema>;
const defaults = (): ChatRuntimeSettings => ({
  enabled: true,
  profiles: ["default", LUNA_MODEL_ID, SOL_MODEL_ID],
  userAllowlist: [],
  queueTimeoutMs: null,
});
const parseSettings = (value: unknown) =>
  configSchema.parse({ ...defaults(), ...(value as object) });

export class ChatRuntimeAdmissionError extends Error {
  readonly status = 503;
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ChatRuntimeAdmissionError";
  }
}

export async function getChatRuntimeConfig(): Promise<ChatRuntimeSettings> {
  if (!process.env.DATABASE_URL) return defaults();
  const row = await db.systemConfig.findUnique({
    where: { key: CHAT_RUNTIME_CONFIG_KEY },
  });
  return parseSettings(row?.value ?? {});
}

async function ensureConfigRow(tx: Prisma.TransactionClient) {
  await tx.$executeRaw(Prisma.sql`
    INSERT INTO "SystemConfig" ("key", "value", "updatedAt")
    VALUES (${CHAT_RUNTIME_CONFIG_KEY}, ${JSON.stringify(defaults())}::jsonb, clock_timestamp())
    ON CONFLICT ("key") DO NOTHING
  `);
}

export async function setChatRuntimeConfig(
  update: z.infer<typeof chatRuntimeUpdateSchema>,
  actorId?: string,
) {
  const patch = chatRuntimeUpdateSchema.parse(update);
  return db.$transaction(async (tx) => {
    await ensureConfigRow(tx);
    await tx.$queryRaw(
      Prisma.sql`SELECT "key" FROM "SystemConfig" WHERE "key" = ${CHAT_RUNTIME_CONFIG_KEY} FOR UPDATE`,
    );
    const row = await tx.systemConfig.findUniqueOrThrow({
      where: { key: CHAT_RUNTIME_CONFIG_KEY },
    });
    const value = configSchema.parse({ ...parseSettings(row.value), ...patch });
    await tx.systemConfig.update({
      where: { key: CHAT_RUNTIME_CONFIG_KEY },
      data: { value, ...(actorId ? { updatedBy: actorId } : {}) },
    });
    return value;
  });
}

// Admission is deliberately independent of credentials/model enabled. Recovery,
// subscription and execution of already accepted work must not call this gate.
export async function getChatRuntimeAdmission(
  userId: string,
  modelId: string,
  tx?: Prisma.TransactionClient,
) {
  let config: ChatRuntimeSettings;
  if (tx) {
    await ensureConfigRow(tx);
    await tx.$queryRaw(
      Prisma.sql`SELECT "key" FROM "SystemConfig" WHERE "key" = ${CHAT_RUNTIME_CONFIG_KEY} FOR SHARE`,
    );
    const row = await tx.systemConfig.findUniqueOrThrow({
      where: { key: CHAT_RUNTIME_CONFIG_KEY },
    });
    config = parseSettings(row.value);
  } else config = await getChatRuntimeConfig();
  const code = !config.enabled
    ? "CHAT_RUNTIME_PAUSED"
    : !config.profiles.includes(
          modelId as ChatRuntimeSettings["profiles"][number],
        ) ||
        (config.userAllowlist.length > 0 &&
          !config.userAllowlist.includes(userId))
      ? "CHAT_RUNTIME_NOT_ADMITTED"
      : null;
  return {
    allowed: code === null,
    code,
    protocolVersion: CHAT_RUNTIME_PROTOCOL_VERSION,
    queueTimeoutMs: config.queueTimeoutMs,
  };
}

export async function assertChatRuntimeAdmission(
  userId: string,
  modelId: string,
  tx?: Prisma.TransactionClient,
) {
  const admission = await getChatRuntimeAdmission(userId, modelId, tx);
  if (!admission.allowed)
    throw new ChatRuntimeAdmissionError(
      admission.code!,
      "对话暂不接受新任务，已有任务仍可恢复和停止",
    );
  return admission;
}
