import { ConfigEditor } from "@/components/admin/ConfigEditor";
import {
  listRequiredSystemConfigEntries,
  SystemConfigUnavailableError,
} from "@/lib/system-config";

export const dynamic = "force-dynamic";

async function getEntries() {
  try {
    return await listRequiredSystemConfigEntries();
  } catch (error) {
    if (error instanceof SystemConfigUnavailableError) {
      return null;
    }

    throw error;
  }
}

export default async function AdminSystemPage() {
  const entries = await getEntries();

  return (
    <div className="space-y-6">
      <div>
        <p className="eyebrow">系统</p>
        <h1 className="mt-2 text-3xl font-semibold">系统配置</h1>
      </div>
      {entries ? (
        <ConfigEditor entries={entries} />
      ) : (
        <div className="surface-panel p-6 text-sm leading-6 text-text-muted">
          系统配置服务暂不可用，请确认数据库连接后刷新。
        </div>
      )}
    </div>
  );
}
