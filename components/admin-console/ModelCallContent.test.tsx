import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ToastProvider } from "@/components/ui";
import { ModelCallContent } from "./ModelCallContent";
import { htmlPreviewSource } from "@/lib/html-preview";

const html =
  '<!doctype html><html lang="zh-CN"><head><style>body{font-family:"PingFang SC", sans-serif}</style></head><body><div>爱情的两种理解</div></body></html>';

describe("readable model call details", () => {
  it("unwraps the old JSON before previewing only the HTML body and rendering the explanation", () => {
    const text =
      "```html\n" +
      html +
      "\n```\n\n**设计说明**\n\n| 幕 | 说明 |\n|---|---|\n| 1 | 联结 |";
    const raw = JSON.stringify({ text, error: null }, null, 2).replace(
      /\\([/"'])/g,
      "$1",
    );
    render(
      <ToastProvider>
        <ModelCallContent value={raw} side="response" empty="无内容" />
      </ToastProvider>,
    );
    const frame = screen.getByTitle("HTML 预览");
    const source = frame.getAttribute("srcdoc")!;
    expect(source).toContain("爱情的两种理解");
    expect(source).not.toContain('"text":');
    expect(source).not.toContain("\\n");
    expect(source).not.toContain("```html");
    expect(frame).toHaveAttribute("sandbox", "");
    expect(screen.getByText("设计说明").tagName).toBe("STRONG");
    expect(screen.getByRole("table")).toBeVisible();
    expect(
      screen.getByText("查看原始内容").closest("details"),
    ).not.toHaveAttribute("open");
  });

  it("shows the current input and keeps historical HTML and system instructions collapsed", () => {
    const request = JSON.stringify({
      model: "test",
      messages: [
        { role: "system", content: "当前系统指令" },
        { role: "assistant", content: "```html\n" + html + "\n```" },
        { role: "user", content: "请修改标题" },
      ],
    });
    render(
      <ToastProvider>
        <ModelCallContent value={request} side="request" empty="无内容" />
      </ToastProvider>,
    );
    expect(screen.getByText("请修改标题")).toBeVisible();
    expect(
      screen.getByText("历史上下文 · 1 条").closest("details"),
    ).not.toHaveAttribute("open");
    expect(
      screen.getByText("系统指令 · 1 条").closest("details"),
    ).not.toHaveAttribute("open");
    expect(
      screen.getByTitle("HTML 预览").closest("details"),
    ).not.toHaveAttribute("open");
  });

  it("does not preview an envelope or prose just because it mentions HTML markup", () => {
    expect(htmlPreviewSource("请用 <div> 标签，不要增加脚本。")).toBeNull();
    expect(
      htmlPreviewSource(
        JSON.stringify({
          model: "test",
          messages: [{ role: "system", content: "输出 <div> 标签" }],
        }),
      ),
    ).toBeNull();
    expect(
      htmlPreviewSource("结果如下：\n\n```html\n" + html + "\n```\n\n说明"),
    ).toBe(html);
    expect(
      htmlPreviewSource(
        JSON.stringify({
          choices: [
            {
              message: {
                role: "assistant",
                content: "```html\n" + html + "\n```",
              },
            },
          ],
        }),
      ),
    ).toBe(html);
  });

  it("keeps recovered partial history collapsed when the real current input is available", () => {
    const request = JSON.stringify({
      latest_user_input: "请绘制新的构图",
      messages: [
        { role: "user", content: "更早的问题" },
        { role: "assistant", content: "```html\n<div>不完整的历史页面" },
      ],
      _log: { recovered: true, truncated: true },
    });
    render(
      <ToastProvider>
        <ModelCallContent value={request} side="request" empty="无内容" />
      </ToastProvider>,
    );
    expect(screen.getByText("请绘制新的构图")).toBeVisible();
    const history = screen
      .getByText("已保存的上下文 · 2 条")
      .closest("details");
    expect(history).not.toHaveAttribute("open");
    expect(screen.getByText("更早的问题").closest("details")).toBe(history);
    expect(
      screen
        .getByText(/不完整的历史页面/, { selector: "code" })
        .closest("details"),
    ).toBe(history);
    expect(screen.getByText(/这条历史日志只保存了部分内容/)).toBeVisible();
  });
});
