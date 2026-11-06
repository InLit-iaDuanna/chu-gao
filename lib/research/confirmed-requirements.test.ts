import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ResearchTask } from "@prisma/client";
import { researchBriefSchema } from "./types";
import { confirmedUserRequirements } from "./confirmed-requirements";

const database = vi.hoisted(() => ({ findFirst: vi.fn() }));
vi.mock("@/lib/db", () => ({
  db: { researchTask: { findFirst: database.findFirst } },
}));

const brief = researchBriefSchema.parse({ question: "研究办公室午餐设备" });
const correction = "更正：只研究办公室，不考虑宿舍。";
const result = {
  contractVersion: "intake-dialogue-v1",
  reply: "按办公室使用场景开展研究，保留预算未知。",
  suggestions: [],
  nextQuestion: null,
  ready: true,
  summary: "按办公室使用场景开展研究，保留预算未知。",
  confirmedRequirements: [correction],
  unknowns: ["预算尚未确定"],
  products: ["report"],
  brief,
};
const snapshot = {
  taskId: "intake-confirmed",
  contractVersion: "intake-dialogue-v1",
  brief,
  confirmedRequirements: [correction],
};
const task = (configSnapshot: unknown = {}) =>
  ({
    projectId: "project-1",
    userId: "user-1",
    sourceTaskId: null,
    configSnapshot,
    createdAt: new Date("2026-10-18T16:00:00Z"),
  }) as ResearchTask;
const latest = (status = "completed", output: unknown = result) => ({
  status,
  configSnapshot: {
    intake: {
      history: [
        { role: "user", content: "先研究宿舍使用。" },
        { role: "assistant", content: "建议价格定为 999 元。" },
      ],
      answer: correction,
    },
  },
  stages: [{ result: output }],
});

beforeEach(() => {
  database.findFirst.mockReset();
});

describe("confirmed research requirements", () => {
  it("uses immutable creation-time confirmation without reading later interview turns", async () => {
    expect(
      await confirmedUserRequirements(
        task({ intakeConfirmation: snapshot }),
        brief,
      ),
    ).toEqual([correction]);
    expect(database.findFirst).not.toHaveBeenCalled();
  });

  it("does not reinterpret a damaged or mismatched snapshot through mutable history", async () => {
    expect(
      await confirmedUserRequirements(
        task({
          intakeConfirmation: {
            ...snapshot,
            brief: { ...brief, question: "完全不同的研究" },
          },
        }),
        brief,
      ),
    ).toEqual([]);
    expect(database.findFirst).not.toHaveBeenCalled();
  });

  it("keeps a deliberately empty current confirmation empty", async () => {
    expect(
      await confirmedUserRequirements(
        task({
          intakeConfirmation: {
            ...snapshot,
            confirmedRequirements: [],
          },
        }),
        brief,
      ),
    ).toEqual([]);
    expect(database.findFirst).not.toHaveBeenCalled();
  });

  it("accepts only current effective user statements for an older queued task", async () => {
    database.findFirst.mockResolvedValue(latest());
    expect(await confirmedUserRequirements(task(), brief)).toEqual([
      correction,
    ]);
    expect(database.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          userId: "user-1",
          projectId: "project-1",
          preset: "intake",
          createdAt: { lte: task().createdAt },
        }),
      }),
    );
  });

  it.each(["failed", "queued", "running", "cancelled"])(
    "never falls back to an older ready result after the latest intake is %s",
    async (status) => {
      database.findFirst.mockResolvedValue(latest(status));
      expect(await confirmedUserRequirements(task(), brief)).toEqual([]);
      expect(database.findFirst).toHaveBeenCalledTimes(1);
    },
  );

  it("does not promote a legacy model summary or assistant suggestion to user confirmation", async () => {
    const legacy: Partial<typeof result> = { ...result };
    delete legacy.contractVersion;
    delete legacy.confirmedRequirements;
    database.findFirst.mockResolvedValue(latest("completed", legacy));
    expect(await confirmedUserRequirements(task(), brief)).toEqual([]);
    database.findFirst.mockResolvedValue(
      latest("completed", {
        ...result,
        confirmedRequirements: ["建议价格定为 999 元。"],
      }),
    );
    expect(await confirmedUserRequirements(task(), brief)).toEqual([]);
  });

  it("preserves a directly submitted goal when the project has no interview history", async () => {
    database.findFirst.mockResolvedValue(null);
    expect(await confirmedUserRequirements(task(), brief)).toEqual([
      brief.question,
    ]);
  });
});
