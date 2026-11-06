// @vitest-environment node
import sharp from "sharp";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "@/app/api/canvas/export/route";

vi.mock("@/lib/api-rate-limit", () => ({
  userActionRateLimitResponse: vi.fn(async () => null),
}));

const VALID_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="48" viewBox="0 0 64 48"><rect width="100%" height="100%" fill="#ffffff"/><g transform="translate(4 6) rotate(0 20 10)" opacity="1"><clipPath id="text-clip-text-1"><rect width="40" height="20"/></clipPath><text x="0" y="0" fill="#171717" font-family="Arial, sans-serif" font-size="12" font-weight="600" text-anchor="start" clip-path="url(#text-clip-text-1)"><tspan x="0" dy="12">Test &amp; 文本</tspan></text></g></svg>';

function exportRequest(svg: string, format: "svg" | "png" = "svg") {
  const form = new FormData();
  form.set("svg", svg);
  form.set("format", format);
  form.set("name", '海报/"测试"');
  return new Request("http://localhost/api/canvas/export", {
    method: "POST",
    body: form,
  });
}

describe("canvas export", () => {
  beforeEach(() => vi.clearAllMocks());

  it("accepts the editor SVG dialect and returns an attachment", async () => {
    const response = await POST(exportRequest(VALID_SVG));

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("image/svg+xml");
    expect(response.headers.get("content-disposition")).toContain(
      encodeURIComponent("海报__测试_"),
    );
    expect(await response.text()).toBe(VALID_SVG);
  });

  it("renders a non-empty PNG at the requested dimensions", async () => {
    const response = await POST(exportRequest(VALID_SVG, "png"));
    const png = Buffer.from(await response.arrayBuffer());
    const metadata = await sharp(png).metadata();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(metadata).toMatchObject({ format: "png", width: 64, height: 48 });
    expect(png.byteLength).toBeGreaterThan(100);
  });

  it.each([
    ["script", VALID_SVG.replace("</svg>", "<script>alert(1)</script></svg>")],
    [
      "event attribute",
      VALID_SVG.replace("<rect ", '<rect onload="alert(1)" '),
    ],
    [
      "external image",
      VALID_SVG.replace(
        "</svg>",
        '<g transform="translate(0 0) rotate(0 1 1)" opacity="1"><image href="https://example.com/pixel.png" x="0" y="0" width="2" height="2" preserveAspectRatio="xMidYMid meet" clip-path="url(#x)"/></g></svg>',
      ),
    ],
    ["style attribute", VALID_SVG.replace("<rect ", '<rect style="fill:red" ')],
    ["oversized canvas", VALID_SVG.replaceAll("64", "16385")],
  ])("rejects %s", async (_name, svg) => {
    const response = await POST(exportRequest(svg));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: { code: "VALIDATION_ERROR" },
    });
  });
});
