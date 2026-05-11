# Chūgǎo Studio

基于 Next.js App Router 的图像生成站点骨架，按 `PROJECT_PLAN_v3_1.md` 的 v3 spec 初始化，当前已完成：

- 用户端着陆页、工作台、历史、设置、详情页
- 管理端仪表盘、用户、渠道、邀请码、生成、系统、审计页面
- `Model Registry`、动态参数面板、成本预估
- 公共 API 骨架：`/api/health`、`/api/public/config`、`/api/public/models`
- 生成 API：创建任务、扣点、入队、取消、SSE 状态流
- Provider 路由、fallback、worker 写回状态和生成图片记录
- Prisma schema、Docker/Caddy 部署文件、worker

## 本地启动

```bash
pnpm install
docker compose up -d postgres redis
pnpm db:generate
pnpm db:push
pnpm db:seed
pnpm dev:doctor
pnpm dev:all
```

`image2` 中转可通过环境变量 seed 到 Provider 表：

```bash
IMAGE2_PROVIDER_NAME=sub2api
IMAGE2_PROVIDER_PROTOCOL=OPENAI_IMAGES
IMAGE2_WIRE_API=images
IMAGE2_BASE_URL=https://api.xpzhao.top
IMAGE2_API_KEY=<IMAGE2_API_KEY>
IMAGE2_MODELS_SUPPORTED=gpt-image-2
pnpm db:seed
```

默认的 OpenAI Images 兼容通道会调用 `POST {baseUrl}/v1/images/generations`；有参考图时会走 `POST {baseUrl}/v1/images/edits`。`IMAGE2_BASE_URL` 可以写成 `https://host`、`https://host/v1` 或 `https://host/v1/images/generations`；URL 会统一规整，避免 `/v1/v1` 双拼。4K 像素尺寸按 OpenAI `gpt-image-2` 约束使用 UHD 规格，最大边不超过 `3840px`，总像素不超过 `8,294,400`，因此 `16:9` 为 `3840x2160`、`9:16` 为 `2160x3840`。`pnpm dev:doctor` 会检查 `DATABASE_URL`、Redis、Provider 表里是否有支持 `gpt-image-2` 的可用 Images 渠道，且不会输出密钥。

Responses 通道仍可用：把 `IMAGE2_PROVIDER_PROTOCOL` 设为 `OPENAI_RESPONSES_IMAGE`，`IMAGE2_WIRE_API` 设为 `responses`，并把 `IMAGE2_MODELS_SUPPORTED` 设为 `sub2api-image`。它会调用 `POST {baseUrl}/v1/responses`，使用 Responses API 的 `image_generation` tool，不会探测 `/v1/models`。`SUB2API_RESPONSES_MODEL` 是 Responses 外层模型，默认 `gpt-5.5`；如果上游要求 tool 内也带模型，可设置 `SUB2API_IMAGE_TOOL_MODEL=<IMAGE_TOOL_MODEL>`。Responses 通道默认把用户选择的 `1K/2K/4K` 原样传给中转；如中转要求像素尺寸，可设置 `SUB2API_RESPONSES_SIZE_MODE=pixels`，此时同样使用上面的 4K 尺寸约束。如果切到 Responses，也要同步确认 UI 默认模型和 `/api/health` 的检查目标。

如果未启动 DB/Redis，`/api/health` 会返回 503 和可执行引导：

```bash
docker compose up -d postgres redis
pnpm db:push && pnpm db:seed
pnpm dev:doctor
```

如果当前机器 Docker daemon 不可用，但只需要进入页面检查 UI，可以显式启用非生产本地身份：

```bash
pnpm dev
```

账号系统始终使用真实数据库用户。首次本地启动请先准备 Postgres/Redis，执行 `pnpm db:push && pnpm db:seed` 创建初始管理员和 Provider 配置；只跑 `pnpm dev` 不会消费生成队列。测试真实出图请使用 `pnpm dev:all`，或分别启动 `pnpm dev` 与 `pnpm worker`。

对话式工作台会先把上下文编译成出图 prompt。默认使用本地拼接；配置 `OPENAI_API_KEY` 后可用 `CONVERSATION_COMPILER_MODEL=gpt-5.5` 作为上下文编译器。

默认地址：

- 用户端：[http://127.0.0.1:3000/app](http://127.0.0.1:3000/app)
- 管理端：[http://127.0.0.1:3000/admin](http://127.0.0.1:3000/admin)

## 当前状态

这版已经从纯 mock 推进到可运行业务链路：有数据库和 Redis 时会创建真实任务、扣点、入队、调用 Provider、写回状态和图片记录；未启动基础设施时接口会 fail closed，并通过 `/api/health` 与 `pnpm dev:doctor` 给出诊断和启动步骤。
