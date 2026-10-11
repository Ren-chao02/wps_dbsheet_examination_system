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

# 质量门禁（根目录执行；CI 会跑同一套，见 .github/workflows/ci.yml）
npm run lint                 # ESLint，当前 0 error / 若干 warning（warning 不阻断）
npm run lint:fix
npm run typecheck            # 两端 tsc --noEmit
npm test                     # 两端 vitest
npm run test:coverage        # 后端覆盖率（判分引擎是重点观察对象）
npm run e2e                  # Playwright 端到端（需前后端已在跑；见 e2e/）
npm run e2e:ui               # 带界面调试

# 并发压测（k6，见 tests/load/README.md；需要一场可开考的测试考试）
k6 run tests/load/exam-load.js -e BASE_URL=... -e EXAM_ID=... -e STUDENT_FROM=... -e PASSWORD=... -e VUS=200

# 运维诊断脚本（在 packages/server 目录下执行，跑的是当前 .env 指向的库/表格）
npx tsx scripts/probe-practice-reset.ts   # WPS fileId+token 哪种鉴权组合可用（只读）
npx tsx scripts/diag-missing-table.ts     # 判分报「找不到表」时，打印练习记录 + 实时读表格清单
npx tsx scripts/probe-v7-delete.ts        # 探测 v7 sheet 删除接口形态（一律用不存在的 sheetId，不删真实数据）
```

本地依赖：PostgreSQL 15 + Redis 7（`docker compose up -d postgres redis` 即可，均只绑定 127.0.0.1）。

## 架构要点

### 请求链路
`app.ts` 按模块挂载 `/api/<module>` 路由；绝大多数路由在文件头统一 `router.use(authenticate)` + `router.use(authorize('teacher'|'student'|'admin'))`（少数在 `app.ts` 挂载处加 `authenticate`，如 notifications）。**例外**：`routes/demo.ts` 有意免认证（Mock 判分演示）；`routes/audit.ts` 目前**没有任何鉴权**且自带一份 `new PrismaClient()`，其 `/api/audit/logs`（全量审计日志）、`/api/audit/cleanup`（按 `retainDays` 批量删除，传 0 即清空）对可达网络的任何人开放——改这块时按标准模式补上鉴权，别让缺口扩大。

`middleware/exam-lock.ts` 的 `rejectExamConfigMutationWhenEnded()` 用于考场分配与表格分配等配置接口；考试自身的 `ended` 校验是 `routes/exams.ts` 内联的（约 251 行）。`middleware/audit-middleware.ts` 全局记录 CRUD 审计。

客户端请求默认走 `services/api.ts`（axios，baseURL `/api`，自动附 JWT，401 跳登录）；唯一例外是 AI 辅助出题的 SSE 流式接口 `services/coachingApi.ts`（裸 `fetch` + `services/sse-parser.ts`）。Vite 把 `/api` 与 `/socket.io` 代理到 `:3002`（Socket.IO 走代理是为了内网穿透域名下 WebSocket 也能连上）。

### 判分核心：两条并列的纯函数路径
按题型分流，两条路径互不影响，入口在 `services/grading-service.ts`：

| 路径 | 文件 | 输入 | 适用 |
| --- | --- | --- | --- |
| 规则引擎 | `engine/rule-engine.ts` | WPS `SchemaResponse` + 题目 `answerRules` | 实操题（5 种） |
| 客观题判分器 | `engine/objective-grader.ts` | 题目 `objectiveAnswer` + 学生作答 | 单选/多选/判断 |

两者都**不依赖数据库、不发网络请求**，输入齐了就出结果。判分入口先判 `isObjectiveType(type)` 决定走哪条。

`rule-engine` 的规则是 `{ action, params, score }`，处理器注册在 `ruleHandlers: Record<string, RuleHandler>`（29 个 action，另有 `getActionLabel()` 维护中文标签）。

- 新增验证器 = 往 `ruleHandlers` 加一个 handler + 在 `getActionLabel` 补标签，`params` 用 `rule.params` 取。
- 无法从 Schema 完整判定的规则返回 `needsReview: true`，前端标为「待复核」交人工阅卷，**不要**为了自动化硬判。
- `engine/adapters/kingsoft-adapter.ts` 负责把 WPS 数据转成引擎可吃的 Schema/RecordData；`engine/demo-schemas.ts` 提供离线样例，`engine/__tests__` 里的测试不碰网络。

### 抽题组卷（每生一份卷子）
`services/paper-generator.ts` 是执行端：开考时按考试的**题位**为该考生生成卷子快照。

- 题位模型：`PaperQuestion`/`ExamQuestion` 都有 `slotType`（`fixed` 固定题 / `rule` 抽题）与 `rule`（知识点/难度/题型/schemaRefs）。绑定试卷时规则会一起拷到考试上。
- 快照落库：`StudentExamQuestion`（`@@unique([examId, studentId, slotIndex])` 保证幂等）。**必须落库**——题库会变，靠种子重算会让历史答卷对不上"他当时做的是哪道题"。
- 等值替换：同题位的候选必须「同知识点 + 同难度 + 同题型 + 同分值 + 同 `schemaRefs`」，并按**已分配次数最少**优先取材（纯随机在候选少时会让两个学生撞题）。
- `schemaRefs` 是硬约束：实操题题面会写"在「员工信息表」中把「入职日期」改为日期格式"，变体题引用别的表/字段的话，学生打开自己的表格根本找不到那张表。
- 组卷页用 `POST /api/papers/slot-preview` 显示每个题位的候选数，**只有 1 道候选时必须警告**（否则"每生不同"会静默退化成"全员同题"）。
- 客观题：`Question.objectiveAnswer`（选项+正确项），学生端只下发 `options`（`toStudentQuestion` 白名单裁剪，`correct` 绝不下发）。作答存 `SubmissionDetail.answerJson.answer`，接口 `PUT /my-exams/:id/answers`。
- 纯客观题考试不需要 WPS 表格：`start-wps` 只在卷内含实操题时强制要求分配表，判分也会跳过 WPS 读取。
- 练习（`/api/practice/*`）只支持实操题（判分依赖 WPS Schema），抽题时会排除客观题。

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
- **新代码用 `utils/logger.ts` 的 `logger`，不要再加 `console.log`**（存量 console 可逐步替换）。logger 已配置凭据脱敏，`tableSpaceId`/`accessToken`/`password` 等字段会被打成 `[已脱敏]`。
- **错误上报默认关闭**：没配 `SENTRY_DSN` 时 Sentry 完全不初始化、不发任何请求。其 `dataCollection` 已在代码里显式收紧（关掉请求头/请求体/用户信息/cookie）——那些位置分别是 JWT、学生答案与身份，不要图省事整体打开。
- **提交前会跑 gitleaks**（husky 钩子 + CI）。误报不要改 `.gitleaks.toml` 的 allowlist——实测其 `paths` 与 `regexes` 是 OR 语义，写 `paths` 等于整个文件放行；应往 `.gitleaksignore` 加一条 `提交:文件:规则:行号` 指纹。
- ESLint 的分级原则：`error` 只放「几乎一定是 bug」的规则（no-floating-promises / rules-of-hooks / no-misused-promises 等），整洁度类（未使用导入、case 块声明）降为 `warn`。**新增 error 级规则前先确认全库能清零**，否则 CI 会常年红灯没人看。
- 测试统一用 vitest + supertest，路由测试通过 `vi.mock` 替换 `middleware/auth`（免 JWT）、`config/prisma`（免 DB）、外部适配器（免网络），可参考 `routes/__tests__/exam-ended-lock.test.ts`、`wps-preview.test.ts`。
- Prisma client 生成在**根** `node_modules/.prisma/client`，临时脚本里要用绝对路径 require；Model 字段名以 `schema.prisma` 为准（例如用户状态是 `accountStatus` 不是 `status`）。
- `config/index.ts` 用 `dotenv.config()` 按**进程 cwd** 加载 `.env`：从根目录跑脚本读到的是根 `.env`，从 `packages/server` 跑读到的是 `packages/server/.env`——两者内容可能不同（尤其 `JWT_SECRET`），调试接口鉴权失败时先确认这一点。生产环境弱 `JWT_SECRET` 会 fail-fast 拒绝启动。
- `docs/`、`.qoder/`、`.trae/`、`.playwright-mcp/`、`test_screenshots/` 都在 `.gitignore` 中（本地参考资料，不会入库）；`docs/kingsoft-api-reference.md` 是多维表格 API 速查，`docs/superpowers/specs/*.md` 是各模块设计文档。
- `packages/server/scripts/` 在 `.gitignore` 里是**白名单**（`packages/server/scripts/*` + 逐条 `!` 放行）：新写的临时脚本不会自动入库，要入库得先加一条 `!` 规则。别改成裸 `scripts/`，那会连带挡住整个目录且没有任何提示。
- 生产构建产物由 server 托管（`NODE_ENV=production` 时 `app.ts` 静态托管 `packages/client/dist` 并做 SPA fallback）。
