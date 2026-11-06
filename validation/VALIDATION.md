# Research Quality V2 · 实际验证记录

本记录针对交付包中的改造候选版本。源码来自本次附件，在独立目录修改；没有部署到生产，
没有读取生产数据库或真实模型密钥，也没有发起新的付费模型研究。公开 GitHub 源码/依赖下载
以及下面注明的 Crawl4AI 公开网页 HTTP 抓取确实使用了网络。

本地源码基线：`12e5b18b0c53500f183b444509cc08f5e94bc25f`。
这是本次导入附件后建立的快照，不是用户线上仓库的提交号。
打包时的源码和验证文件以交付根目录 `MANIFEST.sha256` 为准。

## 1. 结果总表

以下通过项均对应真实结束的进程。测试数量有交叠，不应把它们简单相加为独立功能总数。

| 检查                                  | 实际结果                                 | 证据文件与范围                                                                                                                 |
| ------------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| TypeScript 类型检查                   | exit 0                                   | `typecheck-final.log`；无诊断                                                                                                  |
| Next.js 生产构建                      | exit 0                                   | `production-build.log`；静态路由与 standalone 构建，不代表已启动整套生产服务                                                   |
| 改动的 TS/TSX/MJS ESLint、格式        | exit 0                                   | `changed-files-eslint.log`、`changed-files-format.log`；最后预览改动另见 `research-preview-lint.log`                           |
| 研究专用套件                          | **99/99 通过，exit 0**                   | `research-db-capacity-regression.log`；8 个文件，其中 8 项为实际 PostgreSQL 集成测试，上游全部模拟                             |
| 原对话数据库回归                      | **29/29 通过，exit 0**                   | `chat-db-regression.log`；真实临时 PostgreSQL，模型响应模拟                                                                    |
| 原对话协议/客户端套件                 | **71 通过，29 跳过，exit 0**             | `chat-protocol-regression.log`；被跳过的 29 项已在上一行独立执行                                                               |
| 最终研究预览与呈现逻辑                | **14/14 通过，exit 0**                   | `research-preview-focused.log`；ResearchWorkspace 2 项、presentation 12 项；jsdom，不是真实浏览器                              |
| 全量 UI 配置套件                      | **594 通过、11 失败、8 跳过，exit 1**    | `ui-full-suite-final.log`；11 项失败全部在未修改基线重现，见下一节。此运行在最后的预览权限改动之前；改动后用上一行检查精确复跑 |
| Python 提案导出                       | **38/38 通过，exit 0**                   | `../artifacts/qa/proposal-tests.log`、`../artifacts/qa/proposal-validation.json`                                               |
| GPTR 真实 SDK/运行时合同              | **16/16 通过，exit 0**                   | `runtime-contract-tests.json`；真实 SDK、假 HTTP transport，禁止外部 socket                                                    |
| DeerFlow 真实重试 middleware          | **2 场景通过，exit 0**                   | `runtime-deerflow-retry.json`；真实固定版本 middleware，假的模型 handler                                                       |
| 既有 Python 子进程/取消回归           | **4/4 通过，exit 0**                     | `runtime-process-regression.log`；真实本地子进程                                                                               |
| TS → Python → TS 跨语言合同           | **20 项通过，exit 0**                    | `cross-language-proposal-result.json`；真实导出工具与导入器，合成输入，无模型/数据库/HTTP 服务                                 |
| GPTR、DeerFlow 真实装配与本地构建门槛 | **均 exit 0**                            | `runtime-*-construction.json`、`runtime-buildgate-*.json`；真实框架构造，DeerFlow gate 还实际导出并校验三格式，不运行模型规划  |
| Crawl4AI 公开网页 HTTP 抓取           | **HTTP 200，exit 0**                     | `runtime-crawl4ai-http-proxy.json`；真实 0.9.5 SDK，显式环境代理，固定公开 GitHub URL                                          |
| Office 实际渲染与逐页检查             | **主夹具 PPT 7 页、DOCX 2 页均检查通过** | `../artifacts/qa/proposal-{pptx,docx}/`；另有附件回归 PPT 4 页、DOCX 1 页，见质量记录                                          |
| Python 语法检查                       | exit 0                                   | `python-compile.log`；额外运行时检查脚本结果见 `runtime-validation.md`                                                         |

环境复用本项目锁定的 Node 依赖；实际 Next.js 15.5.18、React 19.2.4、Vitest 3.2.4、
Prisma 6.19.3。没有升级应用依赖。执行器使用 pnpm 11.25.0，仓库声明为 11.0.9；
目标环境仍应按自己的固定运行时安装。Python 第三方依赖并非全量按容器 lock 重建，差异见第 4 节。

## 2. 不能省略的全量 UI 失败

使用相同已安装依赖，在未修改的基线 worktree 上，独立执行以下四个文件，得到
**11 项相同失败、11 项通过，exit 1**：

| 文件                                      | 失败数 | 本次观察                                                                     |
| ----------------------------------------- | -----: | ---------------------------------------------------------------------------- |
| `lib/creative-plan-route.test.ts`         |      4 | 得到 503，而测试预期成功/认证/限流响应；另有依赖结果为空的断言               |
| `lib/creative-quote-route.test.ts`        |      4 | 得到 503，而测试预期成功/权限/过期响应                                       |
| `components/canvas/canvas-export.test.ts` |      2 | SVG 导出返回 400，PNG 字节无法由 sharp 解析                                  |
| `lib/research/protocol.test.ts`           |      1 | 通用 jsdom 配置下 Office 结构检查失败；同文件在研究专用 Node 配置下 5 项通过 |

原始对照日志为 `baseline-known-failures.log`。这只能证明这些失败没有由本版修改引入，
不能证明相关旧功能在真实环境一定正常，也不能把所有原因归结成“过期选择器”。
本版不为了让报告全绿而改动创意规划、画布或这些旧断言。

预览最后的改动只涉及研究 HTML 清理策略和对应现有组件测试；改动后 focused 14 项、
ESLint、格式、类型和生产构建另行执行。没有为无关旧失败反复扩大测试范围。

## 3. 数据库与并发实际验证范围

使用专用本地临时 PostgreSQL **18.4**，只监听回环地址。测试脚本创建随机测试数据库，
执行基线的 19 个 Prisma 迁移，使用合成用户、任务、余额和模拟上游，结束后删除随机库。
原对话测试还演练既有历史迁移路径。

研究 99 项包含：protocol 5、gateway 4、quality 21、workflow-quality 30、
presentation 12、artifacts-atomic 6、artifact-contract 13、runtime.integration 8。
其中新增的跨任务容量竞争用数据库表锁及 `pg_locks` 作为竞争屏障：LLM 容量为 2、
crawl 为 1；被拒绝者不消耗预算/事件，前一调用结束后可以重新申请。

原对话 29 项是回归检查，不表示本轮改写了聊天事务/计费模块。测试日志出现的请求 ID、
模型名、余额和用户 ID 均来自测试输入，不代表实际付费推理或生产账号。

临时数据库已清空，临时 PostgreSQL 进程已正常停止，临时集群已移除。
`postgres-cleanup.json` 记录剩余合成数据库数量为 0。
本次没有验证生产 PostgreSQL 的配置、Redis 实例、备份恢复或真实容器间网络。

## 4. 开源组件确实执行到了哪里

完整版本、命令、源码 SHA-256 和限制见 [`runtime-validation.md`](runtime-validation.md)。

- **GPT Researcher 0.16.1**：运行真实类、helper、provider 和 OpenAI/LangChain SSE 解码。
  HTTP 由 MockTransport 提供。503、连接中断、空正文和部分流后中断的已适配路径只发一次请求。
  真实 `generate_report` 在最终失败后会返回空字符串，本版 engine 拒绝将它作为成功终稿。
- **DeerFlow `cd0166ae76f8a05d2ef13ce665ec89b37584217f`**：从真实固定源码装配 graph，
  检查技能/身份/文件挂载、禁用主机 bash 的工具清单。SDK `max_retries=0` 不足以关闭
  框架重试，当前还配置 `llm_call.retry_max_attempts=1`；实际 middleware 两个场景已验证。
  没有执行 `astream_events` 和模型驱动的整段制作。
- **Crawl4AI 0.9.5**：真实 HTTP 策略抓取公开仓库，得到 534,909 字符 HTML、46,798 字符
  Markdown；实际耗时 0.801 秒。直接 DNS 路径失败记录仍保留。**生产 `/crawl` 用的是
  Playwright，本次独立 HTTP 成功不等于生产端点、截图或浏览器策略已验收。**
- **Vane / SearXNG**：沿用附件已有真实服务接入、固定源码/镜像配置。本轮未新运行它们
  的完整服务，历史成功记录不自动算作本次 V2 的真实端到端结果。

本环境没有 Docker daemon。GPTR 使用精确 wheel，DeerFlow 使用精确源码，但复用了隔离
Python 环境并补充依赖。Office gate 中 lxml 6.1.3 / Pillow 13.0.0 与仓库 lock 的
6.1.0 / 12.3.0 不同；完整镜像构建必须在目标环境复跑。可选 MCP retriever 未启用且未验收。

应用网关原有、计入预算的有限重试仍存在。关闭两个框架的隐藏重试不代表整个项目从此
没有任何自动重试，也不承诺框架未来新插件绕过已适配 helper 的路径具备相同行为。

## 5. 原案例的离线对照

`replay-quality-evidence.mjs` 支持包内精简夹具；可选传入本次原始案例目录读取完整留档。
`quality-evidence-replay.json` 是 55 条来源、10 篇实际留档正文的完整回放；
`quality-evidence-fixture-replay.json` 是可随源码复跑的夹具版本。

在同一原案例材料上，17 条文档形态噪声被省略。Ochama 清洗后正文为 99,701 个 UTF-16
字符，原插入顺序打包未纳入该正文，新聚焦打包纳入 1,970 个字符，包括 650W 与历史价格
片段；最终序列化相关输入为 **18,773 / 32,000 字符**。元数据也计入预算。

这个对照证明材料选择和留档的变化。它不证明当下价格、页面权威性、市场结论或推理
语义支持，32,000 也不是模型窗口/token 上限。原案例仍被判定为材料不足。
历史报告引用属于其当时原始 55 个来源 ID；不能把新筛掉的旧 ID 误报为历史伪造引用。

## 6. 文件质量、跨语言合同与浏览器

主离线样例：`artifacts/offline-proposal-fixture/proposal-manifest.json` 指向的有效 bundle。
真实文件包括 PPTX、DOCX、HTML；由 exporter **2.0.2** 生成，并用原生库重新打开。

PPT 有 7 页、2 个原生可编辑表格、4 个可编辑流程形状；DOCX 有 2 页、2 个原生表格。
用 LibreOfficeDev 26.8 与 Noto Sans CJK SC 实际渲染，所有页面逐页查看，没有观察到
文字裁切、覆盖或中文缺字。附件回归另查 4 页 PPT、1 页 DOCX，用户材料不生成无效超链接。
PDF 与逐页 PNG 已保存，质量 JSON 记录相应 hash。

这只代表所附样例通过视觉检查，不保证任意模型内容或任意 Office 版本都有相同分页。
过密内容会被导出器要求拆分或拒绝，不能靠缩到不可读字号过关。

跨语言回放另用合成材料，由真实 TypeScript 生成 SHA-256 终稿版本，再调用实际 LangChain
`chugao_create_proposal.invoke`、Python `load_proposal_bundle` / `app.get_run`，最后返回
TypeScript 校验 manifest 与所有文件字节。20 项检查包括错误版本、包外来源、缺失格式和
等长篡改字节的拒绝。该额外夹具 PPT 8 页，做了结构检查，**没有再次逐页渲染**。
回放不启动 HTTP 服务，不运行 DeerFlow 规划，也不包含数据库事务；这些层由其他测试分别覆盖。
详见 [`CROSS_LANGUAGE_PROPOSAL.md`](CROSS_LANGUAGE_PROPOSAL.md)。

HTML 导出无脚本。最后的研究组件测试用 jsdom 验证移除脚本、事件属性、JavaScript 链接、
meta refresh、base、嵌入和 form；保留标题/CSS，并使用空 sandbox 与 `script-src 'none'`。
这不证明实际浏览器的导航、CSS 请求、CSP、复制/选择、移动端表格和布局行为。

本环境缺少匹配 Chromium；一次安装尝试获得空/损坏下载，未完成浏览器验收。
`services/research-runtime/tests/check_export_html.cjs` 是**待运行**的离线导出 HTML 检查，
不是通过记录；主站 iframe 还需要单独的实际浏览器检查。

## 7. 可复跑命令

从 `source/` 根目录执行。安装依赖是准备步骤，测试不需要真实 API 密钥。

```bash
pnpm install --frozen-lockfile
pnpm db:generate
pnpm build
pnpm exec tsc --noEmit --incremental false
node --import tsx validation/replay-quality-evidence.mjs
node node_modules/vitest/vitest.mjs run --config vitest.chat.config.ts
node node_modules/vitest/vitest.mjs run --config vitest.config.ts components/research/ResearchWorkspace.test.tsx lib/research/presentation.test.ts
```

全新解压目录先运行构建，让 Next.js 生成其环境声明和路由类型；交付包不携带本机构建缓存。

数据库只能使用专用本地测试实例。脚本会创建和删除随机数据库，不能指向生产：

```bash
RESEARCH_TEST_DATABASE_URL=postgresql://TEST_USER@127.0.0.1:TEST_PORT/postgres node scripts/test-research.mjs
CHAT_TEST_DATABASE_URL=postgresql://TEST_USER@127.0.0.1:TEST_PORT/postgres node scripts/test-chat-turns.mjs
```

在具备相应 sidecar 依赖的 Python 环境：

```bash
python -m unittest discover -s services/research-runtime/tests -p 'test_proposal_export.py' -v
python -m unittest discover -s services/research-runtime -p 'test_process.py' -v
python validation/runtime-contract-check.py
python validation/runtime-deerflow-retry-check.py
python validation/runtime-buildgate-check.py --engine gpt-researcher
python validation/runtime-buildgate-check.py --engine deerflow --deerflow-root /opt/deerflow
node --import tsx validation/cross-language-proposal.mjs
```

跨语言脚本可用 `CHUGAO_REPLAY_PYTHON` 选择解释器；完整环境与路径参数见各自说明。
不要将本次执行器中的 Python 绝对路径、临时数据库端口或截图工具路径写进部署配置。

有真实 Playwright/Chromium 后，离线导出检查命令为：

```bash
node services/research-runtime/tests/check_export_html.cjs
```

这个脚本不在应用 package.json 中额外引入 Playwright；复跑环境需要已安装相应测试依赖。
全量 UI 失败复现命令为 `node node_modules/vitest/vitest.mjs run --config vitest.config.ts`。

## 8. 上线前仍需实际完成

1. 在目标运行时按 lock 重建整套 Docker 镜像，验收网关、Vane、SearXNG、采集端点及存储网络。
2. 用合成 brief、已验证的兼容上游参数和明确调用上限，执行一条真实研究 → 整理 → V2 提案。
   对齐实际请求/事件/来源/包版本和产物；验证部分流后失败，保留诊断且不冒充交付成功。
3. 检查真实浏览器的断线恢复、多个标签页、旧尝试延迟事件、长 Markdown/表格/代码、
   文本选择/复制、研究 iframe 网络与导航行为。
4. 同版本升级 web、worker、GPTR/DeerFlow；处理在途任务。历史无 V2 包的完成研究需要
   单独的新整理任务/迁移工具，当前重试接口不支持重做已完成的整理阶段。
5. 逐项实测 Sol 的工具循环、结构化输出、参考图、多轮长上下文、原生压缩及中间强度。
   官方功能或另一个客户端可用，都不能替代该兼容上游的实际验收。

较早的 `ui-full-suite.log`、`typecheck.log`、`root-eslint.log` 保留为开发中记录；
结论以本表明确链接的最终日志为准，不能将中间失败或未退出的运行当成最终通过。
