import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import type { ChatModelOption } from "@/lib/chat-model-options";
import { ChatModelControls } from "./ChatModelControls";

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

it("lists models the way Claude's picker does: name, one line, a check", async () => {
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
  const current = screen.getByRole("menuitemradio", { name: /固定点价/ });
  expect(current).toHaveAttribute("aria-checked", "true");
  expect(within(current).getByText("2 积分 / 轮")).toBeVisible();
  const option = screen.getByRole("menuitemradio", { name: /Opus 5.5/ });
  expect(within(option).getByText(/长文与复杂推理 · 按用量计费/)).toBeVisible();
  expect(within(option).queryByText(/百万 Token/)).not.toBeInTheDocument();
  // A model without effort levels has no effort row.
  expect(
    screen.queryByRole("menuitem", { name: "思考强度" }),
  ).not.toBeInTheDocument();
  await user.click(option);
  expect(onSelectModel).toHaveBeenCalledWith(opus.id);
  expect(screen.queryByRole("menu")).not.toBeInTheDocument();
});

it("keeps effort in a side menu that marks the default and the current level", async () => {
  const onReasoningEffortChange = vi.fn();
  render(
    <ChatModelControls
      models={[fixed, opus]}
      model={opus}
      reasoningEffort="high"
      onSelectModel={vi.fn()}
      onReasoningEffortChange={onReasoningEffortChange}
    />,
  );
  const user = userEvent.setup();
  const trigger = screen.getByRole("button", {
    name: "模型与思考强度：Opus 5.5，High",
  });
  expect(trigger).toHaveTextContent("Opus 5.5High");
  await user.click(trigger);
  const effortRow = screen.getByRole("menuitem", { name: "思考强度" });
  expect(effortRow).toHaveTextContent("High");
  await user.click(effortRow);
  const levels = await screen.findAllByRole("menuitemradio", {
    name: /^(Low|Medium|High|XHigh|Max)$/,
  });
  expect(levels.map((item) => item.getAttribute("aria-label"))).toEqual([
    "Low",
    "Medium",
    "High",
    "XHigh",
    "Max",
  ]);
  expect(screen.getByRole("menuitemradio", { name: "High" })).toHaveAttribute(
    "aria-checked",
    "true",
  );
  expect(
    within(screen.getByRole("menuitemradio", { name: "Low" })).getByText(
      "默认",
    ),
  ).toBeVisible();
  // jsdom has no layout, so a real pointer path would leave the side menu's
  // grace area and close it; select the item directly.
  fireEvent.click(screen.getByRole("menuitemradio", { name: "Max" }));
  expect(onReasoningEffortChange).toHaveBeenCalledWith("max");
});
