# Chugao 服务器交接

本文给新对话使用。目标是通过当前 Mac 的物理网卡直连生产服务器，不经过代理或 TUN；密码不写入仓库，连接时由操作者在 SSH 提示符中输入。

## 目标服务器

| 项目 | 值 |
| --- | --- |
| 地址 | `198.44.177.67` |
| SSH 端口 | `22` |
| 用户 | `root` |
| 系统 | Ubuntu 22.04 LTS |
| 域名 | `https://chugao.art` |
| 实际生产目录 | `/opt/chugao-v2.3-main` |
| Compose 项目 | `chugao-studio` |
| 保留旧目录 | `/opt/chugao-studio`，不要向这里发布 |
| 最近生产备份 | `/opt/server-fix-backups/20261107-gif-opus` |

当前已确认的 ED25519 主机指纹：

```text
SHA256:ik7pY68f/Xb4QUJVqIaLXGGXBNq19oS5eNm1LRvGZhg
```

该指纹曾在 2026-10-20 由用户确认。若再次出现不同指纹，先停止，不要使用 `StrictHostKeyChecking=no`，让用户重新核对。

## 物理网卡直连

2026-11-07 系统默认路由指向 `utun6`，仅取消 HTTP 代理不会绕过 TUN。当前验证可用的物理接口是 `en0`，本机地址 `192.168.31.62`。接口和地址可能随网络变化，连接前重新检查。

先检查接口：

```bash
networksetup -listallhardwareports
ifconfig en0
route -n get -ifscope en0 198.44.177.67
```

如果 `en0` 是 active，且该接口能到达服务器，使用下面的 SSH 命令。`nc -b en0` 将本机 TCP socket 绑定到物理接口。

连接前做一次硬性检查：

```bash
route -n get 198.44.177.67
nc -4 -v -b en0 -G 8 -w 8 198.44.177.67 22
```

无绑定的默认路由可能仍显示 `utun6`，这不能单独用于判断接口绑定的连接。上面的 `nc -b en0` 应能看到 `SSH-2.0-OpenSSH` banner；公网探针需显示物理接口的本机地址和目标服务器 IP。连接超时时先查物理出口。取消 `HTTP_PROXY`、`HTTPS_PROXY`、`ALL_PROXY` 不能替代 `-b en0`。

首次连接使用专用 known_hosts 文件，并核对上面的指纹：

```bash
mkdir -p "$HOME/.ssh"
touch "$HOME/.ssh/chugao-198.44.177.67_known_hosts"
chmod 600 "$HOME/.ssh/chugao-198.44.177.67_known_hosts"

ssh \
  -o 'ProxyCommand=/usr/bin/nc -4 -b en0 -G 12 %h %p' \
  -o UserKnownHostsFile="$HOME/.ssh/chugao-198.44.177.67_known_hosts" \
  -o StrictHostKeyChecking=ask \
  root@198.44.177.67
```

看到主机指纹后，仅当它等于：

```text
SHA256:ik7pY68f/Xb4QUJVqIaLXGGXBNq19oS5eNm1LRvGZhg
```

才输入 `yes`。随后在密码提示符中手动输入当前 root 密码，不要把密码放进命令行、脚本、`.env` 或交接文档。

后续已确认主机指纹后，可以使用：

```bash
ssh \
  -o 'ProxyCommand=/usr/bin/nc -4 -b en0 -G 12 %h %p' \
  -o UserKnownHostsFile="$HOME/.ssh/chugao-198.44.177.67_known_hosts" \
  -o StrictHostKeyChecking=yes \
  root@198.44.177.67
```

本机 OpenSSH 中，先指定 `ProxyJump=none` 会使后续 `ProxyCommand` 不生效，因此不要在这些命令中添加它。可用 `ssh -G` 检查最终生效的 `proxycommand`。不要使用下面这些方式连接：

```text
ssh root@198.44.177.67                 # 可能跟随系统默认 TUN 路由
ssh -o ProxyJump=...                   # 会经过跳板或代理
ssh -o StrictHostKeyChecking=no ...    # 不核对服务器身份
```

非交互执行只需要把最后一段替换为远程命令，例如：

```bash
ssh \
  -o 'ProxyCommand=/usr/bin/nc -4 -b en0 -G 12 %h %p' \
  -o UserKnownHostsFile="$HOME/.ssh/chugao-198.44.177.67_known_hosts" \
  -o StrictHostKeyChecking=yes \
  root@198.44.177.67 \
  'hostname; id; pwd; docker ps --format "table {{.Names}}\\t{{.Status}}"'
```

若 `en0` 不可用，先找当前真正的物理出口接口，再替换命令中的 `en0`：

```bash
networksetup -listallhardwareports
ifconfig -a
route -n get -ifscope <物理接口> 198.44.177.67
```

## 连接后先做只读核验

```bash
hostname
id
cd /opt/chugao-v2.3-main
docker compose -p chugao-studio ps
docker inspect chugao-studio-web-1 chugao-studio-worker-1 \
  --format '{{.Name}} {{.State.Health.Status}} {{.Image}}'
docker exec chugao-studio-postgres-1 psql -U app -d app -Atc \
  'SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL ORDER BY migration_name DESC LIMIT 1;'
```

公网检查使用物理接口和域名解析固定到服务器 IP：

```bash
curl --interface en0 --noproxy '*' \
  --resolve chugao.art:443:198.44.177.67 \
  --connect-timeout 8 --max-time 20 \
  -sS -o /dev/null -w '%{http_code} local=%{local_ip} remote=%{remote_ip}\\n' \
  https://chugao.art/api/health
```

2026-11-07 已验证结果为 `200 local=192.168.31.62 remote=198.44.177.67`。

## 当前生产状态

- 当前 web、worker 版本：`gif-opus-20261107`
- 最近迁移：`20261107090000_model_call_logs`
- 已应用迁移数量：21
- web、worker、PostgreSQL、Redis 均应为 healthy
- Agent Skill 下载包包含三项：`SKILL.md`、`scripts/chugao.py`、`references/api.md`
- 本轮发布前和切换时的数据库 dump、源码、环境文件、构建日志、文件清单和数据指纹在 `/opt/server-fix-backups/20261107-gif-opus`；前两轮备份在 `20261107-observability`、`20261107-image26`。
- 回滚镜像：`chugao-studio-web:before-gif-opus-20261107`、`chugao-studio-worker:before-gif-opus-20261107`。回滚代码时还应停用新增保底渠道和 Opus 配置；用户账本不能整库回退。
- Image2.6、flare、sunburst 已注册并沿用当前 Image2.5 的定价：1K 8 点、2K 10 点、4K 16 点、auto 9 点。后台仍可按渠道调整；已有规则不被初始化脚本覆盖。
- 已修复 Node 22 图片下载 DNS lookup 的 `all:true` 返回类型，避免 `Invalid IP address: undefined`。
- `/admin/model-calls` 按语言模型、网站生图、API 生图、Agent 生图查看调用；任务详情关联结果图、参考图、请求 ID 和错误。历史对话回填脚本 `scripts/backfill-model-calls.ts` 幂等，只写入日志摘要。
- 渠道与账号选择保留优先级，按占用/轮询策略租用，尊重重试上限；忙碌账号不耗次数，模型熔断相互隔离。显式指定渠道时不跨渠道切换。
- 上一轮日志发布验证：164 项回归通过，类型检查与生产构建通过；48 张原有业务表指纹一致，35 个发布文件匹配，`.env` 和卷挂载不变。已回填历史语言调用 108 条，生产后台页面、18 个页面资源和两类私有缩略图访问通过。
- 本轮 GIF：Image2.6 系列开放 GIF 格式和 `512x512 / 768x768` 请求尺寸；仅路由到已标记 `supportsGif` 的渠道，目前为 `https://ai.ldai.us`。保存完整动画字节，预览保持动画，下载 MIME 为 `image/gif`、扩展名为 `.gif`。实际返回尺寸可能不同，不宣传为 4K GIF；普通静态图已实测返回 3840x2160。
- 保底渠道 ID 固定为 `ldai-fallback`，新密钥仅加密保存在数据库；普通池本轮失败后才用，忙碌排队不会切换昂贵保底，显式渠道限制仍生效。保底倍率为 2，提交时冻结价格并在派发前预留差额，成功按实际尺寸结算，失败退款。普通用户看不到渠道身份。
- Opus 5.5 模型 ID 为 `claude-opus-5-5`，上游 `https://botcf.com`，Chat Completions SSE，支持 `low / medium / high / xhigh / max`。后台 `/admin/integrations` 可改开关、密钥、地址和费率。每百万 Token：输入 100、输出 500、缓存读取 5、缓存创建 60 积分，保留六位小数，重复缓存字段不重复收费；无有效用量时保留回答并退款。原默认聊天模型仍为 Sol。
- 本轮验证：GIF 存储、预览和下载、保底并发预留与退款、Opus 缓存结算和末尾 usage 帧均通过；完整类型检查、相关 ESLint 和生产构建通过。独立 PostgreSQL 聊天集成首轮 31 项通过，另外两项修正后复跑通过。桌面和 390px 手机布局、三帧 GIF 动画、后台费率保存均已核验。发布期间未追加付费上游请求。
- 切换时 48 组数据指纹一致，保留用户、余额、原图、原有账号及原有定价；`.env` 不变，无新数据库迁移。公网通过 en0 直连返回 200，对话 worker 协议为 v2。

## 本轮开发与证据

本轮源码在 `/Users/isduanna/.codex/workspaces/chugao-gif-20261107`，基线为生产版本 `observability-20261107`。原 Documents 项目存在 iCloud 占位文件和未发布画布修改，因此没有整目录覆盖。后续发布必须合并本轮 GIF、保底和 Opus 改动，不能直接推送旧源码。服务器保留发布源码目录 `/opt/chugao-release-gif-opus-20261107`。

本机发布包、SHA256 清单、交接文档和截图保存在 `/Users/isduanna/.codex/artifacts/chugao-gif-opus-20261107`。测试使用独立 PostgreSQL、Redis 和图片卷，未接入生产用户数据，验证完成后移除。

既有迁移链缺少 Research 模型对应迁移，完整迁移一致性检查会报告基线漂移。本轮未修改 Prisma schema；不要为消除该历史差异在生产运行 `db push` 或重置数据库。

## 发布边界

生产环境中的 `.env`、PostgreSQL、Redis、私有存储卷、用户、积分、图片、渠道账号和定价不能被本地文件覆盖。不要执行以下操作：

```text
git reset --hard
prisma db push
prisma migrate reset
docker compose down -v
把本地 .env、.data、node_modules、.next 或整个工作树 rsync 到服务器
向 /opt/chugao-studio 发布
```

发布前必须：

1. 读取 `/opt/chugao-v2.3-main` 的当前版本并与本地变更比较。
2. 在 `/opt/server-fix-backups` 创建新的受保护备份。
3. 只传输已审查的增量文件和对应迁移。
4. 先在临时端口构建并检查；有新增迁移时才执行 `prisma migrate deploy`。
5. 切换后检查 web、worker 健康状态和公网 `/api/health`。
6. 对用户、积分、图片、渠道、定价和存储做前后校验。

## 新对话启动模板

把下面内容作为新对话的第一条消息，并让它先读取本文件：

```text
请先阅读项目文档 docs/SERVER_HANDOFF.md，再连接生产服务器。
目标是 198.44.177.67:22，用户 root。当前 Mac 不要走代理或 TUN，检查并使用物理网卡 en0：
nc -4 -b en0 -G 12 %h %p
首次连接使用文档中的专用 UserKnownHostsFile，并核对 ED25519 指纹；不要使用 StrictHostKeyChecking=no。
连接后先只读核验 /opt/chugao-v2.3-main、docker compose、web/worker 健康状态和迁移版本。
不要覆盖 .env、数据库、Redis、私有存储卷、用户、积分、图片、渠道或定价；不要使用 /opt/chugao-studio。
任何发布前先创建备份，并只做增量发布。
``` 
