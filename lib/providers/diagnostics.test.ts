import { describe, expect, it } from "vitest";
import {
  ProviderChannelLimitedError,
  ProviderRequestError,
  classifyProviderFailure,
} from "@/lib/providers/diagnostics";

function upstream(status: number, body: string, statusText = "Bad Request") {
  return new ProviderRequestError({
    provider: "xixiapi",
    protocol: "openai-images",
    status,
    statusText,
    endpoint: "https://xixiapi.io/v1/images/edits",
    requestId: "request-1",
    bodyPreview: body,
  });
}

describe("classifyProviderFailure", () => {
  it("treats a size tier the channel switched off as a channel limit", () => {
    const error = upstream(
      400,
      '{"error":{"code":"four_k_disabled","message":"4K图片暂时不能生成"}}',
    );

    expect(classifyProviderFailure(error).category).toBe("CHANNEL_LIMITED");
  });

  it("treats a model the channel has not priced as a channel limit", () => {
    const error = upstream(
      400,
      '{"error":{"code":"model_price_error","message":"Model gpt-image-2.6-flare has not been priced by the administrator yet."}}',
    );

    expect(classifyProviderFailure(error).category).toBe("CHANNEL_LIMITED");
  });

  it("keeps genuine parameter rejections as bad requests", () => {
    const error = upstream(
      400,
      '{"error":{"code":"invalid_parameter","message":"invalid size"}}',
    );

    expect(classifyProviderFailure(error).category).toBe("BAD_REQUEST");
  });

  it("keeps content policy rejections separate from channel limits", () => {
    const error = upstream(
      400,
      '{"error":{"code":"moderation_blocked","message":"content policy violation"}}',
    );

    expect(classifyProviderFailure(error).category).toBe("CONTENT_REJECTED");
  });

  it("recovers the same category from a serialized provider message", () => {
    const error = new Error(
      'Provider xixiapi openai-images request failed: 400 Bad Request endpoint=https://xixiapi.io/v1/images/edits body={"error":{"code":"four_k_disabled","message":"4K图片暂时不能生成"}}',
    );

    expect(classifyProviderFailure(error).category).toBe("CHANNEL_LIMITED");
  });

  it("classifies its own wrapper error", () => {
    expect(classifyProviderFailure(new ProviderChannelLimitedError()).category).toBe(
      "CHANNEL_LIMITED",
    );
  });
});
