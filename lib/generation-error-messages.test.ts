import { describe, expect, it } from "vitest";
import { ProviderChannelLimitedError } from "@/lib/providers/diagnostics";
import {
  generationFailureCode,
  userFacingGenerationError,
} from "@/workers/generation-worker-errors";

describe("generation failure mapping", () => {
  it("names the unavailable size tier instead of blaming the prompt", () => {
    const error = new ProviderChannelLimitedError();

    expect(generationFailureCode(error)).toBe("CHANNEL_LIMITED");
    expect(userFacingGenerationError(error)).toContain("2K");
  });
});
