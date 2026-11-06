// @vitest-environment node
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { researchConfigSchema } from "./config";
import { ResearchError, researchJson } from "./errors";
import { researchBriefSchema, researchIntakeResultSchema } from "./types";
import * as researchInputs from "./inputs";
import * as researchIntake from "./intake";
import {
  cancelResearchTask,
  researchEvent,
  retryResearchStage,
} from "./service";
import {
  claimResearchTask,
  executeResearchTask,
  recoverResearchTasks,
} from "./worker";
import type { ResearchTaskLane } from "./worker-lanes";

const enabled =
  process.env.RESEARCH_INTEGRATION_TEST === "1" &&
  /^\/chugao_research_it_[a-f0-9]+$/.test(
    new URL(process.env.DATABASE_URL || "postgresql://localhost/disabled")
      .pathname,
  );

describe.skipIf(!enabled)(
  "worker lane ownership (scratch PostgreSQL, no upstream)",
  () => {
    let userId: string;
    let projectId: string | null = null;
    let briefId: string;
    let order = 0;

    // Direct queue fixtures isolate dispatch/fencing from intake admission. They
    // are not examples of bypassing the service's accepted-intake requirement.
    async function queue(lane: ResearchTaskLane) {
      const kind = lane === "intake" ? "intake" : "explore";
      return db.researchTask.create({
        data: {
          userId,
          projectId: projectId!,
          briefId,
          clientRequestId: randomUUID(),
          inputHash: randomUUID(),
          preset: lane === "intake" ? "intake" : "research",
          scope: "standard",
          modelId: "synthetic-unused",
          reasoningEffort: "low",
          createdAt: new Date(Date.UTC(2026, 0, 1) + order++),
          plan: {
            preset: "research",
            reason: "Synthetic lane ownership fixture",
            limits: { llm: 3, search: 0, crawl: 0, minutes: 5 },
            products: ["report"],
            stages: [{ kind, engine: "chugao" }],
          },
          configSnapshot: researchJson(researchConfigSchema.parse({})),
          stages: { create: { kind, engine: "chugao", ordinal: 0 } },
        },
      });
    }

    beforeAll(async () => {
      userId = (
        await db.user.create({
          data: {
            email: `${randomUUID()}@worker-lanes.invalid`,
            passwordHash: "synthetic-unused",
            role: "ADMIN",
            credits: 123.4,
          },
        })
      ).id;
    });

    beforeEach(async () => {
      // Suites run serially. Refuse to modify another suite's active fixtures.
      expect(
        await db.researchTask.count({
          where: { status: { in: ["queued", "running"] } },
        }),
      ).toBe(0);
      projectId = (
        await db.researchProject.create({
          data: { userId, title: "Synthetic worker lanes" },
        })
      ).id;
      briefId = (
        await db.researchBrief.create({
          data: {
            projectId,
            revision: 1,
            content: researchBriefSchema.parse({ question: "Synthetic task" }),
          },
        })
      ).id;
    });

    afterEach(async () => {
      if (!projectId) return;
      // Remove only this suite's rows, including terminal rows: an older suite
      // intentionally asserts the fresh database's total task/brief counts.
      const id = projectId;
      await db.$transaction(async (tx) => {
        await tx.researchCall.deleteMany({
          where: { task: { projectId: id } },
        });
        await tx.researchAttempt.deleteMany({
          where: { stage: { task: { projectId: id } } },
        });
        await tx.researchEvent.deleteMany({
          where: { task: { projectId: id } },
        });
        await tx.researchEvidence.deleteMany({ where: { projectId: id } });
        await tx.researchArtifact.deleteMany({ where: { projectId: id } });
        await tx.researchStage.deleteMany({
          where: { task: { projectId: id } },
        });
        await tx.researchTask.deleteMany({ where: { projectId: id } });
        await tx.researchBrief.deleteMany({ where: { projectId: id } });
        await tx.researchAttachment.deleteMany({ where: { projectId: id } });
        await tx.researchProject.delete({ where: { id } });
      });
      projectId = null;
    });

    afterAll(async () => {
      if (userId) await db.user.delete({ where: { id: userId } });
      await db.$disconnect();
    });

    it("claims intake while research is running, without an older blocked research head starving it", async () => {
      const research = await queue("research");
      const claimed = await claimResearchTask();
      expect(claimed?.id).toBe(research.id);
      const waitingResearch = await queue("research");
      const intake = await queue("intake");
      const next = await claimResearchTask();
      expect(next?.id).toBe(intake.id);
      expect(next?.executionToken).toBeTruthy();
      expect(
        (
          await db.researchTask.findUniqueOrThrow({
            where: { id: waitingResearch.id },
          })
        ).status,
      ).toBe("queued");
      expect(await claimResearchTask("research")).toBeNull();
      expect(await claimResearchTask("intake")).toBeNull();
    });

    it("concurrent dispatchers fill each global lane once and never run more than two tasks", async () => {
      for (let index = 0; index < 3; index++) {
        await queue("research");
        await queue("intake");
      }
      for (const lane of ["research", "intake"] as const) {
        const claims = await Promise.all(
          Array.from({ length: 8 }, () => claimResearchTask(lane)),
        );
        expect(claims.filter(Boolean)).toHaveLength(1);
      }
      const running = await db.researchTask.findMany({
        where: { status: "running" },
      });
      expect(running).toHaveLength(2);
      expect(running.map((task) => task.preset).sort()).toEqual([
        "intake",
        "research",
      ]);
      expect(new Set(running.map((task) => task.executionToken)).size).toBe(2);
      const more = await Promise.all([
        claimResearchTask(),
        claimResearchTask("research"),
        claimResearchTask("intake"),
      ]);
      expect(more).toEqual([null, null, null]);
      expect(await db.researchTask.count({ where: { status: "queued" } })).toBe(
        4,
      );
    });

    it("cancellation frees only its lane and fences delayed writes from the cancelled owner", async () => {
      await queue("research");
      const research = (await claimResearchTask("research"))!;
      await queue("intake");
      const intake = (await claimResearchTask("intake"))!;
      const replacement = await queue("intake");
      await cancelResearchTask(userId, intake.id);
      await expect(
        researchEvent(intake.id, "late.progress", {}, intake.executionToken!),
      ).rejects.toMatchObject({ code: "TASK_STOPPED" });
      expect((await claimResearchTask("intake"))?.id).toBe(replacement.id);
      expect(await claimResearchTask("research")).toBeNull();
      expect(
        (
          await db.researchTask.findUniqueOrThrow({
            where: { id: research.id },
          })
        ).executionToken,
      ).toBe(research.executionToken);
      expect(
        await db.researchEvent.count({
          where: { taskId: intake.id, type: "task.cancelled" },
        }),
      ).toBe(1);
      expect(
        (await db.user.findUniqueOrThrow({ where: { id: userId } })).credits,
      ).toBe(123.4);
    });

    it("recovers only a stale lane, preserves partials, and fences the old owner after explicit retry", async () => {
      await queue("research");
      const research = (await claimResearchTask("research"))!;
      await queue("intake");
      const intake = (await claimResearchTask("intake"))!;
      const stage = await db.researchStage.findFirstOrThrow({
        where: { taskId: research.id },
      });
      const attempt = await db.researchAttempt.create({
        data: {
          stageId: stage.id,
          ordinal: 1,
          status: "running",
          text: "saved partial",
        },
      });
      await db.researchStage.update({
        where: { id: stage.id },
        data: {
          status: "running",
          activeAttemptId: attempt.id,
          text: "saved partial",
        },
      });
      const call = await db.researchCall.create({
        data: {
          taskId: research.id,
          attemptId: attempt.id,
          kind: "llm",
          requestHash: randomUUID(),
        },
      });
      await db.researchTask.update({
        where: { id: research.id },
        data: { heartbeatAt: new Date(Date.now() - 120000) },
      });
      await Promise.all([recoverResearchTasks(), recoverResearchTasks()]);
      expect(
        await db.researchTask.findUniqueOrThrow({ where: { id: research.id } }),
      ).toMatchObject({
        status: "interrupted",
        executionToken: null,
      });
      expect(
        await db.researchStage.findUniqueOrThrow({ where: { id: stage.id } }),
      ).toMatchObject({
        status: "interrupted",
        text: "saved partial",
      });
      expect(
        await db.researchAttempt.findUniqueOrThrow({
          where: { id: attempt.id },
        }),
      ).toMatchObject({
        status: "interrupted",
        text: "saved partial",
      });
      expect(
        await db.researchCall.findUniqueOrThrow({ where: { id: call.id } }),
      ).toMatchObject({
        status: "unknown",
        errorCode: "EXECUTION_UNKNOWN",
      });
      expect(
        await db.researchEvent.count({
          where: { taskId: research.id, type: "task.interrupted" },
        }),
      ).toBe(1);
      expect(await claimResearchTask("research")).toBeNull();
      expect(
        await db.researchTask.findUniqueOrThrow({ where: { id: intake.id } }),
      ).toMatchObject({
        status: "running",
        executionToken: intake.executionToken,
      });

      await retryResearchStage(userId, research.id, stage.id, randomUUID());
      const renewed = (await claimResearchTask("research"))!;
      expect(renewed.id).toBe(research.id);
      expect(renewed.executionToken).not.toBe(research.executionToken);
      await expect(
        researchEvent(
          research.id,
          "late.progress",
          {},
          research.executionToken!,
        ),
      ).rejects.toMatchObject({ code: "TASK_STOPPED" });
      const stoppedOldOwner = new AbortController();
      stoppedOldOwner.abort(
        new ResearchError("WORKER_INTERRUPTED", "Synthetic shutdown", 409),
      );
      await executeResearchTask(research, stoppedOldOwner);
      expect(
        await db.researchTask.findUniqueOrThrow({ where: { id: research.id } }),
      ).toMatchObject({
        status: "running",
        executionToken: renewed.executionToken,
      });
      await researchEvent(
        research.id,
        "current.progress",
        {},
        renewed.executionToken!,
      );
      expect(
        await db.researchEvent.count({
          where: { taskId: research.id, type: "task.interrupted" },
        }),
      ).toBe(1);
    });

    it("a shutdown arriving during claim settles both claimed tasks without starting an upstream call", async () => {
      await queue("research");
      const research = (await claimResearchTask("research"))!;
      await queue("intake");
      const intake = (await claimResearchTask("intake"))!;
      const fetch = vi
        .spyOn(globalThis, "fetch")
        .mockRejectedValue(new Error("upstream must not be called"));
      try {
        await Promise.all(
          [research, intake].map(async (task) => {
            const abort = new AbortController();
            abort.abort(
              new ResearchError(
                "WORKER_INTERRUPTED",
                "Synthetic shutdown",
                409,
              ),
            );
            await executeResearchTask(task, abort);
          }),
        );
        expect(fetch).not.toHaveBeenCalled();
        const tasks = await db.researchTask.findMany({
          where: { projectId: projectId! },
        });
        expect(
          tasks.every(
            (task) =>
              task.status === "interrupted" && task.executionToken === null,
          ),
        ).toBe(true);
        expect(
          await db.researchCall.count({
            where: { task: { projectId: projectId! } },
          }),
        ).toBe(0);
        expect(
          await db.researchAttempt.count({
            where: { stage: { task: { projectId: projectId! } } },
          }),
        ).toBe(0);
        expect(
          await db.researchEvent.count({
            where: {
              task: { projectId: projectId! },
              type: "task.interrupted",
            },
          }),
        ).toBe(2);
      } finally {
        fetch.mockRestore();
      }
    });

    it("intake asks its next question without extracting attachments; formal research still prepares them", async () => {
      const supplied = researchBriefSchema.parse({
        question: "Synthetic task",
        links: ["https://unused.invalid/reference"],
        attachmentKeys: ["attachment:synthetic-unread-document"],
        selectedContext: "Already selected conversation context",
      });
      await db.researchBrief.update({
        where: { id: briefId },
        data: { content: supplied },
      });
      const prepare = vi
        .spyOn(researchInputs, "prepareResearchInputs")
        .mockRejectedValue(
          new ResearchError(
            "SYNTHETIC_EXTRACT_UNAVAILABLE",
            "Synthetic extraction stop",
            502,
          ),
        );
      const dialogue = vi
        .spyOn(researchIntake, "runResearchIntake")
        .mockResolvedValue(
          researchIntakeResultSchema.parse({
            reply: "你最想改善哪一步使用体验？",
            suggestions: [],
            ready: false,
            summary: "Synthetic task",
            products: ["report"],
            brief: supplied,
          }),
        );
      try {
        await queue("intake");
        const intake = (await claimResearchTask("intake"))!;
        await executeResearchTask(intake, new AbortController());
        expect(prepare).not.toHaveBeenCalled();
        expect(dialogue).toHaveBeenCalledTimes(1);
        expect(dialogue.mock.calls[0][2]).toEqual(supplied);
        expect(
          await db.researchTask.findUniqueOrThrow({ where: { id: intake.id } }),
        ).toMatchObject({
          status: "completed",
          executionToken: null,
        });

        await queue("research");
        const research = (await claimResearchTask("research"))!;
        await executeResearchTask(research, new AbortController());
        expect(prepare).toHaveBeenCalledTimes(1);
        expect(prepare.mock.calls[0][0].id).toBe(research.id);
        expect(prepare.mock.calls[0][1]).toEqual(supplied);
        expect(
          await db.researchTask.findUniqueOrThrow({
            where: { id: research.id },
          }),
        ).toMatchObject({
          status: "failed",
          error: { code: "SYNTHETIC_EXTRACT_UNAVAILABLE" },
        });
      } finally {
        prepare.mockRestore();
        dialogue.mockRestore();
      }
    });
  },
);
