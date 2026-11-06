import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  config: vi.fn(),
  fetch: vi.fn(),
  limit: vi.fn(),
  enabled: vi.fn(),
}));
vi.mock("@/lib/creative-config", () => ({
  creativeAssistantEnabled: mocks.enabled,
}));
vi.mock("@/lib/auth", () => ({ checkSession: mocks.session }));
vi.mock("@/lib/ai-config", () => ({ getConversationConfig: mocks.config }));
vi.mock("@/lib/http", () => ({ fetchWithTimeout: mocks.fetch }));
vi.mock("@/lib/api-rate-limit", () => ({
  userActionRateLimitResponse: mocks.limit,
}));
import { POST } from "@/app/api/creative/plan/route";
import { EMPTY_CREATIVE_BRIEF } from "./creative-brief";
const brief = {
  ...EMPTY_CREATIVE_BRIEF,
  goal: "改造栏杆",
  keep: "保留坡度",
  avoid: "不要新建筑",
};
const run = (overrides: Record<string, unknown> = {}) =>
  POST(
    new Request("https://example.test/api/creative/plan", {
      method: "POST",
      body: JSON.stringify({
        instruction: "改用金属栏杆",
        brief,
        locked: ["keep", "avoid"],
        hasBase: true,
        ...overrides,
      }),
    }),
  );
beforeEach(() => {
  vi.resetAllMocks();
  mocks.enabled.mockReturnValue(true);
  mocks.session.mockResolvedValue({
    status: "authenticated",
    user: { id: "user-1" },
  });
  mocks.config.mockResolvedValue({
    enabled: true,
    apiKey: "test-key",
    model: "planner",
    baseUrl: "https://example.test",
  });
  mocks.fetch.mockResolvedValue(
    new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                brief: {
                  ...brief,
                  keep: "改平坡道",
                  avoid: "添加新建筑",
                  change: "金属栏杆",
                },
                questions: [],
              }),
            },
          },
        ],
      }),
    ),
  );
});
describe("creative planning endpoint", () => {
  it("keeps the feature disabled without invoking authentication or a model", async () => {
    mocks.enabled.mockReturnValue(false);
    expect((await run()).status).toBe(503);
    expect(mocks.session).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
  it("keeps locks server-side and makes only a single non-generating request", async () => {
    const response = await run();
    expect(response.status).toBe(200);
    const data = (await response.json()).data;
    expect(data.brief).toMatchObject({
      keep: brief.keep,
      avoid: brief.avoid,
      change: "金属栏杆",
    });
    expect(mocks.fetch).toHaveBeenCalledOnce();
    const [url, init] = mocks.fetch.mock.calls[0];
    expect(url).toBe("https://example.test/v1/chat/completions");
    expect(init.retry).toBeUndefined();
    expect(JSON.parse(init.body).tools).toBeUndefined();
  });
  it("forwards prior agent turns so follow-up instructions keep their context", async () => {
    await run({
      history: [
        { role: "user", content: "保留原有坡度" },
        { role: "assistant", content: "我会把坡度作为保持不变的约束。" },
      ],
    });
    const [, init] = mocks.fetch.mock.calls[0];
    const body = JSON.parse(init.body);
    expect(body.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: "user",
          content: expect.stringContaining("保留原有坡度"),
        }),
        expect.objectContaining({
          role: "assistant",
          content: expect.stringContaining("坡度作为保持不变"),
        }),
      ]),
    );
  });
  it("does not invent a plan if the model is unavailable", async () => {
    mocks.config.mockResolvedValue({ enabled: false });
    expect((await run()).status).toBe(503);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
  it("rejects malformed model output instead of overwriting the draft", async () => {
    mocks.fetch.mockResolvedValue(
      new Response(
        JSON.stringify({ choices: [{ message: { content: "not json" } }] }),
      ),
    );
    expect((await run()).status).toBe(503);
  });
  it("requires authentication before invoking the planner", async () => {
    mocks.session.mockResolvedValue({ status: "unauthenticated" });
    expect((await run()).status).toBe(401);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
  it("honors rate limits before invoking the planner", async () => {
    mocks.limit.mockResolvedValue(new Response(null, { status: 429 }));
    expect((await run()).status).toBe(429);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
});
