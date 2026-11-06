import { IntegrationsForm } from "@/components/admin/IntegrationsForm";
import {
  getConversationCompileSystemPrompt,
  getConversationStatus,
  getConversationSystemPrompt,
  getDeepSeekStatus,
  getPptSystemPrompt,
} from "@/lib/ai-config";

export const dynamic = "force-dynamic";

export default async function AdminIntegrationsPage() {
  const [
    deepseek,
    pptSystemPrompt,
    conversation,
    conversationSystemPrompt,
    conversationCompileSystemPrompt,
  ] = await Promise.all([
    getDeepSeekStatus(),
    getPptSystemPrompt(),
    getConversationStatus(),
    getConversationSystemPrompt(),
    getConversationCompileSystemPrompt(),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <p className="eyebrow">生成与渠道</p>
        <h1 className="mt-2 text-3xl font-semibold">AI 集成</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-text-muted">
          配置 DeepSeek 提示词优化服务、对话模型，以及 PPT 生成使用的系统提示词。配置变更会写入审计记录。
        </p>
      </div>
      <IntegrationsForm
        initial={{
          deepseek,
          pptSystemPrompt,
          conversation,
          conversationSystemPrompt,
          conversationCompileSystemPrompt,
        }}
      />
    </div>
  );
}
