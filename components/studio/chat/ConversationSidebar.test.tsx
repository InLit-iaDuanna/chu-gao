import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
        onRename={vi.fn()}
        onDelete={vi.fn()}
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
      within(primary).getByRole("link", { name: "设计画布" }),
    ).toHaveAttribute("href", "/app/canvas");
    expect(
      screen.queryByRole("link", { name: "节点" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "画布" }),
    ).not.toBeInTheDocument();
  });

  it("renames a conversation from its actions menu", async () => {
    const user = userEvent.setup();
    const onRename = vi.fn().mockResolvedValue(undefined);
    render(
      <ConversationSidebar
        threads={[
          {
            id: "thread-1",
            title: "庭院方案",
            lastMessageAt: "2026-01-01T00:00:00.000Z",
            createdAt: "2026-01-01T00:00:00.000Z",
            latestMessage: null,
            thumbnailUrl: null,
            generationCount: 0,
          },
        ]}
        activeId={null}
        disabled={false}
        loading={false}
        error={null}
        onSelect={vi.fn()}
        onNew={vi.fn()}
        onReload={vi.fn()}
        onRename={onRename}
        onDelete={vi.fn()}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: "对话操作：庭院方案" }),
    );
    await user.click(await screen.findByRole("menuitem", { name: "重命名" }));
    const input = screen.getByRole("textbox", { name: "对话名称" });
    await user.clear(input);
    await user.type(input, "庭院新方案");
    await user.click(screen.getByRole("button", { name: "保存" }));

    expect(onRename).toHaveBeenCalledWith("thread-1", "庭院新方案");
  });

  it("asks for confirmation before deleting a conversation", async () => {
    const user = userEvent.setup();
    const onDelete = vi.fn().mockResolvedValue(undefined);
    render(
      <ConversationSidebar
        threads={[
          {
            id: "thread-1",
            title: "庭院方案",
            lastMessageAt: "2026-01-01T00:00:00.000Z",
            createdAt: "2026-01-01T00:00:00.000Z",
            latestMessage: null,
            thumbnailUrl: null,
            generationCount: 0,
          },
        ]}
        activeId={null}
        disabled={false}
        loading={false}
        error={null}
        onSelect={vi.fn()}
        onNew={vi.fn()}
        onReload={vi.fn()}
        onRename={vi.fn()}
        onDelete={onDelete}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: "对话操作：庭院方案" }),
    );
    await user.click(await screen.findByRole("menuitem", { name: "删除" }));
    expect(
      screen.getByRole("dialog", { name: "删除对话" }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "删除" }));

    expect(onDelete).toHaveBeenCalledWith("thread-1");
  });
});
