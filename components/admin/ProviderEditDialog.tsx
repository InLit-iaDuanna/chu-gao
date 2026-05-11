import { modelsByProtocol } from "@/lib/models/registry";

export function ProviderEditDialog() {
  const openAIModels = modelsByProtocol("openai-images");
  const responsesModels = modelsByProtocol("openai-responses-image");
  const geminiModels = modelsByProtocol("gemini-image");

  return (
    <div className="surface-panel p-4">
      <p className="text-sm text-text-muted">Provider 表单逻辑预览</p>
      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <div className="surface-panel-soft p-4">
          <p className="text-sm font-medium">OPENAI_IMAGES</p>
          <ul className="mt-3 space-y-2 text-sm text-text-muted">
            {openAIModels.map((model) => (
              <li key={model.id}>{model.displayName}</li>
            ))}
          </ul>
        </div>
        <div className="surface-panel-soft p-4">
          <p className="text-sm font-medium">OPENAI_RESPONSES_IMAGE</p>
          <ul className="mt-3 space-y-2 text-sm text-text-muted">
            {responsesModels.map((model) => (
              <li key={model.id}>{model.displayName}</li>
            ))}
          </ul>
        </div>
        <div className="surface-panel-soft p-4">
          <p className="text-sm font-medium">GEMINI_IMAGE</p>
          <ul className="mt-3 space-y-2 text-sm text-text-muted">
            {geminiModels.map((model) => (
              <li key={model.id}>{model.displayName}</li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
