import { notFound } from "next/navigation";
import { StudioPreview } from "./StudioPreview";
import { PREVIEW_SCENARIOS, type PreviewScenario } from "./fixtures";

// Design-review harness for the chat workspace. It renders the real
// WorkspaceShell + StudioApp against canned API responses, so the UI can be
// inspected without a database. Never served in production.
export const dynamic = "force-dynamic";

export default async function StudioPreviewPage({
  searchParams,
}: {
  searchParams: Promise<{ scenario?: string; theme?: string }>;
}) {
  if (process.env.NODE_ENV === "production") notFound();
  const params = await searchParams;
  const scenario = PREVIEW_SCENARIOS.includes(
    params.scenario as PreviewScenario,
  )
    ? (params.scenario as PreviewScenario)
    : "empty";
  return (
    <StudioPreview
      scenario={scenario}
      theme={params.theme === "light" ? "light" : "dark"}
    />
  );
}
