import {
  Prisma,
  type CreditRedemptionCode,
  type StorefrontOrder,
} from "@prisma/client";

import { db } from "@/lib/db";
import { normalizeRedemptionCode } from "@/lib/redemption-code";
import {
  createStorefrontQueryPassword,
  decryptStorefrontQueryPassword,
  encryptStorefrontQueryPassword,
  hashStorefrontQueryPassword,
  storefrontContact,
  storefrontOrderResponse,
  STOREFRONT_ORDER_TTL_MS,
  type StorefrontProduct,
} from "@/lib/storefront-payment";

export interface BrowserOrderDetail {
  tradeNo: string;
  status: number;
  amount: number;
  goodsKey: string;
  cards: string[];
}

export interface BrowserOrderBinding {
  tradeNo: string;
  amount: number;
  payUrl: string;
}

const CREDIT_TIERS = new Set([100, 500, 1000, 2000, 5000, 10000]);
const CARD_BATCH = "chugao-storefront-20261109";

function amountInCents(amount: number): number | null {
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const cents = new Prisma.Decimal(amount).mul(100);
  return cents.isInteger() && cents.lte(Number.MAX_SAFE_INTEGER)
    ? cents.toNumber()
    : null;
}

function assertAmount(amount: number, expected: number) {
  const cents = amountInCents(amount);
  if (cents === null || cents !== amountInCents(expected)) {
    throw new StorefrontOrderError(
      "STOREFRONT_AMOUNT_MISMATCH",
      "支付金额与当前订单不匹配",
      409,
    );
  }
}

function assertProduct(credits: number, amount: number) {
  if (!CREDIT_TIERS.has(credits) || amountInCents(amount) !== credits) {
    throw new StorefrontOrderError(
      "INVALID_AMOUNT",
      "当前充值额度或价格不可用",
      400,
    );
  }
}

async function storefrontTransaction<T>(
  operation: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await db.$transaction(operation, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    } catch (error) {
      if (
        !(error instanceof Prisma.PrismaClientKnownRequestError) ||
        error.code !== "P2034"
      ) {
        throw error;
      }
      if (attempt >= 2) {
        throw new StorefrontOrderError(
          "STOREFRONT_ORDER_BUSY",
          "订单正在处理，请稍后重试",
          409,
        );
      }
    }
  }
}

function isExpired(order: StorefrontOrder) {
  return (
    (order.status === "PENDING" || order.status === "PAID") &&
    order.expiresAt.getTime() <= Date.now()
  );
}

async function withLockedOrder<T>(
  orderId: string,
  userId: string,
  operation: (
    tx: Prisma.TransactionClient,
    order: StorefrontOrder,
  ) => Promise<T>,
): Promise<T> {
  const result = await storefrontTransaction(async (tx) => {
    await tx.$queryRaw(
      Prisma.sql`SELECT "id" FROM "StorefrontOrder" WHERE "id" = ${orderId} AND "userId" = ${userId} FOR UPDATE`,
    );
    const order = await tx.storefrontOrder.findFirst({
      where: { id: orderId, userId },
    });
    if (!order) throw new StorefrontOrderError("NOT_FOUND", "订单不存在", 404);
    if (isExpired(order)) {
      await tx.storefrontOrder.update({
        where: { id: order.id },
        data: { status: "EXPIRED", lastErrorCode: "ORDER_EXPIRED" },
      });
      // Return before throwing so that the expiry transition commits.
      return { expired: true } as const;
    }
    if (order.status === "EXPIRED" || order.status === "FAILED") {
      throw new StorefrontOrderError("INVALID_STATUS", "订单已结束", 409);
    }
    return { expired: false, value: await operation(tx, order) } as const;
  });
  if (result.expired) {
    throw new StorefrontOrderError("INVALID_STATUS", "订单已过期", 409);
  }
  return result.value;
}

export class StorefrontOrderError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 400,
  ) {
    super(message);
    this.name = "StorefrontOrderError";
  }
}

export function storefrontOrderMessage(status: string): string {
  switch (status) {
    case "COMPLETED":
      return "充值已到账";
    case "PAID":
      return "支付已确认，正在核对充值卡密";
    case "EXPIRED":
      return "订单已过期";
    case "FAILED":
      return "订单处理失败，请重新发起充值";
    default:
      return "等待支付完成";
  }
}

export async function getStorefrontOrderForUser(
  orderId: string,
  userId: string,
): Promise<StorefrontOrder> {
  const order = await db.storefrontOrder.findFirst({
    where: { id: orderId, userId },
  });
  if (!order) throw new StorefrontOrderError("NOT_FOUND", "订单不存在", 404);

  if (isExpired(order)) {
    await db.storefrontOrder.updateMany({
      where: {
        id: order.id,
        userId,
        status: { in: ["PENDING", "PAID"] },
        expiresAt: { lte: new Date() },
      },
      data: { status: "EXPIRED", lastErrorCode: "ORDER_EXPIRED" },
    });
    return db.storefrontOrder.findUniqueOrThrow({ where: { id: order.id } });
  }

  return order;
}

export async function readStorefrontQueryPassword(
  orderId: string,
  userId: string,
): Promise<string> {
  const order = await getStorefrontOrderForUser(orderId, userId);
  if (order.status !== "PENDING" && order.status !== "PAID") {
    throw new StorefrontOrderError("INVALID_STATUS", "订单已结束");
  }
  return queryPasswordForOrder(order);
}

function queryPasswordForOrder(order: StorefrontOrder): string {
  try {
    const password = decryptStorefrontQueryPassword(
      order.queryPasswordEncrypted,
    );
    if (hashStorefrontQueryPassword(password) !== order.queryPasswordHash) {
      throw new Error("query password hash mismatch");
    }
    return password;
  } catch {
    throw new StorefrontOrderError(
      "STOREFRONT_UNAVAILABLE",
      "订单验证信息暂时不可用",
      503,
    );
  }
}

export async function createStorefrontOrderForUser(
  userId: string,
  product: StorefrontProduct,
) {
  assertProduct(product.credits, product.price);
  return storefrontTransaction(async (tx) => {
    await tx.$queryRaw(
      Prisma.sql`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE`,
    );
    const user = await tx.user.findUnique({
      where: { id: userId },
      select: { status: true },
    });
    if (!user || user.status !== "ACTIVE") {
      throw new StorefrontOrderError("USER_INACTIVE", "账户当前不可充值", 403);
    }
    const now = new Date();
    const reusable = await tx.storefrontOrder.findFirst({
      where: {
        userId,
        productId: product.goodsKey,
        credits: product.credits,
        amount: new Prisma.Decimal(product.price.toFixed(2)),
        status: "PENDING",
        externalTradeNo: null,
        expiresAt: { gt: now },
      },
      orderBy: { createdAt: "desc" },
    });
    if (reusable)
      return {
        order: reusable,
        queryPassword: queryPasswordForOrder(reusable),
      };

    const recent = await tx.storefrontOrder.count({
      where: { userId, createdAt: { gte: new Date(now.getTime() - 60_000) } },
    });
    const hourly = await tx.storefrontOrder.count({
      where: {
        userId,
        createdAt: { gte: new Date(now.getTime() - 3_600_000) },
      },
    });
    const active = await tx.storefrontOrder.count({
      where: {
        userId,
        status: { in: ["PENDING", "PAID"] },
        expiresAt: { gt: now },
      },
    });
    if (recent >= 6 || hourly >= 30 || active >= 6) {
      throw new StorefrontOrderError(
        "RATE_LIMITED",
        "充值订单过多，请稍后再试",
        429,
      );
    }
    const queryPassword = createStorefrontQueryPassword();
    const order = await tx.storefrontOrder.create({
      data: {
        userId,
        productId: product.goodsKey,
        credits: product.credits,
        amount: new Prisma.Decimal(product.price.toFixed(2)),
        contact: storefrontContact(userId),
        queryPasswordHash: hashStorefrontQueryPassword(queryPassword),
        queryPasswordEncrypted: encryptStorefrontQueryPassword(queryPassword),
        expiresAt: new Date(now.getTime() + STOREFRONT_ORDER_TTL_MS),
      },
    });
    return { order, queryPassword };
  });
}

function assertExternalOrderMatches(
  order: StorefrontOrder,
  detail: BrowserOrderDetail,
) {
  if (!order.externalTradeNo || detail.tradeNo !== order.externalTradeNo) {
    throw new StorefrontOrderError(
      "STOREFRONT_ORDER_MISMATCH",
      "支付订单信息与当前订单不匹配",
      409,
    );
  }
  if (detail.goodsKey !== order.productId) {
    throw new StorefrontOrderError(
      "STOREFRONT_PRODUCT_MISMATCH",
      "支付商品与当前订单不匹配",
      409,
    );
  }
  assertProduct(order.credits, Number(order.amount));
  assertAmount(detail.amount, Number(order.amount));
}

function paymentUrl(raw: string, tradeNo: string): string {
  try {
    const url = new URL(raw);
    if (
      url.protocol !== "https:" ||
      !["wzyp.cn", "pay.ldxp.cn"].includes(url.hostname) ||
      url.username ||
      url.password ||
      url.port ||
      url.hash
    )
      throw new Error();

    const pathMatches = url.pathname
      .split("/")
      .some((part) => decodeURIComponent(part) === tradeNo);
    const tradeKeys = new Set([
      "trade_no",
      "out_trade_no",
      "tradeNo",
      "order_no",
    ]);
    let queryMatches = false;
    for (const [key, value] of url.searchParams) {
      if (tradeKeys.has(key)) {
        if (value !== tradeNo) throw new Error();
        queryMatches = true;
      }
      if (/^(?:https?:)?\/\//i.test(value.trim())) throw new Error();
    }
    if (!pathMatches && !queryMatches) throw new Error();
    return url.toString();
  } catch {
    throw new StorefrontOrderError(
      "STOREFRONT_PAY_URL_INVALID",
      "支付链接与订单不匹配",
      400,
    );
  }
}

export async function bindStorefrontBrowserOrder(
  orderId: string,
  userId: string,
  input: BrowserOrderBinding,
) {
  if (!/^[A-Za-z0-9_-]{3,160}$/.test(input.tradeNo)) {
    throw new StorefrontOrderError(
      "STOREFRONT_ORDER_MISMATCH",
      "支付订单号无效",
      400,
    );
  }
  const payUrl = paymentUrl(input.payUrl, input.tradeNo);
  try {
    return await withLockedOrder(orderId, userId, async (tx, order) => {
      assertProduct(order.credits, Number(order.amount));
      assertAmount(input.amount, Number(order.amount));
      if (order.externalTradeNo) {
        if (
          order.externalTradeNo !== input.tradeNo ||
          order.payUrl !== payUrl
        ) {
          throw new StorefrontOrderError(
            "STOREFRONT_ORDER_MISMATCH",
            "此订单已绑定其他支付信息",
            409,
          );
        }
        return order;
      }
      if (order.status !== "PENDING") {
        throw new StorefrontOrderError("INVALID_STATUS", "订单不可绑定", 409);
      }
      return tx.storefrontOrder.update({
        where: { id: order.id },
        data: {
          externalTradeNo: input.tradeNo,
          payUrl,
          externalProductId: order.productId,
          externalAmount: input.amount,
        },
      });
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      throw new StorefrontOrderError(
        "STOREFRONT_ORDER_MISMATCH",
        "此小铺订单已绑定其他本地订单",
        409,
      );
    }
    throw error;
  }
}

async function findLocalCard(
  tx: Prisma.TransactionClient,
  rawCard: string,
  credits: number,
): Promise<CreditRedemptionCode> {
  const normalized = normalizeRedemptionCode(rawCard);
  if (rawCard.length > 128 || !/^CG-[0-9A-F]{48}$/.test(normalized)) {
    throw new StorefrontOrderError(
      "STOREFRONT_CARD_INVALID",
      "充值卡密无效",
      409,
    );
  }
  const raw = rawCard.trim();
  const exactCode = await tx.creditRedemptionCode.findUnique({
    where: { code: raw },
  });
  const code =
    exactCode ??
    (normalized !== raw
      ? await tx.creditRedemptionCode.findUnique({
          where: { code: normalized },
        })
      : null);
  if (
    !code ||
    code.credits !== credits ||
    code.revokedAt ||
    code.note !== `${CARD_BATCH}:${credits}` ||
    code.maxUses !== 1 ||
    code.perUserLimit !== 1
  ) {
    throw new StorefrontOrderError(
      "STOREFRONT_CARD_INVALID",
      "充值卡密与当前充值额度不匹配",
      409,
    );
  }
  if (code.expiresAt && code.expiresAt.getTime() <= Date.now()) {
    throw new StorefrontOrderError(
      "STOREFRONT_CARD_EXPIRED",
      "充值卡密已过期",
      409,
    );
  }
  if (code.usedCount < 0 || code.usedCount > 1) {
    throw new StorefrontOrderError(
      "STOREFRONT_CARD_USED",
      "充值卡密已使用",
      409,
    );
  }
  return code;
}

export async function verifyStorefrontBrowserOrder(
  orderId: string,
  userId: string,
  detail: BrowserOrderDetail,
) {
  try {
    return await withLockedOrder(orderId, userId, async (tx, order) => {
      assertExternalOrderMatches(order, detail);
      if (order.status === "COMPLETED") return { order, balance: null };
      if (detail.status === 0 && detail.cards.length === 0)
        return { order, balance: null };
      if (detail.status !== 1) {
        throw new StorefrontOrderError(
          "INVALID_STATUS",
          "小铺订单尚未完成支付",
          409,
        );
      }
      if (detail.cards.length !== 1) {
        throw new StorefrontOrderError(
          "STOREFRONT_CARD_INVALID",
          "订单必须包含一张充值卡密",
          409,
        );
      }
      // Browser status is only a claim; a locally issued, single-use secret authorizes credit.
      const code = await findLocalCard(tx, detail.cards[0], order.credits);
      const linked = await tx.storefrontOrder.findUnique({
        where: { redemptionCodeId: code.id },
        select: { id: true },
      });
      if (linked && linked.id !== order.id) {
        throw new StorefrontOrderError(
          "STOREFRONT_CARD_USED",
          "充值卡密已使用",
          409,
        );
      }
      const redeemed = await tx.creditRedemption.findFirst({
        where: { codeId: code.id },
        select: { id: true, userId: true, credits: true },
      });
      const completion = {
        status: "COMPLETED" as const,
        redemptionCodeId: code.id,
        paidAt: order.paidAt ?? new Date(),
        completedAt: new Date(),
        externalProductId: detail.goodsKey,
        externalAmount: detail.amount,
        lastErrorCode: null,
      };
      if (
        code.usedCount === 1 &&
        redeemed?.userId === userId &&
        redeemed.credits === order.credits
      ) {
        // Manual redemption by this owner already delivered the value; only link the order.
        const user = await tx.user.findUniqueOrThrow({
          where: { id: userId },
          select: { credits: true },
        });
        const completed = await tx.storefrontOrder.update({
          where: { id: order.id },
          data: completion,
        });
        return { order: completed, balance: user.credits };
      }
      if (redeemed || code.usedCount !== 0) {
        throw new StorefrontOrderError(
          "STOREFRONT_CARD_USED",
          "充值卡密已使用",
          409,
        );
      }
      const claimed = await tx.creditRedemptionCode.updateMany({
        where: {
          id: code.id,
          credits: order.credits,
          maxUses: 1,
          perUserLimit: 1,
          note: `${CARD_BATCH}:${order.credits}`,
          revokedAt: null,
          usedCount: 0,
          OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
        },
        data: { usedCount: { increment: 1 } },
      });
      if (claimed.count !== 1) {
        throw new StorefrontOrderError(
          "STOREFRONT_CARD_USED",
          "充值卡密已使用",
          409,
        );
      }
      await tx.creditRedemption.create({
        data: { codeId: code.id, userId, credits: code.credits },
      });
      // Claim the code before updating User, matching the manual redemption lock order.
      const credited = await tx.user.updateMany({
        where: { id: userId, status: "ACTIVE" },
        data: { credits: { increment: order.credits } },
      });
      if (credited.count !== 1) {
        throw new StorefrontOrderError(
          "USER_INACTIVE",
          "账户当前不可充值",
          403,
        );
      }
      const user = await tx.user.findUniqueOrThrow({
        where: { id: userId },
        select: { credits: true },
      });
      await tx.usageLog.create({
        data: {
          userId,
          action: "storefront_recharge",
          creditsDelta: order.credits,
          metadata: {
            orderId: order.id,
            externalTradeNo: order.externalTradeNo,
            redemptionCodeId: code.id,
          },
        },
      });
      const completed = await tx.storefrontOrder.update({
        where: { id: order.id },
        data: completion,
      });
      return { order: completed, balance: user.credits };
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      throw new StorefrontOrderError(
        "STOREFRONT_CARD_USED",
        "充值卡密已使用",
        409,
      );
    }
    throw error;
  }
}

export function responseForStorefrontOrder(order: StorefrontOrder) {
  return storefrontOrderResponse(order, storefrontOrderMessage(order.status));
}
