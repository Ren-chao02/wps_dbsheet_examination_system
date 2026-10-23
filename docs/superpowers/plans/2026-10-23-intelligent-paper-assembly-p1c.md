# 智能组卷 P1c（第一批）实施计划：并发窗口闭合与调度入口收敛

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** 闭合「开考 vs 重新组卷/修复」的毫秒级换卷窗口，并把 publish / lifecycle / batch 三处重复的「重置状态行 + 入队」收敛为一个调度器；批次激活改为并行调度，避免 Redis 不可用时 N×3s 串行等待。

**Architecture:** 用 PostgreSQL 事务级 advisory lock（按 examId）串行化开考事务与重新组卷事务；新增 `paper-generation-scheduler.ts` 作为唯一调度入口；批次激活用 `Promise.allSettled` 逐场调度。

**Tech Stack:** Express + Prisma（PostgreSQL advisory lock）+ BullMQ + vitest/supertest。

## Global Constraints

- **不改现有硬约束语义**：分值一致、题型一致、`schemaRefs` 结构签名一致（strict 级）、同卷不重复、候选池归属（`poolWhere`）、固定题位不动。
- **预检/生成/修复必须共用 `listSlotCandidates`**——禁止任何一处另写候选过滤条件。
- **已开考（存在任意 `in_progress/submitted/grading/graded` 提交）的考试，绝不改动已有 `StudentExamQuestion` 快照**；只允许补生成缺失学生。
- 迁移禁止 `prisma migrate dev`；本批**不新增迁移**。
- 注释与文档用中文、解释「为什么」；新代码用 `utils/logger.ts` 的 `logger`（pino object-first）。
- **提交必须带 pathspec**（本工作区常有并行会话）：`git commit -m "..." -- <明确文件>`，绝不 `git add -A`。
- 测试**必须指定路径**（裸 `npx vitest run` 会捡到 gitignored 的 `dist/**`）。
- 每个提交前：`cd packages/server && npx tsc --noEmit -p tsconfig.json`。
- **不要触碰并行会话的未提交文件**：`packages/server/src/routes/papers.ts`、`packages/client/src/pages/teacher/PaperEditor.tsx`、`packages/client/src/utils/paperAssembly.ts` 及其测试。
- Task 9（试卷 API/编辑器难度目标）仍暂缓，不在本计划范围。

---

### Task 1: 考试级 advisory lock —— 开考事务与重新组卷互斥

**Files:**
- Create: `packages/server/src/services/exam-lock.ts`
- Modify: `packages/server/src/routes/my-exams.ts`（start-wps 创建答卷的事务内）
- Modify: `packages/server/src/routes/exams.ts`（retry 路由改为事务内取锁）
- Test: `packages/server/src/services/__tests__/exam-lock.test.ts`
- Test: `packages/server/src/routes/__tests__/exam-paper-generation-api.test.ts`（补 `$transaction`/`$queryRaw` mock 与锁断言）

**Interfaces:**
- Produces: `lockExam(tx: Prisma.TransactionClient, examId: string): Promise<void>`
- `countDistinctStudents(examId: string, tx?: Prisma.TransactionClient | typeof prisma): Promise<number>`（服务 `paper-generation-lifecycle.ts` 已存在，本任务给它加可选 tx）

- [ ] **Step 1: 先写锁 helper 的单测**

`packages/server/src/services/__tests__/exam-lock.test.ts`：

```ts
import { describe, it, expect, vi } from 'vitest';
import { lockExam } from '../exam-lock';

describe('lockExam', () => {
  it('在事务内按 examId 取 PostgreSQL advisory lock', async () => {
    const queryRaw = vi.fn().mockResolvedValue([{ pg_advisory_xact_lock: null }]);
    await lockExam({ $queryRaw: queryRaw } as any, 'e-1');
    expect(queryRaw).toHaveBeenCalledTimes(1);
    const [strings, ...values] = queryRaw.mock.calls[0];
    const sql = strings.join('?');
    expect(sql).toContain('pg_advisory_xact_lock');
    expect(sql).toContain('hashtextextended');
    expect(values).toContain('e-1');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/server && npx vitest run src/services/__tests__/exam-lock.test.ts`
Expected: FAIL —— 模块不存在。

- [ ] **Step 3: 实现 helper**

`packages/server/src/services/exam-lock.ts`：

```ts
import type { Prisma } from '@prisma/client';

/**
 * 按 examId 的 PostgreSQL 事务级 advisory lock。
 *
 * 开考事务（my-exams start-wps）与重新组卷（paper-generation/retry）共用这把锁：
 * 两边都必须在事务内先取锁，再读写 StudentExamQuestion，才能消除
 * 「预生成快照被删/换题」与「学生正在开考」之间的毫秒级窗口。
 * hashtextextended 返回 bigint，避免 hashtext 32 位碰撞。
 */
export async function lockExam(tx: Prisma.TransactionClient, examId: string): Promise<void> {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${examId}, 0))`;
}
```

- [ ] **Step 4: 开考事务取锁**

`packages/server/src/routes/my-exams.ts`，在 start-wps 创建答卷的事务回调**第一行**（重查考试状态之前）：

```ts
        submission = await prisma.$transaction(async (tx) => {
          // 与「重新组卷」共用考试锁：锁内重新校验状态 + 生成快照，
          // 避免重试事务在本事务提交前删掉刚生成的快照。
          await lockExam(tx, req.params.id);

          // 事务内重查考试状态：避免"入场校验通过 → 落库前考试已被结束"的竞态。
          ...
```

顶部补 `import { lockExam } from '../services/exam-lock';`。

- [ ] **Step 5: retry 路由改为事务内取锁**

`packages/server/src/routes/exams.ts`：
- 顶部 import `lockExam`；`countDistinctStudents` 加进 lifecycle 的 import。
- 把从 `const started = await prisma.studentSubmission.count({` 到 `res.json({ mode: 'regenerate' });` 的整段替换为：

```ts
    // 重新组卷/补缺的决策与快照失效必须与开考事务持同一把锁：
    // 否则 count 与 delete 之间学生开考，仍可能删掉刚生成的快照。
    const outcome = await prisma.$transaction(async (tx) => {
      await lockExam(tx, req.params.id);

      const started = await tx.studentSubmission.count({
        where: { examId: req.params.id, status: { in: [...STARTED_SUBMISSION_STATUSES] } },
      });

      if (started > 0) {
        // 补生成：只补缺，不动已有快照。状态行可能因历史原因缺失，先确保它存在。
        const totalStudents = await countDistinctStudents(req.params.id, tx);
        await tx.examPaperGeneration.upsert({
          where: { examId: req.params.id },
          create: { examId: req.params.id, status: 'pending', totalStudents },
          update: { status: 'pending', error: null, queuedAt: new Date() },
        });
        return { mode: 'fill-missing' as const };
      }

      // 重新组卷：先预检（避免清空后才发现组不出来），再清空重建
      const preflight = await preflightExamPaper(req.params.id, tx);
      if (!preflight.ok) {
        return { mode: 'preflight-failed' as const, issues: preflight.issues };
      }

      // 守卫保留为防御纵深：未来若有调用方忘记取锁，单条 DELETE 的可见性仍能兜底
      await tx.studentExamQuestion.deleteMany({
        where: {
          examId: req.params.id,
          student: {
            submissions: {
              none: { examId: req.params.id, status: { in: [...STARTED_SUBMISSION_STATUSES] } },
            },
          },
        },
      });

      const totalStudents = await countDistinctStudents(req.params.id, tx);
      await tx.examPaperGeneration.upsert({
        where: { examId: req.params.id },
        create: { examId: req.params.id, status: 'pending', totalStudents },
        update: {
          status: 'pending', totalStudents,
          queuedAt: new Date(), startedAt: null, finishedAt: null, error: null,
          summary: Prisma.JsonNull, unfilledSlots: Prisma.JsonNull,
        },
      });
      return { mode: 'regenerate' as const };
    });

    if (outcome.mode === 'preflight-failed') {
      return res.status(400).json({ message: '组卷预检未通过', preflight: outcome.issues });
    }

    // 入队放在事务外：不能持锁等 Redis（入队超时 3s）
    const enq = await enqueuePaperGeneration(req.params.id);
    if (!enq.queued) {
      await prisma.examPaperGeneration.updateMany({
        where: { examId: req.params.id, status: 'pending' },
        data: { status: 'failed', error: '组卷队列不可用（Redis 未启动）；开考时将现场生成' },
      });
      return res.status(503).json({
        message: outcome.mode === 'fill-missing'
          ? '组卷队列不可用，请稍后重试'
          : '组卷队列不可用，已标记为失败；开考时将现场生成',
      });
    }
    res.json({ mode: outcome.mode });
```

- [ ] **Step 6: `countDistinctStudents` 支持事务**

`packages/server/src/services/paper-generation-lifecycle.ts`：

```ts
export async function countDistinctStudents(
  examId: string,
  tx: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<number> {
  const rows = await tx.examRoomStudent.groupBy({ by: ['studentId'], where: { assignment: { examId } } });
  return rows.length;
}
```

（`Prisma` 已在该文件 import；若无则补 `import type { Prisma } from '@prisma/client';`。）

- [ ] **Step 7: 更新路由测试 mock**

`packages/server/src/routes/__tests__/exam-paper-generation-api.test.ts`：
- prisma mock 增加 `$transaction` 与 `$queryRaw`（工厂内构造对象后挂上）：

```ts
vi.mock('../../config/prisma', () => {
  const prismaMock: any = {
    exam: { findUnique: examFindUnique },
    examPaperGeneration: { findUnique: genFindUnique, deleteMany: genDeleteMany, create: genCreate, update: genUpdate, upsert: genUpsert, updateMany: genUpdateMany },
    examRoomStudent: { count: studentCount, groupBy: studentGroupBy },
    studentExamQuestion: { findMany: sqFindMany, deleteMany: sqDeleteMany },
    studentSubmission: { count: submissionCount },
  };
  prismaMock.$transaction = vi.fn((fn: any) => fn(prismaMock));
  prismaMock.$queryRaw = vi.fn().mockResolvedValue([{ pg_advisory_xact_lock: null }]);
  return { prisma: prismaMock };
});
```

新增 hoisted mock：`studentGroupBy`（返回 10 个 `{ studentId: 's-i' }`）与 `genUpdateMany`（若尚无；`vi.fn().mockResolvedValue({count:1})`）。原有 `studentCount` 仍供 publish/其他分支使用。
- 在「无提交 → 重新组卷」用例补：

```ts
    expect((prisma as any).$queryRaw).toHaveBeenCalled();
```

（顶部 `import { prisma } from '../../config/prisma';` 拿到 mock 对象。）
- 队列不可用用例的断言从 `genUpdate` 改为 `genUpdateMany`（scheduler/路由现在用 updateMany 带 `status:'pending'` 守卫）。
- 若既有用例的 `genUpdate` 断言因改动失效，逐条说明后调整。

- [ ] **Step 8: 验证 + 提交**

```bash
cd packages/server && npx vitest run src/services/__tests__/exam-lock.test.ts src/routes/__tests__/exam-paper-generation-api.test.ts src/routes/__tests__/exam-paper-generation-invalidation.test.ts
cd packages/server && npx tsc --noEmit -p tsconfig.json
cd packages/server && npx eslint src/services/exam-lock.ts src/services/paper-generation-lifecycle.ts src/routes/my-exams.ts src/routes/exams.ts src/routes/__tests__/exam-paper-generation-api.test.ts
```

```bash
git commit -m "fix(exams): 开考与重新组卷共用 examId advisory lock（闭合换卷 ms 级窗口）" -- \
  packages/server/src/services/exam-lock.ts \
  packages/server/src/services/paper-generation-lifecycle.ts \
  packages/server/src/routes/my-exams.ts \
  packages/server/src/routes/exams.ts \
  packages/server/src/services/__tests__/exam-lock.test.ts \
  packages/server/src/routes/__tests__/exam-paper-generation-api.test.ts
```

---

### Task 2: 抽出 `paper-generation-scheduler`，批次激活并行调度

**Files:**
- Create: `packages/server/src/services/paper-generation-scheduler.ts`
- Modify: `packages/server/src/routes/exams.ts`（publish 路由改调 scheduler；`PUT /:id` 的 paperId 写入移入换卷锁事务）
- Modify: `packages/server/src/services/paper-generation-lifecycle.ts`（reschedule 复用 scheduler）
- Modify: `packages/server/src/services/exam-lock.ts`（注释补全四个调用点）
- Modify: `packages/server/src/routes/batches.ts`（逐场并行调度）
- Test: `packages/server/src/services/__tests__/paper-generation-scheduler.test.ts`
- Test: `packages/server/src/routes/__tests__/exam-publish-preflight.test.ts`（按新调用形状调整断言）

**Interfaces:**
- Produces: `schedulePaperGeneration(params: { examId: string; totalStudents: number; mode: 'reset' | 'fill' }): Promise<'pending' | 'failed'>`
- `reschedulePaperGeneration(examId)` 返回值改为 `'skipped' | 'pending' | 'failed'`（原先 `'queued'`）

- [ ] **Step 1: 写 scheduler 单测（先失败）**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { upsert, updateMany, enqueue } = vi.hoisted(() => ({
  upsert: vi.fn(),
  updateMany: vi.fn(),
  enqueue: vi.fn(),
}));
vi.mock('../../config/prisma', () => ({ prisma: { examPaperGeneration: { upsert, updateMany } } }));
vi.mock('../../jobs/paper-generation-queue', () => ({ enqueuePaperGeneration: enqueue }));

import { schedulePaperGeneration } from '../paper-generation-scheduler';

beforeEach(() => {
  vi.clearAllMocks();
  upsert.mockResolvedValue({});
  updateMany.mockResolvedValue({ count: 1 });
  enqueue.mockResolvedValue({ queued: true });
});

describe('schedulePaperGeneration', () => {
  it('reset：清空上一轮 summary/时间戳后入队', async () => {
    await expect(schedulePaperGeneration({ examId: 'e-1', totalStudents: 30, mode: 'reset' }))
      .resolves.toBe('pending');
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { examId: 'e-1' },
      update: expect.objectContaining({ status: 'pending', totalStudents: 30, startedAt: null }),
    }));
    expect(enqueue).toHaveBeenCalledWith('e-1');
  });

  it('fill：保留上一轮结果，仅置 pending/清 error', async () => {
    await schedulePaperGeneration({ examId: 'e-1', totalStudents: 30, mode: 'fill' });
    const update = upsert.mock.calls[0][0].update;
    expect(update).toMatchObject({ status: 'pending', error: null });
    expect(update).not.toHaveProperty('summary');
  });

  it('队列不可用 → 状态行标 failed（带 pending 守卫）', async () => {
    enqueue.mockResolvedValue({ queued: false });
    await expect(schedulePaperGeneration({ examId: 'e-1', totalStudents: 30, mode: 'reset' }))
      .resolves.toBe('failed');
    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { examId: 'e-1', status: 'pending' },
      data: expect.objectContaining({ status: 'failed' }),
    }));
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/server && npx vitest run src/services/__tests__/paper-generation-scheduler.test.ts`
Expected: FAIL —— 模块不存在。

- [ ] **Step 3: 实现 scheduler**

```ts
import { Prisma } from '@prisma/client';
import { prisma } from '../config/prisma';
import { enqueuePaperGeneration } from '../jobs/paper-generation-queue';

export interface SchedulePaperGenerationParams {
  examId: string;
  totalStudents: number;
  /** reset = 新一轮生成（清空 summary/时间戳）；fill = 只补缺（保留上一轮结果） */
  mode: 'reset' | 'fill';
}

/**
 * 组卷预生成的唯一调度入口：重置/补缺状态行 → 入队 → 队列不可用时标 failed。
 *
 * publish、重新组卷后的 lifecycle、批次激活三处过去各写一遍这段逻辑，
 * 已经出现过「某处忘了清 summary」「某处忘了带 pending 守卫」的漂移；
 * 统一在这里后，新增入口只允许调用本函数。
 */
export async function schedulePaperGeneration(
  params: SchedulePaperGenerationParams,
): Promise<'pending' | 'failed'> {
  const { examId, totalStudents, mode } = params;

  if (mode === 'reset') {
    await prisma.examPaperGeneration.upsert({
      where: { examId },
      create: { examId, status: 'pending', totalStudents },
      update: {
        status: 'pending', totalStudents,
        queuedAt: new Date(), startedAt: null, finishedAt: null, error: null,
        summary: Prisma.JsonNull, unfilledSlots: Prisma.JsonNull,
      },
    });
  } else {
    await prisma.examPaperGeneration.upsert({
      where: { examId },
      create: { examId, status: 'pending', totalStudents },
      update: { status: 'pending', error: null, queuedAt: new Date() },
    });
  }

  const enq = await enqueuePaperGeneration(examId);
  if (!enq.queued) {
    // 只覆盖仍是 pending 的行：若迟到 job 已经跑完写成 done，不能倒回 failed
    await prisma.examPaperGeneration.updateMany({
      where: { examId, status: 'pending' },
      data: { status: 'failed', error: '组卷队列不可用（Redis 未启动）；开考时将现场生成' },
    });
    return 'failed';
  }
  return 'pending';
}
```

- [ ] **Step 4: publish 路由改调 scheduler**

`routes/exams.ts` 的 publish 中，把原来的 `try { upsert... enqueue... } catch { ... }` 整段替换为：

```ts
    let generationStatus: 'pending' | 'failed' = 'pending';
    try {
      generationStatus = await schedulePaperGeneration({
        examId: req.params.id,
        totalStudents: studentIds.length,
        mode: 'reset',
      });
    } catch (err) {
      generationStatus = 'failed';
      logger.error({ err }, '组卷预生成调度失败');
      await prisma.examPaperGeneration
        .updateMany({ where: { examId: req.params.id }, data: { status: 'failed', error: '组卷调度失败；开考时将现场生成' } })
        .catch(() => {});
    }
```

顶部 import scheduler；原 `enqueuePaperGeneration` 若 publish 不再使用，保留给 retry（`exams.ts` 仍用）。

- [ ] **Step 5: lifecycle 复用 scheduler**

```ts
export async function reschedulePaperGeneration(examId: string): Promise<'skipped' | 'pending' | 'failed'> {
  const exam = await prisma.exam.findUnique({ where: { id: examId }, select: { status: true } });
  if (!exam || (exam.status !== 'published' && exam.status !== 'scheduled')) return 'skipped';
  return schedulePaperGeneration({
    examId,
    totalStudents: await countDistinctStudents(examId),
    mode: 'reset',
  });
}
```

- [ ] **Step 6: 批次激活并行调度**

`routes/batches.ts` 把逐场 `for` 循环替换为：

```ts
        const settled = await Promise.allSettled(
          readyExams.map(e => reschedulePaperGeneration(e.id)),
        );
        for (const [i, r] of settled.entries()) {
          if (r.status === 'rejected') {
            logger.warn({ examId: readyExams[i].id, err: r.reason }, '批次级联发布后的组卷预生成调度失败');
          }
        }
```

- [ ] **Step 6b: 把 `PUT /:id` 的 paperId 写入移入换卷锁事务（顺带闭合附二 #20）**

`routes/exams.ts` 的 `PUT /:id`：把当前的 `const updated = await prisma.exam.update({...})`（在换卷判断之前）与后面的换卷事务合并为：

```ts
    const effectivePaperId = paperId !== undefined ? (paperId ?? null) : exam.paperId;
    const updateData = {
      ...rest,
      // 仅在请求显式提供字段时才更新，否则保留原有值（避免编辑时误清空）
      startTime: data.startTime !== undefined ? (data.startTime ? new Date(data.startTime) : null) : exam.startTime,
      endTime: data.endTime !== undefined ? (data.endTime ? new Date(data.endTime) : null) : exam.endTime,
      paperId: effectivePaperId,
      batchId: batchId !== undefined ? (batchId ?? null) : exam.batchId,
    };

    let updated;
    if (effectivePaperId !== exam.paperId) {
      // paperId 与题位重建/快照失效必须同一个事务：否则事务失败会留下
      // 「exam.paperId 已指向新卷、ExamQuestion 仍是旧卷」且同请求重试不再触发的中间态。
      updated = await prisma.$transaction(async (tx) => {
        await lockExam(tx, req.params.id);
        const row = await tx.exam.update({ where: { id: req.params.id }, data: updateData });
        await syncPaperIntoExam({ examId: req.params.id, paperId: effectivePaperId, tx });
        await invalidateUnstartedSnapshots(req.params.id, tx);
        return row;
      });
      // 入队放在事务外：不能持锁等 Redis
      await reschedulePaperGeneration(req.params.id);
    } else {
      updated = await prisma.exam.update({ where: { id: req.params.id }, data: updateData });
    }
```

- [ ] **Step 6c: 补全 `exam-lock.ts` 的调用点注释**

把注释里的「开考事务与重新组卷」扩展为四个调用点：start-wps、paper-generation/retry、`PUT /:id` 换卷、`PUT /:id/questions` 改题；强调「任何改写 ExamQuestion/StudentExamQuestion 的路径都必须先取这把锁」。

- [ ] **Step 7: 调整既有 publish 测试**

`exam-publish-preflight.test.ts`：队列不可用/调度失败的断言从 `generationUpdate` 改为 `generationUpdateMany`（新实现用带 `status:'pending'` 守卫的 updateMany）；其余断言保持不变。逐条在报告中说明。

- [ ] **Step 8: 验证 + 提交**

```bash
cd packages/server && npx vitest run \
  src/services/__tests__/paper-generation-scheduler.test.ts \
  src/routes/__tests__/exam-publish-preflight.test.ts \
  src/routes/__tests__/exam-paper-generation-api.test.ts \
  src/routes/__tests__/exam-paper-generation-invalidation.test.ts \
  src/routes/__tests__/batch-activation-paper-generation.test.ts \
  src/jobs/__tests__/paper-generation.test.ts \
  src/jobs/__tests__/paper-generation-repair.test.ts
cd packages/server && npx tsc --noEmit -p tsconfig.json
cd packages/server && npx eslint src/services/paper-generation-scheduler.ts src/services/paper-generation-lifecycle.ts src/routes/exams.ts src/routes/batches.ts
cd /data/wps_dbsheet_examination_system && npm test -w packages/server
```

```bash
git commit -m "refactor(exams): 组卷调度收敛为 paper-generation-scheduler + 批次激活并行调度" -- \
  packages/server/src/services/paper-generation-scheduler.ts \
  packages/server/src/services/__tests__/paper-generation-scheduler.test.ts \
  packages/server/src/services/paper-generation-lifecycle.ts \
  packages/server/src/services/exam-lock.ts \
  packages/server/src/routes/exams.ts \
  packages/server/src/routes/batches.ts \
  packages/server/src/routes/__tests__/exam-publish-preflight.test.ts
```

---

### Task 4: 运行中 job 的后继调度、publish 去重计数、scheduler 简化

**Files:**
- Modify: `packages/server/src/jobs/paper-generation-queue.ts`
- Modify: `packages/server/src/routes/exams.ts`（publish 的 studentIds 去重）
- Modify: `packages/server/src/services/paper-generation-scheduler.ts`（删除未使用的 `fill` 分支）
- Test: `packages/server/src/jobs/__tests__/paper-generation-queue.test.ts`
- Test: `packages/server/src/routes/__tests__/exam-publish-preflight.test.ts`
- Test: `packages/server/src/services/__tests__/paper-generation-scheduler.test.ts`

- [ ] **Step 1: 队列测试（先失败）**

在 `paper-generation-queue.test.ts` 把「旧 job 正在运行（remove 抛错）」用例加强为：

```ts
  it('旧 job 正在运行（remove 抛错）→ 用带时间戳的后继 jobId（本轮重建不丢）', async () => {
    const { enqueuePaperGeneration } = await loadQueue('redis://127.0.0.1:6379');
    mockQueueRemove.mockRejectedValue(new Error('Job is locked'));
    mockQueueAdd.mockResolvedValue({ id: 'job-3' });
    await expect(enqueuePaperGeneration('e-1')).resolves.toEqual({ queued: true });
    const jobId = mockQueueAdd.mock.calls[0][2].jobId as string;
    expect(jobId).toMatch(/^paper-generation-e-1-\d+$/);
  });
```

- [ ] **Step 2: 实现后继 jobId**

`enqueuePaperGeneration` 内：

```ts
    const baseJobId = `paper-generation-${examId}`;
    let jobId = baseJobId;
    await Promise.race([
      (async () => {
        // 旧 job 在 completed/failed 集合里 → remove 后复用同一 jobId；
        // 任务正在运行 → remove 抛 locked，此时若仍用同 jobId，add 会被 BullMQ
        // 静默去重，改卷后的重新生成永远不会发生。改用带时间戳的后继 jobId，
        // 生成本身幂等（已有快照早退），两轮任务先后/并发都安全。
        try { await q.remove(baseJobId); } catch { jobId = `${baseJobId}-${Date.now()}`; }
        await q.add('generate', { examId }, { jobId, attempts: 3, backoff: { type: 'exponential', delay: 5000 }, removeOnComplete: 20, removeOnFail: 20 });
      })(),
      ...
```

- [ ] **Step 3: publish 名单去重**

`routes/exams.ts` publish：

```ts
    const studentIds = [...new Set((await prisma.examRoomStudent.findMany({
      where: { assignment: { examId: req.params.id } },
      select: { studentId: true },
    })).map(s => s.studentId))];
```

测试：在 `exam-publish-preflight.test.ts` 加一条「同一学生分到两个考场 → totalStudents 去重」：`examRoomStudentFindMany` 返回 `[{studentId:'s-1'},{studentId:'s-1'},{studentId:'s-2'}]`，断言 `generationUpsert` 的 `update.totalStudents === 2`。

- [ ] **Step 4: scheduler 删除 `fill` 分支**

`scheduler` 只保留「重置」语义（`fill` 在生产代码无调用方）：

```ts
export interface SchedulePaperGenerationParams {
  examId: string;
  totalStudents: number;
}

export async function schedulePaperGeneration(
  params: SchedulePaperGenerationParams,
): Promise<'pending' | 'failed'> {
  const { examId, totalStudents } = params;
  await prisma.examPaperGeneration.upsert({ ...原来的 reset 分支... });
  ...
}
```

删掉 scheduler 测试里的 `fill` 用例；publish / lifecycle 调用去掉 `mode: 'reset'`。

- [ ] **Step 5: 验证 + 提交**

```bash
cd packages/server && npx vitest run src/jobs/__tests__/paper-generation-queue.test.ts src/routes/__tests__/exam-publish-preflight.test.ts src/services/__tests__/paper-generation-scheduler.test.ts src/routes/__tests__/batch-activation-paper-generation.test.ts
cd packages/server && npx tsc --noEmit -p tsconfig.json
cd packages/server && npx eslint src/jobs/paper-generation-queue.ts src/routes/exams.ts src/services/paper-generation-scheduler.ts src/jobs/__tests__/paper-generation-queue.test.ts src/services/__tests__/paper-generation-scheduler.test.ts src/routes/__tests__/exam-publish-preflight.test.ts
```

```bash
git commit -m "fix(jobs): 运行中 job 用后继 jobId + publish 名单去重 + scheduler 去 fill 死分支" -- \
  packages/server/src/jobs/paper-generation-queue.ts \
  packages/server/src/routes/exams.ts \
  packages/server/src/services/paper-generation-scheduler.ts \
  packages/server/src/jobs/__tests__/paper-generation-queue.test.ts \
  packages/server/src/routes/__tests__/exam-publish-preflight.test.ts \
  packages/server/src/services/__tests__/paper-generation-scheduler.test.ts
```

---

### Task 5: `PUT /:id` 的 paperId lost-update 与响应回填

**Files:**
- Modify: `packages/server/src/routes/exams.ts`
- Test: `packages/server/src/routes/__tests__/exam-binding-scope.test.ts`

- [ ] **Step 1: 只在显式提供 paperId 时写入**

`updateData` 先不含 `paperId`，仅当 `paperId !== undefined` 时加上：

```ts
    const updateData: any = {
      ...rest,
      startTime: data.startTime !== undefined ? (data.startTime ? new Date(data.startTime) : null) : exam.startTime,
      endTime: data.endTime !== undefined ? (data.endTime ? new Date(data.endTime) : null) : exam.endTime,
      batchId: batchId !== undefined ? (batchId ?? null) : exam.batchId,
    };
    if (paperId !== undefined) updateData.paperId = paperId ?? null;
```

`effectivePaperId` 与换卷判定保持现状。这样普通编辑（不带 paperId）不会把预读时的旧 paperId 写回，消除并发换卷的 lost-update。

- [ ] **Step 2: 换卷事务返回 sync 之后的行**

换卷事务里 `tx.exam.update` 之后、`syncPaperIntoExam`/`invalidate` 之后，返回重新读取的行：

```ts
        const row = await tx.exam.update({ where: { id: req.params.id }, data: updateData });
        await syncPaperIntoExam({ examId: req.params.id, paperId: effectivePaperId, tx });
        await invalidateUnstartedSnapshots(req.params.id, tx);
        return (await tx.exam.findUnique({ where: { id: req.params.id } })) ?? row;
```

（响应里的 totalScore/difficultyTarget 不再是 sync 前值。）

- [ ] **Step 3: 测试**

`exam-binding-scope.test.ts` 的「普通编辑（不含 paperId）」用例补：

```ts
    expect(mockPrisma.exam.update.mock.calls[0][0].data).not.toHaveProperty('paperId');
```

「换卷」相关用例补 `expect(data.paperId).toBe(PAPER_OUT)`（按现有夹具调整）。

- [ ] **Step 4: 验证 + 提交**

```bash
cd packages/server && npx vitest run src/routes/__tests__/exam-binding-scope.test.ts src/routes/__tests__/exam-paper-generation-invalidation.test.ts src/routes/__tests__/exam-publish-preflight.test.ts
cd packages/server && npx tsc --noEmit -p tsconfig.json
cd packages/server && npx eslint src/routes/exams.ts src/routes/__tests__/exam-binding-scope.test.ts
```

```bash
git commit -m "fix(exams): 普通编辑不回写旧 paperId + 换卷响应回填 sync 后的行" -- \
  packages/server/src/routes/exams.ts \
  packages/server/src/routes/__tests__/exam-binding-scope.test.ts
```

---

### Task 3（控制器）：文档与终验

- 更新计划附二：`#11`（advisory lock 关闭）、`#22`（publish/生命周期/批次已收敛；retry 因锁内事务保留独立写入）、`#25`（批次并行）。
- 全量门禁：server/client 测试 + 两端 tsc + lint。
- 对 P1c 范围做一次整体审查（BASE = Task 1 之前，HEAD = Task 2 之后）。

---
