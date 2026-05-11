import { RedemptionCodeCreateForm } from "@/components/admin/AdminForms";
import { DataTable } from "@/components/admin/DataTable";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

async function getCodes() {
  if (!process.env.DATABASE_URL) {
    return null;
  }

  return db.creditRedemptionCode.findMany({
    orderBy: { createdAt: "desc" },
    take: 200,
  });
}

export default async function AdminRedemptionCodesPage() {
  const codes = await getCodes();

  return (
    <div className="space-y-6">
      <div>
        <p className="eyebrow">点数</p>
        <h1 className="mt-2 text-3xl font-semibold">点数兑换码</h1>
      </div>
      <RedemptionCodeCreateForm />
      {codes ? (
        <DataTable
          headers={["兑换码", "点数", "已用", "总次数", "过期时间", "状态"]}
          rows={codes.map((code) => [
            code.code,
            `${code.credits} 点`,
            code.usedCount,
            code.maxUses,
            code.expiresAt?.toLocaleString("zh-CN") ?? "长期",
            code.revokedAt ? "已撤销" : "可用",
          ])}
        />
      ) : (
        <div className="surface-panel p-6 text-sm text-text-muted">
          兑换码服务暂不可用，请确认数据库连接。
        </div>
      )}
    </div>
  );
}
