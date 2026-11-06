import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(),
  lock: vi.fn(),
  write: vi.fn(),
  remove: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ db: { $transaction: mocks.transaction } }));
vi.mock("./service", () => ({ lockResearchTask: mocks.lock }));
vi.mock("./storage", () => ({
  writeResearchFile: mocks.write,
  removeResearchFile: mocks.remove,
}));

import { saveResearchArtifact, saveResearchArtifactBatch } from "./artifacts";

interface SavedArtifact {
  id: string;
  taskId: string;
  filename: string;
  storageKey: string;
  sha256: string;
  evidenceIds: unknown;
  [key: string]: unknown;
}

const oneFile = {
  taskId: "task-atomic",
  executionToken: "active-token",
  filename: "proposal.html",
  title: "Proposal",
  kind: "html",
  data: Buffer.from("<!doctype html><h1>研究草稿</h1>"),
  evidenceIds: ["ev_manual"],
};
const batch = {
  taskId: oneFile.taskId,
  executionToken: oneFile.executionToken,
  files: [
    {
      filename: oneFile.filename,
      title: oneFile.title,
      kind: oneFile.kind,
      data: oneFile.data,
      evidenceIds: oneFile.evidenceIds,
    },
    {
      filename: "report.md",
      title: "Report",
      kind: "report",
      data: Buffer.from("# 研究草稿\n\n证据与限制均保留。"),
      evidenceIds: ["ev_manual"],
    },
  ],
};

type Failure = "commit-ack-lost" | "lookup-unavailable" | "rolled-back";

// This is a transaction-state fixture, not a PostgreSQL simulator. It models the
// distinction under test: a rejected COMMIT acknowledgement may still leave rows.
function installTransactionBoundary(failure: Failure) {
  const committed = new Map<string, SavedArtifact>();
  const locked = new WeakSet<object>();
  const operations: string[] = [];
  let transactions = 0;
  mocks.lock.mockImplementation(async (tx: object) => {
    locked.add(tx);
    operations.push("task-lock");
  });
  function transactionClient(rows: Map<string, SavedArtifact>) {
    const add = (data: Omit<SavedArtifact, "id">) => {
      const row = { ...data, id: `artifact-${rows.size + 1}` } as SavedArtifact;
      rows.set(String(data.filename), row);
      return row;
    };
    const tx = {
      researchTask: {
        findUniqueOrThrow: async () => ({
          id: oneFile.taskId,
          projectId: "project-1",
          briefId: "brief-1",
          sourceTaskId: null,
          status: "running",
          executionToken: "active-token",
        }),
      },
      researchEvidence: { findMany: async () => [{ id: "ev_manual" }] },
      researchArtifact: {
        findUnique: async ({
          where,
        }: {
          where: { taskId_filename: { filename: string } };
        }) => rows.get(where.taskId_filename.filename) ?? null,
        create: async ({ data }: { data: Omit<SavedArtifact, "id"> }) =>
          add(data),
        upsert: async ({
          where,
          create,
        }: {
          where: { taskId_filename: { filename: string } };
          create: Omit<SavedArtifact, "id">;
        }) => rows.get(where.taskId_filename.filename) ?? add(create),
        findMany: async ({
          where,
        }: {
          where: { storageKey: { in: string[] } };
        }) => {
          if (!locked.has(tx))
            throw Error("Reference checks must wait for the task lock");
          operations.push("reference-check");
          if (failure === "lookup-unavailable")
            throw Error("Database unavailable during cleanup reference check");
          return [...rows.values()].filter((row) =>
            where.storageKey.in.includes(row.storageKey),
          );
        },
      },
    };
    return tx;
  }
  mocks.transaction.mockImplementation(
    async (
      work: (tx: ReturnType<typeof transactionClient>) => Promise<unknown>,
    ) => {
      transactions++;
      if (transactions === 1 && failure === "rolled-back")
        throw Error("Publish transaction rejected before commit");
      const working = new Map(committed);
      const result = await work(transactionClient(working));
      committed.clear();
      for (const [key, value] of working) committed.set(key, value);
      if (transactions === 1)
        throw Error("COMMIT succeeded but its acknowledgement was lost");
      return result;
    },
  );
  mocks.remove.mockImplementation(async () => {
    operations.push("delete-file");
  });
  return { committed, operations };
}

beforeEach(() => {
  vi.resetAllMocks();
  let fileNumber = 0;
  mocks.write.mockImplementation(
    async (taskId: string, filename: string, data: Buffer) => ({
      key: `${taskId}/${++fileNumber}/${filename}`,
      sizeBytes: data.length,
      sha256: createHash("sha256").update(data).digest("hex"),
    }),
  );
});

describe.each([
  {
    name: "single artifact",
    count: 1,
    write: () => saveResearchArtifact(oneFile),
  },
  {
    name: "artifact bundle",
    count: 2,
    write: () => saveResearchArtifactBatch(batch),
  },
])("commit-unknown cleanup: $name", ({ count, write }) => {
  it("retains files referenced by committed rows when COMMIT acknowledgement is lost", async () => {
    const state = installTransactionBoundary("commit-ack-lost");
    await expect(write()).rejects.toThrow("acknowledgement was lost");
    expect(state.committed.size).toBe(count);
    expect(mocks.write).toHaveBeenCalledTimes(count);
    expect(mocks.remove).not.toHaveBeenCalled();
    expect(state.operations).toContain("reference-check");
    for (const row of state.committed.values())
      expect(row.evidenceIds).toEqual(["ev_manual"]);
  });

  it("retains files if a new locked reference check cannot establish the database outcome", async () => {
    const state = installTransactionBoundary("lookup-unavailable");
    await expect(write()).rejects.toThrow("acknowledgement was lost");
    expect(state.committed.size).toBe(count);
    expect(state.operations).toContain("reference-check");
    expect(mocks.remove).not.toHaveBeenCalled();
  });

  it("cleans unpublished files only after a locked check confirms no references", async () => {
    const state = installTransactionBoundary("rolled-back");
    await expect(write()).rejects.toThrow("rejected before commit");
    expect(state.committed.size).toBe(0);
    expect(mocks.remove).toHaveBeenCalledTimes(count);
    expect(state.operations.indexOf("task-lock")).toBeLessThan(
      state.operations.indexOf("reference-check"),
    );
    expect(state.operations.indexOf("reference-check")).toBeLessThan(
      state.operations.indexOf("delete-file"),
    );
  });
});
