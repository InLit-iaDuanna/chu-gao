import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import type { ChatModelOption } from "@/lib/chat-model-options";
import { ChatModelControls } from "./ChatModelControls";

it("shows token rates in the model list alongside fixed per-turn prices", async () => {
  const fixed: ChatModelOption = {
    id: "fixed",
    displayName: "固定点价",
    reasoningEfforts: [],
    credits: 2,
    supportsVision: false,
    maxReferenceImages: 0,
  };
  const opus: ChatModelOption = {
    ...fixed,
    id: "claude-opus-5-5",
    displayName: "Opus 5.5",
    credits: 0,
    pricing: {
      type: "per_million_tokens",
      input: 100,
      output: 500,
      cacheRead: 5,
      cacheCreation: 60,
    },
    reasoningEfforts: ["low", "medium", "high", "xhigh", "max"],
    defaultReasoningEffort: "low",
  };
  const onSelectModel = vi.fn();
  render(
    <ChatModelControls
      models={[fixed, opus]}
      model={fixed}
      onSelectModel={onSelectModel}
      onReasoningEffortChange={vi.fn()}
    />,
  );
  const user = userEvent.setup();
  await user.click(
    screen.getByRole("button", { name: "模型与思考强度：固定点价" }),
  );
  expect(
    within(screen.getByRole("radio", { name: /固定点价/ })).getByText(
      "2 积分 / 轮",
    ),
  ).toBeVisible();
  const option = screen.getByRole("radio", { name: /Opus 5.5/ });
  for (const label of [
    "积分 / 百万 Token",
    "输入 100",
    "输出 500",
    "缓存读取 5",
    "缓存写入 60",
  ]) {
    expect(within(option).getByText(label)).toBeVisible();
  }
  expect(within(option).queryByText("0 积分 / 轮")).not.toBeInTheDocument();
  await user.click(option);
  expect(onSelectModel).toHaveBeenCalledWith(opus.id);
});
