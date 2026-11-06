# 需求入口：真实 LLM 对话与浏览器恢复

这次修改使用现有 `ResearchIntake`、`ResearchWorkspace` 和 `/api/research/intake` 链路。界面不再要求先填研究表格或逐步选择模式。用户从一个输入框说出想法；后续助手回复读取真实任务保存的 `reply`。生产组件没有固定追问脚本，也不把等待状态渲染成模型已经回答。

## 界面合同

- 主入口只有一个自然语言输入框；后端每次返回一个问题，用户可以继续回答、纠正或直接说“还不确定，先研究”。前端把这些原话交给 intake API，不用关键词分支代替模型理解。
- 摘要完成时显示简短的已理解需求和仍未知事项。最新助手回复与摘要完全相同时只显示一次。完整历史仍可阅读，不把未回答问题隐藏成已经确认。
- 模式、深度、模型和产物配置保留在可选高级折叠里，研究步骤默认折叠。正式研究由独立的“开始研究”按钮启动，模型 `ready` 不自动执行研究。
- 附件为可选入口。帮助文字明确“可先添加参考资料，开始研究时读取”。上传成功不表示访谈模型已经阅读 PDF、图片或文档正文；已有 `selectedContext` 与附件选中状态继续保留。
- 发出网络请求、已排队、worker 整理、读取已接受回复分别展示实际状态。没有逐字动画或伪造助手回答。现有错误、只读重读、显式停止入口保留。
- 桌面 Enter 发送；Shift+Enter 和中文输入法组合过程不误提交。粗指针设备允许正常换行，发送使用显式按钮。输入框的键盘焦点保留在外壳，移除了旧内联去焦点样式。

## 必须维持的状态约束

`result.ready` 必须同时满足最新 task 为 `completed` 且 `resultTaskId === task.id`。只在当前提交已确认、没有待发送文字或在途发送时，`onDraft` 才将第五个参数 `confirmedTaskId` 交给父组件。父组件的正式任务 POST 携带该 `intakeTaskId`，服务端再次核对最新摘要版本；具体服务端合同见 `INTAKE_DIALOGUE_V1.md`。

用户开始输入纠正时立即撤销旧 ready，不等 POST 成功。所有异步 `ensureProject`、GET 和 UI apply 都检查当前项目及本次挂载版本；旧项目迟到响应即使忽略 `AbortSignal` 也不能修改新项目或 URL。初次恢复可以合并服务器原有参考资料，此后用户本地添加和移除的选择保持有效。

未知 POST 回执在项目级 `sessionStorage` 保存原始完整 payload 与 `clientRequestId`；显式重试复用这份原样请求。刷新先恢复该回执，再读取服务器对话，不能短暂重新批准旧摘要。只有已知接受的 task ID，或 owner GET 返回的 `latestClientRequestId` 与回执 UUID 严格相同，才能认领该提交；另一标签即使原话完全相同也不能认领。旧 GET 缺 UUID 时保守保留回执，供用户明确进行同 UUID 的幂等重试。已经收到 task ID 但首个 GET 失败时继续按该任务恢复，只进行 GET，不自动重新请求模型。回执写入失败则不发起新的 POST，保留用户输入并显示错误。

SSE 只通知刷新保存的视图。解析异常触发只读 GET；GET 进行中又收到终态通知时设置补读标记，在该 GET 完成后再读一次，避免终态被稍旧的快照遮盖。快照不能倒退序号；同 task 的合法显式新 attempt 在序号增长且 activeAttemptId 改变时可从旧失败状态恢复 queued/running，不会永久卡在已失败。

这些措施不声称解决任意浏览器崩溃或跨设备草稿同步。`sessionStorage` 是当前标签页的回执恢复；最终幂等、轮次历史和正式启动检查仍由数据库与服务端负责。

## 已执行的检查

`research-intake-ui-tests.log`：**21 / 21 通过**，其中实际组件 17 项、纯呈现 helper 4 项。覆盖自然对话、未知先研究、参考资料累积、ready 与当前结果绑定、输入纠正立即失效、丢回执原请求重试、正确 UUID 只读恢复、另一标签同原话不同 UUID / 附件不认领、旧接口缺 UUID 保守保留、ACK 后 GET 失败、刷新恢复、切项目迟到响应、SSE 补读、输入法和认证错误。测试模型内容为显式 fixture，不是生产回答。

`research-intake-lint.log`：本次六个组件/helper/test 文件的普通 ESLint，exit 0、无发现。`research-intake-typecheck.log`：全项目 `tsc --noEmit --incremental false`，exit 0。父组件及后端各自的回归数量另见总验收，不能将这些子集相加冒充完整套件独立运行。

`research-ui-browser-result.json` 的 `intake` 部分记录实际 Chrome **155.0.8059.84** 在 **1440 / 768 / 390 × 1000** 三视口的检查。复用现有 harness，挂载实际 `ResearchWorkspace` / `ResearchIntake`，编译原应用 Tailwind CSS。每个视口都实际操作：

1. 单输入框与可选高级折叠，聚焦后外壳出现可见 2px 焦点环。
2. 打开真实文件选择控件，调用原上传路径的离线 HTTP fixture。
3. 三轮原话 POST、排队、模拟服务器终态通知、显示持久化问题与摘要。
4. 刷新只读取历史，不重复提交；自然表达不确定、随后修改市场。
5. 输入纠正立即撤销开始状态；最终正式 POST 使用第三轮最新 intakeTaskId 和保留的参考资料。
6. 无水平溢出、无 page error、无意外网络请求。

桌面、平板和手机的本地截图已检查。手机摘要和开始按钮在同一可滚动页面，开始按钮可见且已实际点击；代码没有另造截图专用界面。截图和临时浏览器 bundle 放在交付源码之外，其目录记录在 JSON。`intake-start-*.png` 是滚动到开始区域的额外 QA 记录。

### 范围限制与复跑

浏览器 HTTP API 和 EventSource 使用明确标注的离线 fixture；没有登录、完整 Next.js 认证壳或 SSR 验收，没有真实 LLM、搜索、付费调用、生产数据库、真实附件提取或实际研究执行。三轮示例检验界面与请求合同，不能证明真实模型会准确、集中地追问，也不能证明兼容上游稳定性。

本地 QA 用已有 Geist 与 Noto Sans CJK SC 回退字体，不请求网络字体，不更改产品字体策略。初次 intake 浏览器执行曾因高级设置选择器要求 exact 文本而停止；保留在 `research-ui-browser-initial-intake-selector-failed.log`，修正的是 QA 选择器，并未将该失败宣称为应用验证通过。Chrome 安装修复和旧报告卡片检查见 `RESEARCH_UI_V3.md`。

从 source 根目录复跑：

```sh
pnpm exec vitest run --config vitest.config.ts \
  components/research/ResearchIntake.test.tsx \
  components/research/intake-presentation.test.ts

RESEARCH_QA_CHROME=/absolute/path/to/chrome \
RESEARCH_QA_CJK_FONT=/absolute/path/to/NotoSansCJKsc-Regular.otf \
node --import tsx validation/run-research-ui-browser.mjs
```

浏览器脚本同时检查既有报告阅读与新需求入口。`--prepare-only` 只构建，不能当作执行浏览器断言。
