import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/logger", () => ({ logger: { warn: vi.fn() } }));

import { sanitizeCallContent } from "./model-call-log";

describe("model call content storage", () => {
  it("keeps HTML quotes, newlines, code and backslashes intact through repeated sanitization", () => {
    const text =
      '```html\n<html lang="zh-CN"><style>.tile::before{content:"hello"}</style><div title="a, b">test</div></html>\n```\nPath: C:\\tools\\image';
    const value = { text, error: null };
    const encoded = sanitizeCallContent(value)!;
    expect(JSON.parse(encoded)).toEqual(value);
    expect(JSON.parse(sanitizeCallContent(encoded)!)).toEqual(value);
  });

  it("redacts credentials, inline image data and signed URL queries without breaking JSON", () => {
    const encoded = sanitizeCallContent(
      {
        api_key: "private key with spaces",
        authorization: "Bearer private-value",
        images: [{ image_url: "data:image/png;base64,YWJjZA==" }],
        data: [{ b64_json: "YWJjZA==" }],
        url: "https://images.invalid/image.png?token=private-value",
        text: 'He said "hello"; secret-private-value',
      },
      ["secret-private-value"],
    )!;
    const value = JSON.parse(encoded);
    expect(value.api_key).toBe("[redacted]");
    expect(value.authorization).toBe("[redacted]");
    expect(value.images[0].image_url).toBe("[image data]");
    expect(value.data[0].b64_json).toBe("[image data]");
    expect(value.url).toBe("https://images.invalid/image.png");
    expect(encoded).not.toContain("private-value");
    expect(value.text).toContain('He said "hello"');
  });

  it("bounds large requests as valid JSON while retaining each message and the latest user input", () => {
    const messages = Array.from({ length: 20 }, () => ({
      role: "assistant",
      content: '<div title="long">' + "历史内容".repeat(10_000) + "</div>",
    }));
    messages.push({ role: "user", content: "请修改最后一幅图" });
    const encoded = sanitizeCallContent({ model: "test", messages })!;
    expect(encoded.length).toBeLessThanOrEqual(128_000);
    const value = JSON.parse(encoded);
    expect(value.messages).toHaveLength(21);
    expect(value.messages.at(-1).content).toBe("请修改最后一幅图");
    expect(value._log.truncated).toBe(true);
  });
});
