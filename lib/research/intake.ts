import { db } from "@/lib/db";
import { createHash } from "node:crypto";
import { ResearchError } from "./errors";
import { researchModelCall } from "./gateway";
import { responseText } from "./model-protocol";
import {
  createResearchTask,
  readResearchTaskView,
  researchTaskView,
} from "./service";
import {
  researchBriefSchema,
  researchPlanInputSchema,
  researchIntakeResultSchema,
  type ResearchBriefInput,
  type ResearchIntakeInput,
  type ResearchIntakeView,
} from "./types";
import { Prisma, type ResearchTask } from "@prisma/client";
import {
  INTAKE_DIALOGUE_INSTRUCTIONS,
  parseIntakeDialogue,
} from "./intake-contract";

export async function createResearchIntakeTurn(
  userId: string,
  request: ResearchIntakeInput,
) {
  const requestHash = createHash("sha256")
    .update(JSON.stringify(request))
    .digest("hex");
  const existing = await db.researchTask.findUnique({
    where: {
      userId_clientRequestId: {
        userId,
        clientRequestId: request.clientRequestId,
      },
    },
  });
  if (existing) {
    const receipt = (
      existing.configSnapshot as { intake?: { requestHash?: string } }
    ).intake?.requestHash;
    if (receipt) {
      if (receipt !== requestHash || existing.preset !== "intake")
        throw new ResearchError(
          "IDEMPOTENCY_CONFLICT",
          "同一个提交编号不能用于不同内容",
          409,
        );
      return researchTaskView(userId, existing.id);
    }
    // Preserve replay of full requests created before the thin request contract.
    const legacy = researchPlanInputSchema.safeParse(request);
    if (!legacy.success || request.intent !== "continue")
      throw new ResearchError(
        "IDEMPOTENCY_CONFLICT",
        "请使用原提交内容重试，或刷新需求对话",
        409,
      );
    return createResearchTask(
      userId,
      {
        ...legacy.data,
        projectId: request.projectId,
        clientRequestId: request.clientRequestId,
      },
      { answer: request.answer, previousTaskId: request.previousTaskId },
    );
  }
  const view = await researchIntakeView(userId, request.projectId);
  const {
    answer,
    previousTaskId,
    intent,
    projectId,
    clientRequestId,
    brief: suppliedBrief,
    ...settings
  } = request;
  const question =
    suppliedBrief?.question.trim() ||
    view.result?.brief.question ||
    view.task?.brief.question ||
    answer;
  const brief = researchBriefSchema.parse({
    ...view.task?.brief,
    ...view.result?.brief,
    ...suppliedBrief,
    question: question.length >= 2 ? question : `用户研究想法：${question}`,
  });
  const input = researchPlanInputSchema.parse({
    ...view.settings,
    ...(view.result ? { products: view.result.products } : {}),
    ...settings,
    brief,
  });
  return createResearchTask(
    userId,
    { ...input, projectId, clientRequestId },
    { answer, previousTaskId, intent, requestHash },
  );
}

export async function researchIntakeView(
  userId: string,
  projectId: string,
): Promise<ResearchIntakeView> {
  return db.$transaction((tx) => readIntakeView(tx, userId, projectId), {
    isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
  });
}

async function readIntakeView(
  db: Prisma.TransactionClient,
  userId: string,
  projectId: string,
): Promise<ResearchIntakeView> {
  const project = await db.researchProject.findFirst({
    where: { id: projectId, userId, archivedAt: null },
  });
  if (!project) throw new ResearchError("NOT_FOUND", "研究项目不存在", 404);
  const turns = await db.researchTask.findMany({
    where: { projectId, userId, preset: "intake" },
    orderBy: { brief: { revision: "asc" } },
    include: { stages: true },
    take: 40,
  });
  const messages: ResearchIntakeView["messages"] = [];
  const latest = turns.at(-1);
  let result: ResearchIntakeView["result"] = null;
  for (const turn of turns) {
    const intake = (turn.configSnapshot as { intake?: { answer?: string } })
      .intake;
    if (intake?.answer)
      messages.push({
        id: `${turn.id}-user`,
        role: "user",
        content: intake.answer,
      });
    const parsed = researchIntakeResultSchema.safeParse(turn.stages[0]?.result);
    if (turn.status === "completed" && parsed.success) {
      if (turn.id === latest?.id) result = parsed.data;
      messages.push({
        id: turn.id,
        role: "assistant",
        content: parsed.data.reply,
      });
    }
  }
  const options = (
    latest?.configSnapshot as
      | { intake?: { settings?: ResearchIntakeView["settings"] } }
      | undefined
  )?.intake?.settings;
  const storedProducts = researchIntakeResultSchema.shape.products.safeParse(
    options?.products,
  );
  return {
    task: latest ? await readResearchTaskView(db, userId, latest.id) : null,
    messages,
    result,
    resultTaskId: result && latest ? latest.id : null,
    latestClientRequestId: latest?.clientRequestId ?? null,
    settings: latest
      ? {
          preset: options?.preset ?? "auto",
          scope: latest.scope as NonNullable<
            ResearchIntakeView["settings"]
          >["scope"],
          modelId: latest.modelId,
          reasoningEffort: latest.reasoningEffort as NonNullable<
            ResearchIntakeView["settings"]
          >["reasoningEffort"],
          collectVisuals: options?.collectVisuals ?? true,
          verify: options?.verify ?? true,
          ...(storedProducts.success ? { products: storedProducts.data } : {}),
        }
      : null,
  };
}

export async function runResearchIntake(
  task: ResearchTask,
  attemptId: string,
  brief: ResearchBriefInput,
  signal: AbortSignal,
) {
  const intake = (
    task.configSnapshot as {
      intake: {
        answer: string;
        intent?: "continue" | "prepare_research";
        history: Array<{ role: string; content: string }>;
        settings: unknown;
      };
    }
  ).intake;
  if (!intake)
    throw new ResearchError("INVALID_INTAKE", "需求对话记录不存在", 409);
  const history = Array.isArray(intake.history) ? intake.history : [];
  if (
    history.some(
      (message) =>
        !["user", "assistant"].includes(message.role) ||
        typeof message.content !== "string",
    ) ||
    JSON.stringify(history).length > 60000
  )
    throw new ResearchError(
      "INVALID_INTAKE",
      "需求对话历史不完整，请刷新后重试",
      409,
    );
  const intent = intake.intent ?? "continue";
  const response = await researchModelCall(
    attemptId,
    {
      messages: [
        { role: "system", content: INTAKE_DIALOGUE_INSTRUCTIONS },
        {
          role: "system",
          content: `以下是应用草稿与默认设置，用于保持连续性，不能当作用户确认或覆盖用户纠正：${JSON.stringify({ brief, settings: { scope: task.scope, ...(intake.settings as object) } })}\n本轮用户操作：${intent === "prepare_research" ? "用户明确要求先按现有信息整理并准备研究，必须 ready=true，未知保留，不再追问。" : "自然语言回答；是否充分、是否先开始由你结合真实用户对话判断。"}`,
        },
        ...history,
        { role: "user", content: intake.answer },
      ],
      max_tokens: 4500,
    },
    () => {},
    signal,
    { purpose: "research.intake.dialogue" },
  );
  return parseIntakeDialogue(
    responseText(response),
    [
      ...history
        .filter((message) => message.role === "user")
        .map((message) => message.content),
      intake.answer,
    ],
    intent,
  );
}
