# 设计系统迁移指南

> 将现有组件迁移到统一的设计系统

## 目录

- [迁移优先级](#迁移优先级)
- [通用迁移步骤](#通用迁移步骤)
- [具体问题修复](#具体问题修复)
- [自动化工具](#自动化工具)
- [验收标准](#验收标准)

---

## 迁移优先级

### 第一阶段：核心组件（1-2天）

**高优先级**（影响全局）：

1. ✅ `Button.tsx` - 已基本符合规范，需微调圆角
2. ⚠️ `Card.tsx` - 圆角不统一（`rounded-lg` → `rounded-[var(--radius-md)]`）
3. ⚠️ `Input.tsx` - 需检查样式一致性
4. ⚠️ `Dialog.tsx` - 需统一圆角和阴影
5. ⚠️ `Select.tsx` - 下拉样式需统一

### 第二阶段：辅助组件（2-3天）

**中优先级**：

- `Badge.tsx`
- `Tooltip.tsx`
- `Popover.tsx`
- `Tabs.tsx`
- `Checkbox.tsx`
- `Radio.tsx`
- `Switch.tsx`

### 第三阶段：页面级组件（3-5天）

**低优先级**：

- `LoginForm.tsx`
- 各业务页面组件
- 布局组件

---

## 通用迁移步骤

### 1. 替换硬编码颜色

#### 查找模式

```bash
# 查找硬编码的 Tailwind 颜色类
grep -r "bg-gray-" components/
grep -r "text-gray-" components/
grep -r "border-gray-" components/
```

#### 替换规则

| 旧写法            | 新写法                 | 说明       |
| ----------------- | ---------------------- | ---------- |
| `bg-gray-900`     | `bg-background`        | 页面底色   |
| `bg-gray-800`     | `bg-surface`           | 卡片背景   |
| `bg-gray-700`     | `bg-surface-2`         | 输入框背景 |
| `text-white`      | `text-foreground`      | 主文本     |
| `text-gray-400`   | `text-text-muted`      | 次要文本   |
| `text-gray-500`   | `text-text-faint`      | 辅助文本   |
| `border-gray-700` | `border-border`        | 默认边框   |
| `border-gray-600` | `border-border-strong` | 强调边框   |

#### 示例

```tsx
// ❌ 迁移前
<div className="bg-gray-800 border border-gray-700 text-white">
  <p className="text-gray-400">描述文字</p>
</div>

// ✅ 迁移后
<div className="bg-surface border border-border text-foreground">
  <p className="text-text-muted">描述文字</p>
</div>
```

### 2. 统一圆角值

#### 查找模式

```bash
# 查找所有圆角类
grep -r "rounded-" components/ | grep -v "rounded-\[var"
```

#### 替换规则

| 旧写法         | 新写法                         | 适用组件           |
| -------------- | ------------------------------ | ------------------ |
| `rounded`      | `rounded-[var(--radius-sm)]`   | 小元素             |
| `rounded-sm`   | `rounded-[var(--radius-sm)]`   | Badge, Tag         |
| `rounded-md`   | `rounded-[var(--radius-md)]`   | Button, Input      |
| `rounded-lg`   | `rounded-[var(--radius-md)]`   | Card（统一为 6px） |
| `rounded-xl`   | `rounded-[var(--radius-lg)]`   | Modal              |
| `rounded-full` | `rounded-[var(--radius-pill)]` | 头像、胶囊按钮     |

#### 示例

```tsx
// ❌ 迁移前
<Card className="rounded-lg">
  <Button className="rounded-md" />
</Card>

// ✅ 迁移后
<Card className="rounded-[var(--radius-md)]">
  <Button className="rounded-[var(--radius-md)]" />
</Card>
```

### 3. 规范化间距

#### 查找任意间距值

```bash
# 查找任意间距（如 p-[13px]）
grep -r "\[.*px\]" components/ | grep -E "(p-|m-|gap-)"
```

#### 替换规则

```tsx
// ❌ 任意值
className = "p-[13px] gap-[7px]";

// ✅ 使用标准刻度
className = "p-3 gap-2"; // 12px, 8px
```

### 4. 统一动画时长

#### 查找模式

```bash
# 查找硬编码的 duration
grep -r "duration-" components/ | grep -v "duration-\[var"
```

#### 替换规则

```tsx
// ❌ 硬编码时长
className = "transition-all duration-150";

// ✅ 使用 Token
className = "transition-all duration-[var(--duration-base)]";
```

---

## 具体问题修复

### 问题 1：Card 圆角不一致

**现状**：

```tsx
// components/ui/Card.tsx:8
<div className={cn("rounded-lg border border-border bg-surface", className)} />
```

**问题**：`rounded-lg` = 8px，与设计系统的 `--radius-md` (6px) 不符

**修复**：

```tsx
<div
  className={cn(
    "rounded-[var(--radius-md)] border border-border bg-surface",
    className,
  )}
/>
```

### 问题 2：Button 圆角不一致

**现状**：

```tsx
// components/ui/Button.tsx:50
className = "rounded-md"; // 6px，符合规范
```

**状态**：✅ 已符合，但建议显式使用 Token

**优化**：

```tsx
className = "rounded-[var(--radius-md)]";
```

### 问题 3：双重设计系统冲突

**现状**：

- `tokens.css` - 用户端配色
- `tokens-admin.css` - 管理后台配色

**问题**：两套系统颜色值不同，导致组件在不同上下文下表现不一致

**解决方案**：

1. **保留双系统**（推荐）：通过 `data-surface="admin"` 切换
2. **统一系统**：合并为一套，移除 `tokens-admin.css`

**推荐做法**：

```tsx
// 用户端页面
<div className="page-shell">
  <Card /> {/* 使用 tokens.css */}
</div>

// 管理后台页面
<div className="page-shell" data-surface="admin">
  <Card /> {/* 使用 tokens-admin.css */}
</div>
```

### 问题 4：globals.css 中的工具类不统一

**现状**：

```css
/* globals.css:144-158 */
.tool-button { ... }
.button-primary { ... }
.button-ghost { ... }
.button-subtle { ... }
```

**问题**：与 `Button.tsx` 组件的变体系统重复

**解决方案**：

1. **移除工具类**，统一使用 `<Button>` 组件
2. **或**保留工具类，但确保样式与组件一致

**推荐**：移除工具类，使用组件

```tsx
// ❌ 旧写法
<button className="button-primary">保存</button>

// ✅ 新写法
<Button variant="primary">保存</Button>
```

---

## 自动化工具

### 批量替换脚本

创建 `scripts/migrate-design-tokens.sh`：

```bash
#!/bin/bash

# 替换圆角
find components -name "*.tsx" -type f -exec sed -i '' 's/rounded-lg/rounded-[var(--radius-md)]/g' {} +
find components -name "*.tsx" -type f -exec sed -i '' 's/rounded-md/rounded-[var(--radius-md)]/g' {} +
find components -name "*.tsx" -type f -exec sed -i '' 's/rounded-sm/rounded-[var(--radius-sm)]/g' {} +

# 替换颜色（示例）
find components -name "*.tsx" -type f -exec sed -i '' 's/bg-gray-800/bg-surface/g' {} +
find components -name "*.tsx" -type f -exec sed -i '' 's/text-white/text-foreground/g' {} +

echo "✅ 迁移完成，请检查 git diff 确认更改"
```

**使用方法**：

```bash
chmod +x scripts/migrate-design-tokens.sh
./scripts/migrate-design-tokens.sh
git diff  # 检查更改
```

### ESLint 规则（可选）

创建自定义规则禁止硬编码颜色：

```js
// eslint-local-rules.js
module.exports = {
  "no-hardcoded-colors": {
    create(context) {
      return {
        JSXAttribute(node) {
          if (node.name.name === "className") {
            const value = node.value.value;
            if (/bg-gray-|text-gray-|border-gray-/.test(value)) {
              context.report({
                node,
                message: "禁止使用硬编码颜色，请使用 Design Tokens",
              });
            }
          }
        },
      };
    },
  },
};
```

---

## 验收标准

### 组件级检查

每个组件迁移后需满足：

- [ ] 无硬编码颜色（`bg-gray-*`, `text-white` 等）
- [ ] 圆角统一使用 `--radius-*` 变量
- [ ] 间距使用标准刻度（2/4/6/8/12/16/20/24/32...）
- [ ] 动画时长使用 `--duration-*` 变量
- [ ] 支持暗色/亮色主题
- [ ] 支持 `data-surface="admin"` 切换
- [ ] 焦点样式使用 `--shadow-focus`

### 页面级检查

- [ ] 所有组件视觉一致
- [ ] 圆角、间距、颜色无突兀感
- [ ] 主题切换无样式错乱
- [ ] 响应式布局正常

### 代码质量检查

```bash
# 检查是否还有硬编码颜色
grep -r "bg-gray-" components/ app/
grep -r "text-white" components/ app/

# 检查是否还有硬编码圆角
grep -r "rounded-lg" components/ | grep -v "rounded-\[var"

# 检查是否还有任意间距值
grep -r "\[.*px\]" components/ | grep -E "(p-|m-|gap-)"
```

---

## 迁移时间表

| 阶段     | 任务            | 预计时间   | 负责人 |
| -------- | --------------- | ---------- | ------ |
| 第一阶段 | 核心组件迁移    | 1-2天      | -      |
| 第二阶段 | 辅助组件迁移    | 2-3天      | -      |
| 第三阶段 | 页面组件迁移    | 3-5天      | -      |
| 验收     | 全局检查 + 测试 | 1天        | -      |
| **总计** |                 | **7-11天** |        |

---

## 常见问题

### Q: 是否需要一次性迁移所有组件？

A: 不需要。建议按优先级分阶段迁移，每个阶段完成后进行测试。核心组件优先，业务组件可以逐步迁移。

### Q: 迁移后如何确保不引入新的不一致？

A:

1. 使用 ESLint 规则检测硬编码颜色
2. Code Review 时检查设计规范
3. 定期运行检查脚本

### Q: 旧代码和新代码如何共存？

A: 设计系统向后兼容，旧代码可以继续工作。但建议在修改旧组件时顺便迁移到新规范。

### Q: `tokens-admin.css` 是否应该移除？

A: 不建议移除。管理后台需要更高的视觉区分度，保留独立配色方案是合理的。确保通过 `data-surface="admin"` 正确切换即可。

---

## 下一步行动

1. **立即执行**：

   ```bash
   # 1. 备份当前代码
   git checkout -b design-system-migration

   # 2. 修复 Card 组件圆角
   # 编辑 components/ui/Card.tsx

   # 3. 提交第一个迁移
   git add components/ui/Card.tsx
   git commit -m "fix: 统一 Card 组件圆角为 --radius-md"
   ```

2. **本周完成**：核心组件迁移（Button, Card, Input, Dialog, Select）

3. **下周完成**：辅助组件迁移 + 页面级检查

4. **持续改进**：建立 Code Review 检查清单，确保新代码符合规范
