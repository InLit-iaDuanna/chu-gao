import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { lockResearchTask, appendResearchEvent } from "./service";
import { ResearchError, researchJson } from "./errors";
import type { ResearchPlan } from "./types";
import type { ResearchConfig } from "./config";
import { stageCallCeiling } from "./workflow-quality";

export async function activeResearchAttempt(attemptId: string) {
  const attempt = await db.researchAttempt.findUnique({
    where: { id: attemptId },
    include: { stage: { include: { task: true } } },
  });
  if (
    !attempt ||
    attempt.status !== "running" ||
    attempt.stage.activeAttemptId !== attempt.id ||
    attempt.stage.task.status !== "running"
  )
    throw new ResearchError("TASK_STOPPED", "研究阶段已经停止", 409);
  if (
    attempt.stage.task.deadlineAt &&
    attempt.stage.task.deadlineAt <= new Date()
  )
    throw new ResearchError("BUDGET_EXHAUSTED", "研究任务达到执行时限", 409);
  return attempt;
}
export async function reserveResearchCall(
  attemptId: string,
  kind: "llm" | "search" | "crawl" | "embed",
  payload: unknown,
) {
  const current = await activeResearchAttempt(attemptId);
  return db.$transaction(
    async (tx) => {
      // Lock order is always capacity -> task. Different tasks must serialize
      // the global count and insert; their individual row locks cannot do that.
      // The lock lives only for this reservation transaction, not the API call.
      if (kind === "llm" || kind === "crawl")
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`chugao-research-capacity:${kind}`}))`;
      await lockResearchTask(tx, current.stage.taskId);
      const task = await tx.researchTask.findUniqueOrThrow({
        where: { id: current.stage.taskId },
      });
      const attempt = await tx.researchAttempt.findUniqueOrThrow({
        where: { id: attemptId },
      });
      const stage = await tx.researchStage.findUniqueOrThrow({
        where: { id: attempt.stageId },
      });
      if (
        task.status !== "running" ||
        attempt.status !== "running" ||
        stage.activeAttemptId !== attempt.id
      )
        throw new ResearchError("TASK_STOPPED", "研究阶段已经停止", 409);
      const plan = task.plan as unknown as ResearchPlan;
      const used = {
        llm: task.llmCalls,
        search: task.searchCalls,
        crawl: task.crawlCalls,
      };
      if (task.deadlineAt && task.deadlineAt <= new Date())
        throw new ResearchError(
          "BUDGET_EXHAUSTED",
          "研究任务达到执行时限",
          409,
        );
      if (kind !== "embed" && used[kind] >= plan.limits[kind])
        throw new ResearchError(
          "BUDGET_EXHAUSTED",
          "研究任务达到调用上限",
          409,
        );
      if (
        kind !== "embed" &&
        used[kind] >= stageCallCeiling(plan, stage.kind, kind)
      )
        throw new ResearchError(
          "STAGE_BUDGET_RESERVED",
          "本阶段额度已用完，剩余额度保留给核验和交付",
          409,
        );
      const inFlight = await tx.researchCall.count({
        where: { kind, status: "running", task: { status: "running" } },
      });
      if (
        (kind === "llm" && inFlight >= 2) ||
        (kind === "crawl" && inFlight >= 1)
      )
        throw new ResearchError(
          "CAPACITY_BUSY",
          "研究组件正在处理其他调用",
          429,
        );
      const counter = {
        llm: "llmCalls",
        search: "searchCalls",
        crawl: "crawlCalls",
      } as const;
      if (kind !== "embed")
        await tx.researchTask.update({
          where: { id: task.id },
          data: { [counter[kind]]: { increment: 1 } },
        });
      const call = await tx.researchCall.create({
        data: {
          taskId: task.id,
          attemptId,
          kind,
          requestHash: createHash("sha256")
            .update(JSON.stringify(payload))
            .digest("hex"),
        },
      });
      await appendResearchEvent(tx, task.id, "call.started", {
        callId: call.id,
        kind,
      });
      return {
        call,
        task,
        config: task.configSnapshot as unknown as ResearchConfig,
      };
    },
    {
      // A waiter must count again after the previous reservation commits.
      isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
    },
  );
}
export async function finishResearchCall(
  callId: string,
  input: {
    usage?: Record<string, unknown>;
    errorCode?: string;
    continuationEnc?: string;
  },
) {
  const call = await db.researchCall.findUniqueOrThrow({
    where: { id: callId },
    include: { task: true },
  });
  const config = call.task.configSnapshot as unknown as ResearchConfig;
  const inputTokens = Number(
    input.usage?.input_tokens ?? input.usage?.prompt_tokens,
  );
  const outputTokens = Number(
    input.usage?.output_tokens ?? input.usage?.completion_tokens,
  );
  const known =
    call.kind !== "llm" ||
    (Number.isFinite(inputTokens) &&
      Number.isFinite(outputTokens) &&
      config.inputUsdPerMillion !== null &&
      config.outputUsdPerMillion !== null);
  const costUsd =
    call.kind !== "llm"
      ? 0
      : known
        ? (inputTokens * config.inputUsdPerMillion! +
            outputTokens * config.outputUsdPerMillion!) /
          1e6
        : null;
  await db.researchCall.updateMany({
    where: { id: callId, status: "running" },
    data: {
      status: input.errorCode ? "failed" : "completed",
      finishedAt: new Date(),
      usage: input.usage ? researchJson(input.usage) : undefined,
      costUsd,
      costBasis:
        call.kind !== "llm"
          ? "self_hosted"
          : known
            ? "configured_rates"
            : "unknown",
      errorCode: input.errorCode,
      continuationEnc: input.continuationEnc,
    },
  });
}

export async function waitForResearchCall(
  attemptId: string,
  kind: "llm" | "search" | "crawl" | "embed",
  payload: unknown,
  signal?: AbortSignal,
) {
  for (;;) {
    signal?.throwIfAborted();
    try {
      return await reserveResearchCall(attemptId, kind, payload);
    } catch (error) {
      if (!(error instanceof ResearchError) || error.code !== "CAPACITY_BUSY")
        throw error;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }
}
