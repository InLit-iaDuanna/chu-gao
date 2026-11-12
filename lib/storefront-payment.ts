import { createHash, randomBytes } from "node:crypto";

import type { StorefrontOrder } from "@prisma/client";

import { decrypt, encrypt } from "@/lib/crypto";
import { normalizeRedemptionCode } from "@/lib/redemption-code";

export const STOREFRONT_CURRENCY = "CNY";
export const STOREFRONT_FEE_RATE = 0;
export const STOREFRONT_CREDITS_PER_YUAN = 100;
export const STOREFRONT_ORDER_TTL_MS = 30 * 60 * 1000;

const ALLOWED_HOSTS = new Set(["wzyp.cn", "pay.ldxp.cn"]);
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{3,80}$/;

export interface StorefrontProduct {
  credits: number;
  goodsKey: string;
  price: number;
}

export interface StorefrontRuntime {
  enabled: boolean;
  baseUrl: string;
  shopUrl: string;
  channelId: number | null;
  products: StorefrontProduct[];
}

export interface StorefrontOrderResponse {
  order_id: string;
  credits: number;
  amount: number;
  pay_amount: number;
  currency: string;
  contact: string;
  status: string;
  pay_url?: string;
  out_trade_no?: string;
  payment_trade_no?: string;
  expires_at: string;
  paid_at?: string;
  completed_at?: string;
  message?: string;
}

export interface StorefrontBrowserCheckout {
  base_url: string;
  shop_url: string;
  item_url: string;
  goods_key: string;
  contact: string;
  query_password: string;
  channel_id?: number;
}

export function parseStorefrontBoolean(value: string | undefined): boolean {
  return ["1", "true", "yes", "on"].includes(
    (value ?? "").trim().toLowerCase(),
  );
}

function validHost(value: string): boolean {
  return ALLOWED_HOSTS.has(value.toLowerCase().replace(/\.$/, ""));
}

export function storefrontOrigin(raw: string): URL | null {
  try {
    const parsed = new URL(raw);
    if (
      parsed.protocol !== "https:" ||
      parsed.username ||
      parsed.password ||
      parsed.port ||
      !validHost(parsed.hostname)
    ) {
      return null;
    }
    parsed.pathname = "";
    parsed.search = "";
    parsed.hash = "";
    return parsed;
  } catch {
    return null;
  }
}

function parseShop(
  raw: string | undefined,
): { origin: URL; shopUrl: string } | null {
  if (!raw?.trim()) return null;
  try {
    const parsed = new URL(raw.trim());
    if (!storefrontOrigin(parsed.href)) return null;
    const parts = parsed.pathname.split("/").filter(Boolean);
    if (
      parts.length !== 2 ||
      parts[0] !== "shop" ||
      !TOKEN_PATTERN.test(parts[1])
    ) {
      return null;
    }
    const origin = storefrontOrigin(parsed.origin);
    if (!origin) return null;
    return { origin, shopUrl: `${origin.origin}/shop/${parts[1]}` };
  } catch {
    return null;
  }
}

export function storefrontPrice(credits: number): number {
  return credits / STOREFRONT_CREDITS_PER_YUAN;
}

function productFromValue(value: unknown): StorefrontProduct | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const credits = Number(row.credits);
  const goodsKey = String(
    row.goodsKey ?? row.goods_key ?? row.productId ?? "",
  ).trim();
  if (!Number.isInteger(credits) || credits < 1 || credits > 1_000_000)
    return null;
  if (!TOKEN_PATTERN.test(goodsKey)) return null;
  return { credits, goodsKey, price: storefrontPrice(credits) };
}

function configuredProducts(): StorefrontProduct[] {
  const rows: StorefrontProduct[] = [];
  const raw = process.env.CHUGAO_STOREFRONT_PRODUCTS_JSON?.trim();
  if (raw) {
    try {
      const parsed: unknown = JSON.parse(raw);
      const values = Array.isArray(parsed)
        ? parsed
        : parsed && typeof parsed === "object"
          ? Object.entries(parsed as Record<string, unknown>).map(
              ([credits, goodsKey]) => ({
                credits: Number(credits),
                goodsKey,
              }),
            )
          : [];
      for (const value of values) {
        const product = productFromValue(value);
        if (product) rows.push(product);
      }
    } catch {
      // Invalid optional configuration keeps the feature disabled below.
    }
  }

  for (const credits of [100, 500, 1000, 2000, 5000, 10000]) {
    const product = productFromValue({
      credits,
      goodsKey: process.env[`CHUGAO_STOREFRONT_GOODS_${credits}`],
    });
    if (product) rows.push(product);
  }

  const deduped = new Map<number, StorefrontProduct>();
  for (const product of rows) deduped.set(product.credits, product);
  return [...deduped.values()].sort((a, b) => a.credits - b.credits);
}

export function getStorefrontRuntime(): StorefrontRuntime {
  const shop = parseShop(process.env.CHUGAO_STOREFRONT_SHOP_URL);
  const products = configuredProducts();
  const enabled =
    parseStorefrontBoolean(process.env.CHUGAO_STOREFRONT_ENABLED) &&
    Boolean(shop) &&
    products.length > 0;
  const channelId = Number(process.env.CHUGAO_STOREFRONT_CHANNEL_ID);

  return {
    enabled,
    baseUrl: shop?.origin.origin ?? "https://wzyp.cn",
    shopUrl: shop?.shopUrl ?? "",
    channelId: Number.isInteger(channelId) && channelId > 0 ? channelId : null,
    products: enabled ? products : [],
  };
}

export function storefrontProduct(
  runtime: StorefrontRuntime,
  credits: number,
): StorefrontProduct | null {
  return (
    runtime.products.find((product) => product.credits === credits) ?? null
  );
}

export function createStorefrontQueryPassword(): string {
  return randomBytes(24).toString("base64url");
}

export function hashStorefrontQueryPassword(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function encryptStorefrontQueryPassword(value: string): string {
  return encrypt(value);
}

export function decryptStorefrontQueryPassword(value: string): string {
  return decrypt(value);
}

export function storefrontContact(userId: string): string {
  const raw = userId.trim();
  return raw.length >= 6 ? raw : `CG${raw.padStart(6, "0")}`;
}

export function storefrontItemUrl(
  runtime: StorefrontRuntime,
  goodsKey: string,
): string {
  return `${runtime.baseUrl}/item/${encodeURIComponent(goodsKey)}`;
}

export function validStorefrontExternalUrl(raw: string): boolean {
  const origin = storefrontOrigin(raw);
  return Boolean(origin);
}

export function sameStorefrontAmount(left: number, right: number): boolean {
  return (
    Number.isFinite(left) &&
    Number.isFinite(right) &&
    Math.round(left * 100) === Math.round(right * 100) &&
    Math.abs(left * 100 - Math.round(left * 100)) < 1e-6 &&
    Math.abs(right * 100 - Math.round(right * 100)) < 1e-6
  );
}

export function storefrontOrderResponse(
  order: StorefrontOrder,
  message?: string,
): StorefrontOrderResponse {
  return {
    order_id: order.id,
    credits: order.credits,
    amount: Number(order.amount),
    pay_amount: Number(order.amount),
    currency: STOREFRONT_CURRENCY,
    contact: order.contact,
    status: order.status,
    ...(order.payUrl ? { pay_url: order.payUrl } : {}),
    ...(order.externalTradeNo
      ? { payment_trade_no: order.externalTradeNo }
      : {}),
    expires_at: order.expiresAt.toISOString(),
    ...(order.paidAt ? { paid_at: order.paidAt.toISOString() } : {}),
    ...(order.completedAt
      ? { completed_at: order.completedAt.toISOString() }
      : {}),
    ...(message ? { message } : {}),
  };
}

export function storefrontCheckoutResponse(
  runtime: StorefrontRuntime,
  product: StorefrontProduct,
  contact: string,
  queryPassword: string,
): StorefrontBrowserCheckout {
  return {
    base_url: runtime.baseUrl,
    shop_url: runtime.shopUrl,
    item_url: storefrontItemUrl(runtime, product.goodsKey),
    goods_key: product.goodsKey,
    contact,
    query_password: queryPassword,
    ...(runtime.channelId ? { channel_id: runtime.channelId } : {}),
  };
}

export function normalizedExternalCard(value: string): string {
  return normalizeRedemptionCode(value).slice(0, 128);
}
