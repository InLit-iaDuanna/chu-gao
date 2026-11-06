import { describe, expect, it } from "vitest";
import { getModel } from "./registry";
import {
  isImage2ModelId,
  supportsProviderChannels,
} from "../provider-channels";
import { supportedModelIds } from "../providers/availability";

describe("Image 2.5 models", () => {
  it.each(["gpt-image-2.5-flare", "gpt-image-2.5-sunburst"])(
    "registers %s without legacy mode aliases",
    (id) => {
      const model = getModel(id)!;
      expect(model.id).toBe(id);
      expect(model.protocol).toBe("openai-images");
      expect(model.defaults.responseFormat).toBe("b64_json");
      expect(model.defaults.image2Mode).toBeUndefined();
      expect(model.capabilities.image2Modes).toBeUndefined();
      expect(model.defaults.quality).toBe("high");
      expect(model.capabilities.qualities).toEqual([
        "low",
        "medium",
        "high",
        "xhigh",
        "max",
      ]);
      expect(model.capabilities.maxN).toBe(1);
      expect(model.capabilities.supportsOutputCompression).toBe(false);
      expect(supportedModelIds(id)).toEqual([id]);
      expect(isImage2ModelId(id)).toBe(true);
      expect(supportsProviderChannels(id)).toBe(true);
    },
  );
});
