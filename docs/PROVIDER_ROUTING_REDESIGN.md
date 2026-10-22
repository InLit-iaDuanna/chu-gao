# 上游生图 API 智能路由、检测与恢复 — 重构方案

> 当前版本：`lib/providers/index.ts` + `account-pool.ts` + `health.ts`  
> 目标：高并发下更少的无效重试、更快的故障感知、更准确的账号评分

---

## 一、当前痛点

| 问题 | 当前代码位置 | 影响 |
|------|------------|------|
| cooldown 时间固定（限速5分钟、瞬时1分钟），不管实际 API 限速窗口 | `health.ts:markAccountErrored` | 限速恢复前账号仍被重试，浪费并发槽 |
| 账号排序只在选择时排一次，不感知实时健康变化 | `account-pool.ts:compareProviderAccounts` | 已限速账号可能排第一 |
| 健康探测完全依赖真实任务失败，没有独立 ping | `providers/index.ts` | 坏账号只有在真实用户任务失败后才被标记 |
| `consecutiveErrors` 不区分错误类型 | `health.ts` | 限速（可恢复）和认证失效（不可恢复）共用同一计数器 |
| 所有账号共享同一 `ProviderAccount` 表，无跨账号全局限速感知 | `providers/index.ts:selectAndGenerate` | A账号限速后仍会把同一渠道的B账号试完再报错 |
| 恢复间隔固定60秒，stuck 任务等待过长 | `generation.worker.ts` | 高并发下堵单 |

---

## 二、目标架构

```
                ┌─────────────────────┐
                │  selectAndGenerate  │
                └────────┬────────────┘
                         │
              ┌──────────▼──────────┐
              │  ChannelHealthCache │  (Redis, 30s TTL)
              │  per-channel score  │
              └──────────┬──────────┘
                         │
          ┌──────────────▼───────────────┐
          │   AccountScorer (in-memory)  │
          │  priority + reliability +    │
          │  adaptive cooldown score     │
          └──────────────┬───────────────┘
                         │
          ┌──────────────▼───────────────┐
          │      leaseProviderAccount    │
          │  (atomic, existing, no change)│
          └──────────────┬───────────────┘
                         │
          ┌──────────────▼───────────────┐
          │      adapter.generate()      │
          └──────────────┬───────────────┘
                         │
          ┌──────────────▼───────────────┐
          │   updateAccountScore()       │
          │   (success / fail / ratelimit)│
          └──────────────────────────────┘
```

---

## 三、具体改动

### 3.1 自适应 cooldown（改动量：小）

**文件**：`lib/providers/health.ts`

现在固定 5 分钟：
```ts
cooldownUntil: isRateLimited(error) ? new Date(Date.now() + 5 * 60_000) : ...
```

改为从响应头读 `Retry-After`，失败时按指数退避：
```ts
function adaptiveCooldownMs(error: unknown, accountErrors: number): number {
  // 优先读 Retry-After 响应头
  if (error instanceof ProviderRequestError) {
    const retryAfter = error.diagnostic.retryAfterSeconds;
    if (retryAfter && retryAfter > 0) {
      return Math.min(retryAfter * 1000, 30 * 60_000); // 最长30分钟
    }
  }
  // 指数退避：60s, 2min, 4min, 8min, 最长15min
  const base = isRateLimited(error) ? 60_000 : 30_000;
  return Math.min(base * Math.pow(2, Math.max(0, accountErrors - 1)), 15 * 60_000);
}
```

需要在 `ProviderRequestError` 的 `diagnostic` 上补充 `retryAfterSeconds?: number`，从 HTTP 响应头解析。

### 3.2 分类错误计数器（改动量：小）

**文件**：`prisma/schema.prisma` + `lib/providers/health.ts`

在 `ProviderAccount` 上加两个字段，区分限速和故障：
```prisma
rateLimitErrors    Int      @default(0)
transientErrors    Int      @default(0)
// 保留现有 consecutiveErrors 用于综合排序
```

这样排序时可以给限速账号（可恢复）比认证失效账号（不可恢复）更高的优先级。

### 3.3 渠道级全局冷却（改动量：中）

**新文件**：`lib/providers/channel-circuit-breaker.ts`

当一个渠道（如 `gpt-image-2`）下的全部账号都在 cooldown 时，直接短路，不逐个尝试：

```ts
export async function isChannelCircuitOpen(
  providerChannelId: string,
): Promise<boolean> {
  const redis = getRedis();
  const key = `channel:circuit:${providerChannelId}`;
  const val = await redis.get(key);
  return val === "open";
}

export async function tripChannelCircuit(
  providerChannelId: string,
  durationMs: number,
): Promise<void> {
  const redis = getRedis();
  const key = `channel:circuit:${providerChannelId}`;
  await redis.set(key, "open", "PX", durationMs);
}
```

在 `selectAndGenerate` 的账号遍历结束后：若所有账号都失败且均因限速，写入渠道级熔断（TTL = 最短 cooldownUntil），下次请求直接 `throw ProviderCapacityError`，跳过DB查询。

### 3.4 后台健康探测（改动量：中）

**新文件**：`lib/providers/health-probe.ts`

不依赖真实任务，定期用最小 payload 主动探活（如 1×1 透明PNG生图）：

```ts
export async function probeAccountHealth(accountId: string): Promise<void> {
  // 只在账号处于 DEGRADED 状态且 cooldownUntil 已过时运行
  // 使用最小计费参数，成功则 markAccountHealthy，失败继续等待
}
```

在 `generation.worker.ts` 的 `runRecoveryPass` 里每 5 分钟调用一次，只探 DEGRADED 账号，不探 HEALTHY。

**注意**：探测会消耗少量积分，使用专用系统账户，在 `.env` 中配置 `HEALTH_PROBE_USER_ID`。

### 3.5 改进账号评分（改动量：小）

**文件**：`lib/providers/account-pool.ts`，`accountReliabilityScore()`

现在靠 string match 判断错误类型：
```ts
if (account.lastErrorMsg?.includes("访问被拒绝")) score -= 5_000;
```

改为利用新的分类计数器：
```ts
function accountReliabilityScore(account: ProviderAccountWithProvider): number {
  let score = account.weight * 10;
  if (account.lastHealthyAt) score += 10_000;
  // 认证失效比限速扣分更多
  score -= account.rateLimitErrors * 200;
  score -= account.transientErrors * 500;
  score -= account.consecutiveErrors * 300;
  // cooldown 中的账号直接放到最后
  if (account.cooldownUntil && account.cooldownUntil > new Date()) {
    score -= 50_000;
  }
  return score;
}
```

---

## 四、实施顺序

| 阶段 | 内容 | 风险 | 预计工时 |
|------|------|------|---------|
| P0 | 3.1 自适应 cooldown + 读 Retry-After | 低，纯逻辑改动 | 1-2h |
| P1 | 3.5 改进账号评分（cooldown 账号降权） | 低，纯排序改动 | 1h |
| P2 | 3.3 渠道级熔断（Redis） | 中，需要测试熔断触发阈值 | 2-3h |
| P3 | 3.2 分类错误计数器（schema 迁移） | 中，需要迁移 | 2h |
| P4 | 3.4 后台健康探测 | 高，有实际 API 调用成本 | 3-4h |

P0+P1 可以立即实施，风险极低，马上能改善现有账号在限速后继续被踩的问题。

---

## 五、不改动的部分

- BullMQ 队列架构和 worker 并发模型（已经足够好）
- `leaseProviderAccount` 原子租约逻辑（正确，不碰）
- `ProviderAccountLease` 表结构（稳定）
- generation recovery 机制（已足够健壮）

---

## 六、关键指标

改完后可以通过以下 SQL 观察效果：

```sql
-- 账号健康分布
SELECT health, COUNT(*) FROM "ProviderAccount" GROUP BY health;

-- 最近1小时限速次数最多的账号
SELECT name, "rateLimitErrors", "consecutiveErrors", "cooldownUntil"
FROM "ProviderAccount"
WHERE "lastErrorAt" > NOW() - INTERVAL '1 hour'
ORDER BY "rateLimitErrors" DESC
LIMIT 20;

-- 渠道成功率
SELECT
  pa."baseUrl",
  COUNT(*) FILTER (WHERE g.status = 'DONE') AS success,
  COUNT(*) FILTER (WHERE g.status = 'FAILED') AS failed
FROM "Generation" g
JOIN "ProviderAccount" pa ON pa.id = g."providerAccountId"
WHERE g."createdAt" > NOW() - INTERVAL '1 hour'
GROUP BY pa."baseUrl";
```
