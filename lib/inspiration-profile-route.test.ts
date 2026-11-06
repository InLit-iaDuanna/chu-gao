import { Discipline } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  checkSession: vi.fn(),
  userUpdate: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ checkSession: mocks.checkSession }));

vi.mock("@/lib/db", () => ({
  db: {
    user: { update: mocks.userUpdate },
  },
}));

import { PATCH } from "@/app/api/inspiration/profile/route";

const session = {
  status: "authenticated" as const,
  user: {
    id: "designer-1",
    email: "designer@example.com",
    role: "USER" as const,
    status: "ACTIVE" as const,
    sessionVersion: 1,
  },
};

function profileRequest(body: unknown) {
  return new Request("https://chugao.test/api/inspiration/profile", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.checkSession.mockResolvedValue(session);
});

describe("designer profile route", () => {
  it("rejects an invalid website or design discipline before updating", async () => {
    const invalidWebsite = await PATCH(
      profileRequest({ designerWebsite: "not a website" }),
    );
    const ftpWebsite = await PATCH(
      profileRequest({ designerWebsite: "ftp://portfolio.example.com" }),
    );
    const scriptWebsite = await PATCH(
      profileRequest({ designerWebsite: "javascript:alert(1)" }),
    );
    const invalidDiscipline = await PATCH(
      profileRequest({ designDisciplines: ["ARCHITECTURE"] }),
    );

    expect(invalidWebsite.status).toBe(400);
    expect(ftpWebsite.status).toBe(400);
    expect(scriptWebsite.status).toBe(400);
    expect(invalidDiscipline.status).toBe(400);
    await expect(invalidWebsite.json()).resolves.toMatchObject({
      ok: false,
      error: { code: "VALIDATION_ERROR" },
    });
    await expect(invalidDiscipline.json()).resolves.toMatchObject({
      ok: false,
      error: { code: "VALIDATION_ERROR" },
    });
    expect(mocks.userUpdate).not.toHaveBeenCalled();
  });

  it.each([
    "http://portfolio.example.com",
    "https://portfolio.example.com/work",
  ])("accepts an HTTP(S) website: %s", async (designerWebsite) => {
    const createdAt = new Date("2026-07-01T00:00:00.000Z");
    mocks.userUpdate.mockResolvedValue({
      id: "designer-1",
      email: "designer@example.com",
      name: "叶青",
      avatarKey: null,
      bio: null,
      designerTitle: null,
      designerLocation: null,
      designerWebsite,
      designDisciplines: [],
      createdAt,
    });

    const response = await PATCH(profileRequest({ designerWebsite }));

    expect(response.status).toBe(200);
    expect(mocks.userUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { designerWebsite } }),
    );
  });

  it("trims text, clears optional fields, and deduplicates disciplines", async () => {
    const createdAt = new Date("2026-07-01T00:00:00.000Z");
    mocks.userUpdate.mockResolvedValue({
      id: "designer-1",
      email: "designer@example.com",
      name: "叶青",
      avatarKey: null,
      bio: null,
      designerTitle: "体验设计师",
      designerLocation: "上海",
      designerWebsite: null,
      designDisciplines: [Discipline.SERVICE, Discipline.PRODUCT],
      createdAt,
    });

    const response = await PATCH(
      profileRequest({
        name: "  叶青  ",
        bio: "   ",
        designerTitle: "  体验设计师  ",
        designerLocation: "  上海  ",
        designerWebsite: "",
        designDisciplines: [
          Discipline.SERVICE,
          Discipline.PRODUCT,
          Discipline.SERVICE,
        ],
      }),
    );

    expect(response.status).toBe(200);
    expect(mocks.userUpdate).toHaveBeenCalledWith({
      where: { id: "designer-1" },
      data: {
        name: "叶青",
        bio: null,
        designerTitle: "体验设计师",
        designerLocation: "上海",
        designerWebsite: null,
        designDisciplines: [Discipline.SERVICE, Discipline.PRODUCT],
      },
      select: {
        id: true,
        email: true,
        name: true,
        avatarKey: true,
        bio: true,
        designerTitle: true,
        designerLocation: true,
        designerWebsite: true,
        designDisciplines: true,
        createdAt: true,
      },
    });
    await expect(response.json()).resolves.toEqual({
      ok: true,
      data: {
        id: "designer-1",
        email: "designer@example.com",
        name: "叶青",
        avatarUrl: null,
        bio: null,
        designerTitle: "体验设计师",
        designerLocation: "上海",
        designerWebsite: null,
        designDisciplines: [Discipline.SERVICE, Discipline.PRODUCT],
        joinedAt: createdAt.toISOString(),
      },
    });
  });
});
