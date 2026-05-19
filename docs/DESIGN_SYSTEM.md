# 四川图像站 - 设计系统文档

> 版本 1.0.0 | 最后更新：2025-05-18

## 目录

- [设计原则](#设计原则)
- [颜色系统](#颜色系统)
- [排版系统](#排版系统)
- [间距系统](#间距系统)
- [圆角系统](#圆角系统)
- [阴影系统](#阴影系统)
- [动画系统](#动画系统)
- [组件规范](#组件规范)
- [布局规范](#布局规范)

---

## 设计原则

### 核心价值

1. **一致性优先** - 所有界面元素遵循统一的视觉语言
2. **功能清晰** - 视觉层级明确，交互反馈即时
3. **优雅克制** - 避免过度设计，保持专业感
4. **暗色为主** - 默认暗色主题，减少视觉疲劳

### 设计语言特征

- **微妙的层次感**：通过细腻的背景色差异和边框建立层级
- **精准的圆角**：统一使用 4px/6px/10px/14px 四级圆角系统
- **流畅的动效**：120-240ms 的过渡动画，使用 ease-out 缓动
- **克制的色彩**：以灰度为主，语义色仅用于状态提示

---

## 颜色系统

### 主色板（暗色主题）

#### 背景层级

```css
--bg: 8 8 9              /* 页面底色 #080809 */
--surface: 14 14 16       /* 卡片/面板 #0E0E10 */
--surface-2: 22 22 25     /* 次级面板 #161619 */
--surface-3: 32 32 36     /* 三级面板 #202024 */
```

**使用规则**：
- `--bg`：页面背景，最深层
- `--surface`：主要内容卡片（Card、Dialog、Popover）
- `--surface-2`：输入框、次级容器、hover 状态
- `--surface-3`：按钮 hover、下拉选项 hover

#### 边框

```css
--border: 32 32 36        /* 默认边框 #202024 */
--border-strong: 56 56 62 /* 强调边框 #38383E */
```

**使用规则**：
- `--border`：默认分隔线、卡片边框
- `--border-strong`：hover 状态、焦点状态、选中状态

#### 文本

```css
--text: 237 237 240       /* 主文本 #EDEDF0 */
--text-muted: 150 150 158 /* 次要文本 #96969E */
--text-faint: 95 95 102   /* 辅助文本 #5F5F66 */
```

**使用规则**：
- `--text`：标题、正文、按钮文字
- `--text-muted`：说明文字、标签、占位符
- `--text-faint`：禁用状态、不重要信息

#### 语义色

```css
--accent: 237 237 240     /* 强调色（同主文本）*/
--success: 76 175 130     /* 成功 #4CAF82 */
--danger: 232 90 79       /* 危险 #E85A4F */
--warning: 230 175 84     /* 警告 #E6AF54 */
--info: 130 170 230       /* 信息 #82AAE6 */
```

**使用规则**：
- 仅用于状态提示（Badge、Toast、表单验证）
- 不用于装饰性元素
- 保持高对比度，确保可读性

### 管理后台色板

管理后台使用独立的配色方案（`data-surface="admin"`），提供更高的对比度和更明确的视觉区分。

```css
/* 暗色 */
--bg: 9 9 11
--surface: 17 17 19
--accent: 96 165 250      /* 蓝色强调 */

/* 亮色 */
--bg: 245 241 236         /* 暖灰背景 */
--surface: 255 252 248
--accent: 78 116 196
```

---

## 排版系统

### 字体家族

```css
--font-stack-sans: "Geist", "HarmonyOS Sans SC", "PingFang SC", system-ui, sans-serif
--font-stack-serif: "Fraunces", "LXGW WenKai", Georgia, serif
--font-stack-mono: "Geist Mono", "JetBrains Mono", ui-monospace, monospace
```

**使用场景**：
- **Sans**：界面主字体（按钮、正文、标题）
- **Serif**：品牌标题、特殊强调（谨慎使用）
- **Mono**：代码、数据、标签（如 `.eyebrow`、`.field-label`）

### 字号系统

| Token | 值 | 使用场景 |
|-------|-----|----------|
| `--fs-11` | 11px | 极小标签 |
| `--fs-12` | 12px | 辅助文字、表单提示 |
| `--fs-13` | 13px | 次要按钮、标签 |
| `--fs-14` | 14px | **正文默认** |
| `--fs-15` | 15px | 强调正文 |
| `--fs-16` | 16px | 小标题 |
| `--fs-18` | 18px | 卡片标题 |
| `--fs-20` | 20px | 页面副标题 |
| `--fs-24` | 24px | 页面主标题 |
| `--fs-30` | 30px | 大标题 |
| `--fs-36` | 36px | Hero 标题 |
| `--fs-48` | 48px | 特大标题 |
| `--fs-60` | 60px | 宣传页标题 |

### 行高与字间距

```css
/* 行高 */
--lh-tight: 1.1    /* 大标题 */
--lh-snug: 1.3     /* 小标题 */
--lh-normal: 1.5   /* 正文默认 */
--lh-loose: 1.7    /* 长文本 */

/* 字间距 */
--ls-tight: -0.02em   /* h1, h2 */
--ls-snug: -0.01em    /* h3 */
--ls-normal: 0        /* 正文 */
--ls-wide: 0.04em     /* 强调文本 */
--ls-eyebrow: 0.12em  /* 全大写标签 */
```

**组合规则**：

```css
/* 大标题 */
h1, h2 {
  font-size: var(--fs-24);
  line-height: var(--lh-tight);
  letter-spacing: var(--ls-tight);
  font-weight: 600;
}

/* 正文 */
body {
  font-size: var(--fs-14);
  line-height: var(--lh-normal);
  letter-spacing: var(--ls-normal);
}

/* 标签 */
.eyebrow {
  font-family: var(--font-stack-mono);
  font-size: var(--fs-12);
  text-transform: uppercase;
  letter-spacing: var(--ls-eyebrow);
}
```

---

## 间距系统

### 基础间距刻度

```css
--s-2: 2px
--s-4: 4px
--s-6: 6px
--s-8: 8px
--s-10: 10px
--s-12: 12px
--s-16: 16px
--s-20: 20px
--s-24: 24px
--s-32: 32px
--s-40: 40px
--s-48: 48px
--s-64: 64px
--s-80: 80px
--s-96: 96px
--s-128: 128px
```

### 使用规范

| 间距值 | 使用场景 |
|--------|----------|
| 2-4px | 图标与文字间距、紧凑元素 |
| 6-8px | 按钮内边距（垂直）、表单元素间距 |
| 12-16px | 按钮内边距（水平）、卡片内边距 |
| 20-24px | 卡片间距、区块间距 |
| 32-48px | 页面区块间距 |
| 64-128px | 页面顶部/底部留白 |

**禁止使用任意值**：所有间距必须从上述刻度中选择，保证视觉韵律一致。

---

## 圆角系统

```css
--radius-sm: 4px    /* 小元素（Badge、Tag）*/
--radius-md: 6px    /* 默认（Button、Input、Card）*/
--radius-lg: 10px   /* 大卡片、Modal */
--radius-xl: 14px   /* 特大容器 */
--radius-pill: 999px /* 胶囊按钮、头像 */
```

### 使用规则

- **统一原则**：同一组件内所有圆角必须一致
- **嵌套递减**：外层容器圆角 ≥ 内层元素圆角
- **默认值**：不确定时使用 `--radius-md`

**示例**：

```tsx
// ✅ 正确：统一使用 6px
<Card className="rounded-[var(--radius-md)]">
  <Button className="rounded-[var(--radius-md)]" />
</Card>

// ❌ 错误：混用不同圆角
<Card className="rounded-lg">  {/* 8px */}
  <Button className="rounded-md" />  {/* 6px */}
</Card>
```

---

## 阴影系统

```css
--shadow-xs: 0 1px 2px rgb(0 0 0 / 0.06)
--shadow-sm: 0 2px 4px -1px rgb(0 0 0 / 0.08), 0 1px 2px rgb(0 0 0 / 0.04)
--shadow-md: 0 8px 24px -8px rgb(0 0 0 / 0.18)
--shadow-lg: 0 16px 40px -12px rgb(0 0 0 / 0.24)
--shadow-ring: 0 0 0 1px rgb(var(--border))
--shadow-ring-strong: 0 0 0 1px rgb(var(--border-strong))
--shadow-focus: 0 0 0 2px rgb(var(--bg)), 0 0 0 4px rgb(var(--text) / 0.5)
```

### 使用场景

| 阴影 | 场景 |
|------|------|
| `xs` | 微妙分层（表格行、列表项）|
| `sm` | 卡片默认 |
| `md` | Dropdown、Popover |
| `lg` | Modal、Dialog |
| `ring` | 边框替代（按钮、输入框）|
| `focus` | 键盘焦点状态 |

**暗色主题注意**：阴影在暗色背景下不明显，优先使用边框 + 背景色差异建立层级。

---

## 动画系统

### 时长

```css
--duration-fast: 120ms    /* 微交互（hover、focus）*/
--duration-base: 160ms    /* 默认过渡 */
--duration-modal: 200ms   /* 弹窗出现 */
--duration-image: 180ms   /* 图片加载 */
--duration-slow: 240ms    /* 复杂动画 */
```

### 缓动函数

```css
--ease-out: cubic-bezier(0.16, 1, 0.3, 1)      /* 默认，自然减速 */
--ease-in-out: cubic-bezier(0.4, 0, 0.2, 1)    /* 平滑进出 */
```

### 标准过渡

```css
/* 按钮 */
transition: 
  background-color var(--duration-fast) var(--ease-out),
  color var(--duration-fast) var(--ease-out),
  border-color var(--duration-fast) var(--ease-out),
  transform var(--duration-fast) var(--ease-out);

/* 卡片 */
transition:
  background-color var(--duration-base) var(--ease-out),
  border-color var(--duration-base) var(--ease-out),
  transform var(--duration-base) var(--ease-out);
```

### 无障碍支持

```css
@media (prefers-reduced-motion: reduce) {
  * {
    animation-duration: 0.001ms !important;
    transition-duration: 0.001ms !important;
  }
}
```

---

## 组件规范

### Button 按钮

#### 变体（Variants）

| 变体 | 使用场景 | 视觉特征 |
|------|----------|----------|
| `primary` | 主要操作 | 黑底白字，最高视觉权重 |
| `secondary` | 次要操作 | 灰底黑字，带边框 |
| `ghost` | 辅助操作 | 透明底，hover 显示背景 |
| `danger` | 危险操作 | 红色背景 |
| `link` | 文本链接 | 无背景，下划线 |

#### 尺寸（Sizes）

| 尺寸 | 高度 | 水平内边距 | 字号 |
|------|------|------------|------|
| `sm` | 28px | 10px | 12px |
| `md` | 32px | 12px | 14px |
| `lg` | 40px | 16px | 14px |

#### 状态

```tsx
// 默认
<Button>默认</Button>

// Hover
box-shadow: inset 0 0 0 1px rgb(var(--border-strong))
background: rgb(var(--surface-3))

// Active
transform: scale(0.97)

// Disabled
opacity: 0.45
pointer-events: none

// Loading
<Button loading>
  <Spinner size="sm" />
  加载中
</Button>
```

#### 图标按钮

```tsx
// 带左图标
<Button leftIcon={<Icon />}>保存</Button>

// 带右图标
<Button rightIcon={<ChevronDown />}>展开</Button>

// 纯图标
<IconButton icon={<Settings />} aria-label="设置" />
```

### Card 卡片

#### 基础结构

```tsx
<Card>
  <CardHeader>
    <CardTitle>标题</CardTitle>
    <CardDescription>描述文字</CardDescription>
  </CardHeader>
  <CardContent>
    {/* 内容 */}
  </CardContent>
  <CardFooter>
    <Button>操作</Button>
  </CardFooter>
</Card>
```

#### 样式规范

```css
/* 基础卡片 */
background: rgb(var(--surface))
border: 1px solid rgb(var(--border))
border-radius: var(--radius-md)

/* 可交互卡片 */
transition: all var(--duration-base) var(--ease-out)

&:hover {
  border-color: rgb(var(--border-strong))
  background: rgb(var(--surface-2))
}

/* 选中状态 */
&[data-selected="true"] {
  border-color: rgb(var(--text))
  box-shadow: 0 14px 34px rgb(var(--text) / 0.1)
  transform: translateY(-1px)
}
```

### Input 输入框

#### 基础样式

```css
height: 32px
padding: 0 12px
background: rgb(var(--surface-2))
border: 1px solid rgb(var(--border))
border-radius: var(--radius-md)
font-size: var(--fs-14)
color: rgb(var(--text))

&::placeholder {
  color: rgb(var(--text-muted))
}

&:focus {
  outline: none
  box-shadow: var(--shadow-focus)
}

&:disabled {
  opacity: 0.5
  cursor: not-allowed
}
```

#### 状态变体

```tsx
// 错误状态
<Input error errorMessage="邮箱格式不正确" />
border-color: rgb(var(--danger))

// 成功状态
<Input success />
border-color: rgb(var(--success))
```

### Dialog 对话框

#### 层级规范

```css
/* 遮罩层 */
background: rgb(0 0 0 / 0.6)
backdrop-filter: blur(4px)

/* 对话框容器 */
background: rgb(var(--surface))
border: 1px solid rgb(var(--border))
border-radius: var(--radius-lg)
box-shadow: var(--shadow-lg)
max-width: 480px
```

#### 动画

```css
/* 进入 */
@keyframes dialogEnter {
  from {
    opacity: 0
    transform: scale(0.96) translateY(-8px)
  }
  to {
    opacity: 1
    transform: scale(1) translateY(0)
  }
}

animation: dialogEnter var(--duration-modal) var(--ease-out)
```

---

## 布局规范

### 页面容器

```css
.page-shell {
  max-width: 1520px
  margin: 0 auto
  padding: 0 12px  /* 移动端 */
}

@media (min-width: 640px) {
  .page-shell {
    padding: 0 20px
  }
}

@media (min-width: 1024px) {
  .page-shell {
    padding: 0 24px
  }
}
```

### 栅格系统

```tsx
// 响应式栅格
<div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
  <Card />
  <Card />
  <Card />
</div>
```

### 间距规范

```tsx
// 页面顶部间距
<main className="pt-16 pb-24">

// 区块间距
<section className="space-y-8">

// 卡片间距
<div className="grid gap-6">
```

---

## 实施检查清单

### 新组件开发

- [ ] 使用 Design Tokens（禁止硬编码颜色/间距）
- [ ] 圆角统一使用 `--radius-*` 变量
- [ ] 过渡动画使用 `--duration-*` 和 `--ease-*`
- [ ] 支持暗色/亮色主题
- [ ] 支持 `prefers-reduced-motion`
- [ ] 键盘焦点样式使用 `--shadow-focus`
- [ ] 禁用状态 `opacity: 0.45` + `pointer-events: none`

### 代码审查要点

```tsx
// ❌ 错误示例
<div className="rounded-lg bg-gray-800 p-4">
  <button className="rounded-md bg-blue-500 px-3 py-2">

// ✅ 正确示例
<div className="rounded-[var(--radius-md)] bg-surface p-4">
  <Button variant="primary">
```

### 迁移现有代码

1. 替换硬编码颜色为 Design Tokens
2. 统一圆角值（`rounded-lg` → `rounded-[var(--radius-md)]`）
3. 移除重复的 Tailwind 类，使用组件变体
4. 检查动画时长是否符合规范

---

## 附录

### 设计资源

- Figma 设计稿：[待补充]
- 组件库 Storybook：[待补充]
- 图标库：Lucide React

### 参考资料

- [Radix UI](https://www.radix-ui.com/) - 无障碍组件基础
- [Tailwind CSS](https://tailwindcss.com/) - 工具类框架
- [Geist Design System](https://vercel.com/geist) - 设计灵感来源

### 更新日志

- **v1.0.0** (2025-05-18) - 初始版本，建立核心设计规范
