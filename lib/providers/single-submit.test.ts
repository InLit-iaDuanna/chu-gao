import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/provider-channel-request-config", () => ({
  getChannelRequestConfig: async () => ({ responseFormat: "b64_json" }),
  renderBodyTemplate: vi.fn(),
}));
import { generationFetchRetry } from "./single-submit";
import { buildAdapter } from "./factory";
import type { InternalRequest, ProtocolName } from "@/lib/models/types";
const request: InternalRequest = {
  modelId: "gpt-image-2",
  protocol: "openai-images",
  prompt: "A street",
  size: "1024x1024",
  quality: "auto",
  responseFormat: "b64_json",
  aspectRatio: "1:1",
  resolution: "1K",
  n: 1,
  outputFormat: "png",
  background: "auto",
  executionPolicy: "single-submit",
};
afterEach(() => vi.unstubAllGlobals());
describe("single-submit adapters", () => {
  it.each<ProtocolName>([
    "openai-images",
    "openai-responses-image",
    "gemini-image",
  ])("does not repeat a %s POST after a network failure", async (protocol) => {
    const fetch = vi.fn().mockRejectedValue(new TypeError("connection lost"));
    vi.stubGlobal("fetch", fetch);
    const adapter = buildAdapter({
      id: "provider",
      name: "test",
      baseUrl: "https://example.test",
      apiKey: "test",
      protocol,
    });
    await expect(
      adapter.generate({ ...request, protocol }, new AbortController().signal),
    ).rejects.toThrow("connection lost");
    expect(fetch).toHaveBeenCalledOnce();
  });
  it("does not repeat an image edit POST", async () => {
    const fetch = vi.fn().mockRejectedValue(new TypeError("connection lost"));
    vi.stubGlobal("fetch", fetch);
    const adapter = buildAdapter({
      id: "provider",
      name: "test",
      baseUrl: "https://example.test",
      apiKey: "test",
      protocol: "openai-images",
    });
    await expect(
      adapter.generate(
        {
          ...request,
          referenceImages: [
            { key: "uploads/a.png", mimeType: "image/png", b64: "aGVsbG8=" },
          ],
        },
        new AbortController().signal,
      ),
    ).rejects.toThrow("connection lost");
    expect(fetch).toHaveBeenCalledOnce();
  });
  it("leaves the existing retry policy unchanged for ordinary generation", () => {
    expect(
      generationFetchRetry({ ...request, executionPolicy: undefined })?.retries,
    ).toBe(4);
  });
});
