import { DesignerProfile } from "@/components/inspiration/DesignerProfile";

export default async function WorkspaceDesignerPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <div className="h-full overflow-y-auto">
      <DesignerProfile key={id} userId={id} basePath="/app/inspiration" />
    </div>
  );
}
