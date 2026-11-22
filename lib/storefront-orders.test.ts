import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;

/**
 * Minimal in-memory stand-in for the Prisma calls the storefront order flow
 * makes. A failed transaction restores the previous rows, like a rollback.
 */
const state = vi.hoisted(() => ({
  orders: [] as Record<string, unknown>[],
  codes: [] as Record<string, unknown>[],
  redemptions: [] as Record<string, unknown>[],
  users: [] as Record<string, unknown>[],
  logs: [] as Record<string, unknown>[],
  nextId: 1,
}));

vi.mock("@/lib/db", () => {
  const time = (value: unknown) =>
    value instanceof Date ? value.getTime() : Number(value);
  const matches = (row: Row, where: Row): boolean =>
    Object.entries(where).every(([key, cond]) => {
      if (key === "OR")
        return (cond as Row[]).some((branch) => matches(row, branch));
      const value = row[key];
      if (cond === null) return value === null || value === undefined;
      if (
        typeof cond === "object" &&
        !(cond instanceof Date) &&
        !Prisma.Decimal.isDecimal(cond)
      ) {
        const ops = cond as Row;
        if ("in" in ops && !(ops.in as unknown[]).includes(value)) return false;
        if ("not" in ops && ops.not === null && value == null) return false;
        if (value == null && ("gt" in ops || "gte" in ops || "lte" in ops))
          return false;
        if ("gt" in ops && !(time(value) > time(ops.gt))) return false;
        if ("gte" in ops && !(time(value) >= time(ops.gte))) return false;
        if ("lte" in ops && !(time(value) <= time(ops.lte))) return false;
        return true;
      }
      if (cond instanceof Date) return time(value) === cond.getTime();
      return String(value) === String(cond);
    });
  const apply = (row: Row, data: Row) => {
    for (const [key, value] of Object.entries(data)) {
      const increment =
        value && typeof value === "object" && "increment" in value
          ? Number((value as Row).increment)
          : null;
      row[key] = increment === null ? value : Number(row[key]) + increment;
    }
    return row;
  };
  const table = (rows: () => Row[], defaults: () => Row = () => ({})) => ({
    findFirst: async ({ where }: { where: Row }) =>
      rows().find((row) => matches(row, where)) ?? null,
    findUnique: async ({ where }: { where: Row }) =>
      rows().find((row) => matches(row, where)) ?? null,
    findUniqueOrThrow: async ({ where }: { where: Row }) => {
      const row = rows().find((item) => matches(item, where));
      if (!row) throw new Error("not found");
      return row;
    },
    count: async ({ where }: { where: Row }) =>
      rows().filter((row) => matches(row, where)).length,
    update: async ({ where, data }: { where: Row; data: Row }) => {
      const row = rows().find((item) => matches(item, where));
      if (!row) throw new Error("not found");
      return apply(row, data);
    },
    updateMany: async ({ where, data }: { where: Row; data: Row }) => {
      const hits = rows().filter((row) => matches(row, where));
      hits.forEach((row) => apply(row, data));
      return { count: hits.length };
    },
    create: async ({ data }: { data: Row }) => {
      const row = { id: `row-${state.nextId++}`, ...defaults(), ...data };
      rows().push(row);
      return row;
    },
  });
  const client = {
    $queryRaw: async () => [],
    storefrontOrder: table(
      () => state.orders,
      () => ({
        status: "PENDING",
        payUrl: null,
        externalTradeNo: null,
        redemptionCodeId: null,
        paidAt: null,
        completedAt: null,
        lastErrorCode: null,
        createdAt: new Date(),
      }),
    ),
    creditRedemptionCode: table(() => state.codes),
    creditRedemption: table(() => state.redemptions),
    user: table(() => state.users),
    usageLog: table(() => state.logs),
  };
  const tables = ["orders", "codes", "redemptions", "users", "logs"] as const;
  return {
    db: {
      ...client,
      $transaction: async (operation: (tx: typeof client) => unknown) => {
        const snapshot = tables.map((name) =>
          state[name].map((row) => ({ ...row })),
        );
        try {
          return await operation(client);
        } catch (error) {
          tables.forEach((name, index) => {
            state[name] = snapshot[index];
          });
          throw error;
        }
      },
    },
  };
});

import {
  bindStorefrontBrowserOrder,
  createStorefrontOrderForUser,
  readStorefrontQueryPassword,
  verifyStorefrontBrowserOrder,
} from "@/lib/storefront-orders";
import {
  encryptStorefrontQueryPassword,
  hashStorefrontQueryPassword,
} from "@/lib/storefront-payment";

const USER = "user-000001";
const CARD = `CG-${"A1".repeat(24)}`;
const MINUTE = 60_000;
const PRODUCT = { credits: 100, goodsKey: "goods100", price: 1 };

function addOrder(overrides: Row = {}): Row {
  const order: Row = {
    id: `order-${state.nextId++}`,
    userId: USER,
    productId: "goods100",
    credits: 100,
    amount: 1,
    contact: USER,
    queryPasswordHash: hashStorefrontQueryPassword("query-secret"),
    queryPasswordEncrypted: encryptStorefrontQueryPassword("query-secret"),
    payUrl: null,
    externalTradeNo: null,
    status: "PENDING",
    expiresAt: new Date(Date.now() + 30 * MINUTE),
    paidAt: null,
    completedAt: null,
    redemptionCodeId: null,
    lastErrorCode: null,
    createdAt: new Date(Date.now() - 10 * MINUTE),
    ...overrides,
  };
  state.orders.push(order);
  return order;
}

function addCard(overrides: Row = {}): Row {
  const code: Row = {
    id: "code-1",
    code: CARD,
    credits: 100,
    maxUses: 1,
    usedCount: 0,
    perUserLimit: 1,
    note: "chugao-storefront-20261109:100",
    expiresAt: null,
    revokedAt: null,
    ...overrides,
  };
  state.codes.push(code);
  return code;
}

const paid = (tradeNo: string) => ({
  tradeNo,
  status: 1,
  amount: 1,
  goodsKey: "goods100",
  cards: [CARD],
});

const binding = (tradeNo: string, amount = 1) => ({
  tradeNo,
  amount,
  payUrl: `https://pay.ldxp.cn/pay/${tradeNo}`,
});

const balance = () => state.users[0].credits;

beforeEach(() => {
  state.orders = [];
  state.codes = [];
  state.redemptions = [];
  state.logs = [];
  state.users = [{ id: USER, status: "ACTIVE", credits: 5 }];
  state.nextId = 1;
});

describe("payment that lands after the order expired", () => {
  it("credits a bound order once, and only once", async () => {
    const order = addOrder({
      externalTradeNo: "T1001",
      expiresAt: new Date(Date.now() - MINUTE),
    });
    addCard();

    const first = await verifyStorefrontBrowserOrder(
      String(order.id),
      USER,
      paid("T1001"),
    );
    expect(first.order.status).toBe("COMPLETED");
    expect(first.balance).toBe(105);

    const again = await verifyStorefrontBrowserOrder(
      String(order.id),
      USER,
      paid("T1001"),
    );
    expect(again.order.status).toBe("COMPLETED");
    expect(again.balance).toBeNull();
    expect(balance()).toBe(105);
    expect(state.redemptions).toHaveLength(1);
    expect(state.logs).toHaveLength(1);
  });

  it("credits an order already stored as EXPIRED", async () => {
    const order = addOrder({
      externalTradeNo: "T1002",
      status: "EXPIRED",
      expiresAt: new Date(Date.now() - 3 * 24 * 60 * MINUTE),
    });
    addCard();

    const result = await verifyStorefrontBrowserOrder(
      String(order.id),
      USER,
      paid("T1002"),
    );
    expect(result.order.status).toBe("COMPLETED");
    expect(balance()).toBe(105);
  });

  it("leaves the order expired while the shop reports no payment", async () => {
    const order = addOrder({
      externalTradeNo: "T1003",
      expiresAt: new Date(Date.now() - MINUTE),
    });

    const result = await verifyStorefrontBrowserOrder(String(order.id), USER, {
      ...paid("T1003"),
      status: 0,
      cards: [],
    });
    expect(result.order.status).toBe("EXPIRED");
    expect(result.balance).toBeNull();
    expect(balance()).toBe(5);
  });

  it("rejects an expired order that never bound a shop order", async () => {
    const order = addOrder({ expiresAt: new Date(Date.now() - MINUTE) });
    addCard();

    await expect(
      verifyStorefrontBrowserOrder(String(order.id), USER, paid("T1004")),
    ).rejects.toMatchObject({ code: "INVALID_STATUS" });
    expect(order.status).toBe("EXPIRED");
    expect(balance()).toBe(5);
  });

  it("does not accept a card someone else already used", async () => {
    const order = addOrder({
      externalTradeNo: "T1005",
      expiresAt: new Date(Date.now() - MINUTE),
    });
    addCard({ usedCount: 1 });
    state.redemptions.push({
      id: "redemption-1",
      codeId: "code-1",
      userId: "someone-else",
      credits: 100,
    });

    await expect(
      verifyStorefrontBrowserOrder(String(order.id), USER, paid("T1005")),
    ).rejects.toMatchObject({ code: "STOREFRONT_CARD_USED" });
    expect(balance()).toBe(5);
  });

  it("does not credit a banned account", async () => {
    state.users[0].status = "BANNED";
    const order = addOrder({
      externalTradeNo: "T1006",
      expiresAt: new Date(Date.now() - MINUTE),
    });
    addCard();

    await expect(
      verifyStorefrontBrowserOrder(String(order.id), USER, paid("T1006")),
    ).rejects.toMatchObject({ code: "USER_INACTIVE" });
    expect(balance()).toBe(5);
    expect(state.codes[0].usedCount).toBe(0);
  });
});

describe("query password of an ended order", () => {
  it("stays readable for an expired order bound to a shop order", async () => {
    const order = addOrder({
      externalTradeNo: "T2001",
      expiresAt: new Date(Date.now() - MINUTE),
    });
    await expect(
      readStorefrontQueryPassword(String(order.id), USER),
    ).resolves.toBe("query-secret");
  });

  it("is withheld for expired unbound and completed orders", async () => {
    const unbound = addOrder({ expiresAt: new Date(Date.now() - MINUTE) });
    const completed = addOrder({
      externalTradeNo: "T2002",
      status: "COMPLETED",
      redemptionCodeId: "code-1",
    });
    for (const order of [unbound, completed]) {
      await expect(
        readStorefrontQueryPassword(String(order.id), USER),
      ).rejects.toMatchObject({ code: "INVALID_STATUS" });
    }
  });
});

describe("binding a shop order", () => {
  it("binds while the order is open", async () => {
    const order = addOrder();
    const bound = await bindStorefrontBrowserOrder(
      String(order.id),
      USER,
      binding("T3001"),
    );
    expect(bound.externalTradeNo).toBe("T3001");
    expect(bound.status).toBe("PENDING");
  });

  it("closes the order when the shop charges a different amount", async () => {
    const order = addOrder();

    await expect(
      bindStorefrontBrowserOrder(String(order.id), USER, binding("T3002", 1.5)),
    ).rejects.toMatchObject({ code: "STOREFRONT_AMOUNT_MISMATCH" });
    expect(order.status).toBe("FAILED");
    expect(order.lastErrorCode).toBe("STOREFRONT_AMOUNT_MISMATCH");
    expect(order.externalTradeNo).toBeNull();

    await expect(
      bindStorefrontBrowserOrder(String(order.id), USER, binding("T3002")),
    ).rejects.toMatchObject({ code: "INVALID_STATUS" });
  });

  it("keeps an already bound order when a later amount differs", async () => {
    const order = addOrder({
      externalTradeNo: "T3003",
      payUrl: "https://pay.ldxp.cn/pay/T3003",
    });

    await expect(
      bindStorefrontBrowserOrder(String(order.id), USER, binding("T3003", 1.5)),
    ).rejects.toMatchObject({ code: "STOREFRONT_AMOUNT_MISMATCH" });
    expect(order.status).toBe("PENDING");
  });

  it("refuses to bind an expired order", async () => {
    const order = addOrder({ expiresAt: new Date(Date.now() - MINUTE) });

    await expect(
      bindStorefrontBrowserOrder(String(order.id), USER, binding("T3004")),
    ).rejects.toMatchObject({ code: "INVALID_STATUS" });
    expect(order.status).toBe("EXPIRED");
  });
});

describe("reusing an unpaid order", () => {
  it("reuses an order with plenty of time left", async () => {
    const existing = addOrder({
      expiresAt: new Date(Date.now() + 25 * MINUTE),
    });
    const { order, queryPassword } = await createStorefrontOrderForUser(
      USER,
      PRODUCT,
    );
    expect(order.id).toBe(existing.id);
    expect(queryPassword).toBe("query-secret");
    expect(state.orders).toHaveLength(1);
  });

  it("creates a fresh order when the old one is about to expire", async () => {
    const existing = addOrder({
      expiresAt: new Date(Date.now() + 10 * MINUTE),
    });
    const { order } = await createStorefrontOrderForUser(USER, PRODUCT);
    expect(order.id).not.toBe(existing.id);
    expect(order.expiresAt.getTime() - Date.now()).toBeGreaterThan(29 * MINUTE);
    expect(state.orders).toHaveLength(2);
  });
});
