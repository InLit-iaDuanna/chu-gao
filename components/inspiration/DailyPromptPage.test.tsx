import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { inspirationRequest } from "./api";
import { DailyPromptPage } from "./DailyPromptPage";

vi.mock("./api", () => ({
  inspirationRequest: vi.fn(),
  InspirationApiError: class InspirationApiError extends Error {
    constructor(
      public code: string,
      message: string,
      public status: number,
    ) {
      super(message);
    }
  },
  loginForCurrentPage: vi.fn(),
}));

describe("DailyPromptPage", () => {
  beforeEach(() => {
    vi.mocked(inspirationRequest).mockReset();
  });

  it("uses the server follow state and explicitly unfollows the discipline", async () => {
    const user = userEvent.setup();
    vi.mocked(inspirationRequest).mockImplementation(async (path) => {
      if (path === "/api/inspiration/daily") {
        return {
          prompt: {
            id: "prompt-1",
            day: "2026-08-04",
            discipline: "SERVICE",
            title: "留住有价值的分歧",
            prompt: "把分歧转化成可以继续讨论的设计材料。",
            keywords: ["协作"],
            questionPost: null,
            features: [],
            responses: [],
            viewer: { isFollowingDiscipline: true },
          },
        };
      }
      if (path === "/api/inspiration/follows") return { following: false };
      throw new Error(`Unexpected request: ${path}`);
    });

    render(<DailyPromptPage basePath="/app/inspiration" />);

    const button = await screen.findByRole("button", {
      name: "已关注这个学科",
    });
    expect(screen.getByRole("link", { name: "灵感广场" })).toHaveAttribute(
      "href",
      "/app/inspiration",
    );
    expect(button).toHaveAttribute("aria-pressed", "true");
    await user.click(button);

    await waitFor(() => {
      expect(inspirationRequest).toHaveBeenCalledWith(
        "/api/inspiration/follows",
        {
          method: "POST",
          body: JSON.stringify({
            targetType: "DISCIPLINE",
            targetKey: "SERVICE",
            following: false,
          }),
        },
      );
    });
    expect(
      await screen.findByRole("button", { name: "关注这个学科" }),
    ).toHaveAttribute("aria-pressed", "false");
  });
});
