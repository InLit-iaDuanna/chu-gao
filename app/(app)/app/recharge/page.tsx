import { StorefrontRechargeView } from "@/components/studio/StorefrontRechargeView";
import { StudioPageShell } from "@/components/studio/StudioPageShell";

export default function RechargePage() {
  return (
    <StudioPageShell eyebrow="账户" title="充值">
      <StorefrontRechargeView />
    </StudioPageShell>
  );
}
