import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/generations", () => ({
  createGeneration: vi.fn(),
  GenerationRequestError: class extends Error {},
  generationRequestSchema: { parse: (value: unknown) => value },
}));

import { parseChatImageToolArgs } from "./chat-image-tool";
import { chatImageToolOutput } from "./chat-image-tool-definition";

const parse = (value: unknown) => parseChatImageToolArgs(JSON.stringify(value));

describe("parseChatImageToolArgs", () => {
  it("accepts a prompt alone", () => {
    expect(parse({ prompt: " 一只猫 " })).toEqual({
      ok: true,
      value: { prompt: "一只猫" },
      ignored: [],
    });
  });

  it("keeps valid optional arguments", () => {
    expect(
      parse({ prompt: "一只猫", size: "1024x1024", quality: "high", n: 2 }),
    ).toEqual({
      ok: true,
      value: { prompt: "一只猫", size: "1024x1024", quality: "high", n: 2 },
      ignored: [],
    });
  });

  it("treats null and empty optional arguments as not set", () => {
    expect(
      parse({
        prompt: "一只猫",
        modelId: null,
        size: null,
        quality: "",
        background: null,
        n: null,
      }),
    ).toEqual({ ok: true, value: { prompt: "一只猫" }, ignored: [] });
  });

  it("drops invalid or unknown arguments instead of failing the call", () => {
    expect(
      parse({
        prompt: "一只猫",
        size: "16:9",
        quality: "hd",
        n: 9,
        aspect_ratio: "16:9",
      }),
    ).toEqual({
      ok: true,
      value: { prompt: "一只猫" },
      ignored: ["size", "quality", "n", "aspect_ratio"],
    });
  });

  it("accepts a count sent as a numeric string", () => {
    expect(parse({ prompt: "一只猫", n: "3" })).toMatchObject({
      ok: true,
      value: { n: 3 },
      ignored: [],
    });
  });

  it("fails only when the prompt is unusable, and says why", () => {
    expect(parse({ size: "1024x1024" })).toEqual({
      ok: false,
      message: "生图工具缺少画面描述，请重新描述想生成的画面",
    });
    expect(parse({ prompt: "字".repeat(4001) })).toEqual({
      ok: false,
      message: "画面描述超过 4000 字，请精简后重试",
    });
    expect(parseChatImageToolArgs("{not json")).toEqual({
      ok: false,
      message: "生图工具参数格式异常，请重新描述想生成的画面",
    });
    expect(parseChatImageToolArgs("[]")).toMatchObject({ ok: false });
  });
});

describe("chatImageToolOutput with ignored arguments", () => {
  it("tells the model which arguments did not take effect", () => {
    const receipt = JSON.parse(
      chatImageToolOutput({
        ok: true,
        generationId: "gen_1",
        status: "PENDING",
        ignored: ["size"],
      }),
    );
    expect(receipt.ignored).toEqual(["size"]);
    expect(receipt.next).toContain("没有生效");
  });

  it("leaves the receipt unchanged when nothing was ignored", () => {
    const receipt = JSON.parse(
      chatImageToolOutput({
        ok: true,
        generationId: "gen_1",
        status: "PENDING",
      }),
    );
    expect(receipt).not.toHaveProperty("ignored");
    expect(receipt.next).not.toContain("没有生效");
  });
});
