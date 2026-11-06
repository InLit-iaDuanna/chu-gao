import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  image: vi.fn(),
  read: vi.fn(),
  part: vi.fn(),
  vision: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  checkSession: async () => ({
    status: "authenticated",
    user: { id: "user-1" },
  }),
}));
vi.mock("@/lib/creative-config", () => ({
  creativeAssistantEnabled: () => true,
}));
vi.mock("@/lib/api-rate-limit", () => ({
  userActionRateLimitResponse: async () => null,
}));
vi.mock("@/lib/db", () => ({
  db: { generatedImage: { findFirst: mocks.image } },
}));
vi.mock("@/lib/storage", () => ({
  readPrivateStorageKey: mocks.read,
}));
vi.mock("@/lib/creative-vision", () => ({
  toVisionImagePart: mocks.part,
  requestStructuredVision: mocks.vision,
}));

import { POST } from "@/app/api/creative/check/route";

const brief = {
  goal: "修改栏杆",
  keep: "保持道路坡度",
  change: "改成细金属栏杆",
  avoid: "不要新增建筑",
  style: "写实",
};
const request = (value: unknown) =>
  new Request("http://localhost/api/creative/check", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(value),
  });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.image.mockResolvedValue({ storageKey: "generated/g-1/1.png" });
  mocks.read.mockResolvedValue(Buffer.from("image"));
  mocks.part.mockResolvedValue({
    type: "image_url",
    image_url: { url: "data:image/jpeg;base64,AA==", detail: "auto" },
  });
  mocks.vision.mockResolvedValue({
    status: "review",
    score: 82,
    summary: "大部分要求可见，栏杆细节需要人工确认。",
    findings: ["远处栏杆无法从单张图确认"],
  });
});

describe("creative result check endpoint", () => {
  it("checks an owned generated image against the submitted brief", async () => {
    const response = await POST(
      request({ generationId: "g-1", imageId: "image-1", brief }),
    );

    expect(response.status).toBe(200);
    expect(mocks.image).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: "image-1",
          generationId: "g-1",
          generation: { userId: "user-1", deletedAt: null },
        },
      }),
    );
    expect((await response.json()).data).toMatchObject({
      generationId: "g-1",
      imageId: "image-1",
      status: "review",
    });
  });

  it("does not send a missing image to the vision model", async () => {
    mocks.image.mockResolvedValue(null);
    const response = await POST(
      request({ generationId: "g-1", imageId: "missing", brief }),
    );

    expect(response.status).toBe(404);
    expect(mocks.vision).not.toHaveBeenCalled();
  });
});
