# Design Tokens 快速参考

> 开发时的速查表，完整文档见 [DESIGN_SYSTEM.md](./DESIGN_SYSTEM.md)

## 颜色 Tokens

### 背景

```tsx
className="bg-background"        // 页面底色
className="bg-surface"          // 卡片/面板
className="bg-surface-2"        // 输入框/次级容器
className="bg-surface-3"        // 按钮 hover
```

### 文本

```tsx
className="text-foreground"     // 主文本（默认）
className="text-text-muted"     // 次要文本
className="text-text-faint"     // 辅助文本/禁用
```

### 边框

```tsx
className="border-border"       // 默认边框
className="border-border-strong" // hover/焦点边框
```

### 语义色

```tsx
className="text-success"        // 成功 #4CAF82
className="text-danger"         // 危险 #E85A4F
className="text-warning"        // 警告 #E6AF54
className="text-info"           // 信息 #82AAE6
```

---

## 圆角

```tsx
rounded-[var(--radius-sm)]   // 4px  - Badge, Tag
rounded-[var(--radius-md)]   // 6px  - Button, Input, Card (默认)
rounded-[var(--radius-lg)]   // 10px - Modal, 大卡片
rounded-[var(--radius-xl)]   // 14px - 特大容器
rounded-[var(--radius-pill)] // 999px - 胶囊按钮
```

**默认使用 `--radius-md`**

---

## 间距

```tsx
// 常用间距
gap-2    // 8px  - 图标与文字
gap-3    // 12px - 按钮内元素
gap-4    // 16px - 表单字段
gap-6    // 24px - 卡片间距
gap-8    // 32px - 区块间距

// 内边距
p-3      // 12px - 按钮
p-4      // 16px - 小卡片
p-5      // 20px - 标准卡片
p-6      // 24px - 大卡片
```

---

## 字号

```tsx
text-xs   // 12px - 辅助文字
text-sm   // 14px - 正文（默认）
text-base // 16px - 小标题
text-lg   // 18px - 卡片标题
text-xl   // 20px - 页面副标题
text-2xl  // 24px - 页面主标题
```

---

## 阴影

```tsx
shadow-[var(--shadow-xs)]    // 微妙分层
shadow-[var(--shadow-sm)]    // 卡片默认
shadow-[var(--shadow-md)]    // Dropdown
shadow-[var(--shadow-lg)]    // Modal
shadow-[var(--shadow-focus)] // 键盘焦点
```

---

## 动画

```tsx
// 标准过渡
transition-colors duration-[var(--duration-fast)]  // 120ms - hover
transition-all duration-[var(--duration-base)]     // 160ms - 默认

// 缓动函数
ease-[var(--ease-out)]      // 默认
ease-[var(--ease-in-out)]   // 平滑进出
```

---

## 组件速查

### Button

```tsx
<Button variant="primary" size="md">主要按钮</Button>
<Button variant="secondary">次要按钮</Button>
<Button variant="ghost">辅助按钮</Button>
<Button variant="danger">危险操作</Button>
<Button loading>加载中</Button>
<Button leftIcon={<Icon />}>带图标</Button>
```

### Card

```tsx
<Card>
  <CardHeader>
    <CardTitle>标题</CardTitle>
    <CardDescription>描述</CardDescription>
  </CardHeader>
  <CardContent>内容</CardContent>
  <CardFooter>操作区</CardFooter>
</Card>
```

### Input

```tsx
<Input placeholder="请输入" />
<Input error errorMessage="错误提示" />
<Input disabled />
```

---

## 常用工具类

### 布局

```tsx
// 页面容器
<div className="page-shell">

// 栅格
<div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">

// Flex
<div className="flex items-center justify-between gap-3">
```

### 文本

```tsx
// 标签样式
<span className="eyebrow">LABEL</span>

// 字段标签
<label className="field-label">字段名</label>

// 截断
<p className="truncate">长文本...</p>
```

### 交互状态

```tsx
// Hover
hover:bg-surface-2 hover:border-border-strong

// 焦点
focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)]

// 禁用
disabled:opacity-45 disabled:pointer-events-none

// Active
active:scale-[0.97]
```

---

## 禁止事项 ❌

```tsx
// ❌ 硬编码颜色
className="bg-gray-800 text-white"

// ❌ 任意间距值
className="p-[13px] gap-[7px]"

// ❌ 混用圆角
<Card className="rounded-lg">  {/* 8px */}
  <Button className="rounded-md" />  {/* 6px */}
</Card>

// ❌ 不使用 Design Tokens
style={{ backgroundColor: '#1a1a1a' }}
```

---

## 正确示例 ✅

```tsx
// ✅ 使用语义化 Token
<div className="bg-surface border border-border rounded-[var(--radius-md)] p-4">
  <h3 className="text-foreground text-lg font-semibold">标题</h3>
  <p className="text-text-muted text-sm mt-2">描述文字</p>
  <Button variant="primary" className="mt-4">操作</Button>
</div>

// ✅ 响应式设计
<div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
  {items.map(item => <Card key={item.id} />)}
</div>

// ✅ 标准过渡
<button className="
  bg-surface-2 
  border border-border 
  rounded-[var(--radius-md)] 
  px-3 py-2
  transition-colors duration-[var(--duration-fast)]
  hover:bg-surface-3 hover:border-border-strong
">
  按钮
</button>
```
