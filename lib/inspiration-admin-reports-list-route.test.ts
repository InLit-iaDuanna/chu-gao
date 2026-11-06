import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  checkSession: vi.fn(),
  reportFindMany: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  checkSession: mocks.checkSession,
  adminFailureResponse: () => null,
}));
vi.mock("@/lib/db", () => ({
  db: { contentReport: { findMany: mocks.reportFindMany } },
}));

import { GET } from "@/app/api/admin/inspiration/reports/route";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.checkSession.mockResolvedValue({
    status: "authenticated",
    user: {
      id: "admin-1",
      email: "admin@example.com",
      role: "ADMIN",
      status: "ACTIVE",
      sessionVersion: 1,
    },
  });
});

describe("admin inspiration report queue", () => {
  it("defaults to open reports and returns a bounded cursor page", async () => {
    mocks.reportFindMany.mockResolvedValue(
      Array.from({ length: 3 }, (_, index) => ({ id: `report-${index + 1}` })),
    );

    const response = await GET(
      new Request("https://chugao.test/api/admin/inspiration/reports?limit=2"),
    );

    expect(response.status).toBe(200);
    expect(mocks.reportFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: "OPEN" },
        orderBy: { createdAt: "desc" },
        take: 3,
      }),
    );
    await expect(response.json()).resolves.toEqual({
      ok: true,
      data: {
        items: [{ id: "report-1" }, { id: "report-2" }],
        nextCursor: "report-2",
      },
    });
  });

  it("rejects an oversized cursor before querying", async () => {
    const response = await GET(
      new Request(
        `https://chugao.test/api/admin/inspiration/reports?cursor=${"x".repeat(161)}`,
      ),
    );

    expect(response.status).toBe(400);
    expect(mocks.reportFindMany).not.toHaveBeenCalled();
  });
});
