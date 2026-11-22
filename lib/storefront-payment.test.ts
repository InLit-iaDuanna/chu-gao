import type { StorefrontOrder } from "@prisma/client";
import { afterEach, describe, expect, it } from "vitest";

import {
  getStorefrontRuntime,
  storefrontOrderResponse,
} from "@/lib/storefront-payment";
import { STOREFRONT_CREDIT_TIERS } from "@/lib/storefront-tiers";

const ENV_KEYS = [
  "CHUGAO_STOREFRONT_ENABLED",
  "CHUGAO_STOREFRONT_SHOP_URL",
  "CHUGAO_STOREFRONT_PRODUCTS_JSON",
  "CHUGAO_STOREFRONT_GOODS_100",
];
const savedEnv = Object.fromEntries(
  ENV_KEYS.map((key) => [key, process.env[key]]),
);

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

function order(overrides: Partial<StorefrontOrder> = {}): StorefrontOrder {
  return {
    id: "order-1",
    userId: "user-1",
    productId: "goods100",
    credits: 100,
    amount: 1 as unknown as StorefrontOrder["amount"],
    contact: "user-1",
    queryPasswordHash: "",
    queryPasswordEncrypted: "",
    payUrl: null,
    externalTradeNo: null,
    externalProductId: null,
    externalAmount: null,
    status: "PENDING",
    expiresAt: new Date("2026-11-21T10:00:00.000Z"),
    paidAt: null,
    completedAt: null,
    redemptionCodeId: null,
    lastErrorCode: null,
    createdAt: new Date("2026-11-21T09:30:00.000Z"),
    updatedAt: new Date("2026-11-21T09:30:00.000Z"),
    ...overrides,
  };
}

describe("storefront order response", () => {
  it("reports the payment deadline unchanged once a shop order is bound", () => {
    for (const value of [order(), order({ externalTradeNo: "T123456" })]) {
      expect(storefrontOrderResponse(value).expires_at).toBe(
        value.expiresAt.toISOString(),
      );
    }
  });
});

describe("storefront products", () => {
  it("only exposes credit tiers the order flow accepts", () => {
    process.env.CHUGAO_STOREFRONT_ENABLED = "true";
    process.env.CHUGAO_STOREFRONT_SHOP_URL = "https://wzyp.cn/shop/abc123";
    process.env.CHUGAO_STOREFRONT_PRODUCTS_JSON = JSON.stringify({
      "100": "goods100",
      "3000": "goods3000",
    });
    delete process.env.CHUGAO_STOREFRONT_GOODS_100;

    const runtime = getStorefrontRuntime();
    expect(runtime.enabled).toBe(true);
    expect(runtime.products.map((product) => product.credits)).toEqual([100]);
  });

  it("accepts every shared tier at 100 credits per yuan", () => {
    process.env.CHUGAO_STOREFRONT_ENABLED = "true";
    process.env.CHUGAO_STOREFRONT_SHOP_URL = "https://wzyp.cn/shop/abc123";
    process.env.CHUGAO_STOREFRONT_PRODUCTS_JSON = JSON.stringify(
      Object.fromEntries(
        STOREFRONT_CREDIT_TIERS.map((credits) => [credits, `goods${credits}`]),
      ),
    );

    expect(getStorefrontRuntime().products).toEqual(
      STOREFRONT_CREDIT_TIERS.map((credits) => ({
        credits,
        goodsKey: `goods${credits}`,
        price: credits / 100,
      })),
    );
  });
});
