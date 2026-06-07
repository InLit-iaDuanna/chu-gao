import { WorkbenchShellV2 } from "@/components/workbench/WorkbenchShellV2";

export default async function CanvasPage({
  searchParams,
}: {
  searchParams: Promise<{ conversation?: string }>;
}) {
  const params = await searchParams;

  return (
    <WorkbenchShellV2
      initialConversationId={params.conversation ?? null}
      initialMode="canvas"
    />
  );
}
