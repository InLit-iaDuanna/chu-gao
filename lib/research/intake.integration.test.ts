import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { createResearchIntakeTurn, researchIntakeView } from "./intake";
import { createResearchProject, createResearchTask } from "./service";
import {
  parseIntakeDialogue,
  readIntakeConfirmationRequirements,
} from "./intake-contract";
import {
  researchBriefSchema,
  researchIntakeInputSchema,
  researchPlanInputSchema,
} from "./types";

vi.mock("@/lib/chat-profiles", () => ({
  getChatProfile: vi.fn(async () => ({
    enabled: true,
    apiKey: "[REDACTED]",
    model: "synthetic-sol",
    baseUrl: "https://unused.invalid",
    transport: "responses_sse",
  })),
}));
const enabled =
  process.env.RESEARCH_INTEGRATION_TEST === "1" &&
  /^\/chugao_research_it_[a-f0-9]+$/.test(
    new URL(process.env.DATABASE_URL || "postgresql://localhost/disabled")
      .pathname,
  );

describe.skipIf(!enabled)(
  "intake acceptance receipts (scratch PostgreSQL; no model or network)",
  () => {
    let userId: string;
    beforeAll(async () => {
      userId = (
        await db.user.create({
          data: {
            email: `${randomUUID()}@intake.invalid`,
            passwordHash: "synthetic-unused",
            role: "ADMIN",
            credits: 123.4,
          },
        })
      ).id;
    });
    afterAll(async () => {
      try {
        if (userId)
          await db.$transaction(async (tx) => {
            const projects = await tx.researchProject.findMany({
              where: { userId },
              select: { id: true },
            });
            const projectIds = projects.map((project) => project.id);
            const taskWhere = { projectId: { in: projectIds } };
            // Research relations do not cascade. Delete only this suite's
            // project subtree, in foreign-key order, before its isolated user.
            await tx.researchCall.deleteMany({ where: { task: taskWhere } });
            await tx.researchAttempt.deleteMany({
              where: { stage: { task: taskWhere } },
            });
            await tx.researchEvent.deleteMany({ where: { task: taskWhere } });
            await tx.researchEvidence.deleteMany({ where: taskWhere });
            await tx.researchArtifact.deleteMany({ where: taskWhere });
            await tx.researchStage.deleteMany({ where: { task: taskWhere } });
            await tx.researchTask.deleteMany({ where: taskWhere });
            await tx.researchBrief.deleteMany({ where: taskWhere });
            await tx.researchAttachment.deleteMany({ where: taskWhere });
            await tx.researchProject.deleteMany({
              where: { id: { in: projectIds }, userId },
            });
            await tx.user.delete({ where: { id: userId } });
          });
      } finally {
        await db.$disconnect();
      }
    });
    const brief = researchBriefSchema.parse({
      question: "办公室轻食机的清洗流程研究",
      market: "中国",
      audience: "办公室使用者",
    });
    const userStatement = "研究中国办公室轻食机的清洗流程。";
    const output = (market = "中国", statement = userStatement) =>
      parseIntakeDialogue(
        JSON.stringify({
          acknowledgement: "已经理解。",
          nextQuestion: null,
          ready: true,
          summary: `研究${market}办公室轻食机的清洗流程，预算保持未知。`,
          unknowns: ["预算未知"],
          confirmedRequirements: [statement],
          products: ["report"],
          brief: {
            question: brief.question,
            market,
            audience: brief.audience,
            timeRange: "",
            constraints: "",
            competitors: [],
            links: [],
          },
        }),
        [statement],
      );
    const finish = async (id: string, result: unknown) =>
      db.$transaction(async (tx) => {
        await tx.researchStage.updateMany({
          where: { taskId: id },
          data: {
            status: "completed",
            result: JSON.parse(JSON.stringify(result)),
          },
        });
        await tx.researchTask.update({
          where: { id },
          data: { status: "completed" },
        });
      });
    const input = (projectId: string, overrides = {}) => ({
      ...researchPlanInputSchema.parse({
        brief,
        products: ["report"],
        collectVisuals: false,
      }),
      projectId,
      clientRequestId: randomUUID(),
      ...overrides,
    });

    it("accepts one-word thin messages, persists each receipt once, and rejects a changed replay", async () => {
      const project = await createResearchProject(
        userId,
        "Thin intake fixture",
      );
      const request = researchIntakeInputSchema.parse({
        projectId: project.id,
        clientRequestId: randomUUID(),
        answer: "茶",
      });
      const [first, replay] = await Promise.all([
        createResearchIntakeTurn(userId, request),
        createResearchIntakeTurn(userId, request),
      ]);
      expect(first.id).toBe(replay.id);
      expect(
        await db.researchTask.count({ where: { projectId: project.id } }),
      ).toBe(1);
      const view = await researchIntakeView(userId, project.id);
      expect(view.messages.map((message) => message.content)).toEqual(["茶"]);
      expect(view.result).toBeNull();
      expect(view.task?.plan.limits).toEqual({
        llm: 3,
        search: 0,
        crawl: 0,
        minutes: 4,
      });
      await expect(
        createResearchIntakeTurn(userId, { ...request, answer: "咖啡" }),
      ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
      await expect(
        createResearchIntakeTurn(userId, {
          ...request,
          clientRequestId: randomUUID(),
        }),
      ).rejects.toMatchObject({ code: "INTAKE_CHANGED" });
    });

    it("requires the current displayed receipt, binds the exact brief, and freezes confirmation before later corrections", async () => {
      const project = await createResearchProject(
        userId,
        "Accepted summary fixture",
      );
      const first = await createResearchTask(userId, input(project.id), {
        answer: userStatement,
        previousTaskId: null,
      });
      await finish(first.id, output());
      const view = await researchIntakeView(userId, project.id);
      expect(view.resultTaskId).toBe(first.id);
      await expect(
        createResearchTask(userId, input(project.id)),
      ).rejects.toMatchObject({ code: "INTAKE_CHANGED" });
      await expect(
        createResearchTask(
          userId,
          input(project.id, { intakeTaskId: "wrong-summary" }),
        ),
      ).rejects.toMatchObject({ code: "INTAKE_CHANGED" });
      await expect(
        createResearchTask(
          userId,
          input(project.id, {
            intakeTaskId: first.id,
            brief: { ...brief, market: "英国" },
          }),
        ),
      ).rejects.toMatchObject({ code: "INTAKE_CHANGED" });
      const acceptedInput = input(project.id, { intakeTaskId: first.id });
      const accepted = await createResearchTask(userId, acceptedInput);
      const persisted = await db.researchTask.findUniqueOrThrow({
        where: { id: accepted.id },
      });
      const snapshot = (
        persisted.configSnapshot as { intakeConfirmation: unknown }
      ).intakeConfirmation;
      expect(readIntakeConfirmationRequirements(snapshot, brief)).toEqual([
        userStatement,
      ]);
      const correction = "地区改为英国，不要保留中国市场要求。";
      const next = await createResearchTask(userId, input(project.id), {
        answer: correction,
        previousTaskId: first.id,
      });
      // Timestamp equality must not change the persisted causal order. Brief
      // revisions are allocated under the same User lock and are project-unique.
      await db.researchTask.updateMany({
        where: { id: { in: [first.id, next.id] } },
        data: { createdAt: new Date("2026-10-01T12:00:00.000Z") },
      });
      const sameTimeView = await researchIntakeView(userId, project.id);
      expect(sameTimeView.task?.id).toBe(next.id);
      expect(sameTimeView.result).toBeNull();
      expect(sameTimeView.messages.map((message) => message.id)).toEqual([
        `${first.id}-user`,
        first.id,
        `${next.id}-user`,
      ]);
      await expect(
        createResearchTask(userId, input(project.id), {
          answer: "此回答引用了旧轮次。",
          previousTaskId: first.id,
        }),
      ).rejects.toMatchObject({ code: "INTAKE_CHANGED" });
      await expect(
        createResearchTask(
          userId,
          input(project.id, { intakeTaskId: first.id }),
        ),
      ).rejects.toMatchObject({ code: "INTAKE_CHANGED" });
      await expect(
        createResearchTask(
          userId,
          input(project.id, { intakeTaskId: next.id }),
        ),
      ).rejects.toMatchObject({ code: "INTAKE_NOT_READY" });
      expect((await createResearchTask(userId, acceptedInput)).id).toBe(
        accepted.id,
      );
      await finish(next.id, output("英国", correction));
      const changedBrief = { ...brief, market: "英国" };
      const changed = await createResearchTask(
        userId,
        input(project.id, { intakeTaskId: next.id, brief: changedBrief }),
      );
      const changedRow = await db.researchTask.findUniqueOrThrow({
        where: { id: changed.id },
      });
      expect(
        readIntakeConfirmationRequirements(
          (changedRow.configSnapshot as { intakeConfirmation: unknown })
            .intakeConfirmation,
          changedBrief,
        ),
      ).toEqual([correction]);
      const originalAgain = await db.researchTask.findUniqueOrThrow({
        where: { id: accepted.id },
      });
      expect(
        (originalAgain.configSnapshot as { intakeConfirmation: unknown })
          .intakeConfirmation,
      ).toEqual(snapshot);
    });

    it("never falls back to an older ready summary after a failed or incomplete correction", async () => {
      const project = await createResearchProject(
        userId,
        "Failed correction fixture",
      );
      const first = await createResearchTask(userId, input(project.id), {
        answer: userStatement,
        previousTaskId: null,
      });
      await finish(first.id, output());
      const correction = await createResearchTask(userId, input(project.id), {
        answer: "改成家用场景，先不要开始。",
        previousTaskId: first.id,
      });
      await db.researchTask.update({
        where: { id: correction.id },
        data: { status: "failed" },
      });
      const view = await researchIntakeView(userId, project.id);
      expect(view.result).toBeNull();
      expect(view.resultTaskId).toBeNull();
      expect(view.messages.at(-1)?.content).toBe("改成家用场景，先不要开始。");
      await expect(
        createResearchTask(
          userId,
          input(project.id, { intakeTaskId: correction.id }),
        ),
      ).rejects.toMatchObject({ code: "INTAKE_NOT_READY" });
    });

    it("rejects an invented confirmed requirement even in a completed, well-shaped result", async () => {
      const project = await createResearchProject(
        userId,
        "Invalid confirmation fixture",
      );
      const first = await createResearchTask(userId, input(project.id), {
        answer: userStatement,
        previousTaskId: null,
      });
      await finish(first.id, {
        ...output(),
        confirmedRequirements: ["预算必须 299 元。"],
      });
      await expect(
        createResearchTask(
          userId,
          input(project.id, { intakeTaskId: first.id }),
        ),
      ).rejects.toMatchObject({ code: "INTAKE_CHANGED" });
    });

    it("keeps direct legacy API use available without inventing user-confirmed constraints", async () => {
      const project = await createResearchProject(
        userId,
        "Legacy direct fixture",
      );
      const created = await createResearchTask(userId, input(project.id));
      const row = await db.researchTask.findUniqueOrThrow({
        where: { id: created.id },
      });
      expect(
        readIntakeConfirmationRequirements(
          (row.configSnapshot as { intakeConfirmation: unknown })
            .intakeConfirmation,
          brief,
        ),
      ).toEqual([]);
      expect(
        (await db.user.findUniqueOrThrow({ where: { id: userId } })).credits,
      ).toBe(123.4);
    });
  },
);

