# UI 组件库

`components/ui` 是应用中唯一的通用界面组件入口。页面和业务组件应从 `@/components/ui` 导入，不在业务目录复制基础控件样式。

## 使用规则

- 交互按钮使用 `Button`；仅图标操作使用 `IconButton`，必须提供 `aria-label` 或 `title`。
- 文本输入使用 `Input` 或 `Textarea`，搭配 `FormField` 提供标签、说明与错误信息。
- 选项选择使用 `Select`、`RadioGroup`、`Segmented` 或 `Tabs`，不要新增原生 `select`。
- 弹层使用 `Dialog`、`Popover`、`DropdownMenu`、`Tooltip`。这些组件已处理焦点、键盘与 ARIA 行为。
- 列表空态、加载态和数据表格分别使用 `EmptyState`、`Skeleton`、`Table` 系列。

## 视觉约束

- 颜色、阴影、间距、圆角、动效只使用 `styles/tokens.css` 中的令牌或由 Tailwind 暴露的语义类。
- `Button` 使用 `primary`、`secondary`、`ghost`、`danger`、`link` 变体；尺寸使用 `sm`、`md`、`lg`。
- `Input`、`Textarea`、`Select` 使用 `controlSize`，并通过 `invalid` 或 `FormField.error` 表达错误状态。
- 数据驱动的画布坐标、进度和主题预览可使用局部 inline style；新增例外须加入 `scripts/check-ui.mjs` 的明确白名单。

## 质量门槛

每次 UI 改动至少执行：

```bash
pnpm typecheck
pnpm lint
pnpm check:ui
pnpm test:ui
```

`check:ui` 拒绝废弃 brutal 样式、重阴影、过大圆角和未登记的 inline style。`lint` 忽略构建产物与独立的 `kimitest` 项目，确保输出只反映应用源码。
