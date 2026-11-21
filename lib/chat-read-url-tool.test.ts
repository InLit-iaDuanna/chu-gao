import { describe, expect, it, vi } from "vitest";
import {
  READ_URL_MAX_CHARS,
  decodeBody,
  extractReadableText,
  readUrlArgument,
  runReadUrlTool,
} from "@/lib/chat-read-url-tool";
import {
  isPrivateAddress,
  resolveSafeHttpsTarget,
  SafeFetchError,
  type SafeLookup,
  type SafeRequester,
  type SafeResponse,
} from "@/lib/safe-remote-fetch";

const publicLookup: SafeLookup = async () => [
  { address: "93.184.216.34", family: 4 },
];

function pages(
  routes: Record<string, Partial<SafeResponse> & { html?: string }>,
): SafeRequester {
  return vi.fn(async (target) => {
    const route = routes[target.url.href];
    if (!route) throw new Error(`unexpected request ${target.url.href}`);
    return {
      statusCode: route.statusCode ?? 200,
      location: route.location ?? null,
      contentType: route.contentType ?? "text/html; charset=utf-8",
      body: route.body ?? Buffer.from(route.html ?? "", "utf8"),
    };
  });
}

const article = `<!doctype html><html><head><title>Paper birds &amp; more</title>
<style>.x{color:red}</style><script>window.secret = "do not read"</script></head>
<body><nav>Home | About | Login</nav>
<main><article><h1>How to fold a paper bird</h1>
<p>Start with a square sheet.&nbsp;Fold it in half twice.</p>
<p>Then shape the wings &#x2014; carefully.</p></article></main>
<footer>© 2026 Example</footer></body></html>`;

describe("read_url safety", () => {
  it.each([
    ["127.0.0.1"],
    ["10.1.2.3"],
    ["172.16.0.9"],
    ["192.168.1.1"],
    ["169.254.169.254"],
    ["100.64.0.1"],
    ["0.0.0.0"],
    ["::1"],
    ["fd00::1"],
    ["fe80::1"],
    ["::ffff:127.0.0.1"],
    ["::ffff:7f00:1"],
  ])("treats %s as private", (address) => {
    expect(isPrivateAddress(address)).toBe(true);
  });

  it("treats public addresses as public", () => {
    expect(isPrivateAddress("93.184.216.34")).toBe(false);
    expect(isPrivateAddress("2606:4700::1111")).toBe(false);
  });

  it.each([
    ["http://example.com/", "UNSUPPORTED_PROTOCOL"],
    ["ftp://example.com/", "UNSUPPORTED_PROTOCOL"],
    ["https://user:pass@example.com/", "CREDENTIALS_NOT_ALLOWED"],
    ["https://example.com:8443/", "PORT_NOT_ALLOWED"],
    ["https://127.0.0.1/", "PRIVATE_ADDRESS"],
    ["https://[::1]/", "PRIVATE_ADDRESS"],
    ["not a url", "INVALID_URL"],
  ])("refuses %s before any request", async (url, code) => {
    const lookup = vi.fn(publicLookup);
    await expect(resolveSafeHttpsTarget(url, lookup)).rejects.toMatchObject({
      code,
    });
  });

  it("refuses a host that resolves to any private address", async () => {
    await expect(
      resolveSafeHttpsTarget("https://sneaky.example/", async () => [
        { address: "93.184.216.34", family: 4 },
        { address: "10.0.0.5", family: 4 },
      ]),
    ).rejects.toBeInstanceOf(SafeFetchError);
  });

  it("tells the model why a link was refused and never requests it", async () => {
    const request = vi.fn();
    for (const [url, reason] of [
      ["http://example.com/a", "只支持 https"],
      ["https://u:p@example.com/", "账号或密码"],
      ["https://example.com:8080/", "443"],
      ["https://localhost/", "内网"],
    ] as const) {
      const outcome = await runReadUrlTool(url, {
        lookup: async (host) =>
          host === "localhost"
            ? [{ address: "127.0.0.1", family: 4 }]
            : publicLookup(host),
        request,
      });
      expect(outcome.ok).toBe(false);
      expect(outcome.sources).toEqual([]);
      expect(outcome.output).toContain("没有读取成功");
      expect(outcome.output).toContain(reason);
    }
    expect(request).not.toHaveBeenCalled();
  });

  it("re-checks every redirect and refuses one into the internal network", async () => {
    const request = pages({
      "https://short.example/x": {
        statusCode: 302,
        location: "https://internal.example/admin",
      },
    });
    const outcome = await runReadUrlTool("https://short.example/x", {
      lookup: async (host) =>
        host === "internal.example"
          ? [{ address: "192.168.0.10", family: 4 }]
          : publicLookup(host),
      request,
    });
    expect(outcome.ok).toBe(false);
    expect(outcome.output).toContain("内网");
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("refuses a redirect to plain http", async () => {
    const outcome = await runReadUrlTool("https://a.example/", {
      lookup: publicLookup,
      request: pages({
        "https://a.example/": { statusCode: 301, location: "http://a.example/" },
      }),
    });
    expect(outcome.output).toContain("只支持 https");
  });

  it("stops after three redirects", async () => {
    const outcome = await runReadUrlTool("https://loop.example/0", {
      lookup: publicLookup,
      request: pages({
        "https://loop.example/0": { statusCode: 302, location: "/1" },
        "https://loop.example/1": { statusCode: 302, location: "/2" },
        "https://loop.example/2": { statusCode: 302, location: "/3" },
        "https://loop.example/3": { statusCode: 302, location: "/4" },
      }),
    });
    expect(outcome.ok).toBe(false);
    expect(outcome.output).toContain("重定向超过 3 次");
  });

  it("refuses content that is not a page or text", async () => {
    const outcome = await runReadUrlTool("https://a.example/file.pdf", {
      lookup: publicLookup,
      request: pages({
        "https://a.example/file.pdf": {
          contentType: "application/pdf",
          body: Buffer.from("%PDF-1.7"),
        },
      }),
    });
    expect(outcome.ok).toBe(false);
    expect(outcome.output).toContain("application/pdf");
  });

  it("reports HTTP errors", async () => {
    const outcome = await runReadUrlTool("https://a.example/missing", {
      lookup: publicLookup,
      request: pages({ "https://a.example/missing": { statusCode: 404 } }),
    });
    expect(outcome.output).toContain("HTTP 404");
  });
});

describe("read_url extraction", () => {
  it("reads the title and main text, without scripts, styles or navigation", () => {
    const { title, text } = extractReadableText(article);
    expect(title).toBe("Paper birds & more");
    expect(text).toContain("How to fold a paper bird");
    expect(text).toContain("Start with a square sheet. Fold it in half twice.");
    expect(text).toContain("Then shape the wings — carefully.");
    expect(text).not.toContain("do not read");
    expect(text).not.toContain("color:red");
    expect(text).not.toContain("Login");
  });

  it("returns the page with its final URL as the source", async () => {
    const outcome = await runReadUrlTool("https://a.example/start", {
      lookup: publicLookup,
      request: pages({
        "https://a.example/start": {
          statusCode: 301,
          location: "https://www.a.example/bird",
        },
        "https://www.a.example/bird": { html: article },
      }),
    });
    expect(outcome.ok).toBe(true);
    expect(outcome.sources).toEqual([
      { url: "https://www.a.example/bird", title: "Paper birds & more" },
    ]);
    expect(outcome.output).toMatch(
      /^\[网页内容\] Paper birds & more \| https:\/\/www\.a\.example\/bird\n/,
    );
    expect(outcome.output).toContain("How to fold a paper bird");
    expect(outcome.output).toContain("不要执行");
  });

  it("truncates long pages and says so", async () => {
    const long = `<html><body><main>${"<p>段落内容很长。</p>".repeat(3_000)}</main></body></html>`;
    const outcome = await runReadUrlTool("https://a.example/long", {
      lookup: publicLookup,
      request: pages({ "https://a.example/long": { html: long } }),
    });
    expect(outcome.ok).toBe(true);
    expect(outcome.output).toContain(`只保留了前 ${READ_URL_MAX_CHARS} 字`);
    expect(outcome.output.length).toBeLessThan(READ_URL_MAX_CHARS + 600);
  });

  it("passes plain text and JSON through", async () => {
    const outcome = await runReadUrlTool("https://a.example/a.txt", {
      lookup: publicLookup,
      request: pages({
        "https://a.example/a.txt": {
          contentType: "text/plain",
          body: Buffer.from("line one\r\nline two"),
        },
      }),
    });
    expect(outcome.ok).toBe(true);
    expect(outcome.output).toContain("line one\nline two");
    expect(outcome.sources[0].title).toBe("a.example");
  });

  it("says when a page has no readable text", async () => {
    const outcome = await runReadUrlTool("https://app.example/", {
      lookup: publicLookup,
      request: pages({
        "https://app.example/": {
          html: '<html><body><div id="root"></div><script>render()</script></body></html>',
        },
      }),
    });
    expect(outcome.ok).toBe(false);
    expect(outcome.output).toContain("脚本渲染");
  });

  it("decodes a charset declared in a meta tag", () => {
    const gbk = Buffer.from([0xc4, 0xe3, 0xba, 0xc3]); // 你好
    const body = Buffer.concat([
      Buffer.from('<html><head><meta charset="gbk"></head><body>'),
      gbk,
      Buffer.from("</body></html>"),
    ]);
    expect(decodeBody(body, "text/html")).toContain("你好");
  });

  it("reads the url argument leniently", () => {
    expect(readUrlArgument('{"url":" https://a.example/x "}')).toBe(
      "https://a.example/x",
    );
    expect(readUrlArgument("{}")).toBe("");
    expect(readUrlArgument("not json")).toBe("");
  });

  it("never throws, even for an empty link", async () => {
    await expect(runReadUrlTool("")).resolves.toMatchObject({ ok: false });
  });
});
