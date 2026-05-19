import { WorkbenchShell } from "@/components/workbench/WorkbenchShell";
import { WorkbenchShellV2 } from "@/components/workbench/WorkbenchShellV2";

export default async function AppPage({
  searchParams,
}: {
  searchParams: Promise<{ conversation?: string; v?: string }>;
}) {
  const params = await searchParams;
  const useLegacy =
    params.v === "1" || process.env.NEXT_PUBLIC_WORKBENCH_LEGACY === "1";

  if (useLegacy) {
    return (
      <WorkbenchShell initialConversationId={params.conversation ?? null} />
    );
  }

  return (
    <WorkbenchShellV2 initialConversationId={params.conversation ?? null} />
  );
}
