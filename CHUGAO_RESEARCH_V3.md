# Chugao Studio · Research V3 改造与 Codex 适配说明

> 本文保留外部候选版本的交付记录，不代表当前工作区的实测结果。2026-10-19 本地适配、额外修复、真实调用和未验收项目见 [本地适配记录](docs/RESEARCH_V3_INTEGRATION.md)。

这份交付直接修改本轮提供的源码，目标是让市场与设计研究产生可用的判断、可检查的证据和可继续验证的设计选择。它包含实际实现、离线回放、测试记录及可编辑的 Office 示例，不是另一份待实施架构方案。

**交付状态：本地实现和可执行验证已完成；没有配置生产密钥、调用付费上游或部署。** 具体通过项以 `validation/V3_ACCEPTANCE.md` 为准。模型的真实研究表现仍需在部署环境进行小范围端到端验收。

## 1. 基线与范围

- 用户提供的基线：`chugao-research-v2-pro-review-20261019.zip`。
- 基线 ZIP SHA-256：`1a5be36e53d878d1a3163c966aad35d742ddfd4f5be42ab65e6fa19bdb99576b`。
- 本地修改前的源码基线提交：`82afe41738c542721a3e7703ea7f9d59033e3a82`。它是对附件的本地留档，不代表外部 GitHub 提交。
- 原有 Next.js / React / Prisma / PostgreSQL、研究队列与事件机制、Markdown/GFM、隔离 HTML 预览继续使用。模式选择保留为可选高级设置，主入口改为 LLM 一问一答。
- 没有新增 Prisma 表、修改已有迁移、升级锁定依赖或替换整个研究框架。
- 本次修复研究与产物链路。普通聊天的独立账本、旧聊天接口迁移、长上下文 `ContextSnapshot`、视觉与上游原生压缩能力不在本次已完成项中。

## 2. 最值得先看的变化

### 2.1 前期需求确认改成真正的 LLM 对话

主入口是一个自由输入框。用户直接描述想做什么，助手根据已有对话追问当前最有价值的一个问题；无需先选择模式、深度、人群、竞品或产物。原来的建议答案按钮阵列和字段清单不再占据主流程，模式与深度收进默认折叠的“高级设置（可选）”。附件仍可按需添加；文件内容在正式研究开始后解析，需求对话不会每问一轮就重复提取整份 PDF / Word，也不会把“已收到参考图”说成“已看懂图”。

用户可以自然地说“还不确定，先研究看看”“不考虑宿舍，改为办公室使用”，无需寻找对应选项。信息已经足够时，助手给出几句话概括的需求理解，未知事项保留；主动作只有“开始研究”。具体执行步骤默认折叠，不再要求先审核一份技术计划。这个流程使用实际 `/api/research/intake`、持久任务与现有 Responses 网关，不是浏览器里的固定聊天剧本。

后端每轮用一次模型调用，分开校验简短回应、唯一问题、当前有效用户原话和未知项；不假设兼容上游支持官方 JSON schema，使用现有流协议接收后校验结构。需求摘要在校验完成后显示，不给完整结果加打字动画。一个 `nextQuestion` 字段及格式检查不能证明模型在语义上永远只问一个问题，真实访谈的自然程度仍列为上线前验收。

同时修复了与这一入口直接相关的状态问题：输入纠正立即撤销旧的可开始状态；正式研究绑定用户看到的那次摘要 ID，服务端在创建事务里核对它仍是当前完成的对话并冻结已确认要求；排队或失败的下一轮不会借用上一轮 ready。旧项目迟到的创建、上传、计划或任务响应不能覆盖新草稿。浏览器在 sessionStorage 保存本次原始提交与 UUID；已提交但暂时读不到回复时继续恢复原任务，不擅自再调用模型。未知回执只按任务 ID 或服务端返回的提交 UUID 认领，另一个标签页相同的原话不足以认领本次提交；旧 GET 缺少 UUID 时保留原回执，供用户显式重试同一幂等请求。

需求问答与正式研究使用两个固定的任务执行槽，各最多一个；保留原有按活动任务记账的全局模型调用容量 2，不增加第三个容量槽。长研究不会仅因占着正式研究任务槽而阻止下一轮需求问答领取，但问答仍受共享模型容量和上游真实响应时间限制。数据库中的执行权与容量预留不能证明取消后的远端调用已立即停止，也不保证上游首字延迟；具体边界见 `validation/WORKER_LANES_V3.md`。

需求对话的请求、解析与确认合同见 `validation/INTAKE_DIALOGUE_V1.md`，前端恢复与浏览器检查见 `validation/RESEARCH_INTAKE_V3.md`。服务端用既有 `ResearchBrief.revision` 的递增顺序识别最新一轮，不依赖相同毫秒内的时间戳先后。

### 2.2 从“搜到很多”变为“回答了哪个设计问题”

原链路混淆了两种状态：找到并读到网页，以及该网页真正回答了问题。V3 分别保存：

| 维度     | 状态                                                          | 用途                                     |
| -------- | ------------------------------------------------------------- | ---------------------------------------- |
| 材料采集 | `not_searched` / `searched` / `read` / `unavailable`          | 说明工具走到了哪一步                     |
| 设计问题 | `supported` / `contradicted` / `insufficient` / `conflicting` | 说明当前材料支持什么、缺什么或矛盾在哪里 |

`read` 不再自动消除缺口。核验结果包含原文引述、设计含义、下一步检查和什么结果会改变当前选择。反驳一个命题也可能是有效答案；它不必永远算作待研究。

引用门槛检查证据 ID、保留正文、正文版本、逐字引文、连续原文区间和明确型号锚点。部分支持不能当完整回答；搜索摘要不能当读过原文；另一型号不能回答指定型号的能力。不同正文哈希仅是冲突检查的最低条件，**不能证明来源独立或事实正确**。

### 2.3 研究材料必须服务于选择

每个来源可以标为产品身份、任务观察、约束、替代路径、背景、设计参考或无关。核心角色必须说明对应哪个问题。正式核验后，未完成分流的外部材料保持待核对；不会仅凭关键词分数顶上核心证据。

保留用户指定材料，但不自动判为可信。型号相同的官方页和零售页可以互补字段，不能增加竞品数量。餐车网页可在适当课题中成为设计参考，不能只因为出现“设计”就回答办公室午餐设备的使用问题。

选材优先保留完整操作链、单位、总计、限定条件与受邀披露，去掉常见推荐栏目和导航污染。每个切片都有原文范围与哈希；未纳入的材料记录遗漏原因。识别出的 Markdown 表格保持完整块，超出单源预算时明确省略，不拆掉表头再让数字单独进入报告；未被正文提取器识别的特殊网页表格仍需抽查。

### 2.4 最终报告先给设计判断

新提示与交接包要求连接：材料观察 → 明确标注的解释 → 可画原型或实测的候选与代价 → 下一步检查 → 改变选择的条件。

界面在完整报告前展示持久保存的决策卡与尚未回答的问题。用户可以直接跳到实际证据记录；记录缺失时显示不可用，避免死链接。调用数、费用记录和版本哈希折叠到技术详情，实际阶段、质量状态与关键未知保持可见。

这些卡片从最终冻结包读取，不在浏览器里重新“创作”。旧包没有新字段时仍展示旧报告，不拼接早先阶段的过期卡片。

### 2.5 同一旧输入现在可以完成导出

本轮附件的三个原始 proposal 工具输入均已原样回放。导出器通过测量、分页、复用可见依据编号和附录排版解决空间不足；不会要求模型把 `hypothesis` 改成其他状态来避开导出错误。

PPT 保留原生可编辑文字与表格；主要正文、表格采用固定可读字号，空间不够分页。Word 改善标题、引导段与短表格/流程的分页关系。共享依据以 B 编号展示一次，完整内容仍在可见附录与记录中。所有研究限制与来源保留。

## 3. 已确认的缺陷与对应修复

| 触发条件 / 旧问题                                                                        | 本次实现                                                                                                                 | 代码与验证入口                                                                                                                                     |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| 前期需求仍像表单，旧 ready、迟到请求与新草稿可能串线                                     | 一个自然语言输入框、实际 LLM 单问合同、摘要身份绑定及创建时冻结；前后端都拒绝过期确认                                    | `ResearchIntake.tsx`、`intake-presentation.ts`、`intake-contract.ts`、`intake.ts`、`service.ts`、`confirmed-requirements.ts`；对话、组件、事务回归 |
| 长研究占据唯一任务槽，使下一轮需求问答不能领取                                           | 固定研究槽 1 + 需求槽 1；维护单一节奏，退出中断并等待所有活动任务，保留全局模型容量上限                                  | `worker-lanes.ts`、`worker.ts`、`research.worker.ts`；领取竞争与退出测试                                                                           |
| GPTR 内部需要 JSON，适配层却混入“只输出报告正文”；子 researcher 与 writer 可能丢失原任务 | 纯 query、固定设计角色；在真实模型边界注入 TaskSpec；报告要求仅给最终 writer；内部不合规结果显式失败                     | `services/research-runtime/engine.py`、`design_research.py`、`runtime_contracts.py`；`validation/GPTR_V3.md`                                       |
| 中文词项匹配与网页杂项使有效材料被丢弃或被错误片段替代                                   | 真实执行 CJK BM25 与 SKU 匹配，保留连续原文与披露，限制背景占额；不宣称使用了 embedding                                  | `design_research.py`、`lib/research/quality.ts`、`source-text.ts`；`validation/EVIDENCE_V3.md`                                                     |
| 读过网页就清除未解决事项，无法区分局部支持与完整回答                                     | 采集状态与决策状态分开，逐字引文与版本检查，结构化持久保存                                                               | `lib/research/decision-evidence.ts`、`worker.ts`；相关单测与跨模块审计测试                                                                         |
| 空正文、503、内部吞错或断流时，框架/网关可能隐式再次调用模型                             | 研究网关和锁定 GPTR 模型调用均单次执行，失败保留片段；只允许已有显式重试入口创建新 attempt                               | `gateway.ts`、`runtime_contracts.py`；`gateway.test.ts`、Python 合同测试                                                                           |
| 核验搜索在保存前后中断，恢复可能重复发送                                                 | 发起前保存搜索意图、所属 attempt 和结果；完成的搜索复用；结果不明的步骤仅在显式新 attempt 中可重试                       | `worker.ts`、`workflow-quality.ts`、`decision-evidence.ts`                                                                                         |
| 重新整理报告时，旧稿尚未回答的问题被模型省略                                             | 从校验通过的旧冻结包继承所有 `openQuestions`，和当前缺口精确去重合并；超出原有 20 项容量时显式失败并保留正文，不静默截断 | `mergeOpenResearchQuestions`、`decision-integration.audit.test.ts`                                                                                 |
| 来源角色通过 JSON schema，但直接角色缺少问题 ID，导致后续打包才报错                      | 核验与继承阶段统一调用语义合同验证，非法路由保持待核对                                                                   | `assessDecisionAnswers`、`inheritDecisionState`、`validateEvidenceDecisionRoutes`                                                                  |
| 保存来源内容改变或被清理后，旧“已支持”判断继续当作当前依据                               | 比较正文哈希与原文区间，失配降为证据不足；保留历史引文供检查                                                             | `reconcileDecisionState` 与版本失效测试                                                                                                            |
| 原案例前两次 Office 工具输入因布局拒绝，附录重复且可能形成零散末页                       | 测量原字号并分页，共享依据附录，既有页数内平衡列，Word 分组                                                              | `proposal_export.py`、`PROPOSAL_LAYOUT_2_1.md`、导出回放                                                                                           |
| 客户端加载 server-only 校验代码、来源按钮无真实目标或旧状态混入                          | 类型导入隔离；按实际来源记录导航并在 React 提交后聚焦；旧冻结包优先                                                      | `presentation.ts`、`ResearchWorkspace.tsx`、浏览器/组件测试                                                                                        |
| 原测试未开启被测功能开关，或 Node 原生 FormData / Office 字节测试混用 jsdom              | 明确测试前置开关并补关闭断言；按文件切换 Node 环境；共享 DOM setup 做环境判断                                            | 两项 creative 路由测试、canvas 导出测试、research protocol 测试、UI setup                                                                          |
| pnpm 隔离依赖下 ESLint 找不到 Next 的传递插件                                            | 使用已安装 `eslint-config-next` 的依赖解析目录，无新增包                                                                 | `eslint.config.mjs`                                                                                                                                |

这是对已复现条件的修复清单，不表示所有异常路径或模型行为都已证明正确。

## 4. 确实接入了哪些开源项目

原项目已有的模式调度继续使用：快速探索调用 Vane，研究调用 GPT Researcher，提案制作调用 DeerFlow 与实际 proposal 工具；搜索/采集经过现有服务与网关。V3 没有把几个项目名称放在模式按钮后面却统一用一条自写模型提示冒充集成。

| 项目                                                                                                                         | 本次实际关系                                                                                                                                  | 不应误读为                                                         |
| ---------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| [GPT Researcher](https://github.com/assafelovic/gpt-researcher)                                                              | 使用原锁定 `0.16.1`；本地实际装配、执行研究调度/子 researcher/writer 与真实 LangChain/OpenAI SDK，HTTP 由测试夹具提供；修改现有适配层         | 已完成兼容上游真实模型质量验收，或已启用官方当前文档的所有过滤服务 |
| [DeerFlow](https://github.com/bytedance/deer-flow)                                                                           | 保留原固定提交 `cd0166ae76f8a05d2ef13ce665ec89b37584217f` 与真实工具；本次运行实际 `chugao_create_proposal.invoke`、导出器及 sidecar 读取合同 | 已运行完整 DeerFlow 模型规划图，或已接入当前 main 的全部新能力     |
| [Vane](https://github.com/ItzCrazyKns/Vane)                                                                                  | 保留附件中已有探索引擎与固定镜像构建关系                                                                                                      | 本次重新完成其真实搜索/模型端到端验收                              |
| [Open Deep Research](https://github.com/langchain-ai/open_deep_research/blob/main/src/open_deep_research/deep_researcher.py) | 阅读官方 supervisor、research brief、压缩及最终写作实现，借鉴任务约束贯穿流程与研究有界终止；没有再增加一个执行框架                           | 新增了该项目的运行依赖。该仓库当前已归档，不能称其仍在持续维护     |

取舍依据：GPTR 官方 [Context Filter 文档](https://docs.gptr.dev/docs/gpt-researcher/gptr/context-filter)明确把选材放在搜索/抓取与 writer 之间，强调实际纳入片段的重要性。本次因此先修 writer 真正读到什么，不增加无边界模型数量。没有把官方自有 benchmark 的质量、延迟或价格数字套到 Chugao。

Office 保留成熟的 [python-pptx](https://python-pptx.readthedocs.io/en/latest/api/text.html) 和 [python-docx](https://python-docx.readthedocs.io/en/latest/user/text.html)。当前 Markdown/GFM 的缺陷没有指向必须更换库，故保留已有渲染器，用选择稳定性、真实增量与实际浏览器测试验证修改。

## 5. 新字段与兼容注意

- 需求访谈新结果标注 `contractVersion: intake-dialogue-v1`，另含 `nextQuestion`、`unknowns`、`confirmedRequirements`；GET 的 `resultTaskId` 明确摘要身份，经过所有者鉴权的 `latestClientRequestId` 用于准确恢复提交回执。旧对话文字可读，旧摘要不会伪装成新合同已验证要求。正式任务 `configSnapshot.intakeConfirmation` 在创建事务冻结，不需要新增数据库表。
- 最终包外壳仍为 `schemaVersion: 2`。新写入的 `policyVersion` 为 `design-evidence-v3`，新 reader 同时接受旧 `design-evidence-v2`。
- `decisionGaps`、`decisionRoutes`、`decisionCards` 为新冻结内容的一部分，纳入内容哈希。旧包不补写字段、不重算哈希。
- 核验 planner 为 `decision-gaps-v3`。旧版本 checkpoint 不能伪装为新核验已完成；版本不匹配时只失效对应核验计划。
- GPTR 返回 `runtimeContract: gptr-design-v3`、`writerContextManifest`、`writerEvidenceIds`、`taskSpecHash`、`contextFilter`、`embeddingUsed`。`result.sources` 保持兼容，但它可能包含全部采集材料，不能用来宣称 writer 全部读过。
- TS 引文区间是保留正文的 **UTF-16** 下标；Python writer 区间使用 **Unicode code point**，在 writer context 的来源项标注 `offsetUnit: unicode_codepoints`，manifest 使用同一下标单位并在 notice 中说明。二者都可记录 UTF-8 SHA-256，但区间不能直接混用。
- `X-Chugao-Call-Purpose`、`X-Chugao-Task-Spec-Hash`、`X-Chugao-Context-Hash` 仅作为日志关联信息，网关剥离后再请求兼容上游。不能赋予认证、模型选择、强度或预算权限。
- 研究上游仍通过已存在的 Responses 适配；SDK 的 Chat Completions 外观属于内部兼容边界。HTTP 心跳是空活动消息，不产生正文。框架 JSON 规划与评估不会冒充最终报告持续出字。
- 正文增量与完成校正继续使用应用现有事件机制；SDK 兼容流遇到无法以尾部补齐的最终正文差异会显式失败，不通过重新调用上游掩盖。
- 不猜测兼容上游上下文窗口。TS/Python 的 32,000 字符级材料预算属于应用限额，不是 token 窗口或模型能力证明。

## 6. 原案例回放与示例的边界

真实留档输入含 105 条候选、10 份原文。当前 TS 与 Python 选择器均实际处理了这些留档，没有重新搜索、抓取或调用模型。

Python writer 选材回放纳入 5 个来源，序列化 context 为 14,536 个 Unicode code point。九阳原文的三段操作、约九分钟总计和受邀披露被保留；两个 MR9086 页面保持同型号产品身份材料；另有限额背景候选。该结果证明选材与任务传递真实发生，不能据此认定所有来源已经语义核实。

TS 的严格路由回放包含明确标注的人工审核夹具，用于验证数据合同；传给 Python 的候选回放则是实际 heuristic 输出。不可把手工夹具通过率写成新模型的分流正确率。

交付提供两类 Office 内容：

1. `original-input-1/2/3`：三个原始模型工具输入不改文字、状态、证据 ID 或依据，重新运行导出器。原第 3 份完成产物由 12 页 PPT / 5 页 Word 调整为 9 / 4，仍保留七个原章节及完整附录。
2. `reviewer-curated`：明确标注的评审者重组示例，以同一旧冻结材料演示更好的比较与验证任务。8 页 PPT / 4 页 Word，不是新一轮自动市场研究，不加入虚构访谈、实物测试、市场规模或视觉分析。

可编辑 PPTX、DOCX、HTML、导出 manifest、输入哈希和便于查看的 PDF 均在交付包 `examples/`。PDF 是本地 LibreOffice 渲染预览；不替代 Microsoft Office 与部署字体下的最终检查。

## 7. Codex 适配的最小顺序

### 第一步：先核对版本，保留现在的项目改动

比较本项目与上述附件基线。完整源码在 `source/`，差异在 `changes/research-v3.patch`。只在基线相符或已逐项解决冲突后应用。已有其他改动时应逐模块适配，不能直接覆盖整个线上目录。

先纳入新的纯函数与合同：`decision-evidence.ts`、`research-prompts.ts`、quality/source-text、workflow-quality；再纳入 worker、gateway、internal route。前后端 reader 必须与字段同时更新。

### 第二步：更新实际 runtime 与导出器

合入 Python runtime 文件、`Dockerfile.gptr`、proposal exporter/schema/skill 和测试。**新 helper `design_research.py` 已在 GPTR Dockerfile 的 COPY 中，不能漏掉。** GPTR helper 在 `gptr()` 分支内延迟导入，DeerFlow 镜像无需复制它。

保留原锁定依赖。当前改造针对 GPTR `0.16.1` 的实际引用与函数合同，升级时必须先复跑，不应静默兼容。GPTR、DeerFlow 的 Office 工具指令与导出器应同批更新，避免新排版器配旧的模型修复规则。

### 第三步：更新已有研究页面

合入 `presentation.ts`、`ResearchWorkspace.tsx`、`ResearchIntake.tsx`、`intake-presentation.ts` 及对应测试；同时合入 intake API、单问合同、确认快照与 worker 两槽调度。保留既有任务、事件、来源与下载 API。不要把离线 UI fixture 放入线上请求数据，也不要用示例文字代替实际模型输出。

有需求对话历史的新研究提交必须携带当前摘要的 `intakeTaskId`，旧页面缺少该字段会收到明确的更新提示；因此 web 与 worker 要同批更新，不能只替换前端文案。没有 intake 历史的旧直接 API 请求保持可用，但来源不明的草稿字段不会被标成用户原文确认。旧包读取与重新制作沿用其冻结要求。

### 第四步：本地验收后再灰度

先执行下一节的本地命令与合同回放。随后使用管理员访问范围做真实小样本验收，先研究、再导出，逐项核对 trace、原文、版本和结束状态。不能仅凭页面出现“已完成”就开放给所有用户。

## 8. 复跑命令

在 `source/` 目录，先按已有项目方式配置本地开发环境。不要为离线测试复制生产 `.env` 或密钥。

```bash
pnpm install --frozen-lockfile
pnpm db:generate
pnpm typecheck
pnpm test:ui
pnpm test:chat
pnpm build
node --import tsx validation/replay-evidence-v3.mjs
```

真实数据库回归使用已有脚本创建随机临时库并在 finally 中删除。明确指定可创建测试库的本地 PostgreSQL，不用生产连接：

```bash
RESEARCH_TEST_DATABASE_URL=postgresql://LOCAL_TEST_USER:LOCAL_TEST_PASSWORD@127.0.0.1:5432/postgres \
  node scripts/test-research.mjs
```

Python 在安装原锁定 runtime 依赖的 Python 3.12 环境运行；具体版本和 `pip --target` 场景见 `validation/GPTR_V3.md`：

```bash
PYTHONPATH=services/research-runtime/tests CHUGAO_TEST_ARTIFACT_DIR=validation \
  python3 -m unittest -v test_design_research test_runtime_contracts
RESEARCH_ENGINE=gpt-researcher python3 services/research-runtime/check-runtime.py
python3 validation/replay-gptr-v3.py
python3 -m unittest discover -s services/research-runtime/tests -p test_proposal_export.py -v
python3 services/research-runtime/tests/export_office_lunch_case.py --output output/v3-office-replay
node --import tsx validation/cross-language-proposal.mjs
```

Office 渲染和真实浏览器脚本需要本机安装对应工具；参数见 `PROPOSAL_LAYOUT_2_1.md` 与 `validation/RESEARCH_UI_V3.md`。测试产物用新目录，不能为了截图修改已发布的同哈希不可变 bundle。

## 9. 上线和回滚最低条件

本包没有部署动作，也没有替用户做后台开关修改。当前源码 `research.config.enabled` 在缺失配置时默认 **true**，不能把“未配置”误当关闭；Sol 独立模型开关也不能代替研究总开关。

1. 通过已有管理员配置保留整份配置并显式设 `enabled: false`。创建任务与 worker 领取会停止；已经在执行的任务继续由当前版本收尾。管理员 PATCH 是整份配置校验/写入，不要仅提交一个字段导致其他配置回落默认值。
2. 检查活动任务及 runtime 的 run 是否已进入终态，再停旧进程。现有 worker 收到停止信号会 abort 活动任务，不能把直接重启描述为优雅排空。本次没有新增 drain CLI。
3. 在备份既有数据库与保留文件后，同批更新 web、research worker、GPTR runtime、DeerFlow 导出器和 skill。旧 queued 任务须按其版本核对处理，不能强改为完成或盲目自动重放。
4. 先验证健康检查、worker 心跳、旧 V2 包读取与下载；再用管理员完成一个真实 V3 研究与一个从旧版本重新制作的任务，验证 trace、SSE、决策缺口、文件与哈希。
5. 出现失败时停止新任务，保留事件、引用、部分正文、原始包和用量记录。回滚到纯旧 V2 reader 可能拒绝新的 `design-evidence-v3` 包，因此回滚版本需保留新 reader 兼容层，或暂时停用研究入口并保留数据。不要改哈希、删新字段伪装旧版本。
6. 原普通聊天 0.2 积分结算与预留账务未在本次修改。研究网关每次实际调用独立记录，显式重试仍受累计预算；“研究失败”不能推导为“上游没有成本”。不能通过回滚 SQL 凭任务状态猜测并批量退还既有聊天预留。

## 10. 最小真实端到端验收

以下是部署前待执行项目，不属于本次通过记录。保留现有已验证的兼容上游配置，不因官方文档存在某能力就默认可用。每项保持其他变量相同，不同时更改强度、模型、工具参数与预算。

| 次序 | 固定基线与单一变化                                                            | 必须看到的证据                                                                                                                    |
| ---- | ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| 0    | 只做需求访谈：自由描述 → 一个关键追问 → 自然语言纠正 → 不确定先研究           | 每轮真实单次 Responses 请求；不要求填表/选择模式；不重复已答事项；撤销项不进入当前确认，未知不编造成事实；开始按钮对应当前摘要 ID |
| A    | 一个中文设计课题，给定公开原文与明确设计问题；先走标准研究、固定当前 Sol 配置 | 真实 GPTR 调用经过网关；TaskSpec、实际 writer manifest、原始 body 哈希可对齐；阶段终态真实，不只看框架“research done”             |
| B    | 同 A，仅改为同一案例的一个短单变量问题                                        | 来源路由与核验回答对应新问题；型号、单位、总计、披露不被错误替换；不是把用户要求复述成发现                                        |
| C    | 同一已完成冻结包，只重新制作                                                  | 不产生新 search/crawl；旧 openQuestions 全部保留；三个文件格式及 manifest 校验通过                                                |
| D    | 同一任务，仅改变浏览器连接：中途断开并重连                                    | 不增加上游调用；快照/游标恢复同一个 attempt；无重复正文或过期卡片                                                                 |
| E    | 在测试代理仅注入一次 writer 部分 SSE 后失败                                   | 保留可见片段，最终失败，调用只发生一次；下一次必须由显式重试触发，不重复之前已完成的搜索                                          |
| F    | 同一引用原文仅改变正文版本                                                    | 旧路由/引文不能继续当作当前支持；界面保留待核对问题，重新整理不洗掉未知                                                           |

联网等待 21～30 秒后集中输出是已观察过的兼容上游行为。前端可以显示真实阶段、耗时与已归档材料，不能保证持续出字，也不能用非流式结果补一个打字动画。

中间思考档位、视觉、多轮参考图、长上下文、原生压缩均未在本次补测；low/max 请求成功不能证明强度实际执行。所有最终材料仍需抽查语义支持，不能把引用存在性、版本匹配或测试通过率当作市场研究正确率。

## 11. 交给 Codex 的任务说明

> 请基于当前 Chugao Studio 分支适配此包，对照附件基线与 patch 保留项目已有改动。先合入纯合同、证据选材和测试，再合入对话式需求入口及其确认快照、worker/gateway、Python runtime/exporter、前端读取。需求确认必须 LLM 一问一答，不恢复为表单或必选的模式按钮；保留每类一个的受限执行槽与原有模型容量限制。保持真实 SSE、显式重试、已有访问权限和累计预算，不引入隐藏的模型修复重试。不要升级锁定框架或改变已有聊天收费规则。旧冻结包保持原内容与哈希，新 reader 兼容 V2/V3。运行本地与临时数据库验证后，按“上线和回滚最低条件”更新所有相关进程，只在管理员范围做真实上游验收；如无密钥或运行环境，明确列出未执行项，不宣称部署或模型质量已通过。示例与测试 fixture 不得进入线上生成路径。

完整模块验证说明分别在 `validation/GPTR_V3.md`、`validation/EVIDENCE_V3.md`、`validation/RESEARCH_UI_V3.md`、`services/research-runtime/PROPOSAL_LAYOUT_2_1.md`。当前汇总结果在 `validation/V3_ACCEPTANCE.md`。
