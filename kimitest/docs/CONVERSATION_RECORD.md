# 对话同步记录

这个文件用来给不同对话之间同步重要上下文。  
原则很简单：只记结论、状态、风险和下一步，不记密钥、不记完整敏感内容。

## 当前状态

- 项目：`Chūgǎo Studio`
- 形态：Next.js + Prisma + Redis + BullMQ
- 当前重点：图像生成、后台号池、服务器安全、渠道稳定性

## 最近确认

- 号池已存在，后台支持导入、编辑、测试、停用/恢复。
- `GENERATION_TIMEOUT_MS`、`PROVIDER_REQUEST_TIMEOUT_MS`、`PROVIDER_ACCOUNT_MAX_ATTEMPTS` 已接入。
- `502 Upstream access forbidden` 这类错误已被单独识别，账号会直接下线，不再只冷却。
- SSH 已做过加固，但生产机仍需以实际连通性为准再验证一次。
- `workers/generation.worker.ts` 已拆出错误映射、卡住任务恢复和成功/失败结算模块，主文件保留 BullMQ 启动与 job 编排。
- `lib/providers/index.ts` 已拆出可用性匹配、失败策略、健康状态更新和账号池租约/排序模块，主文件保留 `selectAndGenerate` 与 legacy provider fallback 编排。
- `components/workbench/hooks/useWorkbenchActions.ts` 已拆出生成 SSE 流监听/合并逻辑与会话水合逻辑，hook 保留用户操作编排。
- `components/workbench/ConversationMode.tsx` 已拆出底部输入/附件 UI 与对话出图 SSE 状态监听，主文件保留聊天、历史和预览生成流程。
- `components/workbench/WorkbenchShellV2.tsx` 已拆出 `WorkbenchShellTopBar` 和 `WorkbenchStudioPanel`，主壳保留视图切换、状态编排和 Overlay 组合；当前主文件约 584 行。
- framer-motion 已移出根布局：`AppThemeProvider` 不再包 `MotionConfig`，改由 `components/shared/MotionProvider.tsx` 在 `app/(app)/layout.tsx` 内提供（reducedMotion="user"）。落地页、登录/注册、管理端 bundle 已不含 framer，只有 `/app`、`/app/canvas` 保留。**不要在 (app) 之外的组件里 import framer-motion**，否则会把它加回这些路由的首载。
- `app/page.tsx`（落地页）已转为服务端组件，入场动画改用 CSS 类 `anim-rise` / `anim-slide-left`（globals.css），首屏文案直接 SSR。
- `components/ui/Toast.tsx` 去 framer 化：进/出场用 CSS（`toast-enter` / `toast-leave`）+ 两段式 leaving 状态；错误 toast 仍不自动消失。
- `InfiniteCanvas` 的 localStorage 持久化改为 400ms 防抖（原来每次拖拽 pointermove 都同步 JSON.stringify + 写盘）；切会话 / 卸载 / pagehide / visibilitychange 会立即冲刷，拆分该文件时请保留这段逻辑。
- 管理端仪表盘「7 日趋势」已换成真实数据：`getDailyTrend()` 用 `$queryRaw` 按服务器时区聚合近 7 日生成量；图表含 sr-only 数据表。
- Tailwind v4 的 translate 工具类走独立 `translate` CSS 属性：不要把 `-translate-x-1/2` 和内联 `style.transform: translate(-50%,…)` 同时用在一个元素上（会叠加成双重偏移）。AdminToast 已修，同时替换了它引用的不存在的 `animate-in` 系列类。
- `next.config.ts` 已不再压制 TS/ESLint 构建错误，`pnpm build` 会做真实类型检查（已验证：类型错误会让 build 失败）。`WorkbenchStudioPanel` 的 `uploadedReferenceImages` prop 类型已改为 `UploadedReferenceImage[]`（带 previewUrl 的 store 类型），修掉了当时挡住 build 的类型错误。

## 重要环境变量

- `GENERATION_TIMEOUT_MS`
- `PROVIDER_REQUEST_TIMEOUT_MS`
- `PROVIDER_ACCOUNT_MAX_ATTEMPTS`
- `RATE_LIMIT_LOGIN_PER_MIN`
- `ADMIN_IP_ALLOWLIST`

## 重要文件

- `README.md`
- `lib/providers/index.ts`
- `lib/providers/account-pool.ts`
- `lib/providers/availability.ts`
- `lib/providers/diagnostics.ts`
- `lib/providers/failure-policy.ts`
- `lib/providers/health.ts`
- `lib/providers/config.ts`
- `workers/generation.worker.ts`
- `workers/generation-worker-errors.ts`
- `workers/generation-worker-recovery.ts`
- `workers/generation-worker-settlement.ts`
- `components/workbench/hooks/useWorkbenchActions.ts`
- `components/workbench/ConversationMode.tsx`
- `components/workbench/ConversationComposer.tsx`
- `components/workbench/conversation-generation-stream.ts`
- `components/workbench/WorkbenchShellV2.tsx`
- `components/workbench/WorkbenchShellTopBar.tsx`
- `components/workbench/WorkbenchStudioPanel.tsx`
- `components/workbench/WorkbenchShellControls.tsx`
- `components/workbench/lib/workbench-generation-stream.ts`
- `components/workbench/lib/workbench-conversation-hydration.ts`
- `middleware.ts`

## 待办

- 重新在服务器上跑一次低成本生成，确认账号池是否真正切号。
- 如果还有坏账号，继续补自动下线规则。
- 继续拆工作台/UI 大文件，优先 `components/workbench/InfiniteCanvas.tsx`、`components/admin/ProviderAccountAdminForms.tsx`、`components/admin/ConfigEditor.tsx`。
- 保持 README 和这个记录文件同步更新。

## 记录格式建议

每次对话结束前，优先补这几项：

1. 已完成什么。
2. 现在卡在哪里。
3. 下一步要做什么。
4. 哪些文件被改过。
5. 哪些配置或服务器状态变了。

## 注意

- 不要贴真实 API key。
- 不要贴完整 cookie、token、授权头。
- 不要把未验证的猜测写成结论。
