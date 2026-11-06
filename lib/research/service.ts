import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { getResearchConfig, makeResearchPlan } from "./config";
import { ResearchError, researchJson } from "./errors";
import {
  researchTerminal,
  researchIntakeResultSchema,
  type ResearchTaskView,
  type ResearchPlanInput,
  type ResearchBriefInput,
  type ResearchPlan,
  type ResearchIntakeSubmission,
} from "./types";
import {
  confirmedIntakeRequirements,
  INTAKE_DIALOGUE_VERSION,
  INTAKE_MAX_MODEL_CALLS,
} from "./intake-contract";
import { getChatProfile } from "@/lib/chat-profiles";
import { snapshotResearchAttachments } from "./attachments";
import { readFinalResearchPackage } from "./workflow-quality";
import {
  assertSynthesisCheckpointVersion,
  restoreSynthesisCheckpoint,
} from "./synthesis-checkpoint";
import { researchVersionTaskIds } from "./versions";
import {
  expireResearchAssets,
  lockResearchFiles,
  researchExpiry,
  researchFilesProtected,
} from "./lifecycle";

type Tx = Prisma.TransactionClient;
const hash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
export async function lockResearchTask(tx: Tx, id: string) {
  await tx.$queryRaw(
    Prisma.sql`SELECT "id" FROM "ResearchTask" WHERE "id" = ${id} FOR UPDATE`,
  );
}
export async function appendResearchEvent(
  tx: Tx,
  taskId: string,
  type: string,
  payload: unknown,
) {
  const task = await tx.researchTask.update({
    where: { id: taskId },
    data: { nextSeq: { increment: 1 } },
    select: { nextSeq: true },
  });
  return tx.researchEvent.create({
    data: { taskId, seq: task.nextSeq, type, payload: researchJson(payload) },
  });
}
export async function researchEvent(
  taskId: string,
  type: string,
  payload: unknown,
  executionToken?: string,
) {
  return db.$transaction(async (tx) => {
    await lockResearchTask(tx, taskId);
    const task = await tx.researchTask.findUniqueOrThrow({
      where: { id: taskId },
    });
    if (
      researchTerminal(task.status) ||
      (executionToken && task.executionToken !== executionToken)
    )
      throw new ResearchError("TASK_STOPPED", "研究任务已经停止", 409);
    return appendResearchEvent(tx, taskId, type, payload);
  });
}
export async function listResearchProjects(userId: string) {
  return db.researchProject.findMany({
    where: { userId, archivedAt: null },
    orderBy: { updatedAt: "desc" },
    take: 100,
    include: {
      tasks: {
        where: { preset: { not: "intake" } },
        select: { id: true, status: true, preset: true, createdAt: true },
        orderBy: { createdAt: "desc" },
        take: 10,
      },
    },
  });
}
export async function createResearchProject(
  userId: string,
  title: string,
  conversationId?: string,
) {
  if (
    conversationId &&
    !(await db.conversation.findFirst({
      where: { id: conversationId, userId },
    }))
  )
    throw new ResearchError("NOT_FOUND", "对话不存在", 404);
  return db.researchProject.create({
    data: {
      userId,
      title: title.trim().slice(0, 160) || "新研究",
      conversationId,
    },
  });
}
export async function researchTaskView(
  userId: string,
  taskId: string,
): Promise<ResearchTaskView> {
  return db.$transaction((tx) => readResearchTaskView(tx, userId, taskId), {
    isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
  });
}

export async function readResearchTaskView(
  db: Prisma.TransactionClient,
  userId: string,
  taskId: string,
): Promise<ResearchTaskView> {
  const task = await db.researchTask.findFirst({
    where: { id: taskId, userId },
    include: {
      brief: true,
      stages: {
        orderBy: { ordinal: "asc" },
        include: {
          attempts: {
            orderBy: { ordinal: "asc" },
            select: { id: true, ordinal: true, status: true, error: true },
          },
        },
      },
      evidence: { orderBy: { createdAt: "asc" } },
      artifacts: { orderBy: { createdAt: "asc" } },
      calls: { select: { costUsd: true, kind: true } },
    },
  });
  if (!task) throw new ResearchError("NOT_FOUND", "研究任务不存在", 404);
  let evidence = task.evidence;
  const versionIds = await researchVersionTaskIds(task, db);
  if (task.sourceTaskId)
    evidence = await db.researchEvidence.findMany({
      where: {
        taskId: { in: versionIds },
        task: { userId, projectId: task.projectId },
      },
      orderBy: { createdAt: "asc" },
    });
  const unknown = task.calls.filter(
    (call) => call.kind === "llm" && call.costUsd === null,
  ).length;
  const cost = task.calls.reduce(
    (total, call) => total.plus(call.costUsd ?? 0),
    new Prisma.Decimal(0),
  );
  const protectedVersions = new Set<string>();
  for (const id of versionIds) {
    if (await researchFilesProtected(id)) protectedVersions.add(id);
  }
  const expired = (row: {
    taskId: string;
    purgedAt: Date | null;
    expiresAt: Date | null;
  }) =>
    !!row.purgedAt ||
    (!!row.expiresAt &&
      row.expiresAt <= new Date() &&
      !protectedVersions.has(row.taskId));
  return researchJson({
    id: task.id,
    projectId: task.projectId,
    briefId: task.briefId,
    sourceTaskId: task.sourceTaskId,
    status: task.status,
    preset: task.preset,
    scope: task.scope,
    modelId: task.modelId,
    reasoningEffort: task.reasoningEffort,
    plan: task.plan,
    brief: task.brief.content,
    nextSeq: task.nextSeq,
    llmCalls: task.llmCalls,
    searchCalls: task.searchCalls,
    crawlCalls: task.crawlCalls,
    stages: task.stages.map((stage) => {
      const saved = (
        stage.result as {
          synthesisCheckpoint?: { inputHash?: unknown };
        } | null
      )?.synthesisCheckpoint;
      const restored =
        stage.kind === "synthesize" && typeof saved?.inputHash === "string"
          ? restoreSynthesisCheckpoint(saved, saved.inputHash)
          : null;
      return {
        ...stage,
        // A display hint for saved publication at the call ceiling. The worker
        // still recomputes the current input identity before reusing anything.
        savedSynthesisComplete: !!restored?.report && !!restored.metadata,
      };
    }),
    evidence: evidence.map((row) => ({ ...row, expired: expired(row) })),
    artifacts: task.artifacts.map((row) => ({
      id: row.id,
      kind: row.kind,
      title: row.title,
      filename: row.filename,
      mimeType: row.mimeType,
      sizeBytes: row.sizeBytes,
      basisTaskId: row.basisTaskId,
      expiresAt: row.expiresAt,
      purgedAt: row.purgedAt,
      expired: expired(row),
    })),
    costUsd: unknown ? null : cost.toString(),
    unknownCostCalls: unknown,
    error: task.error,
    createdAt: task.createdAt,
    finishedAt: task.finishedAt,
    expiresAt: task.expiresAt,
  });
}
export async function createResearchTask(
  userId: string,
  input: ResearchPlanInput & {
    projectId: string;
    clientRequestId: string;
    intakeTaskId?: string;
  },
  intake?: ResearchIntakeSubmission,
) {
  const inputHash = hash(intake ? { ...input, intake } : input);
  const sameRequest = (stored: {
    inputHash: string;
    configSnapshot: unknown;
    preset: string;
  }) =>
    stored.inputHash === inputHash ||
    Boolean(
      intake?.requestHash &&
      stored.preset === "intake" &&
      (stored.configSnapshot as { intake?: { requestHash?: string } }).intake
        ?.requestHash === intake.requestHash,
    );
  const existing = await db.researchTask.findUnique({
    where: {
      userId_clientRequestId: {
        userId,
        clientRequestId: input.clientRequestId,
      },
    },
  });
  if (existing) {
    if (!sameRequest(existing))
      throw new ResearchError(
        "IDEMPOTENCY_CONFLICT",
        "同一个提交编号不能用于不同内容",
        409,
      );
    return researchTaskView(userId, existing.id);
  }
  const config = await getResearchConfig();
  if (!config.enabled)
    throw new ResearchError("RESEARCH_DISABLED", "研究功能暂未开放", 503);
  if (input.sourceMode === "refresh" && !input.sourceTaskId)
    throw new ResearchError(
      "INVALID_SOURCE_VERSION",
      "请选择需要整理的历史研究",
      409,
    );
  const profile = await getChatProfile(input.modelId);
  if (
    !profile.enabled ||
    !profile.apiKey ||
    profile.transport !== "responses_sse"
  )
    throw new ResearchError(
      "MODEL_UNAVAILABLE",
      "请选择已配置的 Responses 模型",
      503,
    );
  const plan: ResearchPlan = intake
    ? {
        preset: "explore",
        reason: "先澄清需求，不执行搜索或研究",
        stages: [{ kind: "intake", engine: "chugao" }],
        limits: {
          llm: INTAKE_MAX_MODEL_CALLS,
          search: 0,
          crawl: 0,
          minutes: 4,
        },
        products: [],
      }
    : makeResearchPlan(input, config.limits[input.scope]);
  if (
    input.brief.attachmentKeys.length + input.brief.sourceImageIds.length >
    16
  )
    throw new ResearchError(
      "REFERENCE_LIMIT",
      "每次研究最多使用 16 个参考文件",
    );
  const attachmentKeys = await snapshotResearchAttachments(
    userId,
    input.projectId,
    [
      ...input.brief.attachmentKeys,
      ...input.brief.sourceImageIds.map((id) => `generated:${id}`),
    ],
    config.retentionDays,
  );
  const id = await db.$transaction(async (tx) => {
    await lockResearchFiles(tx);
    await tx.$queryRaw(
      Prisma.sql`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE`,
    );
    const replay = await tx.researchTask.findUnique({
      where: {
        userId_clientRequestId: {
          userId,
          clientRequestId: input.clientRequestId,
        },
      },
    });
    if (replay) {
      if (!sameRequest(replay))
        throw new ResearchError(
          "IDEMPOTENCY_CONFLICT",
          "提交内容发生变化",
          409,
        );
      return replay.id;
    }
    const project = await tx.researchProject.findFirst({
      where: { id: input.projectId, userId, archivedAt: null },
    });
    if (!project) throw new ResearchError("NOT_FOUND", "研究项目不存在", 404);
    const intakeHistory: Array<{ role: string; content: string }> = [];
    if (intake) {
      const turns = await tx.researchTask.findMany({
        where: { projectId: project.id, preset: "intake" },
        orderBy: { brief: { revision: "asc" } },
        include: { stages: true },
      });
      const latest = turns.at(-1);
      if ((latest?.id ?? null) !== intake.previousTaskId)
        throw new ResearchError(
          "INTAKE_CHANGED",
          "需求对话已有新回复，请刷新后继续",
          409,
        );
      if (latest && !researchTerminal(latest.status))
        throw new ResearchError("INTAKE_ACTIVE", "Agent 正在回复，请稍候", 409);
      if (turns.length >= 40)
        throw new ResearchError(
          "INTAKE_LIMIT",
          "本轮需求讨论已达到上限，请确认计划或新建研究",
          409,
        );
      for (const turn of turns) {
        const meta = turn.configSnapshot as { intake?: { answer?: string } };
        if (meta.intake?.answer)
          intakeHistory.push({ role: "user", content: meta.intake.answer });
        const result = turn.stages[0]?.result as {
          reply?: string;
          suggestions?: unknown;
        } | null;
        if (turn.status === "completed" && result?.reply) {
          const suggestions = Array.isArray(result.suggestions)
            ? result.suggestions
                .filter((value): value is string => typeof value === "string")
                .slice(0, 4)
            : [];
          intakeHistory.push({
            role: "assistant",
            content:
              result.reply +
              (suggestions.length
                ? `\n\n可选回答（只是建议，尚未由用户确认）：\n${suggestions.map((value, index) => `${index + 1}. ${value}`).join("\n")}`
                : ""),
          });
        }
      }
      if (
        JSON.stringify([
          ...intakeHistory,
          { role: "user", content: intake.answer },
        ]).length > 60000
      )
        throw new ResearchError(
          "INTAKE_LIMIT",
          "需求讨论较长，请确认已有计划或新建研究",
          409,
        );
    }
    const attachmentIds = attachmentKeys.map((key) => key.slice(11));
    if (
      (await tx.researchAttachment.count({
        where: {
          id: { in: attachmentIds },
          projectId: project.id,
          purgedAt: null,
          expiresAt: { gt: new Date() },
        },
      })) !== new Set(attachmentIds).size
    )
      throw new ResearchError(
        "FILE_EXPIRED",
        "部分参考文件已过期，请重新上传",
        410,
      );
    const brief: ResearchBriefInput = {
      ...input.brief,
      attachmentKeys,
      sourceImageIds: [],
    };
    if (brief.selectedMessageIds.length) {
      const messages = await tx.conversationMessage.findMany({
        where: {
          id: { in: brief.selectedMessageIds },
          conversation: {
            userId,
            ...(project.conversationId ? { id: project.conversationId } : {}),
          },
        },
        orderBy: { createdAt: "asc" },
        select: { id: true, role: true, content: true, chatReferences: true },
      });
      if (messages.length !== new Set(brief.selectedMessageIds).size)
        throw new ResearchError(
          "INVALID_CONTEXT",
          "部分消息不存在或无权访问",
          403,
        );
      brief.selectedContext = messages
        .map((message) => `${message.role}: ${message.content}`)
        .join("\n\n")
        .slice(0, 24000);
    }
    if (input.sourceTaskId && !intake) {
      const source = await tx.researchTask.findFirst({
        where: {
          id: input.sourceTaskId,
          projectId: project.id,
          userId,
          stages: { some: { kind: "synthesize", status: "completed" } },
        },
        include: {
          brief: true,
          stages: { where: { kind: "synthesize", status: "completed" } },
        },
      });
      if (!source)
        throw new ResearchError(
          "INVALID_SOURCE_VERSION",
          "请选择已完成报告的研究版本",
          409,
        );
      if (source.expiresAt && source.expiresAt < new Date())
        throw new ResearchError(
          "SOURCE_EXPIRED",
          "研究版本中的文件已过期，请补充资料后再使用",
          410,
        );
      await researchVersionTaskIds(source, tx);
      const finalPackage = readFinalResearchPackage(
        (source.stages[0]?.result as { finalResearchPackage?: unknown } | null)
          ?.finalResearchPackage,
      );
      if (input.sourceMode !== "refresh" && !finalPackage)
        throw new ResearchError(
          "FINAL_PACKAGE_REQUIRED",
          "旧版研究尚无 V2 终稿包，请选择“整理旧版并制作”，原报告和证据会保留",
          409,
        );
      // Reuse the chosen version's brief, not edits to an unrelated current draft.
      Object.assign(brief, source.brief.content);
    }
    let intakeConfirmation:
      | {
          taskId: string | null;
          contractVersion: "intake-dialogue-v1" | "legacy-unverified";
          brief: unknown;
          confirmedRequirements: string[];
        }
      | undefined;
    if (!intake && !input.sourceTaskId) {
      const turns = await tx.researchTask.findMany({
        where: { projectId: project.id, userId, preset: "intake" },
        orderBy: { brief: { revision: "asc" } },
        include: { stages: true },
        take: 40,
      });
      const current = turns.at(-1);
      if (current) {
        // Starting is a distinct user action accepting a specific displayed
        // summary. An older tab cannot omit its receipt to bypass this gate.
        if (input.intakeTaskId !== current.id)
          throw new ResearchError(
            "INTAKE_CHANGED",
            "需求对话已有更新，请查看当前摘要后再开始研究",
            409,
          );
        const result = researchIntakeResultSchema.safeParse(
          current.stages[0]?.result,
        );
        if (
          current.status !== "completed" ||
          !result.success ||
          !result.data.ready
        )
          throw new ResearchError(
            "INTAKE_NOT_READY",
            "当前需求回复尚未完成，请先完成本轮对话或明确按现有信息整理",
            409,
          );
        const userMessages = turns.flatMap((turn) => {
          const answer = (
            turn.configSnapshot as { intake?: { answer?: string } }
          ).intake?.answer;
          return typeof answer === "string" ? [answer] : [];
        });
        const confirmed =
          result.data.contractVersion === INTAKE_DIALOGUE_VERSION
            ? confirmedIntakeRequirements(result.data, userMessages, brief)
            : [];
        if (confirmed === null)
          throw new ResearchError(
            "INTAKE_CHANGED",
            "执行内容与当前需求摘要不一致，请先在对话中修改并重新整理",
            409,
          );
        intakeConfirmation = {
          taskId: current.id,
          contractVersion:
            result.data.contractVersion === INTAKE_DIALOGUE_VERSION
              ? INTAKE_DIALOGUE_VERSION
              : "legacy-unverified",
          brief: researchIntakeResultSchema.shape.brief.parse(brief),
          confirmedRequirements: confirmed,
        };
      } else {
        if (input.intakeTaskId)
          throw new ResearchError(
            "INTAKE_CHANGED",
            "需求摘要不属于当前项目，请重新查看后开始",
            409,
          );
        // Legacy direct API drafts have no user-message provenance. Their
        // objective remains usable, but generated fields are not confirmations.
        intakeConfirmation = {
          taskId: null,
          contractVersion: "legacy-unverified",
          brief: researchIntakeResultSchema.shape.brief.parse(brief),
          confirmedRequirements: [],
        };
      }
    }
    const latest = await tx.researchBrief.aggregate({
      where: { projectId: project.id },
      _max: { revision: true },
    });
    const version = await tx.researchBrief.create({
      data: {
        projectId: project.id,
        revision: (latest._max.revision ?? 0) + 1,
        content: researchJson(brief),
      },
    });
    const task = await tx.researchTask.create({
      data: {
        projectId: project.id,
        briefId: version.id,
        userId,
        clientRequestId: input.clientRequestId,
        inputHash,
        sourceTaskId: intake ? undefined : input.sourceTaskId,
        preset: intake ? "intake" : plan.preset,
        scope: input.scope,
        modelId: input.modelId,
        reasoningEffort: input.reasoningEffort,
        plan: researchJson(plan),
        configSnapshot: researchJson({
          ...config,
          modelSnapshot: { baseUrl: profile.baseUrl, model: profile.model },
          ...(intakeConfirmation ? { intakeConfirmation } : {}),
          ...(input.sourceTaskId
            ? { sourceMode: input.sourceMode ?? "produce" }
            : {}),
          ...(intake
            ? {
                intake: {
                  ...intake,
                  history: intakeHistory,
                  settings: {
                    products: input.products,
                    preset: input.preset,
                    collectVisuals: input.collectVisuals,
                    verify: input.verify,
                  },
                },
              }
            : {}),
        }),
      },
    });
    for (const [ordinal, stage] of plan.stages.entries())
      await tx.researchStage.create({
        data: {
          taskId: task.id,
          kind: stage.kind,
          engine: stage.engine,
          ordinal,
        },
      });
    await tx.researchProject.update({
      where: { id: project.id },
      data: { updatedAt: new Date() },
    });
    await appendResearchEvent(tx, task.id, "task.queued", { plan });
    return task.id;
  });
  return researchTaskView(userId, id);
}
export async function cancelResearchTask(userId: string, taskId: string) {
  await db.$transaction(async (tx) => {
    await lockResearchTask(tx, taskId);
    const task = await tx.researchTask.findFirst({
      where: { id: taskId, userId },
    });
    if (!task) throw new ResearchError("NOT_FOUND", "研究任务不存在", 404);
    if (researchTerminal(task.status)) return;
    const expiresAt = researchExpiry(task.configSnapshot);
    await tx.researchAttempt.updateMany({
      where: { stage: { taskId }, status: { in: ["queued", "running"] } },
      data: { status: "cancelled", finishedAt: new Date() },
    });
    await tx.researchStage.updateMany({
      where: { taskId, status: { in: ["pending", "running"] } },
      data: { status: "cancelled" },
    });
    await tx.researchTask.update({
      where: { id: taskId },
      data: {
        status: "cancelled",
        finishedAt: new Date(),
        executionToken: null,
        expiresAt,
      },
    });
    await expireResearchAssets(tx, taskId, expiresAt);
    await appendResearchEvent(tx, taskId, "task.cancelled", {});
  });
  return researchTaskView(userId, taskId);
}
export async function retryResearchStage(
  userId: string,
  taskId: string,
  stageId: string,
  clientRequestId: string,
  options: { renewTime?: boolean } = {},
) {
  await db.$transaction(async (tx) => {
    await lockResearchFiles(tx);
    await lockResearchTask(tx, taskId);
    const task = await tx.researchTask.findFirst({
      where: { id: taskId, userId },
    });
    if (!task) throw new ResearchError("NOT_FOUND", "研究任务不存在", 404);
    if (task.expiresAt && task.expiresAt <= new Date())
      throw new ResearchError(
        "FILE_EXPIRED",
        "这个研究版本的资料已过期，请创建新版本",
        410,
      );
    const replay = await tx.researchAttempt.findUnique({
      where: { retryRequestId: clientRequestId },
      include: { stage: true },
    });
    if (replay) {
      if (replay.stage.taskId !== taskId || replay.stageId !== stageId)
        throw new ResearchError(
          "IDEMPOTENCY_CONFLICT",
          "重试编号已被使用",
          409,
        );
      return;
    }
    if (!researchTerminal(task.status) || task.status === "completed")
      throw new ResearchError("TASK_ACTIVE", "任务当前不能重试", 409);
    const stage = await tx.researchStage.findFirst({
      where: { id: stageId, taskId },
    });
    if (!stage || stage.status === "completed")
      throw new ResearchError("INVALID_STAGE", "请选择失败或中断的阶段", 409);
    if (
      await tx.researchStage.count({
        where: {
          taskId,
          ordinal: { lt: stage.ordinal },
          status: { not: "completed" },
        },
      })
    )
      throw new ResearchError("INVALID_STAGE", "请先重试前面未完成的阶段", 409);
    const plan = task.plan as unknown as ResearchPlan;
    const savedSynthesis = (
      stage.result as {
        synthesisCheckpoint?: { inputHash?: unknown };
      } | null
    )?.synthesisCheckpoint;
    if (stage.kind === "synthesize")
      assertSynthesisCheckpointVersion(savedSynthesis);
    const restoredSynthesis =
      typeof savedSynthesis?.inputHash === "string"
        ? restoreSynthesisCheckpoint(savedSynthesis, savedSynthesis.inputHash)
        : null;
    const canTrySavedPublication =
      stage.kind === "synthesize" &&
      !!restoredSynthesis?.report &&
      !!restoredSynthesis.metadata;
    // This only permits scheduling a saved publication. The worker recomputes
    // the full identity and refuses changed inputs without replacing the record.
    if (task.llmCalls >= plan.limits.llm && !canTrySavedPublication)
      throw new ResearchError(
        "BUDGET_EXHAUSTED",
        "本任务的模型调用次数已用完，已有记录保留；如需更多调用，请重新发起研究",
        409,
      );
    if (!options.renewTime && task.deadlineAt && task.deadlineAt <= new Date())
      throw new ResearchError(
        "BUDGET_EXHAUSTED",
        "本次执行时间已用完，可选择继续研究，保留资料和剩余调用次数",
        409,
      );
    const deadlineAt = options.renewTime
      ? new Date(Date.now() + plan.limits.minutes * 60000)
      : task.deadlineAt;
    const count = await tx.researchAttempt.count({ where: { stageId } });
    const attempt = await tx.researchAttempt.create({
      data: { stageId, ordinal: count + 1, retryRequestId: clientRequestId },
    });
    await tx.researchStage.update({
      where: { id: stageId },
      data: {
        status: "pending",
        activeAttemptId: attempt.id,
        text: "",
        // Only completed, version-bound sub-results are eligible for reuse;
        // the worker validates these checkpoints against the current input.
        ...(stage.kind === "synthesize"
          ? {
              result: researchJson(
                Object.fromEntries(
                  Object.entries(
                    stage.result &&
                      typeof stage.result === "object" &&
                      !Array.isArray(stage.result)
                      ? stage.result
                      : {},
                  ).filter(([key]) => key !== "synthesisPhase"),
                ),
              ),
            }
          : stage.kind === "verify"
            ? {}
            : { result: Prisma.DbNull }),
      },
    });
    await tx.researchStage.updateMany({
      where: {
        taskId,
        ordinal: { gt: stage.ordinal },
        status: { not: "completed" },
      },
      data: { status: "pending" },
    });
    await tx.researchTask.update({
      where: { id: taskId },
      data: {
        status: "queued",
        executionToken: null,
        finishedAt: null,
        expiresAt: null,
        error: Prisma.DbNull,
        deadlineAt,
      },
    });
    await appendResearchEvent(tx, taskId, "stage.retry_queued", {
      stageId,
      attemptId: attempt.id,
      renewedTime: !!options.renewTime,
      previousDeadlineAt: task.deadlineAt?.toISOString() ?? null,
      deadlineAt: deadlineAt?.toISOString() ?? null,
      remainingLlmCalls: plan.limits.llm - task.llmCalls,
    });
  });
  return researchTaskView(userId, taskId);
}

