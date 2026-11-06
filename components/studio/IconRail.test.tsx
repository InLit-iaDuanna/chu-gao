import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { IconRail } from "./IconRail";

const navigation = vi.hoisted(() => ({
  pathname: "/app",
  push: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => navigation.pathname,
  useRouter: () => ({ push: navigation.push }),
}));

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: ComponentProps<"a">) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

describe("IconRail navigation", () => {
  beforeEach(() => {
    navigation.pathname = "/app";
    navigation.push.mockReset();
    window.localStorage.clear();
  });

  it("renders only the active mobile destinations in the required order", () => {
    render(<IconRail mobile />);

    const nav = screen.getByRole("navigation", { name: "移动端主导航" });
    const destinations = [
      ...within(nav).getAllByRole("link"),
      within(nav).getByRole("button", { name: "更多" }),
    ];

    expect(destinations.map((item) => item.getAttribute("aria-label"))).toEqual(
      ["工作台", "灵感", "历史", "更多"],
    );
    for (const label of ["工作台", "灵感", "历史", "更多"]) {
      expect(within(nav).getByText(label)).toBeVisible();
    }
    expect(within(nav).getByRole("link", { name: "工作台" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(within(nav).getByRole("link", { name: "灵感" })).toHaveAttribute(
      "href",
      "/app/inspiration",
    );
  });

  it("keeps the complete desktop navigation available", () => {
    navigation.pathname = "/app/settings/profile";
    render(<IconRail />);

    const nav = screen.getByRole("navigation", { name: "主导航" });
    expect(
      within(nav)
        .getAllByRole("link")
        .map((item) => item.getAttribute("aria-label")),
    ).toEqual(["工作台", "灵感圈", "历史", "PPT", "设置"]);
    expect(within(nav).getByRole("link", { name: "设置" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("lets the conversation home own navigation without duplicate rails", () => {
    const { rerender } = render(<IconRail hideOnStudio />);
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
    navigation.pathname = "/app/history";
    rerender(<IconRail hideOnStudio />);
    expect(screen.getByRole("navigation", { name: "主导航" })).toBeVisible();
  });

  it("groups publishing under inspiration and nested utility routes under more", () => {
    navigation.pathname = "/app/publish";
    const { rerender } = render(<IconRail mobile />);

    expect(screen.getByRole("link", { name: "灵感" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("button", { name: "更多" })).not.toHaveAttribute(
      "aria-current",
    );

    navigation.pathname = "/app/inspiration/post-1";
    rerender(<IconRail mobile />);
    expect(screen.getByRole("link", { name: "灵感" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("button", { name: "更多" })).not.toHaveAttribute(
      "aria-current",
    );

    navigation.pathname = "/app/ppt/editor";
    rerender(<IconRail mobile />);
    expect(screen.getByRole("button", { name: "更多" })).toHaveAttribute(
      "aria-current",
      "page",
    );

    navigation.pathname = "/app/pptx";
    rerender(<IconRail mobile />);
    expect(screen.getByRole("button", { name: "更多" })).not.toHaveAttribute(
      "aria-current",
    );
  });

  it("keeps only secondary utilities in the more menu", async () => {
    const user = userEvent.setup();
    render(<IconRail mobile />);

    await user.click(screen.getByRole("button", { name: "更多" }));
    const menu = screen.getByRole("menu", { name: "更多" });
    expect(
      within(menu)
        .getAllByRole("menuitem")
        .map((item) => item.textContent?.trim()),
    ).toEqual(["PPT", "设置"]);

    await user.click(within(menu).getByRole("menuitem", { name: "PPT" }));
    expect(navigation.push).toHaveBeenCalledWith("/app/ppt");
  });
});
