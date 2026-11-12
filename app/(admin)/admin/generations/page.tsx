import { GenerationsView } from "@/components/admin-console/GenerationsView";

export default async function AdminGenerationsPage({
  searchParams,
}: {
  searchParams: Promise<{ generationId?: string }>;
}) {
  const { generationId } = await searchParams;
  return <GenerationsView initialGenerationId={generationId ?? ""} />;
}
