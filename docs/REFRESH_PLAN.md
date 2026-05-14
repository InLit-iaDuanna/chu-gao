# 前端重构详细计划 — Linear/Vercel 风极简现代

> 目标读者：执行重构的 AI 代理（Codex）或人类工程师。
> 风格：Linear / Vercel — 灰阶为主、克制留白、单一中性强调色、≤200ms 细腻动效、无彩色噪点。
> 范围：`app/(app)`、`app/(admin)`、`app/(auth)` 全部 + `components/` 全部组件 + `styles/`。
> **不动**：`app/api/**`、`prisma/**`、`lib/**` 业务逻辑、Docker/Caddy/部署文件。
> **不做**：不要 `pnpm build`、不要起 dev server、不要 `git push`。

---

## 0. 全局约束

### 0.1 技术栈
- Next.js 15 (App Router) + React 19 + Tailwind v4 + framer-motion + next-themes + lucide-react。
- **允许新增**：`class-variance-authority` (cva)、`tailwind-variants`（二选一，推荐 cva）。
- **禁止新增**：UI 库（shadcn 整套引入除外，但本项目不引入，自己写）、CSS-in-JS、图标包替换。

### 0.2 TypeScript 风格（来自 `~/.claude/rules/typescript/coding-style.md`）
- 所有 exported 组件/函数显式标注 props 与返回类型。
- 组件 props 用 `interface XxxProps`，不要 `React.FC`。
- 回调 prop 显式签名：`onChange: (value: string) => void`。
- 避免 `any`，外部输入用 `unknown` + narrow。
- 不允许在生产代码留 `console.log`（错误用 `console.error` 或 logger）。
- 文件头不写注释块；组件内不写 JSDoc 除非 prop 含义不直观。

### 0.3 视觉绝对禁令
- ❌ 任何 inline `style={{ color/background/border }}` —— 必须走 tokens。
- ❌ 任何硬编码十六进制色（`#xxxxxx`），SVG 内单色用 `currentColor`。
- ❌ 任何半径 > 16px（除登录页 hero 装饰可破例）。
- ❌ 任何 `shadow-2xl`、`drop-shadow`、彩色 glow、emoji 装饰。
- ❌ 任何 spring/bounce 动效；动效时长禁止 > 240ms（页面进场除外）。
- ❌ 任何渐变文字（如 `bg-clip-text` 当前首页用法）—— 改为纯色 + 字距收紧。

---

## 1. 设计令牌（Phase 1）

### 1.1 `styles/tokens.css` — 整文件重写

保留所有变量名，调整数值：

```css
@layer base {
  :root,
  html.dark {
    /* 表面 */
    --bg: 8 8 9;
    --surface: 14 14 16;
    --surface-2: 22 22 25;
    --surface-3: 32 32 36;            /* 新增，hover 态用 */

    /* 描边 */
    --border: 32 32 36;
    --border-strong: 56 56 62;

    /* 文本 */
    --text: 237 237 240;
    --text-muted: 150 150 158;
    --text-faint: 95 95 102;

    /* 状态色（克制：仅在 badge/icon 用，不做大面积背景） */
    --accent: 237 237 240;             /* 保持中性 */
    --success: 76 175 130;
    --danger: 232 90 79;
    --warning: 230 175 84;
    --info: 130 170 230;

    /* 半径（整体收紧） */
    --radius-sm: 4px;
    --radius-md: 6px;
    --radius-lg: 10px;
    --radius-xl: 14px;
    --radius-pill: 999px;

    /* 动效 */
    --duration-fast: 120ms;
    --duration-base: 160ms;
    --duration-modal: 200ms;
    --duration-image: 180ms;
    --duration-slow: 240ms;
    --ease-out: cubic-bezier(0.16, 1, 0.3, 1);     /* ease-out-expo */
    --ease-in-out: cubic-bezier(0.4, 0, 0.2, 1);

    /* 字体（H1/H2 改回 sans，仅登录 hero 用 serif） */
    --font-stack-sans:
      "Geist", "HarmonyOS Sans SC", "PingFang SC", system-ui,
      -apple-system, BlinkMacSystemFont, sans-serif;
    --font-stack-serif:
      "Fraunces", "LXGW WenKai", Georgia, serif;
    --font-stack-mono:
      "Geist Mono", "JetBrains Mono", ui-monospace, monospace;

    /* 字号 */
    --fs-11: 11px; --fs-12: 12px; --fs-13: 13px; --fs-14: 14px;
    --fs-15: 15px; --fs-16: 16px; --fs-18: 18px; --fs-20: 20px;
    --fs-24: 24px; --fs-30: 30px; --fs-36: 36px; --fs-48: 48px;
    --fs-60: 60px;

    /* 行高/字距 */
    --lh-tight: 1.1;
    --lh-snug: 1.3;
    --lh-normal: 1.5;
    --lh-loose: 1.7;
    --ls-tight: -0.02em;              /* H1/H2 */
    --ls-snug: -0.01em;               /* H3/H4 */
    --ls-normal: 0;
    --ls-wide: 0.04em;
    --ls-eyebrow: 0.12em;

    /* 间距（8 倍数 + 4） */
    --s-2: 2px; --s-4: 4px; --s-6: 6px; --s-8: 8px;
    --s-10: 10px; --s-12: 12px; --s-16: 16px; --s-20: 20px;
    --s-24: 24px; --s-32: 32px; --s-40: 40px; --s-48: 48px;
    --s-64: 64px; --s-80: 80px; --s-96: 96px; --s-128: 128px;

    /* 阴影（新增） */
    --shadow-xs: 0 1px 2px rgb(0 0 0 / 0.06);
    --shadow-sm: 0 2px 4px -1px rgb(0 0 0 / 0.08), 0 1px 2px rgb(0 0 0 / 0.04);
    --shadow-md: 0 8px 24px -8px rgb(0 0 0 / 0.18);
    --shadow-lg: 0 16px 40px -12px rgb(0 0 0 / 0.24);
    --shadow-ring: 0 0 0 1px rgb(var(--border));
    --shadow-ring-strong: 0 0 0 1px rgb(var(--border-strong));
    --shadow-focus: 0 0 0 2px rgb(var(--bg)), 0 0 0 4px rgb(var(--text) / 0.5);
  }

  html.light {
    --bg: 252 252 252;
    --surface: 255 255 255;
    --surface-2: 247 247 248;
    --surface-3: 240 240 242;
    --border: 232 232 234;
    --border-strong: 210 210 214;
    --text: 17 17 19;
    --text-muted: 102 102 110;
    --text-faint: 156 156 163;
    --accent: 17 17 19;
    --success: 22 128 86;
    --danger: 196 56 50;
    --warning: 178 124 32;
    --info: 56 110 196;

    --shadow-xs: 0 1px 2px rgb(17 17 19 / 0.04);
    --shadow-sm: 0 2px 4px -1px rgb(17 17 19 / 0.06), 0 1px 2px rgb(17 17 19 / 0.03);
    --shadow-md: 0 8px 24px -8px rgb(17 17 19 / 0.10);
    --shadow-lg: 0 16px 40px -12px rgb(17 17 19 / 0.12);
    --shadow-focus: 0 0 0 2px rgb(var(--bg)), 0 0 0 4px rgb(var(--text) / 0.4);
  }
}
```

### 1.2 `styles/tokens-admin.css` — 删除

Admin 区域不再单独令牌，与主站统一。删除文件并去除 `app/globals.css` 中的 import。

### 1.3 `app/globals.css` — 重写

- 删除全部 `@layer components` 中的 `selection-pill*`、`selection-card*`、`tool-button`、`button-*`、`workbench-*`、`chat-input` —— 它们将由 React 组件取代。
- 保留 `page-shell`、`surface-panel`、`surface-panel-soft`、`field-label`、`eyebrow`、`img-enter`。
- H1/H2 改为 sans + `letter-spacing: -0.02em` + `font-weight: 600`。
- 字体导入去掉 `Fraunces`（除非登录 hero 使用 — 那就保留 Fraunces 但移除 `ss01,cv11` font-features）。保留 LXGW WenKai。
- 全局滚动条改 6px、track 透明、thumb hover 才显形。
- `:focus-visible` 用 `box-shadow: var(--shadow-focus)`，不再用 outline。
- 新增 `@theme inline`：把 `--color-surface-3`、`--color-info` 也 expose。

### 1.4 `app/layout.tsx`

- 保留逻辑，仅调整 `` className：去掉 `antialiased`（已在 html）；保留 `min-h-full bg-background text-foreground`。
- 新增 `<Suspense fallback={null}>` 包裹 `` 防止 SSR 抖动。
- 标题保留 `Chūgǎo Studio`。

**Phase 1 验收**：`pnpm lint` 0 error；改完后所有页面能正常渲染（颜色变浅/变深正确）。

---

## 2. UI 原子层 `components/ui/`（Phase 2）

新建目录与文件清单：

```
components/ui/
  Button.tsx
  IconButton.tsx
  Input.tsx
  Textarea.tsx
  Select.tsx
  Switch.tsx
  Checkbox.tsx
  Radio.tsx
  Label.tsx
  FormField.tsx          // Label + control + Description + ErrorMessage 容器
  Badge.tsx
  Card.tsx               // 命名导出 Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter
  Separator.tsx
  Tooltip.tsx
  Dialog.tsx             // Dialog, DialogTrigger, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter
  Popover.tsx
  DropdownMenu.tsx
  Tabs.tsx               // Tabs, TabsList, TabsTrigger, TabsContent
  Kbd.tsx
  Skeleton.tsx
  Spinner.tsx
  Toast.tsx + ToastProvider + useToast
  Segmented.tsx          // 单选 chip 组
  EmptyState.tsx
  index.ts               // re-export 全部
```

### 2.1 Button.tsx 规范

```typescript
interface ButtonProps extends React.ButtonHTMLAttributes{
  variant?: "primary" | "secondary" | "ghost" | "danger" | "link";
  size?: "sm" | "md" | "lg";
  loading?: boolean;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
  asChild?: boolean;          // 用 Radix Slot 或自实现的 Slot
}
```

- 用 cva 写 variants。
- 尺寸：`sm h-7 px-2.5 text-xs` / `md h-8 px-3 text-sm` / `lg h-10 px-4 text-sm`。
- 圆角统一 `rounded-md`。
- primary：`bg-foreground text-background hover:bg-foreground/90 active:bg-foreground/80`。
- secondary：`bg-surface-2 text-foreground hover:bg-surface-3 shadow-[inset_0_0_0_1px_rgb(var(--border))]`。
- ghost：`text-text-muted hover:bg-surface-2 hover:text-foreground`。
- danger：`bg-[rgb(var(--danger))] text-white hover:opacity-90`。
- link：`text-foreground hover:underline underline-offset-4 px-0 h-auto`。
- loading：右侧塞 Spinner，禁用并保持宽度。
- 所有交互 `transition-colors duration-[var(--duration-fast)] ease-out`。

### 2.2 IconButton.tsx
`square` 按钮，尺寸 `sm h-7 w-7 / md h-8 w-8 / lg h-10 w-10`，强制 children 是单个 lucide icon，size 12/14/16。

### 2.3 Input.tsx / Textarea.tsx 规范
- 高度 sm 28 / md 32 / lg 40。
- `bg-surface text-foreground placeholder:text-text-faint`。
- 边框 1px `border-border`，`hover:border-border-strong`，`focus:border-foreground focus:shadow-focus`，无 ring outline。
- 圆角 `rounded-md`。
- 内边距 `px-2.5`，垂直 `py-1.5`。
- 错误态：`aria-invalid` → `border-[rgb(var(--danger))]`。
- Textarea 默认 `min-h-[80px] resize-none`，支持 `autoResize?: boolean` prop（用 `useLayoutEffect` 同步高度）。

### 2.4 FormField.tsx
```typescript
interface FormFieldProps {
  label?: string;
  description?: string;
  error?: string;
  required?: boolean;
  children: React.ReactNode;
  htmlFor?: string;
}
```
- label：`text-xs font-medium text-foreground`。
- description：`text-xs text-text-muted mt-1`。
- error：`text-xs text-[rgb(var(--danger))] mt-1.5`。

### 2.5 Badge.tsx
- variants: neutral / success / warning / danger / info / outline。
- 实现：仅文字色 + 1px 同色 30% border + 同色 8% 背景。不要大面积色块。
- 高度 20，圆角 4，文字 11。

### 2.6 Card.tsx
- Card：`bg-surface border border-border rounded-lg`。
- 不带阴影（仅 hover 时 `hover:shadow-sm` 可选）。
- CardHeader：`px-5 pt-5 pb-3`。
- CardTitle：`text-sm font-semibold tracking-[-0.01em]`。
- CardDescription：`text-xs text-text-muted mt-1`。
- CardContent：`px-5 pb-5`。
- CardFooter：`px-5 py-3 border-t border-border flex items-center justify-end gap-2`。

### 2.7 Dialog.tsx
- 自实现（不引入 Radix）：`` 原生 + `useEffect` 控制 `showModal()`。
- 或用 portal + 自己的 backdrop。
- backdrop：`bg-background/70 backdrop-blur-[2px]`，淡入 160ms。
- content：`bg-surface border border-border rounded-lg shadow-lg max-w-[480px] w-[calc(100%-32px)]`，进场 `scale-[0.98]→1 + opacity 0→1`。
- 关闭键：ESC + 点击 backdrop + ✕ 按钮。
- 必须 trap focus、`role=dialog`、`aria-modal=true`。

### 2.8 Tooltip.tsx
- 纯 CSS hover 实现（`group-hover` 配合）即可，无需 portal。
- 内容：`bg-foreground text-background text-[11px] px-2 py-1 rounded shadow-sm`。
- 延迟 200ms 显现。

### 2.9 DropdownMenu.tsx
- portal + 定位（用 `getBoundingClientRect`）。
- 菜单项 h-8 px-2.5 text-sm，hover `bg-surface-2`。
- 分隔线：1px border-border。
- 支持快捷键尾部对齐显示（用 Kbd）。

### 2.10 Tabs.tsx
- TabsList：底部 1px hairline 容器。
- TabsTrigger：h-9 px-3 text-sm，active 时下方 2px `bg-foreground` 条。

### 2.11 Segmented.tsx
- 受控 chip 组：`bg-surface-2 p-0.5 rounded-md inline-flex`，每项 `h-7 px-2.5 text-xs rounded-[4px]`，激活态 `bg-surface shadow-xs text-foreground`。

### 2.12 Toast.tsx
- 上下文 `ToastProvider`，全局放在 `app/layout.tsx`。
- 右下角堆叠，每条 `bg-surface border border-border rounded-md shadow-md p-3 min-w-[280px]`。
- 自动消失 4s，可手动 ✕。
- 暴露 `useToast()` 返回 `{ toast: (opts: { title; description?; variant?: "default"|"success"|"danger" }) => void }`。

### 2.13 Skeleton.tsx
- `bg-surface-2 rounded` + `animate-pulse`（自定义关键帧，opacity 0.5→1，1.2s linear infinite）。
- 不要 shimmer 滑光。

### 2.14 Spinner.tsx
- 14/16/18 三档；纯 SVG 圆环，1.5px 描边，`animate-spin` 800ms linear。

**Phase 2 验收**：`pnpm lint` 0 error；`pnpm tsc --noEmit` 0 error；新建 `app/_dev/ui/page.tsx`（临时 showcase 页，最后删除）确认所有组件视觉对。

---

## 3. shared 组件改造（Phase 3）

### 3.1 `components/shared/Logo.tsx`
- 现状：自定义 wordmark。改为：左侧 16×16 几何 mark（两个方块嵌套，纯 currentColor SVG）+ 右侧文字 `Chūgǎo`（`text-[14px] font-semibold tracking-[-0.01em]`）。
- prop：`size?: "sm" | "md"`，sm 仅显示 mark。

### 3.2 `components/shared/ThemeToggle.tsx`
- 改为 Segmented（system / light / dark），尺寸 sm。
- 用 lucide 图标 Sun / Moon / Monitor，icon-only mode（带 tooltip）。

### 3.3 `components/shared/AccountMenu.tsx`
- 用新 `DropdownMenu`。
- 触发：头像（用户首字母圆形 28×28）+ 右侧 ChevronDown。
- 菜单项：账户设置 / 兑换码 / 主题切换（嵌套） / 登出。
- 顶部展示：用户名 + email（text-xs muted） + 积分余额 `Badge`。

### 3.4 `components/shared/AnnouncementBanner.tsx`
- 改为顶部贴边 1px hairline 条，无背景色。
- 内容左侧 2px 强调色竖条（`bg-foreground` 默认；`bg-[rgb(var(--warning))]` for warn 等）。
- 高度 36px，垂直居中，右侧 ✕ 关闭按钮（IconButton ghost sm）。
- 关闭状态用 localStorage 记忆（key 用 announcement hash）。

### 3.5 `components/shared/ProgressIndicator.tsx`
- 线性进度：`h-0.5 bg-surface-2 overflow-hidden rounded-full`，内条 `bg-foreground`。
- 支持 indeterminate：用 `@keyframes indeterminate` 平移。

### 3.6 `components/shared/EmptyState.tsx`
- props：`icon?: React.ReactNode; title: string; description?: string; action?: React.ReactNode`。
- icon 默认：48×48 圆角方框 + 内部线条几何（虚线圆 / 斜线等纯 CSS）。
- 文本居中，title `text-sm font-semibold`，description `text-xs text-text-muted max-w-[320px]`。

### 3.7 `components/shared/LoadingSkeleton.tsx`
- 整文件用 `Skeleton` 重新实现：导出 `SkeletonText`、`SkeletonCard`、`SkeletonRow`。

### 3.8 `components/shared/ActionableStatus.tsx`
- 保留 API（`tone`, `title`, `description`, `action`）。
- 重写视觉：用 `Card` + 顶部 1 个 4px 圆点（颜色按 tone）+ 标题 + 描述 + action 区。无大面积色块。

### 3.9 `components/shared/RedeemCodeForm.tsx`
- 用新 `FormField` + `Input` + `Button`。
- 成功后用 `useToast()` 提示，不再用内嵌 banner。

### 3.10 `components/shared/AppThemeProvider.tsx`
- 不变（仅 next-themes Provider）。

**Phase 3 验收**：各 shared 组件单独导入到 showcase 页能正常显示；现有页面引用处不破。

---

## 4. (auth) 重构（Phase 4）

### 4.1 `app/(auth)/login/page.tsx` 与 `register/page.tsx`

**布局**（双栏）：

```tsx
<div className="grid min-h-screen lg:grid-cols-[1.2fr_1fr]">
  {/* 左：品牌区（仅 lg+ 显示） */}
  <aside className="relative hidden overflow-hidden bg-surface lg:block">
    <div aria-hidden className="absolute inset-0">
      <div className="absolute inset-0 bg-[linear-gradient(to_right,rgb(var(--border)/0.4)_1px,transparent_1px),linear-gradient(to_bottom,rgb(var(--border)/0.4)_1px,transparent_1px)] bg-[size:48px_48px]" />
      <div className="absolute -left-32 top-1/3 h-[480px] w-[480px] rounded-full bg-foreground/[0.04] blur-[120px]" />
    </div>
    <div className="relative z-10 flex h-full flex-col justify-between p-12">
      <Logo />
      <div>
        <h1 className="font-serif text-[clamp(40px,5vw,60px)] leading-[1.05] tracking-[-0.02em]">
          为设计学生<br/>而生的工作台
        </h1>
        <p className="mt-6 max-w-[420px] text-sm text-text-muted leading-relaxed">
          统一接入海外主流图像生成模型，专注创作，无需切换工具。
        </p>
      </div>
      <p className="text-xs text-text-faint">© 2025 Chūgǎo Studio</p>
    </div>
  </aside>

  {/* 右：表单区 */}
  <main className="flex items-center justify-center p-6 lg:p-12">
    <div className="w-full max-w-[400px]">
      <Logo className="mb-8 lg:hidden" />
      <h2 className="text-2xl font-semibold tracking-[-0.02em]">登录</h2>
      <p className="mt-2 text-sm text-text-muted">欢迎回来，继续你的创作。</p>
      <LoginForm className="mt-8" />
    </div>
  </main>
</div>
```

### 4.2 `components/auth/LoginForm.tsx`
- 用 `FormField` + `Input` + `Button` 重写。
- 字段：邮箱、密码、记住我（Switch sm 隐藏标签 + label 文字）。
- 主按钮全宽（`className="w-full"`），loading 时显示 Spinner。
- 下方分隔线 + "还没账号？注册"。
- 错误：用 `aria-invalid` + FormField error；表单级错误用 `<ActionableStatus tone="danger">` 顶部一条。
- 入场动效：表单容器 `motion.div` `initial={{ opacity:0, y:8 }} animate={{ opacity:1, y:0 }} transition={{ duration: 0.22, ease: [0.16,1,0.3,1] }}`。

### 4.3 `components/auth/RegisterForm.tsx`
- 同上，字段：邮箱、用户名、密码、确认密码、邀请码（可选）、同意条款（Checkbox）。
- 密码字段下方实时强度指示（4 段细条：弱/中/强/极强，仅灰阶渲染，不上色）。
- 表单顶端：返回登录 link。

**Phase 4 验收**：`/login` 和 `/register` 视觉完全更新；移动端（375px）品牌区隐藏，表单居中正常；提交错误能正确提示。

---

## 5. (app) 用户工作台重构（Phase 5 — 最重）

### 5.1 拆分 WorkbenchShell.tsx（先重构，不改样式）

**当前**：`components/workbench/WorkbenchShell.tsx` 1641 行。

**拆分后结构**：

```
components/workbench/
  WorkbenchShell.tsx              // < 300 行；仅做布局编排 + provider 包裹
  hooks/
    useWorkbenchState.ts          // 当前 Shell 内 useState 全部移入；导出 reducer + actions
    useGenerationStream.ts        // SSE 流式逻辑（fetch /api/generations/[id]/stream）
    useWorkbenchPreferences.ts    // 读写偏好（封装 readWorkbenchPreferences/writeWorkbenchPreferences）
    useConversations.ts           // CRUD 对话
    useModels.ts                  // 拉取 /api/public/models
  shell/
    WorkbenchTopBar.tsx           // 顶部 48px：左侧对话切换/新建、中间空、右侧模型 + 主题 + 账户
    WorkbenchLeftRail.tsx         // 左侧对话历史 240px
    WorkbenchCenter.tsx           // 中间画布 + 对话流
    WorkbenchInspector.tsx        // 右侧 320px：动态参数、宽高比、分辨率、CostPreview
    WorkbenchComposer.tsx         // 底部贴边输入栏（PromptInput 重写）
  context/
    WorkbenchContext.tsx          // React Context，暴露 state + dispatch
```

**步骤**：
1. 先把 state/effect 原样搬到 `useWorkbenchState.ts`，Shell 用 Context Provider 包裹。
2. 把 JSX 按区域剪到 5 个子组件文件，**不改样式**。
3. 跑 lint + tsc 验证无错。
4. 在 5.2 阶段重写样式。

### 5.2 视觉规范

**外层布局**：
```tsx
<div className="flex h-full flex-col">
  <WorkbenchTopBar />              {/* h-12 border-b */}
  <div className="grid flex-1 min-h-0 grid-cols-[240px_1fr_320px]">
    <WorkbenchLeftRail />          {/* border-r */}
    <WorkbenchCenter />            {/* relative，内部贴底 Composer */}
    <WorkbenchInspector />         {/* border-l */}
  </div>
</div>
```

左右栏可折叠（按钮在 TopBar 上）：折叠后 0px（用 grid template 切换 `[240px_1fr_320px]` ↔ `[0px_1fr_320px]` ↔ `[240px_1fr_0px]`），加 `transition: grid-template-columns 200ms`。

### 5.3 WorkbenchTopBar.tsx
- 高 48px，`border-b border-border bg-surface px-3`。
- 左：折叠左栏 IconButton + 当前对话标题（可点编辑） + ModelSelector（chip 风格）。
- 中：留白。
- 右：折叠右栏 IconButton + CostPreview（紧凑） + ThemeToggle + AccountMenu。

### 5.4 WorkbenchLeftRail.tsx
- 宽 240px。
- 顶部：`新建对话` 主按钮全宽 + 下方搜索 Input（h-8 ghost 风格，带 Search icon）。
- 列表：按"今天 / 昨天 / 更早"分组，每项 h-8 px-2 rounded-md hover bg-surface-2，active 时 `bg-surface-2 shadow-ring`。每项右侧 hover 显示 IconButton 删除/重命名。
- 空状态：`EmptyState`。

### 5.5 WorkbenchCenter.tsx
- 内部纵向：`ConversationThread`（滚动） + 贴底 `WorkbenchComposer`（fixed-like 内部相对定位）。
- 画布有图时：图像走 `Canvas.tsx`。

#### 5.5.1 `ConversationThread.tsx` 重写
- 消息列表 max-width 720，居中。
- user 消息：`border-l-2 border-foreground pl-3 py-2`，无背景。
- assistant 消息：`border-l-2 border-border pl-3 py-2`，无背景。
- 角色 label：`text-[11px] font-mono uppercase tracking-wider text-text-faint mb-1`（如 `USER` / `ASSISTANT`）。
- 时间戳：尾部 `text-[11px] text-text-faint`。
- 图片消息：image grid（最多 4 列），每张图 `aspect-square rounded-md ring-1 ring-border hover:ring-border-strong`，点击放大用 Dialog。
- 流式生成中：底部显示 `<Spinner size=14 /> 正在生成...`，附 `ProgressIndicator`。
- 进场：每条 `motion.div` y 4→0, opacity 0→1, duration 160ms。

#### 5.5.2 `Canvas.tsx` 重写
- 单图模式 vs 网格模式切换（Segmented）。
- 单图：居中显示，最大 80vh，aspect 自适应；下方一行 metadata（模型、尺寸、用时、积分），text-xs muted。
- 操作浮层：右上角 IconButton 组（下载 / 复制 prompt / 重新生成 / 删除），仅 hover 显示，背景 `bg-surface/80 backdrop-blur-sm`。

#### 5.5.3 `WorkbenchComposer.tsx`（替代 `PromptInput.tsx` 编排）
- 容器：`absolute bottom-4 left-1/2 -translate-x-1/2 w-[calc(100%-32px)] max-w-[760px]`。
- 卡片：`bg-surface border border-border rounded-xl shadow-md hover:shadow-lg focus-within:border-foreground focus-within:shadow-lg transition`。
- Textarea：自适应高度 1→6 行，无 border 无 outline，`bg-transparent px-4 pt-3`。
- 底部行：`flex items-center gap-2 px-3 pb-2.5`：
  - 左：AspectRatioPicker（Segmented sm）、ResolutionPicker（Segmented sm）、ProviderChannelSelector（DropdownMenu sm ghost）、附件按钮（IconButton）。
  - 右：CostPreview 紧凑（"约 -3 积分"） + 发送 Button primary sm + Kbd `⌘↵` 提示。
- ⌘+Enter 发送，Enter 换行（改原逻辑）。
- 附件预览：textarea 上方一行 chip 列表，每个 chip 显示文件名 + ✕ 移除。

#### 5.5.4 `AspectRatioPicker.tsx` / `ResolutionPicker.tsx`
- 重写为 `Segmented`，紧凑模式（每项仅显示比例如 `1:1` / `16:9` / `9:16`）。
- 选项随模型 `capabilities` 动态改变。

#### 5.5.5 `ModelSelector.tsx`
- 改为 `DropdownMenu` 触发按钮：`<Button variant="secondary" size="sm" rightIcon={<ChevronDown />}>{model.name}`。
- 下拉每项：模型图标（小方块色） + 名称 + 描述（text-xs muted） + 右侧定价 chip。

#### 5.5.6 `ProviderChannelSelector.tsx`
- 同上 DropdownMenu，仅在 image-to-image 模型显示。

### 5.6 WorkbenchInspector.tsx（右栏）
- 宽 320px，`border-l border-border bg-surface overflow-y-auto`。
- 内部 `Tabs`：参数 / 预设 / 偏好。
- "参数" tab：包 `DynamicParamsPanel.tsx`。
- "预设" tab：用户保存的 prompt + 参数组合，可一键应用。
- "偏好" tab：包 `WorkbenchPreferencesForm.tsx`（沟通 form 控件全换成 ui/）。

#### 5.6.1 `DynamicParamsPanel.tsx` 重写
- 按字段分组（用 `Separator` 分隔），每个字段用 `FormField`。
- 数字字段：`Input type=number` + 右侧 ▲▼ 微调按钮 + 滑块（如适用）。
- 选择字段：`Select` 或 `Segmented`（≤4 选项时用 Segmented）。
- 布尔：`Switch`。
- 默认折叠"高级"分组，用 `` + 自定义 chevron。

### 5.7 子页面

#### 5.7.1 `app/(app)/app/history/page.tsx`
- 顶部 PageHeader（标题"历史" + 右侧筛选 chip + 搜索 Input）。
- 网格 `grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3`。
- 每项卡片：`aspect-square` 缩略图 + 底部一行 metadata（模型 + 时间）。
- hover：`shadow-md` + 浮层操作按钮。
- 空状态用 `EmptyState`。
- 分页：底部 `Button ghost` 加载更多。

#### 5.7.2 `app/(app)/app/settings/page.tsx`
- 仿 Vercel Settings：左侧二级导航（Tabs 垂直版）+ 右侧内容。
- 分组：账户 / 安全 / 偏好 / 兑换码 / 关于。
- 每项：左侧 label + description（text-xs muted），右侧控件，行间 `Separator`。
- 危险操作（如清空历史）：`Button variant="danger"` 带 Dialog 二次确认。

#### 5.7.3 `app/(app)/app/g/[id]/page.tsx`
- 左大图（最大 70vh）+ 右侧 320px 元信息面板（Card）。
- 元信息：模型、prompt（可复制）、参数列表、用时、积分、创建时间。
- 操作区：下载 / 重新生成 / 删除（danger）。

### 5.8 `app/(app)/layout.tsx`
- 保留鉴权逻辑。
- Sidebar 60px 改为 56px，icon 18 → 16。
- 各 nav item：active 时 `bg-surface-2 text-foreground shadow-ring`，inactive `text-text-faint hover:text-foreground hover:bg-surface-2`。
- 顶部 header 高度 48 → 与 TopBar 一致。

**Phase 5 验收**：`WorkbenchShell.tsx < 300 行`；所有现有功能正常（生成、流式、历史切换、参数变更、对话切换）；移动端 ≥ 768px 仅显示中间区，左右栏自动折叠。

---

## 6. (admin) 重构（Phase 6）

### 6.1 新建 `components/admin/AdminShell.tsx`
- 提供 `AdminShell` 包装组件，包含 sidebar + content area。
- `app/(admin)/layout.tsx` 重写为：

```tsx
<AdminShell user={session.user} currentPath={currentPath}>
  {children}
</AdminShell>
```

### 6.2 AdminShell Sidebar
- 宽 240px（可折叠到 56），固定，`border-r bg-surface`。
- 顶部：Logo 完整 + 环境徽章（`Badge` 显示 `prod`/`dev`，从 NODE_ENV 推断）。
- 导航分组：
  ```
  概览
    Dashboard
  用户与额度
    Users
    Redemption Codes
    Invites
  生成
    Generations
    Pricing
  渠道
    Providers
  系统
    System
    Audit
  ```
- 每项：`h-8 px-3 rounded-md text-sm`，icon 14 + 文字 + 右侧 active 时小圆点。
- 底部：AccountMenu + "回到工作台"链接。

### 6.3 AdminShell Content
- 顶部 PageHeader 组件（新建 `components/admin/PageHeader.tsx`）：
  - 面包屑（text-xs muted）
  - 标题（H1 24px font-semibold tracking-tight）
  - 描述（text-sm muted，可选）
  - 右侧 actions slot
- 主体 padding 24，最大宽 1280。

### 6.4 `components/admin/DataTable.tsx` 重写
- props：`columns: ColumnDef[]; data: T[]; loading?; emptyState?; pagination?`。
- 表头：`` h-9 px-3 `text-[11px] font-mono uppercase tracking-wider text-text-faint`，底部 1px hairline。
- 行：h-11 hover `bg-surface-2/50`，cell `px-3 text-sm`。
- 列对齐由 column def 控制（数字/状态默认右对齐）。
- 加载态：用 `Skeleton` 占位行（5 行）。
- 空态：`EmptyState`。
- 分页底部右侧：`Button ghost sm` 前/后 + 页码 + 每页数量 `Select`。

### 6.5 `components/admin/StatCard.tsx` 重写
```tsx
interface StatCardProps {
  label: string;
  value: string | number;
  trend?: { direction: "up" | "down" | "flat"; value: string };
  hint?: string;
}
```
- 容器：Card padding 5。
- label：eyebrow 风格 11px。
- value：30px font-semibold tracking-tight `mt-2`。
- trend：`flex items-center gap-1 mt-2 text-xs`，箭头 lucide，`up text-[rgb(var(--success))]`、`down text-[rgb(var(--danger))]`。
- hint：text-xs muted 底部。

### 6.6 `components/admin/ProviderCard.tsx` 重写
- 用 Card；左侧 logo（圆角方块） + 中间名字/描述 + 右侧 ProviderHealthBadge + DropdownMenu。

### 6.7 `components/admin/ProviderHealthBadge.tsx`
- 用新 `Badge` variant。

### 6.8 `components/admin/ConfigEditor.tsx`
- form 内全部换 ui/，分组用 Card。

### 6.9 `components/admin/AdminForms.tsx`
- 通用 form 字段全部换 ui/，导出的 helper 调整签名（保留外部 API）。

### 6.10 `components/admin/ProviderEditDialog.tsx`
- 用新 `Dialog` 重写。
- 字段表单同上。
- 底部 DialogFooter：取消 ghost + 保存 primary。

### 6.11 各管理页统一改造

模板：
```tsx
export default async function XxxPage() {
  const data = await fetchData();
  return (
    <>
      <PageHeader
        title="Xxx"
        description="..."
        actions={新建}
      />
      <Card className="mt-6">
        <Toolbar /> {/* search + filters */}
        <DataTable columns={columns} data={data} /></>
  );
}
```

要改的页面：
- `app/(admin)/admin/page.tsx`：4 个 StatCard 横排 + 最近活动表格。
- `app/(admin)/admin/users/page.tsx`：DataTable。
- `app/(admin)/admin/users/[id]/page.tsx`：左侧用户卡 + 右侧 Tabs（信息/会话/积分/审计）。
- `app/(admin)/admin/providers/page.tsx`：ProviderCard grid。
- `app/(admin)/admin/system/page.tsx`：分区表单 Card。
- `app/(admin)/admin/audit/page.tsx`：DataTable。
- `app/(admin)/admin/generations/page.tsx`：DataTable + 顶部状态筛选。
- `app/(admin)/admin/redemption-codes/page.tsx`：DataTable + 批量生成 Dialog。
- `app/(admin)/admin/invites/page.tsx`：DataTable。
- `app/(admin)/admin/pricing/page.tsx`：表单 Card。

**Phase 6 验收**：所有 admin 页能正常加载并展示真实数据；DataTable 在 0 / 1 / 多条数据下表现一致。

---

## 7. 首页 `app/page.tsx`

- 删除当前实现里的渐变文字。
- 保留 hero + features 三栏结构，但：
  - hero 标题改纯色 + 字距 -0.02em。
  - features card 圆角 14（rounded-xl），删除底部 scale-x hover 线条（过装饰）。
  - 全站统一 ambient glow 调暗一档（opacity 0.025）。
- 顶部 nav 高度 64，加上 1px hairline 底边只在滚动后才出现（用 `useScroll`）。

---

## 8. 动效准则

| 场景 | 时长 | 缓动 | 实现 |
|---|---|---|---|
| 页面进场 | 220ms | ease-out-expo | motion.div opacity+y |
| 列表交错 | 30ms/项，最多 10 项 | linear delay | motion.div + custom |
| 按钮 hover | 120ms | ease-out | CSS transition |
| Modal / Dialog | 200ms | ease-out-expo | scale 0.98→1 + opacity |
| Dropdown 展开 | 160ms | ease-out | opacity + y -4→0 |
| 图像入场 | 180ms | ease-out-expo | img-enter keyframe |
| 主题切换 | 0ms | — | next-themes 默认 |
| 折叠/展开栏 | 200ms | ease-in-out | grid-template-columns |

**全部尊重 `prefers-reduced-motion: reduce`** — `globals.css` 已有，保留。

---

## 9. 执行顺序与 PR 划分

| # | 标题 | 大致文件数 | 验收 |
|---|---|---|---|
| 1 | tokens + globals + layout 基础 | 4 | 全站颜色更新，无功能破坏 |
| 2 | components/ui/ 原子层 | 25 | showcase 页通过，lint+tsc 0 error |
| 3 | components/shared/* 重写 | 10 | 现有页面引用处显示正常 |
| 4 | (auth) login + register | 4 | 登录/注册流程通过 |
| 5 | workbench 拆分（纯重构） | ~15 | 功能 100% 等价，行数收敛 |
| 6 | workbench 视觉重写 | ~15 | 视觉验收 |
| 7 | workbench 子页面（history/settings/g） | 3 | 各子页面验收 |
| 8 | admin Shell + DataTable + StatCard + PageHeader | 5 | 通用组件就位 |
| 9 | admin 各页面接入 | 11 | 每页验收 |
| 10 | 首页 + 清理 + 验收 | 3 | 整体走查 |

**每个阶段结束必跑**：
```bash
pnpm lint
pnpm tsc --noEmit
```
不通过不进入下一阶段。

**禁止**：跨阶段批量改动；同一 commit 同时改业务逻辑和样式。

---

## 10. 最终验收清单

- [ ] `pnpm lint` 0 error 0 warning（除非已存在的）
- [ ] `pnpm tsc --noEmit` 0 error
- [ ] 全站搜不到 `#[0-9a-fA-F]{3,8}` 硬编码颜色（除 SVG currentColor）
- [ ] 全站搜不到 `style={{ color`、`style={{ background`、`style={{ border`
- [ ] `components/workbench/WorkbenchShell.tsx` < 300 行
- [ ] `components/ui/` 全部组件均被实际使用（无死代码）
- [ ] dark / light 双主题视觉一致、对比度 ≥ WCAG AA
- [ ] 所有交互元素 `:focus-visible` 显示双层环
- [ ] 移动端 375px / 平板 768px / 桌面 1280px 三档无破版
- [ ] 关键流程手工走查：注册 → 登录 → 创建对话 → 生成图像 → 历史 → 设置 → 登出 → admin 各页
- [ ] 没有任何 `console.log`（用 `git grep "console.log"` 验证）
- [ ] 无未使用 import / 未使用变量
- [ ] `pnpm format:write` 走一遍 prettier
