import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ConversationSidebar } from "./ConversationSidebar";
import type { ConversationSummary } from "../lib/types";

function summary(
  overrides: Partial<ConversationSummary> & { id: string; title: string },
): ConversationSummary {
  return {
    lastMessageAt: "2026-11-21T08:00:00.000Z",
    createdAt: "2026-11-21T07:00:00.000Z",
    latestMessage: null,
    thumbnailUrl: null,
    generationCount: 0,
    ...overrides,
  };
}

const threads: ConversationSummary[] = [
  summary({ id: "cloud-1", title: "云端对话", storage: "cloud" }),
  summary({ id: "local-1", title: "本机对话", storage: "local" }),
  summary({
    id: "local-only-1",
    title: "仅本机旧记录",
    storage: "local",
    localOnly: true,
  }),
];

afterEach(() => {
  vi.unstubAllGlobals();
});

function renderSidebar(onDelete = vi.fn(async () => undefined)) {
  render(
    <ConversationSidebar
      threads={threads}
      activeId={null}
      disabled={false}
      loading={false}
      error={null}
      onSelect={vi.fn()}
      onNew={vi.fn()}
      onDelete={onDelete}
      onReload={vi.fn()}
    />,
  );
  return onDelete;
}

describe("conversation storage markers", () => {
  it("marks where each conversation is stored", () => {
    renderSidebar();

    expect(screen.getByTitle("已保存在云端")).toBeTruthy();
    expect(screen.getAllByTitle("仅保存在本机")).toHaveLength(1);
    expect(screen.getByTitle("仅本机（云端副本已过期）")).toBeTruthy();
    expect(screen.getByTitle("仅本机旧记录（仅本机）")).toBeTruthy();
  });

  it("asks for local deletion with the local-only wording", async () => {
    const confirm = vi.fn(() => true);
    vi.stubGlobal("confirm", confirm);
    const onDelete = renderSidebar();

    fireEvent.click(
      screen.getByRole("button", { name: "删除对话 仅本机旧记录" }),
    );

    expect(confirm).toHaveBeenCalledWith(
      "将从本机删除该对话记录，无法恢复。确定删除？",
    );
    await vi.waitFor(() =>
      expect(onDelete).toHaveBeenCalledWith("local-only-1"),
    );
  });

  it("keeps the previous wording for cloud conversations", () => {
    const confirm = vi.fn(() => false);
    vi.stubGlobal("confirm", confirm);
    const onDelete = renderSidebar();

    fireEvent.click(screen.getByRole("button", { name: "删除对话 云端对话" }));

    expect(confirm).toHaveBeenCalledWith("删除“云端对话”？");
    expect(onDelete).not.toHaveBeenCalled();
  });
});
