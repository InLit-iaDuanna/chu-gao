import { WorkbenchShellV2 } from "@/components/workbench/WorkbenchShellV2";

export default async function AppPage({
  searchParams,
}: {
  searchParams: Promise<{ conversation?: string }>;
}) {
  const params = await searchParams;

  return (
    <WorkbenchShellV2 initialConversationId={params.conversation ?? null} />
  );
}
