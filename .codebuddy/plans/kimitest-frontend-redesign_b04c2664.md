---
name: kimitest-frontend-redesign
overview: 在根目录新建 kimitest/ 文件夹放置完整可运行的 Next.js 项目副本，以全新「暗夜高级感」设计语言颠覆性重构全部前端页面（落地页、工作台、认证、管理后台），保留所有后端 API 与业务逻辑实现真实功能对接。
design:
  architecture:
    framework: react
  styleKeywords:
    - 暗色高级感
    - 极光渐变辉光
    - 玻璃拟态
    - 编辑级衬线排版
    - 细腻发丝描边
    - 流畅物理动效
  fontSystem:
    fontFamily: Playfair Display
    heading:
      size: 64px
      weight: 600
    subheading:
      size: 24px
      weight: 500
    body:
      size: 15px
      weight: 400
  colorSystem:
    primary:
      - "#8B5CF6"
      - "#A78BFA"
      - "#22D3EE"
    background:
      - "#08080C"
      - "#0E0E14"
      - "#14141C"
    text:
      - "#F4F4F6"
      - "#9C9CA8"
      - "#63636E"
    functional:
      - "#34D399"
      - "#F87171"
      - "#FBBF24"
      - "#38BDF8"
todos:
  - id: copy-project
    content: 复制项目到 kimitest/（排除 node_modules/.next/.git），pnpm install 并验证 dev 可启动
    status: completed
  - id: design-foundation
    content: Use [skill:frontend-design] 重写设计系统底座：styles/tokens.css、typography.css、app/globals.css 新令牌与玻璃辉光工具类
    status: completed
    dependencies:
      - copy-project
  - id: ui-primitives
    content: Use [skill:frontend-design] 重构共享组件库 components/ui 与 components/shared 适配新视觉体系
    status: completed
    dependencies:
      - design-foundation
  - id: landing-auth
    content: Use [skill:frontend-design] 颠覆性重写落地页 app/page.tsx 与登录注册页及 auth 组件
    status: completed
    dependencies:
      - ui-primitives
  - id: workbench-redesign
    content: Use [skill:frontend-design] 与 [skill:frontend-patterns] 重构工作台外壳及 components/workbench 全部界面组件
    status: completed
    dependencies:
      - ui-primitives
  - id: admin-redesign
    content: Use [subagent:code-explorer] 梳理依赖后换肤管理后台 11 页、components/admin 与 admin-forms.css
    status: completed
    dependencies:
      - ui-primitives
  - id: verify-build
    content: 启动 dev 联调真实 API 全链路走查，修复 lint 与 pnpm build 错误
    status: completed
    dependencies:
      - landing-auth
      - workbench-redesign
      - admin-redesign
---

## 用户需求

对「初稿」AI 图像生成工作台的前端进行颠覆性重设计：彻底抛弃现有新粗野主义风格（粗描边、硬阴影、旋转色块），重新定义一套具备高级感与设计感的全新视觉语言。成果放置在根目录新建的 `kimitest/` 文件夹中，作为独立 Next.js 副本运行，与原项目互不影响。

## 产品概述

「初稿」是面向设计学生的 AI 图像生成工作台：对话式描述想法 → 多通道实时生成 → 多轮迭代保留历史版本 → 导出成品。包含面向用户的落地页/认证/工作台，以及面向运营的管理后台（渠道、定价、邀请码、用户、生成记录等）。

## 核心功能（全部保留并接真实 API）

- 落地页：品牌展示、核心能力、工作流程、注册转化
- 认证：登录、注册（邀请码）
- 工作台：对话式生成（SSE 流式）、无限画布、图片画廊/灯箱、历史记录、设置
- 管理后台：仪表盘统计、渠道/账号管理、定价、邀请码、兑换码、用户详情、生成记录
- 后端 `app/api/`（57 个路由）、`lib/`、`workers/`、`prisma/` 全部原样保留，保证功能完全可用

## 视觉目标

与原设计完全对立的高级暗色语言：深邃曜石底色 + 极光渐变辉光、1px 细腻发丝描边、玻璃拟态面板、优雅衬线大标题、流畅物理动效，营造「暗夜流光」的高级氛围。

## 技术栈选择

完全复用现有技术栈（独立副本，不引入新框架）：

- Next.js 15.5.18（App Router）+ React 19.2 + TypeScript
- Tailwind CSS 4（@theme 设计令牌）+ 自定义 CSS tokens
- framer-motion 12（仅用于客户端交互岛屿，落地页保持服务端组件 + CSS 动画）
- Radix UI（dialog/dropdown）、lucide-react、zustand、clsx + tailwind-merge
- 后端不变：Prisma + BullMQ + ioredis + pino

## 实现方案

策略：**整体复制 → 换肤式重构**。先将项目完整复制到 `kimitest/`（排除 node_modules/.next/.git/kimitest 自身），再按「设计系统底座 → 共享组件 → 逐页面」的顺序重构，后端链路零改动，保证真实 API 可用。

关键决策：

1. **只改表现层，不动数据层**：`app/api/`、`lib/`、`workers/`、`prisma/`、`middleware.ts` 原样复制，API 契约不变，功能零回归。
2. **设计令牌先行**：重写 `styles/tokens.css` 色板/阴影/圆角/动效令牌（保留变量名契约如 `--bg`/`--surface`/`--text`/`--brand-primary`，仅替换数值并新增辉光令牌），使大量既有 class 自动获得新基调，降低改动面。
3. **删除粗野主义遗产**：移除 `globals.css` 中 `.button-brutal-*`/`.card-brutal`/`--shadow-brutal-*` 及落地页全部 `border-[3px]`/硬阴影/随机 rotate，替换为玻璃、辉光、细腻过渡的新工具类。
4. **性能原则**：落地页维持服务端组件 + CSS 入场动画（framer-motion 不进落地页 bundle）；工作台为客户端重度交互区，framer-motion 仅用于面板/灯箱/微交互，zustand 精准订阅避免多余重渲染；SSE 流式逻辑 `conversation-sse.ts`/`conversation-generation-stream.ts` 等数据层文件不改。
5. **暗色优先**：新语言以暗色为主基调精调，亮色主题同步重映射令牌保证可用。

## 实施注意事项

- 复制后先 `pnpm install`，确认 dev 可启动再开始改样式，随时可运行验证。
- workbench 组件 23 个 tsx 规模较大，重构时保持 props/状态接口不变，仅改 JSX 结构与 className，避免破坏 SSE、画布、流式渲染逻辑。
- 管理后台复用 `styles/admin-forms.css`，随新令牌整体换肤，不逐个表单重写。
- 遵循 `prefers-reduced-motion` 约定（globals.css 已有机制，保留并扩展）。
- 每完成一个页面区块即运行 lint，最后统一 `pnpm build` 验证。

## 架构设计

与原项目一致的 App Router 分层，仅表现层换新：

```mermaid
graph TD
  A[app/layout.tsx 根布局/字体/主题] --> B[落地页 page.tsx]
  A --> C[(auth) 登录/注册]
  A --> D[(app) 工作台]
  A --> E[(admin) 管理后台]
  D --> F[components/workbench 外壳+对话+画布]
  E --> G[components/admin 表单+表格]
  B --> H[components/ui 共享原语]
  C --> H
  F --> H
  G --> H
  H --> I[styles/tokens.css 新设计令牌]
  F --> J[app/api 真实接口 不变]
  G --> J
```

## 目录结构（kimitest/ 内，相对原项目的改造清单）

```
kimitest/                          # [NEW] 整体复制的独立副本
├── package.json / next.config.ts / middleware.ts  # [复制不变] 依赖与配置保持原样
├── app/api/**                     # [复制不变] 57 个真实 API 路由
├── lib/** workers/** prisma/**    # [复制不变] 数据层与队列
├── styles/
│   ├── tokens.css                 # [重写] 曜石暗色板、极光渐变、辉光阴影、新圆角/动效令牌（保留变量名契约）
│   ├── typography.css             # [重写] 新字体阶调：衬线 display 大标题 + 细腻正文层级
│   └── admin-forms.css            # [换肤] 随新令牌统一调整后台表单控件
├── app/
│   ├── globals.css                # [重写] 删除 brutalist 类，新增 glass/glow/aurora/hairline 工具类与新 keyframes
│   ├── layout.tsx                 # [微调] 元信息/背景层次，字体加载方式不变
│   ├── page.tsx                   # [重写] 颠覆性落地页：极光 hero、玻璃 bento、编辑级排版、滚动叙事
│   ├── (auth)/login|register/     # [重写] 居中玻璃卡片 + 品牌氛围背景
│   ├── (app)/layout.tsx + app/**  # [重构] 工作台外壳：导航、对话、画布、历史、设置
│   └── (admin)/layout.tsx + admin/**  # [换肤] 后台 11 页统一新语言
├── components/
│   ├── ui/**                      # [重构] 16 个原语（Button/Card/Input/Dialog/Toast 等）适配玻璃辉光体系
│   ├── shared/**                  # [重构] 主题、公告条、DeferredStylesheet 等
│   ├── auth/**                    # [重构] LoginForm/RegisterForm 视觉
│   ├── workbench/**               # [重构] 23 个 tsx 外观重构，数据层 ts 文件不动
│   └── admin/**                   # [换肤] 17 个后台组件适配新语言
└── public/                        # [复制+新增] 新增纹理/装饰资产（SVG noise、渐变网格）
```

## 设计语言：暗夜流光（Obsidian Lume）

与粗野主义完全对立的暗色高级美学：**深邃曜石底 + 极光渐变辉光 + 玻璃拟态 + 编辑级排版**。灵感来自 Linear、Vercel、Raycast 的顶级暗色产品，融合杂志式的衬线大标题。

### 页面规划（4 大场景，统一语言）

**1. 落地页**（深色沉浸叙事）

- 导航块：浮动玻璃胶囊导航，backdrop-blur，滚动时浮现发丝描边
- Hero 块：满屏曜石底 + 缓慢流动的极光渐变光晕（CSS conic/radial 渐变动画），Fraunces 衬线超大标题带渐变高光字，下方磁吸玻璃 CTA 按钮（hover 辉光扩散）
- 产品预览块：工作台界面以倾斜 3D 透视玻璃橱窗呈现，底部辉光投影，hover 缓慢回正
- 能力块：Bento 网格玻璃卡片（圆角 16-20px、1px white/8 描边、内部径向高光），hover 时边框流光扫过
- 流程块：纵向时间线 + 发光节点，滚动渐入（stagger）
- CTA 块：居中极光光斑 + 衬线大标题 + 玻璃按钮，页脚极简

**2. 认证页**：居中玻璃卡片浮于极光氛围背景之上，输入框暗色磨砂、聚焦时紫色辉光描边，错误态柔和红光。

**3. 工作台**（专业工具质感）

- 顶部栏：极细发丝分隔的玻璃顶栏，品牌标 + 会话名 + 额度胶囊
- 对话面板：暗色气泡，用户消息玻璃质感、AI 消息无边框排版；输入框底部悬浮玻璃坞，聚焦辉光
- 画布区：无限画布深空底 + 细网点纹理，图片卡片圆角 12px + 悬浮柔影，生成中显示流光骨架屏
- 历史抽屉/灯箱：玻璃抽屉从右滑入，灯箱全屏 backdrop-blur
- 设置：分段控件 + 玻璃分组卡片

**4. 管理后台**：暗色数据工作台——统计卡片带微光渐变数值，表格行 hover 柔光，表单控件统一暗色磨砂，危险操作柔和红光。

### 交互与动效

缓动统一 cubic-bezier(0.16,1,0.3,1)；入场 150-400ms 渐入上升；hover 辉光/流光 200ms；尊重 prefers-reduced-motion。framer-motion 仅用于工作台面板转场与落地页可客户端化的微交互。

## Agent Extensions

### Skill

- **frontend-design**
- 用途：指导落地页、工作台、后台的颠覆性视觉重构，产出独特且生产级的设计品质
- 预期结果：「暗夜流光」设计语言在所有页面一致落地，达到一线产品的视觉水准
- **frontend-patterns**
- 用途：工作台重度交互区（SSE 流式、无限画布、zustand 状态）重构时保持 React/Next.js 最佳实践与渲染性能
- 预期结果：视觉重构不引入重渲染回归，流式生成与画布交互保持流畅

### SubAgent

- **code-explorer**
- 用途：在执行阶段跨文件梳理 workbench/admin 组件的引用关系与样式依赖，确保换肤无遗漏
- 预期结果：产出准确的组件-样式依赖映射，避免遗漏使用旧 brutalist 类的调用点