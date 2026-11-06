import { createHash } from "node:crypto";
import type { ResearchTask } from "@prisma/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ResearchConfig } from "./config";
import { researchBriefSchema } from "./types";

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(),
  lock: vi.fn(),
  findEvidence: vi.fn(),
  createEvidence: vi.fn(),
  attachments: vi.fn(),
  write: vi.fn(),
  read: vi.fn(),
  remove: vi.fn(),
  saveSource: vi.fn(),
  fetch: vi.fn(),
  sharp: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    $transaction: mocks.transaction,
    researchEvidence: { findUnique: mocks.findEvidence },
  },
}));
vi.mock("./service", () => ({ lockResearchTask: mocks.lock }));
vi.mock("./attachments", () => ({
  readResearchAttachments: mocks.attachments,
}));
vi.mock("./storage", () => ({
  writeResearchFile: mocks.write,
  readResearchFile: mocks.read,
  removeResearchFile: mocks.remove,
  saveResearchSource: mocks.saveSource,
}));
vi.mock("sharp", () => ({ default: mocks.sharp }));

import { prepareResearchInputs } from "./inputs";

const task = (executionToken: string | null = "owner-1") =>
  ({
    id: "task-input",
    projectId: "project-input",
    executionToken,
  }) as ResearchTask;
const brief = researchBriefSchema.parse({
  question: "Synthetic attachment preparation",
  attachmentKeys: ["attachment:file-1"],
  selectedContext: "Existing conversation context",
});
const config = { crawlUrl: "http://offline.invalid" } as ResearchConfig;
const attachment = {
  id: "file-1",
  name: "reference.pdf",
  data: Buffer.from("offline attachment").toString("base64"),
};
const files = new Map<string, Buffer>();
let fileNumber = 0;

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function writeFile(taskId: string, filename: string, data: Buffer | string) {
  const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
  const key = `research/${taskId}/file-${++fileNumber}-${filename}`;
  files.set(key, buffer);
  return {
    key,
    sizeBytes: buffer.length,
    sha256: createHash("sha256").update(buffer).digest("hex"),
  };
}

function pauseNextWrite() {
  const entered = deferred();
  const resume = deferred();
  mocks.write.mockImplementationOnce(
    async (taskId: string, filename: string, data: Buffer | string) => {
      const file = writeFile(taskId, filename, data);
      entered.resolve();
      await resume.promise;
      return file;
    },
  );
  return { entered: entered.promise, resume: resume.resolve };
}

interface SavedEvidence {
  id: string;
  taskId: string;
  sourceKey: string;
  contentKey: string | null;
  screenshotKey: string | null;
}
interface EvidenceIdentity {
  where: { taskId_sourceKey: { taskId: string; sourceKey: string } };
}
const identity = (taskId: string, sourceKey: string) =>
  `${taskId}:${sourceKey}`;

// This fixture models row-lock serialization and commit acknowledgement loss,
// not a real PostgreSQL server. All files, extraction and database IO are mocked.
function installBoundary({
  publishFailure,
  lookupUnavailable = false,
  afterLookup,
  afterCreate,
}: {
  publishFailure?: "rolled-back" | "commit-ack-lost";
  lookupUnavailable?: boolean;
  afterLookup?: () => void;
  afterCreate?: () => void;
} = {}) {
  const state = {
    task: { status: "running", executionToken: "owner-1" },
    committed: new Map<string, SavedEvidence>(),
    operations: [] as string[],
  };
  interface Transaction {
    rows: Map<string, SavedEvidence> | null;
    release?: () => void;
    wrote: boolean;
  }
  const transactions = new WeakMap<object, Transaction>();
  let lockTail = Promise.resolve();
  let failureDelivered = false;

  mocks.lock.mockImplementation(async (tx: object, taskId: string) => {
    expect(taskId).toBe(task().id);
    const current = transactions.get(tx)!;
    const previous = lockTail;
    const gate = deferred();
    lockTail = gate.promise;
    await previous;
    current.release = gate.resolve;
    current.rows = new Map(state.committed);
    state.operations.push("task-lock");
  });
  mocks.findEvidence.mockImplementation(async ({ where }: EvidenceIdentity) => {
    const { taskId, sourceKey } = where.taskId_sourceKey;
    return state.committed.get(identity(taskId, sourceKey)) ?? null;
  });
  mocks.transaction.mockImplementation(
    async (work: (tx: object) => Promise<unknown>) => {
      const current: Transaction = { rows: null, wrote: false };
      const lockedRows = () => {
        if (!current.rows)
          throw Error("Evidence access requires the task lock");
        return current.rows;
      };
      const tx = {
        researchTask: {
          findUniqueOrThrow: async () => {
            lockedRows();
            state.operations.push("read-owner");
            return { ...task(), ...state.task };
          },
        },
        researchEvidence: {
          findUnique: async ({ where }: EvidenceIdentity) => {
            const { taskId, sourceKey } = where.taskId_sourceKey;
            const row = lockedRows().get(identity(taskId, sourceKey)) ?? null;
            state.operations.push("unique-recheck");
            afterLookup?.();
            return row;
          },
          create: async ({
            data,
          }: {
            data: {
              taskId: string;
              sourceKey: string;
              contentKey?: string;
              screenshotKey?: string;
            };
          }) => {
            const rows = lockedRows();
            const key = identity(data.taskId, data.sourceKey);
            if (rows.has(key)) throw Error("Duplicate taskId/sourceKey");
            const row = {
              ...data,
              id: `evidence-${rows.size + 1}`,
              contentKey: data.contentKey ?? null,
              screenshotKey: data.screenshotKey ?? null,
            };
            rows.set(key, row);
            current.wrote = true;
            state.operations.push("create-evidence");
            mocks.createEvidence(data);
            afterCreate?.();
            return row;
          },
          findMany: async ({
            where,
          }: {
            where: {
              taskId: string;
              OR: [
                { contentKey: { in: string[] } },
                { screenshotKey: { in: string[] } },
              ];
            };
          }) => {
            const rows = lockedRows();
            state.operations.push("reference-check");
            if (lookupUnavailable) throw Error("Reference lookup unavailable");
            return [...rows.values()].filter(
              (row) =>
                row.taskId === where.taskId &&
                ((row.contentKey !== null &&
                  where.OR[0].contentKey.in.includes(row.contentKey)) ||
                  (row.screenshotKey !== null &&
                    where.OR[1].screenshotKey.in.includes(row.screenshotKey))),
            );
          },
        },
      };
      transactions.set(tx, current);
      try {
        const result = await work(tx);
        const fail = current.wrote && !failureDelivered && publishFailure;
        if (fail) failureDelivered = true;
        if (fail === "rolled-back")
          throw Error("Publish transaction rolled back");
        state.committed.clear();
        for (const [key, row] of lockedRows()) state.committed.set(key, row);
        if (fail === "commit-ack-lost")
          throw Error("COMMIT succeeded but its acknowledgement was lost");
        return result;
      } finally {
        current.release?.();
      }
    },
  );
  mocks.remove.mockImplementation(async (key: string) => {
    state.operations.push("delete-file");
    files.delete(key);
  });
  return state;
}

function prepare(owner = task(), signal = new AbortController().signal) {
  return prepareResearchInputs(owner, brief, config, signal);
}

beforeEach(() => {
  vi.resetAllMocks();
  files.clear();
  fileNumber = 0;
  mocks.attachments.mockResolvedValue([attachment]);
  mocks.write.mockImplementation(writeFile);
  mocks.read.mockImplementation(async (key: string) => {
    const data = files.get(key);
    if (!data) throw Error(`File missing: ${key}`);
    return data;
  });
  mocks.fetch.mockResolvedValue({
    ok: true,
    json: async () => ({ text: "Offline extracted document" }),
  });
  const image = {
    rotate: vi.fn().mockReturnThis(),
    resize: vi.fn().mockReturnThis(),
    png: vi.fn().mockReturnThis(),
    toBuffer: vi.fn().mockResolvedValue(Buffer.from("offline image")),
  };
  mocks.sharp.mockReturnValue(image);
  vi.stubGlobal("fetch", mocks.fetch);
});
afterEach(() => vi.unstubAllGlobals());

describe("attachment evidence publication fencing", () => {
  it.each(["document", "image"])(
    "publishes a %s only after checking its owner under the task lock",
    async (kind) => {
      const state = installBoundary();
      if (kind === "image")
        mocks.attachments.mockResolvedValue([
          { ...attachment, name: "reference.png" },
        ]);
      const result = await prepare();
      const row = [...state.committed.values()][0];
      expect(state.operations).toEqual([
        "task-lock",
        "read-owner",
        "unique-recheck",
        "create-evidence",
      ]);
      expect(state.committed.size).toBe(1);
      expect(
        files.has((kind === "image" ? row.screenshotKey : row.contentKey)!),
      ).toBe(true);
      expect(mocks.remove).not.toHaveBeenCalled();
      expect(result.selectedContext).toContain(brief.selectedContext);
      if (kind === "document")
        expect(result.selectedContext).toContain(
          "[evidence-1] reference.pdf:\nOffline extracted document",
        );
      else {
        expect(result.selectedContext).toBe(brief.selectedContext);
        expect(mocks.fetch).not.toHaveBeenCalled();
      }
    },
  );

  it("reuses an existing attachment without extracting or rewriting its file", async () => {
    const state = installBoundary();
    await prepare();
    mocks.write.mockClear();
    mocks.fetch.mockClear();
    const result = await prepare();
    expect(result.selectedContext).toContain("Offline extracted document");
    expect(state.committed.size).toBe(1);
    expect(mocks.write).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(mocks.createEvidence).toHaveBeenCalledTimes(1);
  });

  it("rechecks concurrent first misses under the lock and discards the losing file", async () => {
    const state = installBoundary();
    const firstWrite = pauseNextWrite();
    const secondWrite = pauseNextWrite();
    const first = prepare();
    const second = prepare();
    await Promise.all([firstWrite.entered, secondWrite.entered]);
    firstWrite.resume();
    const winner = await first;
    const winnerKey = [...state.committed.values()][0].contentKey!;
    secondWrite.resume();
    expect((await second).selectedContext).toBe(winner.selectedContext);
    expect(state.committed.size).toBe(1);
    expect(mocks.createEvidence).toHaveBeenCalledTimes(1);
    expect(mocks.remove).toHaveBeenCalledTimes(1);
    expect([...files.keys()]).toEqual([winnerKey]);
    expect(mocks.read.mock.calls.at(-1)?.[0]).toBe(winnerKey);
  });

  it.each(["document", "image"])(
    "rejects an old token and cleans its unpublished %s",
    async (kind) => {
      const state = installBoundary();
      if (kind === "image")
        mocks.attachments.mockResolvedValue([
          { ...attachment, name: "reference.png" },
        ]);
      const writing = pauseNextWrite();
      const result = prepare();
      const rejected = expect(result).rejects.toMatchObject({
        code: "TASK_STOPPED",
      });
      await writing.entered;
      state.task.executionToken = "owner-2";
      writing.resume();
      await rejected;
      expect(state.committed.size).toBe(0);
      expect(mocks.createEvidence).not.toHaveBeenCalled();
      expect(mocks.remove).toHaveBeenCalledTimes(1);
      expect(files.size).toBe(0);
      expect(state.operations.indexOf("reference-check")).toBeLessThan(
        state.operations.indexOf("delete-file"),
      );
    },
  );

  it("rejects a cancelled task even if its token still matches", async () => {
    const state = installBoundary();
    state.task.status = "cancelled";
    await expect(prepare()).rejects.toMatchObject({ code: "TASK_STOPPED" });
    expect(mocks.createEvidence).not.toHaveBeenCalled();
    expect(files.size).toBe(0);
  });

  it("checks cancellation again after the locked unique lookup", async () => {
    const abort = new AbortController();
    const reason = Error("Cancelled during lookup");
    const state = installBoundary({ afterLookup: () => abort.abort(reason) });
    await expect(prepare(task(), abort.signal)).rejects.toBe(reason);
    expect(state.committed.size).toBe(0);
    expect(mocks.createEvidence).not.toHaveBeenCalled();
    expect(mocks.remove).toHaveBeenCalledTimes(1);
  });

  it("rolls back publication if cancellation arrives during the insert", async () => {
    const abort = new AbortController();
    const reason = Error("Cancelled during insert");
    const state = installBoundary({ afterCreate: () => abort.abort(reason) });
    await expect(prepare(task(), abort.signal)).rejects.toBe(reason);
    expect(mocks.createEvidence).toHaveBeenCalledTimes(1);
    expect(state.committed.size).toBe(0);
    expect(files.size).toBe(0);
  });

  it.each(["old-first", "new-first"])(
    "fences the cancelled owner while an explicit retry prepares concurrently (%s)",
    async (order) => {
      const state = installBoundary();
      const oldWrite = pauseNextWrite();
      const newWrite = pauseNextWrite();
      const abort = new AbortController();
      const old = prepare(task(), abort.signal);
      const rejected = expect(old).rejects.toThrow();
      await oldWrite.entered;
      state.task.status = "cancelled";
      abort.abort();
      state.task = { status: "running", executionToken: "owner-2" };
      const renewed = prepare(task("owner-2"));
      await newWrite.entered;
      if (order === "old-first") {
        oldWrite.resume();
        await rejected;
        newWrite.resume();
      } else {
        newWrite.resume();
        await renewed;
        oldWrite.resume();
      }
      const result = await renewed;
      await rejected;
      expect(result.selectedContext).toContain("Offline extracted document");
      expect(mocks.createEvidence).toHaveBeenCalledTimes(1);
      expect(state.committed.size).toBe(1);
      expect(mocks.remove).toHaveBeenCalledTimes(1);
      expect([...files.keys()]).toEqual([
        [...state.committed.values()][0].contentKey,
      ]);
    },
  );

  it("does no work when the signal was already aborted", async () => {
    installBoundary();
    const abort = new AbortController();
    abort.abort();
    await expect(prepare(task(), abort.signal)).rejects.toThrow();
    expect(mocks.attachments).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("does not allow a missing token to disable fencing", async () => {
    installBoundary();
    await expect(prepare(task(null))).rejects.toMatchObject({
      code: "TASK_STOPPED",
    });
    expect(mocks.attachments).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
});

describe.each(["document", "image"])("commit-unknown cleanup: %s", (kind) => {
  beforeEach(() => {
    if (kind === "image")
      mocks.attachments.mockResolvedValue([
        { ...attachment, name: "reference.png" },
      ]);
  });

  it("retains the published file after a lost COMMIT acknowledgement", async () => {
    const state = installBoundary({ publishFailure: "commit-ack-lost" });
    await expect(prepare()).rejects.toThrow("acknowledgement was lost");
    expect(state.committed.size).toBe(1);
    expect(state.operations).toContain("reference-check");
    expect(mocks.remove).not.toHaveBeenCalled();
    expect(files.size).toBe(1);
  });

  it("removes a rolled-back file only after a new locked reference check", async () => {
    const state = installBoundary({ publishFailure: "rolled-back" });
    await expect(prepare()).rejects.toThrow("rolled back");
    expect(state.committed.size).toBe(0);
    expect(mocks.lock).toHaveBeenCalledTimes(2);
    expect(state.operations.slice(-2)).toEqual([
      "reference-check",
      "delete-file",
    ]);
    expect(files.size).toBe(0);
  });

  it.each(["rolled-back", "commit-ack-lost"] as const)(
    "retains bytes when the outcome cannot be checked (%s)",
    async (publishFailure) => {
      const state = installBoundary({
        publishFailure,
        lookupUnavailable: true,
      });
      await expect(prepare()).rejects.toThrow();
      expect(state.operations).toContain("reference-check");
      expect(mocks.remove).not.toHaveBeenCalled();
      expect(files.size).toBe(1);
    },
  );
});
