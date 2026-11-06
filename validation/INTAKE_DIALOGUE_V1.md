# 自由对话式需求确认：后端合同与验证

本次沿用已有需求澄清任务、PostgreSQL 历史、worker、Responses SSE 网关和事件恢复。已有 intake 本身就会调用模型，本次修复的是单问题输出合同、用户原话来源、旧摘要误用和正式研究的确认版本绑定。没有用关键词分支或固定问卷代替 LLM。

## 请求与恢复

`POST /api/research/intake` 仍返回 `{taskId, projectId}`。先保存用户回答并排队，再由 worker 调用模型。旧的完整 `ResearchPlanInput` 请求保持兼容；新请求可以只带：

```json
{
  "projectId": "已有且属于当前用户的项目",
  "clientRequestId": "11111111-1111-4111-8111-111111111111",
  "previousTaskId": null,
  "answer": "我想研究办公室午餐设备，不知道具体应该选哪种形态。"
}
```

之后每轮携带当前 `previousTaskId`。对话历史从数据库按项目重建，不能由浏览器提交伪造的 assistant/system 历史。未提供的设置从当前项目草稿继承或采用应用默认，不作为用户已确认要求。单字回答也可进入 LLM 澄清。

可选 `intent: "prepare_research"` 表示用户明确要求按现有信息整理摘要，要求模型返回 ready，允许未知保留。默认 `continue` 下，“先开始”“不知道，你来建议”等自然语言仍由模型结合完整历史理解，没有本地关键词脚本。

重复 POST 使用同一个 `clientRequestId`。薄请求的原始规范化请求哈希保存在任务回执中；重发时先返回已接受任务，不按后来变化的草稿重新创建。请求内容改变但复用 ID 返回 409。服务端原有 User 行锁、`previousTaskId` 检查、活动轮次限制继续生效。

`GET /api/research/intake?projectId=...` 继续返回 task、messages、result、settings，增加 `resultTaskId`。只有最新一轮 completed 时才返回该轮 result；最新轮 queued、failed、cancelled 等状态下 `result=null`、`resultTaskId=null`，旧对话文字仍保留。前端不能把较早的 ready 摘要当作当前确认。

经过项目所有者鉴权的 GET 另返回 `latestClientRequestId`，用于与浏览器保存的完整提交 UUID 精确匹配。相同原话不能证明两个标签页提交了相同附件或设置；未知 POST 回执不能仅凭 answer 相同被认领。旧接口没有该字段时，前端保留原 UUID 供用户显式幂等重试。

历史重建、上一轮校验与正式启动的最新摘要检查，都按现有 `ResearchBrief.revision` 排序。这个项目内唯一递增版本在原 User 行锁内分配，避免同一毫秒的 `createdAt` 无法确定轮次先后；不新增排序表。

## 一次模型调用，一条自然问题

worker 通过已有 `researchModelCall` 使用当前配置的 Sol Responses HTTP SSE 链路，`purpose=intake.dialogue`。不增加搜索、crawl、工具或模型修复调用。不依赖兼容上游未验证的 structured-output 参数：模型按提示返回 JSON，应用检查本地合同。

intake 不执行附件提取或图片视觉识别，只接收附件清单与已经存在的 `brief.selectedContext` 等上下文。上传成功不表示本轮模型已阅读 PDF、图片或附件正文；正式研究阶段才准备和提取这些研究输入。模型提示也明确区分“已收到附件”与“已阅读内容”，不借访谈阶段暗中增加文件抓取调用。

模型结果拆为 `acknowledgement`、`nextQuestion`、`ready`、`summary`、`unknowns`、`confirmedRequirements`、`products`、`brief`。应用保存的结果包含：

```json
{
  "contractVersion": "intake-dialogue-v1",
  "reply": "模型的简短回应与唯一问题，或 ready 时的简短摘要",
  "nextQuestion": "目前最想改善的是哪一步使用体验？",
  "ready": false,
  "summary": "当前理解",
  "unknowns": ["具体型号尚未确定"],
  "confirmedRequirements": ["用户当前仍有效的原话完整句子。"],
  "suggestions": [],
  "products": ["report", "brief"],
  "brief": {
    "question": "完整研究目标",
    "market": "",
    "audience": "",
    "timeRange": "",
    "constraints": "",
    "competitors": [],
    "links": []
  }
}
```

非 ready 结果只允许一个 `nextQuestion` 字段、一个结束问号，acknowledgement 不追问；ready 时 nextQuestion 必须为 null，展示 summary。模型提示禁止把多项问卷合并在一句里，不要求选择引擎或模式。标点与结构检查能拒绝明显多问句，不能证明任意自然语言问题在语义上都足够聚焦，仍需真实模型小样本验收。

未知项不阻断 ready。地区、价格、竞品和时间可以保持空白；模型建议必须明确标为建议。用户已经给足信息时直接返回 ready，不机械增加访谈轮数。

## 用户原话与正式启动版本

应用草稿、默认设置和模型建议放在独立系统上下文中，实际用户对话保持原始角色，不把草稿伪装成用户消息。

`confirmedRequirements` 必须逐字对应实际用户消息或完整句子，保留否定、条件与单位；不能只截取“不要预算 100 元”中的“预算 100 元”。纠正和撤销的语义由 LLM 结合历史整理，应用不把所有旧用户句子同时标为当前约束。原文校验能拒绝助手建议和来源不明的改写，但不能独立证明模型已正确理解所有撤销、指代或复合约束。

正式研究仍由独立的 `POST /api/research/tasks` 用户动作发起，模型 ready 不自动执行研究。项目已有 intake 历史时，该请求必须携带当前展示摘要的 `intakeTaskId`。服务端在原有事务 User 行锁下检查：

1. ID 就是当前项目最新 intake，不能移除字段绕过。
2. 最新一轮 completed 且 ready；正在回复或已失败的纠正不能回落旧摘要。
3. 新合同的 brief 子集与正式研究实际 brief 逐字段相同。
4. 当前确认要求可在真实用户历史中找到完整原话。

通过后写入不可变的 `configSnapshot.intakeConfirmation`：

```text
{taskId, contractVersion, brief, confirmedRequirements}
```

worker 读取这份创建时快照，不因开始执行前又出现新一轮对话而改变已接受需求。纯函数 `confirmedIntakeRequirements` 负责写入前的原话和 brief 检查；`readIntakeConfirmationRequirements` 只读取应用已经验证并冻结的结构，不假装重新证明来源。

无 intake 历史的旧正式任务 API 仍可用。旧 intake 结果可读取，具备 ID、completed、ready 后也可用于启动；其缺少新原话合同的内容保存为 `legacy-unverified`，确认数组为空。复用指定历史研究的 `sourceTaskId` 路径继续以被选版本为依据。

**迁移边界：**已有 intake 历史的旧前端若不发送 `intakeTaskId`，正式启动会收到 409，需刷新到新版界面。前后端应一起更新。回执重放已接受的正式任务时仍返回原任务，不因后来出现纠正而创建另一任务。

## 失败与次数边界

每个 intake turn 保持原有 `llm=1、search=0、crawl=0、minutes=4` 限额；最多 40 轮，创建时历史加当前回答 JSON 最多 60,000 字符。这是应用边界，不是模型上下文窗口的声明。

Responses failed、断流、非法 JSON、多个问句或不合规确认来源均失败并保留原用户回答，不额外请求模型修复。模型 JSON 不直接作为可见正文流输出，不伪造持续出字。费用与用量沿用实际网关记录，研究失败不表示上游没有成本。

调用次数已经用完时，原 stage 的预算不能凭“重试”按钮重置。用户可明确继续发起新一轮需求整理，形成新的可见 intake task；网络未收到任务 ID 的场景则重发同一回执，不能混为同一类重试。

## 验证记录

- `lib/research/intake.test.ts`：真实 `runResearchIntake → researchModelCall → Responses` 适配，fetch 返回合成 SSE；验证用户角色、草稿隔离、单问题、保留未知、自然语言先开始、纠正、模型建议拒绝、多问句/非法 JSON/断流单次失败、原话完整性、请求回执及最新 result 绑定。
- `lib/research/intake.integration.test.ts`：仅随机临时 PostgreSQL 数据库启用，验证并发薄请求幂等、同毫秒轮次按 brief revision 排序、当前摘要 ID、执行 brief、确认快照、纠正/失败竞态、伪造确认拒绝与旧直接 API；不调用上游。独立测试用户在完成后删除，避免污染其他集成测试。
- `validation/intake-dialogue-backend-tests.log`：本模块与既有 gateway/protocol 的完整单测日志。
- `validation/intake-dialogue-typecheck.log`、`validation/intake-dialogue-lint.log`：本地类型检查与本次后端文件 ESLint。

从 source 根目录复跑：

```bash
pnpm exec vitest run --config vitest.research.config.ts \
  lib/research/intake.test.ts lib/research/gateway.test.ts lib/research/protocol.test.ts
pnpm typecheck
```

上述受控 HTTP 与协议测试本轮通过 25 项（intake 13、gateway 6、protocol 6）。真实数据库测试由现有 `scripts/test-research.mjs` 创建随机本地临时库后执行并删除，和其它研究集成测试统一验收；数据库实际通过数以最终汇总日志为准。这里没有付费模型调用、线上会话、生产配置或部署验收，合成模型回答不能当作真实模型访谈质量指标。
