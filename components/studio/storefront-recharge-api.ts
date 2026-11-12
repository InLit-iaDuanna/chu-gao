import { ApiError, request } from "./lib/api";

export interface StorefrontRechargeOption {
  credits: number;
  price: number;
  currency: string;
}

export interface StorefrontRechargeConfig {
  enabled: boolean;
  fee_rate: number;
  currency: string;
  payment_tip?: string;
  products: StorefrontRechargeOption[];
}

export interface StorefrontRechargeOrder {
  order_id: string;
  credits: number;
  amount: number;
  pay_amount: number;
  currency: string;
  contact?: string;
  status: string;
  pay_url?: string;
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

export interface StorefrontBrowserOrder {
  order: StorefrontRechargeOrder;
  checkout: StorefrontBrowserCheckout;
}

export interface StorefrontBrowserExternalOrder {
  trade_no: string;
  pay_url: string;
  amount: number;
  channel_id: number;
}

export interface StorefrontBrowserOrderDetail {
  trade_no: string;
  status: number;
  amount: number;
  goods_key: string;
  cards: string[];
}

export class StorefrontBrowserVerificationError extends Error {
  readonly code = "STOREFRONT_BROWSER_VERIFICATION_REQUIRED";
  readonly verificationUrl: string;
  readonly orderQueryUrl?: string;

  constructor(
    message: string,
    verificationUrl: string,
    orderQueryUrl?: string,
  ) {
    super(message);
    this.name = "StorefrontBrowserVerificationError";
    this.verificationUrl = verificationUrl;
    this.orderQueryUrl = orderQueryUrl;
  }
}

export const getConfig = () =>
  request<StorefrontRechargeConfig>("/api/payment/storefront/config");

export const prepareBrowserOrder = (credits: number) =>
  request<StorefrontBrowserOrder>("/api/payment/storefront/orders", {
    method: "POST",
    body: JSON.stringify({ credits, browser: true }),
  });

export const completeBrowserOrder = (
  orderId: string,
  payload: StorefrontBrowserExternalOrder,
) =>
  request<StorefrontRechargeOrder>(
    `/api/payment/storefront/orders/${encodeURIComponent(orderId)}/browser/complete`,
    { method: "POST", body: JSON.stringify(payload) },
  );

export const verifyBrowserOrder = (
  orderId: string,
  detail: StorefrontBrowserOrderDetail,
) =>
  request<StorefrontRechargeOrder & { balance?: number }>(
    `/api/payment/storefront/orders/${encodeURIComponent(orderId)}/browser/verify`,
    { method: "POST", body: JSON.stringify(detail) },
  );

export const getOrder = (orderId: string) =>
  request<StorefrontRechargeOrder>(
    `/api/payment/storefront/orders/${encodeURIComponent(orderId)}`,
  );

export const getBrowserContext = (orderId: string) =>
  request<StorefrontBrowserCheckout>(
    `/api/payment/storefront/orders/${encodeURIComponent(orderId)}/browser/context`,
  );

function storefrontOrigin(raw: string): URL {
  const value = new URL(raw);
  const host = value.hostname.toLowerCase().replace(/\.$/, "");
  if (
    value.protocol !== "https:" ||
    value.username ||
    value.password ||
    value.port ||
    !["wzyp.cn", "pay.ldxp.cn"].includes(host)
  ) {
    throw new Error("支付通道地址无效");
  }
  value.pathname = "";
  value.search = "";
  value.hash = "";
  return value;
}

let visitorId: string | undefined;

function randomVisitorId(): string {
  if (visitorId) return visitorId;
  try {
    const saved = window.sessionStorage.getItem("chugao.storefront.visitor");
    if (saved && /^[A-Za-z0-9]{16}$/.test(saved)) return (visitorId = saved);
  } catch {
    // A browser with storage disabled can still complete this checkout.
  }
  visitorId = (
    globalThis.crypto?.randomUUID?.().replace(/-/g, "") ??
    `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`
  ).slice(0, 16);
  try {
    window.sessionStorage.setItem("chugao.storefront.visitor", visitorId);
  } catch {
    // Keep the identity in memory when session storage is unavailable.
  }
  return visitorId;
}

function isChallenge(
  status: number,
  contentType: string,
  body: string,
): boolean {
  if (status === 403) return true;
  if (!contentType.toLowerCase().includes("text/html")) return false;
  return /denied by http_(?:bot_simple|custom)|sorry, you have been blocked|cf_app_waf|aliyuncaptcha|滑块验证|人机验证/i.test(
    body,
  );
}

async function browserRequest(
  url: string,
  init: RequestInit,
  verificationUrl: string,
  referrerUrl: string,
): Promise<string> {
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(20_000),
      credentials: "include",
      referrer: referrerUrl,
      referrerPolicy: "strict-origin-when-cross-origin",
    });
  } catch {
    throw new StorefrontBrowserVerificationError(
      "小铺暂时无法从当前浏览器加载，请先打开验证页后重试。",
      verificationUrl,
    );
  }
  const body = await response.text();
  const contentType = response.headers.get("content-type") ?? "";
  if (isChallenge(response.status, contentType, body)) {
    throw new StorefrontBrowserVerificationError(
      "小铺需要在当前浏览器完成验证，请打开验证页后重试。",
      verificationUrl,
    );
  }
  if (!response.ok) throw new Error(`小铺请求失败（${response.status}）`);
  return body;
}

type JSONRecord = Record<string, unknown>;

function asRecord(value: unknown): JSONRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JSONRecord)
    : null;
}

function parseJSON(body: string): JSONRecord {
  try {
    const result: unknown = JSON.parse(body);
    const record = asRecord(result);
    if (!record) throw new Error();
    return record;
  } catch {
    throw new Error("小铺返回格式无效");
  }
}

function verificationUrl(origin: URL): string {
  return new URL("/shopApi/common/buyerBlackIframe", origin.origin).toString();
}

function orderQueryUrl(origin: URL): string {
  return new URL("/order", origin.origin).toString();
}

export function getStorefrontOrderResultUrl(
  checkout: StorefrontBrowserCheckout,
  tradeNo: string,
): string {
  if (!/^[A-Za-z0-9_-]{3,160}$/.test(tradeNo.trim()))
    throw new Error("支付订单号无效");
  const origin = storefrontOrigin(checkout.base_url);
  const url = new URL(
    `/order/result/${encodeURIComponent(tradeNo.trim())}`,
    origin.origin,
  );
  url.searchParams.set("query_password", checkout.query_password);
  return url.toString();
}

export function getStorefrontOrderQueryUrl(
  checkout: StorefrontBrowserCheckout,
): string {
  return orderQueryUrl(storefrontOrigin(checkout.base_url));
}

export async function createBrowserCheckout(
  checkout: StorefrontBrowserCheckout,
): Promise<StorefrontBrowserExternalOrder> {
  const origin = storefrontOrigin(checkout.base_url);
  const shop = new URL(checkout.shop_url);
  const item = new URL(checkout.item_url);
  if (
    shop.origin !== origin.origin ||
    item.origin !== origin.origin ||
    !checkout.goods_key
  ) {
    throw new Error("支付商品信息无效");
  }
  const parts = shop.pathname.split("/").filter(Boolean);
  const token = parts[parts.length - 1] ?? "";
  if (!token) throw new Error("小铺身份信息无效");

  const verifyURL = verificationUrl(origin);
  const visitorId = randomVisitorId();
  const script = await browserRequest(
    `${origin.origin}/shopApi/Shop/buyerBlackJs?token=${encodeURIComponent(token)}`,
    { headers: { Accept: "application/javascript, */*;q=0.8" } },
    verifyURL,
    checkout.item_url,
  );
  const iframeMatch = /iframe\.src\s*=\s*['"]([^'"]+)['"]/.exec(script);
  const iframeURL = new URL(
    iframeMatch?.[1] ?? "/shopApi/common/buyerBlackIframe",
    origin.origin,
  );
  if (iframeURL.origin !== origin.origin) throw new Error("小铺验证地址无效");
  const iframe = await browserRequest(
    iframeURL.toString(),
    { headers: { Accept: "text/html, */*;q=0.8" } },
    verifyURL,
    checkout.item_url,
  );
  const juuid =
    /(?:const\s+juuid|juuid)\s*=\s*['"]([A-Za-z0-9_-]{1,32})['"]/.exec(
      iframe,
    )?.[1];
  if (!juuid) throw new Error("小铺浏览器身份初始化失败，请重试");

  const channelsBody = await browserRequest(
    `${origin.origin}/shopApi/Shop/getUserChannel`,
    {
      method: "POST",
      headers: {
        Accept: "application/json, text/plain, */*",
        "Content-Type": "application/json",
        Visitorid: visitorId,
      },
      body: JSON.stringify({ token }),
    },
    verifyURL,
    checkout.item_url,
  );
  const channelsResult = parseJSON(channelsBody);
  if (
    String(channelsResult.code) !== "1" ||
    !Array.isArray(channelsResult.data)
  ) {
    throw new Error(String(channelsResult.msg || "没有可用的支付渠道"));
  }
  const channels = channelsResult.data
    .filter((channel) => {
      const row = asRecord(channel);
      const status = row?.status;
      return (
        status === undefined ||
        status === 1 ||
        status === true ||
        status === "1"
      );
    })
    .map((channel) => Number(asRecord(channel)?.id))
    .filter((id: number) => Number.isInteger(id) && id > 0 && id < 100);
  const channelId =
    Number(checkout.channel_id) ||
    channels.find((id: number) => id === 1) ||
    channels[0];
  if (!channelId || !channels.includes(channelId))
    throw new Error("没有可用的支付渠道");

  const orderBody = await browserRequest(
    `${origin.origin}/shopApi/Pay/order`,
    {
      method: "POST",
      headers: {
        Accept: "application/json, text/plain, */*",
        "Content-Type": "application/json",
        Visitorid: visitorId,
      },
      body: JSON.stringify({
        goods_key: checkout.goods_key,
        quantity: 1,
        coupon_code: "",
        channel_id: channelId,
        contact: checkout.contact,
        query_password: checkout.query_password,
        select_cards_ids: [],
        extend: { juuid },
      }),
    },
    verifyURL,
    checkout.item_url,
  );
  const result = parseJSON(orderBody);
  const orderData = asRecord(result.data);
  if (String(result.code) !== "1" || !orderData) {
    throw new Error(String(result.msg || "小铺订单创建失败"));
  }
  const tradeNo = String(orderData.trade_no || "").trim();
  const payURL = String(orderData.payurl || orderData.pay_url || "").trim();
  const pay = new URL(payURL);
  if (
    !/^[A-Za-z0-9_-]{3,160}$/.test(tradeNo) ||
    pay.protocol !== "https:" ||
    pay.username ||
    pay.password ||
    pay.port ||
    !["wzyp.cn", "pay.ldxp.cn"].includes(
      pay.hostname.toLowerCase().replace(/\.$/, ""),
    )
  ) {
    throw new Error("小铺未返回有效支付链接");
  }
  return {
    trade_no: tradeNo,
    pay_url: payURL,
    amount: Number(orderData.total_amount || 0),
    channel_id: channelId,
  };
}

export async function queryBrowserOrder(
  checkout: StorefrontBrowserCheckout,
  tradeNo: string,
): Promise<StorefrontBrowserOrderDetail> {
  const origin = storefrontOrigin(checkout.base_url);
  const verifyURL = verificationUrl(origin);
  const resultURL = getStorefrontOrderResultUrl(checkout, tradeNo);
  const queryURL = orderQueryUrl(origin);
  const body = await browserRequest(
    `${origin.origin}/shopApi/Order/info`,
    {
      method: "POST",
      headers: {
        Accept: "application/json, text/plain, */*",
        "Content-Type": "application/json",
        Visitorid: randomVisitorId(),
      },
      body: JSON.stringify({
        trade_no: tradeNo,
        contact: checkout.contact,
        query_password: checkout.query_password,
        dump: 1,
      }),
    },
    verifyURL,
    checkout.item_url,
  );
  const result = parseJSON(body);
  if (
    String(result.code) !== "1" ||
    !result.data ||
    typeof result.data !== "object"
  ) {
    const message = String(
      result.msg || result.message || "支付状态暂时无法查询",
    );
    if (
      /联系方式|验证码|人机验证|重新查询|订单不存在|查询后操作/i.test(message)
    ) {
      throw new StorefrontBrowserVerificationError(
        `小铺订单查询需要浏览器验证；可在小铺查询页输入账户 ID ${checkout.contact} 和订单号。`,
        resultURL,
        queryURL,
      );
    }
    throw new Error(message);
  }
  const data = asRecord(result.data);
  if (!data) throw new Error("小铺订单结果无效");
  const actualTradeNo = String(data.trade_no || "").trim();
  if (actualTradeNo !== tradeNo) throw new Error("小铺订单号与当前订单不匹配");
  const goods = asRecord(data.goods) ?? {};
  const response = asRecord(data.response) ?? {};
  const rawCards = response.cards;
  const cards = Array.isArray(rawCards)
    ? rawCards
        .map((value: unknown) => String(value || "").trim())
        .filter(Boolean)
        .slice(0, 16)
    : typeof rawCards === "string" && rawCards.trim()
      ? [rawCards.trim().slice(0, 128)]
      : [];
  return {
    trade_no: actualTradeNo,
    status: Number(data.status || 0),
    amount: Number(data.total_amount || 0),
    goods_key: String(goods.goods_key || "").trim(),
    cards,
  };
}

export function isStorefrontVerificationError(
  error: unknown,
): error is StorefrontBrowserVerificationError {
  return error instanceof StorefrontBrowserVerificationError;
}

export function isStorefrontApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}
