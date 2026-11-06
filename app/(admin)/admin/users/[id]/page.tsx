import { UserDetailView } from "@/components/admin-console/UserDetailView";

export default async function AdminUserDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return <UserDetailView userId={id} />;
}
