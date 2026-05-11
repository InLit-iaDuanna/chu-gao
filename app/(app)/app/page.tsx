import { WorkbenchShell } from "@/components/workbench/WorkbenchShell";

export default async function AppPage({
  searchParams,
}: {
  searchParams: Promise<{ conversation?: string }>;
}) {
  const params = await searchParams;

  return <WorkbenchShell initialConversationId={params.conversation ?? null} />;
}
