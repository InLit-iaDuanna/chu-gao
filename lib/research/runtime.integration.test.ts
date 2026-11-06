import { beforeAll, afterAll, describe, it, expect, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import {
  createResearchTask,
  createResearchProject,
  retryResearchStage,
  cancelResearchTask,
  researchEvent,
  researchTaskView,
} from "./service";
import { claimResearchTask } from "./worker";
import {
  reserveResearchCall,
  activeResearchAttempt,
  finishResearchCall,
} from "./budget";
import { researchPlanInputSchema } from "./types";
import { researchIntakeView } from "./intake";
import { researchFilesProtected } from "./lifecycle";
import { saveResearchArtifact } from "./artifacts";
import { removeResearchFile } from "./storage";

vi.mock("@/lib/chat-profiles", () => ({
  getChatProfile: vi.fn(async () => ({
    enabled: true,
    apiKey: "[REDACTED]",
    model: "gpt-6.1-sol",
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
  "durable research runtime (scratch PostgreSQL, no upstream)",
  () => {
    let userId: string;
    let taskId: string;
    let projectId: string;
    beforeAll(async () => {
      const user = await db.user.create({
        data: {
          email: `${randomUUID()}@research.invalid`,
          passwordHash: "synthetic-unused",
          role: "ADMIN",
          credits: 123.4,
        },
      });
      userId = user.id;
      projectId = (await createResearchProject(userId, "Synthetic research"))
        .id;
    });
    afterAll(async () => {
      try {
        if (userId)
          await db.$transaction(async (tx) => {
            // An assertion can fail before a test reaches cancellation. Remove
            // only this suite's projects, including terminal rows, so neither
            // global lane counts nor another suite's fresh-DB assertions drift.
            // ResearchProject/User and the research child rows do not cascade.
            const projects = await tx.researchProject.findMany({
              where: { userId },
              select: { id: true },
            });
            const projectIds = projects.map((project) => project.id);
            const task = { projectId: { in: projectIds } };
            await tx.researchCall.deleteMany({ where: { task } });
            await tx.researchAttempt.deleteMany({
              where: { stage: { task } },
            });
            await tx.researchEvent.deleteMany({ where: { task } });
            await tx.researchEvidence.deleteMany({
              where: { projectId: { in: projectIds } },
            });
            await tx.researchArtifact.deleteMany({
              where: { projectId: { in: projectIds } },
            });
            await tx.researchStage.deleteMany({ where: { task } });
            await tx.researchTask.deleteMany({ where: task });
            await tx.researchBrief.deleteMany({
              where: { projectId: { in: projectIds } },
            });
            await tx.researchAttachment.deleteMany({
              where: { projectId: { in: projectIds } },
            });
            await tx.researchProject.deleteMany({ where: { userId } });
            await tx.user.delete({ where: { id: userId } });
          });
      } finally {
        await db.$disconnect();
      }
    });
    it("concurrent identical submissions create exactly one task and brief", async () => {
      const input = {
        ...researchPlanInputSchema.parse({
          brief: { question: "Synthetic comparison" },
          preset: "proposal",
          products: ["pptx"],
        }),
        projectId,
        clientRequestId: randomUUID(),
      };
      const results = await Promise.all([
        createResearchTask(userId, input),
        createResearchTask(userId, input),
      ]);
      expect(results[0].id).toBe(results[1].id);
      taskId = results[0].id;
      expect(await db.researchTask.count()).toBe(1);
      expect(await db.researchBrief.count()).toBe(1);
      expect(
        (await db.user.findUniqueOrThrow({ where: { id: userId } })).credits,
      ).toBe(123.4);
    });
    it("only one dispatcher claims work and events replay in sequence", async () => {
      const claims = await Promise.all([
        claimResearchTask(),
        claimResearchTask(),
      ]);
      expect(claims.filter(Boolean)).toHaveLength(1);
      const task = claims.find(Boolean)!;
      await Promise.all(
        Array.from({ length: 8 }, (_, index) =>
          researchEvent(
            taskId,
            "test.progress",
            { index },
            task.executionToken!,
          ),
        ),
      );
      const events = await db.researchEvent.findMany({
        where: { taskId, seq: { gt: 1 } },
        orderBy: { seq: "asc" },
      });
      expect(events.map((event) => event.seq)).toEqual([
        2, 3, 4, 5, 6, 7, 8, 9,
      ]);
      const after = await db.researchEvent.findMany({
        where: { taskId, seq: { gt: 5 } },
        orderBy: { seq: "asc" },
      });
      expect(after.map((event) => event.seq)).toEqual([6, 7, 8, 9]);
    });
    it("retries production without re-running completed research or changing evidence", async () => {
      const stages = await db.researchStage.findMany({
        where: { taskId },
        orderBy: { ordinal: "asc" },
      });
      const production = stages.find((stage) => stage.kind === "produce")!;
      await db.researchStage.updateMany({
        where: { taskId, id: { not: production.id } },
        data: { status: "completed", text: "saved research" },
      });
      await db.researchStage.update({
        where: { id: production.id },
        data: { status: "failed" },
      });
      await db.researchTask.update({
        where: { id: taskId },
        data: { status: "failed", executionToken: null },
      });
      const evidence = await db.researchEvidence.create({
        data: {
          projectId,
          taskId,
          sourceKey: "immutable",
          canonicalUrl: "https://example.com/",
          originalUrl: "https://example.com/",
          title: "Original evidence",
        },
      });
      const retryId = randomUUID();
      await retryResearchStage(userId, taskId, production.id, retryId);
      await retryResearchStage(userId, taskId, production.id, retryId);
      expect(
        await db.researchAttempt.count({ where: { retryRequestId: retryId } }),
      ).toBe(1);
      const updated = await db.researchStage.findMany({ where: { taskId } });
      expect(
        updated
          .filter((stage) => stage.id !== production.id)
          .every(
            (stage) =>
              stage.status === "completed" && stage.text === "saved research",
          ),
      ).toBe(true);
      expect(
        (
          await db.researchEvidence.findUniqueOrThrow({
            where: { id: evidence.id },
          })
        ).sourceKey,
      ).toBe("immutable");
    });
    it("enforces model concurrency and fences a cancelled attempt without charging", async () => {
      const task = await claimResearchTask();
      expect(task).not.toBeNull();
      const stage = await db.researchStage.findFirstOrThrow({
        where: { taskId, kind: "produce" },
      });
      const attemptId = stage.activeAttemptId!;
      await db.researchStage.update({
        where: { id: stage.id },
        data: { status: "running" },
      });
      await db.researchAttempt.update({
        where: { id: attemptId },
        data: { status: "running" },
      });
      await Promise.all([
        reserveResearchCall(attemptId, "llm", { n: 1 }),
        reserveResearchCall(attemptId, "llm", { n: 2 }),
      ]);
      await expect(
        reserveResearchCall(attemptId, "llm", { n: 3 }),
      ).rejects.toMatchObject({ code: "CAPACITY_BUSY" });
      await cancelResearchTask(userId, taskId);
      await expect(activeResearchAttempt(attemptId)).rejects.toMatchObject({
        code: "TASK_STOPPED",
      });
      expect(
        (await db.user.findUniqueOrThrow({ where: { id: userId } })).credits,
      ).toBe(123.4);
      expect(await db.creditEntry.count()).toBe(0);
      expect(await db.usageLog.count()).toBe(0);
    });
    it("persists each intake answer once and rejects stale or concurrent replies", async () => {
      const project = await createResearchProject(userId, "Synthetic intake");
      const input = {
        ...researchPlanInputSchema.parse({
          brief: { question: "研究一款无糖茶的包装" },
          reasoningEffort: "medium",
        }),
        projectId: project.id,
        clientRequestId: randomUUID(),
      };
      const intake = {
        answer: "面向城市通勤人群，主要在便利店销售",
        previousTaskId: null,
      };
      const [first, replay] = await Promise.all([
        createResearchTask(userId, input, intake),
        createResearchTask(userId, input, intake),
      ]);
      expect(first.id).toBe(replay.id);
      expect(first.preset).toBe("intake");
      // The attached intake-dialogue-v1 contract already capped a turn at
      // three calls (answer + bounded structural repair), not one. No search
      // or crawl is authorized by answering a clarification question.
      expect(first.plan.limits).toMatchObject({ llm: 3, search: 0, crawl: 0 });
      await expect(
        createResearchTask(
          userId,
          { ...input, clientRequestId: randomUUID() },
          intake,
        ),
      ).rejects.toMatchObject({ code: "INTAKE_CHANGED" });
      await expect(
        createResearchTask(
          userId,
          { ...input, clientRequestId: randomUUID() },
          { ...intake, previousTaskId: first.id },
        ),
      ).rejects.toMatchObject({ code: "INTAKE_ACTIVE" });
      await db.researchStage.update({
        where: { id: first.stages[0].id },
        data: {
          status: "completed",
          result: {
            reply: "你更关注哪种包装方向？",
            suggestions: ["日常通勤", "礼赠"],
            ready: false,
            summary: "城市通勤人群，便利店渠道的无糖茶包装研究",
            products: ["report", "brief"],
            brief: {
              question: input.brief.question,
              market: "中国",
              audience: "城市通勤人群",
              timeRange: "",
              constraints: "便利店渠道",
              competitors: [],
              links: [],
            },
          },
        },
      });
      await db.researchTask.update({
        where: { id: first.id },
        data: { status: "completed" },
      });
      const restored = await researchIntakeView(userId, project.id);
      expect(restored.messages.map((message) => message.role)).toEqual([
        "user",
        "assistant",
      ]);
      expect(restored.result?.brief.audience).toBe("城市通勤人群");
      const second = await createResearchTask(
        userId,
        {
          ...input,
          brief: { ...input.brief, ...restored.result!.brief },
          clientRequestId: randomUUID(),
        },
        { answer: "日常通勤，先按这些生成计划", previousTaskId: first.id },
      );
      const stored = await db.researchTask.findUniqueOrThrow({
        where: { id: second.id },
      });
      const history = (
        stored.configSnapshot as {
          intake: { history: Array<{ role: string; content: string }> };
        }
      ).intake.history;
      expect(history).toHaveLength(2);
      expect(history[0]).toEqual({ role: "user", content: intake.answer });
      expect(history[1]).toEqual({
        role: "assistant",
        content:
          "你更关注哪种包装方向？\n\n可选回答（只是建议，尚未由用户确认）：\n1. 日常通勤\n2. 礼赠",
      });
      // Relative answers such as “后一个” can now be interpreted by the next
      // model turn. The unselected suggestions remain assistant context.
      expect(history.filter((row) => row.role === "user")).toHaveLength(1);
      await expect(
        researchIntakeView("another-user", project.id),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      await cancelResearchTask(userId, second.id);
      expect(
        (await db.user.findUniqueOrThrow({ where: { id: userId } })).credits,
      ).toBe(123.4);
    });
    it("explicit continuation renews only time, retains budgets and evidence, and replays once", async () => {
      const project = await createResearchProject(
        userId,
        "Synthetic continuation",
      );
      const task = await createResearchTask(userId, {
        ...researchPlanInputSchema.parse({
          brief: { question: "Synthetic interrupted research" },
          preset: "research",
        }),
        projectId: project.id,
        clientRequestId: randomUUID(),
      });
      const stage = task.stages[0];
      const expired = new Date(Date.now() - 60000);
      await db.researchTask.update({
        where: { id: task.id },
        data: {
          status: "failed",
          deadlineAt: expired,
          llmCalls: 4,
          searchCalls: 2,
          crawlCalls: 3,
        },
      });
      const checkpoint = {
        checkpoint: "verification",
        questions: ["saved question"],
        searched: ["saved question"],
        unresolved: ["saved question"],
      };
      await db.researchStage.update({
        where: { id: stage.id },
        data: { status: "failed", kind: "verify", result: checkpoint },
      });
      const evidence = await db.researchEvidence.create({
        data: {
          projectId: project.id,
          taskId: task.id,
          sourceKey: "saved-source",
          canonicalUrl: "https://example.com/saved",
          originalUrl: "https://example.com/saved",
          title: "Saved source",
        },
      });
      await expect(
        retryResearchStage(userId, task.id, stage.id, randomUUID()),
      ).rejects.toMatchObject({ code: "BUDGET_EXHAUSTED" });
      const retryId = randomUUID();
      const before = Date.now();
      await retryResearchStage(userId, task.id, stage.id, retryId, {
        renewTime: true,
      });
      const resumed = await db.researchTask.findUniqueOrThrow({
        where: { id: task.id },
      });
      expect(resumed).toMatchObject({
        status: "queued",
        llmCalls: 4,
        searchCalls: 2,
        crawlCalls: 3,
      });
      expect(
        (await db.researchStage.findUniqueOrThrow({ where: { id: stage.id } }))
          .result,
      ).toEqual(checkpoint);
      expect(resumed.deadlineAt!.getTime()).toBeGreaterThanOrEqual(
        before + task.plan.limits.minutes * 60000,
      );
      expect(resumed.deadlineAt!.getTime()).toBeLessThanOrEqual(
        Date.now() + task.plan.limits.minutes * 60000,
      );
      await retryResearchStage(userId, task.id, stage.id, retryId, {
        renewTime: true,
      });
      expect(
        (await db.researchTask.findUniqueOrThrow({ where: { id: task.id } }))
          .deadlineAt,
      ).toEqual(resumed.deadlineAt);
      expect(
        await db.researchAttempt.count({ where: { retryRequestId: retryId } }),
      ).toBe(1);
      expect(
        (
          await db.researchEvidence.findUniqueOrThrow({
            where: { id: evidence.id },
          })
        ).taskId,
      ).toBe(task.id);
      await cancelResearchTask(userId, task.id);
      await db.researchTask.update({
        where: { id: task.id },
        data: { llmCalls: task.plan.limits.llm },
      });
      await expect(
        retryResearchStage(userId, task.id, stage.id, randomUUID(), {
          renewTime: true,
        }),
      ).rejects.toMatchObject({ code: "BUDGET_EXHAUSTED" });
      expect(
        (await db.user.findUniqueOrThrow({ where: { id: userId } })).credits,
      ).toBe(123.4);
    });
    it.each([
      { kind: "crawl" as const, limit: 1 },
      { kind: "llm" as const, limit: 2 },
    ])(
      "reserves the last global $kind slot once across different tasks and releases it on completion",
      async ({ kind, limit }) => {
        // Keep these fixtures after the original empty-database assertions.
        const tasks: Array<{ id: string; attemptId: string }> = [];
        type Reservation = Awaited<ReturnType<typeof reserveResearchCall>>;
        let pending:
          | Promise<Array<PromiseSettledResult<Reservation>>>
          | undefined;
        try {
          for (let index = 0; index < 2; index++) {
            const project = await createResearchProject(
              userId,
              `Synthetic ${kind} capacity ${index}`,
            );
            const task = await createResearchTask(userId, {
              ...researchPlanInputSchema.parse({
                brief: { question: "Synthetic parallel research" },
                preset: "research",
              }),
              projectId: project.id,
              clientRequestId: randomUUID(),
            });
            const stage = task.stages[0];
            const attempt = await db.researchAttempt.create({
              data: { stageId: stage.id, ordinal: 1, status: "running" },
            });
            tasks.push({ id: task.id, attemptId: attempt.id });
            await db.researchStage.update({
              where: { id: stage.id },
              data: { activeAttemptId: attempt.id, status: "running" },
            });
            await db.researchTask.update({
              where: { id: task.id },
              data: {
                status: "running",
                deadlineAt: new Date(Date.now() + 60000),
              },
            });
          }
          if (limit === 2)
            await reserveResearchCall(tasks[0].attemptId, kind, {
              seed: true,
            });

          // A real PostgreSQL write barrier lets both contenders start before
          // either can commit. Without global exclusion, both read the same
          // free slot and then insert after the barrier opens. With exclusion,
          // one waits on the insert and the other on the capacity lock.
          await db.$transaction(async (gate) => {
            await gate.$executeRaw`LOCK TABLE "ResearchCall" IN SHARE MODE`;
            pending = Promise.allSettled(
              tasks.map((task, index) =>
                reserveResearchCall(task.attemptId, kind, { index }),
              ),
            );
            await vi.waitFor(
              async () => {
                const [locks] = await gate.$queryRaw<
                  Array<{ waiting: number }>
                >`
                  SELECT count(DISTINCT l.pid)::integer AS waiting
                  FROM pg_locks l
                  JOIN pg_database d ON d.oid = l.database
                  WHERE d.datname = current_database() AND NOT l.granted
                    AND (l.locktype = 'advisory'
                      OR l.relation = '"ResearchCall"'::regclass)
                `;
                expect(locks.waiting).toBe(2);
              },
              { interval: 10, timeout: 2000 },
            );
          });
          const results = await pending!;
          const winners = results.filter(
            (result) => result.status === "fulfilled",
          );
          expect(winners).toHaveLength(1);
          const loserIndex = results.findIndex(
            (result) => result.status === "rejected",
          );
          expect(results[loserIndex]).toMatchObject({
            status: "rejected",
            reason: { code: "CAPACITY_BUSY" },
          });
          const taskIds = tasks.map((task) => task.id);
          const counter = kind === "llm" ? "llmCalls" : "crawlCalls";
          const reserved = await db.researchTask.findMany({
            where: { id: { in: taskIds } },
          });
          for (const [index, task] of tasks.entries()) {
            const count = reserved.find((row) => row.id === task.id)![counter];
            const seeded = kind === "llm" && index === 0 ? 1 : 0;
            expect(count).toBe(seeded + (index === loserIndex ? 0 : 1));
          }
          expect(
            await db.researchCall.count({
              where: { kind, status: "running", task: { status: "running" } },
            }),
          ).toBe(limit);
          expect(
            await db.researchEvent.count({
              where: { taskId: { in: taskIds }, type: "call.started" },
            }),
          ).toBe(limit);

          // A rejected reservation consumed neither budget nor event sequence;
          // its transaction lock also has to release so this retry can proceed.
          await finishResearchCall(winners[0].value.call.id, {});
          await reserveResearchCall(tasks[loserIndex].attemptId, kind, {
            explicitRetry: true,
          });
          const after = await db.researchTask.findMany({
            where: { id: { in: taskIds } },
          });
          expect(after.reduce((sum, task) => sum + task[counter], 0)).toBe(
            limit + 1,
          );
          expect(
            await db.researchCall.count({
              where: { kind, status: "running", task: { status: "running" } },
            }),
          ).toBe(limit);
          expect(
            (await db.user.findUniqueOrThrow({ where: { id: userId } }))
              .credits,
          ).toBe(123.4);
        } finally {
          await pending;
          for (const task of tasks) await cancelResearchTask(userId, task.id);
        }
      },
    );
    it("preserves a legacy report while explicitly creating a new V2整理 task", async () => {
      const input = {
        ...researchPlanInputSchema.parse({
          brief: { question: "办公午餐设备比较" },
          products: ["report", "pptx"],
        }),
        projectId,
        clientRequestId: randomUUID(),
      };
      const original = await createResearchTask(userId, input);
      await db.researchStage.updateMany({
        where: { taskId: original.id, kind: "synthesize" },
        data: {
          status: "completed",
          text: "保留的原始研究报告",
          result: { brief: "旧格式" },
        },
      });
      await db.researchTask.update({
        where: { id: original.id },
        data: { status: "completed" },
      });
      const evidence = await db.researchEvidence.create({
        data: {
          projectId,
          taskId: original.id,
          sourceKey: "legacy-original",
          canonicalUrl: "https://example.com/legacy",
          originalUrl: "https://example.com/legacy",
          title: "原始来源",
        },
      });
      const reuse = {
        ...input,
        sourceTaskId: original.id,
        clientRequestId: randomUUID(),
      };
      await expect(createResearchTask(userId, reuse)).rejects.toMatchObject({
        code: "FINAL_PACKAGE_REQUIRED",
      });
      const refreshInput = { ...reuse, sourceMode: "refresh" as const };
      const refreshed = await createResearchTask(userId, refreshInput);
      expect((await createResearchTask(userId, refreshInput)).id).toBe(
        refreshed.id,
      );
      expect(refreshed.stages.map((s) => s.kind)).toEqual([
        "synthesize",
        "produce",
      ]);
      expect(refreshed.sourceTaskId).toBe(original.id);
      expect(refreshed.evidence.map((e) => e.id)).toContain(evidence.id);
      expect(
        (
          await db.researchStage.findFirstOrThrow({
            where: { taskId: original.id, kind: "synthesize" },
          })
        ).text,
      ).toBe("保留的原始研究报告");
      await db.researchStage.updateMany({
        where: { taskId: refreshed.id, kind: "synthesize" },
        data: { status: "completed", text: "第一版重新整理" },
      });
      await db.researchTask.update({
        where: { id: refreshed.id },
        data: { status: "completed" },
      });
      const nested = await createResearchTask(userId, {
        ...refreshInput,
        sourceTaskId: refreshed.id,
        clientRequestId: randomUUID(),
      });
      await db.researchTask.update({
        where: { id: nested.id },
        data: { status: "running", executionToken: "version-test" },
      });
      let file: Awaited<ReturnType<typeof saveResearchArtifact>> | undefined;
      try {
        expect(await researchFilesProtected(original.id)).toBe(true);
        const snapshot = await researchTaskView(userId, nested.id);
        expect(snapshot.evidence.map((e) => e.id)).toContain(evidence.id);
        file = await saveResearchArtifact({
          taskId: nested.id,
          executionToken: "version-test",
          filename: "version-test.md",
          title: "新版报告",
          kind: "report",
          data: "# 新版报告",
          evidenceIds: [evidence.id],
        });
        expect(file.basisTaskId).toBe(nested.id);
        expect(file.evidenceIds).toEqual([evidence.id]);
      } finally {
        await cancelResearchTask(userId, nested.id);
        if (file) await removeResearchFile(file.storageKey);
      }
    });
  },
);

