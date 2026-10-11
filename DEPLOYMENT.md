# 部署与服务器迁移指南

> 面向运维：把本系统部署到一台新服务器（校园网环境），以及把已有部署整体迁移到另一台服务器。
> 应用默认端口 **3002**，前端由后端一并托管（生产模式下 `packages/client/dist` 由 Express 静态托管并做 SPA 回退），因此**只需要暴露一个端口**。

---

## 一、新服务器要求

| 项 | 要求 | 说明 |
| --- | --- | --- |
| 操作系统 | Linux x86_64 | 已在 Ubuntu/Debian 验证 |
| Node.js | **≥ 18，推荐 20 LTS** | 裸机部署需要；Docker 部署由镜像自带 |
| PostgreSQL | **15**（14+ 可用） | Docker 部署由 compose 拉起 |
| Redis | **7**（6+ 可用） | 判分队列、缓存；不启动则批量判分退化为同步执行 |
| 内存 | ≥ 4 GB | 一场 3000 人考试的 Node 进程实测占用 < 1 GB，余量留给 PG 与构建 |
| 磁盘 | ≥ 20 GB | 数据库 + 上传文件 + 导出文件 |
| 网络 | 学生端可访问；服务器可出网访问 `openapi.wps.cn` 与所选大模型 API | WPS 判分是服务端直连开放平台，**服务器必须能出公网** |

> ⚠️ **时间同步**：服务器务必开启 NTP。考试截止时间、自动收卷都基于服务器时间，服务器时钟漂移会直接导致提前/延后收卷。

---

## 二、部署方式

### 方式 A：Docker Compose（推荐）

```bash
git clone <仓库地址> && cd <目录>
cp .env.production .env      # 该模板里 DATABASE_URL/REDIS_URL 已用 compose 服务名
# 编辑 .env：至少改 JWT_SECRET（openssl rand -base64 48）
docker compose up -d
docker compose logs -f app   # 观察迁移与启动日志
```

容器入口脚本会自动：等待 PostgreSQL → `prisma migrate deploy` → 若库为空则导入种子数据 → 启动服务。

**端口绑定**：默认 `app` 只绑 `127.0.0.1:3002`，适用于「同机反向代理 / 内网穿透」。
若要让学生直连本机 3002，在 `.env` 里加 `APP_BIND=0.0.0.0` 后 `docker compose up -d`。
数据库（5432）与 Redis（6379）**始终只绑回环**，不要对外暴露。

### 方式 B：裸机（Node + 系统服务）

```bash
npm ci
cp .env.example .env         # DATABASE_URL / REDIS_URL 指向本机（不能用 compose 服务名）
npm run db:migrate           # 等价 prisma migrate deploy（生产用 deploy，不要用 dev）
npm run db:seed              # 仅在空库首次执行；有数据时会被安全闸门拦下
npm run build                # 编译后端 + 构建前端
NODE_ENV=production node packages/server/dist/index.js
```

生产环境请用 systemd/pm2 托管并配置自动重启。注意：

- **工作目录很重要**：`config/index.ts` 用 `dotenv` 按**进程 cwd** 加载 `.env`，导出目录默认也是 `<cwd>/exports`。若用 systemd，请显式设置 `WorkingDirectory=`；或改用环境变量 `EXPORT_DIR` 指定导出目录。
- `JWT_SECRET` 必须是强随机值（生产环境弱密钥会**拒绝启动**，这是有意设计）。

---

## 三、从旧服务器迁移到新服务器

### 3.1 需要搬走的四样东西

| # | 内容 | 位置 | 说明 |
| --- | --- | --- | --- |
| 1 | **代码** | 仓库 | 建议用同一个 commit |
| 2 | **数据库** | PostgreSQL `examination_system` | 账号、题库、试卷、考试、答卷、成绩、批改留痕都在这里 |
| 3 | **上传文件** | `packages/server/uploads/`（容器卷 `app_uploads`） | 学生名单导入的原文件与错误报告 |
| 4 | **导出文件** | `<cwd>/exports`（容器卷 `app_exports`） | 历史导出任务下载用；**不搬则历史导出全部 404** |

> 数据库里已经存了 WPS 应用凭据与 access/refresh token（`wps_config` 表），
> 所以 **WPS 无需重新授权**。`KINGSOFT_API_KEY/SECRET` 环境变量只是兜底。

### 3.2 操作步骤

```bash
# ── 旧服务器 ──
# 1) 停服，避免迁移过程中数据还在变（考试期间不要迁移）
docker compose stop app            # 裸机则由 systemd/pm2 停服务

# 2) 导出数据库
docker exec exam-postgres pg_dump -U exam_user -d examination_system -Fc -f /tmp/exam.dump
docker cp exam-postgres:/tmp/exam.dump ./exam.dump

# 3) 打包上传与导出目录
docker run --rm -v <项目名>_app_uploads:/data -v "$PWD":/backup alpine \
  tar czf /backup/uploads.tar.gz -C /data .
docker run --rm -v <项目名>_app_exports:/data -v "$PWD":/backup alpine \
  tar czf /backup/exports.tar.gz -C /data .

# 4) 一并带走 .env（含 JWT_SECRET——不带走则所有已登录用户需重新登录）
```

```bash
# ── 新服务器 ──
git clone <仓库地址> && cd <目录>
# 放入 .env（按新服务器改 DATABASE_URL 里的主机名；Docker 部署用 postgres/redis）

docker compose up -d postgres redis        # 先只起数据库
# 5) 还原数据库（用 docker exec 管道，库名需与 .env 一致）
docker exec -i exam-postgres pg_restore -U exam_user -d examination_system --clean --if-exists < exam.dump
#   若提示数据库不存在，先创建：docker exec exam-postgres createdb -U exam_user examination_system

# 6) 还原文件目录
docker run --rm -v <新项目名>_app_uploads:/data -v "$PWD":/backup alpine \
  sh -c "cd /data && tar xzf /backup/uploads.tar.gz"
docker run --rm -v <新项目名>_app_exports:/data -v "$PWD":/backup alpine \
  sh -c "cd /data && tar xzf /backup/exports.tar.gz"

# 7) 启动
docker compose up -d
docker compose logs -f app
```

### 3.3 迁移后自检

```bash
curl -s http://<新服务器>:3002/api/health          # {"status":"ok",...}
```

然后在浏览器里逐项确认：

1. 用**原有账号**登录（能登录 = 数据库还原成功、JWT_SECRET 一致）
2. 「我的考试」能看到历史考试（= 数据在）
3. 教师端 →「缓存管理 → WPS Token 管理」能看到 token 且**剩余有效期正常**（= WPS 凭据已随库迁移）
4. 随便找一份已判分的答卷，能看到分数与**批改留痕**（= 存档数据在）
5. 「数据导出中心」下载一个**历史导出任务**（= exports 目录已还原）
6. 用一名学生账号走一遍「环境检测 → 进入考场」，确认能打开表格

---

## 四、首次部署后必做（安全）

1. **改管理员口令**。种子数据会创建 `admin` 与 `teacher1~4`：
   - 部署前在 `.env` 设置 `ADMIN_INITIAL_PASSWORD=<强口令>`，种子会用它；
   - 未设置则自动生成随机口令并在**首次导入日志里打印一次**（`docker compose logs app` 里找）；
   - 无论如何，上线后请到「账户管理」再改一次。
2. **删除演示学生账号** `20252861` / `20252862`（口令 123456），或至少改密。
3. **配置 WPS**：「缓存管理 → WPS Token 管理」按引导向导填写应用凭据并完成一次授权。
4. **（可选）AI 辅助出题**：配置 LLM Provider 与 API Key，不配则相关入口不可用，不影响考试。
5. **配置 HTTPS**（强烈建议）：学生与 kdocs 的登录态交互在 HTTPS 下才稳定；没有 HTTPS 时，答题页右侧表格更容易落到「需要登录」而改用独立窗口模式。

### 反向代理要点（Nginx 示例）

```nginx
location / {
    proxy_pass http://127.0.0.1:3002;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_http_version 1.1;                       # WebSocket（监考实时推送）
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_read_timeout 300s;                      # 判分接口可能耗时较长
}
```

- 应用侧 `trust proxy` 生产环境默认为 `1`（信任一跳）。多级代理请设 `TRUST_PROXY=2`；直连（无代理）设 `TRUST_PROXY=false`。
- **IP 白名单功能依赖正确的真实 IP**：务必让代理覆盖 `X-Forwarded-For`，否则白名单判定的是代理 IP。
- 若需限制跨域来源，设 `CORS_ORIGINS=https://exam.example.edu.cn`（默认放开）。

---

## 五、常见坑（都是实际踩过的）

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| 启动即退出，日志说"生产环境必须配置强 JWT_SECRET" | `JWT_SECRET` 是默认值/太短 | 用 `openssl rand -base64 48` 生成 |
| `npm run db:seed` 报"数据库已有 N 个用户，已中止" | 安全闸门（种子会清空全部业务数据） | 正常！只有全新环境才需要加 `--force` |
| 历史导出任务下载 404 | `exports` 目录没跟着迁移 | 按 §3.1 搬运，或用 `EXPORT_DIR` 指向正确目录 |
| 判分全部报 token 过期 | `wps_config` 里的 token 失效且刷新失败 | 「WPS Token 管理」重新授权一次 |
| 学生看到"考试已结束"但时间没到 | 服务器时钟不准 | 开启 NTP |
| 批量阅卷点下去没有立刻出结果 | 已改为入队异步处理 | 看「自动阅卷」列表的状态刷新；确认 Redis 在运行 |
| `prisma migrate dev` 提示要清库 | 旧库 `_prisma_migrations` 里有历史遗留记录 | 生产/迁移一律用 `migrate deploy`，不要用 `migrate dev` |
| 学生人数上千后监控页卡 | 旧版本问题，已修（分页 + 事件节流） | 升级到本版本 |

---

## 六、日常备份（强烈建议配置）

迁移只是偶发操作，**日常备份才是数据安全的底线**。最小可用方案：

```bash
# 每天 02:00 备份数据库 + 上传/导出目录，保留 14 天
0 2 * * * cd /opt/exam && \
  docker exec exam-postgres pg_dump -U exam_user -d examination_system -Fc \
  | gzip > /backup/exam-$(date +\%F).dump.gz && \
  find /backup -name 'exam-*.dump.gz' -mtime +14 -delete
```

恢复方式与 §3.2 的 `pg_restore` 相同。考试当天建议**考前手动备份一次**（考完再备一次），
这样即便出现意外也能快速回到考前状态。

> 上传/导出目录是文件型数据，同样建议纳入每日备份（`app_uploads` / `app_exports` 两个卷）。

---

## 七、扩展到多实例（当前未支持，需先改造）

系统目前按**单实例**设计，以下状态在进程内存中，直接扩副本会导致行为不一致：

- Socket.IO 连接表（监考页只能看到本实例上的学生）→ 需接 `@socket.io/redis-adapter`
- `wpsConfigService` 的定时刷新（多实例会并用一次性 refresh_token，导致 token 链断裂）→ 需分布式锁
- `batchScheduler`（多实例重复收卷，幂等但浪费）→ 需改为 BullMQ 可重复任务
- 实时预览缓存（各实例独立，仅影响命中率）

在此之前，**单实例 + 足够规格的机器**是推荐形态（实测一台 4 核 8G 可支撑数千人在线答题）。
