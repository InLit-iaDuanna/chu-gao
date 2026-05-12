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
pnpm dev:all
```

账号系统始终使用真实数据库用户。首次本地启动请先准备 Postgres/Redis，执行 `pnpm db:push && pnpm db:seed` 创建初始管理员和 Provider 配置。测试真实出图必须启动 worker：推荐 `pnpm dev:all`，或分别启动 `pnpm dev` 与 `pnpm worker`；只跑 `pnpm dev` 只适合看 UI，生成任务会停在排队中等待 worker 消费。

对话式工作台会先把上下文编译成出图 prompt。默认使用本地拼接；配置 `OPENAI_API_KEY` 后可用 `CONVERSATION_COMPILER_MODEL=gpt-5.5` 作为上下文编译器。

默认地址：

- 用户端：[http://127.0.0.1:3000/app](http://127.0.0.1:3000/app)
- 管理端：[http://127.0.0.1:3000/admin](http://127.0.0.1:3000/admin)

## 号池后台

- `Provider` 页支持三种操作：新增池内账号、CSV 导入账号、逐行文本导入账号。
- CSV 直接兼容列头：`name,status,api_key,id,error`。
- CSV 导入时不会读取文件里的 `baseUrl`；统一继承当前 provider 的 `baseUrl`。
- 后台只展示脱敏后的账号指纹，不会回显明文 key；替换 key 只能重新填写覆盖。
- 单账号支持：编辑优先级/权重/并发/每日限额/冷却时间/备注、健康测试、停用/恢复、手动清冷却。

## 安全开关

- `RATE_LIMIT_LOGIN_PER_MIN`：登录接口按 `IP + email` 限流，默认每分钟 `5` 次。
- `ADMIN_IP_ALLOWLIST`：为空时不限制；填写后仅允许白名单 IP/CIDR 访问 `/admin` 与 `/api/admin/*`。
- 中间件会统一补安全响应头：`HSTS`、`CSP`、`X-Frame-Options`、`X-Content-Type-Options`、`Referrer-Policy`。
- 审计日志、导入错误、provider 测试错误都不会记录或返回明文密钥。

## 服务器加固基线

- 仅对公网开放 `22/80/443`。
- SSH 仅允许密钥登录，禁用 root 与密码认证。
- 应用容器仅绑定到 `127.0.0.1`，由 nginx/Caddy 反代到公网。
- 建议启用 `fail2ban` 保护 `sshd` 和 nginx 基本爆破流量。
- 生产环境应保持 `.env` 权限为 `600`，并开启系统自动安全更新。

## 当前状态

这版已经从纯 mock 推进到可运行业务链路：有数据库和 Redis 时会创建真实任务、扣点、入队、调用 Provider、写回状态和图片记录；未启动基础设施时接口会 fail closed，并通过 `/api/health` 与 `pnpm dev:doctor` 给出诊断和启动步骤。
