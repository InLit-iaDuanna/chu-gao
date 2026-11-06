// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  runResearchWorkerLanes,
  type ResearchTaskLane,
  type ResearchWorkerLaneRuntime,
} from "./worker-lanes";

type Task = { lane: ResearchTaskLane; id: string };
const stopping = new Error("synthetic worker interruption");
let controllers: AbortController[];
let runs: Promise<void>[];
let releasePending: Array<() => void>;

function deferred<T>(fallback: T) {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  releasePending.push(() => resolve(fallback));
  return { promise, resolve, reject };
}

function runtime(
  overrides: Partial<ResearchWorkerLaneRuntime<Task>> = {},
): ResearchWorkerLaneRuntime<Task> {
  return {
    claim: vi.fn(async () => null),
    execute: vi.fn(async () => {}),
    maintain: vi.fn(async () => {}),
    heartbeat: vi.fn(async () => {}),
    interruptionReason: stopping,
    ...overrides,
  };
}

function start(dependencies: ResearchWorkerLaneRuntime<Task>) {
  const controller = new AbortController();
  controllers.push(controller);
  const promise = runResearchWorkerLanes(controller.signal, dependencies);
  // A deliberately rejected lane is observed again by its assertion below.
  void promise.catch(() => {});
  runs.push(promise);
  return { controller, promise };
}

const flush = () => vi.advanceTimersByTimeAsync(0);

beforeEach(() => {
  controllers = [];
  runs = [];
  releasePending = [];
  vi.useFakeTimers();
});

afterEach(async () => {
  for (const controller of controllers) controller.abort();
  for (const release of releasePending) release();
  await Promise.allSettled(runs);
  vi.useRealTimers();
});

describe("two fixed research worker lanes", () => {
  it("runs research and intake together while serializing each local lane", async () => {
    const queues: Record<ResearchTaskLane, Task[]> = {
      research: [
        { lane: "research", id: "r1" },
        { lane: "research", id: "r2" },
      ],
      intake: [
        { lane: "intake", id: "i1" },
        { lane: "intake", id: "i2" },
      ],
    };
    const finishes = new Map(
      Object.values(queues)
        .flat()
        .map((task) => [task.id, deferred<void>(undefined)]),
    );
    const signals = new Map<string, AbortSignal>();
    const dependencies = runtime({
      claim: vi.fn(
        async (lane: ResearchTaskLane) => queues[lane].shift() ?? null,
      ),
      execute: vi.fn(async (task: Task, abort: AbortController) => {
        signals.set(task.id, abort.signal);
        await finishes.get(task.id)!.promise;
      }),
    });
    const worker = start(dependencies);
    await flush();
    expect([...signals.keys()].sort()).toEqual(["i1", "r1"]);
    await vi.advanceTimersByTimeAsync(3000);
    expect(dependencies.claim).toHaveBeenCalledTimes(2);

    finishes.get("r1")!.resolve();
    await flush();
    expect([...signals.keys()].sort()).toEqual(["i1", "r1", "r2"]);
    expect(signals.has("i2")).toBe(false);
    worker.controller.abort();
    expect(signals.get("r2")!.reason).toBe(stopping);
    expect(signals.get("i1")!.reason).toBe(stopping);
    finishes.get("r2")!.resolve();
    finishes.get("i1")!.resolve();
    await worker.promise;
    expect(dependencies.claim).toHaveBeenCalledTimes(3);
  });

  it("waits for both active executors to finish abort cleanup before returning", async () => {
    const finishes = {
      research: deferred<void>(undefined),
      intake: deferred<void>(undefined),
    };
    const signals = new Map<ResearchTaskLane, AbortSignal>();
    const worker = start(
      runtime({
        claim: vi.fn(async (lane: ResearchTaskLane) => ({ lane, id: lane })),
        execute: vi.fn(async (task: Task, abort: AbortController) => {
          signals.set(task.lane, abort.signal);
          await finishes[task.lane].promise;
        }),
      }),
    );
    let returned = false;
    void worker.promise.then(() => {
      returned = true;
    });
    await flush();
    worker.controller.abort();
    expect([...signals.values()].every((signal) => signal.aborted)).toBe(true);
    finishes.research.resolve();
    await flush();
    expect(returned).toBe(false);
    finishes.intake.resolve();
    await worker.promise;
    expect(returned).toBe(true);
  });

  it("a failed lane stops the other lane and waits for it before rejecting", async () => {
    const claimIntake = deferred<Task | null>(null);
    const finishResearch = deferred<void>(undefined);
    const failure = new Error("synthetic claim transaction failure");
    let researchSignal: AbortSignal | undefined;
    const dependencies = runtime({
      claim: vi.fn(async (lane: ResearchTaskLane) =>
        lane === "intake" ? claimIntake.promise : { lane, id: "r1" },
      ),
      execute: vi.fn(async (_task: Task, abort: AbortController) => {
        researchSignal = abort.signal;
        await finishResearch.promise;
      }),
    });
    const worker = start(dependencies);
    let returned = false;
    void worker.promise.catch(() => {
      returned = true;
    });
    await flush();
    claimIntake.reject(failure);
    await flush();
    expect(researchSignal?.reason).toBe(stopping);
    expect(returned).toBe(false);
    finishResearch.resolve();
    await expect(worker.promise).rejects.toBe(failure);
    expect(dependencies.execute).toHaveBeenCalledTimes(1);
  });

  it("settles an in-flight claim with an already aborted executor on shutdown", async () => {
    const claimResearch = deferred<Task | null>(null);
    const finishResearch = deferred<void>(undefined);
    let receivedSignal: AbortSignal | undefined;
    const dependencies = runtime({
      claim: vi.fn(async (lane: ResearchTaskLane) =>
        lane === "research" ? claimResearch.promise : null,
      ),
      execute: vi.fn(async (_task: Task, abort: AbortController) => {
        receivedSignal = abort.signal;
        await finishResearch.promise;
      }),
    });
    const worker = start(dependencies);
    let returned = false;
    void worker.promise.then(() => {
      returned = true;
    });
    await flush();
    worker.controller.abort();
    await flush();
    expect(dependencies.execute).not.toHaveBeenCalled();
    claimResearch.resolve({ lane: "research", id: "late-claim" });
    await flush();
    expect(receivedSignal?.reason).toBe(stopping);
    expect(returned).toBe(false);
    finishResearch.resolve();
    await worker.promise;
    expect(dependencies.claim).toHaveBeenCalledTimes(2);
  });

  it("shares maintenance between lanes and awaits pending maintenance and heartbeat", async () => {
    const finishMaintenance = deferred<void>(undefined);
    const finishHeartbeat = deferred<void>(undefined);
    const maintain = vi
      .fn<() => Promise<void>>()
      .mockResolvedValueOnce(undefined)
      .mockImplementation(() => finishMaintenance.promise);
    const heartbeat = vi
      .fn<() => Promise<void>>()
      .mockResolvedValueOnce(undefined)
      .mockImplementation(() => finishHeartbeat.promise);
    const worker = start(runtime({ maintain, heartbeat }));
    let returned = false;
    void worker.promise.then(() => {
      returned = true;
    });
    await flush();
    expect(maintain).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(15000);
    expect(maintain).toHaveBeenCalledTimes(2);
    expect(heartbeat).toHaveBeenCalledTimes(2);
    worker.controller.abort();
    finishMaintenance.resolve();
    await flush();
    expect(returned).toBe(false);
    finishHeartbeat.resolve();
    await worker.promise;
    expect(maintain).toHaveBeenCalledTimes(2);
    expect(heartbeat).toHaveBeenCalledTimes(2);
  });

  it("does no work if the parent was already stopped", async () => {
    const controller = new AbortController();
    controller.abort();
    const dependencies = runtime();
    await runResearchWorkerLanes(controller.signal, dependencies);
    expect(dependencies.heartbeat).not.toHaveBeenCalled();
    expect(dependencies.maintain).not.toHaveBeenCalled();
    expect(dependencies.claim).not.toHaveBeenCalled();
  });
});
