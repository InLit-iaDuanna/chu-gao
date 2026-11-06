export type ResearchTaskLane = "research" | "intake";

export interface ResearchWorkerLaneRuntime<Task> {
  claim: (lane: ResearchTaskLane) => Promise<Task | null>;
  execute: (task: Task, abort: AbortController) => Promise<void>;
  maintain: () => Promise<void>;
  heartbeat: () => Promise<void>;
  interruptionReason: unknown;
}

function pause(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    if (signal.aborted) return resolve();
    const done = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal.addEventListener("abort", done, { once: true });
  });
}

/** Two fixed local execution loops; the database owns each global lane limit. */
export async function runResearchWorkerLanes<Task>(
  signal: AbortSignal,
  runtime: ResearchWorkerLaneRuntime<Task>,
) {
  if (signal.aborted) return;
  const controller = new AbortController();
  const active = new Map<ResearchTaskLane, AbortController>();
  const failures: unknown[] = [];
  const stop = () => {
    if (!controller.signal.aborted)
      controller.abort(runtime.interruptionReason);
    for (const task of active.values()) task.abort(controller.signal.reason);
  };
  signal.addEventListener("abort", stop, { once: true });

  const supervise = async (work: () => Promise<void>) => {
    try {
      await work();
    } catch (error) {
      if (!controller.signal.aborted) {
        failures.push(error);
        stop();
      }
    }
  };
  const executeLane = async (lane: ResearchTaskLane) => {
    while (!controller.signal.aborted) {
      const task = await runtime.claim(lane);
      if (task === null) {
        await pause(1000, controller.signal);
        continue;
      }
      const abort = new AbortController();
      active.set(lane, abort);
      // Shutdown may arrive while the claim transaction is in flight. The
      // claimed task must still settle through the normal fenced executor.
      if (controller.signal.aborted) abort.abort(controller.signal.reason);
      try {
        await runtime.execute(task, abort);
      } finally {
        active.delete(lane);
      }
    }
  };
  const periodically = async (ms: number, work: () => Promise<void>) => {
    while (!controller.signal.aborted) {
      await pause(ms, controller.signal);
      if (!controller.signal.aborted) await work();
    }
  };

  try {
    await runtime.heartbeat();
    if (controller.signal.aborted) return;
    await runtime.maintain();
    if (controller.signal.aborted) return;
    // Each rejection stops both lanes immediately; all work, including an
    // in-flight heartbeat or maintenance pass, is awaited before returning.
    await Promise.all([
      supervise(() => executeLane("research")),
      supervise(() => executeLane("intake")),
      supervise(() => periodically(5000, runtime.maintain)),
      supervise(() => periodically(8000, runtime.heartbeat)),
    ]);
    if (failures.length) throw failures[0];
  } finally {
    stop();
    signal.removeEventListener("abort", stop);
  }
}
