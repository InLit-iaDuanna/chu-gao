import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  buildLineageForest,
  LineageTree,
  type LineageData,
} from "./LineageTree";

const data: LineageData = {
  rootId: "root",
  nodes: [
    {
      id: "root",
      title: "原始观察",
      authorName: "林一",
      shape: "QUESTION",
      discipline: "SERVICE",
    },
    {
      id: "branch-a",
      title: "服务蓝图延伸",
      authorName: "周二",
      shape: "PATTERN",
      discipline: "SERVICE",
    },
    {
      id: "branch-b",
      title: "空间实验",
      authorName: "陈三",
      shape: "WORK",
      discipline: "SPATIAL",
    },
    {
      id: "leaf",
      title: "动态验证",
      authorName: "吴四",
      shape: "PROCESS",
      discipline: "MOTION",
    },
  ],
  edges: [
    { from: "root", to: "branch-a" },
    { from: "root", to: "branch-b" },
    { from: "branch-a", to: "leaf" },
    { from: "branch-a", to: "leaf" },
  ],
};

describe("LineageTree", () => {
  it("builds a deduplicated parent-child hierarchy", () => {
    const [root] = buildLineageForest(data);

    expect(root.id).toBe("root");
    expect(root.children.map((item) => item.id)).toEqual([
      "branch-a",
      "branch-b",
    ]);
    expect(root.children[0]?.children.map((item) => item.id)).toEqual(["leaf"]);
  });

  it("renders generations as an accessible tree and marks the current post", () => {
    render(
      <LineageTree
        data={data}
        currentPostId="branch-a"
        basePath="/app/inspiration"
      />,
    );

    const tree = screen.getByRole("tree", { name: "想法传承关系" });
    expect(within(tree).getAllByRole("treeitem")).toHaveLength(4);
    expect(
      screen.getByRole("link", { name: /原始观察/ }).closest("li"),
    ).toHaveAttribute("aria-level", "1");
    expect(
      screen.getByRole("link", { name: /服务蓝图延伸/ }).closest("li"),
    ).toHaveAttribute("aria-level", "2");
    expect(
      screen.getByRole("link", { name: /动态验证/ }).closest("li"),
    ).toHaveAttribute("aria-level", "3");
    expect(screen.getByRole("link", { name: /服务蓝图延伸/ })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("link", { name: /动态验证/ })).toHaveAttribute(
      "href",
      "/app/inspiration/leaf",
    );
    expect(screen.getByText("命题 · 服务流程")).toBeInTheDocument();
  });
});
