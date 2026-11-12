import { db } from "../lib/db";
import { callFailure, sanitizeCallText } from "../lib/model-call-log";
import { safeUrlForDiagnostics } from "../lib/providers/diagnostics";

const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" ? (value as Record<string, unknown>) : {};

async function main() {
  let cursor: string | undefined;
  let inserted = 0;
  for (;;) {
    const attempts = await db.chatAttempt.findMany({
      where: { status: { notIn: ["queued", "running"] } },
      include: { turn: true },
      orderBy: { id: "asc" },
      take: 200,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    if (!attempts.length) break;
    const existing = await db.modelCallLog.findMany({
      where: { chatAttemptId: { in: attempts.map((attempt) => attempt.id) } },
      select: { chatAttemptId: true },
    });
    const logged = new Set(existing.map((item) => item.chatAttemptId));
    const result = await db.modelCallLog.createMany({
      skipDuplicates: true,
      data: attempts
        .filter((attempt) => !logged.has(attempt.id))
        .map((attempt) => {
          const snapshot = object(attempt.turn.configSnapshot);
          const error = object(attempt.error);
          const timings = object(attempt.timings);
          const usage = object(attempt.usage);
          const startedAt = attempt.startedAt ?? attempt.createdAt;
          const numericToken = (value: unknown) =>
            typeof value === "number" &&
            Number.isSafeInteger(value) &&
            value >= 0 &&
            value <= 2_147_483_647
              ? value
              : null;
          return {
            id: `chat_history_${attempt.id}`,
            kind: "llm",
            source: "web",
            operation: "chat.reply",
            status: attempt.status === "completed" ? "SUCCEEDED" : "FAILED",
            modelId:
              typeof snapshot.model === "string"
                ? snapshot.model
                : attempt.turn.modelId,
            providerName: attempt.turn.modelId,
            userId: attempt.turn.userId,
            conversationId: attempt.turn.conversationId,
            chatAttemptId: attempt.id,
            endpoint:
              typeof snapshot.baseUrl === "string"
                ? safeUrlForDiagnostics(snapshot.baseUrl)
                : null,
            requestId: attempt.requestId
              ? sanitizeCallText(attempt.requestId)
              : null,
            httpStatus:
              typeof timings.upstream_http_status === "number"
                ? timings.upstream_http_status
                : null,
            ...(attempt.status === "completed"
              ? {}
              : callFailure(
                  new Error(
                    typeof error.message === "string"
                      ? error.message
                      : String(error.code ?? attempt.status),
                  ),
                )),
            inputTokens: numericToken(
              usage.input_tokens ?? usage.prompt_tokens,
            ),
            outputTokens: numericToken(
              usage.output_tokens ?? usage.completion_tokens,
            ),
            startedAt,
            finishedAt: attempt.finishedAt,
            durationMs: attempt.finishedAt
              ? Math.min(
                  2_147_483_647,
                  Math.max(
                    0,
                    attempt.finishedAt.getTime() - startedAt.getTime(),
                  ),
                )
              : null,
          };
        }),
    });
    inserted += result.count;
    cursor = attempts.at(-1)!.id;
  }
  console.log(JSON.stringify({ historicalChatCallsInserted: inserted }));
}
main()
  .catch(() => {
    console.error("Historical chat call backfill failed");
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
