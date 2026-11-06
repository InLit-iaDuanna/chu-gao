import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { ToastProvider } from "@/components/ui";
import {
  buildHtmlPreviewDocument,
  HTML_PREVIEW_CSP,
  HtmlArtifact,
} from "./HtmlArtifact";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("retains static styles and SVG while removing script, navigation and resource-loading markup", () => {
  const output = buildHtmlPreviewDocument(`<!doctype html><html><head>
    <meta http-equiv="refresh" content="0;url=https://leak.invalid/refresh">
    <meta http-equiv="Content-Security-Policy" content="default-src * 'unsafe-inline'">
    <base href="https://leak.invalid/" target="_top">
    <link rel="dns-prefetch" href="https://leak.invalid/dns"><link rel="stylesheet" href="https://leak.invalid/css">
    <style>body{display:grid;background:#fff}.tile{color:red;background:url(https://leak.invalid/css-image)}</style>
    </head><body class="page" style="padding:20px" onload="parent.alert(1)">
    <script>fetch('https://leak.invalid/script')</script><iframe src="https://leak.invalid/frame"></iframe>
    <object data="https://leak.invalid/object"></object><embed src="https://leak.invalid/embed">
    <img src="https://leak.invalid/image" srcset="https://leak.invalid/responsive 2x" onerror="alert(1)">
    <img src="data:image/png;base64,aGVsbG8=" alt="embedded">
    <img src="data:image/svg+xml;base64,PHN2Zy8+" alt="svg-data"><input type="image" src="data:image/png;base64,aGVsbG8=">
    <a href="javascript:alert(1)" ping="https://leak.invalid/ping" target="_top">导航</a>
    <form action="https://leak.invalid/form"><button formaction="https://leak.invalid/button">提交</button></form>
    <svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="30" fill="red"/><a href="https://leak.invalid/svg">x</a><foreignObject><iframe src="https://leak.invalid/nested"></iframe></foreignObject><animate attributeName="href" values="https://leak.invalid/animation"/></svg>
    <template><img src="https://leak.invalid/template"></template><div class="tile">静态布局</div></body></html>`);
  const parsed = new DOMParser().parseFromString(output, "text/html");
  expect(
    parsed.querySelector(
      "script, iframe, object, embed, link, base, template, foreignObject, animate, form",
    ),
  ).toBeNull();
  expect(
    parsed.querySelector(
      "[href], [srcset], [action], [formaction], [onload], [onerror], [ping], [target]",
    ),
  ).toBeNull();
  expect(parsed.querySelectorAll("meta[http-equiv]")).toHaveLength(1);
  expect(
    parsed.querySelector("meta[http-equiv]")?.getAttribute("content"),
  ).toBe(HTML_PREVIEW_CSP);
  expect(parsed.head.children[1].getAttribute("http-equiv")).toBe(
    "Content-Security-Policy",
  );
  expect(HTML_PREVIEW_CSP).toContain("default-src 'none'");
  expect(HTML_PREVIEW_CSP).toContain("connect-src 'none'");
  expect(parsed.querySelectorAll("[src]")).toHaveLength(1);
  expect(parsed.querySelector("img[src]")?.getAttribute("src")).toBe(
    "data:image/png;base64,aGVsbG8=",
  );
  expect(parsed.body.getAttribute("class")).toBe("page");
  expect(parsed.body.getAttribute("style")).toBe("padding:20px");
  expect(parsed.querySelector("circle")?.getAttribute("fill")).toBe("red");
  expect(output).toContain("body{display:grid;background:#fff}");
  expect(output).toContain("静态布局");
});

it("switches preview and original source, copies source, and downloads the offline document", async () => {
  const user = userEvent.setup();
  const writeText = vi
    .spyOn(navigator.clipboard, "writeText")
    .mockResolvedValue(undefined);
  const source = "<h1>布局</h1><script>parent.alert(1)</script>";
  const createObjectURL = vi.fn().mockReturnValue("blob:artifact");
  const revokeObjectURL = vi.fn();
  vi.stubGlobal(
    "URL",
    class extends URL {
      static createObjectURL = createObjectURL;
      static revokeObjectURL = revokeObjectURL;
    },
  );
  const click = vi
    .spyOn(HTMLAnchorElement.prototype, "click")
    .mockImplementation(() => {});
  render(
    <ToastProvider>
      <HtmlArtifact source={source} messageStatus="completed" />
    </ToastProvider>,
  );
  await screen.findByTitle("HTML 预览");
  await user.click(screen.getByRole("tab", { name: "查看 HTML 源码" }));
  expect(screen.getByLabelText("HTML 源码").textContent).toBe(source);
  await user.click(screen.getByRole("button", { name: "复制 HTML 源码" }));
  expect(writeText).toHaveBeenCalledWith(source);
  await user.click(screen.getByRole("tab", { name: "预览 HTML" }));
  expect(screen.getByTitle("HTML 预览").getAttribute("srcdoc")).not.toContain(
    "<script",
  );
  fireEvent.click(screen.getByRole("button", { name: "放大预览" }));
  expect(
    await screen.findByRole("dialog", { name: "HTML 预览" }),
  ).toBeVisible();
  expect(screen.getByTitle("HTML 放大预览")).toHaveAttribute("sandbox", "");
  await user.click(screen.getByRole("button", { name: "关闭预览" }));
  vi.useFakeTimers();
  try {
    fireEvent.click(screen.getByRole("button", { name: "下载静态 HTML" }));
    expect(createObjectURL).toHaveBeenCalledWith(expect.any(Blob));
    expect(click).toHaveBeenCalledOnce();
    const anchor = click.mock.contexts[0] as HTMLAnchorElement;
    expect(anchor.download).toBe("chugao-artifact.html");
    expect(anchor.href).toBe("blob:artifact");
    vi.advanceTimersByTime(1000);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:artifact");
  } finally {
    vi.useRealTimers();
  }
  await waitFor(() => expect(screen.getByTitle("HTML 预览")).toBeVisible());
});

it.each([
  "failed",
  "cancelled",
  "interrupted",
  "incomplete",
  "running",
  "queued",
])(
  "does not automatically preview %s HTML, even without an active subscription",
  async (messageStatus) => {
    render(
      <ToastProvider>
        <HtmlArtifact
          source="<h1>未完成布局</h1>"
          messageStatus={messageStatus}
        />
      </ToastProvider>,
    );
    expect(screen.queryByTitle("HTML 预览")).not.toBeInTheDocument();
    expect(screen.getByLabelText("HTML 源码")).toHaveTextContent(
      "<h1>未完成布局</h1>",
    );
    expect(screen.getByText("未完成源码")).toBeVisible();
    const preview = screen.getByRole("tab", { name: "预览未完成 HTML 片段" });
    if (["running", "queued"].includes(messageStatus)) {
      expect(preview).toBeDisabled();
    } else {
      await userEvent.setup().click(preview);
      expect(await screen.findByTitle("HTML 预览")).toHaveAttribute(
        "sandbox",
        "",
      );
      expect(screen.getByText("未完成片段预览")).toBeVisible();
    }
  },
);
