# Research V3：本次实际验收记录

本文件汇总这次修改实际执行的验证。原附件中其他 V2 验证记录作为历史资料保留，不能与本次结果混算。**没有付费模型调用、生产数据库写入或部署；表中的测试数量不是研究准确率。**

## 一、通过的检查

| 检查 | 本次结果 | 可复核记录与范围 |
| --- | --- | --- |
| 完整 `pnpm test:ui` | **716 通过，20 跳过**；104 个测试文件通过，3 个跳过 | `v3-run/frontend.log`；20 个跳过项为需 PostgreSQL 的研究集成测试，全部在下面的独立数据库运行中执行 |
| 真实临时 PostgreSQL 研究回归 | **190 / 190 通过**，其中 **20 项实际数据库测试** | `v3-run/research-postgres.log`；16 个测试文件通过，执行既有 19 个迁移、随机创建独立本地库、结束后删除；20 项数据库测试包含原研究生命周期 9 项、需求对话事务 5 项、执行槽竞争与退出 6 项；上游仍模拟 |
| 需求对话前端与恢复 | **21 / 21 通过** | `research-intake-ui-tests.log`；17 个组件测试、4 个 helper 测试；含自然语言输入、摘要去重、丢失回执、UUID 精确认领、多标签相同原话及旧 GET 缺字段；已包含在完整 UI 测试中 |
| 需求对话后端、网关与协议 | **25 / 25 通过** | `intake-dialogue-backend-tests.log`；13 个 intake 合同测试及既有 12 个网关/协议测试；真实请求装配，HTTP 内容为夹具；已包含在完整 UI / 研究回归中 |
| 当前需求确认与启动交接 | **17 / 17 通过** | `v3-run/frontend.log` 中的 `ResearchWorkspace.intake.test.tsx` 7 项与 `confirmed-requirements.test.ts` 10 项；覆盖迟到响应、当前确认 ID、创建快照及旧需求继承；不额外累加 |
| 两类 worker 执行槽 | **6 / 6 单元测试通过**，另有上述 **6 项实际数据库测试通过** | `v3-run/frontend.log`、`v3-run/research-postgres.log` 与 `WORKER_LANES_V3.md`；领取、旧 token、取消/退出与等待清理；不证明远端取消已物理停止 |
| 普通聊天协议回归 | **71 通过，29 跳过** | `v3-run/chat.log`；29 项聊天数据库测试未在本次执行，不能写成通过。普通聊天数据库/结算逻辑未修改 |
| GPTR 真实 SDK 离线合同 | **33 / 33 通过** | `gptr-v3-whole-table-contract-tests.log`；真实 GPTR 0.16.1、LangChain 和 OpenAI SDK 请求装配/SSE，HTTP 回答为夹具，禁止外部 socket |
| 证据质量及跨模块审计 | **35 / 35 通过** | `research-v3-evidence-integration-final.log`；已包含在最终完整 UI 测试中，不额外累加 |
| 研究 UI 与 presentation | **23 / 23 通过** | `research-v3-ui-tests.log`；已包含在完整 UI 测试中，含增量、最终替换、文本选择、引用、旧包与隔离预览 |
| 原案例留档 TS 回放 | **8 / 8 断言通过** | `evidence-v3-replay.json`；105 候选、10 份实际留存原文；人工严格路由夹具明确标注，不代表模型新判断 |
| 原案例 Python writer 选材回放 | **5 个纳入来源，14,536 个 context JSON code point** | `gptr-v3-retained-source-replay.json`；实际 heuristic 输入。完整流程与披露保留，背景仍只是候选 |
| Python Office 导出测试 | **44 / 44 通过** | `office-export-v3-tests.log`；包括三个原始工具输入与固定字号/分页、依据、原生表格、原子 bundle |
| TS → 实际 LangChain tool → sidecar → TS | **20 / 20 检查通过** | `cross-language-proposal-v3-result.json`；真实字节与哈希校验，当前 exporter 2.1.0；没有运行 DeerFlow 模型规划图 |
| 原始工具输入回放 | **3 / 3 成功** | `office-export-v3-result.json` 与交付 `examples/office-lunch/replay-results.json`；文字、状态、证据与依据输入保持不变 |
| 中文 PPT / Word 实际渲染 | **8 / 8 成功，53 页实际检查** | `office-visual-v3-acceptance.json`；PPT 10 / 10 / 9 / 8 页，Word 四组均 4 页；LibreOffice 和文档渲染器，不是 XML 推测 |
| 真实研究与需求对话组件浏览器检查 | **1440 / 768 / 390 三视口通过** | `research-ui-browser-result.json`；Chrome 155.0.8059.84，实际 Workspace / Intake / 原 CSS、离线 API 与 EventSource fixture；完成三轮自然语言输入、可选上传、刷新、纠正、当前摘要启动及实际 2px 焦点环检查；无登录/SSR/真实上游 |
| 实际导出 HTML 浏览器检查 | **4 / 4 组通过**，各含 1440 / 390 两种宽度 | `office-html-v3-result.json`；标题/表格/锚点、选择、局部横向滚动、CSP 阻止注入脚本，初始页面外发 HTTP 请求为 0 |
| 类型检查 | **通过，exit 0** | `v3-run/typecheck.log`、`research-v3-owned-final-typecheck.log`；后者为非增量全项目检查 |
| 本次修改的 TS / TSX / MJS ESLint | **47 文件通过，exit 0** | `v3-run/lint.log`、`intake-final-lint-scope.json`；源码与测试，浏览器验证脚本另行实际执行；普通本地解析，无临时 NODE_PATH 或新增依赖；空日志代表无诊断，退出状态在本次执行中核对 |
| 正常生产构建 | **通过，exit 0** | `v3-run/production-build.log`；构建并准备 standalone，不是部署，未加入环境密钥 |
| 修改差异检查 | **通过** | `git diff --check` 检查源码、测试和文档；原样运行日志不做空白修正。交付还提供补丁对原始基线的应用校验和文件 SHA-256 清单 |

这些套件有交叉覆盖，**不将行数相加声称独立测试总数**。真实数据库使用本次下载的 PostgreSQL 16.15 本地二进制及随机 loopback 端口，未安装或修改生产服务。

## 二、未通过但已定位为原包已有的问题

`pnpm check:ui` 是全站静态风格规范扫描，与 `pnpm test:ui` 不同。最终结果为 **63 条诊断**，原始附件源码使用同一脚本为 **64 条**；按文件与诊断内容比较，新增 0、移除 1。移除项是这次需求输入框原有的内联样式，键盘焦点已由实际 CSS 与浏览器断言验证。行号随改动移动，不作为新诊断计算。

诊断主要涉及原有页面内联动态样式、图标按钮组件和禁用透明度，跨越其他工作台/画布页面。没有为了让检查显示绿色而修改规则、增加豁免或批量重写无关组件。记录：

- `v3-run/ui-conventions.log`
- `v3-run/ui-conventions-baseline.log`
- `ui-conventions-v3-comparison.json`

这项规范检查仍需单独处理，不能对外宣称“整个仓库全部检查通过”。它不改变本次上述功能测试、浏览器断言与生产构建的实际结果。

## 三、过程中出现的失败如何处理

### 1. 首轮完整前端测试

首轮有 11 项失败。已定位的原因是旧测试未开启新增的默认关闭功能开关，以及 Node 原生 FormData / Office 字节对象被置于 jsdom 环境。

最小修复只调整相应测试前置条件与环境：需要功能开启的测试显式开启，并新增关闭状态断言；原生 API 测试按文件使用 Node；共享 DOM setup 做存在性检查。没有打开生产开关或修改业务行为以绕过断言。随后相关 25 项与当时的完整 659 项均实际退出 0；加入需求对话、交接与执行槽测试后，最终为上表中的 716 项通过。

初次失败和修复回归分别保留在 `v3-run/frontend-initial-failures.log`、`v3-run/test-environment-fixes.log`。未通过的旧结果不覆盖最终结果，也不从记录中抹去。

### 2. 浏览器环境

初始 Chrome 安装的两个文件被截断，浏览器尚未载入页面即退出。逐项核对 255 个包条目并修复 `chrome` 与 `resources.pak` 后，才执行和通过浏览器检查。记录在 `research-ui-browser-initial-launch-failed.*` 和 `research-ui-browser-install-repair.json`。

中文系统字体缺失时，QA 壳使用任务已有的 Noto CJK 回退以便实看文字，没有更改产品 CSS 或在浏览器发出远程字体请求。截图仅用于本地检查，交付提供脚本和结果，不包含浏览器截图、浏览器二进制或字体缓存。

### 3. 最后发现的长表格风险

Python 选择器原来会把长表格交给普通递归分块，可能丢失表头与数字的对应关系。最终改为完整表块候选；超出对应单源预算时，记录原文区间、哈希与遗漏原因，不把部分数字送进 writer。增加两个实际回归，GPTR 最终套件从 31 增至 33 项。

原案例选材的来源集合与所有非空白内容未变。最终 context 从 14,532 增至 14,536，仅因为两个表块各保留了过去分块器去掉的两个原始尾部空格。`gptr-v3-table-context-diff.json` 保存比较记录；未为了维持旧字符数而修改原文。

### 4. 新增数据库测试的清理隔离

加入需求对话事务测试后的第一次完整 PostgreSQL 运行有 181 项通过、9 项失败及一处 teardown 错误。需求对话的 5 项业务断言已通过，但直接删除测试 user 触发 `ResearchProject` 外键约束，遗留测试任务，影响了后续全局容量与领取断言。

修复仅作用于新 intake 与原 runtime 测试的退出清理：按测试专属随机用户和 project 子树，在事务内按外键依赖顺序删除自己创建的数据，再关闭连接。没有放松容量条件、全表清空或改业务代码来掩盖问题。最终两次独立临时 PostgreSQL 重跑均为 **190 / 190 通过**，最后一次含回执 UUID 字段修复。第一次失败原样保留在 `v3-run/research-postgres-intake-initial.log`。

### 5. 需求对话浏览器与提交身份

首轮 intake 浏览器脚本曾因“高级设置（可选）”的 exact 文本选择器没有匹配实际控件而超时；调整为实际语义区域后，三视口均执行至正式开始。初次记录保留在 `research-ui-browser-initial-intake-selector-failed.log`。最终焦点检查读取实际呈现的 2px 外壳焦点环，避免在 CSS 过渡起点误把普通阴影计作焦点。

收尾审查发现，未知 POST 回执若只按“用户原话相同”认领，多标签页相同文字、不同设置或附件会串单。已改为 owner GET 返回最新提交 UUID，前端按 UUID 或已知 task ID 精确认领；旧接口缺字段时保守保留回执，不自动创建新请求。新增两项组件回归，最终完整 UI 从 714 增至 **716**；这是本轮修复的具体状态问题，不是已观测到的生产事故。

## 四、本次没有验证的事情

- 没有使用生产密钥请求 `ai.ldai.us` 或其他付费模型；没有生成一份新的真实自动市场研究报告。
- 没有 Docker 引擎完成整个 research compose 的镜像构建/启动，也没有部署 web/worker/runtime。
- 没有验证真实登录账户、完整 Next.js 认证/SSR 外壳与兼容上游的端到端组合。
- 没有重新抓取案例网页；候选、原文、价格、时间等来自附件留档，不能作为当前市场信息。
- 没有证明模型能正确完成所有语义分流、事实蕴含、跨来源独立性判断或视觉分析。
- 没有证明真实需求访谈永远一次只问一个语义问题，或总能正确理解每次否定与改口；本地合同保证结构与用户原话来源，语义效果仍需真实小样本验收。
- 没有补测思考中间档位、图片、多轮参考图、长上下文窗口或原生压缩。
- 没有在 Microsoft PowerPoint / Word 本身打开文件；不同 Office 渲染器和字体仍可能产生分页差异。
- 没有执行被跳过的 29 项普通聊天数据库测试，或把它们归入已完成的 20 项研究数据库测试。

上线前最小真实验收与回滚条件见 `../CHUGAO_RESEARCH_V3.md`。评审者重组 PDF 是可见的沟通示例，不能把它当作本次已跑通的模型质量 benchmark。
