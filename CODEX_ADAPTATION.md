# Chugao Studio · Research Quality V2

这是一份基于本次所附 Codex 案例源码直接修改的、本地可适配候选版本。
目标是修复材料进入研究、研究进入提案以及文件交付过程中的具体质量缺口。
生产环境尚未部署，本版没有发起新的真实付费模型研究。

## 先读这三个文件

1. 本文件：改动目的、代码入口、适配顺序与保留边界。
2. `validation/VALIDATION.md`：实际运行结果、失败对照和未完成项目。
3. `services/research-runtime/PROPOSAL_V2.md`：提案内容、来源、附件、假设及原子文件清单的协议。

完整源码在交付包的 `source/`。`changes.patch` 相对于本次导入的原始源码快照生成；
`BASELINE.json` 和 `MANIFEST.sha256` 记录来源、改动文件与文件校验值。
本地基线 commit 是 `12e5b18b0c53500f183b444509cc08f5e94bc25f`，它是本次评审创建的
快照标识，不是用户线上仓库或第三方开源项目的 commit。

## 1. 保留了哪些已做好的部分

继续使用当前 Next.js、React、TypeScript、Prisma/PostgreSQL、Redis 和 Docker 工程。
研究任务、阶段、尝试、持久事件和上游网关均保留。原对话、图像生成和计费模块没有改动。
研究区域仍沿用当前管理员访问限制；当前研究任务本身不扣积分，不能把聊天的 0.2 积分
规则自动套到深度研究上。

模式入口继续复用现有选择：

| 入口               | 实际执行角色                                 | 本版重点                                           |
| ------------------ | -------------------------------------------- | -------------------------------------------------- |
| 探索               | Vane + 统一检索/采集网关                     | 保留快速资料探索，后续仍经过研究整理               |
| 系统研究           | GPT Researcher + 可选采集/核验 + Chugao 整理 | 短搜索问题、噪声筛选、预算预留、真实材料清单       |
| 提案               | 研究完成后由 DeerFlow 调用受控文件工具       | 只消费当前终稿包，统一内容导出多格式               |
| 基于已完成研究制作 | 读取所选研究的 V2 终稿包                     | 固定版本；缺少新协议的历史任务明确阻断并保留原结果 |

这次融合的是不同组件各自擅长的工作，以及统一的研究质量约束。项目名仍对应真实 SDK、
源码或自建服务调用；本地夹具不会被接入线上流程当作真实研究结果。

## 2. 具体修改及代码入口

### 2.1 材料筛选与阅读上下文

`lib/research/quality.ts`、`lib/research/tools.ts`、`lib/research/storage.ts`

- 将整个 brief 转成目的明确的短搜索计划；保留短而明确的用户检索词、型号及搜索操作符。
- 对候选链接进行可解释的词项/文档形态分流，记录 keep/review/reject 及理由。
  它是检索分流规则，不能证明页面真实、权威或与结论存在语义支持关系。
- 搜索摘要、真实网页正文、用户提供的已抽取文字、未读图片分别保留身份。
  `attachment:` 只有可信数据库 `provided` 记录且有实际正文时才能成为用户文字资料。
- 已有正文不会因后续截图或采集失败被降级覆盖。缓存读取失败不再被解释为“原网页为空”。
- 对实际文本选择相关段落，按来源和内容去重，并把序列化元数据计算在应用字符预算内。
- 保存完整 `contextManifest`：全部来源是否纳入、留档字符数、纳入字符数、省略原因。
  模型实际收到的节选还带来源身份、内容类型和原文 UTF-16 区间。
- `fetchedAt` 明确是抓取时间，不充当原文发布日期或当前价格有效日期。

32,000 字符是应用阅读材料预算，不是模型上下文窗口，也不是 token 计数。
上下文之外的 brief、系统说明和先前阶段文本仍占模型输入；真实长上下文能力需要单独验收。

### 2.2 阶段预算、核验计划及并发

`lib/research/workflow-quality.ts`、`lib/research/budget.ts`、`lib/research/worker.ts`

- 按阶段设置累计调用上限，为后续核验、整理和制作留下容量。
  produce 最低预留 3 次模型循环，用于读包、调文件工具和结束；这不是复杂提案完成保证。
- 核验 checkpoint 绑定 brief、研究原稿、规划器版本与问题版本。
  旧 checkpoint 或输入变更会重新规划核验，不复用已错位的问题。
- 问题必须有与课题有关的词项或已读材料中的精确型号锚点；近似前缀不能冒充同一 SKU。
- 保存已搜索问题与选中的来源 ID，继续核验时可使用已保存结果。
  只有实际读到、且进入最终核验上下文的原文才解除“未取得材料”状态。
  这一步不等于核验结论已被证实。
- LLM/crawl 全局领取采用事务容量锁 → task 行锁，ReadCommitted 下获锁后重新计数。
  被容量拒绝的调用不增加预算、调用记录或 started 事件。

并发锁约束数据库中记录的运行中调用。浏览器取消、网关中止与外部服务真正停止之间仍有
传播时间，不能把它表述为外部服务的物理请求绝不重叠。

### 2.3 唯一终稿包

`createFinalResearchPackage`、`readFinalResearchPackage` 与 `worker.ts` 的 synthesize/produce

包内包含报告、原始用户需求、候选路线、假设、竞品记录、限制、质量状态、实际证据节选及
上下文清单。报告与整个包分别有内容 hash；生成时间不改变内容版本。

提案阶段只读取这个包及同版本投影，不再拼接早期探索文本、被后续否定的假设或任意截图。
观测/有支持的元数据必须引用本次实际纳入的原文 ID；只给一个合法 ID 仍不构成事实验证。
未取得相关原文时生成明确的程序状态文档，保留需求与缺口，不调用模型补写市场事实。

质量状态 `insufficient / draft / supported` 是材料门槛。界面将其与“执行完成”分别展示；
`supported` 的文案仍要求核验，旧任务没有质量信息时显示“未评估”。

### 2.4 可编辑提案与原子交付

`services/research-runtime/proposal_export.py`、`chugao_tools.py`、
`lib/research/artifact-contract.ts`、`lib/research/artifacts.ts`

- PPTX、DOCX、HTML 共用结构化内容树；提供概览、比较、流程、取舍和证据布局。
- PPTX 使用原生表格与可编辑形状；DOCX 使用原生表格。
- 原始需求、观察、建议、未验证假设、未知项分别标识。独立论断 `ProposalClaim` 使用假设时，
  必须匹配保留假设的 ID、标准化后的原文与依据，且该假设未被否定。比较表行和流程步骤
  检查保留 ID、显式依据及带单位数字的来源，不进行整行原文/依据完全匹配。
  这些是来源和协议检查，不是对整段论述的语义证明。
- 各格式保留限制说明和真实引用。文字附件显示“用户材料记载”，不生成不可访问的附件链接。
- 先生成并复读所有文件，发布带 hash 的 bundle，再原子切换有效清单。
- 应用检查所需格式、固定文件名、终稿版本、真实引用 ID、大小及 SHA-256，下载全部通过后
  用同一事务发布整组提案。远端结束不立即等于文件交付成功。
- COMMIT 确认丢失时重新取得任务行锁、复查文件引用；无法确认结果则保留字节供对账。
  本版没有新增自动清理所有孤立文件的后台任务。

内容过密会要求拆分或失败，不通过无限缩小字体掩盖问题。当前没有自动制作概念渲染、
验证后的竞品图板或任意统计图表。网页截图保留为资料留档，不标称视觉研究。

### 2.5 流式与开源框架边界

`services/research-runtime/engine.py`、`runtime_contracts.py`、
`components/research/ResearchWorkspace.tsx`、`lib/research/presentation.ts`

- 保留真正的模型增量与最终替换校准；等待期间呈现实际阶段、活动和耗时。
- 不把 DeerFlow 辅助记忆/总结的裸模型流显示成用户报告。制作时显示真实工具活动；
  文件确认来自实际导出清单。
- 客户端验证连续事件序号与 activeAttemptId；断档拉快照，旧尝试的事件不能追加到新尝试。
- 等待计时不会让整篇 Markdown 每秒重渲染。继续使用已有 react-markdown/GFM。
- 研究报告预览删除脚本与事件属性，使用 `script-src 'none'` 和无额外权限的 iframe sandbox。
  这对应本版静态提案导出；普通对话的 HTML 预览没有改动。实际浏览器网络与交互仍待验收。
- GPTR 适配真实 completion helper，关闭其外层重复调用；DeerFlow 同时配置 SDK
  `max_retries=0` 和框架 `llm_call.retry_max_attempts=1`。
  应用网关原有的、计入预算的有限重试策略保留，不能宣称全工程完全没有自动重试。

这些改变提供更清楚的反馈，不会把联网前 21–30 秒等待变成持续出字，也不会证明兼容上游
执行了用户选择的推理强度。

## 3. 原案例的可复现改进

`validation/replay-quality-evidence.mjs` 可以直接使用包内夹具运行；若提供本次案例解压目录，
则使用全部原始留档正文。

完整案例离线回放使用 55 条来源记录、10 篇已抓取正文。此前插入顺序打包让 Ochama 的
99,701 个清洗后 UTF-16 字符一个也没有进入该上下文；新聚焦打包纳入 1,970 字符，包含
650W 和历史价格片段，整个相关输入为 18,773/32,000 字符。17 条文档形态噪声被分流省略。

这些数字只说明本地材料选择发生了什么。没有新抓取网页，没有确认价格仍有效，也没有
把聚合页变成官方原文。原案例质量仍是 `insufficient`，历史报告对其原始 55 个 ID 的引用
成员检查没有发现虚构 ID；新选择没有纳入的旧 ID 不能倒算成当时的伪造引用。

## 4. 给 Codex 的最小适配顺序

### 第一步：对齐最新源码

先对比这份基线与待适配仓库，尤其是 worker、research gateway、ResearchWorkspace、
数据库字段和 Python sidecar。若目标就是本次附件的源码，可先运行：

```bash
git apply --check ../changes.patch
```

路径根据解压位置调整。检查通过后再应用；如果目标仓库已经变更，按模块迁入并保留已有
修复。不要用整目录覆盖线上配置、上传文件、密钥或用户数据。

### 第二步：先迁入材料、终稿与导入协议

先合入 quality/workflow-quality、worker、tools、storage、artifacts 和 artifact-contract。
同时合入对应测试与 Python V2 exporter/runtime helper。TypeScript 与 Python 的终稿、
附件、限制长度、文件名和版本规则必须一起更新。

本版没有新增 Prisma schema 或 migration；利用已有 ResearchStage.result、证据和产物表。
全源码中包含基线既有的 19 个迁移，测试验证的是它们对独立临时库的执行。目标环境若还没
应用基线迁移，应按自己的迁移台账处理，不能把本次测试视为生产库已经升级。

### 第三步：迁入 UI 与真实 sidecar

迁入 ResearchWorkspace/presentation 的状态展示和事件身份处理，更新两个 Python
Dockerfile 对 runtime_contracts.py 的 COPY。实际部署必须重建 GPTR/DeerFlow 镜像；
只替换 Next.js 不会更新 Python 导出器或模型重试边界。

保持 `/app/research` 的管理员灰度入口。模型配置继续走现有管理界面，密钥留在网关，
下游只拿当前 attempt 的令牌。浏览器无法直接调用未授权的模型推理入口。

### 第四步：复跑本地检查

```bash
pnpm install --frozen-lockfile
pnpm db:generate
pnpm build
pnpm exec tsc --noEmit --incremental false
node --import tsx validation/replay-quality-evidence.mjs

# 以下地址必须是专用本机测试 PostgreSQL。
# 脚本会创建随机数据库、执行迁移、运行 mock 上游测试并删除随机库。
RESEARCH_TEST_DATABASE_URL=postgresql://TEST_USER@127.0.0.1:TEST_PORT/postgres node scripts/test-research.mjs
CHAT_TEST_DATABASE_URL=postgresql://TEST_USER@127.0.0.1:TEST_PORT/postgres node scripts/test-chat-turns.mjs

node node_modules/vitest/vitest.mjs run --config vitest.chat.config.ts
node node_modules/vitest/vitest.mjs run --config vitest.config.ts components/research/ResearchWorkspace.test.tsx lib/research/presentation.test.ts
```

全新解压目录先构建，以生成 Next.js 的环境声明和路由类型；包中不包含 `.next` 缓存或
`next-env.d.ts` 等由框架生成的本机文件。

Python 导出与运行时测试见 `validation/VALIDATION.md`，使用对应 sidecar 的 Python 环境。
Windows/macOS/生产容器不应照搬本次 Linux 验收解释器的绝对路径。

### 第五步：做有明确预算的小型真实验收

先在测试项目、明确请求上限和默认已验证配置下跑一次材料研究；记录应用发起的实际请求
次数、完整事件类型、正文何时开始、使用的材料清单和所有错误。再基于这一个 V2 包制作
文件、只重试失败的制作阶段，比较研究正文、包版本和来源 ID 是否保持一致。

最低实测场景：

| 场景                                | 应观察到的结果                                                 |
| ----------------------------------- | -------------------------------------------------------------- |
| 一个范围明确的市场研究              | 搜索问题紧扣设计决策，核验有剩余额度；事实、假设和空缺清楚区分 |
| 搜索只有摘要或全部失败              | 保留诊断并标材料不足，不能输出伪装成有充分来源的结论           |
| 一份文字附件 + 一张参考图           | 文字以用户材料使用；未经视觉模型读取的图片仍标未分析           |
| 部分输出后 `response.failed` / 断流 | 保留片段及失败状态，不能冒充完成的研究或已交付文件             |
| 提案失败后显式重试                  | 只重新制作，研究及终稿版本不变；无旧假设回流                   |
| 刷新、多标签页、旧尝试事件延迟      | 快照和事件对齐，正文不重复，旧尝试不污染当前内容               |
| PPTX/DOCX/HTML                      | 内容、引用、限制一致，可编辑；PPT/DOCX 实际打开检查所有页面    |

真实 Sol 的复杂工具循环、严格结构化输出、长上下文、视觉、原生压缩和中间强度仍需逐项
实测。官方 API 文档和开源框架能提供协议参考，但不证明当前兼容服务支持其全部功能。

## 5. 历史任务、更新与回滚

- 历史报告、文件和证据保持可读，缺少 quality 字段时显示未评估。
- 旧的已完成 synthesize 没有 V2 包时，新的 produce 会返回 `FINAL_PACKAGE_REQUIRED`。
  当前既有重试入口针对未完成阶段，不能假装它已经支持“重做已完成的整理阶段”。
  若需要复用历史案例，Codex 应补一个显式的新整理任务/迁移工具：保留旧任务，只使用选定
  报告与留档材料创建新的草稿包，再制作文件；保持新的来源追溯和调用预算。
- 升级前关闭新研究提交/领取，记录在途任务、attempt、remoteRunId、游标和调用计数，
  等待任务结束或显式停止并确认终态。保留所有 research volumes、证据、产物和数据库。
- web/worker 与 GPTR/DeerFlow sidecar 使用同一发布版本。已有远端运行不要混入另一版本
  的导出协议；版本不匹配时保留旧结果并明确失败。
- 回滚时先停止新任务与新 worker，确认没有继续发布的在途任务，恢复对应 web/worker
  和 sidecar 镜像。无需删除本版 JSON 元数据。保留文件引用对账记录与未知提交结果。
- 本版没有研究积分预留或扣费变更，因此没有新增研究余额回滚。若要给研究收费，需要
  单独定义价格、预留、取消和失败策略，并复用当前可信账本边界。

## 6. 仍需保持的判断边界

1. 词项排序、来源存在和内容 hash 检查解决材料管理问题，不能替代论断与原文的语义核对。
2. 自动材料门槛不证明市场结论正确，仍需要具体型号、可比较条件、原始用户证据和反证。
3. 文字附件与外部独立来源不同；参考图顺序、视觉理解及概念图生成不在本轮已验证能力内。
4. 导出 HTML 结构和研究预览的 DOM 清理、CSP 字符串及 sandbox 属性已检查，但本环境没有
   完成实际 Chromium 安全/交互验收。保留的浏览器脚本针对离线导出文件；主站预览 iframe
   还应在可用浏览器上独立检查导航、网络限制、复制、选择与缩放。
5. 本地没有 Docker daemon，因此整套容器构建和容器网络未在本轮端到端跑完。
6. 全量 UI 套件保留了在未修改基线可复现的失败，详见验证记录；不能宣称全套测试通过。

## 7. 实际项目来源

| 项目                      | 本版来源/固定版本                                                                     |
| ------------------------- | ------------------------------------------------------------------------------------- |
| GPT Researcher            | https://github.com/assafelovic/gpt-researcher · Python 0.16.1                         |
| DeerFlow                  | https://github.com/bytedance/deer-flow · `cd0166ae76f8a05d2ef13ce665ec89b37584217f`   |
| Crawl4AI                  | https://github.com/unclecode/crawl4ai · Python 0.9.5                                  |
| Vane                      | https://github.com/ItzCrazyKns/Vane · `348feca3e378fb4157b217724ed508dc707f853f`      |
| SearXNG                   | https://github.com/searxng/searxng · compose 中固定镜像 digest                        |
| python-pptx / python-docx | https://github.com/scanny/python-pptx / https://github.com/python-openxml/python-docx |

包内离线 PPT/DOCX/HTML 用来评估真实导出结构和版式，不是本轮新完成的市场调研报告。
# 本地适配记录

本文件保留候选包原交接说明。2026-10-19 在当前 Chugao 仓库执行的适配、Docker、浏览器和真实调用结果，
以 `docs/RESEARCH_QUALITY_V2_INTEGRATION.md` 为准，不要把下文候选环境的未验证项或历史测试数当作本机结果。

