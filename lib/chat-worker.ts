import { createHash, randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { getChatProfile } from "@/lib/chat-profiles";
import { prepareChatContext } from "@/lib/chat-context";
import {
  chatEndpoint,
  responsesRequestBody,
  type UpstreamChatMessage,
} from "@/lib/chat-upstream";
import { consumeChatSse } from "@/lib/chat-responses-stream";
import { finalizeChatContextManifest } from "@/lib/chat-context-manifest";
import type { ChatContextManifest } from "@/lib/chat-context-types";
import {
  ChatResponseRecovery,
  canRetryChatResponse,
  continuationMessages,
  waitForChatRecovery,
} from "@/lib/chat-recovery";
import {
  appendActiveChatEvent,
  appendChatEvent,
  finishChatAttempt,
} from "@/lib/chat-turns";
import { CHAT_RUNTIME_PROTOCOL_VERSIONS } from "@/lib/chat-runtime-config";
import {
  removeChatWorkerHeartbeat,
  touchChatWorkerHeartbeat,
  withChatRuntimeTimeout,
} from "@/lib/chat-runtime-health";
import { logger } from "@/lib/logger";
import type { ChatTurnInput } from "@/lib/chat-turn-types";
import type { ReasoningEffort } from "@/lib/chat-model-options";

export { chatWorkerOnline } from "@/lib/chat-runtime-health";
const json = (value: unknown) =>
  JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" ? (value as Record<string, unknown>) : {};

async function finishWithRetries(
  input: Parameters<typeof finishChatAttempt>[0],
) {
  // Only retry the idempotent DB finalization, never the upstream execution.
  for (let retry = 0; ; retry++) {
    try {
      return await finishChatAttempt(input);
    } catch (error) {
      if (retry >= 3) throw error;
      await new Promise((resolve) => setTimeout(resolve, 250 * 2 ** retry));
    }
  }
}

function workerBuildId() {
  if (process.env.CHAT_WORKER_BUILD_ID || process.env.GIT_SHA)
    return process.env.CHAT_WORKER_BUILD_ID || process.env.GIT_SHA!;
  try {
    const hash = createHash("sha256");
    for (const file of [
      "chat-worker.ts",
      "chat-responses-stream.ts",
      "chat-runtime-config.ts",
      "chat-runtime-health.ts",
    ])
      hash.update(readFileSync(join(process.cwd(), "lib", file)));
    return `source-${hash.digest("hex").slice(0, 20)}`;
  } catch {
    return "unversioned";
  }
}

export async function recoverStaleChatAttempts() {
  const [{ now }] = await db.$queryRaw<
    Array<{ now: Date }>
  >`SELECT clock_timestamp() AS "now"`;
  const runningBefore = new Date(now.getTime() - 60_000);
  const stale = await db.$queryRaw<
    Array<{ id: string; turnId: string; status: string }>
  >(Prisma.sql`
    SELECT "id", "turnId", "status" FROM "ChatAttempt"
    WHERE "protocolVersion" IN (${Prisma.join(CHAT_RUNTIME_PROTOCOL_VERSIONS)}) AND (
      ("status" = 'running' AND COALESCE("heartbeatAt", "startedAt", "createdAt") < ${runningBefore}) OR
      ("status" = 'queued' AND "queueDeadline" IS NOT NULL AND "queueDeadline" <= ${now})
    ) ORDER BY "createdAt" ASC LIMIT 20
  `);
  let recovered = 0;
  for (const attempt of stale)
    if (
      await finishChatAttempt({
        turnId: attempt.turnId,
        attemptId: attempt.id,
        status: "interrupted",
        expectedStatus: attempt.status,
        ...(attempt.status === "running"
          ? { staleBefore: runningBefore }
          : { queueExpiredBefore: now }),
        error: {
          origin: "runtime",
          code:
            attempt.status === "running"
              ? "EXECUTION_LEASE_LOST"
              : "QUEUE_TIMEOUT",
          publicMessage:
            attempt.status === "queued"
              ? "任务排队等待超时，本轮未收费；可以重新生成"
              : "任务执行已中断，已有内容已保存，本轮未收费；不会自动重复生成",
        },
      })
    )
      recovered++;
  return recovered;
}

export async function executeChatAttempt(
  attemptId: string,
  abort: AbortController,
) {
  const executionToken = randomUUID();
  if (abort.signal.aborted) return;
  // Keep the PostgreSQL queued CAS. The database clock is authoritative for
  // execution leases and explicit queue deadlines, independent of host clocks.
  const claimed = await db.$executeRaw(Prisma.sql`
    UPDATE "ChatAttempt" SET "status" = 'running', "executionToken" = ${executionToken},
      "startedAt" = clock_timestamp(), "heartbeatAt" = clock_timestamp()
    WHERE "id" = ${attemptId} AND "status" = 'queued'
      AND "protocolVersion" IN (${Prisma.join(CHAT_RUNTIME_PROTOCOL_VERSIONS)})
      AND ("queueDeadline" IS NULL OR "queueDeadline" > clock_timestamp())
  `);
  if (!claimed) return;
  const attempt = await db.chatAttempt.findUniqueOrThrow({
    where: { id: attemptId },
    include: { turn: true },
  });
  const turn = attempt.turn;
  await db.chatTurn.updateMany({
    where: {
      id: turn.id,
      activeAttemptId: attemptId,
      activeConversationId: { not: null },
    },
    data: { status: "running" },
  });
  const input = turn.input as unknown as ChatTurnInput;
  const snapshot = record(turn.configSnapshot);
  const recovery = new ChatResponseRecovery();
  let state = recovery.state;
  const startedAt = Date.now();
  let lastSemanticAt = startedAt;
  let lastFlushAt = 0;
  let publishedText = "";
  let publishedActivity = "";
  let publishedSources = "";
  let publishedRevision = -1;
  let firstTextMs: number | null = null;
  let apiKey = "";
  const timings: Record<string, string | number> = {
    queued_at: attempt.createdAt.toISOString(),
    started_at: (attempt.startedAt ?? attempt.createdAt).toISOString(),
    queue_ms: Math.max(
      0,
      (attempt.startedAt ?? attempt.createdAt).getTime() -
        attempt.createdAt.getTime(),
    ),
  };
  let headersTimer: ReturnType<typeof setTimeout> | undefined;
  const deadline = setTimeout(
    () => abort.abort(new Error("overall_deadline")),
    600_000,
  );
  let checking = false;
  const heartbeat = setInterval(() => {
    if (checking) return;
    checking = true;
    void db
      .$executeRaw(
        Prisma.sql`
        UPDATE "ChatAttempt" SET "heartbeatAt" = clock_timestamp()
        WHERE "id" = ${attemptId} AND "status" = 'running' AND "executionToken" = ${executionToken}
      `,
      )
      .then((result) => {
        if (!result) abort.abort(new Error("attempt_no_longer_active"));
      })
      .catch(() => abort.abort(new Error("worker_database_unavailable")))
      .finally(() => {
        checking = false;
      });
    if (Date.now() - lastSemanticAt > 180_000)
      abort.abort(new Error("semantic_stall"));
  }, 5_000);

  const persistUpdate = async (force = false) => {
    if (!force && Date.now() - lastFlushAt < 40) return;
    const text = recovery.text;
    const sources = JSON.stringify(recovery.sources);
    const activity = state.activity;
    const revision = state.revision;
    const parts = json(recovery.checkpoint());
    const sourceData = json(recovery.sources);
    const textChanged = text !== publishedText;
    const activityChanged = state.activity !== publishedActivity;
    const sourcesChanged = sources !== publishedSources;
    if (
      !force &&
      !textChanged &&
      !activityChanged &&
      !sourcesChanged &&
      revision === publishedRevision
    )
      return;
    const retained = await db.$transaction(async (tx) => {
      // This helper locks turn then attempt and validates active/token before
      // any checkpoint mutation, in the same transaction (no nested tx).
      if (
        !(await appendActiveChatEvent(tx, {
          turnId: turn.id,
          attemptId,
          executionToken,
          type: "checkpoint.updated",
          payload: {
            revision,
            providerStatus: state.providerStatus,
            usageAvailability: state.usage ? "reported" : "unknown",
          },
        }))
      )
        return false;
      if (text.trim() && !timings.first_text_committed_at) {
        const [{ now }] = await tx.$queryRaw<
          Array<{ now: Date }>
        >`SELECT clock_timestamp() AS "now"`;
        timings.first_text_committed_at = now.toISOString();
      }
      const active = await tx.chatAttempt.updateMany({
        where: { id: attemptId, status: "running", executionToken },
        data: {
          rawText: text,
          parts,
          sources: sourceData,
          activity,
          responseId: state.responseId,
          usage: state.usage ? json(state.usage) : Prisma.DbNull,
          timings: json(timings),
        },
      });
      if (!active.count) return false;
      await tx.conversationMessage.updateMany({
        where: { chatAttemptId: attemptId },
        data: {
          content: text,
          chatStatus: "running",
          chatSources: sourceData,
          chatUsage: state.usage ? json(state.usage) : Prisma.DbNull,
        },
      });
      if (activityChanged)
        await appendChatEvent(tx, turn.id, attemptId, "activity.updated", {
          activity,
          searched: recovery.searched,
          recovery: record(parts).recovery,
        });
      if (textChanged)
        await appendChatEvent(
          tx,
          turn.id,
          attemptId,
          text.startsWith(publishedText) ? "text.delta" : "text.snapshot",
          text.startsWith(publishedText)
            ? {
                text: text.slice(publishedText.length),
                offset: publishedText.length,
                offsetEncoding: "utf16",
              }
            : { text },
        );
      if (sourcesChanged)
        await appendChatEvent(tx, turn.id, attemptId, "citations.updated", {
          sources: JSON.parse(sources),
        });
      return true;
    });
    if (!retained) throw new Error("attempt_no_longer_active");
    publishedText = text;
    publishedActivity = activity;
    publishedSources = sources;
    publishedRevision = revision;
    lastFlushAt = Date.now();
  };
  let flushing: Promise<void> | null = null;
  const flush = async (force = false): Promise<void> => {
    if (flushing) {
      await flushing;
      if (force) await flush(true);
      return;
    }
    flushing = persistUpdate(force);
    try {
      await flushing;
    } finally {
      flushing = null;
    }
  };
  const flushTimer = setInterval(() => {
    void flush().catch(() =>
      abort.abort(new Error("event_persistence_failed")),
    );
  }, 40);

  const stopAndDrainFlush = async () => {
    clearInterval(flushTimer);
    await Promise.resolve(flushing).catch(() => undefined);
  };

  try {
    abort.signal.throwIfAborted();
    const config = await getChatProfile(turn.modelId);
    apiKey = config.apiKey ?? "";
    if (
      !apiKey ||
      config.model !== snapshot.model ||
      config.baseUrl !== snapshot.baseUrl
    )
      throw new Error("model_configuration_changed");
    if (turn.activeAttemptId !== attemptId)
      throw new Error("attempt_no_longer_active");
    state.activity = "context";
    timings.context_started_at = new Date().toISOString();
    await flush(true);
    const latestMessage: UpstreamChatMessage = {
      role: "user",
      content:
        input.content +
        (typeof snapshot.runtimeTime === "string"
          ? `\n\n[本轮运行时间]\n${snapshot.runtimeTime}`
          : ""),
    };
    const responses = snapshot.transport === "responses_sse";
    const promptCacheKey = createHash("sha256")
      .update(JSON.stringify(["chat-cache-v1", turn.userId, snapshot.model]))
      .digest("hex");
    const buildRequest = (messages: UpstreamChatMessage[]) =>
      responses
        ? responsesRequestBody(
            String(snapshot.model),
            continuationMessages(messages, recovery.prefix),
            String(snapshot.instructions),
            snapshot.effort as ReasoningEffort,
            {
              webSearch: input.webSearch,
              maxOutputTokens: 16_384,
              ...(snapshot.model === "gpt-6.1-sol"
                ? {
                    promptCacheKey,
                    promptCacheOptions: {
                      mode: "implicit" as const,
                      ttl: "30m" as const,
                    },
                  }
                : {}),
            },
          )
        : {
            model: snapshot.model,
            messages: [
              { role: "system", content: snapshot.instructions },
              ...continuationMessages(messages, recovery.prefix),
            ],
            stream: true,
          };
    type PreparedContext = Awaited<ReturnType<typeof prepareChatContext>> & {
      manifest?: unknown;
      contextManifest?: unknown;
      snapshotId?: string | null;
      contextSnapshotId?: string | null;
    };
    const context: PreparedContext = await prepareChatContext({
      userId: turn.userId,
      conversationId: turn.conversationId,
      modelId: turn.modelId,
      latestMessage,
      currentTurnId: turn.id,
      instructions: String(snapshot.instructions),
      profileVersion:
        typeof snapshot.profileVersion === "string"
          ? snapshot.profileVersion
          : undefined,
      references: input.references,
      referenceImageKeys: input.referenceImageKeys,
      sourceImageIds: input.sourceImageIds,
      buildRequest,
      signal: abort.signal,
    });
    abort.signal.throwIfAborted();
    timings.context_completed_at = new Date().toISOString();
    state.activity = "waiting_upstream";
    lastSemanticAt = Date.now();
    await flush(true);
    for (;;) {
      const body = buildRequest(context.messages);
      const requestBody = JSON.stringify(body);
      const requestHash = createHash("sha256")
        .update(requestBody)
        .digest("hex");
      let manifest = record(context.manifest ?? context.contextManifest);
      if (recovery.retries.length && typeof manifest.budgetTokens === "number")
        manifest = record(
          finalizeChatContextManifest(
            manifest as unknown as ChatContextManifest,
            body,
          ),
        );
      if (
        typeof manifest.requestHash === "string" &&
        manifest.requestHash !== requestHash
      )
        throw new Error("context_request_hash_mismatch");
      const contextRetained = await db.$transaction(async (tx) => {
        if (
          !(await appendActiveChatEvent(tx, {
            turnId: turn.id,
            attemptId,
            executionToken,
            type: "context.updated",
            payload: context.status,
          }))
        )
          return false;
        await tx.chatAttempt.update({
          where: { id: attemptId },
          data: {
            contextSnapshotId:
              context.snapshotId ??
              context.contextSnapshotId ??
              (typeof manifest.snapshotId === "string"
                ? manifest.snapshotId
                : null),
            contextManifest: json({
              ...manifest,
              requestHash,
              ...(recovery.retries.length
                ? {
                    continuation: {
                      requests: recovery.retries.length + 1,
                      prefixCharacters: recovery.prefix.length,
                      prefixHash: createHash("sha256")
                        .update(recovery.prefix)
                        .digest("hex"),
                    },
                  }
                : {}),
            }),
            requestHash,
          },
        });
        return true;
      });
      if (!contextRetained) throw new Error("attempt_no_longer_active");
      abort.signal.throwIfAborted();
      const requestAbort = new AbortController();
      const stopRequest = () => requestAbort.abort(abort.signal.reason);
      abort.signal.addEventListener("abort", stopRequest, { once: true });
      if (abort.signal.aborted) stopRequest();
      let transportError: unknown;
      try {
        timings.upstream_sent_at = new Date().toISOString();
        headersTimer = setTimeout(
          () => requestAbort.abort(new Error("headers_timeout")),
          90_000,
        );
        const response = await fetch(
          chatEndpoint(String(snapshot.baseUrl), responses),
          {
            method: "POST",
            redirect: "error",
            headers: {
              Authorization: `Bearer ${apiKey}`,
              "Content-Type": "application/json",
              Accept: "text/event-stream",
              "Accept-Encoding": "identity",
            },
            body: requestBody,
            signal: requestAbort.signal,
          },
        );
        clearTimeout(headersTimer);
        const requestId = response.headers.get("x-request-id");
        timings.upstream_headers_at = new Date().toISOString();
        timings.upstream_http_status = response.status;
        await db.chatAttempt.updateMany({
          where: { id: attemptId, executionToken, status: "running" },
          data: { requestId, timings: json(timings) },
        });
        logger.info(
          {
            turnId: turn.id,
            attemptId,
            model: snapshot.model,
            status: response.status,
            headersMs: Date.now() - startedAt,
            requestId,
          },
          "Chat upstream headers received.",
        );
        if (
          !response.ok ||
          !response.body ||
          !response.headers.get("content-type")?.includes("text/event-stream")
        ) {
          // A JSON response to stream:true is not silently presented as genuine streaming.
          const payload = await response.json().catch(() => null);
          state.terminal = "failed";
          state.error = Object.keys(record(record(payload).error)).length
            ? record(record(payload).error)
            : {
                type: "protocol_error",
                code: response.ok
                  ? "NON_STREAMING_RESPONSE"
                  : `HTTP_${response.status}`,
              };
          throw new Error(`upstream_http_${response.status}`);
        }
        await consumeChatSse(
          response.body,
          async (payload) => {
            const value = record(payload);
            const before = state.rawText;
            if (responses) state.consume(payload);
            else {
              const choice = record(
                Array.isArray(value.choices) ? value.choices[0] : null,
              );
              const delta = record(choice.delta);
              if (typeof delta.content === "string")
                state.consume({
                  type: "response.output_text.delta",
                  item_id: "answer",
                  delta: delta.content,
                });
              if (value.usage) state.usage = record(value.usage);
              if (value.error) {
                state.terminal = "failed";
                state.error = record(value.error);
              } else if (choice.finish_reason)
                state.terminal =
                  choice.finish_reason === "stop" ? "completed" : "incomplete";
            }
            const type = typeof value.type === "string" ? value.type : "";
            if (
              (state.rawText !== before && state.rawText.trim()) ||
              /web_search_call\.(searching|completed)$/.test(type) ||
              type === "response.output_item.added"
            )
              lastSemanticAt = Date.now();
            if (firstTextMs === null && state.rawText.trim()) {
              firstTextMs = Date.now() - startedAt;
              timings.first_text_received_at = new Date().toISOString();
            }
            if (recovery.text.length > 512_000)
              throw new Error("output_limit_exceeded");
            await flush(Boolean(state.terminal));
            return !state.terminal;
          },
          { signal: requestAbort.signal, idleMs: 90_000 },
        );
      } catch (error) {
        transportError = requestAbort.signal.aborted
          ? requestAbort.signal.reason
          : error;
      } finally {
        clearTimeout(headersTimer);
        abort.signal.removeEventListener("abort", stopRequest);
      }
      const reason =
        transportError instanceof Error
          ? transportError.message
          : transportError
            ? "stream_error"
            : undefined;
      if (
        canRetryChatResponse({
          aborted: abort.signal.aborted,
          retries: recovery.retries.length,
          state,
          reason,
        })
      ) {
        await flush(true);
        const retryReason =
          state.terminal === "incomplete"
            ? "output_limit"
            : state.error
              ? "upstream_unavailable"
              : reason
                ? "connection_lost"
                : "stream_ended";
        state = recovery.restart(retryReason);
        timings.upstream_retries = recovery.retries.length;
        lastSemanticAt = Date.now();
        await flush(true);
        logger.info(
          {
            turnId: turn.id,
            attemptId,
            retry: recovery.retries.length,
            continuing: Boolean(recovery.prefix),
          },
          "Recovering chat upstream connection.",
        );
        await waitForChatRecovery(
          2000 * 2 ** (recovery.retries.length - 1),
          abort.signal,
        );
        state.activity = "waiting_upstream";
        await flush(true);
        continue;
      }
      if (transportError) throw transportError;
      break;
    }
    await stopAndDrainFlush();
    timings.stream_finished_at = new Date().toISOString();
    await flush(true);
    const status =
      state.terminal === "completed" &&
      recovery.retries.length &&
      recovery.text === recovery.prefix
        ? "incomplete"
        : (state.terminal ?? "interrupted");
    const providerMessage =
      typeof state.error?.message === "string"
        ? state.error.message
            .replaceAll(apiKey, "[REDACTED]")
            .replace(/sk-[a-z\d_-]+/gi, "[REDACTED]")
            .replace(/https?:\/\/\S+/gi, "[UPSTREAM]")
            .slice(0, 400)
        : undefined;
    const failure =
      status === "completed"
        ? undefined
        : {
            origin: state.terminal ? "provider" : "transport",
            code:
              typeof state.error?.code === "string"
                ? state.error.code.slice(0, 80)
                : status.toUpperCase(),
            type:
              typeof state.error?.type === "string"
                ? state.error.type.slice(0, 80)
                : undefined,
            message: providerMessage,
            publicMessage:
              status === "incomplete"
                ? "回复未完成，收到的内容已保存，本轮未收费"
                : "上游在生成过程中中断，收到的内容已保存，本轮未收费",
          };
    await finishWithRetries({
      turnId: turn.id,
      attemptId,
      executionToken,
      status,
      text: recovery.text,
      parts: recovery.checkpoint(),
      sources: recovery.sources,
      usage: state.usage,
      error: failure,
    });
    logger.info(
      {
        turnId: turn.id,
        attemptId,
        status,
        totalMs: Date.now() - startedAt,
        firstTextMs,
        events: state.eventCounts,
        searched: recovery.searched,
        rawPartDiagnostics: state.partDiagnostics(),
      },
      "Chat attempt finished.",
    );
  } catch (error) {
    // Freeze and drain the periodic writer before persisting the accumulator.
    // A bad frame or reader rejection may follow a large delta within 40ms.
    await stopAndDrainFlush();
    timings.stream_finished_at = new Date().toISOString();
    await flush(true).catch(() => undefined);
    const reason = abort.signal.aborted
      ? String(abort.signal.reason)
      : error instanceof Error
        ? error.message
        : "stream_error";
    logger.warn(
      {
        turnId: turn.id,
        attemptId,
        phase: state.activity,
        aborted: abort.signal.aborted,
        totalMs: Date.now() - startedAt,
      },
      "Chat attempt interrupted.",
    );
    await finishWithRetries({
      turnId: turn.id,
      attemptId,
      executionToken,
      text: recovery.text,
      parts: recovery.checkpoint(),
      sources: recovery.sources,
      usage: state.usage,
      status:
        state.terminal && state.terminal !== "completed"
          ? state.terminal
          : "interrupted",
      error: {
        origin: state.error ? "provider" : "transport",
        code:
          state.error?.code ??
          reason.replaceAll(apiKey || "[none]", "[REDACTED]").slice(0, 120),
        type:
          typeof state.error?.type === "string"
            ? state.error.type.slice(0, 80)
            : undefined,
        message:
          typeof state.error?.message === "string"
            ? state.error.message
                .replaceAll(apiKey || "[none]", "[REDACTED]")
                .replace(/sk-[a-z\d_-]+/gi, "[REDACTED]")
                .replace(/https?:\/\/\S+/gi, "[UPSTREAM]")
                .slice(0, 400)
            : undefined,
        publicMessage: "对话未完成，已保存收到的内容，本轮未收费；可以重新生成",
      },
    });
  } finally {
    clearTimeout(headersTimer);
    clearTimeout(deadline);
    clearInterval(heartbeat);
    clearInterval(flushTimer);
    await Promise.resolve(flushing).catch(() => undefined);
    apiKey = "";
  }
}

export function startChatWorker(
  options: {
    instanceId?: string;
    buildId?: string;
    shutdownTimeoutMs?: number;
  } = {},
) {
  const running = new Map<
    string,
    { abort: AbortController; promise: Promise<void> }
  >();
  let stopping = false;
  let pumping = false;
  let lastRecovery = 0;
  let lastWarning = 0;
  const instanceId =
    options.instanceId ?? `${hostname()}:${process.pid}:${randomUUID()}`;
  const buildId = options.buildId ?? workerBuildId();
  const concurrency = Math.min(
    16,
    Math.max(1, Number(process.env.CHAT_WORKER_CONCURRENCY) || 2),
  );
  const pump = async () => {
    if (pumping || stopping) return;
    pumping = true;
    try {
      const capacity = Math.max(0, concurrency - running.size);
      const queued = capacity
        ? await db.chatAttempt.findMany({
            where: {
              status: "queued",
              protocolVersion: { in: CHAT_RUNTIME_PROTOCOL_VERSIONS },
            },
            orderBy: { createdAt: "asc" },
            take: capacity,
            select: { id: true },
          })
        : [];
      if (stopping) return;
      await touchChatWorkerHeartbeat({
        instanceId,
        hostname: hostname(),
        pid: process.pid,
        buildId,
        protocolVersions: CHAT_RUNTIME_PROTOCOL_VERSIONS,
        updatedAt: new Date().toISOString(),
        status: "accepting",
        running: running.size,
      }).catch(() => {
        // Redis liveness is advisory. Accepted PG work must still drain while
        // Redis is down; a failed heartbeat never disables recovery/execution.
        if (Date.now() - lastWarning > 30_000) {
          logger.warn({ instanceId }, "Chat worker heartbeat unavailable.");
          lastWarning = Date.now();
        }
      });
      if (stopping) return;
      for (const attempt of queued) {
        if (running.has(attempt.id)) continue;
        const abort = new AbortController();
        const promise = executeChatAttempt(attempt.id, abort)
          .catch((error) => {
            logger.error(
              {
                attemptId: attempt.id,
                errorName: error instanceof Error ? error.name : "unknown",
              },
              "Chat attempt persistence failed; lease recovery will retain partial output.",
            );
          })
          .finally(() => running.delete(attempt.id));
        running.set(attempt.id, { abort, promise });
      }
      if (!stopping && Date.now() - lastRecovery > 15_000) {
        await recoverStaleChatAttempts();
        lastRecovery = Date.now();
      }
    } catch {
      if (Date.now() - lastWarning > 30_000) {
        logger.warn(
          "Chat worker is unavailable; check database migrations and Redis.",
        );
        lastWarning = Date.now();
      }
    } finally {
      pumping = false;
    }
  };
  let currentPump: Promise<void> | null = null;
  const runPump = () => {
    if (currentPump || stopping) return;
    currentPump = pump().finally(() => {
      currentPump = null;
    });
  };
  const timer = setInterval(runPump, 1_000);
  runPump();
  logger.info(
    { instanceId, buildId, protocolVersions: CHAT_RUNTIME_PROTOCOL_VERSIONS },
    "Chat worker started.",
  );
  let stopped: Promise<boolean> | null = null;
  return () => {
    if (stopped) return stopped;
    stopping = true;
    clearInterval(timer);
    for (const job of running.values())
      job.abort.abort(new Error("worker_shutdown"));
    stopped = (async () => {
      let clean = true;
      try {
        await withChatRuntimeTimeout(async () => {
          await currentPump;
          await Promise.allSettled(
            [...running.values()].map((job) => job.promise),
          );
        }, options.shutdownTimeoutMs ?? 10_000);
      } catch {
        clean = false;
        logger.warn(
          { instanceId, running: running.size },
          "Chat worker shutdown deadline reached; database lease recovery remains enabled.",
        );
      } finally {
        await removeChatWorkerHeartbeat(instanceId).catch(() => undefined);
      }
      return clean;
    })();
    return stopped;
  };
}
