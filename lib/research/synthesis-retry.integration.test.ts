import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { researchJson } from "./errors";
import { researchBriefSchema } from "./types";
import { researchVersion } from "./workflow-quality";
import { researchTaskView, retryResearchStage } from "./service";
import { saveResearchArtifactBatch } from "./artifacts";
import { removeResearchFile } from "./storage";
import type {
  SynthesisCheckpoint,
  SynthesisMetadata,
} from "./synthesis-checkpoint";

const enabled =
  process.env.RESEARCH_INTEGRATION_TEST === "1" &&
  /^\/chugao_research_it_[a-f0-9]+$/.test(
    new URL(process.env.DATABASE_URL || "postgresql://localhost/disabled")
      .pathname,
  );
const draft = "# 模拟已完成分析草稿\n\n[cm_fixture_source] 的当前材料观察。";
const report = "# 模拟已完成编辑正文\n\n当前材料观察来自 [cm_fixture_source]。";
const metadata: SynthesisMetadata = {
  finalBrief: {
    goal: "研究当前目标",
    scope: "只使用模拟材料",
    alternatives: [],
    acceptanceCriteria: [],
    openQuestions: [],
  },
  hypotheses: [],
  caveats: [],
  competitors: [],
  decisionCards: [],
};
const completedAt = "2026-10-20T00:00:00.000Z";
function checkpoint(withMetadata = false): SynthesisCheckpoint {
  return {
    version: "synthesis-resume-v2",
    inputHash: researchVersion({ fixture: true, effort: "high" }),
    draft: {
      text: draft,
      hash: researchVersion(draft),
      attemptId: "fixture-prior",
      responseId: "fixture-draft",
      completedAt,
    },
    report: {
      text: report,
      hash: researchVersion(report),
      draftHash: researchVersion(draft),
      attemptId: "fixture-prior",
      responseId: "fixture-response",
      completedAt,
    },
    ...(withMetadata
      ? {
          metadata: {
            value: metadata,
            hash: researchVersion(metadata),
            reportHash: researchVersion(report),
            attemptId: "fixture-prior",
            responseId: "fixture-metadata",
            completedAt,
          },
        }
      : {}),
  };
}

describe.skipIf(!enabled)(
  "synthesis retry persistence (temporary PostgreSQL, no model)",
  () => {
    let userId: string;
    let projectId: string;
    let briefId: string;
    beforeAll(async () => {
      const user = await db.user.create({
        data: {
          email: `${randomUUID()}@synthesis-retry.invalid`,
          passwordHash: "synthetic-unused",
          credits: 123.4,
        },
      });
      userId = user.id;
      const project = await db.researchProject.create({
        data: { userId, title: "Temporary synthesis recovery" },
      });
      projectId = project.id;
      const brief = await db.researchBrief.create({
        data: {
          projectId,
          revision: 1,
          content: researchJson(
            researchBriefSchema.parse({
              question: "美国一体式设备研究",
              market: "美国",
            }),
          ),
        },
      });
      briefId = brief.id;
    });
    afterAll(async () => {
      try {
        const files = projectId
          ? await db.researchArtifact.findMany({
              where: { projectId },
              select: { storageKey: true },
            })
          : [];
        if (projectId)
          await db.$transaction(async (tx) => {
            const task = { projectId };
            await tx.researchCall.deleteMany({ where: { task } });
            await tx.researchAttempt.deleteMany({ where: { stage: { task } } });
            await tx.researchEvent.deleteMany({ where: { task } });
            await tx.researchArtifact.deleteMany({ where: { projectId } });
            await tx.researchEvidence.deleteMany({ where: { projectId } });
            await tx.researchStage.deleteMany({ where: { task } });
            await tx.researchTask.deleteMany({ where: task });
            await tx.researchBrief.deleteMany({ where: { projectId } });
            await tx.researchAttachment.deleteMany({ where: { projectId } });
            await tx.researchProject.delete({ where: { id: projectId } });
            await tx.user.delete({ where: { id: userId } });
          });
        await Promise.all(
          files.map((file) => removeResearchFile(file.storageKey)),
        );
      } finally {
        await db.$disconnect();
      }
    });

    async function fixture(saved: unknown, llmCalls = 2) {
      const task = await db.researchTask.create({
        data: {
          projectId,
          briefId,
          userId,
          clientRequestId: randomUUID(),
          inputHash: researchVersion("temporary"),
          preset: "research",
          scope: "standard",
          modelId: "fixture-model",
          reasoningEffort: "high",
          plan: {
            preset: "research",
            reason: "fixture",
            products: ["report"],
            limits: { llm: 3, search: 1, crawl: 1, minutes: 5 },
            stages: [{ kind: "synthesize", engine: "chugao" }],
          },
          configSnapshot: { retentionDays: 1 },
          status: "failed",
          llmCalls,
          deadlineAt: new Date(Date.now() + 120000),
          finishedAt: new Date(),
        },
      });
      const stage = await db.researchStage.create({
        data: {
          taskId: task.id,
          kind: "synthesize",
          engine: "chugao",
          ordinal: 1,
          status: "failed",
          text: report,
          result: researchJson({
            contextManifest: { schemaVersion: 1, sources: [] },
            synthesisPhase: "metadata",
            synthesisCheckpoint: saved,
          }),
        },
      });
      const attempt = await db.researchAttempt.create({
        data: { stageId: stage.id, ordinal: 1, status: "failed", text: report },
      });
      await db.researchStage.update({
        where: { id: stage.id },
        data: { activeAttemptId: attempt.id },
      });
      return { task, stage, attempt };
    }

    it("concurrent explicit retry is idempotent and retains completed draft and edited-report checkpoints", async () => {
      const saved = checkpoint();
      const { task, stage, attempt } = await fixture(saved);
      const key = randomUUID();
      await Promise.all([
        retryResearchStage(userId, task.id, stage.id, key),
        retryResearchStage(userId, task.id, stage.id, key),
      ]);
      const current = await db.researchStage.findUniqueOrThrow({
        where: { id: stage.id },
      });
      expect(current.status).toBe("pending");
      expect(
        (current.result as { synthesisCheckpoint: unknown })
          .synthesisCheckpoint,
      ).toEqual(saved);
      expect(current.result).not.toHaveProperty("synthesisPhase");
      expect(current.text).toBe("");
      expect(
        (
          await db.researchAttempt.findUniqueOrThrow({
            where: { id: attempt.id },
          })
        ).text,
      ).toBe(report);
      expect(
        await db.researchAttempt.count({ where: { stageId: stage.id } }),
      ).toBe(2);
      expect(
        await db.researchEvent.count({
          where: { taskId: task.id, type: "stage.retry_queued" },
        }),
      ).toBe(1);
      expect(
        (await db.user.findUniqueOrThrow({ where: { id: userId } })).credits,
      ).toBe(123.4);
    });

    it("permits a complete v2 three-step bundle at the call ceiling without raising the ceiling", async () => {
      const saved = checkpoint(true);
      const { task, stage } = await fixture(saved, 3);
      const before = await researchTaskView(userId, task.id);
      expect(before.stages.find((row) => row.id === stage.id)).toMatchObject({
        savedSynthesisComplete: true,
        result: { synthesisPhase: "metadata", synthesisCheckpoint: saved },
      });
      await retryResearchStage(userId, task.id, stage.id, randomUUID());
      const current = await db.researchTask.findUniqueOrThrow({
        where: { id: task.id },
      });
      expect(current.status).toBe("queued");
      expect(current.llmCalls).toBe(3);
      expect(
        (
          await db.researchStage.findUniqueOrThrow({
            where: { id: stage.id },
          })
        ).result,
      ).toMatchObject({ synthesisCheckpoint: saved });
      // The normal RepeatableRead view must not briefly re-expose the old
      // metadata phase after the retry transaction, while its validated
      // completion hint and full checkpoint chain stay available.
      const after = await researchTaskView(userId, task.id);
      const retriedStage = after.stages.find((row) => row.id === stage.id);
      expect(retriedStage).toMatchObject({
        status: "pending",
        text: "",
        savedSynthesisComplete: true,
      });
      expect(retriedStage?.result).toEqual({
        contextManifest: { schemaVersion: 1, sources: [] },
        synthesisCheckpoint: saved,
      });
      expect(retriedStage?.result).not.toHaveProperty("synthesisPhase");
      expect(await db.researchCall.count({ where: { taskId: task.id } })).toBe(
        0,
      );
    });

    it("does not treat a legacy v1 report and metadata as the completed v2 editorial pipeline", async () => {
      const saved = checkpoint(true);
      const legacy = {
        version: "synthesis-resume-v1",
        inputHash: saved.inputHash,
        report: {
          text: report,
          hash: researchVersion(report),
          attemptId: "fixture-prior",
          responseId: "fixture-response",
          completedAt,
        },
        metadata: saved.metadata,
      };
      const { task, stage } = await fixture(legacy, 3);
      const view = await researchTaskView(userId, task.id);
      expect(view.stages.find((row) => row.id === stage.id)).toMatchObject({
        savedSynthesisComplete: false,
      });
      await expect(
        retryResearchStage(userId, task.id, stage.id, randomUUID()),
      ).rejects.toMatchObject({ code: "SYNTHESIS_CHECKPOINT_VERSION" });
      expect(
        await db.researchAttempt.count({ where: { stageId: stage.id } }),
      ).toBe(1);
      expect(
        (await db.researchTask.findUniqueOrThrow({ where: { id: task.id } }))
          .status,
      ).toBe("failed");
      expect(
        await db.researchEvent.count({
          where: { taskId: task.id, type: "stage.retry_queued" },
        }),
      ).toBe(0);
      expect(
        (
          await db.researchStage.findUniqueOrThrow({
            where: { id: stage.id },
          })
        ).result,
      ).toMatchObject({ synthesisCheckpoint: legacy });
      expect(await db.researchCall.count({ where: { taskId: task.id } })).toBe(
        0,
      );
    });

    it("does not waive the call ceiling for incomplete or damaged v2 dependencies", async () => {
      const complete = checkpoint(true);
      for (const saved of [
        // An explicitly completed draft is recoverable only if there is budget
        // for editorial and metadata; it is not a locally publishable report.
        {
          version: complete.version,
          inputHash: complete.inputHash,
          draft: complete.draft,
        },
        checkpoint(),
        {
          ...complete,
          report: {
            ...complete.report!,
            draftHash: "e".repeat(64),
          },
        },
        {
          ...complete,
          metadata: {
            ...complete.metadata!,
            reportHash: "f".repeat(64),
          },
        },
      ]) {
        const { task, stage } = await fixture(saved, 3);
        const view = await researchTaskView(userId, task.id);
        expect(view.stages.find((row) => row.id === stage.id)).toMatchObject({
          savedSynthesisComplete: false,
        });
        await expect(
          retryResearchStage(userId, task.id, stage.id, randomUUID()),
        ).rejects.toMatchObject({ code: "BUDGET_EXHAUSTED" });
        expect(
          await db.researchAttempt.count({ where: { stageId: stage.id } }),
        ).toBe(1);
        expect(
          (
            await db.researchStage.findUniqueOrThrow({
              where: { id: stage.id },
            })
          ).status,
        ).toBe("failed");
      }
    });

    it("commits a complete artifact group with the stage, and rolls both back on completion failure", async () => {
      const { task, stage } = await fixture(checkpoint(true), 3);
      const token = randomUUID();
      await db.researchTask.update({
        where: { id: task.id },
        data: { status: "running", executionToken: token },
      });
      const bundle = {
        taskId: task.id,
        executionToken: token,
        files: [
          {
            filename: "1-report.md",
            title: "Synthetic report",
            kind: "report",
            data: Buffer.from(report),
            evidenceIds: [],
          },
        ],
      };
      await expect(
        saveResearchArtifactBatch(bundle, async (tx) => {
          await tx.researchStage.update({
            where: { id: stage.id },
            data: { status: "completed" },
          });
          throw new Error("injected completion failure");
        }),
      ).rejects.toThrow("injected completion failure");
      expect(
        await db.researchArtifact.count({ where: { taskId: task.id } }),
      ).toBe(0);
      expect(
        (await db.researchStage.findUniqueOrThrow({ where: { id: stage.id } }))
          .status,
      ).toBe("failed");
      await saveResearchArtifactBatch(bundle, async (tx) => {
        await tx.researchStage.update({
          where: { id: stage.id },
          data: { status: "completed" },
        });
      });
      expect(
        await db.researchArtifact.count({ where: { taskId: task.id } }),
      ).toBe(1);
      expect(
        (await db.researchStage.findUniqueOrThrow({ where: { id: stage.id } }))
          .status,
      ).toBe("completed");
    });
  },
);

