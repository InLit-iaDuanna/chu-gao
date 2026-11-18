import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  calls: vi.fn(),
  users: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({
  checkSession: mocks.session,
  adminFailureResponse: (session: {
    status: string;
    user?: { role: string };
  }) =>
    session.status !== "authenticated"
      ? new Response("", { status: 401 })
      : session.user?.role !== "ADMIN"
        ? new Response("", { status: 403 })
        : null,
}));
vi.mock("@/lib/db", () => ({
  db: {
    modelCallLog: { findMany: mocks.calls },
    user: { findMany: mocks.users },
  },
}));
import { GET } from "@/app/api/admin/model-calls/route";
const run = (query = "") =>
  GET(new Request(`https://example.test/api/admin/model-calls?${query}`));
beforeEach(() => {
  vi.clearAllMocks();
  mocks.session.mockResolvedValue({
    status: "authenticated",
    user: { role: "ADMIN" },
  });
  mocks.calls.mockResolvedValue([]);
  mocks.users.mockResolvedValue([]);
});
describe("admin call records", () => {
  it("blocks non-admins before reading records", async () => {
    mocks.session.mockResolvedValue({
      status: "authenticated",
      user: { role: "USER" },
    });
    expect((await run()).status).toBe(403);
    expect(mocks.calls).not.toHaveBeenCalled();
  });
  it("filters API failures separately and correlates an exact image task", async () => {
    expect(
      (
        await run(
          "kind=image&source=api&status=FAILED&generationId=g-1&limit=NaN",
        )
      ).status,
    ).toBe(200);
    expect(mocks.calls).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          kind: "image",
          source: "api",
          status: "FAILED",
          generationId: "g-1",
        }),
        take: 51,
      }),
    );
  });
  it("rejects invalid filters and pagination", async () => {
    expect((await run("kind=other")).status).toBe(400);
    expect((await run("cursor=bad")).status).toBe(400);
    expect((await run("from=2026-02-31")).status).toBe(400);
    expect(mocks.calls).not.toHaveBeenCalled();
  });
  it("uses stable time and ID pagination when two calls start together", async () => {
    const startedAt = new Date("2026-11-07T08:00:00Z");
    mocks.calls.mockResolvedValueOnce([
      { id: "b", startedAt, userId: null, errorMessage: "key=sk-secret" },
      { id: "a", startedAt, userId: null, errorMessage: null },
    ]);
    const first = (await (await run("limit=1")).json()).data;
    expect(first.items).toHaveLength(1);
    expect(first.items[0].errorMessage).not.toContain("sk-secret");
    await run(`limit=1&cursor=${first.nextCursor}`);
    expect(mocks.calls.mock.calls[1][0].where.AND).toContainEqual({
      OR: [{ startedAt: { lt: startedAt } }, { startedAt, id: { lt: "b" } }],
    });
  });
});
