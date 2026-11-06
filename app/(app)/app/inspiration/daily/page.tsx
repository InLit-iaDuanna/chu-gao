import { DailyPromptPage } from "@/components/inspiration/DailyPromptPage";

export default function DailyPage() {
  return (
    <div className="h-full overflow-y-auto">
      <DailyPromptPage basePath="/app/inspiration" />
    </div>
  );
}
