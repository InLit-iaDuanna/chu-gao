import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ToastProvider } from "@/components/ui";

import { inspirationRequest } from "./api";
import { ReportDialog } from "./ReportDialog";

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

describe("ReportDialog", () => {
  beforeEach(() => {
    vi.mocked(inspirationRequest).mockReset();
  });

  it("requires a selected reason and submits the optional explanation", async () => {
    const user = userEvent.setup();
    vi.mocked(inspirationRequest).mockResolvedValue({ id: "report-1" });

    render(
      <ToastProvider>
        <ReportDialog postId="post-1" />
      </ToastProvider>,
    );

    await user.click(screen.getByRole("button", { name: "举报内容" }));
    expect(
      screen.getByRole("dialog", { name: "举报这条内容" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "提交举报" })).toBeDisabled();

    await user.click(screen.getByRole("radio", { name: /广告或刷屏/ }));
    await user.type(
      screen.getByRole("textbox", { name: /补充说明/ }),
      "同一推广内容被重复发布。",
    );
    await user.click(screen.getByRole("button", { name: "提交举报" }));

    await waitFor(() => {
      expect(inspirationRequest).toHaveBeenCalledWith(
        "/api/inspiration/posts/post-1/report",
        {
          method: "POST",
          body: JSON.stringify({
            reason: "SPAM",
            note: "同一推广内容被重复发布。",
          }),
        },
      );
    });
    expect(await screen.findByText("举报已提交")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("targets a specific comment from the discussion thread", async () => {
    const user = userEvent.setup();
    vi.mocked(inspirationRequest).mockResolvedValue({ id: "report-2" });

    render(
      <ToastProvider>
        <ReportDialog postId="post-1" commentId="comment-1" />
      </ToastProvider>,
    );

    await user.click(screen.getByRole("button", { name: "举报内容" }));
    expect(
      screen.getByRole("dialog", { name: "举报这条评论" }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("radio", { name: /骚扰或攻击/ }));
    await user.click(screen.getByRole("button", { name: "提交举报" }));

    await waitFor(() => {
      expect(inspirationRequest).toHaveBeenCalledWith(
        "/api/inspiration/posts/post-1/report",
        {
          method: "POST",
          body: JSON.stringify({
            reason: "HARASSMENT",
            note: null,
            commentId: "comment-1",
          }),
        },
      );
    });
  });
});
