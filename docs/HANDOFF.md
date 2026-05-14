# 基础交接信息

给新对话里的 agent 先读这份。这里只记录最基础信息，不放密钥。

## 项目

- 项目名：Chugao Studio
- 本地目录：`/Users/isduanna/Documents/New project 2`
- 技术栈：Next.js App Router + React + Prisma + Redis + BullMQ + Docker Compose
- 线上地址：`https://chugao.art/`
- 健康检查：`https://chugao.art/api/health`
- GitHub remote：`https://github.com/InLit-iaDuanna/chu-gao.git`
- 主分支：`main`

## 服务器

- SSH：`ssh n8n`
- 用户：`ubuntu`
- 主机名：`VM-0-9-ubuntu`
- 线上项目目录：`/opt/chugao-studio`
- 备份目录：`/opt/server-fix-backups`
- 服务器 `.env` 在 `/opt/chugao-studio/.env`，不要覆盖、不要打印。

## 线上服务

- Docker Compose 项目目录：`/opt/chugao-studio`
- 主要服务：`web`、`worker`、`postgres`、`redis`
- Web 容器本机端口：`127.0.0.1:3002 -> 3000`
- 反代域名：`chugao.art`、`www.chugao.art`

## 常用命令

```bash
ssh n8n
cd /opt/chugao-studio
sudo docker compose ps
sudo docker compose logs --tail=80 web worker
curl -sS -i http://127.0.0.1:3002/api/health
```

## 部署方式

服务器上的 `/opt/chugao-studio` 不是 Git 仓库，通常从本地同步源码过去。

部署前先备份：

```bash
ssh n8n 'TS=$(date +%Y%m%d-%H%M%S); mkdir -p /opt/server-fix-backups/$TS && rsync -a --exclude .env --exclude .data --exclude node_modules --exclude .next --exclude .playwright-cli --exclude output /opt/chugao-studio/ /opt/server-fix-backups/$TS/chugao-studio/ && echo $TS'
```

同步代码时保留服务器环境和数据：

```bash
rsync -az --delete --exclude='.git/' --exclude='.next/' --exclude='.data/' --exclude='node_modules/' --exclude='output/' --exclude='.playwright-cli/' --exclude='*.log' --exclude='tsconfig.tsbuildinfo' --exclude='.env' --exclude='.env.*' --exclude='!.env.example' ./ n8n:/opt/chugao-studio/
```

重建应用：

```bash
ssh n8n 'cd /opt/chugao-studio && sudo docker compose up -d --build web worker'
```

## 注意

- 不要覆盖服务器 `.env`。
- 不要重置数据库卷。
- 部署后检查 `/api/health`、`web` 日志、`worker` 日志。
