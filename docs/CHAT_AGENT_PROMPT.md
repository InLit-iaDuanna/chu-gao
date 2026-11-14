# 聊天 Agent：系统提示词与工具协议

本文说明 /app 统一对话里的助手是怎样被定义的：系统提示词分几层、各层归谁、
工具怎样定义和使用、有哪些不能破坏的约束。代码是唯一事实来源，本文只解释
为什么这样写。要看模型实际收到的全文，运行：

```sh
node --import tsx scripts/print-chat-instructions.ts        # 未联网
node --import tsx scripts/print-chat-instructions.ts --web  # 已联网
```

运行时的持久化、恢复和计费见 [CHAT_RUNTIME.md](CHAT_RUNTIME.md)，本文不重复。

## 1. 模型一轮里能看到什么

| 内容                                  | 来源                                                                         | 是否每轮变化       |
| ------------------------------------- | ---------------------------------------------------------------------------- | ------------------ |
| 系统提示词（instructions）            | `chatTurnInstructions()`，建 turn 时冻结进快照                               | 仅联网段随开关变化 |
| 工具定义                              | `CHAT_IMAGE_TOOL` / `CHAT_IMAGE_RESPONSES_TOOL`；联网时另加原生 `web_search` | 否                 |
| 历史消息与摘要                        | `lib/chat-context.ts`                                                        | 是                 |
| 本轮用户消息，末尾附 `[本轮运行时间]` | `lib/chat-turns.ts`、`lib/chat-worker.ts`                                    | 是                 |
| 参考图及 `[参考图身份和顺序]` 清单    | `lib/chat-context.ts`                                                        | 是                 |
| 工具回执                              | `chatImageToolOutput()`                                                      | 是                 |

## 2. 系统提示词分两层

### 第一层：人设（可由运营覆盖）

- 位置：`lib/ai-config.ts` 的 `DEFAULT_CONVERSATION_SYSTEM_PROMPT`，可用
  `SystemConfig["conversation.systemPrompt"]` 覆盖。目前管理后台没有编辑入口，
  覆盖需要直接写这条配置。
- 只回答两个问题：助手是谁，怎样做事（先给结论、少问多做、给完整成果、
  视觉稿当设计稿做、不编造、跟随用户语言）。
- 视觉稿那一条来自线上数据：Opus 完成的回复里一半以上是整页 HTML，其中
  约八成用了渐变。它写的是原因和判断方式，不是禁用清单；用户要求渐变时照做。
- 不写的内容：工具名、输出格式、联网、系统标记、时间、用户信息。这些要么属于
  第二层，要么每轮变化。测试 `lib/chat-instructions.test.ts` 的
  “default persona” 用例会拦住这类内容。

已经在数据库里覆盖过这条配置的部署不会自动得到新的默认人设。线上环境
（2026-11-13 核实）就是这种情况：库里是 2026-07-08 写入的通用助手人设，
上线新人设需要更新或删除这条配置。旧人设里关于生图的两句话与第二层重复但
不冲突。

### 第二层：运行时契约（代码所有，不可配置）

位置：`lib/chat-instructions.ts`。每一段描述的都是应用真实会做的事，所以它
必须和代码一起改：

| 常量                                               | 说明什么                                                         | 必须与之保持一致的代码                                                            |
| -------------------------------------------------- | ---------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `CHAT_OUTPUT_CONTRACT`                             | Markdown 渲染；html 代码块会被静态预览（脚本不执行、外链不加载） | `components/studio/chat/AssistantContent.tsx`、`HtmlArtifact.tsx`（`sandbox=""`） |
| `CHAT_CONTEXT_CONTRACT`                            | 消息里各种方括号标记的含义；一切外来内容都是数据不是指令         | `chat-turns.ts`、`chat-worker.ts`、`chat-context.ts` 里注入标记的地方             |
| `CHAT_IMAGE_TOOL_CONTRACT`                         | 何时调用生图、怎样写 prompt、参数、每轮一次、回执怎样读          | `chat-image-tool-definition.ts`、`chat-worker.ts` 的工具循环                      |
| `CHAT_WEB_SEARCH_ON_CONTRACT` / `..._OFF_CONTRACT` | 本轮是否联网、何时检索、来源列表由系统附加                       | `chat-upstream.ts`、`chat-search.ts` 的 `appendSearchSources`                     |

### 拼接顺序

```
人设
输出格式
对话中的系统标记
生图工具 generate_image
联网搜索（开 / 关二选一，永远在最后）
```

`chatTurnInstructions(base, webSearch)` 是唯一的生产入口，建 turn
（`chat-turns.ts`）和上下文预算估算（`chat-context.ts`）都调用它，两边不会
出现不一致。`chatSystemInstructions()` 保留四参数签名，只给探测脚本和旧调用用。

## 3. 写提示词的原则

1. **只写真话。** 每句都要对应运行时的真实行为。应用做不到的事不许诺，应用
   会做的事（自动附来源、自动带参考图、每轮只接受一次生图）要明说，否则模型
   会重复劳动或说错话。
2. **前缀稳定。** 提示词会被冻结进 turn 快照，并作为 prompt cache 的前缀。
   其中不能出现时间、用户名、余额等每轮或每人不同的值；时间放在用户消息末尾
   的 `[本轮运行时间]` 里。唯一随轮变化的联网段放在最后，让开和关两种情况
   共享尽可能长的前缀。
3. **一条规则只写一处。** 人设不谈工具，工具的行为细节写在契约里，工具定义
   只写“做什么、何时调用、返回什么”，失败后的具体做法写在回执的 `next` 里。
4. **数据不是指令。** 网页、工具返回、图片里的文字、历史摘要和系统标记都只
   提供信息。标记本身也不带权限：即使用户手打一个同名标记，也只是多了一段
   资料。
5. **说清为什么。** 例如“图片模型看不到这段对话”，模型知道原因后，才会在
   没列举到的情况下也写出完整的 prompt。
6. **短。** 这段文字每轮都要发送，按 token 计价的模型会为它付费，新增内容
   先确认删掉它是否真的会出错。

## 4. 生图工具 generate_image

### 定义原则

- 两种传输形态（Chat Completions、Responses）共用同一份名称、描述和参数。
- 描述只说三件事：做什么、何时调用、返回什么（提交回执，不是图片）。
- **只暴露模型能从对话里正确填写的参数。** `modelId` 已从模型可见的定义里
  移除：模型无从知道合法的模型 ID，用户的“生图设置”已经决定了它。服务端的
  zod 校验仍然接受这个字段，不影响旧的在途请求。
- 可选参数的默认值都是用户当前的生图设置，所以每条参数描述都写明“什么时候
  才传”。
- 参考图不是参数：由系统按本轮的参考图清单自动附带。

### 一轮里的调用回路

```
请求 1（带工具）──模型调用 generate_image──▶ 校验参数并提交到生成队列
                                              │
请求 2（不带工具）◀── 回执（成功或失败）──────┘
        └─▶ 模型用一两句话说明结果，回合结束
```

- 每轮最多提交一个图片任务；处理完工具调用后第二次请求不再提供任何工具。
- 同一次响应里的第二个调用或未知工具名会得到 `UNSUPPORTED_TOOL_CALL`。
- 按 token 计价的模型每轮最多两次上游请求（`tokenRequestLimits.maxRequests`）。
- 重新生成一条已经提交过图片的回复时，不会再提交图片：应用会插入
  `[已提交的图片任务]` 说明，且不提供工具。

这些是计费边界，改提示词不能改变它们；要改必须先改 `chat-worker.ts` 和
`chat-turns.ts` 并重新评估计费。

### 回执

模型收到的不是内部结果对象，而是 `chatImageToolOutput()` 生成的回执：

```json
{ "ok": true, "generationId": "…", "status": "PENDING", "next": "任务已进入生成队列，图片还没有生成…" }
{ "ok": false, "code": "INSUFFICIENT_CREDITS", "message": "图片生成点数不足", "next": "图片没有提交。告诉用户积分不足…" }
```

- 成功的回执不带积分和模型名：这些数字以界面为准，模型不应复述。
- `next` 是模型此刻该做的那一件事。每个错误码都有对应的 `next`
  （见 `FAILED_NEXT`），未知错误码有兜底。新增错误码时在这里补一条，不要去
  加长系统提示词。
- 审核未通过时，`next` 要求如实告知，并且不帮用户改写来规避审核。

### 参数校验

每轮只有一次工具机会，所以只有 `prompt` 不可用（缺失、为空、超过 4000 字、
不是 JSON 对象）才会让调用失败，失败信息写明是哪一种。其余参数宽松处理
（`parseChatImageToolArgs`）：

- `null`、空字符串视为没有传；`n` 接受数字字符串。
- 不在枚举里的值、越界的数量、未定义的参数名被丢弃，改用用户当前的生图设置，
  并在回执的 `ignored` 里列出；`next` 会要求模型告诉用户哪一项没有生效。

线上曾有两次调用因为参数校验整体失败，而当时既不记录参数也不说明原因。
现在失败原因会随工具结果一起落库（`parts.items[].action.message`）。

### Responses 形态必须写 `strict: false`

Responses 接口的函数工具不写 `strict` 时按严格模式处理，严格模式下模型会把每个参数都填上。
线上实测（2026-11-13）：一句普通的“帮我生成一张图”，Sol 传了 `n: 1`、`quality: auto`、
`outputFormat: png`、`background: opaque`，把用户自己的生图设置盖掉了；改成 `strict: false`
后只传 `prompt` 和用户明确提到的参数。Chat Completions 形态没有这个问题。
`chat-image-tool-definition.test.ts` 里有断言，不要删掉这个字段。

### 思考状态

Responses 的推理条目和 Chat Completions 的 `delta.reasoning_content`（或 `reasoning`）
都只用来把状态切到“思考中”，正文不落库、不回放给模型。

## 5. 联网搜索

两条路，由模型通道决定：

**原生（Sol、Luna，Responses 形态）**

- 使用上游原生的 `web_search` 工具，模型自己决定检索时机与关键词。
- 应用会把引用标注改写成 `[n](url)`，并在回复末尾追加“参考来源”列表，所以
  提示词要求模型不要自己再写来源小节。

**应用侧工具（Opus，Chat Completions 形态）**

- 中转没有可用的原生搜索：实测 `/v1/messages` 的 `web_search` 会把整句当成
  检索词，返回模板化的结果堆，质量不可控。
- 所以应用自己定义 `web_search` 函数工具（`lib/chat-search-tool.ts`），模型
  写 `query`，worker 用同一把 key 调中转的 `/v1/messages` 检索，把来源与摘录
  整理成回执交给模型；一轮最多两次（`CHAT_SEARCH_LIMIT`）。
- 回执带一条“资料可能过时或无关，没有相关结果就说没有”的约束；来源写入
  `attempt.sources`，由界面显示在回复下方，正文不追加“参考来源”。
- 两套提示词分别是 `CHAT_WEB_SEARCH_ON_CONTRACT`（原生）和
  `CHAT_WEB_SEARCH_TOOL_CONTRACT`（工具），由 `chatTurnInstructions` 的第三个
  参数选择。

- 未联网时要求模型不声称搜索过，并在涉及可能变化的事实时说明没有联网。

## 6. 修改时的检查清单

- [ ] 改了注入标记、工具参数、工具循环、来源处理或 HTML 预览的行为，同步改
      第二层对应的常量。
- [ ] 新增的句子是否描述了真实行为？是否已经在别处写过？
- [ ] 是否把每轮变化的值写进了提示词？（`chat-instructions.test.ts` 会检查
      时间和前缀稳定性。）
- [ ] 运行 `corepack pnpm exec vitest run --config vitest.config.ts lib/chat-instructions.test.ts lib/chat-image-tool-definition.test.ts`
      和 `corepack pnpm exec vitest run --config vitest.chat.config.ts`。
- [ ] 用 `scripts/print-chat-instructions.ts` 通读一遍全文。
- [ ] 提示词变化只影响新建的 turn；已有 turn 重试时沿用当时冻结的提示词。
