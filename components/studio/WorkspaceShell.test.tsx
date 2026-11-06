import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEffect, type ComponentProps, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  pathname: "/app/history",
  push: vi.fn(),
  list: vi.fn(),
  update: vi.fn(),
  me: vi.fn(),
  select: vi.fn(),
  newConversation: vi.fn(),
  updateConversation: vi.fn(),
  redirect: vi.fn((href: string) => {
    throw new Error("redirect:" + href);
  }),
}));
vi.mock("next/navigation", () => ({
  usePathname: () => mocks.pathname,
  useRouter: () => ({ push: mocks.push }),
  redirect: mocks.redirect,
}));
vi.mock("next/link", () => ({
  default: ({ href, children, onClick, ...props }: ComponentProps<"a">) => (
    <a
      href={href}
      {...props}
      onClick={(event) => {
        event.preventDefault();
        onClick?.(event);
      }}
    >
      {children}
    </a>
  ),
}));
vi.mock("./lib/api", () => ({
  getMe: mocks.me,
  listConversations: mocks.list,
  updateConversation: mocks.update,
}));
vi.mock("./TopBar", () => ({
  TopBar: ({ title, leading }: { title: string; leading: ReactNode }) => (
    <header>
      {leading}
      <span>{title}</span>
    </header>
  ),
}));

import {
  WorkspaceShell,
  WorkspaceSidebarToggle,
  useWorkspaceNavigation,
} from "./WorkspaceShell";
import CanvasPage from "@/app/(app)/app/canvas/page";
import NodesPage from "@/app/(app)/app/nodes/page";

function StudioControls() {
  const { setStudioNavigation } = useWorkspaceNavigation();
  useEffect(() => {
    setStudioNavigation({
      activeId: "thread-1",
      disabled: false,
      onSelect: mocks.select,
      onNew: mocks.newConversation,
      onUpdate: mocks.updateConversation,
    });
    return () => setStudioNavigation(null);
  }, [setStudioNavigation]);
  return <WorkspaceSidebarToggle />;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.pathname = "/app/history";
  mocks.list.mockResolvedValue({
    items: [{ id: "thread-1", title: "庭院方案" }],
  });
  mocks.me.mockResolvedValue({ id: "user-1", credits: 100 });
});

describe("shared workspace navigation", () => {
  it("keeps the same sidebar and search state across workspace pages", async () => {
    const view = render(
      <WorkspaceShell>
        <p>历史内容</p>
      </WorkspaceShell>,
    );
    await screen.findByRole("button", { name: "庭院方案" });
    const sidebar = screen.getByRole("complementary", { name: "对话侧栏" });
    fireEvent.change(screen.getByRole("textbox", { name: "搜索最近对话" }), {
      target: { value: "庭院" },
    });
    expect(screen.getByRole("link", { name: "历史图片" })).toHaveAttribute(
      "aria-current",
      "page",
    );

    mocks.pathname = "/app/inspiration/post-1";
    view.rerender(
      <WorkspaceShell>
        <p>灵感内容</p>
      </WorkspaceShell>,
    );
    expect(screen.getByRole("complementary", { name: "对话侧栏" })).toBe(
      sidebar,
    );
    expect(screen.getByRole("textbox", { name: "搜索最近对话" })).toHaveValue(
      "庭院",
    );
    expect(screen.getByRole("link", { name: "灵感圈" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("link", { name: "历史图片" })).not.toHaveAttribute(
      "aria-current",
    );

    mocks.pathname = "/app";
    view.rerender(
      <WorkspaceShell>
        <StudioControls />
      </WorkspaceShell>,
    );
    expect(screen.getByRole("complementary", { name: "对话侧栏" })).toBe(
      sidebar,
    );
    expect(screen.getByRole("textbox", { name: "搜索最近对话" })).toHaveValue(
      "庭院",
    );
    fireEvent.click(screen.getByRole("button", { name: "庭院方案" }));
    expect(mocks.select).toHaveBeenCalledWith("thread-1");
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it("keeps a collapsed sidebar collapsed after changing pages", async () => {
    const view = render(
      <WorkspaceShell>
        <p>历史内容</p>
      </WorkspaceShell>,
    );
    await screen.findByRole("button", { name: "庭院方案" });
    fireEvent.click(screen.getByRole("button", { name: "收起对话侧栏" }));
    expect(
      screen.queryByRole("complementary", { name: "对话侧栏" }),
    ).not.toBeInTheDocument();
    mocks.pathname = "/app/settings";
    view.rerender(
      <WorkspaceShell>
        <p>设置内容</p>
      </WorkspaceShell>,
    );
    expect(
      screen.queryByRole("complementary", { name: "对话侧栏" }),
    ).not.toBeInTheDocument();
  });

  it("opens a conversation or a new draft from any secondary page", async () => {
    render(
      <WorkspaceShell>
        <p>历史内容</p>
      </WorkspaceShell>,
    );
    fireEvent.click(await screen.findByRole("button", { name: "庭院方案" }));
    expect(mocks.push).toHaveBeenCalledWith("/app?thread=thread-1");
    fireEvent.click(screen.getByRole("button", { name: "新对话" }));
    expect(mocks.push).toHaveBeenCalledWith("/app");
  });

  it("closes the mobile drawer when a destination is chosen", async () => {
    render(
      <WorkspaceShell>
        <p>历史内容</p>
      </WorkspaceShell>,
    );
    await screen.findByRole("button", { name: "庭院方案" });
    fireEvent.click(screen.getByRole("button", { name: "展开对话侧栏" }));
    const drawer = screen.getByRole("dialog", { name: "对话与导航" });
    fireEvent.click(within(drawer).getByRole("link", { name: "PPT" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
  });

  it("can reload the conversation list after a failure", async () => {
    mocks.list.mockRejectedValueOnce(new Error("offline"));
    render(
      <WorkspaceShell>
        <p>历史内容</p>
      </WorkspaceShell>,
    );
    fireEvent.click(await screen.findByRole("button", { name: "重新加载" }));
    expect(
      await screen.findByRole("button", { name: "庭院方案" }),
    ).toBeVisible();
  });

  it("renames and deletes the active conversation from the sidebar", async () => {
    const user = userEvent.setup();
    mocks.pathname = "/app";
    mocks.update
      .mockResolvedValueOnce({ id: "thread-1", title: "庭院新方案" })
      .mockResolvedValueOnce({
        id: "thread-1",
        title: "庭院新方案",
        archived: true,
      });
    render(
      <WorkspaceShell>
        <StudioControls />
      </WorkspaceShell>,
    );
    const actions = await screen.findByRole("button", {
      name: "对话操作：庭院方案",
    });
    await waitFor(() => expect(actions).toBeEnabled());

    await user.click(actions);
    await user.click(await screen.findByRole("menuitem", { name: "重命名" }));
    const input = screen.getByRole("textbox", { name: "对话名称" });
    await user.clear(input);
    await user.type(input, "庭院新方案");
    await user.click(screen.getByRole("button", { name: "保存" }));

    expect(mocks.update).toHaveBeenCalledWith("thread-1", {
      title: "庭院新方案",
    });
    expect(mocks.updateConversation).toHaveBeenCalledWith(
      expect.objectContaining({ id: "thread-1", title: "庭院新方案" }),
    );
    expect(
      await screen.findByRole("button", { name: "庭院新方案" }),
    ).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: "对话操作：庭院新方案" }),
    );
    await user.click(await screen.findByRole("menuitem", { name: "删除" }));
    await user.click(screen.getByRole("button", { name: "删除" }));

    expect(mocks.update).toHaveBeenCalledWith("thread-1", { archived: true });
    expect(mocks.newConversation).toHaveBeenCalledOnce();
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: "庭院新方案" }),
      ).not.toBeInTheDocument(),
    );
  });

  it.each([CanvasPage, NodesPage])(
    "keeps both canvas routes available",
    (page) => {
      expect(page()).toBeTruthy();
      expect(mocks.redirect).not.toHaveBeenCalled();
    },
  );
});
