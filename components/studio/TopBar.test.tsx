import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "@/components/ui";
import { TopBar } from "./TopBar";
import type { Me } from "./lib/types";

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  refresh: vi.fn(),
  logout: vi.fn(),
  setTheme: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => mocks }));
vi.mock("next-themes", () => ({
  useTheme: () => ({ resolvedTheme: "light", setTheme: mocks.setTheme }),
}));
vi.mock("./lib/api", () => ({ logout: mocks.logout }));

const me: Me = {
  id: "user-1",
  name: "测试用户",
  email: "user@example.com",
  role: "USER",
  status: "ACTIVE",
  credits: 100,
  dailyGenLimit: 20,
  concurrentLimit: 2,
  dailyUsed: 3,
  dailyLimit: 20,
  crossBorderConsentAt: null,
  authenticated: true,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.logout.mockResolvedValue(undefined);
});

function renderTopBar(user: Me | null = me) {
  return render(
    <ToastProvider>
      <TopBar me={user} model={null} title="设计画布" />
    </ToastProvider>,
  );
}

describe("workspace top bar", () => {
  it("keeps a single page title, balance and theme controls", async () => {
    const user = userEvent.setup();
    renderTopBar();
    expect(screen.getAllByText("设计画布")).toHaveLength(1);
    expect(screen.queryByText("工作区")).not.toBeInTheDocument();
    expect(screen.getByText("100")).toBeVisible();
    expect(screen.getByTitle("今日已用 3/20 次")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "切换到深色主题" }));
    expect(mocks.setTheme).toHaveBeenCalledWith("dark");
  });

  it.each(["USER", "ADMIN"] as const)(
    "preserves %s account permissions",
    async (role) => {
      const user = userEvent.setup();
      renderTopBar({ ...me, role });
      await user.click(screen.getByRole("button", { name: "账户菜单" }));
      expect(screen.getByRole("menuitem", { name: "退出登录" })).toBeVisible();
      if (role === "ADMIN") {
        await user.click(screen.getByRole("menuitem", { name: "管理后台" }));
        expect(mocks.push).toHaveBeenCalledWith("/admin");
      } else {
        expect(
          screen.queryByRole("menuitem", { name: "管理后台" }),
        ).not.toBeInTheDocument();
      }
    },
  );

  it("keeps logout navigation working", async () => {
    const user = userEvent.setup();
    renderTopBar();
    await user.click(screen.getByRole("button", { name: "账户菜单" }));
    await user.click(screen.getByRole("menuitem", { name: "退出登录" }));
    expect(mocks.logout).toHaveBeenCalledOnce();
    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith("/login"));
    expect(mocks.refresh).toHaveBeenCalledOnce();
  });

  it("reports logout failures without navigating away", async () => {
    const user = userEvent.setup();
    mocks.logout.mockRejectedValueOnce(new Error("暂时无法退出"));
    renderTopBar();
    await user.click(screen.getByRole("button", { name: "账户菜单" }));
    await user.click(screen.getByRole("menuitem", { name: "退出登录" }));
    expect(await screen.findByText("退出登录失败")).toBeVisible();
    expect(mocks.replace).not.toHaveBeenCalled();
  });
});
