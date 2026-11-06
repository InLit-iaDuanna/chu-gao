import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  checkSession: vi.fn(),
  audit: vi.fn(),
  findProvider: vi.fn(),
  updateProvider: vi.fn(),
  updateProviders: vi.fn(),
  restoredProvider: vi.fn(),
  findAccount: vi.fn(),
  updateAccount: vi.fn(),
  updateAccounts: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  checkSession: mocks.checkSession,
  adminFailureResponse: (session: {
    status: string;
    user?: { role: string };
  }) =>
    session.status === "authenticated" && session.user?.role === "ADMIN"
      ? null
      : new Response(null, { status: 401 }),
  authenticatedUser: (session: { user: unknown }) => session.user,
}));
vi.mock("@/lib/audit", () => ({ audit: mocks.audit }));
vi.mock("@/lib/db", () => ({
  db: {
    provider: {
      findUnique: mocks.findProvider,
      findUniqueOrThrow: mocks.restoredProvider,
      update: mocks.updateProvider,
      updateMany: mocks.updateProviders,
    },
    providerAccount: {
      findFirst: mocks.findAccount,
      update: mocks.updateAccount,
      updateMany: mocks.updateAccounts,
    },
    $transaction: mocks.transaction,
  },
}));
vi.mock("@/lib/providers/serialize", () => ({
  serializeProvider: (provider: unknown) => provider,
  serializeProviderAccount: (account: unknown) => account,
}));

import { db } from "@/lib/db";
import { POST as restorePool } from "@/app/api/admin/providers/[id]/restore/route";
import { POST as restoreAccount } from "@/app/api/admin/providers/[id]/accounts/[accountId]/restore/route";

const poolContext = { params: Promise.resolve({ id: "pool-a" }) };
const accountContext = {
  params: Promise.resolve({ id: "pool-a", accountId: "account-a" }),
};
const request = () =>
  new Request("https://chugao.test/api/admin/providers/pool-a/restore", {
    method: "POST",
  });

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("DATABASE_URL", "postgresql://test");
  mocks.checkSession.mockResolvedValue({
    status: "authenticated",
    user: { id: "admin-a", role: "ADMIN" },
  });
  mocks.findProvider.mockResolvedValue({ id: "pool-a" });
  mocks.findAccount.mockResolvedValue({
    id: "account-a",
    provider: { name: "Test" },
  });
  mocks.restoredProvider.mockResolvedValue({
    id: "pool-a",
    accounts: [{ id: "account-a", inFlight: 2 }],
  });
  mocks.updateAccount.mockResolvedValue({ id: "account-a", inFlight: 2 });
  mocks.updateProviders.mockResolvedValue({ count: 1 });
  mocks.transaction.mockImplementation(async (input: unknown) =>
    typeof input === "function"
      ? input(db)
      : Promise.all(input as Promise<unknown>[]),
  );
});

afterEach(() => vi.unstubAllEnvs());

describe("provider recovery", () => {
  it.each([restorePool, restoreAccount])(
    "requires an administrator",
    async (restore) => {
      mocks.checkSession.mockResolvedValue({
        status: "authenticated",
        user: { role: "USER" },
      });
      const response = await restore(request(), accountContext);
      expect(response.status).toBe(401);
      expect(mocks.transaction).not.toHaveBeenCalled();
      expect(mocks.findProvider).not.toHaveBeenCalled();
      expect(mocks.findAccount).not.toHaveBeenCalled();
    },
  );

  it.each([restorePool, restoreAccount])(
    "does not mutate without a database",
    async (restore) => {
      vi.stubEnv("DATABASE_URL", "");
      expect((await restore(request(), accountContext)).status).toBe(503);
      expect(mocks.transaction).not.toHaveBeenCalled();
    },
  );

  it("returns 404 for a missing pool", async () => {
    mocks.findProvider.mockResolvedValue(null);
    expect((await restorePool(request(), poolContext)).status).toBe(404);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("atomically restores only the selected pool and all its accounts without clearing live occupancy", async () => {
    const response = await restorePool(request(), poolContext);
    expect(response.status).toBe(200);
    expect(mocks.transaction).toHaveBeenCalledTimes(1);
    expect(mocks.updateProvider).toHaveBeenCalledWith({
      where: { id: "pool-a" },
      data: { isActive: true, health: "HEALTHY", consecutiveErrors: 0 },
    });
    expect(mocks.updateAccounts).toHaveBeenCalledWith({
      where: { providerId: "pool-a" },
      data: {
        isActive: true,
        health: "HEALTHY",
        consecutiveErrors: 0,
        cooldownUntil: null,
      },
    });
    expect(mocks.audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "admin.provider.restore",
        target: "pool-a",
        diff: expect.objectContaining({ restoredAccounts: 1 }),
      }),
    );
  });

  it("returns 404 without changing a mismatched account or its pool", async () => {
    mocks.findAccount.mockResolvedValue(null);
    expect((await restoreAccount(request(), accountContext)).status).toBe(404);
    expect(mocks.findAccount).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "account-a", providerId: "pool-a" },
      }),
    );
    expect(mocks.updateProviders).not.toHaveBeenCalled();
    expect(mocks.updateAccount).not.toHaveBeenCalled();
  });

  it("clears a restored account's parent circuit breaker only when the pool is enabled", async () => {
    expect((await restoreAccount(request(), accountContext)).status).toBe(200);
    expect(mocks.transaction).toHaveBeenCalledTimes(1);
    expect(mocks.updateAccount).toHaveBeenCalledWith({
      where: { id: "account-a" },
      data: {
        isActive: true,
        health: "HEALTHY",
        consecutiveErrors: 0,
        cooldownUntil: null,
      },
    });
    expect(mocks.updateProviders).toHaveBeenCalledWith({
      where: { id: "pool-a", isActive: true },
      data: { health: "HEALTHY", consecutiveErrors: 0 },
    });
  });
});
