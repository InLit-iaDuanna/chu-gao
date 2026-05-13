# 对话同步记录

这个文件用来给不同对话之间同步重要上下文。  
原则很简单：只记结论、状态、风险和下一步，不记密钥、不记完整敏感内容。

## 当前状态

- 项目：`Chūgǎo Studio`
- 形态：Next.js + Prisma + Redis + BullMQ
- 当前重点：图像生成、后台号池、服务器安全、渠道稳定性

## 最近确认

- 号池已存在，后台支持导入、编辑、测试、停用/恢复。
- `GENERATION_TIMEOUT_MS`、`PROVIDER_REQUEST_TIMEOUT_MS`、`PROVIDER_ACCOUNT_MAX_ATTEMPTS` 已接入。
- `502 Upstream access forbidden` 这类错误已被单独识别，账号会直接下线，不再只冷却。
- SSH 已做过加固，但生产机仍需以实际连通性为准再验证一次。

## 重要环境变量

- `GENERATION_TIMEOUT_MS`
- `PROVIDER_REQUEST_TIMEOUT_MS`
- `PROVIDER_ACCOUNT_MAX_ATTEMPTS`
- `RATE_LIMIT_LOGIN_PER_MIN`
- `ADMIN_IP_ALLOWLIST`

## 重要文件

- `README.md`
- `lib/providers/index.ts`
- `lib/providers/diagnostics.ts`
- `lib/providers/config.ts`
- `workers/generation.worker.ts`
- `middleware.ts`

## 待办

- 重新在服务器上跑一次低成本生成，确认账号池是否真正切号。
- 如果还有坏账号，继续补自动下线规则。
- 保持 README 和这个记录文件同步更新。

## 记录格式建议

每次对话结束前，优先补这几项：

1. 已完成什么。
2. 现在卡在哪里。
3. 下一步要做什么。
4. 哪些文件被改过。
5. 哪些配置或服务器状态变了。

## 注意

- 不要贴真实 API key。
- 不要贴完整 cookie、token、授权头。
- 不要把未验证的猜测写成结论。
