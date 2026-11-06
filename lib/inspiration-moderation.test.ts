import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertAllowed: vi.fn(),
  recordAttempt: vi.fn(),
  isPromptBlocked: vi.fn(),
  rejectionCreate: vi.fn(),
  loggerWarn: vi.fn(),
  wishIdentity: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: { moderationRejection: { create: mocks.rejectionCreate } },
}));
vi.mock("@/lib/logger", () => ({
  logger: { warn: mocks.loggerWarn },
}));
vi.mock("@/lib/moderation", () => ({
  isPromptBlocked: mocks.isPromptBlocked,
}));
vi.mock("@/lib/rate-limit", () => ({
  assertModerationRejectionAllowed: mocks.assertAllowed,
  recordModerationRejectionAttempt: mocks.recordAttempt,
}));
vi.mock("@/lib/wish-pool", () => ({
  wishIdentity: mocks.wishIdentity,
}));

import { isInspirationTextBlocked } from "@/lib/inspiration-moderation";

const user = {
  id: "user-1",
  email: "designer@example.com",
  role: "USER" as const,
  status: "ACTIVE" as const,
  sessionVersion: 1,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.assertAllowed.mockResolvedValue(undefined);
  mocks.recordAttempt.mockResolvedValue(undefined);
  mocks.rejectionCreate.mockResolvedValue({ id: "rejection-1" });
  mocks.wishIdentity.mockReturnValue({ ipHash: "hashed-ip" });
});

describe("inspiration moderation persistence", () => {
  it("does not create rejection records for allowed text", async () => {
    mocks.isPromptBlocked.mockResolvedValue(false);

    const blocked = await isInspirationTextBlocked({
      request: new Request("https://chugao.test/api/inspiration/posts"),
      user,
      text: "正常的设计讨论",
      surface: "POST_CREATE",
    });

    expect(blocked).toBe(false);
    expect(mocks.recordAttempt).not.toHaveBeenCalled();
    expect(mocks.rejectionCreate).not.toHaveBeenCalled();
  });

  it("records a blocked attempt for throttling and moderation review", async () => {
    mocks.isPromptBlocked.mockResolvedValue(true);

    const blocked = await isInspirationTextBlocked({
      request: new Request("https://chugao.test/api/inspiration/posts", {
        headers: { "x-forwarded-for": "203.0.113.8" },
      }),
      user,
      text: "被关键词拦截的内容",
      surface: "POST_EDIT",
    });

    expect(blocked).toBe(true);
    expect(mocks.recordAttempt).toHaveBeenCalledWith("user-1", undefined, {
      reason: "blocked_keyword",
      surface: "POST_EDIT",
    });
    expect(mocks.rejectionCreate).toHaveBeenCalledWith({
      data: {
        userId: "user-1",
        ip: "hashed-ip",
        prompt: "被关键词拦截的内容",
        reason: "inspiration:post_edit:blocked_keyword",
      },
    });
  });

  it("still blocks content if audit persistence temporarily fails", async () => {
    mocks.isPromptBlocked.mockResolvedValue(true);
    mocks.rejectionCreate.mockRejectedValue(new Error("database unavailable"));

    await expect(
      isInspirationTextBlocked({
        request: new Request("https://chugao.test/api/inspiration/comments/1"),
        user,
        text: "被拦截的评论",
        surface: "COMMENT_EDIT",
      }),
    ).resolves.toBe(true);
    expect(mocks.loggerWarn).toHaveBeenCalled();
  });
});
