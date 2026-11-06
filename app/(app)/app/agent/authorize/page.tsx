import { AgentAuthorizeView } from "@/components/agent/AgentAuthorizeView";
import { StudioPageShell } from "@/components/studio/StudioPageShell";

export default async function AgentAuthorizePage({
  searchParams,
}: {
  searchParams: Promise<{ user_code?: string | string[] }>;
}) {
  const { user_code: userCodeParam } = await searchParams;
  const userCode =
    (Array.isArray(userCodeParam) ? userCodeParam[0] : userCodeParam) ?? "";

  return (
    <StudioPageShell eyebrow="Agent" title="授权 Agent">
      <AgentAuthorizeView key={userCode} initialUserCode={userCode} />
    </StudioPageShell>
  );
}
