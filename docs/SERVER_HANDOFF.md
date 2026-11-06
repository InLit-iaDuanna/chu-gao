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
| 生产备份 | `/opt/server-fix-backups/20261020-agent-access` |

当前已确认的 ED25519 主机指纹：

```text
SHA256:ik7pY68f/Xb4QUJVqIaLXGGXBNq19oS5eNm1LRvGZhg
```

该指纹曾在 2026-10-20 由用户确认。若再次出现不同指纹，先停止，不要使用 `StrictHostKeyChecking=no`，让用户重新核对。

## 物理网卡直连

此前系统默认路由指向 `utun6`，仅取消 HTTP 代理不会绕过 TUN。当前可用的物理网络接口是 `en13`，地址通常为 `172.20.10.4`，网关通常为 `172.20.10.1`。

先检查接口：

```bash
networksetup -listallhardwareports
ifconfig en13
route -n get -ifscope en13 198.44.177.67
```

如果 `en13` 仍是 active，并且路由显示 `interface: en13`，使用下面的 SSH 命令。`nc -b en13` 是本机 TCP socket 的接口绑定，不是远程代理。

连接前做一次硬性检查：

```bash
route -n get 198.44.177.67
nc -4 -v -b en13 -G 8 -w 8 198.44.177.67 22
```

目标路由必须显示 `interface: en13`，不能显示 `utun0`、`utun1`、`utun6` 等 TUN 接口；`nc` 应能看到类似 `SSH-2.0-OpenSSH` 的 banner。若仍落到 `utun*` 或连接超时，停止，不要继续输密码。`HTTP_PROXY`、`HTTPS_PROXY`、`ALL_PROXY` 即使已取消，也不能替代 `-b en13`；SSH 是否直连以 socket 绑定和目标路由为准。

首次连接使用专用 known_hosts 文件，并核对上面的指纹：

```bash
mkdir -p "$HOME/.ssh"
touch "$HOME/.ssh/chugao-198.44.177.67_known_hosts"
chmod 600 "$HOME/.ssh/chugao-198.44.177.67_known_hosts"

ssh \
  -o ProxyJump=none \
  -o 'ProxyCommand=/usr/bin/nc -4 -b en13 -G 12 %h %p' \
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
  -o ProxyJump=none \
  -o 'ProxyCommand=/usr/bin/nc -4 -b en13 -G 12 %h %p' \
  -o UserKnownHostsFile="$HOME/.ssh/chugao-198.44.177.67_known_hosts" \
  -o StrictHostKeyChecking=yes \
  root@198.44.177.67
```

不要使用下面这些方式连接：

```text
ssh root@198.44.177.67                 # 可能跟随系统默认 TUN 路由
ssh -o ProxyJump=...                   # 会经过跳板或代理
ssh -o StrictHostKeyChecking=no ...    # 不核对服务器身份
```

非交互执行只需要把最后一段替换为远程命令，例如：

```bash
ssh \
  -o ProxyJump=none \
  -o 'ProxyCommand=/usr/bin/nc -4 -b en13 -G 12 %h %p' \
  -o UserKnownHostsFile="$HOME/.ssh/chugao-198.44.177.67_known_hosts" \
  -o StrictHostKeyChecking=yes \
  root@198.44.177.67 \
  'hostname; id; pwd; docker ps --format "table {{.Names}}\\t{{.Status}}"'
```

若 `en13` 不存在，不能直接改走 `utun`。先找当前真正的物理出口接口，再替换命令中的 `en13`：

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
curl --interface en13 --noproxy '*' \
  --resolve chugao.art:443:198.44.177.67 \
  --connect-timeout 8 --max-time 20 \
  -sS -o /dev/null -w '%{http_code} local=%{local_ip} remote=%{remote_ip}\\n' \
  https://chugao.art/api/health
```

预期结果为 `200`，并且 `local=172.20.10.4`、`remote=198.44.177.67` 或同一物理接口上的当前地址。

## 当前生产状态

- 当前 web 版本：`agent-access-20261020`
- 当前 worker 版本：`r3-recovery-20261018-105800`，本次 Agent 发布没有重启 worker
- Agent 授权迁移：`20261020090000_agent_authorizations`
- 已应用迁移数量：18
- web、worker、PostgreSQL、Redis 均应为 healthy
- Agent Skill 下载包包含三项：`SKILL.md`、`scripts/chugao.py`、`references/api.md`
- 生产备份、数据库 dump、Redis 快照、存储清单和校验文件在 `/opt/server-fix-backups/20261020-agent-access`

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
4. 先在临时端口构建并检查，再执行 `prisma migrate deploy`。
5. 切换后检查 web、worker 健康状态和公网 `/api/health`。
6. 对用户、积分、图片、渠道、定价和存储做前后校验。

## 新对话启动模板

把下面内容作为新对话的第一条消息，并让它先读取本文件：

```text
请先阅读项目文档 docs/SERVER_HANDOFF.md，再连接生产服务器。
目标是 198.44.177.67:22，用户 root。当前 Mac 不要走代理或 TUN，SSH 必须通过物理网卡 en13：
nc -4 -b en13 -G 12 %h %p
首次连接使用文档中的专用 UserKnownHostsFile，并核对 ED25519 指纹；不要使用 StrictHostKeyChecking=no。
连接后先只读核验 /opt/chugao-v2.3-main、docker compose、web/worker 健康状态和迁移版本。
不要覆盖 .env、数据库、Redis、私有存储卷、用户、积分、图片、渠道或定价；不要使用 /opt/chugao-studio。
任何发布前先创建备份，并只做增量发布。
``` 
