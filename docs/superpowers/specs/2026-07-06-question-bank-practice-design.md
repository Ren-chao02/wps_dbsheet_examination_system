# 题库练习功能设计

- **日期**: 2026-07-06
- **状态**: 已确认

---

## 1. 概述

为学生端新增"题库练习"功能：学生按分类/难度/题量随机抽题，在嵌入的 WPS 多维表格中真实操作（建表/加字段/配视图/建表单），提交后由规则引擎即时判分，并可查看每题判分明细与解析。

练习本质是"脱管的考试"：复用考试的 WPS 嵌入 + 规则引擎判分管线，但去掉考试约束（无时间/IP/批次/全屏/切屏监控），支持无限重试、即时出分、查看解析。

### 1.1 核心决策（已与用户确认）

| 维度 | 决策 |
|---|---|
| 答题形态 | 实操 + 去掉考试约束（不是轻量文本练习） |
| 选题入口 | 按分类/难度抽题（不做试卷/错题本/收藏/单题入口） |
| 解析呈现 | 规则翻译的"预期操作" + 新增 `analysis` 字段的教师手写解析 |
| WPS 文件资源 | 每学生 1 个持久练习文件，开练时用写接口重置（方案 1） |

## 2. 架构总览

### 2.1 数据流

```
学生选 分类/难度/题量
  → POST /practice/start
    → 后端随机抽 N 题
    → 用写接口重置该学生的持久练习文件（删除所有工作表）；失败则不建 record，直接报错
    → 重置成功后建 PracticeRecord(status=in_progress)
    → 返回 { recordId, questions, shareUrl, fileId }
  → 前端 iframe 嵌入 WPS 文件，学生建表/加字段/配视图
  → POST /practice/:recordId/submit
    → 复用规则引擎对该文件 Schema 判分（evaluateRules）
    → 写回 score/details、更新错题本
    → 返回 { score, details(每题规则结果), analysis }
  → 前端展示成绩 + 每题判分明细 + 解析
  → "再练一次" → 回到 start（新 record + 重新重置）
```

### 2.2 复用与新增

**复用**：
- 规则引擎 `evaluateRules`（`packages/server/src/engine/rule-engine.ts`）—— 与考试同一判分口径
- WPS 嵌入模式（`<iframe src={shareUrl?embed=1}>`，参考 `WpsExamDoing.tsx`）
- `KingsoftAdapter` 的读能力（getSchema/getRecords/getFormFields）
- 错题本 `WrongQuestion`、收藏 `FavoriteQuestion`、反馈 `QuestionFeedback` 数据模型

**新增**：
- 适配器写能力（`deleteSheet` / `resetFile`）
- `practice-grading-service`（类比 `grading-service`，读 PracticeRecord 而非 Submission）
- `PracticeTableAssignment` 模型（每学生 1 个持久练习文件）
- `Question.analysis` 字段
- 抽题、重置、判分相关路由

## 3. 数据模型变更（Prisma）

### 3.1 Question 新增字段

```prisma
model Question {
  // ... 现有字段不变
  analysis  String?  @db.Text   // 教师手写解析（新增）
}
```

### 3.2 新增 PracticeTableAssignment

每学生 1 个持久练习文件，类比 `ExamTableAssignment`：

```prisma
model PracticeTableAssignment {
  id          String   @id @default(uuid()) @db.Uuid
  studentId   String   @unique @db.Uuid      // 每学生1个
  fileId      String   @db.Text
  shareUrl    String?  @db.Text
  accessToken String?  @db.Text
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  student     User     @relation(fields: [studentId], references: [id], onDelete: Cascade)

  @@map("practice_table_assignments")
}
```

需在 `User` 模型增加反向关系 `practiceTableAssignment PracticeTableAssignment?`。

### 3.3 改造 PracticeRecord

现有 `paperId` 非空，但抽题模式无试卷。改造如下：

| 字段 | 变更 | 说明 |
|---|---|---|
| `paperId` | 改为 `String?`（可空） | 抽题模式留空；兼容旧 paper 练习 |
| `questions` | 新增 `Json` | 抽题快照 `[{questionId, score, sortOrder}]`，不可变 |
| `tableSpaceId` | 新增 `String?` | 判分时定位 WPS 文件（类比 `submission.tableSpaceId`） |
| `status` | 新增 `PracticeStatus @default(in_progress)` | 枚举 `in_progress`/`graded`；判分成功→`graded`，失败保持 `in_progress` 可重试 |
| `details` | 复用现有 `Json?` | 存每题规则判分结果快照 |

```prisma
enum PracticeStatus {
  in_progress
  graded
}

model PracticeRecord {
  id           String         @id @default(uuid()) @db.Uuid
  studentId    String         @map("student_id") @db.Uuid
  paperId      String?        @map("paper_id") @db.Uuid   // 改为可空
  questions    Json           @default("[]")              // 新增：抽题快照
  tableSpaceId String?        @map("table_space_id")      // 新增
  status       PracticeStatus @default(in_progress)       // 新增
  score        Int?
  maxScore     Int            @map("max_score")
  passed       Boolean?
  answers      Json           @default("{}")
  details      Json?
  startedAt    DateTime       @map("started_at")
  submittedAt  DateTime?      @map("submitted_at")
  createdAt    DateTime       @default(now()) @map("created_at")
  updatedAt    DateTime       @updatedAt @map("updated_at")

  student User   @relation(fields: [studentId], references: [id], onDelete: Cascade)
  paper   Paper? @relation(fields: [paperId], references: [id], onDelete: Cascade)  // 改为可选

  @@index([studentId, createdAt])
  @@index([paperId])
  @@map("practice_records")
}
```

**不新增** `PracticeDetail` / `PracticeVerificationResult` 表：MVP 用 `details Json` 快照存每题规则结果，够用且简单。

## 4. 后端组件

### 4.1 适配器写能力扩展

文件：`packages/server/src/engine/adapters/kingsoft-adapter.ts`

当前适配器只读。新增：

- `deleteSheet(sheetId: number): Promise<void>` —— 调用 WPS 删除工作表接口
  - v3 路径：`/kopen/office/file/:file_id/core/execute/sheets/delete`（参考 WPS 开放平台"删除工作表"）
  - 复用现有 `requestV3` 签名机制
- `resetFile(): Promise<void>` —— 列出当前所有 sheet（`getSchema`）→ 逐个 `deleteSheet`，得到干净初始态
  - WPS 多维表格文件删除全部工作表后会保留一个默认空表，不影响按表名判分
  - 容错：单个 sheet 删除失败时记录日志继续，不阻断整体重置（判分按表名匹配，残留空表不干扰）

**权限要求**：应用需具备 `kso.dbsheet.readwrite` 权限（写操作）。需确认当前 `KINGSOFT_API_KEY`/`KINGSOFT_API_SECRET` 对应应用的授权范围，不足时由管理员在 WPS 开发者后台补权。

### 4.2 练习判分服务

新文件：`packages/server/src/services/practice-grading-service.ts`

函数：`gradePracticeRecord(recordId: string, accessToken?: string): Promise<PracticeGradingResult>`

职责（类比 `gradeSubmission`，但读 PracticeRecord 而非 Submission）：
1. 加载 PracticeRecord（含 `questions` 快照）+ 该学生的 `PracticeTableAssignment`
2. 用 `fileId:accessToken` 建 adapter（复用 `createAdapterFromSpaceId`）
3. 预取记录类/表单字段类规则所需数据（与 `gradeSubmission` 同逻辑）
4. 逐题 `evaluateRules(schema, rules, recordData)` —— 复用规则引擎，口径与考试一致
5. 写回 `PracticeRecord`：`score` / `maxScore` / `passed` / `details`(每题规则结果快照) / `status=graded` / `submittedAt`；判分失败则保持 `status=in_progress`，不写回分数，便于学生重新提交
6. 更新错题本：错题 `WrongQuestion.upsert`（`wrongCount+1`，`sourceType='practice'`，`sourceId=recordId`）
7. 返回 `{ score, maxScore, passed, details, questions(含 analysis) }`

**不复用 `gradeSubmission`**：它绑死 `ExamQuestion` / `SubmissionDetail` / `ExamTableAssignment`，硬复用会引入考试耦合。但共享底层 `evaluateRules` + adapter，保证判分口径一致。

### 4.3 路由改造

文件：`packages/server/src/routes/practice.ts`

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/practice/assignment` | 注册/更新当前学生的练习文件（fileId/shareUrl/token）。首次练习前必须注册 |
| GET | `/practice/assignment` | 查自己是否已注册练习文件 |
| POST | `/practice/start` | body `{primaryCategoryId?, secondaryCategoryId?, difficulty?, count}` → 随机抽题 → 建 record + 重置文件 → 返回 record/questions/shareUrl |
| POST | `/practice/:recordId/submit` | 调 `gradePracticeRecord` → 返回成绩 + 每题判分明细 + analysis |
| GET | `/practice/history` | 已有，保留（按新 `status` 调整返回字段） |
| GET | `/practice/questions/catalog` | 返回分类/难度树，供前端选择器 |
| GET | `/practice/wrong` | 已有，保留（错题本只读） |
| POST/GET | `/practice/favorite` | 已有，保留 |
| POST | `/practice/feedback` | 已有，保留 |

**抽题逻辑**（`/practice/start`）：
- 从 `Question` 中筛 `status=published`，按 `primaryCategoryId`/`secondaryCategoryId`/`difficulty` 过滤
- 随机排序取前 `count` 条（去重）
- 每题分值取 `question.score`（无 scoreOverride）
- `maxScore` = 各题 score 之和
- **先重置**练习文件（`resetFile()`）；失败则直接返回错误，不建 record
- 重置成功后建 `PracticeRecord`：`questions` 快照、`tableSpaceId`、`status=in_progress`、`startedAt=now`
- 返回 record / questions / shareUrl

**鉴权**：路由已挂 `authenticate` + `authorize('student')`，保持不变。

### 4.4 重置与判分的文件定位

- `tableSpaceId` 格式：`{fileId}:{accessToken}`（与考试一致，见 `createAdapterFromSpaceId`）
- 重置时从 `PracticeTableAssignment` 取 `fileId`/`accessToken` 建 adapter，调 `resetFile()`
- 判分时优先用 `PracticeRecord.tableSpaceId`，回退 `PracticeTableAssignment`

## 5. 前端组件

### 5.1 PracticeList.tsx 重写

去掉试卷卡片，改为抽题选择器：

| 字段 | 组件 | 说明 |
|---|---|---|
| 一级分类 | `Select` | 从 `/practice/questions/catalog` 加载 |
| 二级分类 | `Select` | 联动一级分类 |
| 难度 | `Select` | easy/medium/hard/不限 |
| 题量 | `InputNumber` | 默认 5，范围 1–20 |

- 底部 `[开始练习]` 按钮 → POST `/practice/start` → 跳 `/student/practice/:recordId`
- 未注册练习文件时（`GET /practice/assignment` 返回空）显示 Alert，引导联系教师注册

### 5.2 PracticeDoing.tsx 重写

去掉 textarea，改为 WPS 嵌入：

- 左侧：题目导航（题号、题型、难度、分值、标记）
- 右侧：`<iframe src={shareUrl?embed=1}>` 嵌入 WPS 多维表格（复用 `WpsExamDoing.tsx` 的 iframe 模式）
- 顶部：返回 + 题目进度 + `[提交练习]`
- **去掉**：全屏守卫、倒计时、切屏监控、IP 限制（练习无约束）
- 提交确认：未答完提示（练习无强制答完，仅提示）
- 提交后切换到结果态（同页 `showResult`）

### 5.3 结果态（PracticeDoing 内或独立 PracticeResult）

展示：
- 总分 / 满分 / 及格与否
- 每题判分明细：题号、对/错 Tag、得分、`expected` vs `actual`（来自 `details`）
- 每题 `analysis` 文本（教师手写解析）
- 每题"预期操作"清单（由 `answerRules` 经 `getActionLabel` 翻译）
- `[再练一次]`（回 `/student/practice`）`[返回]`

### 5.4 路由

- `/student/practice` → PracticeList（重写）
- `/student/practice/:recordId` → PracticeDoing（重写）
- 结果在 PracticeDoing 内切换态，不单独占路由

## 6. 错误处理 & 边界

| 场景 | 处理 |
|---|---|
| 未注册练习文件 | `/practice/start` 返回 400 + 引导（类比考试"尚未分配 WPS 表格"） |
| 重置文件失败（WPS API 异常） | 不建 record，返回 500，提示重试 |
| 判分失败（token 失效/adapter 为 null） | record 保持 `status=in_progress`，返回错误，学生可重新提交 |
| 抽题池为空（筛选条件太严） | 返回 400 + 提示放宽条件 |
| 同一学生并发开练 | 每人仅 1 个练习文件天然串行；已有 `in_progress` record 时提示先完成或放弃后再开新练习 |
| 已有未完成 record | 提示"有未完成的练习"，可继续该 record 或放弃（放弃则该 record 保留 `in_progress`，不再判分，学生可开新练习） |

## 7. 测试策略

- **单元**
  - 抽题：筛选/去重/数量截断（`/practice/start` 的抽题函数）
  - `resetFile`：mock adapter 验证删表逻辑与容错
  - `gradePracticeRecord`：用 `demo-schemas` 喂规则，复用 engine 已有测试模式
- **集成**
  - start → submit 端到端（mock adapter 的 `getSchema` 返回 demo schema，验证 score/details 写回）
- **回归**
  - 更新 `packages/server/src/routes/__tests__/practice.test.ts` 适配新 API
  - 确保考试判分（`gradeSubmission`）不受影响（共用 `evaluateRules`，但独立函数）

## 8. 范围边界（YAGNI，明确不做）

- ❌ 试卷练习入口、错题本练习入口、收藏练习入口、单题练习入口
- ❌ 练习文件自动创建（走手动注册；未来若验证 WPS 云盘复制 API 可用，再升级为"每次练习复制新文件"方案）
- ❌ 计时 / IP 限制 / 全屏守卫 / 切屏监控
- ❌ 错题本"做对后自动移除/掌握度"逻辑（仅被动记录 `wrongCount`）
- ❌ 收藏页 `FavoriteQuestions`（保持现有空壳，不在本次范围）
- ❌ `PracticeDetail` / `PracticeVerificationResult` 独立表（用 `details Json` 快照）
- ❌ 练习排行/统计看板

## 9. 实施依赖与风险

| 项 | 说明 |
|---|---|
| WPS 应用 readwrite 权限 | 写接口（删表）需 `kso.dbsheet.readwrite`。实施前需确认当前应用授权范围，不足则由管理员补权 |
| 练习文件初始注册 | 需教师/管理员为学生创建 1 个 WPS 多维表格文件并录入 fileId/shareUrl/token（首次） |
| 适配器写接口签名 | v3 `requestV3` 已支持 `/core/execute{action}` 模式，新增 `sheets/delete` action 即可；需验证响应解析 |
| 判分口径一致性 | 与考试共用 `evaluateRules`，天然一致；无需额外对齐 |

## 10. 后续可演进方向（不在本期）

- 升级到"每次练习复制新文件"（需 WPS 云盘复制文件 API）
- 错题本练习入口 + 掌握度追踪
- 按题型专项练习
- 练习数据看板（正确率趋势、薄弱分类）
