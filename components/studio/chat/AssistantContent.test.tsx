import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ToastProvider } from "@/components/ui";
import { AssistantContent } from "./AssistantContent";

afterEach(() => vi.unstubAllGlobals());

function show(content: string, streaming = false) {
  return render(
    <ToastProvider>
      <AssistantContent
        content={content}
        streaming={streaming}
        messageStatus={streaming ? "running" : "completed"}
      />
    </ToastProvider>,
  );
}

it("renders Markdown and GFM headings, nested lists, tables, tasks and inline code", () => {
  show(
    "# 方案\n\n**重点**与`inline`。\n\n1. 第一项\n   - 子项\n2. 第二项\n\n- [x] 完成\n\n> 引用\n\n| 项目 | 数量 |\n| --- | ---: |\n| 栏杆 | 3 |\n\n~~旧内容~~",
  );
  expect(screen.getByRole("heading", { level: 1, name: "方案" })).toBeVisible();
  expect(screen.getByText("重点").tagName).toBe("STRONG");
  expect(screen.getByText("inline").tagName).toBe("CODE");
  expect(screen.getAllByRole("list")).toHaveLength(3);
  expect(screen.getByRole("checkbox")).toBeChecked();
  expect(screen.getByRole("checkbox")).toBeDisabled();
  expect(
    within(screen.getByRole("region", { name: "表格" })).getByRole("table"),
  ).toBeVisible();
  expect(screen.getByRole("region", { name: "表格" })).toHaveAttribute(
    "tabindex",
    "0",
  );
  expect(screen.getByText("旧内容").tagName).toBe("DEL");
});

it.each(["markdown", "md"])(
  "renders a whole %s fence as Markdown, including citations and nested code",
  (language) => {
    show(
      "````" +
        language +
        "\n# 渲染结果\n\n来源 [1](https://example.com/source)\n\n| 项目 | 数量 |\n| --- | --- |\n| a | 1 |\n\n```js\nconst value = 1;\n```\n\n## 参考来源\n\n1. [资料](https://example.com/source)\n````",
    );
    expect(screen.getByRole("heading", { name: "渲染结果" })).toBeVisible();
    expect(screen.getByRole("table")).toBeVisible();
    expect(screen.getByRole("link", { name: "1" })).toHaveAttribute(
      "href",
      "https://example.com/source",
    );
    expect(screen.getByLabelText("js 代码")).toHaveTextContent(
      "const value = 1;",
    );
    expect(screen.queryByLabelText(`${language} 代码`)).not.toBeInTheDocument();
  },
);

it("isolates raw HTML blocks together while keeping surrounding Markdown and inline HTML in the host as text", async () => {
  const { container } = show(
    '# 正文\n\n<style>.layout{display:grid;color:red}</style>\n\n<section class="layout"><h1>隔离布局</h1><script>parent.alert(1)</script></section>\n\n结束 <b>行内文本</b>。',
  );
  expect(screen.getByRole("heading", { name: "正文" })).toBeVisible();
  const frame = await screen.findByTitle("HTML 预览");
  expect(screen.getAllByTitle("HTML 预览")).toHaveLength(1);
  expect(frame).toHaveAttribute("sandbox", "");
  expect(frame.getAttribute("srcdoc")).toContain(
    ".layout{display:grid;color:red}",
  );
  expect(frame.getAttribute("srcdoc")).toContain(
    '<section class="layout"><h1>隔离布局</h1></section>',
  );
  expect(container.querySelector("section, style, script, b")).toBeNull();
  expect(screen.getByText("结束 <b>行内文本</b>。")).toBeVisible();
});

it("copies fenced code without escaping it and collapses long code without removing its toolbar", async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal("navigator", { clipboard: { writeText } });
  const source =
    'const html = "<button>hello</button>";\n' +
    "console.log(html);\n".repeat(40).trimEnd();
  show("```ts\n" + source + "\n```");
  expect(screen.getByLabelText("ts 代码").textContent).toBe(source);
  expect(
    screen.queryByRole("button", { name: "hello" }),
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "复制代码" }));
  await waitFor(() => expect(writeText).toHaveBeenCalledWith(source));
  fireEvent.click(screen.getByRole("button", { name: "收起代码" }));
  expect(screen.getByLabelText("ts 代码")).not.toBeVisible();
  expect(screen.getByRole("button", { name: "复制代码" })).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "展开代码" }));
  expect(screen.getByLabelText("ts 代码")).toBeVisible();
});

it("keeps malicious links and raw HTML out of the host DOM", async () => {
  const { container } = show(
    '[safe](https://example.com) [mail](mailto:test@example.com) [hash](#note) [bad](javascript:alert%281%29) [data](data:text/html,bad) [file](file:///etc/passwd)\n\n<img src="https://leak.invalid/pixel" onerror="alert(1)"><script>alert(1)</script>\n\n<style>body{display:none}</style>',
  );
  const safe = screen.getByRole("link", { name: "safe" });
  expect(safe).toHaveAttribute("target", "_blank");
  expect(safe).toHaveAttribute("rel", "noopener noreferrer nofollow");
  expect(safe).toHaveAttribute("referrerpolicy", "no-referrer");
  expect(screen.getByRole("link", { name: "mail" })).toHaveAttribute(
    "href",
    "mailto:test@example.com",
  );
  expect(screen.getByRole("link", { name: "hash" })).not.toHaveAttribute(
    "target",
  );
  for (const name of ["bad", "data", "file"])
    expect(screen.queryByRole("link", { name })).not.toBeInTheDocument();
  expect(container.querySelector("script, style, img")).toBeNull();
  const iframe = await screen.findByTitle("HTML 预览");
  expect(iframe).toHaveAttribute("sandbox", "");
  expect(iframe.getAttribute("srcdoc")).not.toMatch(
    /<script|onerror=|src="https:/,
  );
});

it("only loads embedded or validated local images, leaving external images as explicit links", () => {
  show(
    "![local](/api/generations/g-1/images/image-1)\n\n![external](https://leak.invalid/pixel)\n\n![traversal](/api/generations/g/images/i/../../../../auth/logout)\n\n![embedded](data:image/png;base64,aGVsbG8=)\n\n![svg](data:image/svg+xml;base64,PHN2Zy8+)",
  );
  expect(screen.getAllByRole("img")).toHaveLength(2);
  expect(screen.getByRole("img", { name: "local" })).toHaveAttribute(
    "referrerpolicy",
    "no-referrer",
  );
  expect(screen.getByRole("link", { name: "external" })).toHaveAttribute(
    "href",
    "https://leak.invalid/pixel",
  );
  expect(
    screen.queryByRole("img", { name: "traversal" }),
  ).not.toBeInTheDocument();
  expect(screen.queryByRole("img", { name: "svg" })).not.toBeInTheDocument();
});

it.each([
  "<!doctype html><html><body><h1>文档</h1></body></html>",
  "<!-- generated -->\n<html><body><h1>文档</h1></body></html>",
  "```html\n<section><h1>文档</h1></section>\n```",
])(
  "previews complete documents and HTML fences only in an opaque sandbox: %s",
  async (content) => {
    const { container } = show(content);
    const iframe = await screen.findByTitle("HTML 预览");
    expect(iframe).toHaveAttribute("sandbox", "");
    expect(iframe).toHaveAttribute("referrerpolicy", "no-referrer");
    expect(iframe.getAttribute("srcdoc")).toContain("<h1>文档</h1>");
    expect(container.querySelector("h1")).toBeNull();
  },
);

it("renders incomplete Markdown while streaming and defers HTML parsing until completion", async () => {
  const { rerender } = show("## 逐步回复\n\n**正在", true);
  expect(screen.getByRole("heading", { name: "逐步回复" })).toBeVisible();
  rerender(
    <ToastProvider>
      <AssistantContent
        content={"```html\n<style>body{color:red}</style><h1>部分"}
        streaming
      />
    </ToastProvider>,
  );
  expect(screen.queryByTitle("HTML 预览")).not.toBeInTheDocument();
  expect(
    screen.getByRole("tab", { name: "预览未完成 HTML 片段" }),
  ).toBeDisabled();
  expect(screen.getByLabelText("HTML 源码")).toHaveTextContent("<h1>部分");
  rerender(
    <ToastProvider>
      <AssistantContent
        content={"```html\n<style>body{color:red}</style><h1>完成</h1>\n```"}
        messageStatus="completed"
      />
    </ToastProvider>,
  );
  expect(await screen.findByTitle("HTML 预览")).toHaveAttribute("sandbox", "");
});

it("converges bounded split links, emphasis, lists, table separators and fences to the full render", () => {
  const chunks = [
    "# 标题\n\n[来源](https://example.",
    "com) **重",
    "点**\n\n- 第一项\n- 第二项\n\n| 项目 | 内容 |\n| --",
    "- | --- |\n| A | B |\n\n``",
    "`js\nconst text = '<>&中文`';\n",
    "\n```\n",
  ];
  const view = show("", true);
  let content = "";
  for (const chunk of chunks) {
    content += chunk;
    view.rerender(
      <ToastProvider>
        <AssistantContent content={content} streaming messageStatus="running" />
      </ToastProvider>,
    );
  }
  const table = screen.getByRole("table").outerHTML;
  const code = screen.getByLabelText("js 代码").textContent;
  view.rerender(
    <ToastProvider>
      <AssistantContent content={content} messageStatus="completed" />
    </ToastProvider>,
  );
  expect(screen.getByRole("table").outerHTML).toBe(table);
  expect(screen.getByLabelText("js 代码").textContent).toBe(code);
  expect(screen.getByRole("link", { name: "来源" })).toHaveAttribute(
    "href",
    "https://example.com",
  );
  expect(screen.getByText("重点").tagName).toBe("STRONG");
  expect(screen.getAllByRole("listitem")).toHaveLength(2);
});
