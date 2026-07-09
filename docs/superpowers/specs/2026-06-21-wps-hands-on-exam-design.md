# WPS 多维表格实操考试模式设计

## 1. 问题陈述

当前系统已有 `rule-engine`、`KingsoftAdapter`、`grading-service` 和 `StudentSubmission.tableSpaceId`，但学生实际考试时只是在 `ExamDoing.tsx` 里看文字题目并被告知“去 WPS 操作”。教师也无法在系统内把空白多维表格精确分配给每个考生。

本设计目标：让教师能在系统内为每个考生分配一个独立的 WPS 多维表格，考生考试时在一个页面内同时看到题目和 WPS 表格（iframe 嵌入），交卷后系统自动通过 WPS API 拉取表格数据并按规则判分。

## 2. 核心决策

- **考试模式**：替代现有传统在线答题模式。教师在创建考试时标记为“WPS 实操考试”，学生即进入 WPS 实操界面。
- **表格来源**：教师在 WPS 中手动为每个考生分别创建一个空白多维表格，拿到分享链接 / fileId 后在系统内分配给考生。
- **题目展示**：系统页面分屏，一侧显示题目、倒计时、交卷按钮，另一侧用 WPS WebOffice SDK 以 iframe 嵌入该考生的多维表格。
- **完成判定**：考生主动点击「交卷」，或考试时间到后系统自动提交并触发判分。
- **判分方式**：复用现有 `rule-engine` + `KingsoftAdapter`，按题目 `answerRules` 自动验证表格结构与记录数据。

## 3. 数据模型

### 3.1 新增模型：`ExamTableAssignment`

```prisma
model ExamTableAssignment {
  id          String   @id @default(uuid()) @db.Uuid
  examId      String   @map("exam_id") @db.Uuid
  studentId   String   @map("student_id") @db.Uuid
  fileId      String   @map("file_id") @db.Text    // WPS 文件 ID
  shareUrl    String?  @map("share_url") @db.Text   // kdocs 分享链接，用于 iframe 嵌入
  accessToken String?  @map("access_token") @db.Text // 判分用 access_token
  assignedBy  String   @map("assigned_by") @db.Uuid  // 分配教师
  assignedAt  DateTime @default(now()) @map("assigned_at")

  exam     Exam @relation(fields: [examId], references: [id], onDelete: Cascade)
  student  User @relation(fields: [studentId], references: [id])
  assigner User @relation(fields: [assignedBy], references: [id])

  @@unique([examId, studentId])   // 一个考生一场考试只能有一个表
  @@unique([examId, fileId])      // 一个表不能分配给两个考生
  @@index([examId])
  @@map("exam_table_assignments")
}
```

### 3.2 复用现有字段：`StudentSubmission.tableSpaceId`

考生点击「进入考试」时，系统根据 `examId + studentId` 查找 `ExamTableAssignment`，将 `fileId:accessToken` 写入 `StudentSubmission.tableSpaceId`。现有 `KingsoftAdapter.createAdapterFromSpaceId()` 与判分逻辑无需修改。

### 3.3 `Exam.settings` 扩展

在 `Exam.settings` JSON 中新增 `requiresWpsTable: true`，用于区分 WPS 实操考试与传统在线考试。

## 4. 整体架构

```
教师端
  └─ 在 WPS 创建 N 个空白多维表格 → 拿到分享链接 / fileId
  └─ 进入系统「考试配置向导」→「WPS 表格分配」步骤
     └─ 为每个考生绑定一个 fileId（支持逐人填写或批量粘贴）
  └─ 发布考试

学生端
  └─ 进入考试 → 系统根据 submission 找到他的 fileId
  └─ 加载 WpsExamDoing 页面
     ├─ 左侧：题目、倒计时、交卷按钮
     └─ 右侧：iframe 嵌入 WPS 多维表格（WebOffice SDK）
  └─ 主动点「交卷」或考试时间到 → 触发判分

服务端
  └─ 交卷接口调用 grading-service
  └─ KingsoftAdapter 拉取 schema + records
  └─ rule-engine 按题目 answerRules 验证
  └─ 写入 verification_results 并计算总分
```

## 5. 教师分配流程

在现有 `ExamConfigWizard` 中新增第 5 步「WPS 表格分配」：

1. 进入该步骤后展示已报名考生的列表。
2. 对每个考生提供输入框，可填入：
   - WPS 多维表格分享链接（如 `https://www.kdocs.cn/l/cuI4w9PX4CwI`）
   - 或纯 fileId（如 `cuI4w9PX4CwI`）
3. 系统解析链接得到 `fileId`，并记录 `shareUrl`。
4. 教师通过系统已有的「WPS Token 管理」完成 OAuth 授权后，分配步骤从当前登录教师的有效 access_token 中自动带出，一并保存到 `ExamTableAssignment.accessToken`（用于后续服务端拉表判分）。
5. 点击「保存分配」后后端写入 `ExamTableAssignment`，并校验唯一性约束。
6. 支持「批量粘贴」：教师按行粘贴 `(学号, 分享链接)` 列表，一次性完成分配。

## 6. 学生考试页面

### 6.1 路由

新增 `/student/exam/:id/wps`。

### 6.2 页面布局

```
┌─────────────────────────────────────────────────────────────┐
│  考试标题                剩余时间 00:23:15    [交卷]           │
├──────────────────────────┬──────────────────────────────────┤
│                          │                                  │
│  第 1 题                  │                                  │
│  ─────────────────       │      WPS 多维表格 iframe          │
│  题目描述...              │      (WebOffice SDK)             │
│                          │                                  │
│  [提示]                   │                                  │
│                          │                                  │
│  分值：10                 │                                  │
│                          │                                  │
│  上一题 / 下一题          │                                  │
│                          │                                  │
└──────────────────────────┴──────────────────────────────────┘
```

### 6.3 关键实现点

1. **进入考试时**：前端调用 `POST /api/my-exams/:id/start-wps`，后端找到 `ExamTableAssignment`，把 `fileId:accessToken` 写入 `StudentSubmission.tableSpaceId`，并返回 `shareUrl`。
2. **iframe 加载**：使用 WPS WebOffice SDK 初始化，url 为 `shareUrl + '?embed=1&disablePlugins'`。
3. **题目切换**：左侧题目面板按试卷题目顺序展示，每道题的 `description` 即为操作要求。
4. **倒计时与交卷**：复用 `Countdown`，到时间或点击「交卷」调用 `POST /api/my-exams/:id/submit`。
5. **防作弊**：保留 `FullscreenGuard` 和切屏检测（页面失焦时记录行为日志）。

### 6.4 路由切换逻辑

考生在 `ExamIntro` 页面点击「进入考试」时，系统判断 `Exam.settings.requiresWpsTable === true`：
- 为 `true` → 跳转 `/student/exam/:id/wps`
- 为 `false` → 走现有 `/student/exam/:id/doing`

## 7. 判分流程

考生交卷或时间到后，流程与现有判分逻辑一致：

```
POST /api/my-exams/:id/submit
         ↓
StudentSubmission.status = 'grading'
         ↓
grading-service.gradeSubmission()
  ├─ 从 tableSpaceId 解析 fileId + accessToken
  ├─ KingsoftAdapter.getSchema()
  ├─ 预扫描规则，按需拉取 records
  ├─ rule-engine.evaluateRules()
  ├─ 写入 VerificationResult
  └─ 汇总总分，更新 StudentSubmission
```

由于 `tableSpaceId` 已在考试开始时写入，现有判分代码几乎无需修改。唯一补充：若判分时 `access_token` 已过期，应标记为 `needsReview`，并允许教师在后台重新触发判分。

## 8. 异常处理与降级

| 场景 | 处理方式 |
|------|---------|
| iframe 加载失败（WPS 拒绝嵌入 / SDK 报错） | 页面显示「无法内嵌打开」，提供「在新标签页中打开 WPS 表格」按钮，学生仍可在新标签操作，系统页面保留题目和交卷。 |
| 考生无表格分配 | 进入考试时直接拦截，提示“联系教师完成 WPS 表格分配”。 |
| access_token 过期 | 考试时尝试自动刷新；判分时若仍失败，标记该份答卷 `needsReview`，教师可在后台重新触发判分。 |
| WPS API 调用失败 | 判分接口返回错误，不阻塞其他考生，记录日志，允许教师重试。 |
| 表格被重复分配 | 保存分配时校验 `@@unique([examId, fileId])`，拒绝保存并提示教师。 |
| 考试时间到未主动交卷 | 系统自动调用提交/判分，与现有 `ExamDoing` 行为一致。 |

## 9. 涉及文件

- `packages/server/prisma/schema.prisma`
- `packages/server/src/routes/exams.ts`
- `packages/server/src/routes/my-exams.ts`
- `packages/server/src/services/grading-service.ts`
- `packages/client/src/App.tsx`（路由）
- `packages/client/src/pages/student/ExamIntro.tsx`
- `packages/client/src/pages/student/WpsExamDoing.tsx`（新增）
- `packages/client/src/pages/teacher/ExamConfigWizard/index.tsx`
- `packages/client/src/pages/teacher/ExamConfigWizard/WpsTableAssignStep.tsx`（新增）
- `packages/client/src/services/api.ts`

## 10. 待验证事项

1. WPS WebOffice SDK v1/v3 在本地开发环境的 iframe 加载是否成功。
2. 分享链接直接加 `?embed=1&disablePlugins` 是否可正常进入编辑模式。
3. `access_token` 有效期 2 小时，考试过程中刷新策略是否满足需求。
4. 是否需要为 WPS 实操考试禁用部分表格功能（如导出、分享、添加协作者）。
