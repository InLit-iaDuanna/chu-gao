import { PricingRuleForm } from "@/components/admin/AdminForms";
import { DataTable } from "@/components/admin/DataTable";
import { db } from "@/lib/db";
import { listModels } from "@/lib/models/registry";

export const dynamic = "force-dynamic";

async function getRules() {
  if (!process.env.DATABASE_URL) {
    return null;
  }

  return db.modelPricing.findMany({
    orderBy: [{ modelId: "asc" }, { priority: "desc" }, { updatedAt: "desc" }],
  });
}

export default async function AdminPricingPage() {
  const models = listModels();
  const rules = await getRules();

  return (
    <div className="space-y-6">
      <div>
        <p className="eyebrow">定价</p>
        <h1 className="mt-2 text-3xl font-semibold">模型参数定价</h1>
      </div>
      <section className="grid gap-4 lg:grid-cols-3">
        {models.map((model) => (
          <div key={model.id} className="surface-panel p-4">
            <p className="text-sm font-medium">{model.displayName}</p>
            <p className="mt-1 text-xs text-text-muted">{model.id}</p>
            <div className="mt-4 space-y-2 text-sm">
              {Object.entries(model.costTable).map(([key, value]) => (
                <div key={key} className="flex justify-between">
                  <span className="text-text-muted">{key}</span>
                  <span>{value} 点 / 张</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </section>
      <PricingRuleForm models={models} />
      {rules ? (
        <DataTable
          headers={["模型", "分辨率", "比例", "格式", "背景", "参考图", "点数", "状态"]}
          rows={rules.map((rule) => [
            rule.modelId,
            rule.resolution ?? "全部",
            rule.aspectRatio ?? "全部",
            rule.outputFormat ?? "全部",
            rule.background ?? "全部",
            rule.usesReference === null ? "全部" : rule.usesReference ? "是" : "否",
            `${rule.credits} 点`,
            rule.isActive ? "启用" : "停用",
          ])}
        />
      ) : (
        <div className="surface-panel p-6 text-sm text-text-muted">
          定价服务暂不可用，请确认数据库连接。
        </div>
      )}
    </div>
  );
}
