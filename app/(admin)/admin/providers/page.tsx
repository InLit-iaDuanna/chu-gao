import { headers } from "next/headers";

import {
  ProviderAccountImportForm,
  ProviderCreateForm,
} from "@/components/admin/AdminForms";
import { DataTable } from "@/components/admin/DataTable";
import { requireAdminSessionFromHeaders } from "@/lib/auth";
import { db } from "@/lib/db";
import { listModels } from "@/lib/models/registry";

async function getProviders() {
  const admin = await requireAdminSessionFromHeaders(await headers());

  if (!admin || !process.env.DATABASE_URL) {
    return null;
  }

  try {
    return await db.provider.findMany({
      orderBy: [{ priority: "desc" }, { createdAt: "desc" }],
      include: { accounts: true },
    });
  } catch {
    return null;
  }
}

export default async function AdminProvidersPage() {
  const providers = await getProviders();

  return (
    <div className="space-y-6">
      <div>
        <p className="eyebrow">渠道</p>
        <h1 className="mt-2 text-3xl font-semibold">Provider 管理</h1>
      </div>
      {providers ? (
        <>
          <ProviderCreateForm models={listModels()} />
          <DataTable
            headers={[
              "名称",
              "协议",
              "优先级",
              "健康度",
              "账号",
              "并发",
              "倍率",
              "模型",
            ]}
            rows={providers.map((provider) => [
              provider.name,
              provider.protocol,
              provider.priority,
              provider.health,
              `${provider.accounts.filter((account) => account.isActive).length}/${provider.accounts.length}`,
              `${provider.accounts.reduce((sum, account) => sum + account.inFlight, 0)}/${provider.accounts.reduce((sum, account) => sum + account.maxConcurrency, 0)}`,
              provider.costMultiplier,
              provider.modelsSupported.join(", "),
            ])}
          />
          <div className="grid gap-4">
            {providers.map((provider) => (
              <section key={provider.id} className="space-y-3">
                <div className="surface-panel p-4">
                  <p className="text-sm font-medium">{provider.name} 号池</p>
                  <div className="mt-3 grid gap-2 text-sm text-text-muted md:grid-cols-4">
                    <span>账号 {provider.accounts.length}</span>
                    <span>
                      可用{" "}
                      {
                        provider.accounts.filter(
                          (account) => account.isActive && account.health !== "DOWN",
                        ).length
                      }
                    </span>
                    <span>
                      占用{" "}
                      {provider.accounts.reduce(
                        (sum, account) => sum + account.inFlight,
                        0,
                      )}
                    </span>
                    <span>
                      总并发{" "}
                      {provider.accounts.reduce(
                        (sum, account) => sum + account.maxConcurrency,
                        0,
                      )}
                    </span>
                  </div>
                </div>
                <ProviderAccountImportForm providerId={provider.id} />
              </section>
            ))}
          </div>
        </>
      ) : (
        <div className="surface-panel p-6 text-sm leading-6 text-text-muted">
          渠道服务暂不可用，请确认数据库连接后刷新。
        </div>
      )}
    </div>
  );
}
