import { describe, expect, it, vi } from "vitest";
import type { Prisma } from "@prisma/client";
import { researchOutputBasis, researchVersionTaskIds } from "./versions";
import { makeResearchPlan } from "./config";
import { researchPlanInputSchema } from "./types";

const task = {
  id: "new",
  userId: "owner",
  projectId: "project",
  sourceTaskId: "source",
};
const limits = { llm: 12, search: 4, crawl: 6, minutes: 10 };

describe("research version reuse", () => {
  it("refreshes a historical report without creating search or capture stages", () => {
    const input = researchPlanInputSchema.parse({
      brief: { question: "整理历史研究" },
      sourceTaskId: "source",
      sourceMode: "refresh",
      products: ["pptx", "docx", "html"],
    });
    const plan = makeResearchPlan(input, limits);
    expect(plan.stages.map((stage) => stage.kind)).toEqual([
      "synthesize",
      "produce",
    ]);
    expect(
      researchOutputBasis({ ...task, plan: JSON.parse(JSON.stringify(plan)) }),
    ).toBe(task.id);
    expect(
      makeResearchPlan({ ...input, sourceMode: "produce" }, limits).stages.map(
        (s) => s.kind,
      ),
    ).toEqual(["produce"]);
    expect(
      researchOutputBasis({ ...task, plan: { stages: [{ kind: "produce" }] } }),
    ).toBe("source");
  });

  it("keeps grandparent evidence available only within the same owner and project", async () => {
    const findFirst = vi
      .fn()
      .mockResolvedValueOnce({ id: "source", sourceTaskId: "original" })
      .mockResolvedValueOnce({ id: "original", sourceTaskId: null });
    const client = { researchTask: { findFirst } } as unknown as Pick<
      Prisma.TransactionClient,
      "researchTask"
    >;
    expect(await researchVersionTaskIds(task, client)).toEqual([
      "new",
      "source",
      "original",
    ]);
    expect(findFirst).toHaveBeenLastCalledWith({
      where: { id: "original", userId: "owner", projectId: "project" },
      select: { id: true, sourceTaskId: true },
    });
  });

  it("rejects a missing or unowned ancestor", async () => {
    const client = {
      researchTask: { findFirst: vi.fn().mockResolvedValue(null) },
    } as unknown as Pick<Prisma.TransactionClient, "researchTask">;
    await expect(researchVersionTaskIds(task, client)).rejects.toMatchObject({
      code: "INVALID_SOURCE_VERSION",
    });
  });

  it("rejects cyclic versions instead of expanding them indefinitely", async () => {
    const client = {
      researchTask: {
        findFirst: vi
          .fn()
          .mockResolvedValue({ id: "source", sourceTaskId: "new" }),
      },
    } as unknown as Pick<Prisma.TransactionClient, "researchTask">;
    await expect(researchVersionTaskIds(task, client)).rejects.toMatchObject({
      code: "INVALID_SOURCE_VERSION",
    });
  });
});
