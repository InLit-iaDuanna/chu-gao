import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  references: vi.fn(),
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
vi.mock("@/lib/chat-references", () => ({
  resolveChatReferences: mocks.references,
}));
vi.mock("@/lib/creative-vision", () => ({
  requestStructuredVision: mocks.vision,
}));

import { POST } from "@/app/api/creative/inspect/route";

const request = (value: unknown) =>
  new Request("http://localhost/api/creative/inspect", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(value),
  });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.references.mockResolvedValue([
    {
      type: "image_url",
      image_url: { url: "data:image/jpeg;base64,AA==", detail: "auto" },
    },
  ]);
  mocks.vision.mockResolvedValue({
    subject: "一段坡道",
    composition: "画面中心为向前延伸的道路",
    style: "写实",
    constraints: ["道路坡度清晰可见"],
    risks: [],
    confidence: "high",
    summary: "画面包含一段向前延伸的坡道。",
  });
});

describe("creative reference inspection endpoint", () => {
  it("resolves private references and returns a planner-safe summary", async () => {
    const response = await POST(
      request({
        referenceImageKeys: ["uploads/user-1/ref.png"],
        sourceImageIds: ["image-1"],
      }),
    );

    expect(response.status).toBe(200);
    expect(mocks.references).toHaveBeenCalledWith(
      "user-1",
      ["uploads/user-1/ref.png"],
      ["image-1"],
    );
    expect((await response.json()).data.referenceSummary).toContain(
      "主体：一段坡道",
    );
  });

  it("rejects empty references before invoking storage or vision", async () => {
    const response = await POST(request({}));

    expect(response.status).toBe(400);
    expect(mocks.references).not.toHaveBeenCalled();
    expect(mocks.vision).not.toHaveBeenCalled();
  });
});
