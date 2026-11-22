import { afterEach, expect, it, vi } from "vitest";

vi.mock("@/lib/ai-config", () => ({
  DEFAULT_DEEPSEEK_BASE_URL: "https://api.deepseek.com",
  getDeepSeekConfig: vi.fn(),
}));
vi.mock("@/lib/model-call-log", () => ({
  withModelCall: (_context: unknown, run: (call: unknown) => unknown) =>
    run({ response: () => {}, usage: () => {} }),
}));

import { getDeepSeekConfig } from "@/lib/ai-config";

import {
  callListenFlash,
  flashEndpoint,
  flashRequestBody,
  generateListenReaction,
} from "./chat-listen-flash";

afterEach(() => vi.unstubAllGlobals());

const config = (apiKey: string) =>
  vi.mocked(getDeepSeekConfig).mockResolvedValue({
    enabled: false,
    apiKey,
    baseUrl: "https://api.deepseek.com/",
    model: "deepseek-chat",
    systemPrompt: "",
  } as never);

it("builds the chat completions address from any base", () => {
  expect(flashEndpoint("https://api.deepseek.com/")).toBe(
    "https://api.deepseek.com/v1/chat/completions",
  );
  expect(flashEndpoint("https://gw.example.com/v1")).toBe(
    "https://gw.example.com/v1/chat/completions",
  );
  expect(flashEndpoint("")).toBe("https://api.deepseek.com/v1/chat/completions");
});

it("asks Flash with thinking off", () => {
  const body = flashRequestBody([{ role: "user", content: "hi" }], 24);
  expect(body).toMatchObject({
    model: "deepseek-flash",
    max_tokens: 24,
    stream: false,
    thinking: { type: "disabled" },
  });
});

it("stays out of the way without a DeepSeek key", async () => {
  config("");
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  expect(await generateListenReaction([], ["累死了"])).toBeNull();
  expect(fetchMock).not.toHaveBeenCalled();
});

it("ignores the optimizer switch and reads the reply", async () => {
  config("sk-test");
  const fetchMock = vi.fn(async () =>
    Response.json({ choices: [{ message: { content: "care 抱抱" } }] }),
  );
  vi.stubGlobal("fetch", fetchMock);
  expect(await generateListenReaction([], ["累死了"])).toEqual({
    reaction: "care",
    line: "抱抱",
  });
  const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
  expect(url).toBe("https://api.deepseek.com/v1/chat/completions");
  expect(init.headers).toMatchObject({ Authorization: "Bearer sk-test" });
});

it("keeps the reaction but drops a murmur already said in this stretch", async () => {
  config("sk-test");
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json({ choices: [{ message: { content: "care 辛苦了" } }] }),
    ),
  );
  expect(
    await generateListenReaction([], ["还要改方案"], undefined, ["辛苦了"]),
  ).toEqual({ reaction: "care", line: null });
});

it("throws on an upstream error so the caller can fall back", async () => {
  config("sk-test");
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("bad", { status: 401 })),
  );
  await expect(
    callListenFlash([{ role: "user", content: "x" }], {
      maxTokens: 10,
      operation: "test",
    }),
  ).rejects.toBeTruthy();
});
