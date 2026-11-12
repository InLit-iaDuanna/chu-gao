// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  read: vi.fn(),
  upsert: vi.fn(),
  transaction: vi.fn(),
  encrypt: vi.fn(),
  decrypt: vi.fn(),
  session: vi.fn(),
  failure: vi.fn(),
  audit: vi.fn(),
  sol: vi.fn(),
}));
vi.mock("@/lib/db", () => ({
  db: {
    systemConfig: { findMany: mocks.read, upsert: mocks.upsert },
    $transaction: mocks.transaction,
  },
}));
vi.mock("@/lib/crypto", () => ({
  encrypt: mocks.encrypt,
  decrypt: mocks.decrypt,
}));
vi.mock("@/lib/auth", () => ({
  checkSession: mocks.session,
  adminFailureResponse: mocks.failure,
  authenticatedUser: () => ({ id: "admin" }),
}));
vi.mock("@/lib/audit", () => ({ audit: mocks.audit }));
vi.mock("@/lib/ai-config", () => ({
  getConversationConfig: async () => ({ enabled: false }),
  getConversationPricing: async () => ({
    standardCredits: 0.2,
    reasoningCredits: 0.3,
  }),
}));
vi.mock("@/lib/luna-config", () => ({
  getLunaConfig: async () => ({ enabled: false }),
}));
vi.mock("@/lib/sol-config", () => ({
  getSolConfig: mocks.sol,
}));

import {
  getOpusConfig,
  getOpusStatus,
  OPUS_CONFIG_KEYS,
  OPUS_DEFAULT_PRICING,
  opusConfigUpdateSchema,
  setOpusConfig,
} from "./opus-config";
import { getChatCatalog } from "./chat-models";
import { getChatProfile } from "./chat-profiles";
import { OPUS_MODEL_ID, REASONING_EFFORTS } from "./chat-model-options";
import { SYSTEM_CONFIG_DEFAULT_ROWS } from "./system-config";
import { GET, PATCH } from "@/app/api/admin/integrations/opus/route";

describe("private Opus configuration and public catalog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("DATABASE_URL", "postgresql://fixture.invalid/test");
    mocks.read.mockResolvedValue([]);
    mocks.encrypt.mockReturnValue("encrypted-fixture");
    mocks.decrypt.mockReturnValue("synthetic-key");
    mocks.upsert.mockResolvedValue({});
    mocks.transaction.mockImplementation((writes) => Promise.all(writes));
    mocks.failure.mockReturnValue(null);
    mocks.sol.mockResolvedValue({ enabled: false });
  });
  afterEach(() => vi.unstubAllEnvs());

  it("defaults disabled with user-confirmed per-million rates and no key", async () => {
    expect(await getOpusConfig()).toMatchObject({
      enabled: false,
      apiKey: null,
      model: OPUS_MODEL_ID,
      baseUrl: "https://botcf.com",
      pricing: OPUS_DEFAULT_PRICING,
    });
    for (const key of Object.values(OPUS_CONFIG_KEYS))
      expect(Object.keys(SYSTEM_CONFIG_DEFAULT_ROWS)).not.toContain(key);
    vi.stubEnv("DATABASE_URL", "");
    mocks.read.mockClear();
    expect((await getOpusConfig()).enabled).toBe(false);
    expect(mocks.read).not.toHaveBeenCalled();
  });

  it("encrypts write-only credentials and updates only the requested rates", async () => {
    await setOpusConfig({
      apiKey: " synthetic-key ",
      baseUrl: "https://fixture.invalid/v1/",
      pricing: { cacheRead: 0.123456 },
    });
    expect(mocks.encrypt).toHaveBeenCalledExactlyOnceWith("synthetic-key");
    const writes = mocks.upsert.mock.calls.map(([input]) => input.create);
    expect(writes).toEqual(
      expect.arrayContaining([
        { key: OPUS_CONFIG_KEYS.apiKeyEnc, value: "encrypted-fixture" },
        { key: OPUS_CONFIG_KEYS.baseUrl, value: "https://fixture.invalid/v1" },
        { key: OPUS_CONFIG_KEYS.cacheRead, value: 0.123456 },
      ]),
    );
    expect(JSON.stringify(writes)).not.toContain("synthetic-key");
    expect(writes).toHaveLength(3);
    mocks.upsert.mockClear();
    await setOpusConfig({ apiKey: "" });
    expect(mocks.upsert.mock.calls[0][0].create).toEqual({
      key: OPUS_CONFIG_KEYS.apiKeyEnc,
      value: "",
    });
  });

  it.each([
    {},
    { pricing: {} },
    { pricing: { output: -1 } },
    { pricing: { input: 0.0000001 } },
    { pricing: { input: 1_000_001 } },
    { credits: 0.2 },
    { model: "other" },
    { baseUrl: "https://user:password@fixture.invalid" },
    { baseUrl: "https://fixture.invalid?key=secret" },
  ])("rejects invalid or unsupported configuration %j", (input) => {
    expect(opusConfigUpdateSchema.safeParse(input).success).toBe(false);
  });

  it("exposes only per-million pricing and supported capabilities in the user catalog", async () => {
    mocks.read.mockResolvedValue([
      { key: OPUS_CONFIG_KEYS.enabled, value: true },
      { key: OPUS_CONFIG_KEYS.apiKeyEnc, value: "encrypted-fixture" },
      { key: OPUS_CONFIG_KEYS.input, value: 120 },
    ]);
    const catalog = await getChatCatalog();
    expect(catalog.models).toEqual([
      expect.objectContaining({
        id: OPUS_MODEL_ID,
        pricing: { ...OPUS_DEFAULT_PRICING, input: 120 },
        reasoningEfforts: [...REASONING_EFFORTS],
        supportsWebSearch: false,
      }),
    ]);
    expect(JSON.stringify(catalog)).not.toMatch(
      /synthetic-key|encrypted-fixture|https?:|baseUrl|apiKey/,
    );
    expect(await getChatProfile(OPUS_MODEL_ID)).toMatchObject({
      transport: "chat_completions_sse",
      tokenPricing: { pricing: { input: 120 } },
      efforts: [...REASONING_EFFORTS],
    });
    const status = await getOpusStatus();
    expect(status.hasKey).toBe(true);
    expect(status).not.toHaveProperty("apiKey");
    mocks.decrypt.mockImplementation(() => {
      throw new Error("invalid encryption");
    });
    expect((await getOpusStatus()).hasKey).toBe(false);
  });

  it("uses Opus as the chat default when it becomes available", async () => {
    mocks.read.mockResolvedValue([
      { key: OPUS_CONFIG_KEYS.enabled, value: true },
      { key: OPUS_CONFIG_KEYS.apiKeyEnc, value: "encrypted-fixture" },
    ]);
    mocks.sol.mockResolvedValue({
      enabled: true,
      apiKey: "synthetic-sol",
      credits: 0.2,
    });
    expect((await getChatCatalog()).defaultModelId).toBe(OPUS_MODEL_ID);
  });

  it("requires admin access and audits no credential value", async () => {
    mocks.failure.mockReturnValueOnce(new Response(null, { status: 403 }));
    expect(
      (await GET(new Request("https://fixture.invalid/admin"))).status,
    ).toBe(403);
    expect(mocks.read).not.toHaveBeenCalled();
    const response = await PATCH(
      new Request("https://fixture.invalid/admin", {
        method: "PATCH",
        body: JSON.stringify({
          enabled: true,
          apiKey: "synthetic-key",
          pricing: { input: 100, output: 500, cacheRead: 5, cacheCreation: 60 },
        }),
      }),
    );
    expect(response.status).toBe(200);
    expect(mocks.audit.mock.calls[0][0].diff).toEqual({
      enabled: true,
      apiKeyChanged: true,
      pricing: { input: 100, output: 500, cacheRead: 5, cacheCreation: 60 },
    });
    expect(JSON.stringify(mocks.audit.mock.calls[0][0].diff)).not.toContain(
      "synthetic-key",
    );
    expect(JSON.stringify(await response.json())).not.toContain(
      "synthetic-key",
    );
    expect(
      (
        await PATCH(
          new Request("https://fixture.invalid/admin", {
            method: "PATCH",
            body: '{"credits":5}',
          }),
        )
      ).status,
    ).toBe(400);
  });
});
