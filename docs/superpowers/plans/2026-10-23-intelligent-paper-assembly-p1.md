# 智能组卷 P1（选题优化）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让组卷从"逐题位静默抽取"升级为"发布前可预检、发布后预生成、难度分布可配且可修复、每一步可解释"——教师在任何学生开考前就能看到这场考试的组卷质量。

**Architecture:** 三块拼图：① 把候选枚举抽成唯一入口 `listSlotCandidates`（预检/生成/修复共用）；② 发布时同步预检 + 入队异步预生成全场（`ExamPaperGeneration` 记录状态与汇总），开考路径保留现场生成兜底；③ 生成后用 `repairDifficultyDistribution` 在硬约束内做局部换题逼近难度目标，并把每次选择/降级写进 `StudentExamQuestion.pickMeta`。

**Tech Stack:** TypeScript；Express + Prisma + BullMQ（`packages/server`）；React 18 + antd 6（`packages/client`）；vitest + supertest。

**设计依据：** `docs/superpowers/specs/2026-10-23-intelligent-paper-assembly-design.md`

---

## Global Constraints

- **不改现有硬约束语义**：分值一致、题型一致、`schemaRefs` 结构签名一致（strict 级）、同卷不重复、候选池归属（`poolWhere`）、固定题位不动。修复器只能在它们之内换题。
- **预检/生成/修复必须共用 `listSlotCandidates`**——禁止任何一处另写候选过滤条件（否则"预检过了、生成抽不出"）。
- **已开考（存在任意 `in_progress/submitted/grading/graded` 提交）的考试，绝不改动已有 `StudentExamQuestion` 快照**；只允许补生成缺失学生。
- **迁移禁止 `prisma migrate dev`**（本库会触发 RESET）：手写 SQL → `npx prisma migrate deploy` → `npx prisma generate` → 用 `npx prisma migrate diff --from-schema-datasource prisma/schema.prisma --to-schema-datamodel prisma/schema.prisma --script` 验证输出 `-- This is an empty migration.`
- 注释与文档用中文、解释「为什么」；新代码用 `utils/logger.ts` 的 `logger`（BullMQ worker 内可按现有 `jobs/*-queue.ts` 风格用 console）。
- **提交必须带 pathspec**（本工作区常有并行会话）：`git commit -m "..." -- <明确文件>`，绝不 `git add -A`。
- 测试**必须指定路径**（裸 `npx vitest run` 会捡到 gitignored 的 `dist/**` 陈旧产物）：如 `cd packages/server && npx vitest run src/services/__tests__/paper-preflight.test.ts`。
- 每个提交前：`cd packages/server && npx tsc --noEmit -p tsconfig.json`；涉及前端时 `cd packages/client && npm run typecheck`。
- 手工页面验证留控制器；实现者只交代码 + 单测 + 类型检查，并在报告中注明"手工验证未做"。

---

## 文件结构

| 文件 | 职责 |
| --- | --- |
| `packages/server/src/services/paper-generator.ts`（改） | 抽出并导出 `listSlotCandidates`；picker 改为逐级调用它；P1b 让 picker 返回 level/candidates 并写 `pickMeta` |
| `packages/server/src/services/paper-preflight.ts`（新） | 发布前预检：固定题位绑定、抽题题位 strict 池、缺口成因 |
| `packages/server/src/jobs/paper-generation-queue.ts`（新） | BullMQ 队列 + worker + `processPaperGeneration`（分页、并发 4、取消检测、汇总） |
| `packages/server/src/services/paper-difficulty-repair.ts`（新） | 纯函数：难度目标换算 + 局部换题（generate-and-repair） |
| `packages/server/src/routes/exams.ts`（改） | 发布接入预检/入队；`GET/POST paper-generation`；绑卷时拷贝 `difficultyTarget`（P1b） |
| `packages/server/src/routes/papers.ts`（改） | P1b：试卷 API 接受 `difficultyTarget` |
| `packages/client/src/pages/teacher/ExamDetailDrawer.tsx`（改） | 「组卷质量」卡片（状态/进度/分布/降级/异常卷子/重试） |
| `packages/client/src/pages/teacher/PaperEditor.tsx`（改） | P1b：难度目标配置（三档百分比） |
| `packages/client/src/services/api.ts`（改） | 组卷状态/重试/异常卷子接口 |

---

# P1a：预检 + 预生成 + 报告

### Task 1: 抽出唯一的候选枚举入口 `listSlotCandidates`

**Files:**
- Modify: `packages/server/src/services/paper-generator.ts:195-265`（picker 的候选查询与过滤）
- Test: `packages/server/src/services/__tests__/paper-generator-candidates.test.ts`（新建）

**Interfaces:**
- Produces:
  ```ts
  export type CandidateLevel = 'strict' | 'relax-schemaRefs' | 'relax-difficulty';
  export interface SlotCandidate { id: string; score: number | null; difficulty: string | null; schemaRefs: unknown; answerRules: unknown; }
  export async function listSlotCandidates(params: {
    rule: SlotRule;
    slotScore: number;
    level: CandidateLevel;
    usedQuestionIds?: ReadonlySet<string>;
    poolWhere?: Record<string, any>;
    tx?: { question: { findMany: (...args: any[]) => Promise<any[]> } } | Prisma.TransactionClient;
  }): Promise<SlotCandidate[]>;
  export async function loadQuestionPoolWhereForExamPaper(examId: string, tx: Prisma.TransactionClient): Promise<Record<string, any> | undefined>;  // 改为 export
  ```
- 语义必须与现有 picker 完全一致：`strict` 与 `relax-schemaRefs` 的 where 相同（都带 `rule.difficulty`），区别只在 strict 强制 `schemaRefsSignature` 相等；`relax-difficulty` 去掉难度条件；三档都过滤分值不符、本卷已用、`unsupportedRuleActions` 非空；`orderBy: { id: 'asc' }`。

- [ ] **Step 1: 写失败的测试**

创建 `packages/server/src/services/__tests__/paper-generator-candidates.test.ts`：

```ts
/**
 * 候选枚举唯一入口的测试。
 * 预检/生成/修复三处共用它，所以这里锁死的是"三档各放宽什么、共同过滤什么"。
 */
import { describe, it, expect, vi } from 'vitest';

const findMany = vi.fn();
vi.mock('../../config/prisma', () => ({ prisma: {} }));

import { listSlotCandidates, type SlotRule } from '../paper-generator';

const q = (id: string, over: Partial<{ score: number; difficulty: string; schemaRefs: any; answerRules: any }> = {}) => ({
  id, score: 10, difficulty: 'easy',
  schemaRefs: { tables: ['员工信息表'], fields: [] },
  answerRules: [{ action: 'check_field', params: {} }],
  ...over,
});

const rule = (over: Partial<SlotRule> = {}): SlotRule => ({ type: 'comprehensive', ...over });
const tx = { question: { findMany } } as any;

describe('listSlotCandidates', () => {
  it('strict：过滤分值不符、已用、引擎判不了、结构签名不一致', async () => {
    findMany.mockResolvedValue([
      q('a'),
      q('b', { score: 20 }),
      q('c', { schemaRefs: { tables: ['别的表'], fields: [] } }),
      q('d', { answerRules: [{ action: 'verify_dashboard_chart', params: {} }] }),
      q('e'),
    ]);
    const out = await listSlotCandidates({
      rule: rule({ schemaRefs: { tables: ['员工信息表'], fields: [] } }),
      slotScore: 10, level: 'strict', usedQuestionIds: new Set(['e']), tx,
    });
    expect(out.map(c => c.id)).toEqual(['a']);
  });

  it('relax-schemaRefs：同样带难度条件，但不再比较结构签名', async () => {
    findMany.mockResolvedValue([
      q('a'), q('c', { schemaRefs: { tables: ['别的表'], fields: [] } }),
    ]);
    const out = await listSlotCandidates({
      rule: rule({ schemaRefs: { tables: ['员工信息表'], fields: [] } }),
      slotScore: 10, level: 'relax-schemaRefs', tx,
    });
    expect(out.map(c => c.id)).toEqual(['a', 'c']);
  });

  it('relax-difficulty：去掉难度条件，其余过滤保留', async () => {
    findMany.mockResolvedValue([q('a', { difficulty: 'hard' }), q('b', { score: 5 })]);
    const out = await listSlotCandidates({
      rule: rule({ difficulty: 'easy' }), slotScore: 10, level: 'relax-difficulty', tx,
    });
    expect(out.map(c => c.id)).toEqual(['a']);
  });

  it('三档都排除引擎判不了的题', async () => {
    findMany.mockResolvedValue([q('bad', { answerRules: [{ action: 'verify_ocr_functionality' }] })]);
    for (const level of ['strict', 'relax-schemaRefs', 'relax-difficulty'] as const) {
      expect(await listSlotCandidates({ rule: rule(), slotScore: 10, level, tx })).toEqual([]);
    }
  });

  it('poolWhere 挂到 AND 上，不覆盖 status/type', async () => {
    findMany.mockResolvedValue([]);
    await listSlotCandidates({
      rule: rule(), slotScore: 10, level: 'strict',
      poolWhere: { OR: [{ departmentId: 'd-1' }, { departmentId: null }] }, tx,
    });
    const where = findMany.mock.calls[0][0].where;
    expect(where.status).toBe('published');
    expect(where.type).toBe('comprehensive');
    expect(where.AND).toEqual([{ OR: [{ departmentId: 'd-1' }, { departmentId: null }] }]);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/server && npx vitest run src/services/__tests__/paper-generator-candidates.test.ts`
Expected: FAIL —— `listSlotCandidates is not a function` / 导入失败。

- [ ] **Step 3: 实现提取，并让 picker 改用它**

在 `paper-generator.ts` 中新增（放在 `pickQuestionForSlot` 之前）：

```ts
export type CandidateLevel = 'strict' | 'relax-schemaRefs' | 'relax-difficulty';

export interface SlotCandidate {
  id: string;
  score: number | null;
  difficulty: string | null;
  schemaRefs: unknown;
  answerRules: unknown;
}

/**
 * 候选枚举的**唯一入口**：预检、生成、修复三处共用。
 *
 * 为什么必须唯一：如果预检和生成各写一套过滤，就会出现"预检说有候选、开考抽不出来"
 * ——这正是 `schemaRefs` 校验最初断链时的形态。三档放宽的语义也集中在这里：
 *   strict            —— 带难度条件 + 结构签名必须一致
 *   relax-schemaRefs  —— 带难度条件，结构签名不再比较
 *   relax-difficulty  —— 去掉难度条件，其余（分值/已用/可判分/池范围）仍生效
 */
export async function listSlotCandidates(params: {
  rule: SlotRule;
  slotScore: number;
  level: CandidateLevel;
  usedQuestionIds?: ReadonlySet<string>;
  poolWhere?: Record<string, any>;
  tx?: Prisma.TransactionClient | { question: { findMany: (args: any) => Promise<any[]> } };
}): Promise<SlotCandidate[]> {
  const { rule, slotScore, level, usedQuestionIds, poolWhere, tx = prisma } = params;

  const where: Prisma.QuestionWhereInput = { status: 'published' };
  if (rule.capabilityIds?.length) where.capabilityIds = { hasEvery: rule.capabilityIds };
  if (rule.type) where.type = rule.type as any;
  if (poolWhere && Object.keys(poolWhere).length > 0) (where as any).AND = [poolWhere];
  // 只有 relax-difficulty 才去掉难度条件；strict 与 relax-schemaRefs 的 where 相同
  if (level !== 'relax-difficulty' && rule.difficulty) where.difficulty = rule.difficulty as any;

  const rows = (await (tx as any).question.findMany({
    where,
    select: { id: true, score: true, difficulty: true, schemaRefs: true, answerRules: true },
    orderBy: { id: 'asc' }, // 稳定排序：同样候选集得到同样顺序（确定性前提）
  })) as SlotCandidate[];

  const wanted = rule.schemaRefs ? schemaRefsSignature(rule.schemaRefs) : '';
  return rows.filter(c => {
    if ((c.score ?? 0) !== slotScore) return false;
    if (usedQuestionIds?.has(c.id)) return false;
    // 引擎判不了的题不进任何一档：放宽的是结构与难度，不是"能不能自动判分"
    if (unsupportedRuleActions(c.answerRules).length > 0) return false;
    if (level === 'strict' && wanted) return schemaRefsSignature(c.schemaRefs) === wanted;
    return true;
  });
}
```

把 `loadQuestionPoolWhereForExamPaper` 改为 `export`。

把 `pickQuestionForSlot` 的 attempts 循环替换为：

```ts
  const levels: CandidateLevel[] = ['strict', 'relax-schemaRefs', 'relax-difficulty'];
  for (const level of levels) {
    const pool = await listSlotCandidates({ rule, slotScore, level, usedQuestionIds, poolWhere, tx });
    if (pool.length > 0) {
      // ── 按「本场考试该题位已分配次数」均衡取材（语义与重构前完全一致）──
      const usage = await tx.studentExamQuestion.groupBy({
        by: ['questionId'],
        where: { examId, slotIndex },
        _count: { _all: true },
      });
      const usedCount = new Map(usage.map(u => [u.questionId, u._count._all]));
      const minUsed = Math.min(...pool.map(c => usedCount.get(c.id) ?? 0));
      const leastUsed = pool.filter(c => (usedCount.get(c.id) ?? 0) === minUsed);
      return leastUsed[seededPickIndex(seed, leastUsed.length)];
    }
  }
  return null;
```

（`pickQuestionForSlot` 的返回类型保持现状；`examId`/`slotIndex`/`seed` 参数不变。）

- [ ] **Step 4: 跑新测试与回归**

Run: `cd packages/server && npx vitest run src/services/__tests__/paper-generator-candidates.test.ts src/services/__tests__/paper-generator.test.ts`
Expected: 新测试 5/5 通过；原 `paper-generator.test.ts` 全绿（重构不改语义）。

Run: `cd packages/server && npx tsc --noEmit -p tsconfig.json`
Expected: 0 error。

- [ ] **Step 5: 提交**

```bash
git commit -m "refactor(papers): 抽出唯一的候选枚举入口 listSlotCandidates（预检/生成/修复共用）" -- \
  packages/server/src/services/paper-generator.ts \
  packages/server/src/services/__tests__/paper-generator-candidates.test.ts
```

---

### Task 2: 迁移 —— `ExamPaperGeneration` 表

**Files:**
- Modify: `packages/server/prisma/schema.prisma`
- Create: `packages/server/prisma/migrations/<YYYYMMDDHHMMSS>_paper_generation/migration.sql`

**Interfaces:**
- Produces: Prisma 客户端 `examPaperGeneration` 模型，字段：
  `id, examId(@unique), status('pending'|'running'|'done'|'failed'), totalStudents, unfilledSlots Json?, summary Json?, error String?, queuedAt, startedAt?, finishedAt?`

- [ ] **Step 1: 改 schema**

在 `model Exam` 的关系区加一行（放在其它 `@relation` 附近）：

```prisma
  paperGeneration ExamPaperGeneration?
```

在 `model StudentExamQuestion` 之后新增：

```prisma
/// 组卷预生成状态与汇总（一考试一行）：记录异步预生成的状态、进度来源与质量报告。
/// 状态的行数/进度不冗余存计数器——已生成人数按需从 student_exam_questions 聚合，避免热行写冲突。
model ExamPaperGeneration {
  id            String    @id @default(uuid()) @db.Uuid
  examId        String    @unique @map("exam_id") @db.Uuid
  /// pending | running | done | failed
  status        String    @default("pending") @db.VarChar(16)
  totalStudents Int       @default(0) @map("total_students")
  unfilledSlots Json?     @map("unfilled_slots")
  summary       Json?
  error         String?   @db.Text
  queuedAt      DateTime  @default(now()) @map("queued_at")
  startedAt     DateTime? @map("started_at")
  finishedAt    DateTime? @map("finished_at")

  exam Exam @relation(fields: [examId], references: [id], onDelete: Cascade)

  @@map("exam_paper_generations")
}
```

- [ ] **Step 2: 先确认没有别人的 pending 迁移**

Run: `cd packages/server && npx prisma migrate status`
Expected: `Database schema is up to date!`（若列出 pending 迁移 → 停下问控制器，不要 apply 别人的迁移）

- [ ] **Step 3: 手写迁移 SQL**

```bash
cd packages/server
mkdir -p prisma/migrations/20261023120000_paper_generation
cat > prisma/migrations/20261023120000_paper_generation/migration.sql <<'SQL'
-- CreateTable
CREATE TABLE "exam_paper_generations" (
    "id" UUID NOT NULL,
    "exam_id" UUID NOT NULL,
    "status" VARCHAR(16) NOT NULL DEFAULT 'pending',
    "total_students" INTEGER NOT NULL DEFAULT 0,
    "unfilled_slots" JSONB,
    "summary" JSONB,
    "error" TEXT,
    "queued_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),

    CONSTRAINT "exam_paper_generations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "exam_paper_generations_exam_id_key" ON "exam_paper_generations"("exam_id");

-- AddForeignKey
ALTER TABLE "exam_paper_generations" ADD CONSTRAINT "exam_paper_generations_exam_id_fkey" FOREIGN KEY ("exam_id") REFERENCES "exams"("id") ON DELETE CASCADE ON UPDATE CASCADE;
SQL
```

- [ ] **Step 4: 应用 + 生成客户端 + 校验零差异**

```bash
cd packages/server
npx prisma migrate deploy
npx prisma generate
npx prisma migrate diff --from-schema-datasource prisma/schema.prisma --to-schema-datamodel prisma/schema.prisma --script
```
Expected: `1 migration applied`；最后一条输出 `-- This is an empty migration.`（若打出 ALTER，按差集新建一条迁移再 deploy，并记录偏差）。

Run: `cd packages/server && npx tsc --noEmit -p tsconfig.json`
Expected: 0 error。

- [ ] **Step 5: 提交**

```bash
git commit -m "feat(db): ExamPaperGeneration（组卷预生成状态与汇总）" -- \
  packages/server/prisma/schema.prisma packages/server/prisma/migrations
```

---

### Task 3: 预检服务 `preflightExamPaper`

**Files:**
- Create: `packages/server/src/services/paper-preflight.ts`
- Test: `packages/server/src/services/__tests__/paper-preflight.test.ts`

**Interfaces:**
- Consumes: `listSlotCandidates`、`loadQuestionPoolWhereForExamPaper`（Task 1）
- Produces:
  ```ts
  export interface PreflightIssue { slotIndex: number; reason: string; candidates: number; signatureConflict: boolean }
  export async function preflightExamPaper(examId: string, tx?: Prisma.TransactionClient): Promise<{ ok: boolean; issues: PreflightIssue[] }>
  ```

- [ ] **Step 1: 写失败的测试**

```ts
import { describe, it, expect, vi } from 'vitest';

const examQuestionFindMany = vi.fn();
const examFindUnique = vi.fn();
const paperFindUnique = vi.fn();
const questionFindMany = vi.fn();
vi.mock('../../config/prisma', () => ({ prisma: {} }));

import { preflightExamPaper } from '../paper-preflight';

const tx = {
  examQuestion: { findMany: examQuestionFindMany },
  exam: { findUnique: examFindUnique },
  paper: { findUnique: paperFindUnique },
  question: { findMany: questionFindMany },
} as any;

const ruleSlot = (slotIndex: number, rule: any, scoreOverride = 10) =>
  ({ slotIndex, sortOrder: slotIndex, slotType: 'rule', questionId: null, scoreOverride, rule });

describe('preflightExamPaper', () => {
  it('固定题位未绑题 → 阻断', async () => {
    examQuestionFindMany.mockResolvedValue([
      { slotIndex: 0, slotType: 'fixed', questionId: null, scoreOverride: null, rule: null },
    ]);
    examFindUnique.mockResolvedValue({ paperId: null });
    const out = await preflightExamPaper('e-1', tx);
    expect(out.ok).toBe(false);
    expect(out.issues[0]).toMatchObject({ slotIndex: 0, reason: '固定题位未绑定题目', candidates: 0 });
  });

  it('抽题题位的 strict 池为空 → 阻断，并区分"结构签名冲突"', async () => {
    examQuestionFindMany.mockResolvedValue([ruleSlot(1, { type: 'comprehensive', schemaRefs: { tables: ['员工信息表'] } })]);
    examFindUnique.mockResolvedValue({ paperId: 'p-1' });
    paperFindUnique.mockResolvedValue({ createdBy: 'u-1', departmentId: null });
    // strict 空 → 会再查 relax-schemaRefs 与 relax-difficulty 以区分成因，三次都要给返回值
    questionFindMany
      .mockResolvedValueOnce([])   // strict
      .mockResolvedValueOnce([{ id: 'q-1', score: 10, difficulty: 'easy', schemaRefs: { tables: ['别的表'] }, answerRules: [] }]) // relax-schemaRefs
      .mockResolvedValueOnce([{ id: 'q-1', score: 10, difficulty: 'easy', schemaRefs: { tables: ['别的表'] }, answerRules: [] }]); // relax-difficulty
    const out = await preflightExamPaper('e-1', tx);
    expect(out.ok).toBe(false);
    expect(out.issues[0]).toMatchObject({ slotIndex: 1, candidates: 0, signatureConflict: true });
  });

  it('全部满足 → 通过', async () => {
    examQuestionFindMany.mockResolvedValue([ruleSlot(0, { type: 'comprehensive' })]);
    examFindUnique.mockResolvedValue({ paperId: 'p-1' });
    paperFindUnique.mockResolvedValue({ createdBy: 'u-1', departmentId: null });
    questionFindMany.mockResolvedValue([{ id: 'q-1', score: 10, difficulty: 'easy', schemaRefs: null, answerRules: [] }]);
    const out = await preflightExamPaper('e-1', tx);
    expect(out).toEqual({ ok: true, issues: [] });
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/server && npx vitest run src/services/__tests__/paper-preflight.test.ts`
Expected: FAIL —— 模块不存在。

- [ ] **Step 3: 实现**

```ts
/**
 * 发布前预检：在发布那一刻逐题位回答"这个题位至少有一道可用题吗？"。
 *
 * 与生成共用 `listSlotCandidates`，所以候选池与三档放宽的口径一致；但**预检不模拟跨题位占用**
 * （固定题位已绑定的题、先序抽题已占用的题，不会从后续题位的池子里扣除），
 * 因此"预检通过"是**存在性上界**，不等于每份卷子必然填满——真实缺口以生成结果
 * `unfilledSlots` 为准（会汇总进 `ExamPaperGeneration.summary`，发布后可见）。
 * 后续若要让发布即精确，需按生成同序模拟分配并累加 usedQuestionIds（P1c 可选）。
 *
 * 空题位 / 不存在的考试返回 ok:true：调用方（发布路由）已有"考试必须有题目"的前置校验。
 */
import { prisma } from '../config/prisma';
import type { Prisma } from '@prisma/client';
import { listSlotCandidates, loadQuestionPoolWhereForExamPaper, type SlotRule } from './paper-generator';

export interface PreflightIssue {
  slotIndex: number;
  reason: string;
  candidates: number;
  signatureConflict: boolean;
}

export async function preflightExamPaper(
  examId: string,
  tx: Prisma.TransactionClient = prisma,
): Promise<{ ok: boolean; issues: PreflightIssue[] }> {
  const slots = await tx.examQuestion.findMany({
    where: { examId },
    orderBy: [{ slotIndex: 'asc' }, { sortOrder: 'asc' }],
  });

  // 有试卷但题位为空（试卷题目未同步/被清空）：发布前置的 hasQuestions 只看 paper 题数，
  // 会放行并生成 0 题卷子——这里补一道。不存在的考试仍返回 ok（由发布路由的前置校验兜住）。
  if (slots.length === 0) {
    return {
      ok: false,
      issues: [{ slotIndex: 0, reason: '考试没有题位（请检查试卷题目是否已同步）', candidates: 0, signatureConflict: false }],
    };
  }

  const poolWhere = slots.some(s => s.slotType === 'rule')
    ? await loadQuestionPoolWhereForExamPaper(examId, tx)
    : undefined;

  const issues: PreflightIssue[] = [];

  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i];
    const slotIndex = slot.slotIndex || i;

    if (slot.slotType !== 'rule') {
      // 固定题位没有题目 = 开考时必然少一道题，属硬失败
      if (!slot.questionId) {
        issues.push({ slotIndex, reason: '固定题位未绑定题目', candidates: 0, signatureConflict: false });
      }
      continue;
    }

    const rule = (slot.rule || {}) as SlotRule;
    const slotScore = slot.scoreOverride ?? 0;

    const strict = await listSlotCandidates({ rule, slotScore, level: 'strict', poolWhere, tx });
    if (strict.length > 0) continue;

    // 区分成因，给教师可执行的提示：
    //   relax-schemaRefs 有候选 → 是结构签名没对齐（题位声明的表/字段与题库不一致）
    //   relax-difficulty 有候选 → 是难度条件太窄
    //   都空                   → 候选池本身为空（题型/能力点/分值/池范围）
    const relaxed = await listSlotCandidates({ rule, slotScore, level: 'relax-schemaRefs', poolWhere, tx });
    // signatureConflict 时 byScore 的结果用不上（原因已确定），省一次查询
    const byScore = relaxed.length > 0 ? [] : await listSlotCandidates({ rule, slotScore, level: 'relax-difficulty', poolWhere, tx });
    const signatureConflict = relaxed.length > 0;
    issues.push({
      slotIndex,
      candidates: 0,
      signatureConflict,
      reason: signatureConflict
        ? '候选题的引用结构与题位声明不一致（请统一「引用结构」或换题）'
        : byScore.length > 0
          ? '候选题难度不足（该难度下没有可用题）'
          // 分值在每一档都恒定过滤（paper-generator.ts 的 pool 内判断），不属于"难度不足"的成因；
          // 「池为空」还要覆盖两类常被忽略的原因：题目未上架、规则含引擎不支持的 action
          : '候选池为空（检查题目是否已上架 / 题型与能力点 / 规则是否可自动判分 / 题库可见范围）',
    });
  }

  return { ok: issues.length === 0, issues };
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd packages/server && npx vitest run src/services/__tests__/paper-preflight.test.ts`
Expected: PASS 5/5（固定题位 / 签名冲突 / 难度不足 / 池为空 / 三档顺序与跳过优化）。

- [ ] **Step 5: 提交**

```bash
git commit -m "feat(papers): 发布前组卷预检（缺口逐题位归因，与生成共用候选枚举）" -- \
  packages/server/src/services/paper-preflight.ts \
  packages/server/src/services/__tests__/paper-preflight.test.ts
```

---

### Task 4: 发布接入 —— 预检阻断 + 记录 + 入队

**Files:**
- Modify: `packages/server/src/routes/exams.ts`（publish handler，约 :588-640）
- Modify: `packages/server/src/jobs/paper-generation-queue.ts`（本任务先只加 `enqueuePaperGeneration`，worker 在 Task 5）
- Test: `packages/server/src/routes/__tests__/exam-publish-preflight.test.ts`

**Interfaces:**
- Consumes: `preflightExamPaper`（Task 3）、`enqueuePaperGeneration`（本任务）
- Produces: 发布成功响应追加 `paperGeneration: { status: 'pending' | 'failed' }`；预检失败返回
  `400 { message, preflight: PreflightIssue[] }`

- [ ] **Step 1: 写失败的测试**

```ts
/**
 * 发布预检：不满足硬约束必须阻断，且不得把考试状态改成 published。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';

vi.mock('../../middleware/auth', async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    authenticate: (req: any, _res: any, next: any) => {
      req.user = { id: 't-1', userId: 't-1', username: 't-1', role: 'teacher', permissions: [], departmentId: 'd-1' };
      next();
    },
  };
});

const preflightMock = vi.fn();
vi.mock('../../services/paper-preflight', () => ({ preflightExamPaper: preflightMock }));

const enqueueMock = vi.fn();
vi.mock('../../jobs/paper-generation-queue', () => ({ enqueuePaperGeneration: enqueueMock }));

const examFindUnique = vi.fn();
const examUpdate = vi.fn();
const examRoomStudentFindMany = vi.fn();
const tableFindMany = vi.fn();
const generationUpsert = vi.fn();
const generationUpdate = vi.fn();
vi.mock('../../config/prisma', () => ({
  prisma: {
    exam: { findUnique: examFindUnique, update: examUpdate },
    examRoomStudent: { findMany: examRoomStudentFindMany },
    examTableAssignment: { findMany: tableFindMany },
    examPaperGeneration: { upsert: generationUpsert, update: generationUpdate },
  },
}));
vi.mock('../../services/data-scope', async (importOriginal) => {
  const actual = await importOriginal<any>();
  return { ...actual, assertPaperRead: vi.fn(), questionWhere: vi.fn(() => ({})), questionPoolWhereForPaper: vi.fn(() => ({})) };
});

import { examRouter } from '../exams';

const app = express();
app.use(express.json());
app.use('/api/exams', examRouter);

const examRow = {
  id: 'e-1', title: '期中', startTime: null, status: 'draft', paperId: 'p-1', createdBy: 't-1',
  _count: { examQuestions: 2 }, paper: { _count: { paperQuestions: 2 } }, batch: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  examFindUnique.mockResolvedValue(examRow);
  examRoomStudentFindMany.mockResolvedValue([{ studentId: 's-1' }, { studentId: 's-2' }]);
  tableFindMany.mockResolvedValue([{ studentId: 's-1' }, { studentId: 's-2' }]);
  generationUpsert.mockResolvedValue({});
  enqueueMock.mockResolvedValue({ queued: true });
});

describe('POST /api/exams/:id/publish —— 组卷预检', () => {
  it('预检不通过 → 400 + preflight，且不发布', async () => {
    preflightMock.mockResolvedValue({ ok: false, issues: [{ slotIndex: 1, reason: '候选池为空', candidates: 0, signatureConflict: false }] });
    const res = await request(app).post('/api/exams/e-1/publish');
    expect(res.status).toBe(400);
    expect(res.body.preflight).toEqual([{ slotIndex: 1, reason: '候选池为空', candidates: 0, signatureConflict: false }]);
    expect(examUpdate).not.toHaveBeenCalled();
    expect(enqueueMock).not.toHaveBeenCalled();
  });

  it('预检通过 → 发布 + 建状态行 + 入队', async () => {
    preflightMock.mockResolvedValue({ ok: true, issues: [] });
    examUpdate.mockResolvedValue({ ...examRow, status: 'published' });
    const res = await request(app).post('/api/exams/e-1/publish');
    expect(res.status).toBe(200);
    expect(res.body.paperGeneration).toEqual({ status: 'pending' });
    expect(generationUpsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { examId: 'e-1' },
      create: expect.objectContaining({ examId: 'e-1', status: 'pending', totalStudents: 2 }),
    }));
    expect(enqueueMock).toHaveBeenCalledWith('e-1');
  });

  it('队列不可用 → 仍发布，但状态标 failed', async () => {
    preflightMock.mockResolvedValue({ ok: true, issues: [] });
    examUpdate.mockResolvedValue({ ...examRow, status: 'published' });
    enqueueMock.mockResolvedValue({ queued: false });
    const res = await request(app).post('/api/exams/e-1/publish');
    expect(res.status).toBe(200);
    expect(res.body.paperGeneration).toEqual({ status: 'failed' });
    // 先 upsert(pending)，队列不可用后再 update 成 failed
    expect(generationUpdate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'failed' }),
    }));
  });
});
```

> 注：`checkExamAccess` 在 `routes/exams.ts` 内实现，测试里可能需要按实际依赖补 mock（若报未 mock 的 prisma 方法，按报错补齐 mock 对象，**不要改路由迁就测试**）。

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/server && npx vitest run src/routes/__tests__/exam-publish-preflight.test.ts`
Expected: FAIL —— `paperGeneration` 不存在 / preflight 未调用。

- [ ] **Step 3: 实现**

`jobs/paper-generation-queue.ts` 先建骨架（worker 在 Task 5 补）：

```ts
/**
 * 组卷预生成队列 — BullMQ
 *
 * 发布考试后异步为名单内每个考生生成卷子快照。与判分队列同一套连接/降级策略：
 * Redis 不可用时 `queued: false`，发布仍成功，开考时走现场生成兜底。
 */
import { Queue, Worker, Job, type ConnectionOptions } from 'bullmq';
import { config } from '../config';

function getConnectionOpts(): ConnectionOptions | null {
  try {
    const url = new URL(config.redis.url);
    return {
      host: url.hostname,
      port: parseInt(url.port || '6379'),
      password: url.password || undefined,
      maxRetriesPerRequest: null as any,
    };
  } catch {
    console.warn('[Queue] Redis URL 解析失败，论文预生成将退回开考现场生成');
    return null;
  }
}

let queue: Queue | null = null;

export function getPaperGenerationQueue(): Queue | null {
  if (queue) return queue;
  const conn = getConnectionOpts();
  if (!conn) return null;
  queue = new Queue('paper-generation', { connection: conn });
  return queue;
}

/** 入队超时：Redis 进程宕机但 URL 仍可解析时，ioredis 的离线队列会让 add 一直等重连 */
const ENQUEUE_TIMEOUT_MS = 3000;

export async function enqueuePaperGeneration(examId: string): Promise<{ queued: boolean }> {
  const q = getPaperGenerationQueue();
  if (!q) return { queued: false };
  try {
    await Promise.race([
      q.add('generate', { examId }, {
        // 注意：同 jobId 在 completed/failed 集合里仍存在时，BullMQ 会静默忽略入队——
        // 重试/重发前必须先 remove（Task 6 的验收集）
        jobId: `paper-generation-${examId}`,
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: 20,
        removeOnFail: 20,
      }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('enqueue timeout')), ENQUEUE_TIMEOUT_MS)),
    ]);
    return { queued: true };
  } catch (err) {
    // 队列不可用/超时都按"未入队"处理：调用方标 failed，开考现场生成兜底
    // pino v10：对象在前、消息在后；反过来会把 err 静默丢弃（实测）
    logger.warn({ examId, err }, '组卷预生成入队失败');
    return { queued: false };
  }
}
```

`routes/exams.ts` 的 publish handler：在"未分配表格"校验之后、状态更新之前插入预检；更新之后建状态行并入队：

```ts
    // ── 组卷预检（硬约束）──
    // 预检不通过就不发布：否则学生会拿到缺题的卷子，而教师只能等开考后才发现
    const preflight = await preflightExamPaper(req.params.id);
    if (!preflight.ok) {
      return res.status(400).json({
        message: `组卷预检未通过：${preflight.issues.length} 个题位没有可用题目`,
        preflight: preflight.issues,
      });
    }

    // 发布时：有未来开始时间 → scheduled，否则 → published
    const newStatus = exam.startTime && new Date(exam.startTime) > new Date() ? 'scheduled' : 'published';

    const updated = await prisma.exam.update({
      where: { id: req.params.id },
      data: { status: newStatus },
    });

    // 预生成：建/重置状态行后入队。调度失败**不能**让发布变成 500——考试此时已经发布了，
    // 正确语义是"发布成功 + 组卷欠账"（开考时现场生成兜底）。
    let generationStatus: 'pending' | 'failed' = 'pending';
    try {
      await prisma.examPaperGeneration.upsert({
        where: { examId: req.params.id },
        create: { examId: req.params.id, status: 'pending', totalStudents: studentIds.length },
        update: {
          status: 'pending', totalStudents: studentIds.length,
          queuedAt: new Date(), startedAt: null, finishedAt: null, error: null,
          summary: Prisma.JsonNull, unfilledSlots: Prisma.JsonNull,
        },
      });
      const enqueued = await enqueuePaperGeneration(req.params.id);
      if (!enqueued.queued) {
        generationStatus = 'failed';
        await prisma.examPaperGeneration.update({
          where: { examId: req.params.id },
          data: { status: 'failed', error: '组卷队列不可用（Redis 未启动）；开考时将现场生成' },
        });
      }
    } catch (err) {
      generationStatus = 'failed';
      logger.error({ err }, '组卷预生成调度失败');
      // 尽力标记失败（upsert 成功时才有行；连行都没建时，开考兜底仍然成立）
      await prisma.examPaperGeneration
        .updateMany({ where: { examId: req.params.id }, data: { status: 'failed', error: '组卷调度失败；开考时将现场生成' } })
        .catch(() => {});
    }

    res.json({ ...updated, paperGeneration: { status: generationStatus } });
```

并在文件顶部补 import：`import { preflightExamPaper } from '../services/paper-preflight';`、`import { enqueuePaperGeneration } from '../jobs/paper-generation-queue';`、`import { logger } from '../utils/logger';`、`import { Prisma } from '@prisma/client';`（若已有 Prisma import 则复用）。

- [ ] **Step 4: 跑测试确认通过**

Run: `cd packages/server && npx vitest run src/routes/__tests__/exam-publish-preflight.test.ts`
Expected: PASS 4/4（预检阻断 / 发布成功+入队 / 队列不可用标 failed / 入队异常仍 200）；另跑队列 3 例（`src/jobs/__tests__/paper-generation-queue.test.ts`）。

Run: `cd packages/server && npx tsc --noEmit -p tsconfig.json`
Expected: 0 error（若 `studentIds` 在该作用域不可用，按 publish handler 现有变量名调整）。

- [ ] **Step 5: 提交**

```bash
git commit -m "feat(exams): 发布接入组卷预检（阻断）+ 预生成入队（队列不可用则标 failed）" -- \
  packages/server/src/routes/exams.ts \
  packages/server/src/jobs/paper-generation-queue.ts \
  packages/server/src/routes/__tests__/exam-publish-preflight.test.ts
```

---

### Task 5: 预生成 worker —— 分页、并发、取消、汇总

> ⚠️ **契约（Task 4 审查补充）**：入队超时后，`q.add` 仍可能迟到落库；此时状态行已被标成 `failed`。Worker 必须**无条件按 jobId 处理**并覆盖行状态（不得因"行是 failed"就跳过）——生成本身幂等（`generateStudentPaper` 已有快照即早退），重复执行安全。

**Files:**
- Modify: `packages/server/src/jobs/paper-generation-queue.ts`
- Modify: `packages/server/src/index.ts:23-29`（`listen` 回调里启动 worker）
- Test: `packages/server/src/jobs/__tests__/paper-generation.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export async function processPaperGeneration(examId: string): Promise<{ generated: number; missing: number }>;
  export function startPaperGenerationWorkers(): void;
  export async function stopPaperGenerationWorkers(): Promise<void>;
  export async function getPaperGenerationProgress(examId: string): Promise<{ totalStudents: number; generatedStudents: number }>;
  ```

- [ ] **Step 1: 写失败的测试**

```ts
/**
 * 预生成任务：幂等、分页、取消、汇总。
 * 用依赖注入替代真实队列/DB（processPaperGeneration 接受可选的 deps）。
 */
import { describe, it, expect, vi } from 'vitest';
import { processPaperGeneration } from '../paper-generation-queue';

const students = Array.from({ length: 5 }, (_, i) => ({ studentId: `s-${i}` }));

describe('processPaperGeneration', () => {
  it('为名单内每个学生生成，缺卷者计入 missing', async () => {
    const generate = vi.fn()
      .mockResolvedValueOnce({ created: 3, total: 3, unfilledSlots: [] })
      .mockResolvedValueOnce({ created: 0, total: 3, unfilledSlots: [] })
      .mockResolvedValueOnce({ created: 3, total: 3, unfilledSlots: [] })
      .mockResolvedValueOnce({ created: 0, total: 0, unfilledSlots: [{ slotIndex: 2, reason: '候选池为空' }] })
      .mockResolvedValueOnce({ created: 3, total: 3, unfilledSlots: [] });
    const deps = {
      listStudents: vi.fn().mockResolvedValue(students),
      generate,
      getExamStatus: vi.fn().mockResolvedValue('published'),
      markStatus: vi.fn().mockResolvedValue(undefined),
    };
    const out = await processPaperGeneration('e-1', deps as any);
    expect(generate).toHaveBeenCalledTimes(5);
    expect(out.generated).toBe(4);   // total>0 视为有卷
    expect(out.missing).toBe(1);
    expect(deps.markStatus).toHaveBeenLastCalledWith('e-1', expect.objectContaining({ status: 'done' }));
  });

  it('考试在生成中被取消 → 停止并标 failed', async () => {
    const deps = {
      listStudents: vi.fn().mockResolvedValue([{ studentId: 's-0' }, { studentId: 's-1' }]),
      generate: vi.fn().mockResolvedValue({ created: 1, total: 1, unfilledSlots: [] }),
      getExamStatus: vi.fn().mockResolvedValue('cancelled'),
      markStatus: vi.fn().mockResolvedValue(undefined),
    };
    const out = await processPaperGeneration('e-1', deps as any);
    expect(out.generated).toBe(0);
    expect(deps.markStatus).toHaveBeenLastCalledWith('e-1', expect.objectContaining({ status: 'failed' }));
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/server && npx vitest run src/jobs/__tests__/paper-generation.test.ts`
Expected: FAIL —— `processPaperGeneration` 不存在。

- [ ] **Step 3: 实现**

在 `paper-generation-queue.ts` 追加：

```ts
import { prisma } from '../config/prisma';
import { generateStudentPaper } from '../services/paper-generator';

/** 依赖注入：生产用默认实现，测试用桩（避免真实队列/DB） */
export interface PaperGenerationDeps {
  listStudents: (examId: string) => Promise<Array<{ studentId: string }>>;
  generate: (examId: string, studentId: string) => Promise<{ created: number; total: number; unfilledSlots: Array<{ slotIndex: number; reason: string }> }>;
  getExamStatus: (examId: string) => Promise<string | null>;
  markStatus: (examId: string, patch: { status: string; error?: string; summary?: any; unfilledSlots?: any }) => Promise<void>;
}

const defaultDeps: PaperGenerationDeps = {
  listStudents: (examId) => prisma.examRoomStudent.findMany({
    where: { assignment: { examId } },
    select: { studentId: true },
    orderBy: { studentId: 'asc' },   // 确定性：同一批学生顺序稳定
  }),
  generate: (examId, studentId) => generateStudentPaper(examId, studentId),
  getExamStatus: async (examId) => (await prisma.exam.findUnique({ where: { id: examId }, select: { status: true } }))?.status ?? null,
  markStatus: async (examId, patch) => {
    await prisma.examPaperGeneration.updateMany({ where: { examId }, data: {
      status: patch.status,
      ...(patch.error ? { error: patch.error } : {}),
      ...(patch.summary ? { summary: patch.summary } : {}),
      ...(patch.unfilledSlots ? { unfilledSlots: patch.unfilledSlots } : {}),
      ...(patch.status === 'running' ? { startedAt: new Date() } : {}),
      ...(patch.status === 'done' || patch.status === 'failed' ? { finishedAt: new Date() } : {}),
    } });
  },
};

/** 并发受限的 map：WPS 无关，瓶颈是本机 DB + CPU；4 是保守值 */
async function mapWithConcurrency<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next++];
      await fn(item);
    }
  });
  await Promise.all(runners);
}

export async function processPaperGeneration(
  examId: string,
  deps: PaperGenerationDeps = defaultDeps,
): Promise<{ generated: number; missing: number }> {
  await deps.markStatus(examId, { status: 'running' });

  const students = await deps.listStudents(examId);
  let generated = 0;
  const unfilled = new Map<string, { slotIndex: number; reason: string; students: number }>();

  const PAGE = 200;
  for (let i = 0; i < students.length; i += PAGE) {
    // 每页开始前检查考试状态：取消/结束/删除后不再继续生成
    const status = await deps.getExamStatus(examId);
    if (!status || status === 'cancelled' || status === 'ended') {
      await deps.markStatus(examId, { status: 'failed', error: `考试已${status === 'ended' ? '结束' : '取消或删除'}，生成中止` });
      return { generated, missing: students.length - generated };
    }

    const page = students.slice(i, i + PAGE);
    await mapWithConcurrency(page, 4, async ({ studentId }) => {
      const r = await deps.generate(examId, studentId);
      if (r.total > 0) generated += 1;
      for (const u of r.unfilledSlots) {
        const key = `${u.slotIndex}:${u.reason}`;
        const cur = unfilled.get(key) ?? { slotIndex: u.slotIndex, reason: u.reason, students: 0 };
        cur.students += 1;
        unfilled.set(key, cur);
      }
    });
  }

  await deps.markStatus(examId, {
    status: 'done',
    summary: { generated, missing: students.length - generated },
    unfilledSlots: [...unfilled.values()],
  });
  return { generated, missing: students.length - generated };
}

export async function getPaperGenerationProgress(examId: string): Promise<{ totalStudents: number; generatedStudents: number }> {
  const [totalStudents, rows] = await Promise.all([
    prisma.examRoomStudent.count({ where: { assignment: { examId } } }),
    prisma.studentExamQuestion.findMany({ where: { examId }, select: { studentId: true }, distinct: ['studentId'] }),
  ]);
  return { totalStudents, generatedStudents: rows.length };
}

let worker: Worker | null = null;

export function startPaperGenerationWorkers(): void {
  const conn = getConnectionOpts();
  if (!conn) {
    console.log('[Worker] Redis 不可用，组卷预生成 Worker 未启动（开考时现场生成）');
    return;
  }
  worker = new Worker('paper-generation', async (job: Job) => {
    const { examId } = job.data as { examId: string };
    console.log(`[Worker] 开始预生成卷子: exam=${examId}`);
    const result = await processPaperGeneration(examId);
    console.log(`[Worker] 预生成完成: exam=${examId}, generated=${result.generated}, missing=${result.missing}`);
    return result;
  }, { connection: conn, concurrency: 1 });  // 一场考试一个 job；并发在 job 内控制
  worker.on('failed', (job, err) => console.error(`[Worker] 预生成失败: job=${job?.id}, error=${err.message}`));
  console.log('[Worker] 组卷预生成 Worker 已启动');
}

export async function stopPaperGenerationWorkers(): Promise<void> {
  await worker?.close();
  worker = null;
}
```

`index.ts`：引入 `startPaperGenerationWorkers, stopPaperGenerationWorkers`，在 `listen` 回调里（与 grading/import 并列）启动，在退出钩子里关闭。

- [ ] **Step 4: 跑测试确认通过 + 类型检查**

Run: `cd packages/server && npx vitest run src/jobs/__tests__/paper-generation.test.ts`
Expected: PASS 2/2。

Run: `cd packages/server && npx tsc --noEmit -p tsconfig.json`
Expected: 0 error。

- [ ] **Step 5: 提交**

```bash
git commit -m "feat(jobs): 组卷预生成 worker（分页/并发4/取消检测/汇总）+ 启动接入" -- \
  packages/server/src/jobs/paper-generation-queue.ts \
  packages/server/src/jobs/__tests__/paper-generation.test.ts \
  packages/server/src/index.ts
```

---

### Task 6: 状态与重试接口

**Files:**
- Modify: `packages/server/src/routes/exams.ts`
- Test: `packages/server/src/routes/__tests__/exam-paper-generation-api.test.ts`

**Interfaces:**
- Produces:
  - `GET /api/exams/:id/paper-generation` → `{ status, totalStudents, generatedStudents, summary, unfilledSlots, error, queuedAt, startedAt, finishedAt }`
  - `POST /api/exams/:id/paper-generation/retry` → `{ mode: 'regenerate' | 'fill-missing' }`；考试已结束/取消 → 409；重新组卷预检不过 → 400 + preflight

> ⚠️ **重试必须处理 jobId 去重**（Task 4 审查发现）：BullMQ 对已存在的 jobId（含 completed/failed 集合里残留的）会**静默忽略**入队，函数仍返回成功——"failed 后重试"将没有任务在跑。retry 入队前先 `await queue.remove(jobId).catch(() => {})`（或改用带尝试序号的 jobId），并补一条测试：旧 job 存在时重试仍产生新 job。

- [ ] **Step 1: 写失败的测试**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';

vi.mock('../../middleware/auth', async (importOriginal) => {
  const actual = await importOriginal<any>();
  return { ...actual, authenticate: (req: any, _res: any, next: any) => {
    req.user = { id: 't-1', userId: 't-1', username: 't-1', role: 'teacher', permissions: [], departmentId: 'd-1' }; next();
  } };
});
const preflightMock = vi.fn();
vi.mock('../../services/paper-preflight', () => ({ preflightExamPaper: preflightMock }));
const enqueueMock = vi.fn();
vi.mock('../../jobs/paper-generation-queue', () => ({ enqueuePaperGeneration: enqueueMock }));

const genFindUnique = vi.fn();
const studentCount = vi.fn();
const sqFindMany = vi.fn();
const submissionCount = vi.fn();
const sqDeleteMany = vi.fn();
const genDeleteMany = vi.fn();
const genCreate = vi.fn();
const genUpdate = vi.fn();
const examFindUnique = vi.fn();
vi.mock('../../config/prisma', () => ({ prisma: {
  exam: { findUnique: examFindUnique },
  examPaperGeneration: { findUnique: genFindUnique, deleteMany: genDeleteMany, create: genCreate, update: genUpdate },
  examRoomStudent: { count: studentCount },
  studentExamQuestion: { findMany: sqFindMany, deleteMany: sqDeleteMany },
  studentSubmission: { count: submissionCount },
} }));

import { examRouter } from '../exams';
const app = express(); app.use(express.json()); app.use('/api/exams', examRouter);

beforeEach(() => {
  vi.clearAllMocks();
  examFindUnique.mockResolvedValue({ id: 'e-1', status: 'published', paperId: 'p-1', createdBy: 't-1' });
  genFindUnique.mockResolvedValue({ examId: 'e-1', status: 'done', summary: { generated: 10 }, unfilledSlots: [], error: null, queuedAt: new Date('2026-10-23T01:00:00Z'), startedAt: null, finishedAt: null });
  studentCount.mockResolvedValue(10);
  sqFindMany.mockResolvedValue([{ studentId: 's-1' }, { studentId: 's-2' }]);
  enqueueMock.mockResolvedValue({ queued: true });
  genUpsert.mockResolvedValue({});
  preflightMock.mockResolvedValue({ ok: true, issues: [] });
});

describe('GET /api/exams/:id/paper-generation', () => {
  it('返回状态、进度与汇总', async () => {
    const res = await request(app).get('/api/exams/e-1/paper-generation');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'done', totalStudents: 10, generatedStudents: 2, summary: { generated: 10 } });
  });
});

describe('POST /api/exams/:id/paper-generation/retry', () => {
  it('已有提交 → 只补生成，不删快照', async () => {
    submissionCount.mockResolvedValue(3);
    const res = await request(app).post('/api/exams/e-1/paper-generation/retry');
    expect(res.status).toBe(200);
    expect(res.body.mode).toBe('fill-missing');
    expect(sqDeleteMany).not.toHaveBeenCalled();
    expect(enqueueMock).toHaveBeenCalledWith('e-1');
  });

  it('无提交 → 重新组卷：清空快照 + 预检 + 入队', async () => {
    submissionCount.mockResolvedValue(0);
    const res = await request(app).post('/api/exams/e-1/paper-generation/retry');
    expect(res.status).toBe(200);
    expect(res.body.mode).toBe('regenerate');
    expect(sqDeleteMany).toHaveBeenCalledWith({ where: { examId: 'e-1' } });
    expect(preflightMock).toHaveBeenCalledWith('e-1');
    expect(enqueueMock).toHaveBeenCalledWith('e-1');
  });

  it('考试已结束 → 409', async () => {
    examFindUnique.mockResolvedValue({ id: 'e-1', status: 'ended', paperId: 'p-1', createdBy: 't-1' });
    const res = await request(app).post('/api/exams/e-1/paper-generation/retry');
    expect(res.status).toBe(409);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/server && npx vitest run src/routes/__tests__/exam-paper-generation-api.test.ts`
Expected: FAIL —— 404。

- [ ] **Step 3: 实现**

在 `routes/exams.ts` 的 publish 路由之后追加：

```ts
// GET /api/exams/:id/paper-generation —— 组卷状态与质量报告
examRouter.get('/:id/paper-generation', async (req: Request, res: Response) => {
  try {
    const access = await checkExamAccess(req, req.params.id);
    if (access !== 'ok') return denyAccess(res, access);

    const gen = await prisma.examPaperGeneration.findUnique({ where: { examId: req.params.id } });
    const progress = await getPaperGenerationProgress(req.params.id);
    res.json({
      status: gen?.status ?? 'none',
      ...progress,
      summary: gen?.summary ?? null,
      unfilledSlots: gen?.unfilledSlots ?? null,
      error: gen?.error ?? null,
      queuedAt: gen?.queuedAt ?? null,
      startedAt: gen?.startedAt ?? null,
      finishedAt: gen?.finishedAt ?? null,
    });
  } catch {
    res.status(500).json({ message: '服务器错误' });
  }
});

// POST /api/exams/:id/paper-generation/retry —— 补生成 / 重新组卷
examRouter.post('/:id/paper-generation/retry', async (req: Request, res: Response) => {
  try {
    const access = await checkExamAccess(req, req.params.id);
    if (access !== 'ok') return denyAccess(res, access);

    const exam = await prisma.exam.findUnique({
      where: { id: req.params.id },
      select: { status: true },
    });
    if (!exam) return res.status(404).json({ message: '考试不存在' });
    if (exam.status === 'ended' || exam.status === 'cancelled') {
      return res.status(409).json({ message: '考试已结束/取消，无法重新组卷' });
    }

    // 「已开考」= 存在任何已开始的提交。这些学生手里已经拿着题目，
    // 清空快照等于换卷——只能补缺，不能重来。
    const started = await prisma.studentSubmission.count({
      where: {
        examId: req.params.id,
        status: { in: ['in_progress', 'submitted', 'grading', 'graded'] },
      },
    });

    if (started > 0) {
      const enq = await enqueuePaperGeneration(req.params.id);
      if (!enq.queued) return res.status(503).json({ message: '组卷队列不可用，请稍后重试' });
      return res.json({ mode: 'fill-missing' });
    }

    // 重新组卷：先预检（避免清空后才发现组不出来），再清空重建
    const preflight = await preflightExamPaper(req.params.id);
    if (!preflight.ok) {
      return res.status(400).json({ message: '组卷预检未通过', preflight: preflight.issues });
    }
    await prisma.studentExamQuestion.deleteMany({ where: { examId: req.params.id } });
    await prisma.examPaperGeneration.deleteMany({ where: { examId: req.params.id } });
    const studentCount = await prisma.examRoomStudent.count({ where: { assignment: { examId: req.params.id } } });
    await prisma.examPaperGeneration.create({
      data: { examId: req.params.id, status: 'pending', totalStudents: studentCount },
    });
    const enq = await enqueuePaperGeneration(req.params.id);
    if (!enq.queued) {
      await prisma.examPaperGeneration.update({
        where: { examId: req.params.id },
        data: { status: 'failed', error: '组卷队列不可用（Redis 未启动）；开考时将现场生成' },
      });
      return res.status(503).json({ message: '组卷队列不可用，已标记为失败；开考时将现场生成' });
    }
    res.json({ mode: 'regenerate' });
  } catch {
    res.status(500).json({ message: '服务器错误' });
  }
});
```

补 import：`getPaperGenerationProgress`。

- [ ] **Step 4: 跑测试确认通过**

Run: `cd packages/server && npx vitest run src/routes/__tests__/exam-paper-generation-api.test.ts`
Expected: PASS 4/4。

Run: `cd packages/server && npx tsc --noEmit -p tsconfig.json`
Expected: 0 error。

- [ ] **Step 5: 提交**

```bash
git commit -m "feat(exams): 组卷状态与重试接口（补生成 / 重新组卷，已开考绝不动快照）" -- \
  packages/server/src/routes/exams.ts \
  packages/server/src/routes/__tests__/exam-paper-generation-api.test.ts
```

---

### Task 7: 前端「组卷质量」卡片

**Files:**
- Modify: `packages/client/src/services/api.ts`（加 3 个方法）
- Modify: `packages/client/src/pages/teacher/ExamDetailDrawer.tsx`
- Test: 无组件测试基建（与仓库现状一致）；以 `npm run typecheck` + 手工验证为准

**Interfaces:**
- Consumes: `GET/POST /api/exams/:id/paper-generation*`（Task 6）
- Produces: 考试详情抽屉里的状态/进度/汇总展示 + 「补生成/重新组卷」按钮（带确认框）

- [ ] **Step 1: api.ts 加方法**

> ⚠️ 发布失败的 400 `preflight[]` 必须在**发布调用处**（`ExamForm.tsx` / `ExamManager.tsx`）逐条渲染（哪个题位、差在哪、是否结构签名冲突）——否则教师只看到"N 个题位没有可用题目"，不知道去改什么。这一条与组卷质量卡片同属本任务的教师可见面。

在考试相关分组里：

```ts
  /** 组卷状态与质量报告（预生成进度/难度分布/降级统计） */
  getPaperGeneration: (examId: string) => api.get(`/exams/${examId}/paper-generation`),
  /** 补生成（已有提交）或重新组卷（无提交）；服务端决定 mode */
  retryPaperGeneration: (examId: string) => api.post(`/exams/${examId}/paper-generation/retry`),
```

- [ ] **Step 2: 抽屉里加卡片**

在 `ExamDetailDrawer.tsx` 的 `Descriptions` 之后追加（需要 `Card / Button / Space / Alert / Modal` 等已有/补充 import，以及 `useEffect` 里拉取）：

```tsx
// state
const [gen, setGen] = useState<any>(null);
const [genLoading, setGenLoading] = useState(false);

const loadGeneration = useCallback(() => {
  if (!exam?.id) return;
  setGenLoading(true);
  examApi.getPaperGeneration(exam.id)
    .then(res => setGen(res.data))
    .catch(() => setGen(null))
    .finally(() => setGenLoading(false));
}, [exam?.id]);

useEffect(() => { loadGeneration(); }, [loadGeneration]);

// JSX：放在 Descriptions 之后
<Card
  size="small"
  title={<Space>组卷质量<Spin size="small" spinning={genLoading} /></Space>}
  style={{ marginTop: 16 }}
  extra={<Button size="small" onClick={loadGeneration}>刷新</Button>}
>
  {!gen ? (
    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无组卷记录" />
  ) : (
    <Space direction="vertical" style={{ width: '100%' }}>
      <div>
        状态：<Tag color={gen.status === 'done' ? 'success' : gen.status === 'failed' ? 'error' : 'processing'}>
          {{ none: '未开始', pending: '排队中', running: '生成中', done: '已完成', failed: '失败' }[gen.status as string] ?? gen.status}
        </Tag>
        进度：{gen.generatedStudents} / {gen.totalStudents} 人
      </div>
      {gen.error && <Alert type="error" showIcon message={gen.error} />}
      {gen.unfilledSlots?.length > 0 && (
        <Alert type="warning" showIcon message={`${gen.unfilledSlots.length} 类题位未能填满`}
          description={gen.unfilledSlots.map((u: any) => `题位 ${u.slotIndex + 1}：${u.reason}（${u.students} 人）`).join('；')} />
      )}
      <Space>
        <Button size="small" onClick={() => {
          Modal.confirm({
            title: '重新触发组卷？',
            content: '若已有学生开考，只会补齐缺失的卷子；否则将清空并重新生成全部卷子。',
            okText: '继续', cancelText: '取消',
            onOk: async () => {
              await examApi.retryPaperGeneration(exam.id);
              message.success('已触发组卷');
              loadGeneration();
            },
          });
        }}>补生成 / 重新组卷</Button>
      </Space>
    </Space>
  )}
</Card>
```

（若抽屉里已有 `examApi` 的引用方式不同，按该文件既有调用风格接入；`Empty/Spin` 等若未 import 则补。）

- [ ] **Step 3: 类型检查**

Run: `cd packages/client && npm run typecheck`
Expected: 0 error。

- [ ] **Step 4: 提交**

```bash
git commit -m "feat(teacher): 考试详情组卷质量卡片（状态/进度/缺口/重试）" -- \
  packages/client/src/services/api.ts \
  packages/client/src/pages/teacher/ExamDetailDrawer.tsx
```

---

# P1b：难度目标 + 修复 + 逐卷留痕

### Task 8: 迁移 —— 难度目标与 pickMeta

**Files:**
- Modify: `packages/server/prisma/schema.prisma`
- Create: `packages/server/prisma/migrations/<YYYYMMDDHHMMSS>_paper_difficulty_meta/migration.sql`

- [ ] **Step 1: schema**

```prisma
model Paper {
  ...
  /// 难度目标（抽题题位）：{"easy":0.3,"medium":0.5,"hard":0.2}；null = 不约束
  difficultyTarget Json? @map("difficulty_target")
}

model Exam {
  ...
  /// 绑定试卷时从 Paper 拷贝（与 rule 一样是绑定那一刻的快照）
  difficultyTarget Json? @map("difficulty_target")
}

model StudentExamQuestion {
  ...
  /// 这道题怎么来的：{level:'strict'|'relax-schemaRefs'|'relax-difficulty'|'repair',
  ///   candidates, wantedSignature, actualSignature, repairedFrom?}
  pickMeta Json? @map("pick_meta")
}
```

- [ ] **Step 2: migrate status + 手写 SQL**

```bash
cd packages/server && npx prisma migrate status   # 期望 up to date
mkdir -p prisma/migrations/20261023130000_paper_difficulty_meta
cat > prisma/migrations/20261023130000_paper_difficulty_meta/migration.sql <<'SQL'
-- AlterTable
ALTER TABLE "papers" ADD COLUMN "difficulty_target" JSONB;

-- AlterTable
ALTER TABLE "exams" ADD COLUMN "difficulty_target" JSONB;

-- AlterTable
ALTER TABLE "student_exam_questions" ADD COLUMN "pick_meta" JSONB;
SQL
npx prisma migrate deploy && npx prisma generate
npx prisma migrate diff --from-schema-datasource prisma/schema.prisma --to-schema-datamodel prisma/schema.prisma --script
```
Expected: `-- This is an empty migration.`；tsc 0 error。

- [ ] **Step 3: 提交**

```bash
git commit -m "feat(db): Paper/Exam 难度目标 + StudentExamQuestion.pickMeta（逐卷留痕）" -- \
  packages/server/prisma/schema.prisma packages/server/prisma/migrations
```

---

### Task 9: 试卷 API 与编辑器支持难度目标

**Files:**
- Modify: `packages/server/src/routes/papers.ts`
- Modify: `packages/client/src/pages/teacher/PaperEditor.tsx`
- Test: `packages/server/src/routes/__tests__/papers-difficulty-target.test.ts`

**Interfaces:**
- Produces: 试卷 create/update 接受 `difficultyTarget: {easy,medium,hard} | null`（三值非负、和≈1，允许省略某一档）

- [ ] **Step 1: 服务端测试（先失败）**

```ts
import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import express from 'express';

vi.mock('../../middleware/auth', async (importOriginal) => {
  const actual = await importOriginal<any>();
  return { ...actual, authenticate: (req: any, _res: any, next: any) => {
    req.user = { id: 't-1', userId: 't-1', username: 't-1', role: 'teacher', permissions: [], departmentId: 'd-1' }; next();
  } };
});
const paperCreate = vi.fn().mockResolvedValue({ id: 'p-1' });
vi.mock('../../config/prisma', () => ({ prisma: { paper: { create: paperCreate } } }));
vi.mock('../../services/data-scope', async (importOriginal) => {
  const actual = await importOriginal<any>();
  return { ...actual, questionWhere: vi.fn(() => ({})) };
});

import { paperRouter } from '../papers';
const app = express(); app.use(express.json()); app.use('/api/papers', paperRouter);

describe('试卷难度目标', () => {
  it('合法的三档比例被接受并落库', async () => {
    const res = await request(app).post('/api/papers').send({
      name: '期中卷', difficultyTarget: { easy: 0.3, medium: 0.5, hard: 0.2 },
    });
    expect(res.status).toBeLessThan(400);
    expect(paperCreate.mock.calls[0][0].data.difficultyTarget).toEqual({ easy: 0.3, medium: 0.5, hard: 0.2 });
  });

  it('比例之和不为 1 → 400', async () => {
    const res = await request(app).post('/api/papers').send({
      name: '坏卷', difficultyTarget: { easy: 0.5, medium: 0.5, hard: 0.5 },
    });
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/server && npx vitest run src/routes/__tests__/papers-difficulty-target.test.ts`
Expected: FAIL（字段被 zod strip / 未落库）。

- [ ] **Step 3: 服务端实现**

在 `routes/papers.ts` 的试卷 zod schema 里加：

```ts
const difficultyTargetSchema = z.object({
  easy: z.number().min(0).max(1).optional(),
  medium: z.number().min(0).max(1).optional(),
  hard: z.number().min(0).max(1).optional(),
}).refine((v) => {
  const sum = (v.easy ?? 0) + (v.medium ?? 0) + (v.hard ?? 0);
  return Math.abs(sum - 1) < 1e-6;
}, { message: '三档比例之和必须为 1（例如 0.3/0.5/0.2）' }).nullable().optional();
```

create/update 的 `data` 映射里加 `difficultyTarget: data.difficultyTarget === undefined ? undefined : (data.difficultyTarget ?? Prisma.JsonNull)`。

- [ ] **Step 4: 客户端编辑器**

`PaperEditor.tsx` 在「难度」下拉附近加一行三档百分比输入（百分比整数求和 100，提交时 /100）：

```tsx
<Form.Item label="难度目标（抽题题位）" style={{ marginBottom: 0 }}>
  <Space>
    {(['easy', 'medium', 'hard'] as const).map((k) => (
      <Form.Item key={k} name={['difficultyTarget', k]} noStyle>
        <InputNumber min={0} max={100} addonAfter="%" placeholder={{ easy: '易', medium: '中', hard: '难' }[k]} style={{ width: 110 }} />
      </Form.Item>
    ))}
    <Text type="secondary" style={{ fontSize: 12 }}>留空 = 不约束；合计需 100%</Text>
  </Space>
</Form.Item>
```

提交前把三档 /100 组装为 `difficultyTarget`（都为 undefined 则传 null）；表单回填时 ×100。校验在提交处：合计非 0 且 ≠100 → `message.error` 并中止。

- [ ] **Step 5: 跑测试 + 两端类型检查 + 提交**

Run: `cd packages/server && npx vitest run src/routes/__tests__/papers-difficulty-target.test.ts`
Expected: PASS 2/2。

Run: `cd packages/server && npx tsc --noEmit -p tsconfig.json && cd ../client && npm run typecheck`
Expected: 0 error。

```bash
git commit -m "feat(papers): 难度目标配置（三档比例，和为 1 校验）+ 试卷编辑器录入" -- \
  packages/server/src/routes/papers.ts \
  packages/server/src/routes/__tests__/papers-difficulty-target.test.ts \
  packages/client/src/pages/teacher/PaperEditor.tsx
```

---

### Task 10: 绑卷/换卷统一走 `syncPaperIntoExam`（顺带拷贝难度目标）

**Files:**
- Create: `packages/server/src/services/paper-exam-sync.ts`
- Modify: `packages/server/src/routes/exams.ts`（创建考试绑卷 ~:259-290、换卷 ~:401-440、解绑分支）
- Test: `packages/server/src/services/__tests__/paper-exam-sync.test.ts`

**为什么抽 helper**：创建绑卷与换卷现在各自复制了一份"删题位 → 拷 paperQuestions → 算总分"的逻辑（`exams.ts:259-290` 与 `:401-440`），两处都漏了难度目标——再分头改还会继续漂移。抽成一个纯服务后，拷贝语义只有一处，测试也不用起整个路由。

**Interfaces:**
- Produces: `syncPaperIntoExam(params: { examId: string; paperId: string | null; tx?: Prisma.TransactionClient }): Promise<{ totalScore: number }>`
  语义：先删该考试全部 `ExamQuestion`；`paperId` 为空 → 总分 100 + `difficultyTarget: JsonNull`；否则拷题位、按题位算总分、拷 `paper.difficultyTarget`（null → JsonNull）。

- [ ] **Step 1: 写失败的测试**

创建 `packages/server/src/services/__tests__/paper-exam-sync.test.ts`：

```ts
import { describe, it, expect, vi } from 'vitest';
import { syncPaperIntoExam } from '../paper-exam-sync';

const stubTx = (over: any = {}) => ({
  examQuestion: { deleteMany: vi.fn(), createMany: vi.fn() },
  paper: { findUnique: vi.fn().mockResolvedValue({ difficultyTarget: { easy: 0.3, medium: 0.5, hard: 0.2 } }) },
  paperQuestion: { findMany: vi.fn().mockResolvedValue([
    { questionId: 'q1', sortOrder: 0, score: 10, slotType: 'fixed', rule: null, question: { score: 10 } },
    { questionId: null, sortOrder: 1, score: 5, slotType: 'rule', rule: { type: 'comprehensive' }, question: null },
  ]) },
  exam: { update: vi.fn() },
  ...over,
});

describe('syncPaperIntoExam', () => {
  it('拷题位 + 总分 + 难度目标', async () => {
    const tx = stubTx();
    const out = await syncPaperIntoExam({ examId: 'e-1', paperId: 'p-1', tx: tx as any });
    expect(tx.examQuestion.deleteMany).toHaveBeenCalledWith({ where: { examId: 'e-1' } });
    expect(tx.examQuestion.createMany).toHaveBeenCalledWith({ data: [
      { examId: 'e-1', questionId: 'q1', sortOrder: 0, scoreOverride: 10, slotType: 'fixed', rule: undefined, slotIndex: 0 },
      { examId: 'e-1', questionId: null, sortOrder: 1, scoreOverride: 5, slotType: 'rule', rule: { type: 'comprehensive' }, slotIndex: 1 },
    ] });
    expect(out.totalScore).toBe(15);
    expect(tx.exam.update).toHaveBeenCalledWith({
      where: { id: 'e-1' },
      data: { totalScore: 15, difficultyTarget: { easy: 0.3, medium: 0.5, hard: 0.2 } },
    });
  });

  it('解绑：清空题位、总分 100、目标置空', async () => {
    const tx = stubTx();
    const out = await syncPaperIntoExam({ examId: 'e-1', paperId: null, tx: tx as any });
    expect(tx.examQuestion.deleteMany).toHaveBeenCalled();
    expect(tx.paperQuestion.findMany).not.toHaveBeenCalled();
    expect(out.totalScore).toBe(100);
    expect(tx.exam.update).toHaveBeenCalledWith({
      where: { id: 'e-1' },
      data: { totalScore: 100, difficultyTarget: expect.anything() },
    });
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/server && npx vitest run src/services/__tests__/paper-exam-sync.test.ts`
Expected: FAIL —— 模块不存在。

- [ ] **Step 3: 实现 helper，并把两处路由改为调用它**

```ts
/**
 * 把试卷快照同步到考试：题位、总分、难度目标。
 *
 * 创建绑卷与换卷原本各写了一遍这段逻辑，两处都漏了难度目标——拷贝语义必须只有一处，
 * 否则以后每加一个"随试卷走"的字段都会漏一处。
 */
import { prisma } from '../config/prisma';
import { Prisma } from '@prisma/client';

export async function syncPaperIntoExam(params: {
  examId: string;
  paperId: string | null;
  tx?: Prisma.TransactionClient;
}): Promise<{ totalScore: number }> {
  const { examId, paperId, tx = prisma } = params;

  await tx.examQuestion.deleteMany({ where: { examId } });

  if (!paperId) {
    await tx.exam.update({
      where: { id: examId },
      data: { totalScore: 100, difficultyTarget: Prisma.JsonNull },
    });
    return { totalScore: 100 };
  }

  const paper = await tx.paper.findUnique({ where: { id: paperId }, select: { difficultyTarget: true } });
  const paperQuestions = await tx.paperQuestion.findMany({
    where: { paperId },
    include: { question: true },
    orderBy: { sortOrder: 'asc' },
  });

  if (paperQuestions.length > 0) {
    await tx.examQuestion.createMany({
      data: paperQuestions.map((pq, index) => ({
        examId,
        questionId: pq.questionId,
        sortOrder: pq.sortOrder,
        scoreOverride: pq.score ?? null,
        slotType: pq.slotType ?? 'fixed',
        rule: (pq.rule ?? undefined) as any,
        slotIndex: index,
      })),
    });
  }

  const totalScore = paperQuestions.reduce((sum, pq) => sum + (pq.score ?? pq.question?.score ?? 0), 0);
  await tx.exam.update({
    where: { id: examId },
    data: { totalScore, difficultyTarget: (paper?.difficultyTarget ?? Prisma.JsonNull) as any },
  });
  return { totalScore };
}
```

路由改造：
- 创建考试绑卷（`exams.ts` 约 :259-290）：整段 `if (paperId) { … }` 内的"拷题位 + 算总分"替换为 `await syncPaperIntoExam({ examId: exam.id, paperId });`
- 换卷（约 :401-440）：整段 `if (newPaperId !== exam.paperId) { … }` 替换为 `await syncPaperIntoExam({ examId: req.params.id, paperId: newPaperId });`
- 保留各自的权限校验（`assertPaperRead`）不动。
- 顶部 import helper。

- [ ] **Step 4: 跑测试 + 两端回归**

Run: `cd packages/server && npx vitest run src/services/__tests__/paper-exam-sync.test.ts src/routes/__tests__/exam-paper-generation-api.test.ts`
Expected: 新测试 2/2；路由测试不受影响。

Run: `cd packages/server && npx tsc --noEmit -p tsconfig.json`
Expected: 0 error。

- [ ] **Step 5: 提交**

```bash
git commit -m "refactor(exams): 绑卷/换卷统一走 syncPaperIntoExam（顺带快照难度目标）" -- \
  packages/server/src/services/paper-exam-sync.ts \
  packages/server/src/services/__tests__/paper-exam-sync.test.ts \
  packages/server/src/routes/exams.ts
```

---

### Task 11: 生成时写入 `pickMeta`

**Files:**
- Modify: `packages/server/src/services/paper-generator.ts`
- Test: `packages/server/src/services/__tests__/paper-generator-pick-meta.test.ts`

**Interfaces:**
- 变更：`pickQuestionForSlot` 返回 `{ id: string; level: CandidateLevel; candidates: number } | null`；
  `generateStudentPaper` 对 rule 行写
  `pickMeta: { level, candidates, wantedSignature, actualSignature }`

- [ ] **Step 1: 写失败的测试**

创建 `packages/server/src/services/__tests__/paper-generator-pick-meta.test.ts`：

```ts
import { describe, it, expect, vi } from 'vitest';
import { generateStudentPaper } from '../paper-generator';

function stubTx(over: any = {}) {
  const createMany = vi.fn();
  const tx = {
    examQuestion: { findMany: vi.fn().mockResolvedValue([
      { slotIndex: 0, sortOrder: 0, slotType: 'rule', questionId: null, scoreOverride: 10, rule: { type: 'comprehensive', difficulty: 'easy' } },
      { slotIndex: 1, sortOrder: 1, slotType: 'fixed', questionId: 'q-fixed', scoreOverride: 10, rule: null },
    ]) },
    studentExamQuestion: { count: vi.fn().mockResolvedValue(0), groupBy: vi.fn().mockResolvedValue([]), createMany },
    question: { findMany: vi.fn().mockResolvedValue([
      { id: 'q-1', score: 10, difficulty: 'easy', schemaRefs: null, answerRules: [] },
    ]) },
    exam: { findUnique: vi.fn().mockResolvedValue({ paperId: null }) },
    ...over,
  };
  return { tx, createMany };
}

describe('generateStudentPaper 的 pickMeta', () => {
  it('抽题题位写入命中档位/池大小；固定题位不写', async () => {
    const { tx, createMany } = stubTx();
    await generateStudentPaper('e-1', 's-1', tx as any);
    const rows = createMany.mock.calls[0][0].data;
    const ruleRow = rows.find((r: any) => r.source === 'rule');
    const fixedRow = rows.find((r: any) => r.source === 'fixed');
    expect(ruleRow.pickMeta).toMatchObject({ level: 'strict', candidates: 1 });
    expect(fixedRow.pickMeta).toBeUndefined();
  });

  it('只能放宽难度时，pickMeta.level 记录真实档位', async () => {
    const { tx, createMany } = stubTx();
    // 关键：mock 必须按 where.difficulty 过滤，否则 strict 分支会"看见"这道 hard 题，
    // 测不出档位（listSlotCandidates 依赖 DB 的 where 过滤难度，不在内存里再筛一遍）
    const all = [{ id: 'q-h', score: 10, difficulty: 'hard', schemaRefs: null, answerRules: [] }];
    tx.question.findMany.mockImplementation(async ({ where }: any) =>
      where.difficulty ? all.filter(q => q.difficulty === where.difficulty) : all);
    await generateStudentPaper('e-1', 's-1', tx as any);
    const ruleRow = createMany.mock.calls[0][0].data.find((r: any) => r.source === 'rule');
    expect(ruleRow.pickMeta).toMatchObject({ level: 'relax-difficulty', candidates: 1 });
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/server && npx vitest run src/services/__tests__/paper-generator-pick-meta.test.ts`
Expected: FAIL —— `pickMeta` 为 undefined。

- [ ] **Step 3: 实现**

- `listSlotCandidates` 已返回行；picker 里记录命中档位与池大小；
- `schemaRefsSignature` 与 `rule.schemaRefs` 用来填 `wantedSignature`；实际题的 `schemaRefsSignature(c.schemaRefs)` 填 `actualSignature`（需要 picker 返回该题的 schemaRefs，或返回 `actualSignature` 字符串——选后者，避免调用方再算一次）：

```ts
// picker 内：
const chosen = leastUsed[seededPickIndex(seed, leastUsed.length)];
return {
  id: chosen.id,
  level,
  candidates: pool.length,
  wantedSignature: wanted,
  actualSignature: schemaRefsSignature(chosen.schemaRefs),
};
```

- `generateStudentPaper` 的 rule 行：

```ts
    rows.push({
      examId, studentId, slotIndex,
      questionId: picked.id,
      score: slotScore,
      sortOrder: slot.sortOrder,
      source: 'rule',
      pickMeta: {
        level: picked.level,
        candidates: picked.candidates,
        wantedSignature: picked.wantedSignature,
        actualSignature: picked.actualSignature,
      },
    });
```

- [ ] **Step 4: 跑新测试 + 回归 + tsc + 提交**

Run: `cd packages/server && npx vitest run src/services/__tests__/paper-generator-pick-meta.test.ts src/services/__tests__/paper-generator.test.ts src/services/__tests__/paper-generator-candidates.test.ts`
Expected: 全绿。

```bash
git commit -m "feat(papers): 生成时写入 pickMeta（命中档位/池大小/结构签名）" -- \
  packages/server/src/services/paper-generator.ts \
  packages/server/src/services/__tests__/paper-generator-pick-meta.test.ts
```

---

### Task 12: 修复器 `repairDifficultyDistribution`（纯函数）

**Files:**
- Create: `packages/server/src/services/paper-difficulty-repair.ts`
- Test: `packages/server/src/services/__tests__/paper-difficulty-repair.test.ts`

**Interfaces:**
- Consumes: `SlotCandidate`（Task 1）
- Produces:
  ```ts
  export interface DifficultyTarget { easy?: number; medium?: number; hard?: number }
  export interface RepairSlotInput { slotIndex: number; slotScore: number; currentQuestionId: string; currentDifficulty: string | null; candidates: SlotCandidate[] }
  export interface RepairResult { changes: Array<{ slotIndex: number; from: string; to: string }>; before: Record<string, number>; after: Record<string, number>; targetCounts: Record<string, number> | null }
  export function repairDifficultyDistribution(slots: RepairSlotInput[], target: DifficultyTarget | null | undefined, maxIterations?: number): RepairResult
  ```
- 语义：`candidates` 已由调用方按该题位硬约束列出（含分值与签名），**必须再排除本卷已用题**（由函数自己维护 used 集合）；只处理 easy/medium/hard；确定性（slotIndex 升序、候选 id 升序、同 delta 取 `(slotIndex, id)` 最小）。

- [ ] **Step 1: 写失败的测试**

```ts
import { describe, it, expect } from 'vitest';
import { repairDifficultyDistribution } from '../paper-difficulty-repair';

const cand = (id: string, difficulty: string) => ({
  id, score: 10, difficulty, schemaRefs: null, answerRules: [],
});
const slot = (slotIndex: number, currentId: string, currentDiff: string, candidates: any[]) =>
  ({ slotIndex, slotScore: 10, currentQuestionId: currentId, currentDifficulty: currentDiff, candidates });

describe('repairDifficultyDistribution', () => {
  it('无目标 → 零改动', () => {
    const out = repairDifficultyDistribution([slot(0, 'a', 'easy', [cand('b', 'hard')])], null);
    expect(out.changes).toEqual([]);
    expect(out.targetCounts).toBeNull();
  });

  it('通过换题把分布拉向目标', () => {
    // 3 个题位：现状 全 easy；目标 1/3 各一档
    const out = repairDifficultyDistribution([
      slot(0, 'a', 'easy', [cand('a', 'easy'), cand('h1', 'hard')]),
      slot(1, 'b', 'easy', [cand('b', 'easy'), cand('m1', 'medium')]),
      slot(2, 'c', 'easy', [cand('c', 'easy')]),
    ], { easy: 1 / 3, medium: 1 / 3, hard: 1 / 3 });
    expect(out.before).toMatchObject({ easy: 3, medium: 0, hard: 0 });
    expect(out.after.easy).toBeLessThan(3);
    expect(out.changes.length).toBeGreaterThan(0);
  });

  it('不换成本卷已用的题', () => {
    const out = repairDifficultyDistribution([
      slot(0, 'a', 'easy', [cand('a', 'easy'), cand('h', 'hard')]),
      slot(1, 'h', 'hard', [cand('h', 'hard'), cand('a', 'easy')]),
    ], { easy: 0, medium: 0, hard: 1 });
    // 目标已是 1 hard，slot1 已是 hard；slot0 若换成 h 会与 slot1 重复 → 必须不变
    expect(out.changes).toEqual([]);
    expect(out.after).toMatchObject({ easy: 1, hard: 1 });
  });

  it('确定性：同输入两次结果一致', () => {
    const input = [
      slot(0, 'a', 'easy', [cand('a', 'easy'), cand('m', 'medium'), cand('h', 'hard')]),
      slot(1, 'b', 'easy', [cand('b', 'easy'), cand('m2', 'medium')]),
    ];
    const t = { easy: 0.5, medium: 0.5, hard: 0 };
    expect(repairDifficultyDistribution(input, t)).toEqual(repairDifficultyDistribution(input, t));
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/server && npx vitest run src/services/__tests__/paper-difficulty-repair.test.ts`
Expected: FAIL —— 模块不存在。

- [ ] **Step 3: 实现**

```ts
/**
 * 难度分布修复（generate-and-repair 的 repair 段，纯函数）。
 *
 * 生成器先按题位抽出卷子（硬约束已全部满足），这里只做一件事：
 * 在不破坏硬约束的前提下，用"换一道本卷还没用过的候选"逐步逼近难度目标。
 *
 * 为什么不在抽取阶段一次算好：题位之间会争抢候选题，而且"能否达到目标"取决于
 * 整卷当前分布；先生成再修复，每一步都可以解释、可以回放，也不会改动已过审的抽取语义。
 */
import type { SlotCandidate } from './paper-generator';

export interface DifficultyTarget { easy?: number; medium?: number; hard?: number }
export interface RepairSlotInput {
  slotIndex: number;
  slotScore: number;
  currentQuestionId: string;
  currentDifficulty: string | null;
  /** 已由调用方按该题位硬约束列出（分值/题型/签名/池范围），函数内只再排除"本卷已用" */
  candidates: SlotCandidate[];
}
export interface RepairResult {
  changes: Array<{ slotIndex: number; from: string; to: string }>;
  before: Record<string, number>;
  after: Record<string, number>;
  targetCounts: Record<string, number> | null;
}

const LEVELS = ['easy', 'medium', 'hard'] as const;
type Level = typeof LEVELS[number];

/** 最大余数法：把比例换算成道数，保证 Σtarget = n */
function targetCounts(target: DifficultyTarget, n: number): Record<Level, number> {
  const raw = LEVELS.map(l => (target[l] ?? 0) * n);
  const base = raw.map(Math.floor) as number[];
  let remaining = n - base.reduce((s, v) => s + v, 0);
  const order = raw
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (const { i } of order) {
    if (remaining <= 0) break;
    base[i] += 1;
    remaining -= 1;
  }
  return { easy: base[0], medium: base[1], hard: base[2] };
}

function distribution(slots: RepairSlotInput[]): Record<string, number> {
  const d: Record<string, number> = { easy: 0, medium: 0, hard: 0 };
  for (const s of slots) if (s.currentDifficulty && s.currentDifficulty in d) d[s.currentDifficulty] += 1;
  return d;
}

function costOf(dist: Record<string, number>, target: Record<Level, number>): number {
  return LEVELS.reduce((sum, l) => sum + Math.abs((dist[l] ?? 0) - target[l]), 0);
}

export function repairDifficultyDistribution(
  slots: RepairSlotInput[],
  target: DifficultyTarget | null | undefined,
  maxIterations = Math.min(slots.length * 2, 20),
): RepairResult {
  const before = distribution(slots);
  if (!target) return { changes: [], before, after: { ...before }, targetCounts: null };

  const targetCnt = targetCounts(target, slots.length);
  const used = new Set(slots.map(s => s.currentQuestionId));
  const dist = { ...before };
  const changes: RepairResult['changes'] = [];

  for (let iter = 0; iter < maxIterations; iter++) {
    let best: { slotIndex: number; cand: SlotCandidate; delta: number } | null = null;

    for (const s of slots) {
      for (const c of s.candidates) {
        if (used.has(c.id) || !c.difficulty || !(c.difficulty in dist)) continue;
        const oldLevel = s.currentDifficulty;
        if (!oldLevel || !(oldLevel in dist)) continue;
        if (c.difficulty === oldLevel) continue;

        // 模拟这次替换对 cost 的影响（只动两个桶）
        const next = { ...dist };
        next[oldLevel] -= 1;
        next[c.difficulty] += 1;
        const delta = costOf(dist, targetCnt) - costOf(next, targetCnt);
        if (delta <= 0) continue;
        if (!best || delta > best.delta || (delta === best.delta && (s.slotIndex < best.slotIndex || (s.slotIndex === best.slotIndex && c.id < best.cand.id)))) {
          best = { slotIndex: s.slotIndex, cand: c, delta };
        }
      }
    }

    if (!best) break;

    const s = slots.find(x => x.slotIndex === best!.slotIndex)!;
    const oldId = s.currentQuestionId;
    const oldLevel = s.currentDifficulty!;
    dist[oldLevel] -= 1;
    dist[best.cand.difficulty!] += 1;
    used.delete(oldId);
    used.add(best.cand.id);
    s.currentQuestionId = best.cand.id;
    s.currentDifficulty = best.cand.difficulty;
    changes.push({ slotIndex: s.slotIndex, from: oldId, to: best.cand.id });
  }

  return { changes, before, after: dist, targetCounts: { easy: targetCnt.easy, medium: targetCnt.medium, hard: targetCnt.hard } };
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd packages/server && npx vitest run src/services/__tests__/paper-difficulty-repair.test.ts`
Expected: PASS 4/4。

- [ ] **Step 5: 提交**

```bash
git commit -m "feat(papers): 难度分布修复器（generate-and-repair，纯函数，确定性）" -- \
  packages/server/src/services/paper-difficulty-repair.ts \
  packages/server/src/services/__tests__/paper-difficulty-repair.test.ts
```

---

### Task 13: 预生成任务接入修复与分布汇总

**Files:**
- Modify: `packages/server/src/jobs/paper-generation-queue.ts`
- Test: `packages/server/src/jobs/__tests__/paper-generation-repair.test.ts`

**Interfaces:**
- `processPaperGeneration` 在每位学生 `generateStudentPaper` 之后：
  1. 读该考试 `difficultyTarget` 与 `ExamQuestion`（rule 题位 + 分值 + rule）；
  2. 读该生快照行；
  3. 对每个 rule 题位用 `listSlotCandidates(..., level:'strict')` 取候选（排除本卷已用）；
  4. 调 `repairDifficultyDistribution`；
  5. 有变更 → `update` 对应行（`questionId` + `pickMeta = {level:'repair', repairedFrom, candidates, actualSignature}`）。
- 汇总 `summary` 增加 `distribution: { ruleSlots, target, actual, wholePaper }` 与 `degradation` 计数（从快照 `pickMeta.level` 统计）。

- [ ] **Step 1: 写失败的测试**

创建 `packages/server/src/jobs/__tests__/paper-generation-repair.test.ts`：

```ts
import { describe, it, expect, vi } from 'vitest';
import { repairStudentPaper } from '../paper-generation-queue';

const dbStub = (target: any) => ({
  exam: { findUnique: vi.fn().mockResolvedValue({ difficultyTarget: target }) },
  examQuestion: { findMany: vi.fn().mockResolvedValue([
    { slotIndex: 0, rule: { type: 'comprehensive' } },
    { slotIndex: 1, rule: { type: 'comprehensive' } },
  ]) },
  studentExamQuestion: {
    findMany: vi.fn().mockResolvedValue([
      { slotIndex: 0, questionId: 'a', score: 10 },
      { slotIndex: 1, questionId: 'b', score: 10 },
    ]),
    update: vi.fn(),
  },
  question: { findUnique: vi.fn().mockResolvedValue({ difficulty: 'easy' }) },
});

const candidatesStub = () => vi.fn().mockResolvedValue([
  { id: 'm-1', score: 10, difficulty: 'medium', schemaRefs: null, answerRules: [] },
  { id: 'h-1', score: 10, difficulty: 'hard', schemaRefs: null, answerRules: [] },
]);

describe('repairStudentPaper', () => {
  it('有目标时换题并写回 pickMeta=repair', async () => {
    const db = dbStub({ easy: 0, medium: 1, hard: 0 });   // 2 个可调题位 → 目标 medium 1 道
    const listCandidates = candidatesStub();
    const changed = await repairStudentPaper('e-1', 's-1', { db, listCandidates });
    expect(changed).toBe(true);
    expect(db.studentExamQuestion.update).toHaveBeenCalledWith({
      where: { examId_studentId_slotIndex: { examId: 'e-1', studentId: 's-1', slotIndex: 0 } },
      data: { questionId: 'm-1', pickMeta: expect.objectContaining({ level: 'repair', repairedFrom: 'a' }) },
    });
  });

  it('没有难度目标 → 不做任何替换', async () => {
    const db = dbStub(null);
    const changed = await repairStudentPaper('e-1', 's-1', { db, listCandidates: candidatesStub() });
    expect(changed).toBe(false);
    expect(db.studentExamQuestion.update).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/server && npx vitest run src/jobs/__tests__/paper-generation-repair.test.ts`
Expected: FAIL —— `repairStudentPaper` 不存在。

- [ ] **Step 3: 实现**

在 `paper-generation-queue.ts` 增加（`db` 与 `listCandidates` 可注入，便于单测；生产用默认值）：

```ts
import { listSlotCandidates, type SlotRule } from '../services/paper-generator';
import { repairDifficultyDistribution, type RepairSlotInput } from '../services/paper-difficulty-repair';

/**
 * 为一名学生跑修复；返回是否发生替换（供汇总统计）。
 * `db`/`listCandidates` 可注入：单测不碰真实 DB/题库；生产不传即用默认实现。
 */
export async function repairStudentPaper(
  examId: string,
  studentId: string,
  deps: { db?: any; listCandidates?: typeof listSlotCandidates } = {},
): Promise<boolean> {
  const db = deps.db ?? prisma;
  const listCandidates = deps.listCandidates ?? listSlotCandidates;

  const exam = await db.exam.findUnique({ where: { id: examId }, select: { difficultyTarget: true } });
  if (!exam?.difficultyTarget) return false;   // 没配目标 = 零行为变化

  const [slots, rows] = await Promise.all([
    db.examQuestion.findMany({ where: { examId, slotType: 'rule' }, orderBy: { slotIndex: 'asc' } }),
    db.studentExamQuestion.findMany({ where: { examId, studentId }, select: { slotIndex: true, questionId: true, score: true } }),
  ]);
  if (slots.length === 0 || rows.length === 0) return false;

  const rowBySlot = new Map(rows.map((r: any) => [r.slotIndex, r]));
  const usedIds = new Set(rows.map((r: any) => r.questionId));
  const inputs: RepairSlotInput[] = [];

  for (const slot of slots) {
    const row = rowBySlot.get(slot.slotIndex) as any;
    if (!row) continue;
    const rule = (slot.rule || {}) as SlotRule;
    const candidates = await listCandidates({
      rule, slotScore: row.score, level: 'strict',
      usedQuestionIds: new Set([...usedIds].filter(id => id !== row.questionId)),
    });
    const current = await db.question.findUnique({ where: { id: row.questionId }, select: { difficulty: true } });
    inputs.push({
      slotIndex: slot.slotIndex, slotScore: row.score,
      currentQuestionId: row.questionId, currentDifficulty: current?.difficulty ?? null,
      candidates,
    });
  }

  const result = repairDifficultyDistribution(inputs, exam.difficultyTarget as any);
  for (const change of result.changes) {
    await db.studentExamQuestion.update({
      where: { examId_studentId_slotIndex: { examId, studentId, slotIndex: change.slotIndex } },
      data: { questionId: change.to, pickMeta: { level: 'repair', repairedFrom: change.from } },
    });
  }
  return result.changes.length > 0;
}
```

在 `processPaperGeneration` 里接入：`PaperGenerationDeps` 增加可选 `repair?: (examId: string, studentId: string) => Promise<boolean>`（默认 `repairStudentPaper`）；并发块内每生成一人后调用它，并累计 `repaired`。

结束时的汇总（替换 Task 5 的 `markStatus` 调用）：

```ts
  // ── 汇总：难度分布与降级统计 ──
  // 分布一律按"道数"计（与目标口径一致）；rule 题位可调，fixed 题位仅供参考
  const [snapshots, ruleSlotCount, examRow] = await Promise.all([
    prisma.studentExamQuestion.findMany({
      where: { examId },
      select: { source: true, pickMeta: true, question: { select: { difficulty: true } } },
    }),
    prisma.examQuestion.count({ where: { examId, slotType: 'rule' } }),
    prisma.exam.findUnique({ where: { id: examId }, select: { difficultyTarget: true } }),
  ]);

  const wholePaper: Record<string, number> = { easy: 0, medium: 0, hard: 0 };
  const ruleDist: Record<string, number> = { easy: 0, medium: 0, hard: 0 };
  const degradation = { strict: 0, relaxSchemaRefs: 0, relaxDifficulty: 0, repaired: 0 };
  for (const s of snapshots) {
    const d = s.question?.difficulty;
    if (d && d in wholePaper) wholePaper[d] += 1;
    if (s.source === 'rule' && d && d in ruleDist) ruleDist[d] += 1;
    switch ((s.pickMeta as any)?.level) {
      case 'strict': degradation.strict += 1; break;
      case 'relax-schemaRefs': degradation.relaxSchemaRefs += 1; break;
      case 'relax-difficulty': degradation.relaxDifficulty += 1; break;
      case 'repair': degradation.repaired += 1; break;
    }
  }

  await deps.markStatus(examId, {
    status: 'done',
    summary: {
      generated, missing: students.length - generated, repaired,
      distribution: { ruleSlots: ruleSlotCount, target: examRow?.difficultyTarget ?? null, actual: ruleDist, wholePaper },
      degradation,
    },
    unfilledSlots: [...unfilled.values()],
  });
  return { generated, missing: students.length - generated };
```

（`PaperGenerationDeps.markStatus` 的 `summary` 类型放宽为 `any`。）

- [ ] **Step 4: 跑测试 + 回归 + tsc + 提交**

Run: `cd packages/server && npx vitest run src/jobs/__tests__/paper-generation-repair.test.ts src/jobs/__tests__/paper-generation.test.ts`
Expected: 全绿。

```bash
git commit -m "feat(jobs): 预生成后执行难度修复并汇总分布/降级" -- \
  packages/server/src/jobs/paper-generation-queue.ts \
  packages/server/src/jobs/__tests__/paper-generation-repair.test.ts
```

---

### Task 14: 报告增强 + 异常卷子 + 收尾

**Files:**
- Modify: `packages/server/src/routes/exams.ts`（新增异常卷子接口）
- Modify: `packages/client/src/pages/teacher/ExamDetailDrawer.tsx`
- Modify: `packages/client/src/services/api.ts`
- Test: `packages/server/src/routes/__tests__/exam-paper-generation-anomalies.test.ts`

**Interfaces:**
- Produces:
  - `GET /api/exams/:id/paper-generation/anomalies` → `{ students: Array<{ studentId, name, username, slots: Array<{ slotIndex, questionId, title, level, repairedFrom? }> }> }`（只返回含 `pickMeta.level != 'strict'` 的卷子，最多 50 人）
  - 前端：卡片显示 `summary.distribution` 与 `summary.degradation`；「查看异常卷子」弹窗

- [ ] **Step 1: 服务端测试（先失败）**

创建 `packages/server/src/routes/__tests__/exam-paper-generation-anomalies.test.ts`：

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';

vi.mock('../../middleware/auth', async (importOriginal) => {
  const actual = await importOriginal<any>();
  return { ...actual, authenticate: (req: any, _res: any, next: any) => {
    req.user = { id: 't-1', userId: 't-1', username: 't-1', role: 'teacher', permissions: [], departmentId: 'd-1' }; next();
  } };
});

const sqFindMany = vi.fn();
const userFindMany = vi.fn();
const examFindUnique = vi.fn();
vi.mock('../../config/prisma', () => ({ prisma: {
  exam: { findUnique: examFindUnique },
  studentExamQuestion: { findMany: sqFindMany },
  user: { findMany: userFindMany },
} }));

import { examRouter } from '../exams';
const app = express(); app.use(express.json()); app.use('/api/exams', examRouter);

beforeEach(() => {
  vi.clearAllMocks();
  examFindUnique.mockResolvedValue({ id: 'e-1', createdBy: 't-1', status: 'published' });
  userFindMany.mockResolvedValue([{ id: 's-1', realName: '张三', username: 'stu1' }]);
});

describe('GET /api/exams/:id/paper-generation/anomalies', () => {
  it('只返回含非 strict pickMeta 的学生', async () => {
    sqFindMany.mockResolvedValue([
      { studentId: 's-1', slotIndex: 0, questionId: 'q-1', pickMeta: { level: 'strict' }, question: { title: 'A' } },
      { studentId: 's-1', slotIndex: 1, questionId: 'q-2', pickMeta: { level: 'relax-schemaRefs' }, question: { title: 'B' } },
      { studentId: 's-2', slotIndex: 0, questionId: 'q-3', pickMeta: { level: 'strict' }, question: { title: 'C' } },
    ]);
    const res = await request(app).get('/api/exams/e-1/paper-generation/anomalies');
    expect(res.status).toBe(200);
    expect(res.body.students).toHaveLength(1);
    expect(res.body.students[0]).toMatchObject({
      studentId: 's-1', name: '张三',
      slots: [{ slotIndex: 1, level: 'relax-schemaRefs' }],
    });
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/server && npx vitest run src/routes/__tests__/exam-paper-generation-anomalies.test.ts`
Expected: FAIL —— 404。

- [ ] **Step 3: 实现接口**

```ts
// GET /api/exams/:id/paper-generation/anomalies —— 降级/修复过的卷子（教师排查用）
examRouter.get('/:id/paper-generation/anomalies', async (req, res) => {
  const access = await checkExamAccess(req, req.params.id);
  if (access !== 'ok') return denyAccess(res, access);

  const rows = await prisma.studentExamQuestion.findMany({
    where: { examId: req.params.id },
    select: { studentId: true, slotIndex: true, questionId: true, pickMeta: true,
      question: { select: { title: true } } },
    orderBy: [{ studentId: 'asc' }, { slotIndex: 'asc' }],
  });
  const byStudent = new Map<string, any[]>();
  for (const r of rows) {
    const level = (r.pickMeta as any)?.level;
    if (!level || level === 'strict') continue;
    const list = byStudent.get(r.studentId) ?? [];
    list.push({ slotIndex: r.slotIndex, questionId: r.questionId, title: r.question?.title ?? '',
      level, repairedFrom: (r.pickMeta as any)?.repairedFrom ?? null });
    byStudent.set(r.studentId, list);
  }
  const ids = [...byStudent.keys()].slice(0, 50);
  const users = await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, realName: true, username: true } });
  const nameOf = new Map(users.map(u => [u.id, u.realName || u.username]));
  res.json({ students: ids.map(id => ({ studentId: id, name: nameOf.get(id) ?? id, slots: byStudent.get(id) })) });
});
```

- [ ] **Step 4: 前端**

在「组卷质量」卡片里补：
- `summary?.distribution`：`可调题位 {ruleSlots} 道 · 目标 易X/中Y/难Z · 实际 易A/中B/难C`；`wholePaper` 另起一行；
- `summary?.degradation`：`原样 {strict} / 放宽结构 {relaxSchemaRefs} / 放宽难度 {relaxDifficulty} / 修复 {repaired}`；
- 「查看异常卷子」按钮 → Modal 表格（学生 / 题位 / 级别 / 原题）。

- [ ] **Step 5: 门禁 + 提交**

Run:
```bash
cd packages/server && npx vitest run src/routes/__tests__/exam-paper-generation-anomalies.test.ts
cd packages/server && npx tsc --noEmit -p tsconfig.json
cd packages/client && npm run typecheck
cd /data/wps_dbsheet_examination_system && npm run lint
```
Expected: 全绿（lint 0 error）。

```bash
git commit -m "feat(teacher): 组卷报告补难度分布/降级统计 + 异常卷子排查" -- \
  packages/server/src/routes/exams.ts \
  packages/server/src/routes/__tests__/exam-paper-generation-anomalies.test.ts \
  packages/client/src/pages/teacher/ExamDetailDrawer.tsx \
  packages/client/src/services/api.ts
```

---

## 附二：已知边界与后续打磨（各任务审查累积，逐条放这里避免丢）

| # | 项 | 状态 |
| --- | --- | --- |
| 1 | 预检不模拟跨题位占用（存在性上界） | 已写入 spec 风险表；发布即精确需按生成同序模拟分配（P1c 可选） |
| 2 | `jobId` 去重导致 failed 后重发无新 job | **Task 6 验收集**（入队前 `queue.remove` 或唯一后缀 + 测试） |
| 3 | 发布失败的 `preflight[]` 前端渲染 | **Task 7 验收** |
| 4 | 超时后迟到入队与状态行 failed 的冲突 | **Task 5 契约**：worker 无条件处理并覆盖状态 |
| 5 | 预检/生成两套「池为空」文案 | 后续统一 |
| 6 | publish handler 抽出 `paper-generation-scheduler` | 后续打磨（当前约 90 行，可读） |
| 7 | `grading-queue.ts` 的同类入队挂起（无超时） | 既有问题，建议另开小任务，复用 Task 4 的超时模板 |
| 8 | 逐卷降级展示：spec 写"阅卷详情"，实现改为组卷报告的「异常卷子」弹窗 | Task 14 实现（同一信息的集中视图，更利于排查） |
| 9 | `npm test -w packages/server` 因 `dist/**/*.test.js` 常年红 | 本次顺手修（vitest 配置排除 dist） |
| 10 | 超时分支缺 fake-timer 单测 | 本次顺手补 |
| 11 | 「重新组卷/编辑试卷」与开考并发的 ms 级窗口 | **P1c 已闭合**：start-wps、retry、`PUT /:id` 换卷、`PUT /:id/questions` 四处共用 examId 事务级 advisory lock（`$executeRaw`；真实库验证阻塞 55P03）。Worker 的生成/修复写不入锁，靠 created>0 + submissions.none 守卫（见 #24/#13） |
| 12 | 迁移 `20261023082456_paper_difficulty_meta` 字典序早于已应用的 `20261023152420_paper_generation`（历史迁移用本地时间，本任务误用 UTC） | **控制器显式豁免**：独立表无依赖、开发库均已应用；后续迁移必须与 `ls prisma/migrations` 最大值比较 |
| 13 | 修复只作用于**本次新生成**的卷（`created > 0`）；已有快照（含已开考）不修 | Task 13 审查修复；补生成时历史卷不会被修复（如需修复，另开「修复存量未开考卷」任务） |
| 14 | 修复侧 `slot.slotIndex || i` 的 `i` 只数 rule 题位，与生成侧（数全部题位）在「历史脏 slotIndex=0 + fixed 混排」时可能错位 | 新写入路径始终写唯一 slotIndex；脏数据才触发，已注释说明（P1c 可改为按全部题位遍历取同一 i） |
| 15 | 状态行卡 `running`（worker 硬崩/耗尽 attempts）时 retry 被 409 挡住，恰是恢复手段 | 后续用 `queue.getJob/getState` 判定真实任务状态，或加 force 参数 |
| 16 | 异常卷子接口一次读全表再截 50 人；「查看异常卷子」入口只在非 `none` 分支 | 诊断接口，按需点击；历史考试可在卡片点「预生成组卷」建状态行后使用（Task 7 修复） |
| 17 | `fill-missing` 的 upsert 不清 startedAt/finishedAt/summary（展示残留） | 纯展示；Worker 完成时覆盖 |
| 18 | 修复器对 `NaN`/非数值目标无防御（`sum <= 0` 不拦 NaN），且 `key in dist` 有原型链风险 | 目标写入路径由 Task 9 校验；Task 9 落地后风险闭合，否则 P1c 补 `Number.isFinite` + Set 判定 |
| 19 | Task 9（试卷 API/编辑器难度目标）**未完成**：并行会话未提交改动占用 `routes/papers.ts` / `PaperEditor.tsx` | 待并行会话提交后补做；在此之前用户无法在 UI 配置难度目标（Task 10/13 的链路已就绪） |
| 20 | `PUT /:id` 换卷的 paperId 写入与题位重建/快照失效非事务 | **P1c 已闭合**：`lockExam + tx.exam.update + syncPaperIntoExam(tx) + invalidateUnstartedSnapshots(tx)` 同一事务；reschedule 在事务外（失败 500 时状态已一致；换卷分支同请求重试不会重排，需手动「重新组卷」或开考现场生成兜底；PUT /:id/questions 分支可直接重试） |
| 21 | 批次激活级联发布**不跑预检阻断**，只逐场补预生成调度 | 终审裁定「先补调度、不阻断整批」；是否阻断请产品决定（建议 P1c 用 `paper-generation-scheduler` 统一三入口） |
| 22 | 组卷调度逻辑重复（publish/retry/lifecycle/batch） | **P1c 已收敛**：`paper-generation-scheduler` 统一 publish/lifecycle/batch；retry 因「状态行写入必须在锁事务内」保留独立写入（`fill` 分支仍手写同形 update）。#6 的调度器抽取已完成核心部分 |
| 23 | 名单去重 | **P1c 已闭合**：job 的 `listStudents`、进度查询、retry、publish 的 `studentIds` 均按 studentId 去重 |
| 24 | 预生成 job 运行中改卷时同 jobId 被静默去重 | **P1c 已闭合**：`Queue.remove` 返回 0（locked）或抛错时改用 `${baseJobId}-${randomUUID()}` 的后继 jobId（真实契约，非抛错假设）。残留：waiting/delayed 的 UUID 后继不被显式清理，靠 removeOnComplete/Fail 20 截断 + 幂等消化 |
| 25 | 批次激活逐场 `reschedule` 串行 | **P1c 已闭合**：改 `Promise.allSettled` 并行（单场失败只 warn，不影响批次响应）；极端多考试时并发上界=就绪考试数 |
| 26 | `total=created` 后，并发下 `createMany` 全跳过时该生被计为 `missing`（卷子其实由开考路径插入） | 纯展示、极罕见；P1c 可在汇总里区分「并发已存在」 |
| 27 | `PUT /:id` 的 `startTime`/`endTime`/`batchId` lost-update | **服务端 P1c 已闭合**（只在显式提供时写入）；客户端 ExamForm 仍回显这三项（见 #30） |
| 28 | 旧版 `ExamForm` 保存时总会回显加载时的 `paperId` | **P1c 已闭合**：`buildExamPayload` 编辑且 paperId 未变化时不回传（含单测）；创建/变更/解绑仍回传 |
| 29 | `ExamForm` 保存成功后不刷新 `existingExam`：同标签页先换卷再保存，可能把已保存的旧值当「变更」重发，覆盖别处的并发换卷 | 窄场景；P1c 后续保存成功后重载/刷新基线 |
| 30 | `ExamForm` 仍回显 `startTime/endTime/batchId`（服务端只保护省略字段的调用方） | 与 #27 同源；P1c 后续按「只发变更字段」重构表单 payload |

## 附：任务依赖图

```
Task 1 listSlotCandidates ──┬─→ Task 3 预检 ─→ Task 4 发布接入 ─→ Task 5 worker ─→ Task 6 API ─→ Task 7 卡片
                             │                                                │
Task 2 迁移(状态表) ─────────┘                                                └─→ Task 13 修复接入
Task 8 迁移(目标/pickMeta) ─→ Task 10 绑卷拷贝 ─→ Task 11 pickMeta ─→ Task 12 修复器 ─→ Task 13 ─→ Task 14
Task 9 试卷目标 API/UI ──────────────────────────────────────────────↗
```

**执行顺序**：1 → 2 → 3 → 4 → 5 → 6 → 7（P1a 可独立验收）→ 8 → 9 → 10 → 11 → 12 → 13 → 14。
