import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/provider-channel-request-config", () => ({
  getChannelRequestConfig: async () => ({ responseFormat: "b64_json" }),
  renderBodyTemplate: vi.fn(),
}));

import { OpenAIImagesAdapter } from "@/lib/providers/openai-images";
import { OpenAIResponsesImageAdapter } from "@/lib/providers/openai-responses-image";
import type { InternalRequest } from "@/lib/models/types";

const imageModels = [
  "gpt-image-2.6",
  "gpt-image-2.6-flare",
  "gpt-image-2.6-sunburst",
] as const;

function request(
  modelId: string,
  protocol: InternalRequest["protocol"],
): InternalRequest {
  return {
    modelId,
    protocol,
    prompt: "A test image",
    size: "2048x2048",
    quality: "max",
    responseFormat: "b64_json",
    aspectRatio: "1:1",
    resolution: "2K",
    n: 1,
    outputFormat: "png",
    background: "auto",
    executionPolicy: "single-submit",
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("Image 2.6 provider requests", () => {
  it.each(imageModels)(
    "sends %s to the OpenAI Images endpoint",
    async (modelId) => {
      const fetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ data: [{ b64_json: "aGVsbG8=" }] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
      vi.stubGlobal("fetch", fetch);

      const adapter = new OpenAIImagesAdapter({
        id: "provider",
        name: "test",
        protocol: "openai-images",
        baseUrl: "https://example.test",
        apiKey: "test",
      });

      await adapter.generate(
        request(modelId, "openai-images"),
        new AbortController().signal,
      );

      const init = fetch.mock.calls[0]?.[1] as RequestInit;
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      expect(body.model).toBe(modelId);
      expect(body.quality).toBe("max");
      expect(body.size).toBe("2048x2048");
      expect(body).not.toHaveProperty("output_format");
      expect(body).not.toHaveProperty("background");
    },
  );

  it.each(imageModels)(
    "selects %s in the Responses image tool",
    async (modelId) => {
      const fetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ output: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
      vi.stubGlobal("fetch", fetch);

      const adapter = new OpenAIResponsesImageAdapter({
        id: "provider",
        name: "test",
        protocol: "openai-responses-image",
        baseUrl: "https://example.test",
        apiKey: "test",
      });

      await adapter.generate(
        request(modelId, "openai-responses-image"),
        new AbortController().signal,
      );

      const init = fetch.mock.calls[0]?.[1] as RequestInit;
      const body = JSON.parse(String(init.body)) as {
        tools: Array<Record<string, unknown>>;
      };
      expect(body.tools[0]?.model).toBe(modelId);
      expect(body.tools[0]?.quality).toBe("max");
      expect(body.tools[0]?.size).toBe("2048x2048");
    },
  );
});
