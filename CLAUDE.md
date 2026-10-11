# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概览

基于 WPS 多维表格的**实操**考试系统：考生在网页里操作真实的 WPS 多维表格作答，交卷后系统读取表格 Schema，由规则引擎逐条比对自动判分。npm workspaces monorepo：`packages/server`（Express + Prisma + Socket.IO + BullMQ）、`packages/client`（React 18 + Ant Design 6 + Vite）。

## 常用命令

```bash
npm install                 # 根目录安装（workspaces 提升依赖到根 node_modules）
npm run dev                 # 并行启动：后端 tsx watch :3002 + 前端 Vite :5173
npm run build               # 先 build server（tsc）再 build client（tsc -b && vite build）
npm run db:migrate          # prisma migrate dev（等价 npm run db:migrate -w packages/server）
npm run db:seed             # 写入种子数据（题库/账号/考试）
npm run db:studio           # Prisma Studio
npm run docker:up / docker:down

# 测试（根目录没有 test 脚本，必须指定 workspace）
npm test -w packages/server           # vitest run
npm test -w packages/client           # vitest run
npx vitest run src/routes/__tests__/wps-preview.test.ts   # 单文件（在对应 package 目录下执行）
npx vitest run -t "用例名"                                 # 单用例

# 类型检查（没有配置 lint，不要假设存在）
cd packages/server && npx tsc --noEmit -p tsconfig.json
cd packages/client && npx tsc --noEmit -p tsconfig.json
```

本地依赖：PostgreSQL 15 + Redis 7（`docker compose up -d postgres redis` 即可，均只绑定 127.0.0.1）。

## 架构要点

### 请求链路
`app.ts` 按模块挂载 `/api/<module>` 路由；绝大多数路由在文件头统一 `router.use(authenticate)` + `router.use(authorize('teacher'|'student'|'admin'))`（少数在 `app.ts` 挂载处加 `authenticate`，如 notifications）。**例外**：`routes/demo.ts` 有意免认证（Mock 判分演示）；`routes/audit.ts` 目前**没有任何鉴权**且自带一份 `new PrismaClient()`，其 `/api/audit/logs`（全量审计日志）、`/api/audit/cleanup`（按 `retainDays` 批量删除，传 0 即清空）对可达网络的任何人开放——改这块时按标准模式补上鉴权，别让缺口扩大。

`middleware/exam-lock.ts` 的 `rejectExamConfigMutationWhenEnded()` 用于考场分配与表格分配等配置接口；考试自身的 `ended` 校验是 `routes/exams.ts` 内联的（约 251 行）。`middleware/audit-middleware.ts` 全局记录 CRUD 审计。

客户端请求默认走 `services/api.ts`（axios，baseURL `/api`，自动附 JWT，401 跳登录）；唯一例外是 AI 辅助出题的 SSE 流式接口 `services/coachingApi.ts`（裸 `fetch` + `services/sse-parser.ts`）。Vite 把 `/api` 与 `/socket.io` 代理到 `:3002`（Socket.IO 走代理是为了内网穿透域名下 WebSocket 也能连上）。

### 判分核心：引擎是纯函数
`engine/rule-engine.ts` 是判分核心，**不依赖数据库、不发网络请求**，只接收 `SchemaResponse`（+ 可选 `RecordData`）与题目的 `answerRules`。规则是 `{ action, params, score }`，处理器注册在 `ruleHandlers: Record<string, RuleHandler>`（29 个 action，另有 `getActionLabel()` 维护中文标签）。

- 新增验证器 = 往 `ruleHandlers` 加一个 handler + 在 `getActionLabel` 补标签，`params` 用 `rule.params` 取。
- 无法从 Schema 完整判定的规则返回 `needsReview: true`，前端标为「待复核」交人工阅卷，**不要**为了自动化硬判。
- `engine/adapters/kingsoft-adapter.ts` 负责把 WPS 数据转成引擎可吃的 Schema/RecordData；`engine/demo-schemas.ts` 提供离线样例，`engine/__tests__` 里的测试不碰网络。

### 出题辅助链路（能力图谱驱动）
`data/capabilities/*.ts`（tables/fields/field-props/views/forms/records）是静态 TS 常量构成的能力图谱 `capability-graph.ts`。链路：勾选能力点 → `engine/skeleton-generator.ts` 生成题目骨架 + 标准答案表 → 教师导入标准答案 → `engine/answer-reverser.ts` 从真实 Schema 反向解析出 `answerRules`（`POST /api/questions/skeleton`、`/reverse-rules`）。`coaching/`（AI 辅助出题）同样依赖 `answerReverser.groundProposal` 把 LLM 提案落到真实字段上，改规则结构时要同步这条链路。

### 考试与答卷状态
- `ExamMode`：`unified`（集中统一）/ `flexible`（随到随考）；批次 `Batch` 有 draft → published → … 的级联发布。
- `SubmissionStatus`：`in_progress → submitted → grading → graded`。**交卷不会自动判分**（`my-exams.ts` submit 里的自动判分已注释关闭），由教师在「阅卷管理 → 自动阅卷」触发 `jobs/grading-queue.ts` 的 `enqueueGrading`。
- 倒计时口径唯一来源是客户端 `utils/exam-time.ts` 的 `computeExamDeadline`（基于 `exam.endTime`，不是 `submission.startedAt`），服务端 `autoEndExpiredExams()` 按同一口径收卷——改动时间逻辑必须同时看这几处。
- 学生可见性统一用 `utils/exam-utils.ts` 的 `studentExamVisibilityOR()`，不要另写过滤条件。

### WPS 集成（最易踩坑的部分）
- `KingsoftAdapter` 支持两套 API：v7（`/v7/coop/dbsheet`，Bearer token，默认）与 v3（`/kopen/office/file`，WPS-3 签名）。用 `createAdapterFromSpaceId('fileId:accessToken')` 构造，无 token 时回退环境变量凭据。
- **Token 取用顺序**：`WpsConfig` 表（单行 `id='wps_config'`）里由 `services/wps-config-service.ts` 自动刷新的**当前** token 优先；`ExamTableAssignment.accessToken` / `PracticeTableAssignment.accessToken` 只是「分配当时的快照」，24 小时即失效。直接照抄快照 token 会拿到 `401000001 invalid_token`。
- 作答界面靠 iframe 嵌入 kdocs 分享链接，但**能否显示取决于该文档的分享权限与浏览器三方 Cookie 策略**（实测同一批分配表里有的匿名可渲染、有的直接跳 WPS 登录页）。因此 `components/wps/WpsTablePanel.tsx` 提供两种展示方式（内嵌 / 独立窗口工作台），并配 `WpsLivePreview` + `/wps-preview` 接口从服务端读表格数据兜底——改这块时不要退回「只靠 iframe」。
- 独立窗口打开期间要豁免切屏计数（`useExamSession.setTabSwitchExempt`）并挂起全屏守护（`FullscreenGuard suspended`），否则学生每看一次表格就被记一次违规。

### 前端结构
`App.tsx` 用 `PrivateRoute roles={[...]}` 按角色划分三套布局（student / teacher / admin）；考试链路（检测 → 入场 → 答题 → 结果）是「沉浸式」页面，会隐藏左侧导航并强制全屏。登录态在 `stores/auth.ts`（zustand，token/user/permissions/wpsToken 落 localStorage）。考试页的会话逻辑集中在 `hooks/useExamSession.ts`（心跳、切屏、交卷）+ `hooks/useWpsEmbed.ts`（表格面板模式与窗口）。

### 实时与异步
Socket.IO 在 `index.ts` 里 `initSocketIO(httpServer)`（监考推送 + 通知）；定时任务（`wpsConfigService.startAutoRefresh`、`batchScheduler`）必须在 `listen` 成功回调里启动——端口冲突崩溃时提前启动会消费掉一次性 `refresh_token` 造成 token 链永久断裂。BullMQ 负责阅卷与导入（`jobs/*-queue.ts`），Redis 未启动时这些链路不可用。

## 约定与注意

- 注释与文档用中文，注释解释「为什么」而非「做了什么」，现有代码风格是密集的行内解释 + 关键取舍说明。
- 测试统一用 vitest + supertest，路由测试通过 `vi.mock` 替换 `middleware/auth`（免 JWT）、`config/prisma`（免 DB）、外部适配器（免网络），可参考 `routes/__tests__/exam-ended-lock.test.ts`、`wps-preview.test.ts`。
- Prisma client 生成在**根** `node_modules/.prisma/client`，临时脚本里要用绝对路径 require；Model 字段名以 `schema.prisma` 为准（例如用户状态是 `accountStatus` 不是 `status`）。
- `config/index.ts` 用 `dotenv.config()` 按**进程 cwd** 加载 `.env`：从根目录跑脚本读到的是根 `.env`，从 `packages/server` 跑读到的是 `packages/server/.env`——两者内容可能不同（尤其 `JWT_SECRET`），调试接口鉴权失败时先确认这一点。生产环境弱 `JWT_SECRET` 会 fail-fast 拒绝启动。
- `docs/`、`.qoder/`、`.trae/`、`.playwright-mcp/`、`test_screenshots/` 都在 `.gitignore` 中（本地参考资料，不会入库）；`docs/kingsoft-api-reference.md` 是多维表格 API 速查，`docs/superpowers/specs/*.md` 是各模块设计文档。
- 生产构建产物由 server 托管（`NODE_ENV=production` 时 `app.ts` 静态托管 `packages/client/dist` 并做 SPA fallback）。
