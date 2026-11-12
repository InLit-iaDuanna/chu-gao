import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ConversationSidebar } from "./ConversationSidebar";

describe("conversation navigation", () => {
  it("keeps only settings in the footer and removes retired tools", () => {
    render(
      <ConversationSidebar
        pathname="/app/history"
        threads={[]}
        activeId={null}
        disabled={false}
        loading={false}
        error={null}
        onSelect={vi.fn()}
        onNew={vi.fn()}
        onReload={vi.fn()}
      />,
    );

    const footer = screen.getByRole("navigation", { name: "设置导航" });
    expect(within(footer).getAllByRole("link")).toHaveLength(1);
    expect(within(footer).getByRole("link", { name: "设置" })).toHaveAttribute(
      "href",
      "/app/settings",
    );
    const primary = screen.getByRole("navigation", { name: "创作导航" });
    expect(
      within(primary).getByRole("link", { name: "历史图片" }),
    ).toHaveAttribute("aria-current", "page");
    expect(within(primary).getByRole("link", { name: "PPT" })).toHaveAttribute(
      "href",
      "/app/ppt",
    );
    expect(
      within(primary).getByRole("link", { name: "节点画布" }),
    ).toHaveAttribute("href", "/app/nodes");
    expect(
      screen.queryByRole("link", { name: "节点" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "画布" }),
    ).not.toBeInTheDocument();
  });

  it("offers per-thread deletion without affecting other thread actions", async () => {
    const onDelete = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("confirm", vi.fn(() => true));
    render(
      <ConversationSidebar
        threads={[
          {
            id: "thread-a",
            title: "调研市场",
            latestMessage: "结论",
            lastMessageAt: "2026-11-08",
            createdAt: "2026-11-08",
            thumbnailUrl: null,
            generationCount: 0,
          },
        ]}
        activeId="thread-a"
        disabled={false}
        loading={false}
        error={null}
        onSelect={vi.fn()}
        onNew={vi.fn()}
        onDelete={onDelete}
        onReload={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "删除对话 调研市场" }));
    expect(onDelete).toHaveBeenCalledWith("thread-a");
  });
});
