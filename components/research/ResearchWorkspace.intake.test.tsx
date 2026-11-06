import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ComponentProps } from "react";
import type { ResearchPlan } from "@/lib/research/types";
import { ResearchWorkspace } from "./ResearchWorkspace";

type IntakeProps = ComponentProps<
  typeof import("./ResearchIntake").ResearchIntake
>;
const intake = vi.hoisted(() => ({ props: null as IntakeProps | null }));
vi.mock("./ResearchIntake", () => ({
  ResearchIntake: (props: IntakeProps) => {
    intake.props = props;
    return <p>需求访谈测试入口</p>;
  },
}));

const plan: ResearchPlan = {
  preset: "research",
  reason: "依据已确认需求安排研究步骤",
  stages: [{ kind: "research", engine: "gpt-researcher" }],
  products: ["report"],
  limits: { llm: 30, search: 20, crawl: 30, minutes: 25 },
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const ok = (data: unknown) => Response.json({ ok: true, data });

function installApi(
  handle: (
    url: string,
    init?: RequestInit,
  ) => Promise<Response> | undefined = () => undefined,
) {
  const fetchMock = vi.fn((value: RequestInfo | URL, init?: RequestInit) => {
    const url = String(value);
    const special = handle(url, init);
    if (special) return special;
    if (url === "/api/research/projects")
      return Promise.resolve(
        ok(init?.method === "POST" ? { id: "project-1" } : []),
      );
    if (url === "/api/admin/research")
      return Promise.resolve(
        ok({ ready: true, workerReady: true, modelReady: true, services: [] }),
      );
    if (url === "/api/conversations/chat")
      return Promise.resolve(
        ok({
          models: [
            {
              id: "gpt-6.1-sol",
              displayName: "Sol",
              reasoningEfforts: ["low", "medium"],
              defaultReasoningEffort: "low",
              credits: 0.2,
              supportsVision: false,
              maxReferenceImages: 0,
            },
          ],
        }),
      );
    if (url === "/api/research/plan") return Promise.resolve(ok(plan));
    throw new Error(`Unexpected workspace request: ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

async function mount() {
  await act(async () => {
    render(<ResearchWorkspace />);
  });
  expect(intake.props).not.toBeNull();
}
async function ready(question = "研究办公室午餐设备的实际使用流程") {
  await act(async () => {
    const props = intake.props!;
    props.onDraft(
      { ...props.input.brief, question },
      true,
      ["report"],
      undefined,
      "intake-confirmed-1",
    );
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(300);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  intake.props = null;
  sessionStorage.clear();
  window.history.replaceState(null, "", "/app/research");
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("research intake handoff and view identity", () => {
  it("locks advanced settings while an intake reply or its receipt is pending", async () => {
    installApi();
    await mount();
    await act(async () => intake.props!.onPendingChange?.(true));
    expect(
      screen.getByText("高级设置（可选）").closest("fieldset"),
    ).toBeDisabled();
    await act(async () => intake.props!.onPendingChange?.(false));
    expect(
      screen.getByText("高级设置（可选）").closest("fieldset"),
    ).not.toBeDisabled();
  });

  it("keeps settings and technical steps optional, then starts with the displayed intake revision", async () => {
    const submission = deferred<Response>();
    const requests = installApi((url) =>
      url === "/api/research/tasks" ? submission.promise : undefined,
    );
    await mount();
    expect(
      screen.getByText("高级设置（可选）").closest("details"),
    ).not.toHaveAttribute("open");
    expect(
      screen.queryByRole("button", { name: "开始研究" }),
    ).not.toBeInTheDocument();
    await ready();
    expect(
      screen.getByText("查看研究步骤").closest("details"),
    ).not.toHaveAttribute("open");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "开始研究" }));
    });
    const sent = requests.mock.calls.find(
      ([url]) => String(url) === "/api/research/tasks",
    );
    const payload = JSON.parse(String(sent?.[1]?.body));
    expect(payload.intakeTaskId).toBe("intake-confirmed-1");
    expect(payload.brief.question).toBe("研究办公室午餐设备的实际使用流程");
    expect(payload.preset).toBe("auto");
    await act(async () => {
      submission.resolve(
        Response.json(
          { ok: false, error: { message: "离线结束" } },
          { status: 503 },
        ),
      );
    });
  });

  it("invalidates the old start action immediately when the interview receives a correction", async () => {
    const requests = installApi();
    await mount();
    await ready();
    expect(screen.getByRole("button", { name: "开始研究" })).toBeEnabled();
    await act(async () => {
      const props = intake.props!;
      props.onDraft(props.input.brief, false, props.input.products);
    });
    expect(
      screen.queryByRole("button", { name: "开始研究" }),
    ).not.toBeInTheDocument();
    expect(
      requests.mock.calls.some(
        ([url]) => String(url) === "/api/research/tasks",
      ),
    ).toBe(false);
  });

  it("does not accept a delayed plan for a previous brief even when fetch ignores abort", async () => {
    const first = deferred<Response>();
    const second = deferred<Response>();
    let plans = 0;
    installApi((url) =>
      url === "/api/research/plan"
        ? ++plans === 1
          ? first.promise
          : second.promise
        : undefined,
    );
    await mount();
    await ready("研究宿舍午餐设备");
    await ready("改为研究办公室午餐设备");
    await act(async () => {
      first.resolve(ok(plan));
    });
    expect(screen.getByRole("button", { name: "开始研究" })).toBeDisabled();
    await act(async () => {
      second.resolve(ok(plan));
    });
    expect(screen.getByRole("button", { name: "开始研究" })).toBeEnabled();
  });

  it("revokes a stale tab's start action and reloads the interview after a server revision conflict", async () => {
    installApi((url) =>
      url === "/api/research/tasks"
        ? Promise.resolve(
            Response.json(
              {
                ok: false,
                error: {
                  code: "INTAKE_CHANGED",
                  message: "需求对话已有更新，已重新读取当前摘要",
                },
              },
              { status: 409 },
            ),
          )
        : undefined,
    );
    await mount();
    await ready();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "开始研究" }));
    });
    expect(
      screen.queryByRole("button", { name: "开始研究" }),
    ).not.toBeInTheDocument();
    expect(sessionStorage.getItem("chugao.research.pending.v1")).toBeNull();
    expect(intake.props!.projectId).toBe("project-1");
    expect(intake.props!.disabled).toBe(false);
  });

  it("coalesces project creation and rejects an old response after the user opens a new research", async () => {
    const creation = deferred<Response>();
    const requests = installApi((url, init) =>
      url === "/api/research/projects" && init?.method === "POST"
        ? creation.promise
        : undefined,
    );
    await mount();
    let completion!: Promise<PromiseSettledResult<string>[]>;
    await act(async () => {
      completion = Promise.allSettled([
        intake.props!.ensureProject(),
        intake.props!.ensureProject(),
      ]);
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "新研究" }));
    });
    await act(async () => {
      creation.resolve(ok({ id: "old-project" }));
    });
    expect(
      (await completion).every((result) => result.status === "rejected"),
    ).toBe(true);
    expect(
      requests.mock.calls.filter(
        ([url, init]) =>
          String(url) === "/api/research/projects" && init?.method === "POST",
      ),
    ).toHaveLength(1);
    expect(intake.props!.projectId).toBe("");
    expect(window.location.search).toBe("");
  });

  it("keeps a delayed start response in its original project without reopening it over a new draft", async () => {
    const submission = deferred<Response>();
    const requests = installApi((url) =>
      url === "/api/research/tasks" ? submission.promise : undefined,
    );
    await mount();
    await ready();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "开始研究" }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "新研究" }));
    });
    await act(async () => {
      submission.resolve(ok({ id: "old-task" }));
    });
    expect(
      requests.mock.calls.some(
        ([url]) => String(url) === "/api/research/tasks/old-task",
      ),
    ).toBe(false);
    expect(intake.props!.projectId).toBe("");
    expect(intake.props!.disabled).toBe(false);
    expect(window.location.search).toBe("");
  });

  it("does not attach an old upload to the next draft", async () => {
    const upload = deferred<Response>();
    installApi((url) =>
      url === "/api/research/uploads" ? upload.promise : undefined,
    );
    await mount();
    await act(async () => {
      fireEvent.change(document.querySelector('input[type="file"]')!, {
        target: {
          files: [new File(["reference"], "notes.txt", { type: "text/plain" })],
        },
      });
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "新研究" }));
    });
    await act(async () => {
      upload.resolve(ok({ key: "attachment:old", filename: "notes.txt" }));
    });
    expect(intake.props!.input.brief.attachmentKeys).toEqual([]);
    expect(intake.props!.projectId).toBe("");
    expect(intake.props!.disabled).toBe(false);
  });
});
