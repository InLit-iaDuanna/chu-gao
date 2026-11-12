// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getModel } from "@/lib/models/registry";
import {
  generationRequestSchema,
  validateAgainstModelDefinition,
} from "@/lib/models/validate";
import { imageSizeOptionsForFormat } from "@/lib/models/options";
import { OpenAIImagesAdapter } from "@/lib/providers/openai-images";

const mocks = vi.hoisted(() => ({ fetch: vi.fn(), config: vi.fn() }));
vi.mock("@/lib/http", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/http")>()),
  fetchWithTimeout: mocks.fetch,
}));
vi.mock("@/lib/provider-channel-request-config", () => ({
  getChannelRequestConfig: mocks.config,
  renderBodyTemplate: () => ({
    model: "gpt-image-2.6-flare",
    output_format: "png",
    size: "auto",
  }),
}));

const input = {
  modelId: "gpt-image-2.6-flare",
  prompt: "An animated clock",
  n: 1,
  outputFormat: "gif" as const,
};
const model = getModel(input.modelId)!;

describe("GIF request boundaries", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.config.mockResolvedValue({ responseFormat: "b64_json" });
    mocks.fetch.mockResolvedValue(
      new Response(JSON.stringify({ data: [{ b64_json: "R0lGODlh" }] }), {
        status: 200,
      }),
    );
  });

  it("uses a GIF default and keeps small GIF sizes out of still-image options", () => {
    const parsed = generationRequestSchema.parse(input);
    expect(validateAgainstModelDefinition(parsed, model).size).toBe("512x512");
    expect(imageSizeOptionsForFormat(model, "gif")).toEqual([
      "512x512",
      "768x768",
    ]);
    expect(imageSizeOptionsForFormat(model, "png")).not.toContain("512x512");
  });

  it.each(["1024x1024", "2048x2048", "3840x2160"])(
    "rejects %s GIF before dispatch",
    (size) => {
      const parsed = generationRequestSchema.parse({ ...input, size });
      expect(() => validateAgainstModelDefinition(parsed, model)).toThrow(
        "尺寸",
      );
    },
  );

  it("rejects GIF on Image2.5 and GIF dimensions on PNG", () => {
    expect(() =>
      validateAgainstModelDefinition(input, getModel("gpt-image-2.5-flare")!),
    ).toThrow();
    expect(() =>
      validateAgainstModelDefinition(
        { ...input, outputFormat: "png", size: "512x512" },
        model,
      ),
    ).toThrow();
  });

  it.each([false, true])(
    "sends GIF output format with template=%s",
    async (template) => {
      mocks.config.mockResolvedValue({
        responseFormat: "b64_json",
        bodyTemplate: template ? "{}" : undefined,
      });
      const adapter = new OpenAIImagesAdapter({
        id: "test",
        name: "test",
        protocol: "openai-images",
        baseUrl: "https://example.test",
        apiKey: "test-only",
      });
      const result = await adapter.generate(
        validateAgainstModelDefinition(input, model),
        new AbortController().signal,
      );
      const body = JSON.parse(mocks.fetch.mock.calls[0][1].body);
      expect(body.output_format).toBe("gif");
      expect(body.size).toBe("512x512");
      expect(body.n).toBe(1);
      expect(result.images[0].mimeType).toBe("image/gif");
    },
  );

  it("preserves GIF output format for reference-image edits", async () => {
    const adapter = new OpenAIImagesAdapter({
      id: "test",
      name: "test",
      protocol: "openai-images",
      baseUrl: "https://example.test",
      apiKey: "test-only",
    });
    const req = validateAgainstModelDefinition(input, model);
    req.referenceImages = [
      { key: "test.png", b64: "aW1hZ2U=", mimeType: "image/png" },
    ];
    await adapter.generate(req, new AbortController().signal);
    const body = mocks.fetch.mock.calls[0][1].body as FormData;
    expect(body.get("output_format")).toBe("gif");
    expect(body.get("size")).toBe("512x512");
  });
});
