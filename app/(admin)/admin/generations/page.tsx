import { headers } from "next/headers";
import Link from "next/link";

import { DataTable } from "@/components/admin/DataTable";
import { requireAdminSessionFromHeaders } from "@/lib/auth";
import { db } from "@/lib/db";

async function getRows(q?: string) {
  const admin = await requireAdminSessionFromHeaders(await headers());

  if (!admin || !process.env.DATABASE_URL) {
    return null;
  }

  try {
    const generations = await db.generation.findMany({
      include: {
        user: {
          select: { id: true, email: true, name: true },
        },
        provider: {
          select: {
            name: true,
          },
        },
        providerAccount: {
          select: {
            name: true,
            baseUrl: true,
          },
        },
      },
      where: q
        ? {
            OR: [
              { id: { contains: q, mode: "insensitive" as const } },
              { prompt: { contains: q, mode: "insensitive" as const } },
              {
                user: {
                  email: { contains: q, mode: "insensitive" as const },
                },
              },
            ],
          }
        : undefined,
      orderBy: { createdAt: "desc" },
      take: 100,
    });

    return generations.map((generation) => [
      generation.id.slice(0, 8),
      <Link
        key={generation.userId}
        href={`/admin/users/${generation.userId}`}
        className="underline"
      >
        {generation.user.email}
      </Link>,
      generation.modelId,
      generation.status,
      generation.provider?.name ?? generation.providerId ?? "-",
      generation.providerAccount?.name ?? generation.providerAccount?.baseUrl ?? "-",
      generation.costCredits,
      generation.attempts,
      generation.errorCode ?? "-",
      generation.prompt,
    ]);
  } catch {
    return null;
  }
}

export default async function AdminGenerationsPage({
  searchParams,
}: {
  searchParams?: Promise<{ q?: string }>;
}) {
  const params = await searchParams;
  const rows = await getRows(params?.q);

  return (
    <div className="space-y-6">
      <div>
        <p className="eyebrow">生成</p>
        <h1 className="mt-2 text-3xl font-semibold">全站任务</h1>
      </div>
      {rows ? (
        <DataTable
          headers={[
            "ID",
            "用户",
            "模型",
            "状态",
            "渠道",
            "账号",
            "点数",
            "尝试",
            "错误",
            "Prompt",
          ]}
          rows={rows}
        />
      ) : (
        <div className="surface-panel p-6 text-sm leading-6 text-text-muted">
          生成任务服务暂不可用，请确认数据库连接后刷新。
        </div>
      )}
    </div>
  );
}
