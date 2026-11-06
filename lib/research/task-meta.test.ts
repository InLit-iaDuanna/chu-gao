import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  admin: vi.fn(),
  meta: vi.fn(),
  view: vi.fn(),
}));
vi.mock("@/lib/db", () => ({
  db: { researchTask: { findFirst: mocks.meta } },
}));
vi.mock("./http", () => ({
  researchAdmin: mocks.admin,
  researchFailure: (error: { code: string; status: number; message: string }) =>
    Response.json(
      { ok: false, error: { code: error.code, message: error.message } },
      { status: error.status ?? 503 },
    ),
}));
vi.mock("./service", () => ({ researchTaskView: mocks.view }));

import { GET } from "@/app/api/research/tasks/[id]/route";

describe("research task cursor", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.admin.mockResolvedValue({ userId: "admin-1", response: null });
  });
  it("returns only a cursor and status scoped to the owning administrator", async () => {
    mocks.meta.mockResolvedValue({
      id: "task-1",
      status: "running",
      nextSeq: 12,
    });
    const response = await GET(
      new Request("http://localhost/api/research/tasks/task-1?meta=1"),
      { params: Promise.resolve({ id: "task-1" }) },
    );
    expect(await response.json()).toMatchObject({
      ok: true,
      data: { id: "task-1", status: "running", nextSeq: 12 },
    });
    expect(mocks.meta).toHaveBeenCalledWith({
      where: { id: "task-1", userId: "admin-1" },
      select: { id: true, status: true, nextSeq: true },
    });
    expect(mocks.view).not.toHaveBeenCalled();
  });
  it("does not disclose another administrator's task", async () => {
    mocks.meta.mockResolvedValue(null);
    const response = await GET(
      new Request("http://localhost/api/research/tasks/other?meta=1"),
      { params: Promise.resolve({ id: "other" }) },
    );
    expect(response.status).toBe(404);
  });
  it("retains the normal snapshot route and rejects unauthenticated cursor reads", async () => {
    mocks.view.mockResolvedValue({ id: "task-1", status: "completed" });
    await GET(new Request("http://localhost/api/research/tasks/task-1"), {
      params: Promise.resolve({ id: "task-1" }),
    });
    expect(mocks.view).toHaveBeenCalledWith("admin-1", "task-1");
    mocks.admin.mockResolvedValue({
      userId: null,
      response: new Response(null, { status: 403 }),
    });
    const response = await GET(
      new Request("http://localhost/api/research/tasks/task-1?meta=1"),
      { params: Promise.resolve({ id: "task-1" }) },
    );
    expect(response.status).toBe(403);
    expect(mocks.meta).not.toHaveBeenCalled();
  });
});
