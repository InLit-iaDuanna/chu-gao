export const meta = {
  name: "ui-optimization",
  description: "全面优化项目 UI 设计质量和交互体验",
  phases: [
    { title: "审计", detail: "分析当前 UI 质量和问题" },
    { title: "设计", detail: "制定优化方案和视觉方向" },
    { title: "实施", detail: "并行优化各个模块" },
    { title: "验证", detail: "检查设计质量和一致性" },
  ],
};

const AUDIT_SCHEMA = {
  type: "object",
  properties: {
    issues: {
      type: "array",
      items: {
        type: "object",
        properties: {
          component: { type: "string" },
          severity: {
            type: "string",
            enum: ["critical", "high", "medium", "low"],
          },
          issue: { type: "string" },
          suggestion: { type: "string" },
        },
        required: ["component", "severity", "issue", "suggestion"],
      },
    },
    templateLikeComponents: { type: "array", items: { type: "string" } },
    missingQualities: { type: "array", items: { type: "string" } },
    strengths: { type: "array", items: { type: "string" } },
  },
  required: [
    "issues",
    "templateLikeComponents",
    "missingQualities",
    "strengths",
  ],
};

const DESIGN_PLAN_SCHEMA = {
  type: "object",
  properties: {
    visualDirection: { type: "string" },
    keyImprovements: { type: "array", items: { type: "string" } },
    components: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          priority: { type: "string", enum: ["high", "medium", "low"] },
          changes: { type: "array", items: { type: "string" } },
        },
        required: ["name", "priority", "changes"],
      },
    },
  },
  required: ["visualDirection", "keyImprovements", "components"],
};

// ============================================================================
// Phase 1: 审计现有 UI
// ============================================================================
phase("审计");
log("开始审计现有 UI 质量...");

const auditPrompt = `
分析以下组件的 UI 设计质量，重点关注：

1. 是否看起来像通用模板（Tailwind/shadcn 默认风格）
2. 缺少哪些设计质量要素：
   - 层次对比
   - 间距韵律
   - 深度与层次
   - 有特色的排版
   - 语义化色彩
   - 精心设计的状态
   - 突破网格的布局
   - 纹理和氛围
   - 有意义的动效
   - 数据可视化设计

需要审计的组件：
- components/workbench/WorkbenchShellV2.tsx（主要工作台）
- app/page.tsx（着陆页）
- components/admin/AdminForms.tsx
- components/shared/AnnouncementBanner.tsx

根据 web/design-quality.md 的标准，识别所有需要改进的地方。

返回结构化的审计结果。
`;

const auditResults = await agent(auditPrompt, {
  label: "审计 UI 质量",
  schema: AUDIT_SCHEMA,
  model: "sonnet",
});

log(
  `发现 ${auditResults.issues.length} 个问题，${auditResults.templateLikeComponents.length} 个模板化组件`,
);

// ============================================================================
// Phase 2: 制定设计方案
// ============================================================================
phase("设计");
log("基于审计结果制定优化方案...");

const designPrompt = `
基于以下审计结果，制定全面的 UI 优化方案：

审计结果：
${JSON.stringify(auditResults, null, 2)}

要求：
1. 选择一个具体的视觉方向（不能是"clean minimal"或"modern"这种泛泛的描述）
   推荐方向：Editorial / Neo-brutalism / Glassmorphism / Dark luxury / Bento layouts / Swiss / Retro-futurism
2. 针对每个问题组件，提出具体的改进措施
3. 确保改进后至少包含 4 个设计质量要素
4. 保持与现有设计系统（styles/tokens.css）的兼容性

当前设计系统特征：
- 暗色为主，层次化背景
- 使用 Geist 字体家族
- 精确的圆角系统（4px/6px/10px/14px）
- 流畅的动效（120-240ms）

返回详细的设计优化计划。
`;

const designPlan = await agent(designPrompt, {
  label: "制定设计方案",
  schema: DESIGN_PLAN_SCHEMA,
  model: "opus",
});

log(`设计方向：${designPlan.visualDirection}`);
log(`计划优化 ${designPlan.components.length} 个组件`);

// ============================================================================
// Phase 3: 并行实施优化
// ============================================================================
phase("实施");
log("开始并行优化各个组件...");

const highPriorityComponents = designPlan.components
  .filter((c) => c.priority === "high")
  .map((c) => c.name);

const mediumPriorityComponents = designPlan.components
  .filter((c) => c.priority === "medium")
  .map((c) => c.name);

log(`高优先级组件：${highPriorityComponents.join(", ")}`);
log(`中优先级组件：${mediumPriorityComponents.join(", ")}`);

const optimizationResults = await pipeline(
  designPlan.components.filter(
    (c) => c.priority === "high" || c.priority === "medium",
  ),

  // Stage 1: 优化组件
  async (component) => {
    const prompt = `
优化组件：${component.name}

设计方向：${designPlan.visualDirection}

具体改进措施：
${component.changes.map((c, i) => `${i + 1}. ${c}`).join("\n")}

要求：
1. 读取现有组件代码
2. 应用所有改进措施
3. 确保代码符合 web/coding-style.md 规范
4. 保持响应式设计
5. 添加微交互和动效
6. 使用设计系统的 tokens

写入优化后的组件代码。
`;

    return agent(prompt, {
      label: `优化 ${component.name}`,
      model: "sonnet",
      phase: "实施",
    });
  },

  // Stage 2: 代码审查
  async (result, component) => {
    const reviewPrompt = `
审查刚刚优化的组件：${component.name}

检查：
1. 是否避免了模板化风格
2. 是否包含至少 4 个设计质量要素
3. 代码质量和性能
4. 可访问性
5. 响应式设计

给出审查结果和进一步改进建议。
`;

    return agent(reviewPrompt, {
      label: `审查 ${component.name}`,
      agentType: "code-reviewer",
      phase: "实施",
    });
  },
);

log(`完成 ${optimizationResults.filter(Boolean).length} 个组件的优化`);

// ============================================================================
// Phase 4: 验证设计质量
// ============================================================================
phase("验证");
log("验证整体设计质量和一致性...");

const validationPrompt = `
验证优化后的 UI 设计质量：

1. 检查所有优化的组件
2. 确认是否避免了通用模板风格
3. 验证设计质量要素：
   - 清晰的层次对比
   - 有意识的间距韵律
   - 深度或层次感
   - 有特色的排版
   - 语义化色彩使用
   - 精心设计的状态
   - 突破网格的布局元素
   - 纹理或氛围
   - 有意义的动效
   - 数据可视化设计

4. 检查设计一致性
5. TypeScript 类型检查
6. 构建验证

提供最终的质量报告和遗留问题清单。
`;

const validationReport = await agent(validationPrompt, {
  label: "验证设计质量",
  model: "opus",
});

log("UI 优化完成！");

return {
  auditResults,
  designPlan,
  optimizationResults: optimizationResults.filter(Boolean).length,
  validationReport,
};
