import { describe, expect, it } from "vitest";

import { inpaintModelCandidates, inpaintSizeFor } from "./inpaint-routing";
import type { ModelInfo } from "./types";

function model(id: string, overrides: Partial<ModelInfo["capabilities"]> = {}, available = true) {
  return {
    id,
    displayName: id,
    vendor: "",
    protocol: "openai-images",
    available,
    defaults: { size: "auto", responseFormat: "b64_json", outputFormat: "png", background: "auto" },
    capabilities: {
      sizes: ["auto", "1024x1024", "1536x1024", "1024x1536", "2048x2048", "2048x1152", "3840x2160", "2160x3840"],
      gifSizes: ["512x512", "768x768"],
      responseFormats: ["b64_json"],
      resolutions: ["1K", "2K", "4K"],
      supportsReferenceImage: true,
      maxReferenceImages: 16,
      supportsNegativePrompt: false,
      supportsSeed: false,
      maxN: 1,
      outputFormats: ["png", "gif"],
      backgrounds: ["auto"],
      supportsOutputCompression: false,
      ...overrides,
    },
  } as ModelInfo;
}

describe("inpaint routing", () => {
  it("prefers Sunburst by default and the selected model when eligible", () => {
    const models = [
      model("gpt-image-2.6-flare"),
      model("gpt-image-2.6-sunburst"),
      model("nano", { supportsReferenceImage: false }),
      model("gpt-image-2.5-sunburst", {}, false),
    ];
    expect(inpaintModelCandidates(models).map((item) => item.id)).toEqual([
      "gpt-image-2.6-sunburst",
      "gpt-image-2.6-flare",
    ]);
    expect(inpaintModelCandidates(models, "gpt-image-2.6-flare")[0].id).toBe(
      "gpt-image-2.6-flare",
    );
  });

  it("matches the source aspect without paying for a bigger tier", () => {
    const m = model("gpt-image-2.6-sunburst");
    expect(inpaintSizeFor(m, 1024, 1024)).toBe("1024x1024");
    expect(inpaintSizeFor(m, 1254, 836)).toBe("1536x1024");
    expect(inpaintSizeFor(m, 800, 1200)).toBe("1024x1536");
    expect(inpaintSizeFor(m, 1920, 1080)).toBe("2048x1152");
    expect(inpaintSizeFor(m, 3840, 2160)).toBe("3840x2160");
  });
});
