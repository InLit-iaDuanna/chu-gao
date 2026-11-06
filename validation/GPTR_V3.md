# GPTR V3：固定任务、真实选材与模型调用合同

本次修改的是现有 GPT Researcher 适配链路。继续运行真实的 `GPTResearcher.conduct_research()`、深度研究子任务和 `write_report()`；没有用另一段自制报告逻辑替换开源框架。验证使用实际安装的锁定 SDK、原案例留档和合成的 HTTP 响应，**没有调用付费模型，也没有重新抓取原案例网页**。

## 1. 锁定的开源实现和参考范围

| 项目 | 实际验证版本 | 本次使用范围 |
| --- | --- | --- |
| GPT Researcher | `0.16.1` | 研究调度、子查询、深度研究、报告生成、原有 BM25 评分函数 |
| LangChain | `1.4.6` | 原 GPTR 调用链 |
| langchain-core | `1.6.12` | 真实消息和异步调用链 |
| langchain-openai | `1.7.2` | 真实 `GenericLLMProvider` 后面的模型客户端 |
| langchain-text-splitters | `1.1.3` | 原文分块，保留源文本区间 |
| OpenAI Python SDK | `2.54.0` | 真实 HTTP 请求装配及 SSE 解码；测试仅替换 HTTP 传输 |

版本由本地已安装包的 `importlib.metadata.version()` 核对，依赖仍使用原有 `requirements.gptr.lock`。没有升级依赖。

官方参考：

- [GPT Researcher 的官方 GitHub 仓库](https://github.com/assafelovic/gpt-researcher)。仓库入口用于说明项目来源；本次合同结论不以变化中的 `main` 代替锁定版本。
- [GPT Researcher 0.16.1 的 PyPI 发布文件](https://pypi.org/project/gpt-researcher/0.16.1/#files)。本次检查、安装和执行对应 wheel；其 SHA-256 为 `1c0fe74a1c3319b2ac2caa910808c61b638634d2b75361521e8c4627a8b5a8cf`。
- [Lucene 的 CJKBigramFilter 官方说明](https://lucene.apache.org/core/10_3_1/analysis/common/org/apache/lucene/analysis/cjk/CJKBigramFilter.html)。借鉴相邻汉字二元组的检索思路；没有接入 Lucene，也没有声称实现其完整分析器。
- [LangChain RecursiveCharacterTextSplitter 官方说明](https://docs.langchain.com/oss/python/integrations/splitters/recursive_text_splitter)。使用实际锁定的分块器及适合中文标点的分隔符；字符预算不等于模型 token 窗口。

锁定 wheel 中与原缺陷直接有关的位置是 `actions/report_generation.py`、`actions/query_processing.py`、`skills/researcher.py`、`skills/deep_research.py` 和 `context/lexical.py`。回归测试直接导入该版本的函数、引用和客户端，不依赖猜测的 GitHub tag 或虚构文件行号。

## 2. 修复的具体合同

### 2.1 内部 JSON 任务不能被“只写报告正文”覆盖

原适配把最终报告要求混入 query，但 GPTR 会复用 query 进行选角色、生成查询等内部 JSON 任务。现在：

- `query` 保持原始研究目标；固定 `Chugao Design Researcher` 角色，省去一次没有必要的选角色模型调用。
- 深度研究新建的子 researcher 同样获得固定角色；仅给最外层构造器传 `role` 不足以覆盖它们。
- `TaskSpec` 在模型调用边界绑定到 system 消息；原内部 JSON 任务的 user 消息保持原样。锁定版本的子查询函数虽接收 role 参数，却没有把它发送给模型，因此不能只依赖该参数。
- 只有最终 writer 收到报告正文格式要求。
- 已知内部 JSON 阶段返回 Markdown 或结构不合规时直接失败，保留资料，等待显式重试；不让 GPTR 的 JSON 修补或默认查询悄悄掩盖错误。允许一个完整 JSON 代码围栏，不增加未验证的 `response_format` 上游参数。

### 2.2 Writer 必须明确收到任务和真实材料

锁定版本的 `custom_prompt` 替代默认报告任务提示，不能假定默认 query 仍在；研究 conductor 还会覆盖构造器传入的 context。

因此最终 writer 使用：

```python
await researcher.write_report(
    ext_context=writer_selection["context"],
    custom_prompt=writer_prompt(task_spec),
)
```

`custom_prompt` 显式包含 TaskSpec。`ext_context` 从已保存的原文重新选取，具备精确区间与哈希，不直接采用可能已经偏题的深度研究 learnings。测试注入餐车方向的中间内容后，验证最终 wire 中的 writer 材料仍来自规定的原文集合。

原 `result.sources` 为兼容旧调用方仍可包含全部采集材料。**它不表示 writer 全部读过这些材料**。实际阅读范围以 `writerContextManifest` 为准。

### 2.3 明确使用本地中文词项检索，不谎称 embeddings

运行合同为 `gptr-design-v3`，实际过滤器为 `chugao-cjk-bm25-v1`，`embeddingUsed: false`。

本地过滤器继续调用锁定 GPTR 的 BM25 评分函数，替换其词项分析：汉字采用相邻二元组，Latin 单词和 SKU 精确匹配。测试验证原中文样例的零分问题得到纠正，且 `MR9086` 不误命中 `MR90860`。该选择显式覆盖原框架的自动过滤分支，不因环境里偶然存在其他服务密钥而发起额外调用。

正文候选先按可追溯的 Markdown 块处理，去除纯图片、短导航链接和常见文章推荐尾部。分块保留原文下标；排名不使用图片 alt 重复文字及 URL 目的地址刷出的词项。原文段按源顺序进入上下文，优先保留利益披露等限制信息。用户直接提供的文本不使用网页尾部裁剪。

已识别的网页 Markdown 表格块（连续以 `|` 开头的表行）按整个原文块参加选材，不再通过普通 1,100 字符分块器切开。只有完整块能装入该来源及全局预算时才纳入；超限或被页面扫描边界截断时整块省略，不向 writer 注入孤立数字行。来源项的可选 `tableOmissions` 记录该块的原文区间、哈希和具体原因，即使同一来源的普通段落仍被纳入，也能解释表格遗漏。这不是复杂分表器，不声称已识别 HTML 表格或所有 Markdown 方言。

词项匹配只负责候选选材，**不是事实核验、相关性最终裁决或决策闭环**。结构化 routing 中的 `method`、`role`、`decisionIds` 和 `reason` 原样可审查；内容哈希变化后，旧分流降为 pending，不能沿用旧结论。产品身份、同任务体验和用户指定的材料不因词项零分直接丢弃；无关材料与背景材料采用不同处理。

默认边界为最多 10 个纳入来源，主体来源最多 3,300 字符/来源，背景或设计参考合计最多 2 个来源且各最多 1,100 字符。最终整个 context JSON 上限为 32,000 个 Python Unicode code points，计入材料元数据。每页最多扫描 240,000 字符，输入页数上限 100；实际裁剪和跳过原因写入 manifest。这些是应用输入限额，不能用于宣称上游上下文窗口。实际模型调用仍受原网关的 token、次数和费用限额约束。

### 2.4 调用目的可追溯，失败不能被框架吞成成功

`runtime_contracts.install_gptr_single_attempt()` 保留旧的无关键字参数用法，增加可选的消息准备、元数据、响应合同检查和失败通知回调。实际 SDK 传输边界仍为一次请求，`max_retries=0`；失败 latch 阻止框架换路径再次发送同一个失败步骤。

深度研究某些分支会捕获异常，因此 engine 在 `conduct_research()` 后检查失败记录。模型调用已失败时，不返回成功的“资料不足”结果。最终 report 为空也不能完成。真实 SSE 输出过的部分正文保留，不因断流重执行 writer。

只在 `research.write_report` 阶段向外发出正文增量；内部计划、查询 JSON 和其他中间模型输出不能冒充最终报告。搜索、采集仍通过已有网关和持久用量限制。

## 3. 接口与留档

输入可选 `taskSpec`；缺少时从旧 `query`、`brief` 和 `links` 构造，兼容旧 payload。主要字段是 `objective`、`confirmedRequirements`、`audience`、`market`、`timeRange`、`constraints`、`decisionQuestions` 和 `userSelectedUrls`。只有显式传入的用户原话要求可以进入 `confirmedRequirements`，旧 brief 的建议和假设不会自动变为用户已确认约束。

每次运行保存：

| 文件/字段 | 含义 |
| --- | --- |
| `gptr-context-selections.json` | 各真实选材阶段的来源、原文区间、内容哈希、应用预算和跳过原因 |
| `gptr-writer-input.json` | 最终 TaskSpec、custom prompt、实际 context 和对应 manifest；不包含认证信息 |
| `writerContextManifest` | 返回到 worker 的最终 writer 阅读范围 |
| `writerEvidenceIds` | 真正纳入 writer 的证据 ID；不能以此独立判定引用正确 |
| `runtimeContract` / `taskSpecHash` / `contextFilter` / `embeddingUsed` | 运行合同和实际选材方式 |

Manifest 中的 `ranges.start/end` 是 Python Unicode code point 下标，区间 SHA-256 对应原文切片的 UTF-8 字节；不是 TS 的 UTF-16 引用下标。不要不经换算复用为 TS 引用区间。`contentHash` 则为整个原始正文的 UTF-8 SHA-256。`lexicalMatchedDecisionIds` 仅表示词项命中，不能当作决策已解决。

实际模型调用事件记录 purpose、真实调用模块/函数、序号、model、stream、准备后消息字符数和消息哈希。网关 trace headers 为：

```text
X-Chugao-Call-Purpose
X-Chugao-Task-Spec-Hash
X-Chugao-Context-Hash
```

最后一个仅用于 writer。它们只供应用网关关联日志，不参与认证、计费、模型或强度选择；应在网关剥离后再请求兼容上游。本文的 Python 测试验证出站字段，不替代 TS 网关的独立验收。

## 4. 实际验收结果

### 4.1 SDK 合同回归

最终规范日志 `gptr-v3-whole-table-contract-tests.log`：**33 / 33 通过，2.162 秒**，其中设计研究测试 16 项、原 runtime 合同测试 17 项。它包含此前 31 项和最后新增的两项整表回归；交付应以这份完整结束的日志为准。

覆盖真实 GPTR 导入引用和子 researcher、固定角色、内部 JSON 计划、writer TaskSpec、实际材料区间/哈希/预算、中文检索及完整过程段、旧分流哈希失效、实际 LangChain/OpenAI HTTP 装配、真实 SSE 早到正文、503、断流、空结果、框架吞错和失败后的禁止重放。模型回答和搜索/crawl 响应均由测试提供，禁止外部 socket 连接；不是线上效果评分。

整表回归使用实际选择器，分别验证：超过普通 chunk size 的长表仍将表头、单位、全部行和表内披露保存在同一原文区间；超过单源预算的表整块省略而保留表外段落，并记录省略原因。同一测试还验证页面扫描边界不会把被截断的表误当作可纳入的小表。

本机执行使用独立的锁定依赖目录。正常安装了 `requirements.gptr.lock` 的 Python 3.12 环境可直接从 source 根目录运行：

```bash
PYTHONPATH=services/research-runtime/tests CHUGAO_TEST_ARTIFACT_DIR=validation \
  timeout 90s python3 -m unittest -v test_design_research test_runtime_contracts
RESEARCH_ENGINE=gpt-researcher python3 services/research-runtime/check-runtime.py
python3 -m py_compile services/research-runtime/design_research.py \
  services/research-runtime/engine.py services/research-runtime/runtime_contracts.py \
  services/research-runtime/tests/test_design_research.py validation/replay-gptr-v3.py
```

如果依赖由 `pip --target` 放在单独目录，先把该目录加到 `PYTHONPATH`。最后两项本次均已通过；assembly 输出见 `gptr-v3-assembly-check.log`。本次检查了 `Dockerfile.gptr` 已复制新 helper；没有声称完成 Docker 镜像构建或部署。GPTR 的 helper 导入仍隔离在 `gptr()` 内，不需要复制此 GPTR helper 到 DeerFlow 镜像。

当前执行环境的默认 sandbox 曾使异步 SDK 任务挂起；同一套禁止网络的测试在正常进程权限和 90 秒外层超时下完成。这是执行环境观察，不作为 SDK 或兼容上游缺陷。新建的合成测试临时目录已清理，规范 JSON 和日志保留。

### 4.2 原案例留档选材回放

输入 `evidence-v3-candidates.json` 来自原案例 **105 条候选、10 份实际留存原文**，其中的 routing 是当前 TS 代码实际算出的 heuristic，没有把人工模型审核夹具套进去。

```bash
python3 validation/replay-gptr-v3.py
```

实际输出 `gptr-v3-retained-source-replay.json`：**5 个纳入来源、14,536 个 context JSON code points**。两个 MR9086 页面保留为产品身份候选，九阳体验保留为同任务替代候选。九阳原文的 3 + 3 + 3 分钟过程、“前后花了9分钟左右”和受邀评测披露均保留；此前能抢占词项的相关文章、目录和签到页脚被排除。餐车网站示例没有进入最终选择。净饮机没有被当作已证实的午餐任务替代品。

整表修复前的该回放为 14,532 字符。`gptr-v3-table-context-diff.json` 保存了同输入的精确比较：来源 ID 与全部非空白文本不变；只是在 MR9086 零售页和 Nutrola 页各保留了原文表块尾部两个空格。旧选择行为的重建先通过修复前已记录的 context SHA-256 校验，再与新结果比较。新 context 哈希因真实原文范围变化而更新，没有为保留旧数字而删改正文。

另外两个限额背景来源仍是背景候选，未证明其能支持具体设计结论。这个回放证明任务绑定、原文选择和阅读留档经过实际执行；不能据此宣称最终模型不会偏题、研究结论准确，或线上报告品质已经验收。

`gptr-v3-offline-replay.json` 另保存合成 HTTP 场景中的实际 SDK 请求装配、writer 输入和流事件。不要把其中的合成模型回答当作真实上游输出。

## 5. 明确未覆盖的范围

- 没有付费模型端到端验收，也没有证明兼容上游支持任何新增模型能力。
- 本地 CJK BM25 和通用 Markdown 清理不是语义 reranker 或完整 DOM 正文提取器；其他站点结构仍可能需要补测。
- 来源被纳入 writer 不等于陈述已被证实；后续语义分流、真实引用区间验证和决策缺口必须继续生效。
- 没有新增自动模型重试、embedding 服务、MCP、外部追踪或图片生成权限。
- 最终预算使用字符约束，模型 token 和费用边界由已有应用网关约束；本次不猜测模型窗口。
- 版本升级需要重新运行本合同测试；适配器检查 `0.16.1` 和真实引用签名，不静默声称兼容未测试版本。
