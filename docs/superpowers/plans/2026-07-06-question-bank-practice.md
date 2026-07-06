# 题库练习功能实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将学生端"题库练习"从基于试卷的轻量文本答题，改造为"按分类/难度抽题 + WPS 多维表格实操 + 规则引擎即时判分 + 查看解析"的脱管练习模式。复用考试的 WPS 嵌入与判分管线，去掉考试约束（无时间/IP/全屏/切屏监控），支持无限重试。

**Architecture:** 每学生 1 个持久练习文件（`PracticeTableAssignment`），开练时用适配器写接口重置文件 → 建 `PracticeRecord`（含抽题快照）→ 前端 iframe 嵌入 WPS → 提交时新服务 `practice-grading-service` 复用 `evaluateRules` 判分 → 写回 score/details + 更新错题本 → 返回判分明细 + `analysis` 解析。

**Spec:** `docs/superpowers/specs/2026-07-06-question-bank-practice-design.md`（已确认）

**Tech Stack:** React + Ant Design v6（前端）、Express + Prisma + PostgreSQL（后端）、WPS 开放平台 v3/v7 API、现有 rule-engine / KingsoftAdapter。

---

## 文件结构总览

| 文件 | 职责 | 操作 |
|------|------|------|
| `packages/server/prisma/schema.prisma` | 新增 `PracticeTableAssignment`/`PracticeStatus`，改造 `PracticeRecord`，`Question.analysis`，`User` 反向关系 | Modify |
| `packages/server/src/engine/adapters/kingsoft-adapter.ts` | 新增 `deleteSheet` / `resetFile` 写能力 | Modify |
| `packages/server/src/services/practice-grading-service.ts` | 练习判分服务 `gradePracticeRecord` | Create |
| `packages/server/src/routes/practice.ts` | 新增 assignment/start/submit/catalog 路由，调整 history | Modify |
| `packages/client/src/pages/student/PracticeList.tsx` | 重写为抽题选择器 | Rewrite |
| `packages/client/src/pages/student/PracticeDoing.tsx` | 重写为 WPS iframe + 结果态 | Rewrite |
| `packages/client/src/App.tsx` | 路由参数从 `:paperId` 改 `:recordId` | Modify |
| `packages/client/src/services/api.ts` | 新增 practice 相关 API 方法 | Modify |
| `packages/server/src/routes/__tests__/practice.test.ts` | 适配新 API | Modify |

---

## Task 1: 数据模型迁移（Prisma）

**Files:**
- Modify: `packages/server/prisma/schema.prisma`

- [ ] **Step 1: `Question` 模型新增 `analysis` 字段**

在 `packages/server/prisma/schema.prisma` 的 `model Question` 中，`hints` 字段下方新增：

```prisma
  analysis   String?          @db.Text   // 教师手写解析（题库练习用）
```

- [ ] **Step 2: 新增 `PracticeStatus` 枚举**

在 `schema.prisma` 的枚举区（`QuestionStatus` 附近）新增：

```prisma
enum PracticeStatus {
  in_progress
  graded
}
```

- [ ] **Step 3: 新增 `PracticeTableAssignment` 模型**

在 `schema.prisma` 末尾追加：

```prisma
model PracticeTableAssignment {
  id          String   @id @default(uuid()) @db.Uuid
  studentId   String   @unique @map("student_id") @db.Uuid
  fileId      String   @map("file_id") @db.Text
  shareUrl    String?  @map("share_url") @db.Text
  accessToken String?  @map("access_token") @db.Text
  createdAt   DateTime @default(now()) @map("created_at")
  updatedAt   DateTime @updatedAt @map("updated_at")

  student User @relation(fields: [studentId], references: [id], onDelete: Cascade)

  @@map("practice_table_assignments")
}
```

- [ ] **Step 4: `User` 模型新增反向关系**

在 `model User` 的 Relations 区（`practiceRecords` 附近）新增：

```prisma
  practiceTableAssignment PracticeTableAssignment?
```

- [ ] **Step 5: 改造 `PracticeRecord` 模型**

将现有 `model PracticeRecord` 整体替换为：

```prisma
model PracticeRecord {
  id           String         @id @default(uuid()) @db.Uuid
  studentId    String         @map("student_id") @db.Uuid
  paperId      String?        @map("paper_id") @db.Uuid   // 改为可空（抽题模式无试卷）
  questions    Json           @default("[]")              // 新增：抽题快照 [{questionId, score, sortOrder}]
  tableSpaceId String?        @map("table_space_id")      // 新增：判分时定位 WPS 文件
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
  paper   Paper? @relation(fields: [paperId], references: [id], onDelete: Cascade)

  @@index([studentId, createdAt])
  @@index([paperId])
  @@map("practice_records")
}
```

关键变更：`paperId` 改可空、`paper` 关系改可选、新增 `questions`/`tableSpaceId`/`status` 三字段。

- [ ] **Step 6: 生成并应用迁移**

Run:
```bash
cd /data/wps_dbsheet_examination_system/packages/server
npx prisma migrate dev --name practice_table_assignment_and_record_revamp
```

Expected: 迁移成功创建并应用（包含建表 `practice_table_assignments`、`PracticeStatus` 枚举、`practice_records` 加列/改可空、`questions` 新增 `analysis` 列）。

- [ ] **Step 7: 重新生成 Prisma Client**

Run:
```bash
npx prisma generate
```

Expected: client 生成成功。

- [ ] **Step 8: Commit**

```bash
git add packages/server/prisma/
git commit -m "feat(prisma): add PracticeTableAssignment, PracticeStatus, Question.analysis; revamp PracticeRecord"
```

---

## Task 2: 适配器写能力扩展

**Files:**
- Modify: `packages/server/src/engine/adapters/kingsoft-adapter.ts`

- [ ] **Step 1: 新增 `deleteSheet` 方法**

在 `KingsoftAdapter` 类中（`getRecordsByTableName` 等读方法之后）新增：

```typescript
  /**
   * 删除指定工作表（v3 写接口）
   * WPS 开放平台：POST /kopen/office/file/:file_id/core/execute/sheets/delete
   * 权限要求：kso.dbsheet.readwrite
   */
  async deleteSheet(sheetId: number): Promise<void> {
    await this.requestV3('/sheets/delete', { sheetId });
  }
```

说明：复用现有 `requestV3`（已支持 `/core/execute{action}` 模式）。v7 暂不支持写，写操作固定走 v3 签名。

- [ ] **Step 2: 新增 `resetFile` 方法**

在 `deleteSheet` 之后新增：

```typescript
  /**
   * 重置文件：列出所有 sheet → 逐个删除，得到干净初始态
   * 容错：单个 sheet 删除失败时记录日志继续，不阻断整体重置
   * （WPS 多维表格删除全部工作表后会保留一个默认空表，不影响按表名判分）
   */
  async resetFile(): Promise<{ deletedCount: number; failed: number[] }> {
    const schema = await this.getSchema();
    const sheets = schema.detail.sheets || [];
    let deletedCount = 0;
    const failed: number[] = [];

    for (const sheet of sheets) {
      try {
        await this.deleteSheet(sheet.id);
        deletedCount++;
      } catch (err) {
        console.error(`[resetFile] 删除 sheet ${sheet.id} (${sheet.name}) 失败:`, err);
        failed.push(sheet.id);
      }
    }

    return { deletedCount, failed };
  }
```

- [ ] **Step 3: 类型检查**

Run:
```bash
cd /data/wps_dbsheet_examination_system/packages/server
npx tsc --noEmit
```

Expected: 无新增类型错误。

- [ ] **Step 4: Commit**

```bash
git add packages/server/src/engine/adapters/kingsoft-adapter.ts
git commit -m "feat(adapter): add deleteSheet and resetFile write capabilities"
```

---

## Task 3: 练习判分服务

**Files:**
- Create: `packages/server/src/services/practice-grading-service.ts`

- [ ] **Step 1: 创建判分服务文件**

Create `packages/server/src/services/practice-grading-service.ts`:

```typescript
/**
 * PracticeGradingService — 题库练习判分服务
 *
 * 职责（类比 grading-service.gradeSubmission，但读 PracticeRecord 而非 StudentSubmission）：
 * 1. 加载 PracticeRecord（含 questions 快照）+ 该学生的 PracticeTableAssignment
 * 2. 用 fileId:accessToken 建 adapter（复用 createAdapterFromSpaceId）
 * 3. 预取记录类/表单字段类规则所需数据
 * 4. 逐题 evaluateRules（与考试同一判分口径）
 * 5. 写回 PracticeRecord：score/maxScore/passed/details/status=graded/submittedAt
 *    判分失败保持 status=in_progress，不写回分数，便于学生重新提交
 * 6. 更新错题本 WrongQuestion
 * 7. 返回 { score, maxScore, passed, details, questions(含 analysis) }
 *
 * 不复用 gradeSubmission：它绑死 ExamQuestion/SubmissionDetail/ExamTableAssignment，
 * 硬复用会引入考试耦合。但共享底层 evaluateRules + adapter，保证判分口径一致。
 */

import { prisma } from '../config/prisma';
import {
  evaluateRules,
  type AnswerRule,
  type RuleResult,
  type SchemaResponse,
  type RecordData,
} from '../engine/rule-engine';
import { createAdapterFromSpaceId } from '../engine/adapters/kingsoft-adapter';

// ============================================================
// 类型定义
// ============================================================

export interface PracticeQuestionSnapshot {
  questionId: string;
  score: number;
  sortOrder: number;
}

export interface PracticeQuestionResult {
  questionId: string;
  questionTitle: string;
  difficulty: string;
  type: string;
  score: number;
  maxScore: number;
  isCorrect: boolean;
  ruleResults: RuleResult[];
  analysis: string | null;
}

export interface PracticeGradingResult {
  recordId: string;
  score: number;
  maxScore: number;
  passed: boolean;
  details: PracticeQuestionResult[];
}

// ============================================================
// 核心判分函数
// ============================================================

/**
 * 对一份练习记录执行判分
 * @param recordId PracticeRecord.id
 * @param accessToken 可选，外部注入的 WPS token（覆盖 record.tableSpaceId 中的 token）
 */
export async function gradePracticeRecord(
  recordId: string,
  accessToken?: string,
): Promise<PracticeGradingResult> {
  // 1. 加载练习记录
  const record = await prisma.practiceRecord.findUnique({
    where: { id: recordId },
  });

  if (!record) {
    throw new Error(`练习记录不存在: ${recordId}`);
  }

  const snapshots = (record.questions as unknown as PracticeQuestionSnapshot[]) || [];
  if (snapshots.length === 0) {
    throw new Error('练习记录无题目快照');
  }

  // 2. 加载题目（含 answerRules + analysis）
  const questions = await prisma.question.findMany({
    where: { id: { in: snapshots.map(s => s.questionId) } },
    select: {
      id: true,
      title: true,
      type: true,
      difficulty: true,
      score: true,
      answerRules: true,
      analysis: true,
    },
  });

  // 按 snapshot sortOrder 排序
  const questionMap = new Map(questions.map(q => [q.id, q]));
  const orderedQuestions = snapshots
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map(s => ({ snapshot: s, question: questionMap.get(s.questionId) }))
    .filter((x): x is { snapshot: PracticeQuestionSnapshot; question: NonNullable<typeof x.question> } => !!x.question);

  // 3. 定位 WPS 文件
  // 优先 record.tableSpaceId，回退 PracticeTableAssignment
  let effectiveSpaceId = record.tableSpaceId;
  if (!effectiveSpaceId) {
    const assignment = await prisma.practiceTableAssignment.findUnique({
      where: { studentId: record.studentId },
    });
    if (assignment) {
      effectiveSpaceId = assignment.accessToken
        ? `${assignment.fileId}:${assignment.accessToken}`
        : assignment.fileId;
    }
  }

  // 外部注入 accessToken
  if (accessToken && effectiveSpaceId) {
    const fileId = effectiveSpaceId.split(':')[0];
    effectiveSpaceId = `${fileId}:${accessToken}`;
  }

  const adapter = createAdapterFromSpaceId(effectiveSpaceId);
  if (!adapter) {
    const parts = (effectiveSpaceId || '').split(':');
    const hasToken = parts.length >= 2 && parts[1];
    const reason = hasToken
      ? 'WPS API 连接失败，无法创建适配器'
      : '缺少有效的 WPS access_token，无法获取练习表格数据';
    throw new Error(reason);
  }

  // 4. 获取 Schema
  const schema: SchemaResponse = await adapter.getSchema();

  // 5. 预取记录类规则数据
  const allRules = orderedQuestions.flatMap(
    x => (x.question.answerRules as unknown as AnswerRule[]) || [],
  );
  const recordActions = new Set([
    'check_record_exists', 'check_record_value',
    'check_record_count', 'check_record_value_exact',
  ]);
  const tablesNeedingRecords = new Set<string>();
  for (const rule of allRules) {
    if (recordActions.has(rule.action) && rule.params.tableName) {
      tablesNeedingRecords.add(rule.params.tableName);
    }
  }

  let recordData: RecordData | undefined;
  if (tablesNeedingRecords.size > 0) {
    recordData = {};
    for (const tableName of tablesNeedingRecords) {
      const result = await adapter.getRecordsByTableName(tableName);
      recordData[tableName] = {
        records: result.records,
        fieldsSchema: result.fieldsSchema,
      };
    }
  }

  // 6. 预取表单字段类规则数据
  const formFieldActions = new Set(['check_form_fields', 'check_form_field_required']);
  const formFieldsData = new Map<string, any[]>();
  for (const rule of allRules) {
    if (formFieldActions.has(rule.action) && rule.params.tableName) {
      const sheet = schema.detail.sheets.find(s => s.name === rule.params.tableName);
      if (sheet) {
        const formViews = (sheet.views || []).filter(v => v.type === 'Form');
        const targetForm = rule.params.formName
          ? formViews.find(v => v.name === rule.params.formName)
          : formViews[0];
        if (targetForm) {
          const cacheKey = `${rule.params.tableName}:${targetForm.id}`;
          if (!formFieldsData.has(cacheKey)) {
            const fields = await adapter.getFormFields(sheet.id, targetForm.id);
            formFieldsData.set(cacheKey, fields);
          }
          rule.params.formFields = formFieldsData.get(cacheKey);
        }
      }
    }
  }

  // 7. 逐题判分
  const details: PracticeQuestionResult[] = [];
  let totalScore = 0;
  let maxScore = 0;

  for (const { snapshot, question } of orderedQuestions) {
    const rules = (question.answerRules as unknown as AnswerRule[]) || [];
    if (rules.length === 0) {
      details.push({
        questionId: question.id,
        questionTitle: question.title,
        difficulty: question.difficulty,
        type: question.type,
        score: 0,
        maxScore: snapshot.score,
        isCorrect: false,
        ruleResults: [],
        analysis: question.analysis,
      });
      maxScore += snapshot.score;
      continue;
    }

    const { results } = evaluateRules(schema, rules, recordData);
    const qScore = results.reduce((sum, r) => sum + (r.passed ? r.score : 0), 0);
    const isCorrect = results.every(r => r.passed);

    details.push({
      questionId: question.id,
      questionTitle: question.title,
      difficulty: question.difficulty,
      type: question.type,
      score: qScore,
      maxScore: snapshot.score,
      isCorrect,
      ruleResults: results,
      analysis: question.analysis,
    });

    totalScore += qScore;
    maxScore += snapshot.score;
  }

  const passed = maxScore > 0 ? totalScore >= Math.ceil(maxScore * 0.6) : false;

  // 8. 写回 PracticeRecord
  await prisma.practiceRecord.update({
    where: { id: recordId },
    data: {
      score: totalScore,
      maxScore,
      passed,
      details: details as any,
      status: 'graded',
      submittedAt: new Date(),
    },
  });

  // 9. 更新错题本
  const wrong = details.filter(d => !d.isCorrect);
  for (const d of wrong) {
    await prisma.wrongQuestion.upsert({
      where: { studentId_questionId: { studentId: record.studentId, questionId: d.questionId } },
      update: {
        wrongCount: { increment: 1 },
        lastWrongAt: new Date(),
        sourceType: 'practice',
        sourceId: record.id,
      },
      create: {
        studentId: record.studentId,
        questionId: d.questionId,
        sourceType: 'practice',
        sourceId: record.id,
        lastWrongAt: new Date(),
      },
    });
  }

  return {
    recordId,
    score: totalScore,
    maxScore,
    passed,
    details,
  };
}
```

- [ ] **Step 2: 类型检查**

Run:
```bash
cd /data/wps_dbsheet_examination_system/packages/server
npx tsc --noEmit
```

Expected: 无新增类型错误。

- [ ] **Step 3: Commit**

```bash
git add packages/server/src/services/practice-grading-service.ts
git commit -m "feat(service): add practice-grading-service with gradePracticeRecord"
```

---

## Task 4: 后端路由 — 练习文件注册与目录

**Files:**
- Modify: `packages/server/src/routes/practice.ts`

- [ ] **Step 1: 新增 schema 定义**

在 `packages/server/src/routes/practice.ts` 顶部现有 schema 之后新增：

```typescript
const assignmentSchema = z.object({
  fileId: z.string().min(1),
  shareUrl: z.string().optional(),
  accessToken: z.string().optional(),
});

const startSchema = z.object({
  primaryCategoryId: z.string().uuid().optional(),
  secondaryCategoryId: z.string().uuid().optional(),
  difficulty: z.enum(['easy', 'medium', 'hard']).optional(),
  count: z.number().int().min(1).max(20).default(5),
});
```

- [ ] **Step 2: 新增 `POST /practice/assignment` 路由**

在 `practiceRouter` 中（`/submit` 路由之前）新增：

```typescript
// POST /api/practice/assignment — 注册/更新当前学生的练习文件
practiceRouter.post('/assignment', async (req: Request, res: Response) => {
  try {
    const { fileId, shareUrl, accessToken } = assignmentSchema.parse(req.body);
    const studentId = req.user!.userId;

    const assignment = await prisma.practiceTableAssignment.upsert({
      where: { studentId },
      update: { fileId, shareUrl, accessToken },
      create: { studentId, fileId, shareUrl, accessToken },
    });

    res.json(assignment);
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ message: '参数错误', errors: err.errors });
    }
    res.status(500).json({ message: '服务器错误' });
  }
});
```

- [ ] **Step 3: 新增 `GET /practice/assignment` 路由**

```typescript
// GET /api/practice/assignment — 查自己是否已注册练习文件
practiceRouter.get('/assignment', async (req: Request, res: Response) => {
  try {
    const assignment = await prisma.practiceTableAssignment.findUnique({
      where: { studentId: req.user!.userId },
    });
    res.json(assignment);
  } catch {
    res.status(500).json({ message: '服务器错误' });
  }
});
```

- [ ] **Step 4: 新增 `GET /practice/questions/catalog` 路由**

```typescript
// GET /api/practice/questions/catalog — 返回分类/难度树，供前端选择器
practiceRouter.get('/questions/catalog', async (req: Request, res: Response) => {
  try {
    const categories = await prisma.questionCategory.findMany({
      where: { status: 'ACTIVE' },
      select: {
        id: true, name: true, parentId: true, level: true, sortOrder: true,
      },
      orderBy: [{ level: 'asc' }, { sortOrder: 'asc' }],
    });

    // 仅返回有 published 题目的分类，避免空选项
    const questions = await prisma.question.findMany({
      where: { status: 'published' },
      select: { primaryCategoryId: true, secondaryCategoryId: true, difficulty: true },
    });
    const usedPrimary = new Set(questions.map(q => q.primaryCategoryId).filter(Boolean) as string[]);
    const usedSecondary = new Set(questions.map(q => q.secondaryCategoryId).filter(Boolean) as string[]);
    const difficulties = Array.from(new Set(questions.map(q => q.difficulty)));

    res.json({
      categories: categories.filter(c =>
        (c.level === 1 && usedPrimary.has(c.id)) ||
        (c.level === 2 && usedSecondary.has(c.id))
      ),
      difficulties,
    });
  } catch {
    res.status(500).json({ message: '服务器错误' });
  }
});
```

- [ ] **Step 5: 类型检查**

Run:
```bash
cd /data/wps_dbsheet_examination_system/packages/server
npx tsc --noEmit
```

Expected: 无新增类型错误。

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/routes/practice.ts
git commit -m "feat(practice): add assignment register and questions catalog routes"
```

---

## Task 5: 后端路由 — 开练与提交

**Files:**
- Modify: `packages/server/src/routes/practice.ts`
- Reference: `packages/server/src/services/practice-grading-service.ts`（Task 3 创建）

- [ ] **Step 1: 顶部新增 import**

在 `packages/server/src/routes/practice.ts` 顶部 import 区新增：

```typescript
import { KingsoftAdapter, createAdapterFromSpaceId } from '../engine/adapters/kingsoft-adapter';
import { gradePracticeRecord } from '../services/practice-grading-service';
```

- [ ] **Step 2: 新增 `POST /practice/start` 路由**

在 `/assignment` 路由之后、`/submit` 路由之前新增：

```typescript
// POST /api/practice/start — 抽题 + 重置文件 + 建记录
practiceRouter.post('/start', async (req: Request, res: Response) => {
  try {
    const { primaryCategoryId, secondaryCategoryId, difficulty, count } = startSchema.parse(req.body);
    const studentId = req.user!.userId;

    // 1. 检查练习文件注册
    const assignment = await prisma.practiceTableAssignment.findUnique({
      where: { studentId },
    });
    if (!assignment) {
      return res.status(400).json({ message: '尚未分配练习表格，请联系教师注册' });
    }

    // 2. 抽题
    const where: any = { status: 'published' };
    if (primaryCategoryId) where.primaryCategoryId = primaryCategoryId;
    if (secondaryCategoryId) where.secondaryCategoryId = secondaryCategoryId;
    if (difficulty) where.difficulty = difficulty;

    const pool = await prisma.question.findMany({
      where,
      select: { id: true, title: true, description: true, type: true, difficulty: true, score: true, answerRules: true, analysis: true, hints: true },
    });

    if (pool.length === 0) {
      return res.status(400).json({ message: '当前筛选条件下无可用题目，请放宽条件' });
    }

    // 随机排序取前 count 条
    const shuffled = [...pool].sort(() => Math.random() - 0.5).slice(0, Math.min(count, pool.length));
    const questionsSnapshot = shuffled.map((q, i) => ({
      questionId: q.id,
      score: q.score,
      sortOrder: i,
    }));
    const maxScore = shuffled.reduce((sum, q) => sum + q.score, 0);

    // 3. 重置练习文件（失败则不建 record，直接报错）
    const apiVersion: 'v3' | 'v7' = assignment.accessToken ? 'v3' : 'v7';
    const adapter = new KingsoftAdapter(
      assignment.fileId,
      assignment.accessToken || '',
      undefined,
      apiVersion,
    );
    try {
      await adapter.resetFile();
    } catch (err: any) {
      console.error('Practice start resetFile failed:', err);
      return res.status(500).json({ message: '练习文件重置失败，请重试' });
    }

    // 4. 重置成功后建 PracticeRecord
    const tableSpaceId = assignment.accessToken
      ? `${assignment.fileId}:${assignment.accessToken}`
      : assignment.fileId;

    const record = await prisma.practiceRecord.create({
      data: {
        studentId,
        paperId: null,
        questions: questionsSnapshot as any,
        tableSpaceId,
        status: 'in_progress',
        maxScore,
        startedAt: new Date(),
      },
    });

    res.json({
      recordId: record.id,
      questions: shuffled.map((q, i) => ({
        questionId: q.id,
        sortOrder: i,
        title: q.title,
        description: q.description,
        type: q.type,
        difficulty: q.difficulty,
        score: q.score,
        hints: q.hints,
      })),
      maxScore,
      shareUrl: assignment.shareUrl,
    });
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ message: '参数错误', errors: err.errors });
    }
    console.error('Practice start error:', err);
    res.status(500).json({ message: '服务器错误' });
  }
});
```

- [ ] **Step 3: 新增 `POST /practice/:recordId/submit` 路由**

在 `/start` 路由之后新增：

```typescript
// POST /api/practice/:recordId/submit — 提交练习并即时判分
practiceRouter.post('/:recordId/submit', async (req: Request, res: Response) => {
  try {
    const { recordId } = req.params;
    const studentId = req.user!.userId;

    // 校验归属
    const record = await prisma.practiceRecord.findUnique({
      where: { id: recordId },
      select: { id: true, studentId: true, status: true },
    });
    if (!record) {
      return res.status(404).json({ message: '练习记录不存在' });
    }
    if (record.studentId !== studentId) {
      return res.status(403).json({ message: '无权操作他人练习记录' });
    }

    const result = await gradePracticeRecord(recordId);
    res.json(result);
  } catch (err: any) {
    console.error('Practice submit error:', err);
    // 判分失败保持 in_progress，学生可重新提交
    res.status(500).json({ message: err.message || '判分失败，请重试' });
  }
});
```

- [ ] **Step 4: 调整 `GET /practice/history` 适配新字段**

将现有 `/history` 路由替换为（适配 `paperId` 可空 + 新增 `status`/`questions`/`tableSpaceId`）：

```typescript
// GET /api/practice/history — 练习历史（仅 graded）
practiceRouter.get('/history', async (req: Request, res: Response) => {
  try {
    const records = await prisma.practiceRecord.findMany({
      where: { studentId: req.user!.userId, status: 'graded' },
      select: {
        id: true, status: true, score: true, maxScore: true, passed: true,
        startedAt: true, submittedAt: true, createdAt: true,
        paper: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    res.json(records);
  } catch {
    res.status(500).json({ message: '服务器错误' });
  }
});
```

- [ ] **Step 5: 保留旧 `/submit`（paperId 模式）兼容，标记废弃**

现有 `POST /practice/submit`（基于 paperId 的文本练习）保留但不动，避免破坏性删除。后续可下线。

- [ ] **Step 6: 类型检查**

Run:
```bash
cd /data/wps_dbsheet_examination_system/packages/server
npx tsc --noEmit
```

Expected: 无新增类型错误。

- [ ] **Step 7: Commit**

```bash
git add packages/server/src/routes/practice.ts
git commit -m "feat(practice): add /start and /:recordId/submit routes; adjust /history"
```

---

## Task 6: 前端 API 服务封装

**Files:**
- Modify: `packages/client/src/services/api.ts`

- [ ] **Step 1: 新增 practice 相关 API 方法**

在 `packages/client/src/services/api.ts` 末尾（或 practice 相关区块）新增：

```typescript
// ============================================================
// 题库练习（实操模式）
// ============================================================

export const practiceApi = {
  /** 查询当前学生的练习文件注册 */
  getAssignment: () => api.get('/practice/assignment').then(r => r.data),

  /** 注册/更新练习文件（教师/管理员代学生注册） */
  registerAssignment: (data: { fileId: string; shareUrl?: string; accessToken?: string }) =>
    api.post('/practice/assignment', data).then(r => r.data),

  /** 获取分类/难度目录 */
  getCatalog: () => api.get('/practice/questions/catalog').then(r => r.data),

  /** 开练：抽题 + 重置文件 + 建记录 */
  start: (data: {
    primaryCategoryId?: string;
    secondaryCategoryId?: string;
    difficulty?: 'easy' | 'medium' | 'hard';
    count?: number;
  }) => api.post('/practice/start', data).then(r => r.data),

  /** 提交练习并判分 */
  submit: (recordId: string) =>
    api.post(`/practice/${recordId}/submit`).then(r => r.data),

  /** 练习历史 */
  history: () => api.get('/practice/history').then(r => r.data),
};
```

- [ ] **Step 2: 类型检查**

Run:
```bash
cd /data/wps_dbsheet_examination_system/packages/client
npx tsc -b
```

Expected: 无新增类型错误（已有的预存 antd v6 错误可忽略，仅确认本次改动零报错）。

- [ ] **Step 3: Commit**

```bash
git add packages/client/src/services/api.ts
git commit -m "feat(client): add practiceApi service methods"
```

---

## Task 7: 前端 — PracticeList 重写为抽题选择器

**Files:**
- Rewrite: `packages/client/src/pages/student/PracticeList.tsx`

- [ ] **Step 1: 重写 PracticeList.tsx**

Replace `packages/client/src/pages/student/PracticeList.tsx` 整体内容为：

```tsx
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Card, Select, InputNumber, Button, Alert, Spin, Typography, Space, Tag, Row, Col, message,
} from 'antd';
import { ThunderboltOutlined } from '@ant-design/icons';
import { practiceApi } from '../../services/api';

const { Title, Text } = Typography;

interface CategoryNode {
  id: string; name: string; parentId: string | null; level: number; sortOrder: number;
}

interface Catalog {
  categories: CategoryNode[];
  difficulties: string[];
}

interface StartResponse {
  recordId: string;
  questions: Array<{
    questionId: string; sortOrder: number; title: string; description: string;
    type: string; difficulty: string; score: number; hints: string | null;
  }>;
  maxScore: number;
  shareUrl: string | null;
}

const difficultyLabels: Record<string, { label: string; color: string }> = {
  easy: { label: '简单', color: 'success' },
  medium: { label: '中等', color: 'warning' },
  hard: { label: '困难', color: 'error' },
};

export function PracticeList() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [hasAssignment, setHasAssignment] = useState<boolean | null>(null);

  const [primaryId, setPrimaryId] = useState<string | undefined>();
  const [secondaryId, setSecondaryId] = useState<string | undefined>();
  const [difficulty, setDifficulty] = useState<string | undefined>();
  const [count, setCount] = useState(5);

  useEffect(() => {
    Promise.all([practiceApi.getAssignment(), practiceApi.getCatalog()])
      .then(([assignment, cat]) => {
        setHasAssignment(!!assignment);
        setCatalog(cat);
      })
      .catch(() => message.error('加载失败'))
      .finally(() => setLoading(false));
  }, []);

  const primaryCategories = (catalog?.categories || []).filter(c => c.level === 1);
  const secondaryCategories = (catalog?.categories || []).filter(
    c => c.level === 2 && c.parentId === primaryId,
  );

  const handleStart = async () => {
    setStarting(true);
    try {
      const res: StartResponse = await practiceApi.start({
        primaryCategoryId: primaryId,
        secondaryCategoryId: secondaryId,
        difficulty: difficulty as 'easy' | 'medium' | 'hard' | undefined,
        count,
      });
      // 把 questions 和 shareUrl 通过路由 state 传递，避免再次请求
      navigate(`/student/practice/${res.recordId}`, { state: res });
    } catch (err: any) {
      message.error(err.response?.data?.message || '开练失败');
    } finally {
      setStarting(false);
    }
  };

  if (loading) {
    return (
      <div style={{ padding: 60, textAlign: 'center' }}>
        <Spin size="large" />
      </div>
    );
  }

  return (
    <div style={{ padding: 24, maxWidth: 960, margin: '0 auto' }}>
      <Title level={3} style={{ marginBottom: 8 }}>
        <ThunderboltOutlined style={{ marginRight: 8, color: '#1890ff' }} />
        题库练习
      </Title>
      <Text type="secondary">按分类与难度随机抽题，在 WPS 多维表格中实操，提交后即时判分并可查看解析。支持无限重试。</Text>

      {hasAssignment === false && (
        <Alert
          type="warning" showIcon
          style={{ marginTop: 16 }}
          message="尚未分配练习表格"
          description="请联系教师为你注册一个 WPS 多维表格作为练习文件，注册后即可开始练习。"
        />
      )}

      <Card style={{ marginTop: 16 }}>
        <Row gutter={[16, 16]}>
          <Col xs={24} sm={12}>
            <div style={{ marginBottom: 6 }}><Text type="secondary">一级分类</Text></div>
            <Select
              style={{ width: '100%' }}
              allowClear placeholder="不限"
              value={primaryId}
              onChange={(v) => { setPrimaryId(v); setSecondaryId(undefined); }}
              options={primaryCategories.map(c => ({ label: c.name, value: c.id }))}
            />
          </Col>
          <Col xs={24} sm={12}>
            <div style={{ marginBottom: 6 }}><Text type="secondary">二级分类</Text></div>
            <Select
              style={{ width: '100%' }}
              allowClear placeholder="不限" disabled={!primaryId}
              value={secondaryId}
              onChange={setSecondaryId}
              options={secondaryCategories.map(c => ({ label: c.name, value: c.id }))}
            />
          </Col>
          <Col xs={24} sm={12}>
            <div style={{ marginBottom: 6 }}><Text type="secondary">难度</Text></div>
            <Select
              style={{ width: '100%' }}
              allowClear placeholder="不限"
              value={difficulty}
              onChange={setDifficulty}
              options={(catalog?.difficulties || []).map(d => ({
                label: difficultyLabels[d]?.label || d,
                value: d,
              }))}
            />
          </Col>
          <Col xs={24} sm={12}>
            <div style={{ marginBottom: 6 }}><Text type="secondary">题量</Text></div>
            <InputNumber
              min={1} max={20} value={count}
              onChange={(v) => setCount(v ?? 5)}
              style={{ width: '100%' }}
            />
          </Col>
        </Row>

        <div style={{ marginTop: 24, textAlign: 'center' }}>
          <Space direction="vertical" size={8}>
            <Button
              type="primary" size="large" icon={<ThunderboltOutlined />}
              loading={starting} disabled={hasAssignment === false}
              onClick={handleStart}
              style={{ minWidth: 200, height: 48 }}
            >
              开始练习
            </Button>
            {hasAssignment === false && <Text type="secondary" style={{ fontSize: 12 }}>需先注册练习文件</Text>}
          </Space>
        </div>
      </Card>

      <Card title="练习说明" size="small" style={{ marginTop: 16 }}>
        <Space direction="vertical" size={4}>
          <Text>• 每次练习会重置你的专属练习文件，请放心操作。</Text>
          <Text>• 提交后即时判分，可查看每题判分明细与解析。</Text>
          <Text>• 练习无时间/全屏/切屏限制，可随时重试。</Text>
          <Text>• 错题会自动加入错题本。</Text>
        </Space>
      </Card>
    </div>
  );
}
```

- [ ] **Step 2: 类型检查**

Run:
```bash
cd /data/wps_dbsheet_examination_system/packages/client
npx tsc -b
```

Expected: 本次改动零报错（预存错误可忽略）。

- [ ] **Step 3: Commit**

```bash
git add packages/client/src/pages/student/PracticeList.tsx
git commit -m "feat(client): rewrite PracticeList as quiz selector"
```

---

## Task 8: 前端 — PracticeDoing 重写为 WPS 嵌入 + 结果态

**Files:**
- Rewrite: `packages/client/src/pages/student/PracticeDoing.tsx`
- Modify: `packages/client/src/App.tsx`（路由参数 `:paperId` → `:recordId`）

- [ ] **Step 1: 修改 App.tsx 路由参数**

在 `packages/client/src/App.tsx` 中，将：

```tsx
<Route path="practice/:paperId" element={<PracticeDoing />} />
```

改为：

```tsx
<Route path="practice/:recordId" element={<PracticeDoing />} />
```

- [ ] **Step 2: 重写 PracticeDoing.tsx**

Replace `packages/client/src/pages/student/PracticeDoing.tsx` 整体内容为：

```tsx
import { useEffect, useState } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import {
  Button, Card, Typography, Tag, message, Spin, Alert, Space, Result, List, Empty,
} from 'antd';
import {
  ArrowLeftOutlined, CheckOutlined, LinkOutlined, ReloadOutlined, RightOutlined,
} from '@ant-design/icons';
import { practiceApi } from '../../services/api';
import type { RuleResult } from '../../types';

const { Text, Title, Paragraph } = Typography;

interface PracticeQuestion {
  questionId: string; sortOrder: number; title: string; description: string;
  type: string; difficulty: string; score: number; hints: string | null;
}

interface StartPayload {
  recordId: string;
  questions: PracticeQuestion[];
  maxScore: number;
  shareUrl: string | null;
}

interface QuestionResult {
  questionId: string;
  questionTitle: string;
  difficulty: string;
  type: string;
  score: number;
  maxScore: number;
  isCorrect: boolean;
  ruleResults: RuleResult[];
  analysis: string | null;
}

interface GradingResult {
  recordId: string;
  score: number;
  maxScore: number;
  passed: boolean;
  details: QuestionResult[];
}

const difficultyLabels: Record<string, { label: string; color: string }> = {
  easy: { label: '简单', color: 'success' },
  medium: { label: '中等', color: 'warning' },
  hard: { label: '困难', color: 'error' },
};

const typeLabels: Record<string, string> = {
  create_table: '建表',
  add_field: '加字段',
  config_view: '配视图',
  create_form: '建表单',
  comprehensive: '综合',
};

export function PracticeDoing() {
  const { recordId } = useParams<{ recordId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const payload = (location.state as StartPayload | null);

  const [questions, setQuestions] = useState<PracticeQuestion[]>(payload?.questions || []);
  const [shareUrl, setShareUrl] = useState<string | null>(payload?.shareUrl || null);
  const [currentStep, setCurrentStep] = useState(0);
  const [loading, setLoading] = useState(!payload);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<GradingResult | null>(null);
  const [iframeError, setIframeError] = useState(false);
  const [iframeLoaded, setIframeLoaded] = useState(false);

  // 若无 state（如刷新页面），尝试从 record 加载（仅 questions 快照可恢复，shareUrl 从 assignment 取）
  useEffect(() => {
    if (payload) return;
    (async () => {
      try {
        const [assignment] = await Promise.all([practiceApi.getAssignment()]);
        setShareUrl(assignment?.shareUrl || null);
        // 注：完整 questions 需后端补 GET /practice/:recordId 接口；MVP 阶段建议通过 state 传递，刷新则提示重开
        message.warning('刷新后题目无法恢复，请返回重新开练');
      } catch {
        message.error('加载失败');
      } finally {
        setLoading(false);
      }
    })();
  }, [payload]);

  const iframeUrl = shareUrl ? `${shareUrl}${shareUrl.includes('?') ? '&' : '?'}embed=1` : '';

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      const res: GradingResult = await practiceApi.submit(recordId!);
      setResult(res);
    } catch (err: any) {
      message.error(err.response?.data?.message || '判分失败，请重试');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Spin size="large" />
      </div>
    );
  }

  // ───── 结果态 ─────
  if (result) {
    const passRate = result.maxScore > 0 ? Math.round((result.score / result.maxScore) * 100) : 0;
    return (
      <div style={{ padding: 24, maxWidth: 960, margin: '0 auto' }}>
        <Result
          status={result.passed ? 'success' : 'warning'}
          title={`${result.score} / ${result.maxScore} 分`}
          subTitle={`正确率 ${passRate}% · ${result.passed ? '通过' : '未通过'}`}
          extra={[
            <Button key="again" type="primary" icon={<ReloadOutlined />}
              onClick={() => navigate('/student/practice')}>
              再练一次
            </Button>,
            <Button key="back" onClick={() => navigate('/student/practice')}>返回列表</Button>,
          ]}
        />

        <Card title="判分明细" style={{ marginTop: 16 }}>
          <List
            dataSource={result.details}
            renderItem={(d, idx) => (
              <List.Item>
                <Space direction="vertical" size={4} style={{ width: '100%' }}>
                  <Space>
                    <Text strong>第 {idx + 1} 题</Text>
                    <Tag color={difficultyLabels[d.difficulty]?.color}>
                      {difficultyLabels[d.difficulty]?.label || d.difficulty}
                    </Tag>
                    <Tag>{typeLabels[d.type] || d.type}</Tag>
                    <Text>{d.score} / {d.maxScore} 分</Text>
                    <Tag color={d.isCorrect ? 'success' : 'error'}>
                      {d.isCorrect ? '正确' : '错误'}
                    </Tag>
                  </Space>
                  <Text strong>{d.questionTitle}</Text>

                  {/* 规则判分明细 */}
                  {d.ruleResults.length > 0 && (
                    <List
                      size="small" split
                      dataSource={d.ruleResults}
                      renderItem={(r: RuleResult, ri) => (
                        <List.Item>
                          <Space direction="vertical" size={2} style={{ width: '100%' }}>
                            <Space>
                              <Tag color={r.passed ? 'success' : 'error'}>{r.passed ? '✓' : '✗'}</Tag>
                              <Text type="secondary" style={{ fontSize: 12 }}>规则 {ri + 1}: {r.action}</Text>
                              {r.score > 0 && <Text type="secondary" style={{ fontSize: 12 }}>+{r.score}</Text>}
                            </Space>
                            {r.expected !== undefined && r.actual !== undefined && (
                              <Text type="secondary" style={{ fontSize: 12, whiteSpace: 'pre-wrap' }}>
                                预期: {JSON.stringify(r.expected)}{'\n'}实际: {JSON.stringify(r.actual)}
                              </Text>
                            )}
                            {r.errorMessage && (
                              <Text type="danger" style={{ fontSize: 12 }}>{r.errorMessage}</Text>
                            )}
                          </Space>
                        </List.Item>
                      )}
                    />
                  )}

                  {/* 解析 */}
                  {d.analysis && (
                    <Alert
                      type="info" showIcon
                      style={{ marginTop: 8 }}
                      message="解析"
                      description={<Paragraph style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{d.analysis}</Paragraph>}
                    />
                  )}
                </Space>
              </List.Item>
            )}
          />
        </Card>
      </div>
    );
  }

  // ───── 答题态 ─────
  const currentQuestion = questions[currentStep];
  const hasShareUrl = !!shareUrl;
  const leftWidth = hasShareUrl ? 420 : '100%';

  if (questions.length === 0) {
    return (
      <div style={{ padding: 60, textAlign: 'center' }}>
        <Empty description="题目未加载，请返回重新开练" />
        <Button style={{ marginTop: 16 }} onClick={() => navigate('/student/practice')}>返回列表</Button>
      </div>
    );
  }

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: '#f5f5f5' }}>
      {/* HEADER */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        padding: '10px 24px', background: '#fff', borderBottom: '1px solid #f0f0f0',
      }}>
        <Space>
          <Button type="text" icon={<ArrowLeftOutlined />} onClick={() => navigate('/student/practice')}>
            返回
          </Button>
          <Title level={5} style={{ margin: 0 }}>题库练习</Title>
        </Space>
        <Space size={16}>
          <Text style={{ fontSize: 13, color: '#666' }}>
            第 {currentStep + 1}/{questions.length} 题
          </Text>
          <Button type="primary" icon={<CheckOutlined />} loading={submitting} onClick={handleSubmit}>
            提交练习
          </Button>
        </Space>
      </div>

      {/* MAIN */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {/* 左侧题目 */}
        <div style={{
          width: leftWidth, minWidth: hasShareUrl ? 420 : undefined,
          display: 'flex', flexDirection: 'column', background: '#fff',
          borderRight: hasShareUrl ? '1px solid #f0f0f0' : 'none', overflow: 'hidden',
        }}>
          <div style={{ flex: 1, overflow: 'auto', padding: 20 }}>
            {currentQuestion && (
              <>
                <div style={{ marginBottom: 12 }}>
                  <Space>
                    <Text style={{ fontSize: 13, fontWeight: 600, color: '#1890ff' }}>
                      第 {currentStep + 1} 题
                    </Text>
                    <Tag color={difficultyLabels[currentQuestion.difficulty]?.color}>
                      {difficultyLabels[currentQuestion.difficulty]?.label || currentQuestion.difficulty}
                    </Tag>
                    <Tag>{typeLabels[currentQuestion.type] || currentQuestion.type}</Tag>
                    <Text style={{ fontWeight: 600, color: '#1890ff' }}>{currentQuestion.score} 分</Text>
                  </Space>
                </div>
                <Title level={4} style={{ margin: '0 0 12px', fontSize: 16 }}>
                  {currentQuestion.title}
                </Title>
                {currentQuestion.description && (
                  <Card size="small" style={{ marginBottom: 16, background: '#fafafa' }}>
                    <Paragraph style={{ whiteSpace: 'pre-wrap', fontSize: 15, lineHeight: 1.8, margin: 0 }}>
                      {currentQuestion.description}
                    </Paragraph>
                  </Card>
                )}
                {currentQuestion.hints && (
                  <Alert type="info" showIcon message="操作提示" description={currentQuestion.hints} />
                )}
              </>
            )}

            {/* 答题卡 */}
            <Card title="答题卡" size="small" style={{ marginTop: 16 }}>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {questions.map((q, i) => (
                  <Button
                    key={q.questionId}
                    type={i === currentStep ? 'primary' : 'default'}
                    shape="round" size="small"
                    onClick={() => setCurrentStep(i)}
                    style={{ minWidth: 36 }}
                  >{i + 1}</Button>
                ))}
              </div>
            </Card>
          </div>

          {/* 底部导航 */}
          <div style={{ display: 'flex', gap: 12, padding: '12px 20px', borderTop: '1px solid #f0f0f0', background: '#fff' }}>
            <Button size="large" disabled={currentStep === 0}
              onClick={() => setCurrentStep(s => s - 1)} style={{ flex: 1, height: 44 }}>
              上一题
            </Button>
            {currentStep < questions.length - 1 ? (
              <Button type="primary" size="large"
                onClick={() => setCurrentStep(s => s + 1)} icon={<RightOutlined />}
                style={{ flex: 1, height: 44 }}>
                下一题
              </Button>
            ) : (
              <Button type="primary" size="large" icon={<CheckOutlined />}
                loading={submitting} onClick={handleSubmit} style={{ flex: 1, height: 44 }}>
                提交练习
              </Button>
            )}
          </div>
        </div>

        {/* 右侧 WPS iframe */}
        {hasShareUrl && (
          <div style={{ flex: 1, position: 'relative', background: '#f0f2f5' }}>
            {iframeError ? (
              <div style={{ textAlign: 'center', paddingTop: 100 }}>
                <Alert
                  type="warning" showIcon
                  message="WPS 表格无法内嵌打开"
                  description="请点击下方按钮在新标签页打开表格，操作完成后返回本页面提交。"
                  style={{ maxWidth: 480, margin: '0 auto' }}
                />
                <div style={{ marginTop: 16 }}>
                  <Button type="primary" icon={<LinkOutlined />}
                    onClick={() => shareUrl && window.open(shareUrl, '_blank')}>
                    在新标签页打开
                  </Button>
                </div>
              </div>
            ) : (
              <>
                {!iframeLoaded && (
                  <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Spin tip="正在加载 WPS 多维表格..." />
                  </div>
                )}
                <iframe
                  src={iframeUrl}
                  style={{ width: '100%', height: '100%', border: 'none' }}
                  title="WPS 多维表格练习"
                  onLoad={() => setIframeLoaded(true)}
                  onError={() => setIframeError(true)}
                />
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: 确认 `RuleResult` 类型已导出**

检查 `packages/client/src/types/index.ts`（或对应类型文件）是否导出 `RuleResult`。若未导出，在 types 中补充：

```typescript
export interface RuleResult {
  ruleId: string;
  action: string;
  passed: boolean;
  expected?: any;
  actual?: any;
  score: number;
  errorMessage?: string;
  needsReview?: boolean;
}
```

Run check:
```bash
cd /data/wps_dbsheet_examination_system/packages/client
grep -n "RuleResult" src/types/index.ts || echo "NOT FOUND"
```

- [ ] **Step 4: 类型检查**

Run:
```bash
cd /data/wps_dbsheet_examination_system/packages/client
npx tsc -b
```

Expected: 本次改动零报错（预存的 BatchManager/ExamWizard/QuestionDetailDrawer antd v6 错误非本次引入，可忽略）。

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/pages/student/PracticeDoing.tsx packages/client/src/App.tsx packages/client/src/types/
git commit -m "feat(client): rewrite PracticeDoing with WPS iframe + result state; update route param"
```

---

## Task 9: 测试适配与回归

**Files:**
- Modify: `packages/server/src/routes/__tests__/practice.test.ts`

- [ ] **Step 1: 检查现有测试文件**

Run:
```bash
cd /data/wps_dbsheet_examination_system/packages/server
ls -la src/routes/__tests__/practice.test.ts 2>/dev/null && echo "EXISTS" || echo "NOT FOUND"
```

- [ ] **Step 2: 适配测试**

如果存在 `practice.test.ts`，针对旧 `/submit`（paperId 模式）的测试保留；新增以下测试用例骨架（mock adapter 与 gradePracticeRecord）：

```typescript
describe('POST /api/practice/start', () => {
  it('未注册练习文件时返回 400', async () => {
    // mock prisma.practiceTableAssignment.findUnique → null
    // 期望 res.status 400, message 含 "尚未分配"
  });

  it('抽题池为空时返回 400', async () => {
    // mock assignment 存在 + question.findMany → []
    // 期望 res.status 400, message 含 "无可用题目"
  });

  it('重置文件失败时不建 record', async () => {
    // mock adapter.resetFile 抛错
    // 期望 res.status 500 + prisma.practiceRecord.create 未被调用
  });
});

describe('POST /api/practice/:recordId/submit', () => {
  it('归属校验：他人 record 返回 403', async () => {
    // mock record.studentId !== req.user.userId
  });

  it('判分成功返回 details', async () => {
    // mock gradePracticeRecord 返回固定结果
  });
});
```

> 注：完整测试实现依赖项目测试框架配置（jest/vitest）。若现有测试用 supertest + 内存 DB，按现有模式补全。

- [ ] **Step 3: 运行测试**

Run:
```bash
cd /data/wps_dbsheet_examination_system/packages/server
npm test -- practice 2>&1 | tail -30
```

Expected: 新增测试通过；旧 `/submit` 测试仍通过（未删除）。

- [ ] **Step 4: 回归 — 确认考试判分不受影响**

Run:
```bash
cd /data/wps_dbsheet_examination_system/packages/server
npm test -- grading 2>&1 | tail -20
```

Expected: 考试判分测试全部通过（`gradeSubmission` 独立，未受影响）。

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/routes/__tests__/practice.test.ts
git commit -m "test(practice): adapt tests for new start/submit routes"
```

---

## Task 10: 端到端验证与构建

**Files:** 无（验证任务）

- [ ] **Step 1: 后端类型检查 + 构建**

Run:
```bash
cd /data/wps_dbsheet_examination_system/packages/server
npx tsc --noEmit
```

Expected: 无错误。

- [ ] **Step 2: 前端类型检查**

Run:
```bash
cd /data/wps_dbsheet_examination_system/packages/client
npx tsc -b
```

Expected: 本次改动零报错（预存 antd v6 错误非本次引入）。

- [ ] **Step 3: 前端生产构建**

Run:
```bash
cd /data/wps_dbsheet_examination_system/packages/client
npm run build 2>&1 | tail -20
```

Expected: 构建成功（若因预存 antd v6 错误失败，需先单独修复 BatchManager/ExamWizard/QuestionDetailDrawer，但本次改动文件不引入新错误）。

- [ ] **Step 4: 启动后端 + 烟测**

Run:
```bash
cd /data/wps_dbsheet_examination_system/packages/server
npm run dev &
# 等待启动
sleep 5
```

手动验证（用 curl 或前端）：
1. 学生登录 → `GET /api/practice/assignment` → 返回 null（未注册）
2. 教师代注册 → `POST /api/practice/assignment` body `{fileId, shareUrl, accessToken}` → 200
3. 学生 → `GET /api/practice/questions/catalog` → 返回分类树
4. 学生 → `POST /api/practice/start` body `{count: 3}` → 返回 recordId + questions + shareUrl
5. 前端打开 `/student/practice/:recordId` → iframe 加载 WPS → 操作 → `POST /api/practice/:recordId/submit` → 返回判分结果

- [ ] **Step 5: 验证错题本更新**

Run:
```bash
# 上述 submit 后
curl -H "Authorization: Bearer <student_token>" http://localhost:3002/api/practice/wrong
```

Expected: 错题列表包含本次答错的题目（`sourceType: 'practice'`）。

- [ ] **Step 6: 验证练习历史**

Run:
```bash
curl -H "Authorization: Bearer <student_token>" http://localhost:3002/api/practice/history
```

Expected: 返回刚提交的 graded 记录（status: 'graded'）。

- [ ] **Step 7: 停止 dev server**

```bash
kill %1 2>/dev/null || true
```

- [ ] **Step 8: 最终 Commit（若有未提交的修复）**

```bash
git status
# 若有改动
git add -A
git commit -m "chore: e2e verification fixes"
```

---

## 验收清单

- [ ] 数据模型：`PracticeTableAssignment` / `PracticeStatus` / `Question.analysis` / `PracticeRecord` 改造已迁移
- [ ] 适配器：`deleteSheet` / `resetFile` 可用，容错正确
- [ ] 判分服务：`gradePracticeRecord` 复用 `evaluateRules`，写回 record + 错题本
- [ ] 路由：`/assignment`(POST/GET) / `/start` / `/:recordId/submit` / `/questions/catalog` / `/history` 全部可用
- [ ] 前端：PracticeList 抽题选择器、PracticeDoing WPS iframe + 结果态
- [ ] 边界：未注册文件 / 重置失败 / 判分失败 / 抽题池空 均有处理
- [ ] 回归：考试判分 `gradeSubmission` 不受影响
- [ ] 构建：前后端类型检查 + 前端构建通过

---

## 风险与备注

| 风险 | 缓解 |
|------|------|
| WPS 应用缺少 `kso.dbsheet.readwrite` 权限 → `deleteSheet` 403 | 实施前由管理员在 WPS 开发者后台补权；烟测 Step 4 验证 |
| v3 写接口响应格式未验证 | `requestV3` 已有 `result !== 0` 报错；若响应字段不同需在 `deleteSheet` 中调整解析 |
| 刷新 PracticeDoing 页面丢失题目 | MVP 通过路由 state 传递；未来可补 `GET /practice/:recordId` 接口恢复 |
| 题库无 `analysis` 字段数据 | 教师端题库编辑需同步增加 `analysis` 输入框（本期 spec 未含教师端改造，可作为后续任务） |

## 后续任务（不在本期）

- 教师端题库编辑增加 `analysis` 输入框
- `GET /practice/:recordId` 接口（支持刷新恢复）
- 升级为"每次练习复制新文件"方案（依赖 WPS 云盘复制 API）
